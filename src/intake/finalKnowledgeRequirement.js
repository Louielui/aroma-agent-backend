'use strict'

/**
 * finalKnowledgeRequirement.js — may this turn be ANSWERED without retrieving anything?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE FAILURE THIS EXISTS FOR: SHE DENIES A CAPABILITY SHE HAS.
 *
 * Three live turns failed identically. Asked for outside-world information, the main model at
 * LOW proposed NO read at all and answered that it could not obtain external data — while
 * `public_knowledge.search` was sitting in the authorised operation enum it had just been
 * handed. Verified directly: the capability WAS offered; it declined and then reported the
 * decline as an inability.
 *
 * The worst case was the continuation 「兩邊都睇。」 — because no read was proposed, the whole
 * MIX1 chain never engaged. Every guard built so far hangs off the model proposing a first
 * read; a model that proposes nothing sails past all of them.
 *
 * ⛔ THE ANSWER IS NOT TO TELL HER SHE HAS SEARCH. That is prose, it is the fifth
 * calibration, and four have already failed. This asks a different question at the only
 * moment it can be asked cheaply: she has said 「I am ready to answer」, and before that answer
 * is believed, one narrow verifier decides whether it is answerable WITHOUT retrieval.
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────────
 * NOT a router. It runs only when the model's INITIAL decision is FINAL, before any connector
 * has run. A turn that proposes a read never reaches it. It does not pick a capability, a
 * tool, a source or an operation — it names a WORLD and the model still chooses how to read
 * it. It never inspects her prose: 「cannot access」 is not a string this file looks for, and a
 * text detector is exactly the fragile thing it replaces.
 *
 * ── PROVIDER-NEUTRAL BY CONSTRUCTION ─────────────────────────────────────────
 * No adapter, router or connector import; handed a `verify` closure, never learns what is
 * behind it. Proven by a static token scan.
 *
 * ── AND IT FAILS CLOSED ──────────────────────────────────────────────────────
 * Missing, throw, malformed, unknown decision, bad question shape — none of them release the
 * answer. ⛔ NOTE THE DIRECTION, WHICH IS THE OPPOSITE OF THE MIXED GATE'S. There, failing
 * safe meant claiming NO requirement, because a false requirement would licence a read. Here
 * the dangerous direction is releasing an unverified FINAL, so failure produces
 * FINAL_VALIDATION_UNAVAILABLE and the answer is not published.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { ownerAuthoredContext } = require('./publicQueryEgressPlanner')

/**
 * ⛔ FIVE OUTCOMES, AND `question` IS ONLY EVER POPULATED BY ONE.
 *
 * There is no `reason`, `rationale`, `confidence`, `analysis`, `thinking`, `tool`,
 * `capability`, `provider`, `query`, `source` or `readKey` field, and there will not be one —
 * the same ruling as the ambiguity and mixed verifiers. An explanation field is
 * chain-of-thought wearing a respectable name, and a `capability` field would move tool
 * selection to the server.
 *
 * ROOT IS A PLAIN OBJECT, not a nullable union. A live HTTP 400 already taught this file's
 * neighbour that a nullable root is invalid in strict Structured Outputs.
 */
const FINAL_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'question'],
  properties: {
    decision: {
      type: 'string',
      enum: ['allow_final', 'clarify', 'require_internal', 'require_public', 'require_mixed'],
      description: 'allow_final＝唔使查嘢都答得；require_internal＝要我哋自己嘅實際資料；require_public＝要出面公開資料；require_mixed＝兩邊都要；clarify＝意思真係唔清楚。'
    },
    question: {
      type: ['string', 'null'],
      description: '淨係 clarify 先填：一句簡短嘅澄清問題。其餘四個一定要填 null。'
    }
  }
})

const DECISION = Object.freeze({
  ALLOW: 'allow_final',
  CLARIFY: 'clarify',
  INTERNAL: 'require_internal',
  PUBLIC: 'require_public',
  MIXED: 'require_mixed'
})

/** Which worlds each decision obliges. `null` = no obligation. */
const WORLDS_FOR = Object.freeze({
  [DECISION.ALLOW]: null,
  [DECISION.CLARIFY]: null,
  [DECISION.INTERNAL]: Object.freeze({ internal: true, public: false }),
  [DECISION.PUBLIC]: Object.freeze({ internal: false, public: true }),
  [DECISION.MIXED]: Object.freeze({ internal: true, public: true })
})

/**
 * ⛔ MODEL TEXT (governance/textClasses.js, class MODEL). She is told this.
 *
 * It describes ONE judgement — 「can this be answered without going and looking」 — and names
 * no product, supplier, price or market. A domain noun here would be the keyword router this
 * work was told not to build, wearing prose; a static test enforces the absence.
 *
 * ⛔ AND IT DOES NOT TELL HER WHAT SHE CAN DO. There is no 「你有搜尋功能」 sentence, because
 * this verifier is not her and does not act: it judges what the QUESTION needs. Capability
 * belongs to the authorised operation list, which is the only thing that may grant it.
 *
 * No holdout sentence appears here; a static test asserts that too.
 */
const FINAL_SYSTEM = `你係一個好窄嘅判斷閘。你唔係答問題嘅人。

Louie 問咗一個問題。你唯一要判斷嘅係：**要答得準，使唔使真係去攞資料？**

allow_final —— 唔使攞資料：
- 佢已經自己俾晒需要嘅數字或事實
- 或者係一般常識、定義、計算、寫嘢，唔靠任何即時或私人資料

require_internal —— 要我哋自己嘅實際情況（我哋自己嘅紀錄、現況、實際數字）

require_public —— 要出面公開世界嘅情況（市場、行情、外面嘅公開資料、即時消息）

require_mixed —— 佢明確要兩邊一齊，例如要攞我哋自己嘅嘢同出面嘅嘢比較

clarify —— 只喺以下情況：
- 「我哋自己」同「出面」兩種意思都同樣講得通
- 而揀邊一邊會變成答緊另一條問題
- 而佢自己同之前嘅對話都冇講明

規則：
- 唔好答佢個業務問題。
- 唔好揀工具、來源或者操作，亦唔好提任何系統或功能名。
- 唔好解釋你點諗。
- 唔好因為某樣嘢查起上嚟麻煩就話唔使查。要攞就係要攞。
- 除咗 clarify，question 一定要係 null。
- clarify 嗰句只可以問「意思」，用生意語言，一句。`

/** A clarification may never leak implementation vocabulary to the Owner. */
const IMPLEMENTATION_TERMS = /public_knowledge|aroma_system|nextRead|capability|connector|readKey|schema|operation|A4|API|endpoint|provider|tool/i
const SAFE_FALLBACK_QUESTION = '你想我睇我哋自己嘅實際情況，定係外面公開市場嘅情況？'
const MAX_QUESTION_CHARS = 120

/** Why no verdict. Enums only. */
const OUTCOME = Object.freeze({
  UNAVAILABLE: 'unavailable', // no verifier, throw, or unusable output ⇒ FINAL not released
  ALLOW: DECISION.ALLOW,
  CLARIFY: DECISION.CLARIFY,
  INTERNAL: DECISION.INTERNAL,
  PUBLIC: DECISION.PUBLIC,
  MIXED: DECISION.MIXED
})

/**
 * Admit ONLY the closed shape; a fresh object is constructed so nothing invented travels.
 * @returns {{decision:string, question:string|null}|null} null ⇒ unusable ⇒ fail closed
 */
function validateFinalDecision (raw) {
  let obj = raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return null
    try { obj = JSON.parse(s) } catch (_) {
      const m = /\{[\s\S]*\}/.exec(s)
      if (!m) return null
      try { obj = JSON.parse(m[0]) } catch (_) { return null }
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const d = obj.decision
  if (!Object.prototype.hasOwnProperty.call(WORLDS_FOR, d)) return null
  if (d !== DECISION.CLARIFY) {
    // ⛔ A non-clarify decision carrying a question is a CONTRACT BREACH, not a nuisance: it
    // would mean the model wants both to oblige a read AND to ask. The question is dropped
    // rather than the decision — the obligation is the part that protects the answer.
    return { decision: d, question: null }
  }
  const q = typeof obj.question === 'string' ? obj.question.trim() : ''
  const usable = q !== '' && q.length <= MAX_QUESTION_CHARS && !IMPLEMENTATION_TERMS.test(q)
  return { decision: d, question: usable ? q : SAFE_FALLBACK_QUESTION }
}

/**
 * Run the gate. PURE apart from the injected `verify` call.
 *
 * @param {{verify?:function, message?:string, history?:object[], availableWorlds?:object}} input
 * @returns {Promise<{ok:boolean, decision:string|null, question:string|null, requiredWorlds:object|null, outcome:string}>}
 *          ok:false means the FINAL may NOT be released.
 */
async function runFinalKnowledgeRequirement (input = {}) {
  const verify = typeof input.verify === 'function' ? input.verify : null
  const unavailable = () => ({ ok: false, decision: null, question: null, requiredWorlds: null, outcome: OUTCOME.UNAVAILABLE })
  // ⛔ NO VERIFIER, NO RELEASE. Enabling the path without wiring one must not silently pass
  // every answer — that is the failure where a guard exists on paper and allows everything.
  if (!verify) return unavailable()

  const ownerMessages = ownerAuthoredContext(input.message, input.history)
  if (!ownerMessages.length) return unavailable()

  const aw = input.availableWorlds && typeof input.availableWorlds === 'object' ? input.availableWorlds : {}
  let raw
  try {
    raw = await verify({
      // ⛔ THE COMPLETE INPUT LIST. His own words, and two booleans saying which worlds are
      // reachable at all. No assistant turns, no system prompt, no persona, no Conversation
      // Contract, no FINAL text, no evidence, no capability names, no connector output, no
      // EvidenceSets, no readKeys, no memory, no Decision Recall — none of it is a parameter
      // here, so none of it can be forgotten about.
      ownerMessages: ownerMessages.slice(),
      availableWorlds: { internal: aw.internal === true, public: aw.public === true },
      system: FINAL_SYSTEM,
      schema: FINAL_SCHEMA
    })
  } catch (_) {
    return unavailable() // the thrown message is DISCARDED; it can carry the prompt back
  }

  const decided = validateFinalDecision(raw)
  if (!decided) return unavailable()

  const worlds = WORLDS_FOR[decided.decision]
  // ⛔ AN OBLIGATION IS NOT CLAIMED FOR A WORLD THAT CANNOT BE READ. Obliging a public read on
  // a turn with no public capability would refuse the final forever and spend the whole bound
  // failing. Downgraded honestly: what remains required is what is actually reachable.
  let requiredWorlds = worlds
  if (worlds) {
    const internal = worlds.internal === true && aw.internal === true
    const pub = worlds.public === true && aw.public === true
    requiredWorlds = (internal || pub) ? { internal, public: pub } : null
  }
  return {
    ok: true,
    decision: decided.decision,
    question: decided.question,
    requiredWorlds,
    outcome: decided.decision
  }
}

/**
 * ⛔ ONCE PER TURN. Turn-scoped, in memory, dropped with the request.
 * A later FINAL reuses the obligation rather than re-asking: the Owner's words have not
 * changed, and a second answer could differ, which would mean a turn whose completion
 * requirement moved underneath it.
 */
function createTurnFinalCache () {
  let result = null
  let calls = 0
  return {
    async get (input) {
      if (result) return result
      calls++
      result = await runFinalKnowledgeRequirement(input)
      return result
    },
    get calls () { return calls },
    get settled () { return result !== null }
  }
}

/**
 * ⛔ THE STRUCTURAL OBSERVATION, RENDERED FOR THE MODEL — AND THIS IS THE OTHER HALF OF THE
 * DEFECT.
 *
 * Refused observations reach the LOOP but never reached the MODEL: only successful read
 * blocks are added to the prompt, so a `required_world_missing` refusal was invisible to the
 * very model expected to act on it. A guard the model cannot see cannot be honoured, and
 * measuring its 「failure to recover」 would have measured nothing.
 *
 * ⛔ IT NAMES A WORLD, NEVER A TOOL. No capability, no operation, no source name, no query —
 * the model still chooses from the authorised list. It also states no business fact, carries
 * nothing from the rejected answer, and says nothing about what she can or cannot do.
 *
 * ⛔ MODEL TEXT (class MODEL).
 */
const WORLD_LABEL = Object.freeze({
  internal: '我哋自己嘅實際資料',
  public: '出面公開世界嘅資料'
})

function renderRequiredWorldObservation (world) {
  const label = WORLD_LABEL[world]
  if (!label) return null
  return `【本回合仲未齊料】\n要答呢條問題，仲欠：${label}。\n呢部分而家係空白嘅，未讀過，唔可以靠估或者用其他資料頂替。\n喺上面列出嘅可用讀取操作入面，自己揀一個去攞返呢部分，然後先答。`
}

/** One content-free line: an enum and two numbers. */
function logFinalRequirement (entry, sink) {
  const line = {
    event: 'A4_FINAL_OBLIGATION',
    timestamp: new Date().toISOString(),
    requestId: entry && entry.requestId != null ? String(entry.requestId) : null,
    outcome: entry && Object.values(OUTCOME).includes(entry.outcome) ? entry.outcome : OUTCOME.UNAVAILABLE,
    requiredInternal: !!(entry && entry.requiredWorlds && entry.requiredWorlds.internal === true),
    requiredPublic: !!(entry && entry.requiredWorlds && entry.requiredWorlds.public === true),
    ownerMessageCount: Number.isFinite(entry && entry.ownerMessageCount) ? entry.ownerMessageCount : 0,
    durationMs: Number.isFinite(entry && entry.durationMs) ? entry.durationMs : null
  }
  try { (sink || ((l) => console.log('[AROMA-FINAL-OBLIGATION]', JSON.stringify(l))))(line) } catch (_) {}
  return line
}

module.exports = {
  FINAL_SCHEMA,
  FINAL_SYSTEM,
  DECISION,
  WORLDS_FOR,
  OUTCOME,
  IMPLEMENTATION_TERMS,
  SAFE_FALLBACK_QUESTION,
  MAX_QUESTION_CHARS,
  WORLD_LABEL,
  validateFinalDecision,
  runFinalKnowledgeRequirement,
  createTurnFinalCache,
  renderRequiredWorldObservation,
  logFinalRequirement
}
