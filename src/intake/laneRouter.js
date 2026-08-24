'use strict'

/**
 * laneRouter.js — Unified Conversation v1. ONE composer; 心燈 picks the lane.
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
// Asking whether 心燈 CAN do something is a question about her, not an instruction.
// 「你識唔識寫 email?」 is chat; 「寫封 email 畀 Rob」 is the email lane.
// Two forms, because the English one has no pronoun to anchor on: 「你識唔識…」 needs the
// pronoun to distinguish it from a plain instruction, while "can you …" is already
// unambiguous on its own.
/**
 * ⛔ CX1 — AN ADVERB BETWEEN THE PRONOUN AND THE MODAL IS STILL THE SAME QUESTION.
 *
 * Measured on a real turn: 「香香，你現在能看圖像，分析圖像嗎？」 was NOT recognised as a
 * capability question. Both patterns here anchored the modal directly to 你, so 現在 — the
 * most natural way to ask 「can you do it RIGHT NOW」 — broke the match and the turn fell
 * through to the generic `question` reason. It still landed in CHAT, because the fallback
 * direction is the safe one; what was lost is that nothing downstream could tell it apart
 * from an ordinary question, so the answer shape a capability question deserves never fired.
 *
 * ⛔ A CLOSED LIST OF TIME/DEGREE ADVERBS, NEVER `.{0,4}`. A wildcard here would let a VERB
 * sit between the pronoun and the modal — 「你幫我改 code 可以嗎」 is a request, not an
 * enquiry — and the entire value of these patterns is that they do not swallow instructions.
 * At most two, because 「而家仲」 is idiomatic and three is not.
 */
const ADVERB = '(?:\\s*(?:而家|依家|宜家|家陣|家阵|現在|现在|目前|如今|當下|当下|而今|今時今日|今时今日|暫時|暂时|平時|平时|通常|一般|依然|始終|始终|已經|已经|究竟|到底|真係|真系|仲|還|还)){0,2}'

const CAPABILITY_QUESTION = new RegExp(
  '(?:(?:你|妳)' + ADVERB + '\\s*(?:識唔識得|識唔識|會唔會|可唔可以|能唔能夠|能唔能够|得唔得))' +
  '|(?:\\bcan you\\b|\\bcould you\\b|\\bare you able\\b|\\bdo you know how\\b)', 'i')

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ CX1 — THE A-唔-A FORM, RESTRICTED TO VERBS THAT ASK ABOUT HER.
 *
 * Cantonese asks a yes/no question by repeating the verb around 唔. 「你記唔記得我哋上次
 * 講咩?」 and 「你而家讀唔讀到 Calendar?」 are capability and reachability questions in
 * exactly that shape, and the named list above did not cover them.
 *
 * ⛔ AND THE VERB LIST IS CLOSED, BECAUSE THE FORM ALONE IS NOT THE QUESTION.
 *
 * The first draft of this matched ANY repeated verb — `([一-鿿]{1,2})唔\1` — on the
 * reasoning that 你 + A-唔-A is by construction a question about her. It is a question, but
 * it is not necessarily about HER CAPABILITY, and the difference decides a lane:
 *
 *     「你改唔改 docs/x.md」   → CHANGE_ACT + FILE_OBJECT, no 「?」 → PROPOSAL
 *     「你回唔回覆 Rob」       → WRITE_ACT + RECIPIENT          → EMAIL
 *
 * Both would have become capability questions, and CX1 would have quietly changed general
 * action semantics on its way to fixing an answer shape. That the change moved them toward
 * chat does not license it: the safe-fallback principle is a rule about AMBIGUITY, not a
 * warrant for widening scope inside a tranche that was not authorised to touch routing.
 *
 * ⛔ SO WHAT IS LISTED IS ABILITY, MEMORY AND REACHABILITY — never an act performed on an
 * object. 識/會/可/能/得 are ability; 記(得) is memory; 讀(到)/知(道) are reachability and
 * knowledge. 改, 回覆, 寫, send are acts, and their absence from this list is the whole
 * mechanism. A verb added here must answer 「is this asking what she IS, or what she should
 * DO?」 — and the negative fixtures in cx1SimpleAnswer.test.js are what hold that line.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const CAPABILITY_VERB = '(?:記得|知道|能夠|能够|可以|識得|識|會|会|可|能|得|記|记|讀|读|知)'
const SELF_YES_NO_QUESTION = new RegExp('(?:你|妳)' + ADVERB + '\\s*(' + CAPABILITY_VERB + ')唔\\1')

/**
 * ⛔ E3 — 「你可以…嗎？」 IS THE SAME QUESTION IN THE OTHER SPELLING, and it was reaching the
 * email lane. `CAPABILITY_QUESTION` covers the reduplicated Cantonese forms (可唔可以, 識唔識)
 * and missed the plain 你可以 / 你能, so 「你可以幫我回覆 email 嗎？」 — a question about what
 * she can do — silently produced a draft instead of an answer. Measured at 6c3c031a, before
 * E3 touched anything: this is an old hole, surfaced by the E3 fixtures rather than caused
 * by them.
 *
 * ⛔ THE QUESTION MARKER IS REQUIRED. Without it, 「你可以幫我回覆呢封 email」 — a polite
 * INSTRUCTION, not an enquiry — would stop drafting. 嗎/嘛/？/? is what separates asking
 * whether she can from telling her to.
 */
const CAPABILITY_ENQUIRY = new RegExp(
  '(?:你|妳)' + ADVERB + '\\s*(?:可以|能夠|能够|能|會|会)[^\\n]*(?:嗎|嘛|呢)?\\s*[？?]' +
  '|(?:你|妳)' + ADVERB + '\\s*(?:可以|能夠|能够|能|會|会)[^\\n]*(?:嗎|嘛)')

// A request to COMPOSE correspondence. The act is what matters, not the noun: a message
// merely mentioning email is not a request to write one.
const WRITE_ACT = /(回覆|回复|覆返|覆下|回信|寫信|寫封|寫個|寫一封|草擬|擬稿|起稿|draft|reply to|write (?:an? )?(?:e-?mail|reply|letter)|respond to)/i
const MAIL_OBJECT = /(e-?mail|電郵|郵件|信|回信|mail)/i
// A recipient makes the act unambiguous even without the word "email": 「幫我回覆 Rob」.
const RECIPIENT = /(?:回覆|回复|覆|回|reply to|respond to|畀|俾|比|給|to)\s*[「"']?([A-Za-z][A-Za-z.\- ]{1,30}|[一-鿿]{2,6})[」"']?/

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ E3 — NAMING A FUNCTION IS NOT INSTRUCTING IT.
 *
 * Measured, on a real turn: the Owner asked for several standing work areas — one to report
 * on and reply to his email, one for advertising, one for Google-review follow-up, one to
 * supervise Aroma System. The router matched 回覆 and 電郵, committed to `email_draft`, made
 * ZERO model calls, and handed him an empty draft. His question about how to ORGANISE the
 * work was never read by anything that could answer it.
 *
 * The email rule asked 「are the words for writing a mail present?」 when the question it
 * needed to ask was 「is writing a mail what he is ASKING FOR?」. In that sentence, replying
 * to email is one RESPONSIBILITY being assigned to one area — a subordinate clause inside a
 * design request. The lane read the subordinate clause as the whole instruction.
 *
 * ⛔ THE SHAPE OF THE FIX IS ALREADY IN THIS FILE. The proposal lane below refuses to fire on
 * an interrogative, on the stated ground that 「a QUESTION about changing things is not an
 * instruction to change them」. Correspondence had no equivalent guard. This is that guard.
 *
 * ⛔ AND IT IS NOT A STRING FOR 「區域」. The distinction is structural: an ORGANISING ACT
 * applied to a STANDING THING (an area, a desk, a department, a role, a workflow) is a
 * request about arrangement, whatever nouns it happens to contain. A single-email instruction
 * does not talk about departments, and a department question does not name one email.
 *
 * ⛔ THE ASYMMETRY IS DELIBERATE, and it is this codebase's standing one: a request wrongly
 * sent to CHAT is answered by the conversational brain and he can correct it in a sentence. A
 * request wrongly sent to `email_draft` produces a silent, empty artefact and answers nothing.
 * When the two readings are both available, talking is the recoverable failure.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** Setting something up / laying something out, as opposed to writing one message. */
const ORGANISING_ACT = /(創造|创造|創建|创建|建立|設立|设立|開設|开设|成立|設計|设计|規劃|规划|組織|组织|安排|分工|整一個|搞一個|開一個|create|creating|design|designing|set ?up|build|organi[sz]e|organi[sz]ing|plan|structure|arrange)/i

/**
 * A STANDING thing: something that persists and keeps doing its job, rather than one message.
 * These nouns do not appear in an instruction to answer a single mail, which is exactly why
 * they can carry the distinction without a special case for any one sentence.
 */
const STANDING_STRUCTURE = /(區域|区域|部門|部门|科室|團隊|团队|小組|小组|崗位|岗位|職責|职责|角色|工作流程|工作流|流程|工序|機制|机制|系統架構|系统架构|架構|架构|desk|workspace|work ?area|department|division|team|role|responsibilit(?:y|ies)|workflow|pipeline|routine|process)/i

/**
 * Is correspondence the PRIMARY instruction here, or a function being described?
 *
 * Three shapes disqualify the correspondence lane. Each is a statement about ARRANGEMENT:
 *   1. organising act + standing structure  — 「建立一個區域負責回覆電郵」
 *   2. organising act + a question          — 「整體應該點設計？」
 *   3. a standing structure on its own      — 「email 回覆流程太亂」
 *
 * ⛔ (3) YIELDS TO A CONCRETE MESSAGE. 「幫我回覆呢封 email」 names one mail, and one named
 * mail outranks a passing mention of a process — otherwise a real instruction that happens to
 * mention 流程 would stop working.
 */
const CONCRETE_CORRESPONDENCE = /(呢封|這封|这封|嗰封|那封|封信|呢個 ?e-?mail|這個 ?e-?mail|this (?:e-?mail|message|reply)|that (?:e-?mail|message)|the (?:e-?mail|message) (?:above|below))/i

/**
 * ⛔ A TEAM CAN BE WHAT YOU DESIGN, OR WHO YOU WRITE TO. The first version of this rule could
 * not tell the difference, and 「Reply to the marketing team」 stopped drafting — five of six
 * adversarial recipients regressed, caught before E3 was published.
 *
 * The tell is POSITION, not vocabulary: a unit that FOLLOWS an addressing word is the
 * addressee. 「回覆營運團隊」, 「畀 marketing team」, 「to the finance department」 — in each the
 * unit is who receives the mail, so correspondence is still the primary act.
 *
 * ⛔ ONLY UNITS THAT CAN RECEIVE MAIL ARE LISTED. A workflow, a process, a 職責 or a 機制 is
 * never an addressee, so those nouns keep their full design-signal strength: 「email 回覆流程
 * 太亂」 stays a remark about arrangement even though 回覆 sits right in front of 流程.
 */
const ADDRESSABLE_UNIT = /(?:回覆|回复|覆|reply to|respond to|to|畀|俾|比|給)\s*(?:the\s+)?[A-Za-z0-9一-鿿.\- ]{0,24}?(?:部門|部门|團隊|团队|小組|小组|desk|team|department|division)/i

function isArrangementRequest (text) {
  // Addressed to a unit → he is writing TO it, not designing it.
  if (ADDRESSABLE_UNIT.test(text)) return false
  const act = ORGANISING_ACT.test(text)
  const structure = STANDING_STRUCTURE.test(text)
  if (act && structure) return true
  if (act && INTERROGATIVE.test(text)) return true
  if (structure && !CONCRETE_CORRESPONDENCE.test(text)) return true
  return false
}

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
// When 心燈 offers numbered options and the Owner answers 「1」, that is him continuing
// the turn she just made — not a fresh, contentless instruction. Routing it as a new
// input made 心燈 answer as though he had said nothing meaningful.
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
  if (isCapabilityQuestion(text)) return { lane: CHAT, reason: 'capability_question' }

  // 2. EMAIL — an explicit act of composing correspondence. The act is required; a
  //    message that merely mentions email is not a request to write one.
  //    E3: …and composing it must be what he is ASKING FOR. A message whose subject is how
  //    work should be ARRANGED can name email as one of the jobs without being an instruction
  //    to write one — see the block above `ORGANISING_ACT`.
  const hasWriteAct = WRITE_ACT.test(text)
  if (hasWriteAct && (MAIL_OBJECT.test(text) || RECIPIENT.test(text))) {
    if (isArrangementRequest(text)) return { lane: CHAT, reason: 'arrangement_request' }
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

/** Does this message ask whether 香香 CAN do something, in any of the three recognised forms? */
function isCapabilityQuestion (text) {
  return CAPABILITY_QUESTION.test(text) || CAPABILITY_ENQUIRY.test(text) || SELF_YES_NO_QUESTION.test(text)
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ CX1 — 「你可以幫我睇下下星期有咩安排嗎?」 IS NOT A QUESTION ABOUT HER.
 *
 * A capability question and a politely-phrased read request are THE SAME SHAPE in Cantonese.
 * 「你可以幫我 send email 嗎?」 asks what she IS; 「你可以幫我睇下下星期有咩安排嗎?」 asks
 * her to go and look. Both match CAPABILITY_ENQUIRY, and both always have — the lane is CHAT
 * either way, which is why the ambiguity cost nothing until something wanted to treat
 * capability questions differently.
 *
 * ⛔ THE TELL IS A LOOK-UP ACT, AND IT IS THE ONE ALREADY IN THIS FILE. `READ_ACT` is the
 * single definition of 「he asked me to look」 — `isReadRequest` and `readStateGuard` both
 * read it. A message that names one is asking for a READ: the read must proceed and the
 * answer must be what was found, never a description of what she can do.
 *
 * ⛔ THE FALLBACK DIRECTION IS THE SAFE ONE, AGAIN. In doubt this returns FALSE and the turn
 * keeps exactly the shape it had before CX1 existed. A wrong `false` costs a longer answer;
 * a wrong `true` would put an answer-shape rule on top of a genuine read.
 *
 * ⛔ IT DECIDES NOTHING ABOUT ROUTING. `routeLane` and `routeTurn` do not call it, so it can
 * neither open nor close a source, a lane or an execution path. It reports a SHAPE.
 *
 * Pure, zero-context, free — the same contract as routeLane.
 * ══════════════════════════════════════════════════════════════════════════════
 */
function isCapabilityOnlyQuestion (message) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return false
  if (!isCapabilityQuestion(text)) return false
  // He named something to go and look at → a read request wearing a question's clothes.
  if (READ_ACT.test(text)) return false
  return true
}

module.exports = { routeLane, isShortReply, isReadRequest, isCapabilityQuestion, isCapabilityOnlyQuestion, LANES, CONTINUABLE, CHAT, EMAIL, PROPOSAL }
