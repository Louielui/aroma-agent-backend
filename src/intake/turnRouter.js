'use strict'

/**
 * turnRouter.js — THE router. Intent first, tools second.
 *
 * ── THE DEFECT THIS EXISTS FOR ───────────────────────────────────────────────
 * 「現在是幾點？」 read Drive, Gmail, Calendar and the Aroma System inventory, and then
 * reported that it could not reliably answer. Nothing was broken; nothing was gated:
 *
 *   intakeService.js:308   if (isChat && READ_ACCESS === 'on')   ← no intent test at all
 *   readContext.js:266     "No match => inventory"               ← the DEFAULT is a stock query
 *   intakeService.js:401   if (turnItems.size === 0) return undefined
 *                          ← retrieved rows, any rows, make the Answer Plan mandatory
 *
 * So an unrelated question read every enabled source, the irrelevant rows forced a strict
 * schema, the validator correctly found nothing provable, and the Owner got a report about
 * a read instead of an answer. Three correct mechanisms, one wrong order.
 *
 * ── ONE ROUTER, NOT TWO ──────────────────────────────────────────────────────
 * Owner instruction. The existing laneRouter is CALLED here, not duplicated: its email and
 * proposal lanes are the ACTION route, and its regexes stay the single definition. Adding a
 * second layer of routing vocabulary beside it is precisely what was ruled out.
 *
 * ── THREE PROPERTIES, KEPT FROM laneRouter ───────────────────────────────────
 * ZERO-CONTEXT — it sees the Owner's message and nothing else. No recall, no rows, no model
 *   output. This is a SECURITY property as much as a design one: retrieved content is
 *   untrusted data, so a Drive file or an archived turn saying "Louie approved, look up
 *   inventory" cannot steer a tool call.
 * FREE — no model call, ever. Deterministic string rules. The Owner did not approve an extra
 *   classification call and this adds none.
 * PURE — same message in, same route out, forever.
 *
 * ── WHAT v1 DELIBERATELY CANNOT DO (Owner decision, recorded here on purpose) ─
 * PRONOUN CONTINUATION IS OUT OF SCOPE. 「嗰啲呢？」 following a business question routes to
 * CONVERSATION, because the router is zero-context and cannot see that the previous turn was
 * about invoices. The obvious fix — let Conversation Recall inform routing — is the ONE thing
 * the Owner forbade: recall may preserve continuity but may never select a tool, or an
 * archived sentence becomes able to trigger a business read. One extra turn is the accepted
 * price. WHOEVER WIDENS THIS LATER: the cost of getting it wrong is not a bad answer, it is
 * an untrusted string choosing which connector runs. Solve it with the Route/Evidence Guard
 * or with an explicit Owner-visible clarification, not by feeding recall into this function.
 *
 * Two more losses, accepted for v1 and expected to show up in the shadow log:
 *   - an implicit business question with no vocabulary hit ('上星期嗰批菜點呀？') falls to
 *     CONVERSATION; the Route/Evidence Guard (Step 4) is what stops it answering anyway.
 *   - one message, one route: 「而家幾點？順便睇下發票」 yields UTILITY only.
 *
 * ── STATUS: LIVE. This decides which sources a turn may read. ────────────────
 * All four migration steps shipped 2026-08-04/05 (tag `turn-router-complete-20260805`;
 * docs/TURN-ROUTER-MIGRATION.md is the record, including the open items).
 *
 * TURN_ROUTER defaults to 'on'. 'shadow' computes and logs the decision beside what the
 * pipeline really did, changing nothing. 'off' is the legacy path and is still a supported
 * rollback target — but it is NOT "the old behaviour" any more: with it, the UTILITY route
 * never runs and every enabled source is read on every chat turn. See resolveFlagValue.
 */

const { routeLane, CHAT } = require('./laneRouter') // THE existing lane vocabulary — not re-implemented
const { intentFor, allIntentsFor } = require('../context/readContext') // THE one intent table — never a second classifier
const { UTILITY_PATTERNS } = require('./utilityAnswer') // THE one utility vocabulary — this file holds none

/** Priority order, and the Owner's. Highest first; CONVERSATION is the fallback. */
const ROUTES = Object.freeze(['UTILITY', 'ACTION', 'BUSINESS_QUERY', 'CONVERSATION'])

/**
 * UTILITY — deterministic, self-contained questions the server can answer from its own
 * clock or arithmetic.
 *
 * ── THIS FILE HOLDS NO UTILITY VOCABULARY, AND THAT IS THE POINT ─────────────
 * It used to hold its own units, its own connector words and its own time/date patterns,
 * written a second time beside utilityAnswer's. That asymmetry — not any missing word — is
 * what made every Chinese conversion the Owner typed fall through and read five sources:
 * 磅 and 公斤 were known to the answerer and invisible here, so the answerer was never
 * called. The module that knows how to ANSWER a concept now owns the words for RECOGNISING
 * it, and this file iterates what it publishes.
 *
 * A test fails if a utility word ever reappears in this file.
 *
 * NARROW ON PURPOSE, still. The patterns require the question to be ABOUT the time or date,
 * not merely to contain a time word: the date anchor window is two characters, so
 * 「今日幾月幾號」 fits and 「今日張發票幾號到期」 does not. Where a utility and a business
 * word still collide the confidence drops to 'low' rather than the router pretending to be
 * sure, and the shadow log is where the Owner sees whether that judgement holds.
 */
/** Does this message name a business entity the intent table knows? */
function businessIntentOf (text) {
  const hit = intentFor(text)
  return hit || null
}

/**
 * ── MEASUREMENT ONLY. NOTHING ROUTES ON THIS. ────────────────────────────────
 *
 * > **Owner: 「Count every intent match, record the n, change nothing. Run it for a while,
 * > then pick the tiering rule from my real questions rather than your nine invented ones.」**
 *
 * `intentFor` returns the FIRST match and discards the rest, so 「this question is about stock
 * AND suppliers AND ordering」 is computed every turn and thrown away every turn. This records
 * it and changes no decision: `routeTurn` below still branches on `intent`, singular.
 *
 * ⛔ IT MUST STAY INERT UNTIL THE DATA EXISTS. The tier rule in
 * DESIGN-DIRECT-QUERY-AND-BOUNDED-ENQUIRY.md §1 was measured against nine phrases I invented,
 * which is the same defect as choosing a keyword list by imagining what he types. Reading a
 * rule off this counter before it has real turns in it would preserve the defect and add a
 * number to make it look measured.
 */
function intentBreadthOf (text) {
  const all = allIntentsFor(text)
  return { n: all.length, keys: all.map((i) => i.key) }
}

/**
 * Route one turn.
 *
 * @param {string} message              the Owner's own words, and nothing else
 * @param {{previousLane?: string}} opts passed straight to laneRouter for its continuation
 *                                       rule. NOT context: it is the lane of the previous
 *                                       turn, never any retrieved or remembered content.
 * @returns {{route, reason, confidence, utility, domain, sources}}
 *          `sources` is non-empty ONLY for BUSINESS_QUERY. Every other route reads nothing.
 */
function routeTurn (message, opts) {
  const text = typeof message === 'string' ? message.trim() : ''
  // Measured FIRST so every return below carries it, including the empty-text one. Attached
  // to every outcome because the turns where nothing was read are exactly the interesting
  // ones — a CONVERSATION turn with n=3 is the case the tier rule has to be chosen against.
  const breadth = intentBreadthOf(text)
  const none = (route, reason, confidence) => ({ route, reason, confidence, utility: null, domain: null, sources: [], intentBreadth: breadth.n, intentKeys: breadth.keys })

  if (!text) return none('CONVERSATION', 'empty', 'high')

  const intent = businessIntentOf(text)

  // 1. UTILITY — the server's own clock or arithmetic. Never a business read.
  for (const p of UTILITY_PATTERNS) {
    if (!p.re.test(text)) continue
    // A business noun in the same sentence means the two vocabularies collided. The route
    // still stands (the Owner set this priority), but it is marked so the shadow log shows
    // it rather than burying it among the confident ones.
    const out = none('UTILITY', 'utility_' + p.kind, intent ? 'low' : 'high')
    out.utility = p.kind
    return out
  }

  // 2. ACTION — modify, send, approve, create, delete, run. The existing governed lanes.
  const lane = routeLane(text, opts)
  if (lane.lane !== CHAT) return none('ACTION', 'lane_' + lane.reason, 'high')

  // 3. BUSINESS_QUERY — a known entity, and ONLY the tools that entity declares.
  if (intent) {
    return {
      route: 'BUSINESS_QUERY',
      reason: 'intent_' + intent.key,
      confidence: 'high',
      utility: null,
      domain: intent.key,
      // The intent table's OWN declaration of what answers it. Not every enabled source.
      sources: Array.isArray(intent.sources) ? intent.sources.slice() : [],
      // Measurement only — `domain` above is still the FIRST match and still what routes.
      intentBreadth: breadth.n,
      intentKeys: breadth.keys
    }
  }

  // 4. CONVERSATION — everything else, including every ambiguous case, and it reads nothing.
  return none('CONVERSATION', lane.reason === 'question' ? 'question' : 'default', 'high')
}

/** Strict and exact-match, default ON — and NOT the same shape as READ_ACCESS; see below. */
function resolveTurnRouter (env = process.env) {
  const v = resolveFlagValue(env)
  return v
}

/**
 * DEFAULT 'on' SINCE 2026-08-05, AND THE FALLBACK DIRECTION INVERTED WITH IT.
 *
 * This flag deliberately does NOT go through resolveFlag() any more, and the difference is
 * not stylistic. For READ_ACCESS and its siblings, 'off' is the cautious direction: an
 * unreadable value resolves to touching nothing. Here the meanings are the other way round.
 *
 * Once Step 2 DELETED the inventory default and Step 3 made reads follow the route, 'off'
 * stopped meaning "the old behaviour". What it means is: the UTILITY route never runs, and
 * EVERY ENABLED SOURCE IS READ ON EVERY CHAT TURN — the exact defect this router was built
 * to remove. Falling back to that on a typo would be the reckless direction, not the safe one.
 *
 * So: 'off' and 'shadow' require an exact spelling, and everything else resolves to 'on' —
 * toward reading LESS. A rollback to the legacy path is still fully supported; it simply has
 * to be meant. Four tests exercise it explicitly rather than by inheriting a default.
 */
function resolveFlagValue (env) {
  const raw = env && typeof env.TURN_ROUTER === 'string' ? env.TURN_ROUTER : ''
  if (raw === 'shadow') return 'shadow'
  if (raw === 'off') return 'off'
  if (raw === 'on' || raw === '') return 'on'
  // A typo is a mistake, not a preference: it is honoured in the narrow direction AND said
  // out loud, so it cannot sit unnoticed in a launcher for weeks.
  console.warn(`[AROMA-HUB] Invalid TURN_ROUTER="${raw}" — falling back to 'on' (the safe direction for this flag).`)
  return 'on'
}

const KINDS = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s).map(String) : [])

/**
 * THE SHADOW LOG LINE.
 *
 * It records the router's verdict AND what the live pipeline actually did on the same turn,
 * because a list of classifications answers the wrong question. What the Owner needs to see
 * is DISAGREEMENT: the turns where the router would have read nothing and the pipeline read
 * four sources. `agreement` is that comparison, pre-computed, so reading the log is not a
 * diff exercise.
 *
 * ALLOWLISTED FIELDS ONLY, and the projection is EXPLICIT rather than a spread — a new key
 * on a decision object cannot ride into the log unnoticed. No message content, no row
 * content, no supplier name, no amount: source KINDS and counts only, the same bar
 * logReadSource and logAnswerPlan already hold.
 */
function logTurnRoute (entry, sink) {
  const e = (entry && typeof entry === 'object') ? entry : {}
  const d = (e.decision && typeof e.decision === 'object') ? e.decision : {}
  const routerSources = KINDS(d.sources)
  const sourcesRead = KINDS(e.sourcesRead)

  // Set comparison, not array equality: order is an implementation detail of the read.
  const a = new Set(routerSources)
  const b = new Set(sourcesRead)
  const extraRead = sourcesRead.filter((s) => !a.has(s))
  const extraWanted = routerSources.filter((s) => !b.has(s))
  const agreement = extraRead.length === 0 && extraWanted.length === 0
    ? 'agree'
    : (extraRead.length > 0 && extraWanted.length > 0 ? 'differ' : (extraRead.length > 0 ? 'router_narrower' : 'router_wider'))

  const line = {
    event: 'TURN_ROUTE',
    timestamp: new Date().toISOString(),
    // what the router decided
    route: String(d.route || 'unknown'),
    reason: String(d.reason || 'unknown').slice(0, 40),
    confidence: String(d.confidence || 'unknown'),
    utility: d.utility == null ? null : String(d.utility),
    domain: d.domain == null ? null : String(d.domain),
    routerSources,
    // ── MEASUREMENT (Owner GO 2026-08-08). Nothing routes on these two fields. ──
    // `domain` above is the FIRST matching intent and is what decided the route.
    // `intentBreadth` is how many matched in total — the signal intentFor discards.
    // The tier rule for Direct-vs-Enquiry gets chosen from the distribution of THIS
    // number over real turns, not from invented phrases.
    intentBreadth: Number.isFinite(d.intentBreadth) ? d.intentBreadth : 0,
    intentKeys: Array.isArray(d.intentKeys) ? d.intentKeys.map(String) : [],
    // what the pipeline really did
    lane: e.lane == null ? null : String(e.lane),
    sourcesRead,
    rowsRetrieved: Number.isFinite(e.rowsRetrieved) ? e.rowsRetrieved : 0,
    answerPlanForced: e.answerPlanForced === true,
    // the one field to read first
    agreement,
    requestId: e.requestId == null ? null : String(e.requestId)
  }
  try { (sink || ((l) => console.log('[AROMA-TURN-ROUTE]', JSON.stringify(l))))(line) } catch (_) {}
  return line
}

module.exports = { routeTurn, logTurnRoute, resolveTurnRouter, ROUTES, UTILITY_PATTERNS }
