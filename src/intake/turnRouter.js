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
 * ── STATUS: SHADOW. This decides NOTHING yet. ────────────────────────────────
 * TURN_ROUTER defaults to 'off'. At 'shadow' the decision is computed and logged beside what
 * the pipeline really did, and no read, schema or reply changes. Steps 2-4 each need their
 * own Owner GO.
 */

const { routeLane, CHAT } = require('./laneRouter') // THE existing lane vocabulary — not re-implemented
const { intentFor } = require('../context/readContext') // THE one intent table — never a second classifier
const { resolveFlag } = require('../context/flags')

/** Priority order, and the Owner's. Highest first; CONVERSATION is the fallback. */
const ROUTES = Object.freeze(['UTILITY', 'ACTION', 'BUSINESS_QUERY', 'CONVERSATION'])

/**
 * UTILITY — deterministic, self-contained questions the server can answer from its own
 * clock or arithmetic.
 *
 * NARROW ON PURPOSE. The patterns require the question to be ABOUT the time or date, not
 * merely to contain a time word. A bare 幾號 would swallow 「發票幾號到期？」, which is a
 * business question; anchoring on 現在/而家/今日/今天 keeps the two apart. Where they still
 * collide the confidence drops to 'low' (see below) rather than the router pretending to
 * be sure — and the shadow log is where the Owner will see whether that judgement holds.
 */
const UTILITY_PATTERNS = Object.freeze([
  // 係 AND 是. The very question the Owner reported — 「現在是幾點？」 — used the written
  // form, and the first draft of this table only had the Cantonese one, so it missed the
  // one turn it was written for. Every pattern here accepts both copulas for that reason.
  { kind: 'time', re: /(?:而家|依家|家陣|現在|目前|宜家)\s*(?:係|是)?\s*幾(?:多)?點|幾點鐘|\bwhat(?:'s| is) the time\b|\bwhat time is it\b|\bcurrent time\b|現在時間|目前時間/i },
  { kind: 'date', re: /(?:今日|今天)\s*(?:係|是)?\s*(?:幾號|幾多號|星期幾|禮拜幾|咩日子|什麼日子)|\bwhat(?:'s| is) (?:the |today'?s )?date\b|\btoday'?s date\b|今日日期|今天日期/i },
  // A bare arithmetic expression: '12*34', '1,200 + 340'. Requires an operator between two
  // numbers, so a date, a version and an invoice number are all untouched.
  { kind: 'calc', re: /(?:^|[\s（(])\d[\d,.]*\s*[+\-*/×÷]\s*\d[\d,.]*(?:\s*[+\-*/×÷]\s*\d[\d,.]*)*\s*(?:=|\s*$|[?？])/ },
  { kind: 'convert', re: /(\d[\d,.]*\s*(?:kg|g|lb|lbs|oz|ml|l|L|磅|公斤|克|安士|毫升|公升)\b.{0,12}(?:等於|換算|轉|=|\bto\b|\bin\b))|換算|單位轉換/i }
])

/** Does this message name a business entity the intent table knows? */
function businessIntentOf (text) {
  const hit = intentFor(text)
  return hit || null
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
  const none = (route, reason, confidence) => ({ route, reason, confidence, utility: null, domain: null, sources: [] })

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
      sources: Array.isArray(intent.sources) ? intent.sources.slice() : []
    }
  }

  // 4. CONVERSATION — everything else, including every ambiguous case, and it reads nothing.
  return none('CONVERSATION', lane.reason === 'question' ? 'question' : 'default', 'high')
}

/** Strict, fail-closed, default off. Same shape as READ_ACCESS / DECISION_RECALL. */
function resolveTurnRouter (env = process.env) {
  const v = resolveFlagValue(env)
  return v
}

function resolveFlagValue (env) {
  const raw = env && typeof env.TURN_ROUTER === 'string' ? env.TURN_ROUTER : ''
  if (raw === 'shadow') return 'shadow'
  // 'on' and 'off' reuse the existing strict resolver so this flag cannot drift from the
  // others in what it accepts.
  return resolveFlag({ TURN_ROUTER: raw }, 'TURN_ROUTER') === 'on' ? 'on' : 'off'
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
