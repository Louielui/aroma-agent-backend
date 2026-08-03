'use strict'

/**
 * requestInference.js — read the request out of what the Owner already said.
 *
 * ── THE PROBLEM ───────────────────────────────────────────────────────────
 * The Owner wrote:
 *
 *     幫我改 docs/canary/agent-canary.md，喺第一行後面加一句「edited by the agent」
 *
 * …and got a form asking for the file path and what to change. Both were in the sentence.
 * Being asked to retype what you just said is the interaction telling you it was not
 * listening, and it is exactly the copy-paste tax this whole feature exists to remove.
 *
 * So: infer from the conversation, ask ONLY for what is genuinely missing, and ask it in
 * one sentence rather than a form.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
 * It does not decide anything. Inference changes WHAT SHE ASKS, never what needs
 * approving: the Work Order, its hash and the typed EXECUTE are untouched, and every
 * inference is printed on the card for the Owner to read before he approves. A wrong guess
 * is visible and correctable by typing, which is the whole point — it is never silent.
 *
 * It is also DETERMINISTIC: no model call, no network. The same words always yield the
 * same reading, so a Work Order the Owner approved cannot be produced from a different
 * interpretation the second time.
 *
 * Path extraction is shared with workOrderProducer rather than re-implemented, so the
 * thing that infers a file and the thing that validates it can never disagree.
 */

const { mentionedFilesFrom } = require('./workOrderProducer')
const { isForbiddenFile } = require('./workOrder')

/** Verbs that mean "change this file", in both languages the Owner writes in. */
const CHANGE_VERB = /(改|修|加|刪|移除|換|更新|寫|補|fix|change|edit|update|add|remove|rename|refactor)/i

/**
 * The instruction, minus the parts that are addressing 香香 rather than describing work.
 * Kept conservative: this only ever trims a leading "幫我 / 請你 / 可以" and the filename
 * itself, because a wrong trim would put words in the Owner's mouth on the approval card.
 */
function intentFrom (text, file) {
  let s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  if (!s) return null
  // Drop a leading address to her.
  s = s.replace(/^(唔該|請|麻煩|幫我|幫手|可以|你可唔可以|你|香香)[，,、:：\s]*/i, '')
  // Drop the file path — the card shows it on its own line, and repeating it inside the
  // change description is noise. Prefer the text AFTER the path: in
  // 「改 <path>，喺第一行後面加一句…」 the instruction lives there, and simply deleting
  // the path in place leaves 「改 ，喺第一行…」, which reads like a transcription error and
  // would look careless on an approval card.
  if (file && s.includes(file)) {
    const i = s.indexOf(file)
    const after = s.slice(i + file.length).replace(/^[，,、。:：\s]+/, '').trim()
    const before = s.slice(0, i).trim()
    s = after.length >= 4 ? after : (before + ' ' + after).trim()
  }
  s = s.replace(/\s{2,}/g, ' ').replace(/^[，,、:：\s]+/, '').replace(/[，,、\s]+$/, '').trim()
  if (!s) return null

  // A BARE VERB IS NOT AN INSTRUCTION. 「幫我改 <path>」 leaves 「改」, and putting that on
  // an approval card as the intended change would be pretending to have understood
  // something. Nothing left once the verb is removed means the Owner said WHICH file but
  // not WHAT — so it counts as missing, and she asks the one question.
  const withoutVerb = s.replace(new RegExp(CHANGE_VERB.source, 'gi'), '').replace(/[\s，,、。.:：吓下佢它]/g, '')
  if (withoutVerb.length < 2) return null
  return s
}

/**
 * @param {{ message?: string, conversation?: string[]|string, mentionedFiles?: string[] }} input
 * @returns {{ file, intent, missing: string[], question: string|null,
 *             candidates: string[], forbidden: string|null }}
 *
 *   file      the one path to work on, or null
 *   intent    what the Owner said to do, or null
 *   missing   which of ['file','intent'] could not be read
 *   question  ONE sentence asking only for what is missing, or null when nothing is
 *   candidates every path seen — so an ambiguous request can name the choices
 *   forbidden a named path that is structurally un-allowlistable, if that is why we refused it
 */
function inferWorkRequest (input = {}) {
  const message = typeof input.message === 'string' ? input.message : ''
  const conv = input.conversation

  // The Owner's latest message is the request; earlier turns are context. A file named
  // three messages ago is a weaker signal than the one in the sentence just typed, so the
  // current message wins and the conversation is only a fallback.
  const fromMessage = Array.isArray(input.mentionedFiles) && input.mentionedFiles.length
    ? input.mentionedFiles.slice()
    : mentionedFilesFrom(message)
  const fromConv = fromMessage.length ? [] : mentionedFilesFrom(conv || '')
  const candidates = (fromMessage.length ? fromMessage : fromConv).filter(Boolean)

  let file = null
  let forbidden = null
  if (candidates.length === 1) {
    // A protected path is NOT silently dropped to "no file found" — that would send the
    // Owner hunting for a typo. It is named, and the refusal happens where it belongs
    // (the producer), with the reason already on screen.
    if (isForbiddenFile(candidates[0])) forbidden = candidates[0]
    else file = candidates[0]
  }

  const looksLikeWork = CHANGE_VERB.test(message)
  const intent = looksLikeWork ? intentFrom(message, file) : null

  const missing = []
  if (!file) missing.push('file')
  if (!intent) missing.push('intent')

  return { file, intent, missing, question: questionFor(missing, candidates, forbidden), candidates, forbidden }
}

/**
 * ONE SENTENCE, and only about what is actually missing. Never two questions, never a
 * form, and never a question about something the Owner already answered.
 */
function questionFor (missing, candidates, forbidden) {
  if (forbidden) {
    return '「' + forbidden + '」屬於受保護範圍（憑證／授權閘／稽核），唔可以改。你想改邊個檔？'
  }
  if (missing.length === 0) return null
  const needFile = missing.includes('file')
  const needIntent = missing.includes('intent')

  if (needFile && candidates.length > 1) {
    return '你想改邊個檔？我喺對話入面見到 ' + candidates.join('、') + '。'
  }
  if (needFile && needIntent) return '你想改邊個檔，同埋想點改？'
  if (needFile) return '你想改邊個檔？'
  return '你想點改？'
}

module.exports = { inferWorkRequest, intentFrom, questionFor, CHANGE_VERB }
