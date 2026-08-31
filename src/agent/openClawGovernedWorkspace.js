'use strict'

/**
 * openClawGovernedWorkspace.js — THE ADAPTER THAT LETS AgentRunner STAY EXACTLY AS IT IS.
 *
 * ── THE DEFECT THIS FIXES ───────────────────────────────────────────────────
 * The production-proven AgentRunner calls cleanup with ONE argument and ignores what comes
 * back:
 *
 *     try { workspace.cleanup(prepared.dir) } catch (_) {}
 *
 * The first version of the WSL workspace required `cleanup(dir, { terminal: true })` and
 * returned a refusal otherwise. Composed together, EVERY cleanup would have been refused,
 * the refusal discarded by that empty catch, and every envelope leaked — silently, while the
 * tranche report claimed no AgentRunner change was required. That claim was false, and this
 * file is what makes it true.
 *
 * ── THE SHAPE ───────────────────────────────────────────────────────────────
 * This adapter presents the workspace interface AgentRunner already expects — including
 * cleanup(dir) with one argument — and decides terminality ITSELF, from the quarantine
 * ledger. AgentRunner is not modified, and the decision is not delegated to whoever calls
 * cleanup.
 *
 * ⛔ TERMINALITY IS NEVER A CALLER'S ASSERTION.
 * There is no `terminal` flag to pass. The adapter obtains a GRANT from the quarantine
 * ledger, which issues one only after observing a terminal task status, and the workspace
 * verifies the grant is genuinely one it issued. A caller cannot manufacture one by passing
 * a literal object.
 *
 * ── WHY CLEANUP IS SAFE BEFORE EXECUTION EVER BEGINS ────────────────────────
 * AgentRunner cleans up on the revision gate too, BEFORE any executor is invoked. Nothing
 * has run, nothing can be holding the envelope, and refusing there would leak a sandbox for
 * a run that never started. So a record still in PREPARED is closed out and removed. Once a
 * run has been marked RUNNING, only an observed terminal status will do.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * Not a second governance plane. It owns no policy and no schedule: it reads the quarantine
 * ledger, and it forwards every other workspace call through untouched.
 */

/**
 * @param {{
 *   workspace: object,     the WSL workspace (constructed with the quarantine grant verifier)
 *   quarantine: object,    the quarantine ledger
 *   onCleanupResult?: function   optional observer, so a refusal is never silent
 * }} deps
 */
function createOpenClawGovernedWorkspace (deps = {}) {
  const { workspace, quarantine } = deps
  if (!workspace || typeof workspace.prepare !== 'function') {
    throw new TypeError('governed workspace requires an OpenClaw WSL workspace')
  }
  if (!quarantine || typeof quarantine.begin !== 'function') {
    throw new TypeError('governed workspace requires a quarantine ledger')
  }
  const onCleanupResult = typeof deps.onCleanupResult === 'function' ? deps.onCleanupResult : () => {}

  /** repo dir -> approvalId, so cleanup never has to parse a path to find out who owns it. */
  const OWNER = new Map()

  /**
   * ⛔ A FAILED prepare() MUST NOT ORPHAN AN ENVELOPE OR A LEDGER ROW.
   *
   * prepare() can fail after the envelope exists — a refused clone, a failed branch
   * checkout, a surviving remote. It THROWS rather than returning, so there is no dir for
   * anyone to clean up with, and AgentRunner never calls cleanup because prepare never
   * returned. Review found the result: a partial envelope left on disk and a ledger row
   * stuck at PREPARED, which held nothing open but made the approvalId permanently unusable
   * while telling no one why.
   *
   * The failure is now recorded honestly as PREPARATION_FAILED and the envelope is rolled
   * back through the workspace's own fixed-path primitive, derived from the sandbox root and
   * the approvalId. The thrown error is re-raised for AgentRunner, which already turns it
   * into `workspace_refused`.
   */
  function prepare (approvalId) {
    // The ledger gate runs FIRST: if OpenClaw is locked out, no sandbox should be created
    // at all. begin() throws when another approval is unaccounted for.
    quarantine.begin(approvalId)

    let prepared
    try {
      prepared = workspace.prepare(approvalId)
    } catch (e) {
      // Nothing executed, so nothing can be holding the envelope.
      quarantine.failPreparation(approvalId, { reason: String((e && e.message) || e).slice(0, 300) })
      const rollback = workspace.abortPrepare(approvalId, { grant: quarantine.preExecutionGrant(approvalId) })
      onCleanupResult(Object.assign({ approvalId, why: 'preparation-failed' }, rollback))
      if (rollback && rollback.ok) quarantine.markCleaned(approvalId, { note: 'preparation-failed rollback' })
      throw e
    }

    OWNER.set(prepared.dir, approvalId)
    return prepared
  }

  /**
   * The one-argument cleanup AgentRunner already calls.
   * Returns {ok:false, reason} rather than throwing, matching the existing contract, and
   * reports every outcome to onCleanupResult so a refusal is recorded rather than swallowed
   * by AgentRunner's empty catch.
   */
  function cleanup (dir) {
    const approvalId = OWNER.get(dir)
    if (!approvalId) {
      return report({ ok: false, reason: 'refuse: no governed sandbox for this workspace', dir })
    }

    const state = quarantine.state(approvalId)

    // ⛔ NOTHING EVER RAN, SO THERE IS NO TASK STATUS TO REPORT.
    // The first version reached cleanup here by calling observeTerminal(id, 'cancelled'),
    // which wrote a record claiming OpenClaw's scheduler had cancelled a task that was
    // never created. Convenient, and false. The audit trail is the point of this ledger, so
    // a run refused before the executor gets its own state and carries no taskStatus.
    if (state === quarantine.STATES.PREPARED) {
      quarantine.abortPreExecution(approvalId, { reason: 'no executor was ever started' })
      return finish(dir, approvalId, 'pre-execution', quarantine.preExecutionGrant(approvalId), workspace.discardPreparedSandbox)
    }

    if (state === quarantine.STATES.PRE_EXECUTION_ABORTED || state === quarantine.STATES.PREPARATION_FAILED) {
      return finish(dir, approvalId, 'pre-execution', quarantine.preExecutionGrant(approvalId), workspace.discardPreparedSandbox)
    }

    // ⛔ THE OPERATION IS CHOSEN BY LEDGER STATE, AND EACH OPERATION FIXES ITS OWN GRANT KIND.
    // A pre-execution grant cannot reach cleanupAfterExecution, and a terminal-observed grant
    // cannot reach discardPreparedSandbox: authority is bound to the operation, not merely
    // carried as a label on the grant.
    // ⛔ A TERMINAL TASK DOES NOT AUTHORISE REMOVING AN EXECUTED ENVELOPE.
    //
    // The global lock stops Aroma dispatching a NEW run. It does nothing to stop the OpenClaw
    // Gateway auto-resuming THIS session — and a resumed successor would still need this
    // workspace. So removing it here would delete a directory out from under a live executor,
    // which is the one outcome this whole design exists to prevent.
    //
    // Everything is preserved for a later, genuine retirement: the OWNER mapping, the
    // workspace identity baseline, the envelope, the repo, and the ledger record.
    if (state === quarantine.STATES.TERMINAL_OBSERVED) {
      return report({
        ok: false,
        approvalId,
        dir,
        state,
        retryable: true,
        reason: `refuse: '${approvalId}' is TERMINAL_OBSERVED; the executor/session has not been retired, so the executed envelope must survive`
      })
    }

    if (state === quarantine.STATES.EXECUTOR_RETIRED) {
      return finish(dir, approvalId, 'executor retired', quarantine.retiredGrant(approvalId), workspace.cleanupAfterExecution)
    }

    // RUNNING, CLIENT_TIMEOUT or QUARANTINED: something may still be alive in there.
    return report({
      ok: false,
      dir,
      approvalId,
      state,
      reason: `refuse: '${approvalId}' is ${state}; the envelope is preserved until a terminal task status is observed`
    })
  }

  /**
   * Remove the envelope and, only if the disk actually gave it up, record CLEANED.
   *
   * ⛔ A FAILED REMOVAL NEVER REGRESSES THE STATE.
   * The record stays where it is (EXECUTOR_RETIRED, or the pre-execution state), the identity
   * baseline is retained by the workspace, and the failure is retryable ONLY when the provider
   * explicitly returns retryable:true; every other refusal is reported non-retryable. The
   * process question is already settled by then — the session is retired, so the global lock
   * is already released — and a disk problem must not reopen a process question it has
   * nothing to do with.
   *
   * ⛔ THE LEDGER IS WRITTEN BEFORE OWNERSHIP IS RELEASED.
   * This used to drop OWNER first and then call markCleaned. If markCleaned threw, the
   * ownership mapping was already gone, so nothing could find the approval again and the
   * record was stranded mid-transition with no way to retry. Ownership is what makes a retry
   * possible, so it is the last thing released.
   *
   * ⛔ AND A LEDGER FAILURE AFTER A SUCCESSFUL REMOVAL HAS NO AUTOMATIC REPAIR HERE.
   * The workspace drops its identity baseline on a successful rm, so the removal cannot be
   * replayed: every later cleanup returns 'no prepared sandbox baseline'. There is nothing
   * for a retry to do, which is why this outcome is reported retryable:false. Closing the
   * record out requires a person. No automatic reconciliation primitive is offered in this
   * tranche, because the only ways to build one — a second cleanup authority, or bypassing
   * the identity verifier — are both worse than a manual step.
   *
   * ⛔ AND THIS IS NOT ATOMIC ACROSS DISK AND LEDGER — SAID PLAINLY.
   * A crash between a successful removal and a successful markCleaned leaves a record that is
   * not CLEANED while the envelope is already gone. That is a real, remaining window. It is
   * the safe direction to fail in — the record still names a run that must be accounted for,
   * rather than claiming a completion that did not happen — but it is not a transaction and
   * is not described as one.
   */
  function finish (dir, approvalId, why, grant, op) {
    const result = op.call(workspace, dir, { grant })
    if (!result || !result.ok) {
      // ⛔ RETRYABILITY IS ESTABLISHED BY THE PROVIDER, NEVER ASSUMED FROM ok:false.
      //
      // This used to default retryable:true and let the provider override it. Object.assign
      // only overrides fields that are PRESENT, and most refusals do not carry the field at
      // all — a missing identity baseline, an envelope that is not the prepared object, a
      // containment refusal, an invalid grant. Every one of those was silently promoted to
      // "try again", and trying again cannot help with any of them.
      //
      // It also made the API contradict itself on the one case that matters: after a removal
      // succeeded and the ledger write failed, the first result correctly said
      // retryable:false, and the very next cleanup — refused by the real provider with "no
      // prepared sandbox baseline" — came back retryable:true. The caller would have been
      // told to keep retrying an operation that can never succeed again.
      //
      // Only an explicit retryable:true counts. openClawWslWorkspace.removeEnvelope() sets it
      // on a genuine rm failure, which is the one condition that really does clear on its own.
      // ok:false is stated rather than inherited: a provider that returns nothing at all
      // must still produce a refusal that says so, not a report with no verdict in it.
      return report(Object.assign({ ok: false, approvalId, dir, why, stateRegressed: false }, result, {
        retryable: !!(result && result.retryable === true)
      }))
    }

    // Disk removal has ALREADY succeeded here. If the ledger write fails this is not an
    // ordinary retryable disk failure, and must not be reported as one.
    try {
      quarantine.markCleaned(approvalId, { note: why })
    } catch (e) {
      return report({
        ok: false,
        approvalId,
        dir,
        why,
        diskRemoved: true,
        ledgerRecorded: false,
        ownerRetained: true,
        retryable: false,
        reason: `refuse: the envelope was removed but the ledger could not record CLEANED (${(e && e.message) || e}); ownership is retained so this remains accountable`
      })
    }

    OWNER.delete(dir)
    return report(Object.assign({ approvalId, dir, why }, result))
  }

  function report (result) {
    onCleanupResult(result)
    return result
  }

  return {
    prepare,
    cleanup,
    // everything else is the workspace's own, forwarded untouched
    containmentCheck: (...a) => workspace.containmentCheck(...a),
    envelopeContainmentCheck: (...a) => workspace.envelopeContainmentCheck(...a),
    repoChanges: (...a) => workspace.repoChanges(...a),
    sandboxState: (...a) => workspace.sandboxState(...a),
    diffStat: (...a) => workspace.diffStat(...a),
    diffPatch: (...a) => workspace.diffPatch(...a),
    // observable for composition assertions
    approvalFor: (dir) => OWNER.get(dir) || null
  }
}

module.exports = { createOpenClawGovernedWorkspace }
