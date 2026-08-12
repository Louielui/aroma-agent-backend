'use strict'

/**
 * internalSystemAnswer.js — she may not ask the Owner what his own system is.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ OBSERVED TWICE, ON 02e430e, THROUGH THE REAL UI, IN ONE SESSION.
 *
 *   [3] 「可以。我能讀取 Aroma System 的六個唯讀端點…」          ← used the registry
 *   [5] 「你講嘅 aroma system 係我哋內部系統，定係公開網站？」    ← asked instead
 *   [9] 「你想修改同開發嘅 Aroma System，係指內部使用嘅系統，定係公開網站？」 ← asked again
 *
 * `namesInternalSystem()` matched all three. The registry holds the fact — including that
 * Aroma System is NOT an outside website — and it reaches the prompt on every one of these
 * turns by the same code path. **The model used it once and ignored it twice.**
 *
 * ⛔ SO THIS IS NOT A PROMPT PROBLEM AND MUST NOT BE FIXED WITH A STRONGER INSTRUCTION.
 * Owner's ruling, and the standing CONTRACT_RELIABILITY finding: a fact supplied by prompt is
 * followed inconsistently. Reinforcing the sentence changes the odds, not the guarantee. This
 * is a deterministic check on what was actually generated.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ WHAT IT KEYS ON, AND WHY NOT A PHRASING ──────────────────────────────
 *
 * The two observed replies share no usable substring: 「係我哋內部系統，定係公開網站」 versus
 * 「係指內部使用嘅系統，定係公開網站」, and neither is the resolver's canned CLARIFY_QUESTION.
 * A match on either would have caught one turn and missed the other.
 *
 * It keys on the SHAPE of the defect instead — three things that must co-occur:
 *
 *   1. an INTERNAL referent   (內部 / 我哋自己 / 自己嘅 / internal)
 *   2. a PUBLIC referent      (公開 / 對外 / 外面 / 公網 / public)
 *   3. posed as a CHOICE      (定係 / 定 / 還是 / 或者 / or) inside an interrogative
 *
 * All three, in one sentence. That is the question whose answer is already known.
 *
 * ── ⛔ WHAT IT WILL MISS, STATED SO NOBODY READS IT AS MORE ─────────────────
 *
 *   · An English-only phrasing that avoids every listed token.
 *   · 「Aroma System 係咩嚟？」 — asking what it IS without offering the two options. No choice
 *     structure, so it is invisible here. That is a different defect and is NOT covered.
 *   · A disambiguation split across two sentences, since the co-occurrence test is per sentence.
 *   · Any phrasing that names the axis with words outside these lists — this is a MATCHING
 *     vocabulary and translating it would delete the detector silently.
 *
 * It closes the observed shape. It does not close 「she asked instead of answering」.
 */

const { namesInternalSystem, describe: describeSelf } = require('./selfDescription')

/** ⛔ MATCHING vocabulary. Translating any list below removes the check without removing code. */
const INTERNAL_REF = /(內部|内部|我哋自己|我们自己|自己嘅系統|自己的系統|自己的系统|\binternal\b)/i
const PUBLIC_REF = /(公開|公开|對外|对外|外面|公網|公网|對外網站|\bpublic\b|\bexternal\b)/i
/** The disjunction that turns two nouns into a question the Owner has to answer. */
const CHOICE = /(定係|定系|定|還是|还是|或者|抑或|\bor\b)/i
const INTERROGATIVE = /[？?]|\b(which|whether)\b/i

/** Sentence-ish split. The co-occurrence must be inside ONE sentence to count. */
function sentences (text) {
  return String(text).split(/(?<=[。！？!?\n])/).map((s) => s.trim()).filter(Boolean)
}

/**
 * Does this reply ask the Owner to choose between his internal system and a public website?
 * @param {string} reply
 * @returns {boolean}
 */
function asksInternalVsPublic (reply) {
  if (typeof reply !== 'string' || !reply.trim()) return false
  return sentences(reply).some(isDisambiguationSentence)
}

function isDisambiguationSentence (s) {
  return INTERNAL_REF.test(s) && PUBLIC_REF.test(s) && CHOICE.test(s) && INTERROGATIVE.test(s)
}

/**
 * The post-generation check.
 *
 * ⛔ PRECONDITION: the OWNER's message must name her own system. Without that the fact does not
 * apply and a clarification may be entirely reasonable — she is allowed to ask which of two
 * unrelated things somebody meant.
 *
 * ⛔ AND IT REMOVES ONLY THE OFFENDING SENTENCE. A reply that answers AND then asks the known
 * question keeps its answer: destroying real content to delete one sentence would be a worse
 * defect than the one being corrected. The registry's own statement is prepended so the turn
 * carries the fact rather than a hole.
 *
 * @param {{reply:string, message:string}} input
 * @returns {{reply:string, corrected:boolean, removed:string[]}}
 */
function correctInternalSystemReply (input) {
  const inp = (input && typeof input === 'object') ? input : {}
  const reply = typeof inp.reply === 'string' ? inp.reply : ''
  const message = typeof inp.message === 'string' ? inp.message : ''
  const none = { reply, corrected: false, removed: [] }

  if (!reply.trim()) return none
  if (!namesInternalSystem(message)) return none

  const parts = sentences(reply)
  const removed = parts.filter(isDisambiguationSentence)
  if (!removed.length) return none

  const kept = parts.filter((s) => !isDisambiguationSentence(s)).join('')
  // The fact leads, because it is the thing that was asked for and is already known.
  const fact = describeSelf()
  return {
    reply: kept.trim() ? (fact + '\n\n' + kept.trim()) : fact,
    corrected: true,
    removed
  }
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ SUPPRESSION IS NOT AN ANSWER.
 *
 * Measured 17:06 local, real UI, empty history, on the merged detector:
 *
 *   user   「aroma system的網址我沒有了, 給我一下」
 *   reply  「我讀到 public_knowledge 1 項記錄。…我組不出一個可靠的答案，所以不會亂說。」
 *
 * The detector did its job — she did not ask internal-vs-public. And the URL was in the
 * registry the whole time. **We removed the wrong sentence without supplying the right one.**
 *
 * ── ⛔ AFTER GENERATION, NOT BEFORE, AND HERE IS WHY ────────────────────────
 *
 * A before-generation short-circuit would be simpler and is the wrong shape:
 *   · it would fire on any turn MENTIONING the system, hijacking questions that merely
 *     name it on the way to something else;
 *   · it would bypass `enforceReadState` / `enforceNoReadClaim` / the answer plan, which are
 *     the guards that keep a reply honest about what was read;
 *   · and it would discard a CORRECT model answer — turn [3] of session 07d3fbcf answered
 *     well, and a short-circuit would have replaced it with a template.
 *
 * After generation, the test is on the SHIPPED TEXT: does the reply the Owner will read
 * contain the fact he asked for? That is the guarantee he asked for, and it is the one that
 * cannot be satisfied by 「the model was told」 — which has now failed twice, measured.
 *
 * ── ⛔ AND IT MAY NOT CLAIM MORE THAN THE REGISTRY HOLDS ────────────────────
 * `WANTED` is a CLOSED map from a question shape to a registry field. A question outside it
 * supplies nothing and the existing honest refusal survives byte-identical. The registry is a
 * small set of facts, not a licence to answer freely.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { selfDescription } = require('./selfDescription')

/** ⛔ MATCHING vocabulary — translating these deletes the trigger without removing code. */
const ASKS_URL = /(網址|网址|網站地址|連結|链接|\bURL\b|\blink\b|\bwebsite\b|\bweb site\b|地址)/i
/**
 * ⛔ THE INTERNAL/PUBLIC AXIS ONLY — NOT 「係咩」.
 *
 * The first version included 係咩／是什麼／what is, and a test caught it claiming the identity
 * fact for 「aroma system 個資料庫密碼係咩？」. That question names her system and asks 「what
 * is」 about a DIFFERENT NOUN, and answering it with 「it is your internal system」 would be
 * answering a question nobody asked — the over-claim constraint #4 exists to prevent.
 *
 * ⚠ SO IT MISSES a bare 「Aroma System 係咩嚟？」 with no internal/public framing. That is the
 * same gap already recorded on the detector side, and it is left open rather than closed with
 * a pattern that cannot tell which noun the question is about.
 */
const ASKS_IDENTITY = /(內部|内部|公開網站|公开网站|對外網站|\binternal\b)/i

/**
 * ⛔ A READ IS NOT A REGISTRY FACT. 「有幾多張發票」 names her system and asks for business
 * data — that is a read, it goes through the read path, and this must keep its hands off it.
 * Without this the supply path would answer business questions from a config file.
 */
const IS_A_READ = /(幾多|几多|多少|有冇|有沒有|邊啲|哪些|列出|落單|訂貨|倉存|库存|庫存|發票|发票|盤點|盘点|採購|采购|供應商|供应商|今日|今天|本週|本周)/i

/**
 * Which registry-backed facts is the Owner asking for?
 * @returns {string[]} subset of ['url','identity'] — empty when the registry does not cover it
 */
function wantedRegistryFacts (message) {
  const m = typeof message === 'string' ? message : ''
  if (!m.trim()) return []
  if (!namesInternalSystem(m)) return []
  if (IS_A_READ.test(m)) return []
  const out = []
  if (ASKS_URL.test(m)) out.push('url')
  if (ASKS_IDENTITY.test(m)) out.push('identity')
  return out
}

/** The registry's own words for each fact. No model composes these. */
function factSentence (key, d) {
  if (key === 'url') return '你嘅 Aroma System 網址係 ' + d.aromaSystem.baseUrl + '。'
  if (key === 'identity') return 'Aroma System 係你自己間餐廳嘅內部系統，唔係出面嘅公司或者網站。'
  return null
}

/** Is the fact already in the shipped text? Then leave the reply alone. */
function replyCarries (reply, key, d) {
  const r = String(reply || '')
  if (key === 'url') return r.includes(d.aromaSystem.baseUrl)
  if (key === 'identity') return /內部/.test(r) && !asksInternalVsPublic(r)
  return false
}

/**
 * The single entry point for the chat lane: remove the question that has a known answer, and
 * make sure the known answer is actually present.
 *
 * @param {{reply:string, message:string, deps?:object}} input
 * @returns {{reply:string, corrected:boolean, supplied:string[], removed:string[]}}
 */
function enforceInternalSystemAnswer (input) {
  const inp = (input && typeof input === 'object') ? input : {}
  const message = typeof inp.message === 'string' ? inp.message : ''

  // 1. the disambiguation with a known answer never ships
  const step1 = correctInternalSystemReply({ reply: inp.reply, message })

  // 2. and the known answer does
  const wanted = wantedRegistryFacts(message)
  if (!wanted.length) return { reply: step1.reply, corrected: step1.corrected, supplied: [], removed: step1.removed }

  const d = selfDescription(inp.deps || {})
  const missing = wanted.filter((k) => !replyCarries(step1.reply, k, d))
  if (!missing.length) return { reply: step1.reply, corrected: step1.corrected, supplied: [], removed: step1.removed }

  // ⛔ The fact LEADS. It is what he asked for; anything the model said comes after it, so a
  // refusal becomes a qualifier on an answer rather than the answer itself.
  const facts = missing.map((k) => factSentence(k, d)).filter(Boolean).join('')
  const rest = String(step1.reply || '').trim()
  return {
    reply: rest ? (facts + '\n\n' + rest) : facts,
    corrected: step1.corrected,
    supplied: missing,
    removed: step1.removed
  }
}

module.exports = {
  asksInternalVsPublic,
  correctInternalSystemReply,
  wantedRegistryFacts,
  enforceInternalSystemAnswer,
  // exported for the fence tests that assert the vocabulary is a list, not a phrasing
  INTERNAL_REF,
  PUBLIC_REF,
  CHOICE
}
