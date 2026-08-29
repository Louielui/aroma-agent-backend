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

  function prepare (approvalId) {
    // The ledger gate runs FIRST: if OpenClaw is locked out, no sandbox should be created
    // at all. begin() throws when another approval is unaccounted for.
    quarantine.begin(approvalId)
    const prepared = workspace.prepare(approvalId)
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

    // Nothing ever ran: the revision gate refused before the executor was reached. There is
    // no process that could be holding this envelope.
    if (state === quarantine.STATES.PREPARED) {
      quarantine.observeTerminal(approvalId, 'cancelled', { note: 'no executor was ever started' })
      return finish(dir, approvalId, 'pre-execution')
    }

    if (state === quarantine.STATES.TERMINAL_OBSERVED) {
      return finish(dir, approvalId, 'terminal observed')
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

  function finish (dir, approvalId, why) {
    const grant = quarantine.terminalGrant(approvalId)
    const result = workspace.cleanup(dir, { grant })
    if (result && result.ok) {
      quarantine.markCleaned(approvalId, { note: why })
      OWNER.delete(dir)
    }
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
