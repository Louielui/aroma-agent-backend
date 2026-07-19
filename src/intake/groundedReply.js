'use strict'

/**
 * groundedReply.js — B2-2 Xiang Xiang Conversation Demo reply grounding.
 *
 * The distill model call co-generates its `reply` prose in the SAME turn it
 * classifies — i.e. BEFORE the governance layer decides the real outcome
 * (narrow-to-clarification, or whether a real Proposal was actually created and
 * its id). Trusting that speculative prose let 香香 claim a filed proposal the
 * system never created. This module rebuilds the action-bearing reply
 * DETERMINISTICALLY from the REAL outcome, so the prose can never over-claim.
 *
 * HARD INVARIANT: a "提案已建立（編號 …）" claim appears ONLY when
 *   proposalCreated === true  AND  a real, non-empty proposalId is present.
 * Every other case (clarification, promote failure, missing id) explicitly
 * states that NO proposal was created.
 *
 * Pure and side-effect free. Demo-only — callers gate on CONVERSATION_DEMO; this
 * module is never reached on the flag-OFF path, which stays byte-identical.
 */

function isNonEmptyString (v) { return typeof v === 'string' && v.trim() !== '' }

/**
 * Build a 香香-voice Traditional Chinese reply grounded in the REAL outcome.
 *
 * @param {object} outcome
 * @param {'clarification'|'execution_proposal'} outcome.type
 * @param {boolean} [outcome.proposalCreated]                 execution: was a real Proposal created?
 * @param {string|null} [outcome.proposalId]                  execution: the real Proposal id, if any
 * @param {string|null} [outcome.clarificationReason]         'multiple_tasks_narrow_to_one' | 'no_actionable_task'
 * @param {object|null} [outcome.promoteError]                execution: the promote failure, if any (not echoed verbatim)
 * @returns {string}
 */
function buildGroundedReply (outcome) {
  const o = outcome || {}

  if (o.type === 'execution_proposal') {
    // The ONLY path that may claim a created proposal — and only with a real id.
    if (o.proposalCreated === true && isNonEmptyString(o.proposalId)) {
      return `我已把它整理成一項待批准的執行提案（編號 ${o.proposalId.trim()}）。尚未執行，也尚未派給任何 Worker；等你批准我才會往下走。`
    }
    // Promote failed / no real id → never claim a proposal exists.
    return '我嘗試把它整理成一項執行提案時遇到問題，目前尚未建立任何提案。你要我再試一次，或換個說法讓我確認一下嗎？'
  }

  // clarification — never claims a proposal; asks to narrow to a single action.
  if (o.clarificationReason === 'multiple_tasks_narrow_to_one') {
    return '我理解你的方向。不過這裡面包含不止一個動作，依規則我一次只把「單一、明確的動作」整理成待批准的提案。請把它收斂成一件事，我就替你整理。目前尚未建立任何提案。'
  }
  // no_actionable_task (or any other/unknown clarification reason) — safe default.
  return '我理解你的意思，但目前還沒有一個明確、可執行的單一動作能整理成提案。你想先聚焦在哪一件事？目前尚未建立任何提案。'
}

module.exports = { buildGroundedReply }
