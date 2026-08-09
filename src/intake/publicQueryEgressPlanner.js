'use strict'

/**
 * publicQueryEgressPlanner.js — who is allowed to author a string that leaves the building.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE PROBLEM THIS SOLVES, AND WHY THE PREVIOUS ANSWER WAS NOT ONE.
 *
 * A4-2A made A4-EGRESS-1 real by BLOCKING: if the main model's proposed public query
 * contained a value retrieved from internal evidence this turn, the read was refused. That is
 * correct and it is also a dead end, because the natural MIXED question —
 *
 *     「Aroma 實際牛肉成本升幅同市場相比合理嗎？」
 *
 * — requires reading internal evidence FIRST and then searching the outside world. The main
 * model, having just read 「Beef Brisket / Gordon / 8.72」, composes 「beef brisket wholesale
 * market price」 because that is the helpful thing to do. The guard fires on `beef brisket`,
 * the public read never happens, and the Owner gets half an answer. Measured: three query
 * phrasings, two blocked, and the blocking was RIGHT each time.
 *
 * The defect was never the guard. It was asking a model that has already seen internal
 * evidence to author the string that leaves — and then inspecting the string for
 * contamination. Inspection cannot win that argument: paraphrase, translation, an implied
 * product line, a supplier's city, a distinctive quantity. A substring check catches the
 * literal 「Gordon」 and misses 「our Winnipeg beef supplier's July increase」.
 *
 * ⛔ THE OWNER'S RULING, AND IT IS STRUCTURAL RATHER THAN DETECTIVE:
 *
 * > **「If PUBLIC is requested AFTER INTERNAL evidence has been read, the raw main-model
 * > public query is UNTRUSTED and MUST NOT leave the process. Instead generate the public
 * > search args from OWNER-AUTHORED context only.」**
 *
 * So the contaminated author is REPLACED, not audited. This module authors the query from a
 * context that has never contained internal evidence, which makes contamination impossible
 * rather than undetected. The main model's proposed query is discarded unread.
 *
 * ⛔ WHAT THIS IS NOT. It does not decide WHETHER to search — the main model still requests
 * the read, the allowlist still authorises it, the ambiguity gate still runs. It decides only
 * WHAT WORDS may leave, and it is reached solely on the public path.
 *
 * ── PROVIDER NEUTRALITY IS STRUCTURAL ────────────────────────────────────────
 * No adapter, no router, no connector is imported here. This module is handed a `plan`
 * closure and never learns what is behind it — the same seam reasoningLoop.js and
 * sourceAmbiguityGate.js use, and a static test greps this file for provider tokens.
 *
 * ── AND IT FAILS CLOSED, WITHOUT EXCEPTION ───────────────────────────────────
 * Missing planner, throw, timeout, malformed JSON, empty query, no Owner context — every one
 * of them means NO PUBLIC READ. It NEVER falls back to the main model's query, because that
 * fallback is the exact thing the ruling forbids, and a fail-open here would be silent: the
 * search would succeed and look normal.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { READ_ARGS_SCHEMA, admitReadArgs } = require('./a4Contract')

/**
 * ⛔ AN ALLOWLIST, AND THE DEFAULT IS DELIBERATELY INVERTED FROM buildDistillPrompt.
 *
 * distillPrompt.js attributes an unknown or missing role to the OWNER, on purpose and with a
 * test pinning it: for building HER prompt, mislabelling her words as his costs a little
 * context, while mislabelling his as hers caused a real defect (historyAttribution.test.js).
 *
 * HERE THE SAFE DIRECTION IS THE OPPOSITE ONE. Her turns are exactly where internal evidence
 * has been spoken aloud — a reply that says 「Gordon 嘅牛腩 8.72」 is assistant text, and
 * inheriting that default would feed the leak straight into the planner through the one input
 * it is allowed to have. So an entry counts as Owner-authored ONLY if it says so explicitly.
 * Assistant, unknown, missing, malformed: all excluded, all silently.
 */
const OWNER_ROLES = Object.freeze(['user'])

/**
 * The bound on what the planner may see. Stated, not tuned: four preceding Owner messages is
 * enough for 「同上面嗰個比」 to resolve, and a cap on characters means a long pasted document
 * cannot turn the planner's context into a second evidence channel.
 */
const MAX_OWNER_MESSAGES = 4
const MAX_MESSAGE_CHARS = 400
const MAX_TOTAL_CHARS = 1200
const MAX_QUERY_CHARS = 200

/**
 * ⛔ THE COMPLETE LIST OF WHAT THE PLANNER MAY SEE — one array, and the Owner wrote it.
 *
 * Everything absent is absent BY CONSTRUCTION, not by filtering: this function receives only
 * `message` and `history` and has no reference to anything else. There is no evidence
 * parameter to forget to strip. Recorded here so a future caller adding a fifth argument has
 * to argue with this comment first.
 *
 * NOT VISIBLE: assistant messages · system/persona · the Conversation Contract · internal
 * evidence · EvidenceSets · turnItems · observations · supplier names, prices, product titles,
 * IDs or codes learned internally · the raw main-model proposed public query · capability,
 * readKey or tool details · memory / Decision Recall · connector results.
 *
 * @returns {string[]} oldest to newest, the current message last. Empty when he authored none.
 */
function ownerAuthoredContext (message, history) {
  const out = []
  let total = 0
  const push = (raw) => {
    const s = typeof raw === 'string' ? raw.trim().slice(0, MAX_MESSAGE_CHARS) : ''
    if (!s) return
    if (total + s.length > MAX_TOTAL_CHARS) return
    total += s.length
    out.push(s)
  }

  const prior = []
  for (const h of (Array.isArray(history) ? history : [])) {
    // ⛔ EXPLICIT ROLE ONLY. See OWNER_ROLES.
    if (!h || typeof h !== 'object') continue
    if (!OWNER_ROLES.includes(h.role)) continue
    prior.push(h.text)
  }
  // Newest-first while trimming to the bound, then restored to reading order — so when the
  // character cap bites it drops the OLDEST message, not the most relevant one.
  for (const t of prior.slice(-MAX_OWNER_MESSAGES)) push(t)
  push(message)
  return out
}

/**
 * ⛔ MODEL TEXT (governance/textClasses.js, class MODEL). She is told this.
 *
 * Narrow on purpose. It describes ONE job — turn what Louie asked into a public search — and
 * forbids the two failure modes that matter: inventing specifics he never said, and naming
 * the restaurant. It contains no business domain and no sentence from any canary, because
 * canary messages are holdout data and putting one here would make the test a rehearsal.
 *
 * It cannot be prompted into leaking, because the leak is not in its context to begin with.
 * This text is a quality control, not a security control — the security is structural.
 */
const PLANNER_SYSTEM = `你嘅工作只有一個：將 Louie 想知嘅嘢，變成一句可以拎去出面公開搜尋嘅說話。

你會見到嘅，只係 Louie 自己打過嘅說話。冇其他嘢。

規則：
- 只可以用 Louie 自己講過嘅字。佢冇講過嘅牌子、供應商、價錢、產品名、編號，一律唔准加。
- 唔准提 Aroma、唔准提呢間餐廳、唔准提任何餐廳名。
- 出面搜尋要問嘅係「行情、市價、大市趨勢」嗰種公開資料，唔係我哋自己嘅數。
- 唔確定就寫闊啲、一般啲，唔好靠估寫窄。
- 唔好答佢個問題，唔好解釋你點諗。
- freshness：要最新行情填 current；近期可以填 recent；時效唔重要填 any；唔確定填 null。
- location：Louie 講過地方先填，否則 null。`

/**
 * ⛔ THE SAME THREE FIELDS — DERIVED, NOT RETYPED — WITH A NON-NULLABLE ROOT.
 *
 * The first cut of this was `PLANNER_SCHEMA = READ_ARGS_SCHEMA`, with a test asserting the
 * identity and a comment congratulating it for not being a rival lookalike. A live call
 * returned HTTP 400.
 *
 * READ_ARGS_SCHEMA is `type: ['object','null']` because as a NESTED field it must be able to
 * say 「no arguments」 — for an internal operation, the operation IS the query, so null is the
 * honest value. As a ROOT structured-output schema a nullable union is invalid: strict mode
 * requires the root to be an object. The two roles genuinely differ, and reusing one object
 * for both was wrong in a way that reads as discipline.
 *
 * So `properties` and `required` are TAKEN FROM the existing contract — they cannot drift,
 * and a field added there arrives here — while the root type is pinned to a plain object. A
 * planner returning 「no query」 is not a valid plan anyway; that case is a refusal, not a null.
 *
 * ⛔ AND ONLY A LIVE CALL COULD HAVE FOUND THIS. Every deterministic test injects a fake
 * planner, so the schema was never handed to a provider. The canary is not ceremony.
 *
 * No `reason`, `rationale` or `confidence` field, for the same reason the ambiguity verifier
 * has none — an explanation field is chain-of-thought wearing a respectable name.
 */
const PLANNER_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: READ_ARGS_SCHEMA.required,
  properties: READ_ARGS_SCHEMA.properties
})

/** Why no query left. Enums, never text. */
const OUTCOME = Object.freeze({
  PLANNED: 'planned',
  REUSED: 'reused',
  NO_PLANNER: 'no_planner',
  NO_OWNER_CONTEXT: 'no_owner_context',
  FAILED: 'failed',
  UNUSABLE: 'unusable'
})

const refuse = (outcome) => ({ ok: false, args: null, outcome })

/**
 * Author a safe public query from Owner-authored context only.
 *
 * PURE apart from the injected `plan` call.
 *
 * @param {object} input
 * @param {function} input.plan       injected completion seam ({ownerMessages, system, schema}) => args
 * @param {string}   input.message    the current Owner message
 * @param {object[]} input.history    conversation history; only role:'user' entries are read
 * @returns {Promise<{ok:boolean, args:object|null, outcome:string}>}
 */
async function planPublicQuery (input = {}) {
  const plan = typeof input.plan === 'function' ? input.plan : null
  // ⛔ NO PLANNER, NO READ. Reaching the public path without one wired must not silently fall
  // through to the main model's query — that is the failure where a control exists on paper
  // and passes everything, and here it would pass exactly the contaminated string.
  if (!plan) return refuse(OUTCOME.NO_PLANNER)

  const ownerMessages = ownerAuthoredContext(input.message, input.history)
  // He authored nothing this turn — there is no safe author available, so nothing leaves.
  if (!ownerMessages.length) return refuse(OUTCOME.NO_OWNER_CONTEXT)

  let raw
  try {
    raw = await plan({ ownerMessages: ownerMessages.slice(), system: PLANNER_SYSTEM, schema: PLANNER_SCHEMA })
  } catch (_) {
    // The thrown message is DISCARDED. An upstream error can carry the prompt back with it,
    // and this is the one path where that prompt is the thing being protected.
    return refuse(OUTCOME.FAILED)
  }

  let obj = raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return refuse(OUTCOME.UNUSABLE)
    try { obj = JSON.parse(s) } catch (_) {
      const m = /\{[\s\S]*\}/.exec(s)
      if (!m) return refuse(OUTCOME.UNUSABLE)
      try { obj = JSON.parse(m[0]) } catch (_) { return refuse(OUTCOME.UNUSABLE) }
    }
  }

  // ⛔ THE EXISTING ADMISSION FILTER, REUSED. It constructs a fresh object from known fields,
  // so `url`, `provider` and friends have nowhere to be written to — the planner cannot widen
  // the egress surface even if it tried to.
  const args = admitReadArgs(obj)
  if (!args) return refuse(OUTCOME.UNUSABLE)
  // A plan with no query is not a plan. `admitReadArgs` accepts freshness-only bags because a
  // future internal caller might mean something by one; a public SEARCH with nothing to search
  // for is empty, and empty fails closed like everything else here.
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) return refuse(OUTCOME.UNUSABLE)

  return { ok: true, args: { query: query.slice(0, MAX_QUERY_CHARS), freshness: args.freshness, location: args.location }, outcome: OUTCOME.PLANNED }
}

/**
 * ⛔ ONE SAFE PLAN PER OWNER CONTEXT PER TURN.
 *
 * The main model may request PUBLIC more than once inside the bounded loop. The Owner context
 * does not change between those requests, so re-planning would spend a second paid call to
 * re-derive the same string — and, worse, could derive a DIFFERENT one, making the executor's
 * dedupe (which keys on canonical args) miss a repeat it should have caught.
 *
 * Keyed on the Owner context itself rather than on 「the turn」, so the cache is correct by
 * construction: same input, same plan. Turn-scoped — the caller constructs one per turn and
 * drops it, so nothing persists between Owners, conversations or requests.
 */
function createTurnPlanCache () {
  const byContext = new Map()
  return {
    async get (input = {}) {
      const key = JSON.stringify(ownerAuthoredContext(input.message, input.history))
      if (byContext.has(key)) {
        const hit = byContext.get(key)
        // A refusal is cached too. A planner that failed once must not be re-asked three times
        // inside one bounded loop, and 「it failed」 is as stable a fact as 「it planned」.
        return Object.assign({}, hit, { outcome: hit.ok ? OUTCOME.REUSED : hit.outcome })
      }
      const result = await planPublicQuery(input)
      byContext.set(key, result)
      return result
    },
    get size () { return byContext.size }
  }
}

/**
 * One content-free line. Counts and enums only — never the Owner's message, never the planned
 * query, never a business value. `ownerMessageCount` is a number, and a number cannot carry a
 * supplier name.
 */
function logEgressPlan (entry, sink) {
  const line = {
    event: 'A4_PUBLIC_QUERY_PLAN',
    timestamp: new Date().toISOString(),
    requestId: entry && entry.requestId != null ? String(entry.requestId) : null,
    outcome: entry && Object.values(OUTCOME).includes(entry.outcome) ? entry.outcome : OUTCOME.FAILED,
    // Did the raw main-model query get discarded? The whole ruling in one boolean.
    rawQueryDiscarded: entry ? entry.rawQueryDiscarded === true : false,
    ownerMessageCount: Number.isFinite(entry && entry.ownerMessageCount) ? entry.ownerMessageCount : 0,
    durationMs: Number.isFinite(entry && entry.durationMs) ? entry.durationMs : null
  }
  try { (sink || ((l) => console.log('[AROMA-EGRESS-PLAN]', JSON.stringify(l))))(line) } catch (_) {}
  return line
}

module.exports = {
  OWNER_ROLES,
  MAX_OWNER_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_TOTAL_CHARS,
  MAX_QUERY_CHARS,
  PLANNER_SYSTEM,
  PLANNER_SCHEMA,
  OUTCOME,
  ownerAuthoredContext,
  planPublicQuery,
  createTurnPlanCache,
  logEgressPlan
}
