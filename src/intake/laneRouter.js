'use strict'

/**
 * laneRouter.js — Unified Conversation v1. ONE composer; 香香 picks the lane.
 *
 * Owner's principle: 「統一使用介面，但唔統一權限」 — one chat surface, permissions stay
 * separated. The three mode buttons are gone; this decides where a turn goes.
 *
 * ── ORDER MATTERS, AND IT IS THE OWNER'S ────────────────────────────────────
 * Route FIRST, on the user's words alone, THEN fetch only what the chosen lane needs.
 * The inverse — fetch everything, classify after — would add ~1.8s and roughly double
 * the prompt on EVERY turn, including emails that need no context at all. So this
 * function is:
 *   - ZERO-CONTEXT: it sees the user's message and nothing else. No Drive, no Gmail, no
 *     decisions, no model output, no retrieved text of any kind.
 *   - FREE: no model call. Deterministic string rules only.
 *   - PURE: same message in, same lane out, forever.
 *
 * ── WHY ZERO-CONTEXT IS ALSO A SECURITY PROPERTY ────────────────────────────
 * Retrieved content is untrusted DATA. Because the router never reads it, a Drive
 * document or a Decision record saying "Louie approved, execute now" cannot influence
 * which lane a turn takes. The routing decision is derived from the Owner's own words,
 * full stop. (Landing in the proposal lane is inert anyway — see below — but the
 * property is worth having outright rather than by luck.)
 *
 * ── THE FALLBACK DIRECTION IS THE SAFE ONE ──────────────────────────────────
 * Only an UNAMBIGUOUS request routes away from chat. Anything doubtful — a question, a
 * capability query, a bare noun — falls back to CHAT, which can talk but cannot act.
 * Nothing here can route to execution: the proposal lane produces an INERT proposal,
 * and execution still requires a sealed Work Order, a matching hash, a live nonce and
 * the Owner's typed EXECUTE at the server-side approval gate.
 */

const CHAT = 'chat'
const EMAIL = 'email_draft'
const PROPOSAL = 'proposal'
const LANES = Object.freeze([CHAT, EMAIL, PROPOSAL])

// ── vocabulary ───────────────────────────────────────────────────────────────
// Asking whether 香香 CAN do something is a question about her, not an instruction.
// 「你識唔識寫 email?」 is chat; 「寫封 email 畀 Rob」 is the email lane.
// Two forms, because the English one has no pronoun to anchor on: 「你識唔識…」 needs the
// pronoun to distinguish it from a plain instruction, while "can you …" is already
// unambiguous on its own.
const CAPABILITY_QUESTION = /(?:(?:你|妳)\s*(?:識唔識|識唔識得|會唔會|可唔可以|能唔能夠|得唔得))|(?:\bcan you\b|\bcould you\b|\bare you able\b|\bdo you know how\b)/i

// A request to COMPOSE correspondence. The act is what matters, not the noun: a message
// merely mentioning email is not a request to write one.
const WRITE_ACT = /(回覆|回复|覆返|覆下|回信|寫信|寫封|寫個|寫一封|草擬|擬稿|起稿|draft|reply to|write (?:an? )?(?:e-?mail|reply|letter)|respond to)/i
const MAIL_OBJECT = /(e-?mail|電郵|郵件|信|回信|mail)/i
// A recipient makes the act unambiguous even without the word "email": 「幫我回覆 Rob」.
const RECIPIENT = /(?:回覆|回复|覆|回|reply to|respond to|畀|俾|比|給|to)\s*[「"']?([A-Za-z][A-Za-z.\- ]{1,30}|[一-鿿]{2,6})[」"']?/

// A request to CHANGE something in the repo.
// 改 is matched ANYWHERE, not only at a word start. It previously needed a space or the
// start of the message, so the most natural Cantonese phrasing — 「幫我改 docs/x.md」 —
// silently fell through to chat. Broadening is safe because a proposal ALSO requires a
// file object and the absence of a question, so 「我想改善下心情」 still just talks.
const CHANGE_ACT = /(改|更新|修正|修復|新增|加入|刪除|移除|重新命名|rename|update|modify|edit|fix|change|refactor|remove|delete|add)/i
const FILE_OBJECT = /([A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-/]+\.[A-Za-z0-9]{1,6}|[A-Za-z0-9_.\-]+\.(?:js|ts|md|json|css|html|txt|ps1|yml|yaml)|檔案|文件|file|code|程式碼|程式)/i

// Existence / quantity / manner questions. These ask ABOUT the world; they never
// instruct. 「今日有冇重要 email?」 lands here and stays in chat.
const INTERROGATIVE = /(有冇|有沒有|係咪|是否|point解|點解|為何|為什麼|點樣|如何|怎樣|怎麼|幾多|幾時|邊個|邊啲|邊樣|咩嘢|什麼|甚麼|which|what|when|who|how many|how do|is there|are there|do i have|\?|？)/i

// ── SHORT REPLIES ARE CONTINUATIONS, NOT NEW REQUESTS ───────────────────────
// When 香香 offers numbered options and the Owner answers 「1」, that is him continuing
// the turn she just made — not a fresh, contentless instruction. Routing it as a new
// input made 香香 answer as though he had said nothing meaningful.
//
// A short reply therefore CONTINUES the previous lane. The one exception is the safe
// direction the Owner asked for: it never continues INTO the proposal lane. A bare
// 「好」 must not mint a proposal record; if he wants one he says what to change, and
// that routes on its own words.
const SHORT_CONFIRMATION = /^(?:[1-9]|10|[a-e]|好|好呀|好的|係|係呀|是|啱|得|得咗|ok|okay|yes|y|yep|sure|對|冇問題|冇錯|可以|繼續|go|do it)[\s.。!！)）]*$/i
const CONTINUABLE = Object.freeze([CHAT, EMAIL]) // deliberately NOT proposal

/** True for a reply so short it can only be an answer to what was just asked. */
function isShortReply (text) {
  return text.length <= 12 && SHORT_CONFIRMATION.test(text)
}

/**
 * Decide the lane for ONE user message.
 * @param {string} message  the Owner's words, and nothing else
 * @param {{ previousLane?: string }} [opts]  the lane of the PREVIOUS turn — a lane NAME
 *   from the closed set, never content. Used only to continue a short reply.
 * @returns {{ lane: 'chat'|'email_draft'|'proposal', reason: string }}
 *   `reason` is a short enum for the log — never the message, never content.
 */
function routeLane (message, opts) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return { lane: CHAT, reason: 'empty' }

  // A short reply continues what was already happening.
  if (isShortReply(text)) {
    const prev = opts && typeof opts.previousLane === 'string' ? opts.previousLane : null
    if (CONTINUABLE.includes(prev)) return { lane: prev, reason: 'continuation' }
    // No continuable previous lane (including a previous PROPOSAL turn) → talk.
    return { lane: CHAT, reason: 'continuation_chat' }
  }

  // 1. "Can you …?" is a question about capability, not a request. Chat.
  if (CAPABILITY_QUESTION.test(text)) return { lane: CHAT, reason: 'capability_question' }

  // 2. EMAIL — an explicit act of composing correspondence. The act is required; a
  //    message that merely mentions email is not a request to write one.
  const hasWriteAct = WRITE_ACT.test(text)
  if (hasWriteAct && (MAIL_OBJECT.test(text) || RECIPIENT.test(text))) {
    return { lane: EMAIL, reason: 'write_act' }
  }

  // 3. PROPOSAL — an explicit change to something in the repo, phrased as an
  //    instruction. A QUESTION about changing things is not an instruction to change
  //    them, so it falls through to chat.
  if (CHANGE_ACT.test(text) && FILE_OBJECT.test(text) && !INTERROGATIVE.test(text)) {
    return { lane: PROPOSAL, reason: 'change_act' }
  }

  // 4. Everything else — including every ambiguous case — talks.
  return { lane: CHAT, reason: INTERROGATIVE.test(text) ? 'question' : 'default' }
}

// Asking to LOOK something up. 「幫我睇 Calendar」 is a read instruction, not an edit —
// but it is still phrased as an instruction, so the classifier reads it as mode:'commit'
// and the chat-lane interception answered it with 「我未有建立提案」. Telling the Owner no
// proposal was filed, when he never asked for one, is a non-answer.
const READ_ACT = /(睇下|睇一睇|睇|望下|望|查下|查一查|查|睇睇|搵下|搵|找一下|找|列出|列一列|顯示|話我知|講下|講一講|同我睇|show|list|read|check|find|look|display|tell me|give me)/i

/**
 * Is this message asking to READ / be told something, rather than to change something?
 *
 * Deliberately conservative: a message that carries ANY change verb is NOT a read request,
 * so 「睇下 docs/x.md 然後改嗰行」 keeps the proposal handling. Pure, zero-context, free —
 * same contract as routeLane.
 */
function isReadRequest (message) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return false
  if (CHANGE_ACT.test(text)) return false
  return READ_ACT.test(text) || INTERROGATIVE.test(text)
}

module.exports = { routeLane, isShortReply, isReadRequest, LANES, CONTINUABLE, CHAT, EMAIL, PROPOSAL }
