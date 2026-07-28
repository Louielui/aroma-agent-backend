'use strict'

/**
 * observation.js — Computer Operator v0, Phase 3b. THE OBSERVATION BOUNDARY.
 *
 * STAGE 1: SCAFFOLD ONLY. Every capability here is false and every request is refused.
 * The structure exists so that Lock 1 can be proven against the real module graph before
 * any capability is written — proving containment after building the thing being contained
 * is how you end up arguing instead of measuring.
 *
 * ── WHY OBSERVATION LIVES HERE AND NOT IN THE COMPANION ───────────────────────
 * The Companion's guarantee in 3a was "it cannot observe and it cannot act", asserted by
 * reading its source for banned tokens. 3b necessarily breaks the first half. Rather than
 * weaken that test into something vaguer, observation is moved behind this one module:
 *
 *   . the Companion keeps EVERY action assertion unchanged — no input synthesis, no file
 *     system, no process spawning, no app launch. Those are still proven by source scan.
 *   . observation tokens move here, where this file's own guard test governs them.
 *
 * The Companion goes from "can do nothing" to "can look, and still can do nothing". The
 * strength of the cannot-act proof is unchanged; see GOV-001 for the line-by-line record.
 *
 * ── LOCK 1: RAW CONTENT STRUCTURALLY CANNOT REACH A MODEL ─────────────────────
 * Not a rule, a shape. Nothing that could carry pixels or UI text is ever RETURNED:
 *
 *   . screenshot bytes    -> written to the evidence store, only a SHA-256 comes back
 *   . UIA node text       -> counted and shaped, never returned as text
 *   . other-session data  -> must not exist at all; if it appears that is a containment
 *                            failure, not a redaction problem
 *
 * A caller therefore cannot put raw observation into a prompt even by mistake, because it
 * never holds any. This module requires NOTHING — no LLM surface, no adapter, no context
 * assembly — and Lock 1's require-graph proof asserts that emptiness stays true.
 */

/**
 * THE CLOSED SET. Observation only. Adding to this list is a capability change and an
 * Owner GO, not an edit — the same shape as the work-order enum.
 */
const OBSERVATION_ACTIONS = Object.freeze(['list_windows', 'read_uia_tree', 'capture_screen'])

/**
 * Actions that must NEVER appear here however the module grows. Input synthesis is the
 * bright line of Phase 3: 3b is read-only, and this list is what a test asserts against.
 */
const FORBIDDEN_ACTIONS = Object.freeze([
  'click', 'double_click', 'right_click', 'type_text', 'send_key', 'key_down', 'key_up',
  'move_mouse', 'drag', 'scroll', 'open_app', 'launch_app', 'close_window', 'focus_window',
  'write_file', 'delete_file', 'set_clipboard'
])

/**
 * Stage 1 capability register: all false. Kept as data, like the Companion's, so the tests,
 * the report and the process answer from one object and cannot drift.
 */
const OBSERVATION_CAPABILITIES = Object.freeze({
  list_windows: false,
  read_uia_tree: false,
  capture_screen: false
})

const NO_CAPABILITY = 'no_capability_enabled'
const OUT_OF_SCOPE = 'action_not_in_observation_set'

/**
 * Fields an observation result may ever expose. Anything not named here cannot be returned,
 * which is what keeps "no raw content" from depending on someone remembering it.
 *
 * `titles` is deliberately present: own-session window titles are permitted in the audit by
 * Owner ruling. Other-session titles are not a redaction case — their presence means
 * isolation failed.
 */
const RESULT_FIELDS = Object.freeze([
  'ok', 'action', 'refusal', 'capability',
  'sessionId', 'windowStation', 'desktop', 'sessionState',
  'evidenceSha256', 'evidenceBytes', 'imageWidth', 'imageHeight',
  'windowCount', 'nodeCount', 'titles', 'at'
])

/**
 * Create an observer. Stage 1 takes no dependencies it could observe through: there is no
 * capture backend, no UIA binding, no window enumerator. Refusal is the only path.
 *
 * @param {{ now?: Function, capabilities?: object }} deps
 */
function createObserver (deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()

  // Capabilities may be narrowed by a caller but never widened beyond the stage-1 register.
  // A harness cannot turn something on that this build does not implement.
  const caps = Object.freeze(Object.assign({}, OBSERVATION_CAPABILITIES))

  /** Answer one observation request. Always a value, never a throw. */
  function observe (request) {
    const action = (request && typeof request.action === 'string') ? request.action : null
    const at = now()

    if (!action || !OBSERVATION_ACTIONS.includes(action)) {
      return { ok: false, action, refusal: OUT_OF_SCOPE, at }
    }
    if (!caps[action]) {
      return { ok: false, action, refusal: NO_CAPABILITY, capability: action, at }
    }
    // Unreachable in stage 1 by construction: no capability is true. Left explicit rather
    // than absent so the refusal path is the default and an implementation has to be added
    // deliberately rather than fallen into.
    return { ok: false, action, refusal: NO_CAPABILITY, capability: action, at }
  }

  return {
    observe,
    capabilities: caps,
    actions: OBSERVATION_ACTIONS
  }
}

/** Is any observation capability enabled in this build? Stage 1: must be false. */
function anyObservationEnabled () {
  return Object.values(OBSERVATION_CAPABILITIES).some(Boolean)
}

module.exports = {
  createObserver,
  anyObservationEnabled,
  OBSERVATION_ACTIONS,
  FORBIDDEN_ACTIONS,
  OBSERVATION_CAPABILITIES,
  RESULT_FIELDS,
  NO_CAPABILITY,
  OUT_OF_SCOPE
}
