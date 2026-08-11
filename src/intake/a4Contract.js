'use strict'

/**
 * a4Contract.js — the A4 Universal Knowledge Routing gate and read-argument contract.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT A4-0A IS, AND WHAT IT IS NOT.
 *
 * A4's eventual goal is that Louie never names a tool: he asks, and 香香 decides which
 * information-world holds the answer — MODEL/PROVIDED, PUBLIC, AROMA INTERNAL, or
 * OWNER INTENT (ask). This slice builds NONE of that behaviour.
 *
 * A4-0A builds ONE thing: a proven, end-to-end transport for read ARGUMENTS —
 *
 *     strict schema → parser → distilled.nextRead.args → pending
 *                   → reasoningLoop decision.args → executeRead({capability, args})
 *
 * — because every later A4 stage needs it and none of them can be built safely on a
 * channel that silently drops a field. Nothing consumes these arguments yet. No source
 * selection changes. No public plane exists.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⛔ WHY A DEDICATED GATE, AND WHY NOT TURN_ROUTER.
 *
 * `TURN_ROUTER=off` is NOT an A4 rollback. Its 'off' means PRE-ROUTER behaviour, where reads
 * were ungoverned and a single chat turn could read every enabled source. Rolling A4 back
 * through that flag would WIDEN reads while claiming to be a retreat — the opposite of a
 * rollback. A4 therefore owns its own switch, and turning it off restores exactly today's
 * behaviour and nothing else.
 */

/** off = today's behaviour, byte for byte. shadow/on = the A4 contract is exposed. */
const A4_FLAG = 'A4_KNOWLEDGE_ROUTING'
const A4_STATES = Object.freeze(['off', 'shadow', 'on'])

/**
 * Resolve the gate. FAIL CLOSED: unset, empty and unrecognised all mean 'off'.
 *
 * A typo must never silently enable a contract change, which is the same discipline the
 * source flags use — the difference being that here the safe direction is unambiguous,
 * because 'off' is defined as "what production does today".
 */
function resolveA4 (env = process.env) {
  const raw = env && typeof env[A4_FLAG] === 'string' ? env[A4_FLAG].trim() : ''
  if (raw === '') return 'off'
  if (A4_STATES.includes(raw)) return raw
  console.warn(`[AROMA-HUB] Invalid ${A4_FLAG}="${raw}" — falling back to 'off' (A4 fails closed).`)
  return 'off'
}

/** Is the A4 contract exposed at all? shadow and on both expose the A4-0A argument channel. */
function a4ContractEnabled (env = process.env) {
  return resolveA4(env) !== 'off'
}

/**
 * ⛔ A4-1: DOES SEMANTIC ROUTING GOVERN THIS TURN? ONLY 'on'.
 *
 * `shadow` deliberately does NOT qualify. Shadow's job elsewhere in this codebase is to
 * COMPUTE a decision beside the live one and change nothing — and the only honest way to
 * shadow a semantic routing decision is to ask the model, which is a second paid call on
 * every turn. That is a real cost with no owner yet, so shadow stays at the A4-0A contract
 * exposure and touches no routing. A test asserts the difference rather than a comment
 * promising it.
 */
function a4SemanticRoutingEnabled (env = process.env) {
  return resolveA4(env) === 'on'
}

/**
 * ⛔ MODEL TEXT (governance/textClasses.js, class MODEL). She is TOLD this, and it decides
 * whether she reads at all. Translating it is a behaviour change wearing a translation's
 * clothes — see the class note on this file.
 *
 * ⛔ WHY THIS IS PROSE AND NOT A KEYWORD LIST. The defect A4 exists to fix is that
 * 「食材採購價平均增加 3%」 read purchase orders: a word about a domain was treated as a
 * request for that domain's records. Adding 「採購 unless followed by 價」 would be the same
 * architecture with a longer list. The rule below is about what the QUESTION NEEDS, which is
 * a judgement only the reader of the sentence can make.
 *
 * ⛔ AND IT NEVER NAMES A TOOL TO THE OWNER. The clarification asks which BUSINESS MEANING he
 * wants — 我哋入貨價 vs 外面市場行情 — never which source or operation. He is not the router.
 */
const A4_SEMANTIC_GUIDANCE = `
【判斷次序 —— 順住 1→5 做，唔好一開波就跳去第 5 步】

1｜夠唔夠料答？
Louie 已經喺訊息入面俾晒需要嘅數字或事實，或者呢條係穩定嘅通用知識 → 直接答，nextRead=null。
唔好因為句入面出現業務字眼（成本、採購、供應商、發票、庫存、安排…）就去查。要唔要查，睇嘅係「仲缺乜」，唔係出現咗邊個字。

2｜有冇指明係「我哋」嘅真相？
問嘅係我哋自己嘅紀錄、我哋畀過幾多錢、我哋入過乜、我哋嘅存貨／發票／落單／供應商往績；或者上一轉對話已經鎖定咗係公司內部嘅意思 → 直接揀最合適嗰個內部讀取操作，唔好反問。
例：「我哋上個月電費用咗幾多？」→ 內部，直接讀。

3｜係咪講緊出面世界？
答案取決於外面而家嘅情況 —— 市場行情、同業或地區價格、法規、天氣、匯率、新聞 → 呢個係公開資訊。今日仲未有呢個能力：照直講而家攞唔到，【唔好】攞內部資料頂替，亦【唔好】靠估砌個數出嚟。
例：「而家 Manitoba 最低工資係幾多？」→ 公開。

4｜係咪兩邊都需要？
「我哋嘅數對比出面嘅數」呢一類，係同時需要內部同公開 —— 呢個【唔算】含糊。唔好問佢揀邊邊：內部嗰半照讀，公開嗰半照直講而家比唔到。
例：「我哋租金佔營業額嘅比例，同同區比高唔高？」→ 兩邊都要。

5｜到呢一步先考慮問。
只有喺 1–4 都定唔到、而且兩個或以上嘅解讀都同樣合理、揀錯會令答案完全唔同嘅時候，先至用 mode="ask"、nextRead=null，問【一句】。
例：「而家咖啡豆幾錢？」→ 可以係我哋嘅入貨價，亦可以係市場價，兩者答案唔同 → 問一句。
問嘅時候用生意語言（我哋自己嘅價／出面市場價）。【絕對唔好】叫 Louie 揀工具、來源或者操作名。

⛔ 含糊係最後先剩低嘅結果，唔係起點。
唔好由「呢句理論上仲有冇第二種解法？」開始 —— 要由「Louie 有冇已經講明佢想邊個世界？」開始。
一句嘢只要已經講咗「我哋／我們／Aroma 自己」，就唔再含糊，直接讀。`

/**
 * ⛔ THE CLOSED ARGUMENT SHAPE. Three fields, and the list is meant to be argued with rather
 * than grown by habit.
 *
 * `query` is the only field that could not be derived any other way: for an internal
 * operation the OPERATION is the query, but a public lookup has nothing else to say what is
 * being looked up. `freshness` exists because 「今日天氣」 and 「食品安全條例」 have opposite
 * staleness tolerances and the server cannot infer which. `location` exists because
 * 「Winnipeg 天氣」 is unanswerable without it and inferring the Owner's city server-side
 * would be a guess presented as a fact.
 *
 * ⛔ WHAT IS DELIBERATELY ABSENT, and why the absence is the security property:
 * url · domain · provider · endpoint · method · headers · credentials · result count.
 * The model supplies MEANING. The server supplies MECHANISM. A model that can name a URL
 * has been handed egress; a model that can name a provider has been handed procurement.
 * Neither is a reasoning decision, and neither is on this list.
 *
 * STRICT-MODE SHAPE: every property is in `required`, optionality is a NULL UNION, and
 * additionalProperties is false at every boundary. This is the rule that produced a live
 * HTTP 400 when it was broken twice before; see strictSchemaCompat.test.js.
 */
const READ_ARGS_SCHEMA = Object.freeze({
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['query', 'freshness', 'location'],
  description: '需要向來源說明「要查甚麼」時填寫；內部操作本身已經表達了查甚麼，通常填 null。',
  properties: {
    query: { type: ['string', 'null'], description: '要查嘅內容，用自然語言。冇需要就填 null。' },
    /**
     * ⛔ anyOf, NOT a union type carrying an enum. THIS FIELD TOOK THE CHAT LANE DOWN.
     *
     * It was `type: ['string','null']` with `enum: ['current','recent','any', null]`. OpenAI
     * accepts that. Anthropic's schema validator refuses it outright:
     *
     *   output_config.format.schema: Invalid schema:
     *   Enum value 'current' does not match declared type '['string','null']'
     *
     * The result was HTTP 400 on EVERY Claude chat turn with A4 on — and because the fallback
     * runs openai→claude only, a Claude primary that throws has nothing behind it, so a single
     * malformed field became a total outage rather than a degraded answer.
     *
     * It was never seen because the flag that switches this schema on was committed to the
     * launcher 45 seconds AFTER the running process started, so the live service has been
     * running without it. The next restart would have armed it.
     *
     * anyOf is plain JSON Schema, accepted by both providers, and the accepted values are
     * unchanged. VERIFIED with one real Claude call, not by reasoning about the spec.
     */
    freshness: {
      anyOf: [
        { type: 'string', enum: ['current', 'recent', 'any'] },
        { type: 'null' }
      ],
      description: 'current＝要最新即時資料；recent＝近期即可；any＝時效唔重要。唔確定就填 null。'
    },
    location: { type: ['string', 'null'], description: '地點，例如 Winnipeg。與地點無關就填 null。' }
  }
})

const ARG_KEYS = Object.freeze(['query', 'freshness', 'location'])
const FRESHNESS = Object.freeze(['current', 'recent', 'any'])

/**
 * Admit ONLY the closed shape, from whatever the provider returned.
 *
 * ⛔ THIS IS AN ADMISSION FILTER, NOT A PERMISSION. It decides what SHAPE may travel; it
 * says nothing about whether any capability may be read. That remains
 * intakeService.authorisedSourcesFor() and the allowlist in reasoningLoop.js, exactly as
 * before — a name here is still a request.
 *
 * A fresh object is CONSTRUCTED from known fields rather than the input being sanitised in
 * place, for the same reason parseDistillResponse builds a closed envelope: an unknown key
 * cannot ride along on an object nobody rebuilt. `url`, `provider` and friends are not
 * rejected by a blocklist — they simply have nowhere to go.
 *
 * @returns {object|null} the closed shape, or null when nothing usable was declared
 */
function admitReadArgs (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const query = typeof raw.query === 'string' && raw.query.trim() !== '' ? raw.query : null
  const freshness = FRESHNESS.includes(raw.freshness) ? raw.freshness : null
  const location = typeof raw.location === 'string' && raw.location.trim() !== '' ? raw.location : null
  // All three absent is indistinguishable from 「no arguments」, and null is the honest
  // representation of that — carrying {null,null,null} would make an empty declaration look
  // like a made one.
  if (query === null && freshness === null && location === null) return null
  return { query, freshness, location }
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ EGRESS CONTRACT — RECORDED NOW, ENFORCED WHEN PUBLIC SEARCH IS BUILT.
 *
 * A future PUBLIC read sends its `query` to a third party. An INTERNAL read has already put
 * the restaurant's own data into the turn. Composing the two without a guard means a public
 * search string can carry private business fact out of the building:
 *
 *     internal read  → supplier = Gordon, price = $8.72
 *     public search  → "Gordon Aroma Bistro beef price $8.72"     ⛔ FORBIDDEN
 *
 * That is not a hypothetical shape — it is the natural thing a helpful model would compose,
 * which is exactly why it needs a structural guard rather than a prompt instruction.
 *
 * THE RULE: a public query may contain values the OWNER supplied in his own message, and
 * values the model already knew. It may NOT automatically contain values that arrived from
 * internal evidence this turn, unless the Owner explicitly asked for exactly that.
 *
 * ⛔ NOT WIRED IN A4-0A, AND DELIBERATELY SO. This slice sends nothing anywhere; there is no
 * public capability and no network call, so there is nothing to guard yet. The predicate
 * below exists so the invariant is written down, testable and reviewable BEFORE the stage
 * that could violate it — not so that it can be quietly relied upon now.
 *
 * Whoever builds the public plane: this must be called before the request leaves, and its
 * result must fail the read closed, not merely log.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const EGRESS_CONTRACT = Object.freeze({
  id: 'A4-EGRESS-1',
  rule: 'A PUBLIC read query must not automatically carry values obtained from INTERNAL evidence this turn.',
  enforcedBy: null, // ⛔ null MEANS UNENFORCED. When the public plane ships this names the guard.
  stage: 'A4-2'
})

/**
 * Would this argument bag carry internal evidence out to a third party?
 *
 * PURE, and intentionally simple: exact containment of a retrieved value inside the query
 * string. It is a detector for the contract above, not the guard itself — the guard is the
 * caller that refuses the read, and it does not exist yet.
 *
 * Short values are ignored: a two-character token would match half the language and make the
 * detector useless by crying wolf. The bound is stated rather than tuned.
 */
const MIN_LEAKABLE_CHARS = 3
function wouldLeakInternalEvidence (args, internalValues = []) {
  const q = args && typeof args.query === 'string' ? args.query.toLowerCase() : ''
  if (!q) return false
  for (const v of (Array.isArray(internalValues) ? internalValues : [])) {
    const s = String(v == null ? '' : v).trim().toLowerCase()
    if (s.length < MIN_LEAKABLE_CHARS) continue
    if (q.includes(s)) return true
  }
  return false
}

module.exports = {
  A4_FLAG,
  A4_STATES,
  resolveA4,
  a4ContractEnabled,
  a4SemanticRoutingEnabled,
  A4_SEMANTIC_GUIDANCE,
  READ_ARGS_SCHEMA,
  ARG_KEYS,
  FRESHNESS,
  admitReadArgs,
  EGRESS_CONTRACT,
  wouldLeakInternalEvidence,
  MIN_LEAKABLE_CHARS
}
