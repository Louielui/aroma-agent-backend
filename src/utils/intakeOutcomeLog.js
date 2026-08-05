'use strict'

/**
 * intakeOutcomeLog.js — ONE line per intake request, whatever happens.
 *
 * WHY: previously only *errors* produced a diagnostic line, so a request that arrived
 * and failed early (validation, guard, adapter acquisition, an unhandled throw) was
 * completely invisible — a real failure could leave no trace at all. This closes that
 * hole: success, handled failure and early failure all emit exactly one record.
 *
 * SAFETY — ALLOWLIST BY CONSTRUCTION. The entry is built field by field from a fixed
 * list of NUMBERS and SHORT ENUMS. The input object is never spread and unknown keys
 * are dropped, so a future caller cannot accidentally widen it. It can therefore never
 * contain the prompt, the system prompt, the user's message, the model's output,
 * retrieved source content, or any credential — the same discipline as the existing
 * parse diagnostics (see intakeDiagnostics.js).
 */

const FIELDS = Object.freeze([
  'correlationId', // uuid minted server-side
  'endpoint', // fixed route string
  'interactionMode', // 'chat' | 'proposal' | 'email_draft' | null
  'provider', // 'claude' | 'openai' | null
  'outcome', // 'success' | 'handled_error' | 'early_error' | 'validation_rejected' | 'guard_rejected'
  'httpStatus', // number
  'latencyMs', // number (whole request)
  'inputTokens', // number | null
  'outputTokens', // number | null
  'stopReason', // short provider enum | null  (recorded on SUCCESS too — near-miss visibility)
  'parseResult', // 'ok' | 'failed' | null
  'parseErrorReason', // short enum | null
  'fallbackUsed', // boolean | null
  'errorCode', // short enum | null — never a message
  // Unified Conversation v1. The Owner no longer picks a lane, so the log must record
  // which one the router chose and WHY — otherwise a mis-routed turn is invisible.
  'lane', // 'chat' | 'proposal' | 'email_draft' — the lane actually used
  'laneReason', // short enum: 'explicit' | 'write_act' | 'change_act' | 'question' | 'capability_question' | 'default' | 'empty'
  // ── THE CLASSIFIER'S OWN VERDICT — added 2026-08-05 ──────────────────────────────
  // A work-order card needs six links: router → mode==='commit' → exactly one task → the
  // task persists → promoteToProposal → the card. Only the FIRST had a log line, so when
  // an explicit change request produced no card, the model's verdict had to be inferred
  // from a reply string and an output-token count. The router logs its decision; the
  // classifier now logs its own.
  'mode', // 'commit' | 'recommend' | 'ask' | 'chat' — what the MODEL returned
  'clarificationReason', // short enum: 'not_a_commit_intent' | 'multiple_tasks_narrow_to_one' | 'no_actionable_task'
  'modeCoerced', // boolean — the model sent a value we do not recognise; see distillPrompt
  // ── THE DETERMINISTIC ENTRANCE — added 2026-08-05 ───────────────────────────────
  // The offer fired correctly, reached the browser, and was discarded by a client
  // ordering defect — and it logged nothing either way, so finding that took reasoning
  // about the code rather than reading a line. The classifier logs its verdict; so does
  // the offer now.
  'workRequestOffer', // boolean — did an offer travel with this turn
  'offerDeclined' // short enum — which check declined it, when one did
])

const NUMERIC = new Set(['httpStatus', 'latencyMs', 'inputTokens', 'outputTokens'])
// `modeCoerced` is a BOOLEAN on purpose. The raw string the model sent is model output, and
// the discipline above is that this record can never contain model output. Whether it was
// recognised is a fact about our parser; what it said goes to console.warn instead.
const BOOLEAN = new Set(['fallbackUsed', 'modeCoerced', 'workRequestOffer'])
const MAX_ENUM_CHARS = 64 // a short enum can never smuggle content

function project (input) {
  const src = (input && typeof input === 'object') ? input : {}
  const out = { event: 'INTAKE_OUTCOME', timestamp: new Date().toISOString() }
  for (const key of FIELDS) {
    const v = src[key]
    if (v === undefined || v === null) { out[key] = null; continue }
    if (NUMERIC.has(key)) { out[key] = Number.isFinite(v) ? v : null; continue }
    if (BOOLEAN.has(key)) { out[key] = (v === true); continue }
    // everything else is a SHORT string enum; anything longer is dropped, never truncated
    // into the log (truncated content is still content).
    out[key] = (typeof v === 'string' && v.length > 0 && v.length <= MAX_ENUM_CHARS) ? v : null
  }
  return out
}

function defaultSink (entry) {
  try { console.log('[AROMA-INTAKE-OUTCOME]', JSON.stringify(entry)) } catch (_) {}
}

/**
 * Emit exactly one outcome line. Never throws — an observability failure must never
 * become a response failure.
 * @param {object} input  fields from the FIELDS allowlist; everything else is ignored
 * @param {{ sink?: (entry:object)=>void }} [deps]
 */
function logIntakeOutcome (input, deps = {}) {
  const sink = (deps && typeof deps.sink === 'function') ? deps.sink : defaultSink
  let entry
  try { entry = project(input) } catch (_) { return null }
  try { sink(entry) } catch (_) { /* swallow */ }
  return entry
}

module.exports = { logIntakeOutcome, project, FIELDS }
