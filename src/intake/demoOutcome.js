'use strict'

/**
 * demoOutcome.js — B2-2 Xiang Xiang Conversation Demo (thin slice 1).
 *
 * Pure, additive mapping from the EXISTING distill classifier output
 * ({ mode, intent } — see src/intake/distillPrompt.js, the B1-1a Intent Gate)
 * onto the four demo outcomes the first Xiang Xiang conversation must
 * distinguish:
 *
 *   speech | context | clarification | execution_proposal
 *
 * This does NOT classify text and does NOT call any reasoning model — it only
 * maps an already-distilled { mode, intent } onto a demo outcome. No new Intent
 * Gate is introduced; distillPrompt.js remains the sole classifier. Nothing here
 * is wired into a route yet — it is an inert library until a later slice consumes
 * it behind the CONVERSATION_DEMO flag (default OFF).
 *
 * Fail-safe: any unrecognised / missing input maps to 'speech' — the least-
 * privileged, conversation-only outcome. The mapping NEVER escalates unknown or
 * malformed input to 'execution_proposal'.
 */

const OUTCOMES = Object.freeze({
  SPEECH: 'speech',
  CONTEXT: 'context',
  CLARIFICATION: 'clarification',
  EXECUTION_PROPOSAL: 'execution_proposal'
})

// distill modes  (src/intake/distillPrompt.js): chat | recommend | ask | commit
// distill intents include the carve-out label 'context' — distillPrompt forces
// intent:"context" into mode:"chat" and forbids task creation, so the pair
// { mode:'commit', intent:'context' } is not producible by the classifier.

/**
 * Map a distilled classifier result to a demo outcome.
 *
 * @param {{mode?: string, intent?: string}} distilled  the distill classifier output
 * @returns {{outcome: string}} exactly one of OUTCOMES values
 *
 * Precedence (first match wins) — chosen so a genuine execute/clarify signal is
 * never masked, and unknown input degrades to conversation:
 *   1. mode === 'commit'   → execution_proposal
 *   2. mode === 'ask'      → clarification
 *   3. intent === 'context'→ context
 *   4. otherwise           → speech
 */
function classifyDemoOutcome (distilled) {
  const mode = distilled && typeof distilled.mode === 'string' ? distilled.mode : ''
  const intent = distilled && typeof distilled.intent === 'string' ? distilled.intent : ''

  if (mode === 'commit') return { outcome: OUTCOMES.EXECUTION_PROPOSAL }
  if (mode === 'ask') return { outcome: OUTCOMES.CLARIFICATION }
  if (intent === 'context') return { outcome: OUTCOMES.CONTEXT }
  return { outcome: OUTCOMES.SPEECH }
}

module.exports = { classifyDemoOutcome, OUTCOMES }
