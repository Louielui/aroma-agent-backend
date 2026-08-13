'use strict'

/**
 * askForkTrace.js — make the ASK fork visible. OBSERVABILITY ONLY, no control flow.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS EXISTS. On 2026-08-12 two turns, 116 seconds apart, same process, same commit
 * (`b0af2f4`), same Owner sentence and the SAME route (BUSINESS_QUERY / intent_inventory /
 * aroma_system) ended differently: one read the business data and answered, the other shipped
 * a clarifying question having read nothing. See `docs/evidence/2026-08-12-ask-fork.md`.
 *
 * The log could not say where they diverged, because the branch point emitted nothing. A path
 * existed that nobody had enumerated — so the fix is not a better guess, it is a record.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⛔ CLOSED ENUMS, NOT SANITISED STRINGS.
 *
 * The existing log-content fence (`src/governance/logContent.test.js`) walks every production
 * file and reads each console call's own arguments, so these lines are covered the moment they
 * are written — but it matches FIELD NAMES it already knows (`reply:`, `content:`, `body:`).
 * A new field with a new name would pass it. So content is excluded here by VALUE, not by
 * name: every string field is checked against a fixed set and anything unrecognised becomes
 * `'other'`. A message body cannot be logged through this module even by mistake, because
 * there is no field whose value survives being unrecognised.
 */

/** Where in the turn the observation was taken. */
const STAGE = Object.freeze({
  INITIAL_FINAL_GATE: 'initial_final_gate',
  SOURCE_INTENT: 'source_intent',
  WORLD_ASK: 'world_ask',
  LOOP_ENTRY: 'loop_entry'
})

/**
 * The branch actually taken. ⛔ These are the enumerated pre-reasoning exits — the list this
 * whole branch exists to make explicit. Adding an exit without adding a value here shows up as
 * `'other'` in the log, which is the loudest thing an unenumerated path can do.
 */
const BRANCH = Object.freeze({
  GATE_ENTERED: 'gate_entered',
  GATE_SKIPPED_READ_PROPOSED: 'gate_skipped_read_proposed',
  GATE_SKIPPED_NOT_ELIGIBLE: 'gate_skipped_not_eligible',
  VERDICT_UNUSABLE: 'verdict_unusable',
  VERDICT_CLARIFY: 'verdict_clarify',
  VERDICT_ALLOW_FINAL: 'verdict_allow_final',
  VERDICT_REQUIRE: 'verdict_require',
  RESOLVER_ASK: 'resolver_ask',
  RESOLVER_OBLIGATION: 'resolver_obligation',
  RESOLVER_UNREACHABLE: 'resolver_unreachable',
  RESOLVER_REQUIRED_FALLTHROUGH: 'resolver_required_fallthrough',
  LOOP_ENTERED: 'loop_entered',
  LOOP_SKIPPED: 'loop_skipped'
})

/** Which mechanism produced a terminal question, if one did. */
const ASK_ORIGIN = Object.freeze({
  NONE: 'none',
  FINAL_OBLIGATION_CLARIFY: 'final_obligation_clarify',
  WORLD_ASK_AMBIGUOUS: 'world_ask_ambiguous',
  MODEL_INITIAL_ASK: 'model_initial_ask'
})

const ROUTES = new Set(['BUSINESS_QUERY', 'PUBLIC_QUERY', 'MIXED_QUERY', 'SYSTEM_QUERY', 'GENERAL', 'PROPOSAL', 'COMMAND'])
const INTENTS = new Set(['internal', 'public', 'mixed', 'ambiguous', 'unknown'])
const SOURCE_CLASSES = new Set(['internal_only', 'public_only', 'both', 'none'])

const OTHER = 'other'

function pick (set, v) {
  return (typeof v === 'string' && set.has(v)) ? v : (v == null ? null : OTHER)
}

function pickFrom (obj, v) {
  for (const k of Object.keys(obj)) { if (obj[k] === v) return v }
  return v == null ? null : OTHER
}

/**
 * ⛔ A requestId IS A CORRELATION HANDLE, AND NOTHING ELSE MAY WEAR ITS CLOTHES.
 * Shape-checked rather than trusted: if a caller ever passes something that is not an id, it is
 * dropped instead of printed. Text arriving here would otherwise be text in the log.
 */
function idOnly (v) {
  return (typeof v === 'string' && /^[0-9a-fA-F-]{8,64}$/.test(v)) ? v : null
}

/** Derive the source class from an authorised-source list. Counts, never names of content. */
function sourceClassOf (sources) {
  if (!Array.isArray(sources)) return null
  const internal = sources.some((s) => String(s) === 'aroma_system')
  const pub = sources.some((s) => String(s) === 'public_knowledge')
  if (internal && pub) return 'both'
  if (internal) return 'internal_only'
  if (pub) return 'public_only'
  return 'none'
}

/**
 * Build ONE trace line. Pure — returns the object, logs nothing, decides nothing.
 * Every field is an id, an enum or a boolean. There is no free-text field.
 */
function forkLine (input = {}) {
  const i = input || {}
  return {
    requestId: idOnly(i.requestId),
    event: 'ASK_FORK',
    stage: pickFrom(STAGE, i.stage),
    branch: pickFrom(BRANCH, i.branch),
    askOrigin: pickFrom(ASK_ORIGIN, i.askOrigin == null ? ASK_ORIGIN.NONE : i.askOrigin),
    reasoningEntered: i.reasoningEntered === true,
    shortCircuit: i.shortCircuit === true,
    route: pick(ROUTES, i.route),
    intent: pick(INTENTS, i.intent),
    sourceClass: pick(SOURCE_CLASSES, i.sourceClass)
  }
}

/**
 * ⛔ TELEMETRY MUST NEVER BREAK A TURN, AND MUST NEVER CHANGE ONE.
 * Returns nothing. Callers must not branch on it — there is nothing to branch on.
 */
function logAskFork (input, sink) {
  let line
  try { line = forkLine(input) } catch (_) { return }
  try {
    (sink || ((l) => console.log('[AROMA-ASK-FORK]', JSON.stringify(l))))(line)
  } catch (_) { /* a logger that throws is still not a reason to fail a turn */ }
}

module.exports = { STAGE, BRANCH, ASK_ORIGIN, forkLine, logAskFork, sourceClassOf }
