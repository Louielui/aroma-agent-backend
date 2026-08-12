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

module.exports = {
  asksInternalVsPublic,
  correctInternalSystemReply,
  // exported for the fence tests that assert the vocabulary is a list, not a phrasing
  INTERNAL_REF,
  PUBLIC_REF,
  CHOICE
}
