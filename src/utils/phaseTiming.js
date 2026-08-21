'use strict'

/**
 * phaseTiming.js — WHERE DID THE TURN SPEND ITS TIME? Measurement only.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE GAP THIS CLOSES. The 2026-08-21 07:59 greeting took 15,226 ms server-side.
 * The logs could prove only three of those numbers: the main model call (6,345 ms),
 * the final-obligation gate (2,889 ms) and the total. The largest single block —
 * 5,958 ms before the main model call, 39% of the turn — was unattributable, because
 * the goal decomposer ran a model call that logged an outcome and no duration, and
 * prompt construction was never timed at all. A forensic that can only subtract is a
 * forensic that cannot say which change would help.
 *
 * ⛔ MEASUREMENT ONLY. Nothing here decides, skips, caches, routes or shortens
 * anything. A phase that is slow keeps being slow; this only makes it sayable.
 *
 * ⛔ MONOTONIC, NOT WALL CLOCK. Durations come from `performance.now()`, which cannot
 * run backwards when the system clock is adjusted. A wall-clock timestamp rides along
 * for correlation with the existing [AROMA-*] lines and is never used for arithmetic.
 *
 * ⛔ THE PRIVACY FENCE IS STRUCTURAL, NOT A RULE. `emitPhase` copies an ALLOWLIST of
 * fields and drops everything else, so a future caller cannot leak a prompt, a reply,
 * a row or a path through this module by forgetting a convention. A fence made of
 * remembering is not a fence — this repository has written that lesson down twice
 * already (workOrder.js, projectRegistry.js) and it applies here too.
 *
 * ⛔ NOT A SECOND TELEMETRY FRAMEWORK. It emits one `[AROMA-LATENCY]` line through
 * `console.log`, exactly like every other emitter in src/intake/, and lives beside
 * metricsLogger.js / intakeOutcomeLog.js / readContextLog.js.
 *
 * ⛔ NEVER LOAD-BEARING. Every entry point swallows its own errors: telemetry that can
 * break a turn is worse than no telemetry.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { performance } = require('node:perf_hooks')

/**
 * Closed phase vocabulary. A phase name that is not here is refused rather than
 * logged, so the set stays countable and a typo cannot silently create a new phase.
 */
const PHASE = Object.freeze({
  PROMPT_BUILD: 'prompt_build',
  DECISION_RECALL: 'decision_recall',
  CONVERSATION_RECALL: 'conversation_recall',
  LIVE_READ_CONTEXT: 'live_read_context',
  MODEL_CALL: 'model_call'
})
const PHASES = Object.freeze(Object.values(PHASE))

/**
 * Closed model-call roles. This is what makes MODEL_CALL_COUNT countable from
 * telemetry without parsing prose: count `model_call` records, group by role.
 */
const ROLE = Object.freeze({
  GOAL_DECOMPOSER: 'goal_decomposer',
  MAIN: 'main',
  FINAL_VERIFIER: 'final_verifier',
  REASONING_STEP: 'reasoning_step',
  RESERVED_COMPOSE: 'reserved_compose'
})
const ROLES = Object.freeze(Object.values(ROLE))

/** Closed outcomes. Never an error message — a provider error can carry prompt text. */
const OUTCOME = Object.freeze({ OK: 'ok', ERROR: 'error' })

/**
 * ⛔ THE ALLOWLIST IS THE FENCE. Only these keys can ever reach the log line.
 * `within` names the CONTAINING phase, so a reader summing durations can see which
 * records are nested and must not be added to their container — see PHASE_CONTAINMENT.
 */
const ALLOWED = Object.freeze([
  'requestId', 'event', 'phase', 'durationMs', 'within',
  'role', 'provider', 'model', 'attempt', 'outcome', 'timestamp'
])

/**
 * Which phases run INSIDE which. Documented as data so the accounting rule is
 * checkable by a test rather than remembered by a reader:
 *
 *   prompt_build  ⊇  decision_recall, conversation_recall, live_read_context,
 *                    model_call(role=goal_decomposer)
 *
 * SERVER_TOTAL is NOT the sum of every record. It is:
 *   prompt_build + model_call(main) + final-obligation + un-instrumented remainder.
 */
const PHASE_CONTAINMENT = Object.freeze({
  [PHASE.DECISION_RECALL]: PHASE.PROMPT_BUILD,
  [PHASE.CONVERSATION_RECALL]: PHASE.PROMPT_BUILD,
  [PHASE.LIVE_READ_CONTEXT]: PHASE.PROMPT_BUILD
})

/** Monotonic reading. Exposed so tests can inject a deterministic clock. */
function nowMs (clock) {
  return typeof clock === 'function' ? clock() : performance.now()
}

/**
 * Emit ONE latency record. Returns the emitted object (or null) so tests can assert
 * the exact shape rather than scraping stdout.
 *
 * @param {object} fields  only ALLOWED keys survive; everything else is dropped
 * @param {function} [sink]  injectable for tests; defaults to console.log
 */
function emitPhase (fields = {}, sink) {
  try {
    const phase = fields && fields.phase
    if (!PHASES.includes(phase)) return null
    if (!Number.isFinite(fields.durationMs)) return null

    const rec = { requestId: fields.requestId || null, event: 'PHASE_TIMING', phase }
    // Rounded to whole milliseconds: sub-millisecond precision is noise at this scale
    // and a long float in a log line is harder to read than the number it approximates.
    rec.durationMs = Math.max(0, Math.round(fields.durationMs))

    for (const key of ALLOWED) {
      if (key in rec) continue
      const v = fields[key]
      if (v === undefined || v === null) continue
      // Only primitives. An object could carry anything, including everything.
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue
      if (key === 'role' && !ROLES.includes(v)) continue
      if (key === 'within' && !PHASES.includes(v)) continue
      if (key === 'outcome' && v !== OUTCOME.OK && v !== OUTCOME.ERROR) continue
      rec[key] = v
    }
    if (typeof rec.timestamp !== 'string') rec.timestamp = new Date().toISOString()

    const out = typeof sink === 'function' ? sink : (line, body) => console.log(line, body)
    out('[AROMA-LATENCY]', JSON.stringify(rec))
    return rec
  } catch (_) {
    return null // telemetry is never load-bearing
  }
}

/**
 * Time an async function and emit one record for it. The awaited value is returned
 * untouched and a thrown error is RETHROWN unchanged — the caller's control flow is
 * identical with or without this wrapper, which is what makes L1 measurement-only.
 *
 * A failed attempt is still timed: 「it was slow and then it failed」 and 「it failed
 * instantly」 are different facts and the second one is not the default.
 */
async function timePhase (fields, fn, opts = {}) {
  const clock = opts.clock
  const sink = opts.sink
  const started = nowMs(clock)
  try {
    const value = await fn()
    emitPhase(Object.assign({}, fields, { durationMs: nowMs(clock) - started, outcome: OUTCOME.OK }), sink)
    return value
  } catch (err) {
    emitPhase(Object.assign({}, fields, { durationMs: nowMs(clock) - started, outcome: OUTCOME.ERROR }), sink)
    throw err
  }
}

/** Synchronous twin, for phases that do no I/O (the two recall builders). */
function timePhaseSync (fields, fn, opts = {}) {
  const clock = opts.clock
  const sink = opts.sink
  const started = nowMs(clock)
  try {
    const value = fn()
    emitPhase(Object.assign({}, fields, { durationMs: nowMs(clock) - started, outcome: OUTCOME.OK }), sink)
    return value
  } catch (err) {
    emitPhase(Object.assign({}, fields, { durationMs: nowMs(clock) - started, outcome: OUTCOME.ERROR }), sink)
    throw err
  }
}

/** A bare stopwatch, for callers that must own their own emit (e.g. adding durationMs
 *  to an existing [AROMA-GOAL] line as well as emitting a model_call record). */
function startTimer (clock) {
  const started = nowMs(clock)
  return () => nowMs(clock) - started
}

module.exports = {
  PHASE, PHASES, ROLE, ROLES, OUTCOME, ALLOWED, PHASE_CONTAINMENT,
  emitPhase, timePhase, timePhaseSync, startTimer, nowMs
}
