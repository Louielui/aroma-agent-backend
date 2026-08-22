'use strict'

/**
 * worldAskDecision.js — should an `ambiguous` verdict actually stop the turn and ask?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED ON THE B CANARY, bootCommit 052761bc, real UI path:
 *
 *   「現在缺貨最嚴重的是什麼？」
 *   [AROMA-TURN-ROUTE]   route:BUSINESS_QUERY reason:intent_inventory domain:inventory
 *                        routerSources:["aroma_system"]
 *   [AROMA-GOAL]         facts:2 unavailable:0        ← B could serve both
 *   [AROMA-SOURCE-INTENT] outcome:"ambiguous"
 *   [AROMA-REASONING]    step 1 decisionType:final stopReason:"before_read"
 *   reply                「你想我睇我哋自己嘅實際情況，定係外面公開嘅情況？」
 *
 * The deterministic router had already identified an inventory query against `aroma_system`.
 * B had already declared two required facts, both servable. **The gate then asked him which
 * world he meant, and ended the turn before any read.**
 *
 * > **Owner: enough context plus an available capability means ACT; genuinely missing
 * > information means ASK.**
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ WHAT CHANGED IS THE GATE'S POSITION, NOT THE RESOLVER ────────────────
 *
 * `ownerSourceIntentResolver` is untouched, and its own rule stands: it is deliberately NOT
 * told what the system can reach, because 「what he means」 and 「what we can currently reach」
 * are different questions and mixing them lets availability decide meaning.
 *
 * That rule is about the RESOLVER. This is the CALLER, deciding what to do with a verdict it
 * has already received. The resolver still resolves meaning from his words alone; what is new
 * is that an 「I cannot tell」 no longer automatically outranks a deterministic classification
 * that was made before the resolver ever ran.
 *
 * ⛔ SO THE GATE NO LONGER SITS UPSTREAM OF CAPABILITY RESOLUTION. It used to convert
 * `ambiguous` into a terminal ASK with no reference to the route or to what was reachable.
 * It now receives both, and only raises the question when neither settles it.
 *
 * ── WHAT IT NOW KNOWS THAT IT DID NOT ──────────────────────────────────────
 *   · `route` / `routerSources` — the deterministic classification, computed before the model
 *   · `authorisedSources`       — what this turn may actually reach
 *
 * ── ⛔ AND WHAT IT WILL STILL ASK ABOUT ────────────────────────────────────
 * A turn the router did not positively classify. 「有冇平啲嘅供應商？」 with no established
 * entity is genuinely open, and the clarification path is narrowed, not deleted.
 */

/** ⛔ Sources that ARE the Owner's own operation. A public source can never establish internal. */
const INTERNAL_SOURCES = Object.freeze(['aroma_system'])

const ASK_REASON = Object.freeze({
  /** The resolver reached a real verdict; this decision has no business interfering. */
  RESOLVER_SETTLED: 'resolver_settled',
  /** Positively routed to an internal business entity AND the source is reachable. */
  ROUTE_ESTABLISHED_INTERNAL: 'route_established_internal_and_capability_available',
  /** Routed internal, but the named source is not authorised — the world is not the problem. */
  CAPABILITY_UNAVAILABLE: 'capability_unavailable',
  /** Nothing established it. This is what the clarification exists for. */
  GENUINELY_AMBIGUOUS: 'genuinely_ambiguous',
  /**
   * ⛔ X2 — THE GOAL HAS NO INTERNAL/PUBLIC DIMENSION, so there is nothing to clarify.
   * Distinct from RESOLVER_SETTLED on purpose: settled means 「he meant internal」; this means
   * 「that is not a property of this question」. Neither obliges a world, and the difference
   * has to be readable in a log.
   */
  WORLD_NOT_APPLICABLE: 'world_not_applicable_to_goal'
})

/**
 * @param {object} input
 * @param {string} input.resolverIntent    internal | public | mixed | ambiguous
 * @param {string} input.route             the deterministic route for this turn
 * @param {string[]} input.routerSources   sources the route named
 * @param {string[]} input.authorisedSources what this turn may actually reach
 * @returns {{ask:boolean, requiredWorlds:object|null, reason:string}}
 */
function decideWorldAsk (input) {
  const i = (input && typeof input === 'object') ? input : {}
  const routerSources = Array.isArray(i.routerSources) ? i.routerSources : []
  const authorised = Array.isArray(i.authorisedSources) ? i.authorisedSources : []

  /**
   * ⛔ X2 — ASKED AND ANSWERED BEFORE 「ambiguous」 IS EVEN CONSIDERED.
   *
   * Production 7b0699ce: route CONVERSATION, resolver `ambiguous`, so this returned ask:true
   * and the caller replaced a twelve-second Opus answer with 「internal or public?」 on a turn
   * about designing Xiangxiang's own interface. The resolver was not wrong — its vocabulary
   * had no way to say the question HAS no world — and this gate had no way to hear it. Both
   * halves are repaired: the vocabulary gained `not_applicable`, and this reads it.
   *
   * ⛔ IT GRANTS NOTHING. `requiredWorlds: null` is the same 「no obligation」 every other
   * non-asking branch returns. No source opens, no read is skipped, no verifier is bypassed.
   */
  if (i.resolverIntent === 'not_applicable') {
    return { ask: false, requiredWorlds: null, reason: ASK_REASON.WORLD_NOT_APPLICABLE }
  }

  /**
   * ⛔ ONLY A RECOGNISED VERDICT COUNTS AS SETTLED, and the first version got this wrong.
   *
   * It tested `!== 'ambiguous'`, so `undefined`, `null` and any garbage took the
   * 「resolver settled it」 branch — the caller would then proceed as though a verdict existed
   * when none did. Caught by the rubbish-input test. An unrecognised value is not an answer,
   * and the safe direction here is the QUESTION: defaulting to 「go internal and read」 on
   * malformed input would read his data on a turn nobody established anything about.
   */
  const SETTLED = ['internal', 'public', 'mixed']
  if (SETTLED.includes(i.resolverIntent)) {
    return { ask: false, requiredWorlds: null, reason: ASK_REASON.RESOLVER_SETTLED }
  }

  /**
   * ⛔ ONLY A POSITIVE CLASSIFICATION COUNTS. `CONVERSATION` with reason 'default' means the
   * router matched NOTHING, which is not evidence about the world — it is the absence of any.
   * Treating it as internal would read his data on a turn nobody established anything about.
   */
  const namedInternal = routerSources.filter((s) => INTERNAL_SOURCES.includes(s))
  if (i.route !== 'BUSINESS_QUERY' || namedInternal.length === 0) {
    return { ask: true, requiredWorlds: null, reason: ASK_REASON.GENUINELY_AMBIGUOUS }
  }

  /**
   * ⛔ ROUTED INTERNAL BUT UNREACHABLE — AND THE ANSWER IS STILL NOT A QUESTION ABOUT WORLDS.
   * If the source is not authorised this turn, asking 「internal or public?」 would be asking
   * him to resolve something that is not what is missing. No obligation is raised, the turn
   * reads nothing, and the read-state guards keep the reply honest about that.
   */
  const reachable = namedInternal.some((s) => authorised.includes(s))
  if (!reachable) {
    return { ask: false, requiredWorlds: null, reason: ASK_REASON.CAPABILITY_UNAVAILABLE }
  }

  // Established by the router, and reachable. Act.
  return {
    ask: false,
    requiredWorlds: { internal: true, public: false },
    reason: ASK_REASON.ROUTE_ESTABLISHED_INTERNAL
  }
}

module.exports = { decideWorldAsk, ASK_REASON, INTERNAL_SOURCES }
