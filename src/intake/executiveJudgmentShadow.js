'use strict'

/**
 * executiveJudgmentShadow.js — C1-A. DID THE SYSTEM ALLOW AN ANSWER AND GET A QUESTION?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ IT IS AN OBSERVER, AND IN C1-A NOTHING READS ITS ANSWER. It is not a gate, not a
 * router, not a knowledge authority, not an ask authority. It cannot change a reply, a
 * mode, a read, a proposal or a model call. It exists so that C1-B can be argued from
 * measured turns instead of from this file's own guess.
 *
 * ⛔ WHY IT EXISTS. Conversation 2f42f099 (2026-08-21, requestIds 513cf96c / f6d39840 /
 * 9403aab5): on three consecutive turns the final verifier returned `allow_final` — the
 * system's own conclusion that nothing needed to be looked up — and the main model still
 * returned a question as the whole answer. The greeting turn in the same conversation
 * (ab8d023f) did not. Three for three against nought for one is a clean enough split to
 * measure, and far too small a sample to act on.
 *
 * ⛔ WHAT THE SIGNAL MEANS, EXACTLY. `candidateJudgmentGap` says ONE thing:
 *
 *     the system believed a final answer was allowable, and the model asked instead.
 *
 * It does NOT say the question was wrong. `allow_final` is a knowledge verdict, not an
 * Owner-intent verdict — a model asking which of two things the Owner would PREFER is
 * asking something no amount of reading could answer, and that turn is a candidate too.
 * Separating the legitimate case from the defect is the observation review's job, on real
 * turns, later. The word CANDIDATE is doing real work here; do not quietly drop it.
 *
 * ⛔ NECESSITY IS OBSERVATION DATA AND CARRIES NO QUESTION-AUTHORITY. The goal plan's
 * `required` means "cannot be ANSWERED without reading this". It does NOT mean "the Owner
 * must be asked before anything useful can be said" — conflating those two is the very
 * confusion C0 found, and re-encoding it here would build the bug into the instrument.
 * The counts below are reported and nothing more.
 *
 * ⛔ PURE. No I/O, no model, no clock, no env, no history, no message, no reply. The same
 * structured inputs always give the same answer.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ⛔ EVERY VOCABULARY BELOW IS COPIED FROM ITS OWNER MODULE, NOT INVENTED HERE, and it is
 * copied rather than imported so that this observer can never drag a behavioural module
 * into its dependency graph. The test asserts these against the real exports, so a change
 * at the source fails loudly here instead of silently mislabelling telemetry.
 */

/** finalKnowledgeRequirement.js DECISION */
const FINAL_DECISION = Object.freeze([
  'allow_final', 'clarify', 'require_internal', 'require_public', 'require_mixed'
])

/** distillPrompt.js MODES */
const MODE = Object.freeze(['commit', 'recommend', 'ask', 'chat'])

/** askForkTrace.js ASK_ORIGIN */
const ASK_ORIGIN = Object.freeze([
  'none', 'final_obligation_clarify', 'world_ask_ambiguous', 'model_initial_ask'
])

/** turnRouter.js ROUTES */
const ROUTE = Object.freeze(['UTILITY', 'ACTION', 'BUSINESS_QUERY', 'CONVERSATION'])

/** goalPlanContract.js STATUS */
const STATUS = Object.freeze({ AVAILABLE: 'AVAILABLE', PARTIAL: 'PARTIAL', UNAVAILABLE: 'UNAVAILABLE' })

/** goalPlanContract.js necessity */
const NECESSITY = Object.freeze({ REQUIRED: 'required', ENRICHING: 'enriching' })

/**
 * ⛔ ONE WORD FOR "WE COULD NOT READ IT", and it is not a value any owner module produces.
 * A malformed input must be visibly malformed in the log rather than silently becoming a
 * plausible enum member — a telemetry line that guesses is worse than one that admits.
 */
const UNKNOWN = 'unknown'

const EVENT = 'EXECUTIVE_JUDGMENT_SHADOW'

/** The two conditions that together define the candidate. Named so the test can pin them. */
const GAP_DECISION = 'allow_final'
const GAP_MODE = 'ask'

function oneOf (list, v) {
  return (typeof v === 'string' && list.includes(v)) ? v : UNKNOWN
}

/**
 * Counts only. Never a `need`, an operation, an entity, a field name or a business value.
 *
 * ⛔ NULL WHEN THERE WAS NO PLAN, NEVER ZERO. A turn where the decomposer never ran and a
 * turn where it ran and found nothing are different facts, and 0 would merge them — which
 * is exactly the kind of collapse that made the 07:59 latency forensic impossible.
 */
function factCounts (goalPlan) {
  const facts = (goalPlan && Array.isArray(goalPlan.facts)) ? goalPlan.facts : null
  if (!facts) {
    return {
      requiredFacts: null,
      enrichingFacts: null,
      requiredUnavailableFacts: null,
      requiredPartialFacts: null,
      enrichingUnavailableFacts: null,
      factsWithOperation: null,
      factsWithoutOperation: null
    }
  }
  let required = 0
  let enriching = 0
  let requiredUnavailable = 0
  let requiredPartial = 0
  let enrichingUnavailable = 0
  let withOperation = 0
  let withoutOperation = 0
  for (const f of facts) {
    if (!f || typeof f !== 'object') continue
    // judgeFact already normalised necessity, and it fail-closes an unknown value to
    // `required`. That normalisation is deliberately NOT repeated or second-guessed here.
    const isRequired = f.necessity === NECESSITY.REQUIRED
    const isEnriching = f.necessity === NECESSITY.ENRICHING
    if (isRequired) required++
    if (isEnriching) enriching++
    if (isRequired && f.status === STATUS.UNAVAILABLE) requiredUnavailable++
    if (isRequired && f.status === STATUS.PARTIAL) requiredPartial++
    if (isEnriching && f.status === STATUS.UNAVAILABLE) enrichingUnavailable++
    if (f.operation) withOperation++
    else withoutOperation++
  }
  return {
    requiredFacts: required,
    enrichingFacts: enriching,
    requiredUnavailableFacts: requiredUnavailable,
    requiredPartialFacts: requiredPartial,
    enrichingUnavailableFacts: enrichingUnavailable,
    factsWithOperation: withOperation,
    factsWithoutOperation: withoutOperation
  }
}

/**
 * @param {object} input
 *   finalDecision {string}  the verifier's ALREADY-COMPUTED decision
 *   mode          {string}  the main model's ALREADY-PARSED mode
 *   goalPlan      {object}  the ALREADY-JUDGED plan, or null — never re-decomposed here
 *   askOrigin     {string}  the ALREADY-COMPUTED fork origin
 *   route         {string}  the ALREADY-COMPUTED route
 * @returns {object} closed observation record; no prose, no confidence, no free text
 */
function classifyExecutiveJudgmentShadow (input) {
  try {
    const i = (input && typeof input === 'object') ? input : {}
    const finalDecision = oneOf(FINAL_DECISION, i.finalDecision)
    const mode = oneOf(MODE, i.mode)

    // ⛔ FAIL-CLOSED TO "NOT A CANDIDATE". A candidate is a CLAIM about a turn, and a claim
    //    built on a value we could not read is not evidence of anything.
    const candidateJudgmentGap = finalDecision === GAP_DECISION && mode === GAP_MODE

    return Object.assign({
      finalDecision,
      mode,
      candidateJudgmentGap
    }, factCounts(i.goalPlan), {
      askOrigin: oneOf(ASK_ORIGIN, i.askOrigin),
      route: oneOf(ROUTE, i.route)
    })
  } catch (_) {
    // Nothing here may fail open, and nothing here may fail the turn.
    return Object.assign({
      finalDecision: UNKNOWN,
      mode: UNKNOWN,
      candidateJudgmentGap: false
    }, factCounts(null), { askOrigin: UNKNOWN, route: UNKNOWN })
  }
}

/**
 * ⛔ THE ALLOWLIST IS THE SHAPE, not a review step someone remembers to do. `emit` copies
 * these keys and no others, so a field added to the classifier cannot reach the log until
 * it is added here on purpose.
 */
const ALLOWED = Object.freeze([
  'requestId', 'event',
  'finalDecision', 'mode', 'candidateJudgmentGap',
  'requiredFacts', 'enrichingFacts', 'requiredUnavailableFacts',
  'requiredPartialFacts', 'enrichingUnavailableFacts',
  'factsWithOperation', 'factsWithoutOperation',
  'askOrigin', 'route', 'shadow', 'timestamp'
])

/**
 * One line per measured turn. Telemetry is never load-bearing: this returns nothing and
 * throws nothing, so no caller can branch on whether it worked.
 */
function emitExecutiveJudgmentShadow (requestId, observation, sink) {
  try {
    const src = Object.assign({}, observation || {}, {
      requestId: typeof requestId === 'string' ? requestId : null,
      event: EVENT,
      shadow: true,
      timestamp: new Date().toISOString()
    })
    const out = {}
    for (const k of ALLOWED) if (k in src) out[k] = src[k]
    const write = typeof sink === 'function' ? sink : (line, payload) => console.log(line, payload)
    write('[AROMA-JUDGMENT]', JSON.stringify(out))
  } catch (_) { /* telemetry is never load-bearing */ }
}

module.exports = {
  classifyExecutiveJudgmentShadow,
  emitExecutiveJudgmentShadow,
  ALLOWED,
  EVENT,
  UNKNOWN,
  FINAL_DECISION,
  MODE,
  ASK_ORIGIN,
  ROUTE,
  GAP_DECISION,
  GAP_MODE
}
