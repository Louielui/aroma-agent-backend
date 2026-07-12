'use strict'

/**
 * recovery.js — B2-11b PURE derivation of a Run's recovered status from durable
 * evidence. NO side-effects, NO dispatch, NO I/O — a plain fold over:
 *   - the Run timeline (incl. DISPATCH_CLAIMED from B2-11a), and
 *   - the safe-loaded .aroma Execution + Result artifacts linked to that Run.
 *
 * Fail-closed by design: when unsure whether side-effects occurred, we mark
 * INTERRUPTED (human-gated), never guess SUCCEEDED. A corrupt/half-written result
 * artifact is treated as ABSENT by the safe-load (list() skips it), so it can
 * never be misread as success — it lands here as "no result" → INTERRUPTED.
 *
 * The six recovered states (STEP 2):
 *   (a) confirmed, NO DISPATCH_CLAIMED           → PENDING     (never started)
 *   (b) DISPATCH_CLAIMED, NO execution artifact  → INTERRUPTED (may have started)
 *   (c) execution artifact, NO result            → INTERRUPTED (no terminal evidence)
 *   (d) result artifact + ok                     → SUCCEEDED   (from disk)
 *   (e) result artifact + not ok                 → FAILED      (from disk)
 *   (f) result present, timeline not updated     → SUCCEEDED/FAILED from the artifact
 *       (the durable result is the source of truth here)
 */

// The reconcile MARK stage to append + the recovered status it implies.
const MARK = {
  pending: 'RECONCILED_PENDING',
  interrupted: 'RECONCILED_INTERRUPTED',
  succeeded: 'RECONCILED_SUCCEEDED',
  failed: 'RECONCILED_FAILED'
}

function hasStage (run, stage) {
  return !!(run && Array.isArray(run.timeline) && run.timeline.some(e => e && e.stage === stage))
}

/**
 * Derive the recovered status from evidence.
 * @param {{ run: object, execution: (object|null), result: (object|null) }} evidence
 *   `result` must be a SAFE-LOADED artifact (a corrupt one is passed as null so it
 *   is never read as success). `execution` likewise.
 * @returns {{ status: 'pending'|'interrupted'|'succeeded'|'failed', mark: string }}
 */
function deriveRecoveredStatus ({ run, execution = null, result = null } = {}) {
  // (d)(e)(f): a durable result is the source of truth — even if the Run timeline
  // never got the terminal stage (crash after result write, before timeline flush).
  if (result) {
    const status = result.ok === true ? 'succeeded' : 'failed'
    return { status, mark: MARK[status] }
  }
  // No readable result:
  if (execution) return { status: 'interrupted', mark: MARK.interrupted } // (c) started, no result
  if (hasStage(run, 'DISPATCH_CLAIMED')) return { status: 'interrupted', mark: MARK.interrupted } // (b) claimed
  return { status: 'pending', mark: MARK.pending } // (a) never started
}

module.exports = { deriveRecoveredStatus, MARK }
