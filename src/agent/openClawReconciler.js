'use strict'

/**
 * openClawReconciler.js — WHAT TO BELIEVE AFTER A CRASH. INERT.
 *
 * On backend start the ledger may hold records for runs nobody watched finish. This module
 * decides what may be concluded from them, and its answer is deliberately unhelpful in every
 * case where the evidence is thin.
 *
 * ⛔ THE THINGS THAT PROVE NOTHING, EACH ONE MEASURED OR REASONED, NOT ASSUMED:
 *
 *   task not found   `openclaw tasks show <unknown>` prints "Task not found" and EXITS 0.
 *                    Absence is also indistinguishable from a task not yet registered.
 *   agent absent     Current absence is not evidence of historical non-execution. The agent
 *                    could have been pruned by anything, at any time, after a run.
 *   elapsed time     A long-running turn is not a finished one. C2-B2-A measured a turn that
 *                    outlived its client by minutes.
 *   client exit      Killing the client did not stop the executor. Measured.
 *   workspace gone   Deleting a directory does not stop a process.
 *
 * NONE of them, alone or together, releases the global lock. There is no polling delay, no
 * grace period, no "not found twice", no threshold. The only never-started proof is the STATE
 * being PREPARED, because the ledger does not enter RUNNING until the durable write
 * immediately before the first spawn.
 *
 * ⛔ AND RETIREMENT IS NOT REACHABLE HERE AT ALL IN PRODUCTION.
 * Releasing the lock requires EXECUTOR_RETIRED, which requires a session-retirement proof.
 * No OpenClaw primitive neutralises a session without pruning its workspace, so the ledger's
 * default verifier refuses everything and this module cannot manufacture one. Records that
 * reach TERMINAL_OBSERVED stay locked and are reported for human reconciliation. That is the
 * honest outcome of an unsolved problem, not an oversight.
 */

/**
 * @param {{
 *   quarantine: object,
 *   taskStatusFor?: function,   INJECTED. (sessionKey) -> { found, status?, unreadable? }
 *   agentExists?: function      INJECTED. (agentId) -> boolean   (evidence only, never authority)
 * }} deps
 */
function createOpenClawReconciler (deps = {}) {
  const { quarantine } = deps
  if (!quarantine || typeof quarantine.unaccounted !== 'function') {
    throw new TypeError('openClawReconciler requires the quarantine ledger')
  }
  const taskStatusFor = typeof deps.taskStatusFor === 'function' ? deps.taskStatusFor : null
  const agentExists = typeof deps.agentExists === 'function' ? deps.agentExists : null

  /**
   * Examine every unaccounted record and advance only what the evidence genuinely supports.
   * Returns a report; it never throws for an ambiguous record, because an ambiguous record is
   * an expected outcome that a person has to look at.
   */
  function reconcile () {
    const live = quarantine.unaccounted()
    const findings = []

    for (const rec of live) {
      const approvalId = rec.approvalId
      const sessionKey = rec.sessionKey || null

      if (!sessionKey) {
        // Cannot even be looked up. This should be impossible — markRunning requires it — so
        // its presence means the ledger is describing something we do not understand.
        findings.push(note(approvalId, rec, 'escalate', 'no sessionKey recorded; the run cannot be looked up'))
        continue
      }
      if (!taskStatusFor) {
        findings.push(note(approvalId, rec, 'escalate', 'no task status source configured (reconciler is inert)'))
        continue
      }

      const seen = taskStatusFor(sessionKey)

      if (!seen || seen.unreadable) {
        findings.push(note(approvalId, rec, 'escalate', 'task status unreadable; an unreadable status is not a terminal one'))
        continue
      }

      if (!seen.found) {
        // ⛔ The dangerous case. An execution-bearing record whose task cannot be found is
        // ambiguous between "never registered" and "registered and gone". Agent absence is
        // recorded as context and explicitly does NOT change the verdict.
        const agentNote = agentExists ? ` (agent ${agentExists(rec.agentId) ? 'present' : 'absent'} — evidence only)` : ''
        findings.push(note(approvalId, rec, 'escalate',
          `task not found for ${sessionKey}; absence proves neither that it never ran nor that it stopped${agentNote}`))
        continue
      }

      if (!TERMINAL.includes(seen.status)) {
        findings.push(note(approvalId, rec, 'hold', `task is ${seen.status}; still running`))
        continue
      }

      // A genuine terminal status. Advance where the state machine allows it — and note that
      // this still does NOT release the lock.
      let advanced = null
      try {
        if (rec.state !== quarantine.STATES.TERMINAL_OBSERVED) {
          quarantine.observeTerminal(approvalId, seen.status, { note: 'observed during restart reconciliation' })
          advanced = quarantine.STATES.TERMINAL_OBSERVED
        }
      } catch (e) {
        findings.push(note(approvalId, rec, 'escalate', `terminal observation refused: ${(e && e.message) || e}`))
        continue
      }

      findings.push(note(approvalId, rec, 'locked-pending-retirement',
        `terminal status '${seen.status}' observed; the lock is HELD because the session may still auto-resume ` +
        'and no session-retirement proof exists', advanced))
    }

    return {
      unaccounted: live.length,
      findings,
      // The only thing a caller may act on automatically.
      executionAllowed: quarantine.unaccounted().length === 0
    }
  }

  /**
   * The boot gate. Refuses every new OpenClaw execution while anything is unaccounted.
   */
  function gate (approvalId) {
    const live = quarantine.unaccounted()
    if (live.length > 0) {
      return {
        ok: false,
        reason: `refuse: ${live.length} unaccounted OpenClaw record(s) require reconciliation before any new execution`,
        blockedBy: live.map((r) => ({ approvalId: r.approvalId, state: r.state, phase: r.phase || null }))
      }
    }
    return quarantine.canStart(approvalId)
  }

  return { reconcile, gate }
}

const TERMINAL = ['succeeded', 'failed', 'timed_out', 'cancelled', 'lost']

function note (approvalId, rec, verdict, reason, advancedTo) {
  return {
    approvalId,
    state: rec.state,
    phase: rec.phase || null,
    sessionKey: rec.sessionKey || null,
    verdict,
    reason,
    advancedTo: advancedTo || null,
    lockReleased: false
  }
}

module.exports = { createOpenClawReconciler }
