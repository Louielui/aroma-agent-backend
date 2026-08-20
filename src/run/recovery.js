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
 *   (b) DISPATCH_CLAIMED or WORKER_CLAIMED,      → INTERRUPTED (may have started)
 *       NO execution artifact
 *   (c) execution artifact, NO result            → INTERRUPTED (no terminal evidence)
 *   (d) result artifact + ok                     → SUCCEEDED   (from disk)
 *   (e) result artifact + not ok                 → FAILED      (from disk)
 *   (f) result present, timeline not updated     → SUCCEEDED/FAILED from the artifact
 *       (the durable result is the source of truth here)
 *
 * ── P1-C1c: THE AGENT BRIDGE LANE ────────────────────────────────────────────
 * The Agent lane had no place in this fold at all, and the consequence was
 * measurable: an approval that genuinely executed came back from a restart marked
 * PENDING — "never started" — because the only thing on disk about it was an audit
 * record this function never looked at. Two durable sources now speak for it:
 *
 *   (g) AGENT_FINISHED{ok:boolean}                → SUCCEEDED / FAILED
 *       The CRASH BRIDGE. Written the instant the runner returns and flushed BEFORE
 *       the terminal stage, so the window between "we know the outcome" and "the
 *       outcome is recorded as terminal" is recoverable from the Run alone.
 *   (h) no AGENT_FINISHED, agent-audit matched BY runId → SUCCEEDED / FAILED
 *       The runner writes its audit after returning; if the process died before even
 *       AGENT_FINISHED landed, the audit may still hold the answer.
 *   (i) AGENT_CLAIMED, nothing else               → INTERRUPTED, never PENDING
 *       A durable claim means the attempt MAY have started and may have touched a
 *       workspace. Calling that "never started" is the one lie this file exists to
 *       avoid.
 *
 * ⛔ CONTRADICTION IS NOT A TIE-BREAK. When two durable sources disagree — an
 * AGENT_FINISHED that says ok against an audit that says failed, or agent evidence
 * sitting beside a Worker/Develop result — there is no honest way to fold that into
 * a winner. Ranking the sources would mean encoding a guess as precedence, and the
 * guess that costs the most is the one that guesses SUCCESS. Disagreement is
 * INTERRUPTED: human-gated, exactly like every other "may have happened" here.
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
 * The outcome the Run itself recorded when the runner returned, or null when it never
 * got that far. Only a REAL boolean counts: appendStage already refuses anything else
 * onto AGENT_FINISHED, and reading loosely here would undo that guarantee for any
 * record that reached disk another way.
 */
function agentFinishedOutcome (run) {
  if (!run || !Array.isArray(run.timeline)) return null
  let outcome = null
  for (const e of run.timeline) {
    if (e && e.stage === 'AGENT_FINISHED' && e.facts && typeof e.facts.ok === 'boolean') outcome = e.facts.ok
  }
  return outcome
}

/**
 * P1-C1c. Pick the agent-audit record that belongs to THIS Run — and only ever that one.
 *
 * ⛔ MATCHED BY runId, NEVER BY RESEMBLANCE. Pre-C1c audits carry no runId at all (the
 * live machine has exactly one such record). The only way to attach one would be to
 * pick whichever Run looks plausible, and a governance record assigned by plausibility
 * is worse than no record: it would let one historical execution settle the lifecycle
 * of an attempt it has nothing to do with.
 *
 * ⛔ AND TWO MATCHES IS NOT A MATCH. Duplicate durable evidence for one Run is
 * inconsistent state; handing back either one would let recovery settle a contradiction
 * it was never shown.
 *
 * Pure: it reads the array it is given and touches nothing.
 */
function matchAgentAudit (runId, audits) {
  if (typeof runId !== 'string' || runId === '' || !Array.isArray(audits)) return null
  const matches = audits.filter((a) => a && a.runId === runId)
  return matches.length === 1 ? matches[0] : null
}

/** The audit's verdict, or null when absent/unreadable/not a boolean (fail-closed). */
function auditOutcome (agentAudit) {
  if (!agentAudit || typeof agentAudit.ok !== 'boolean') return null
  return agentAudit.ok
}

/**
 * Derive the recovered status from evidence.
 * @param {{ run: object, execution: (object|null), result: (object|null) }} evidence
 *   `result` must be a SAFE-LOADED artifact (a corrupt one is passed as null so it
 *   is never read as success). `execution` likewise.
 * @returns {{ status: 'pending'|'interrupted'|'succeeded'|'failed', mark: string }}
 */
function deriveRecoveredStatus ({ run, execution = null, result = null, agentAudit = null } = {}) {
  const finished = agentFinishedOutcome(run) // (g) null when the runner never returned
  const audited = auditOutcome(agentAudit) //   (h) null when absent/unreadable
  const hasAgentEvidence = finished !== null || audited !== null

  // ⛔ CONTRADICTION FIRST, so no later branch can quietly resolve it. Two lanes'
  // durable evidence on one Run, or two agent sources that disagree, is inconsistent
  // state — not an outcome. Fail closed.
  if (hasAgentEvidence && (result || execution)) return { status: 'interrupted', mark: MARK.interrupted }
  if (finished !== null && audited !== null && finished !== audited) return { status: 'interrupted', mark: MARK.interrupted }

  // (d)(e)(f): a durable result is the source of truth — even if the Run timeline
  // never got the terminal stage (crash after result write, before timeline flush).
  if (result) {
    const status = result.ok === true ? 'succeeded' : 'failed'
    return { status, mark: MARK[status] }
  }

  // (g)(h) the Agent lane's own durable evidence, in that order: what the Run itself
  // recorded, then what the audit recorded. They cannot disagree by the time we get
  // here — that case already returned INTERRUPTED above.
  if (finished !== null) {
    const status = finished === true ? 'succeeded' : 'failed'
    return { status, mark: MARK[status] }
  }
  if (audited !== null) {
    const status = audited === true ? 'succeeded' : 'failed'
    return { status, mark: MARK[status] }
  }

  // No readable result:
  if (execution) return { status: 'interrupted', mark: MARK.interrupted } // (c) started, no result
  // (b)(i) claimed but no outcome evidence yet — the Develop track (DISPATCH_CLAIMED,
  // B2-11a), the sandbox-worker track (WORKER_CLAIMED, B2-14), or the Agent Bridge
  // track (AGENT_CLAIMED, P1-C1c). Same narrow window, same fail-closed derivation: a
  // claim means it MAY have started → INTERRUPTED, not PENDING.
  if (hasStage(run, 'DISPATCH_CLAIMED') || hasStage(run, 'WORKER_CLAIMED') || hasStage(run, 'AGENT_CLAIMED')) {
    return { status: 'interrupted', mark: MARK.interrupted }
  }
  return { status: 'pending', mark: MARK.pending } // (a) never started
}

module.exports = { deriveRecoveredStatus, matchAgentAudit, MARK }
