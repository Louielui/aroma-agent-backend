'use strict'

// ⛔ A4-0A — the FIRST dependency this module has ever had, and it is deliberately narrow:
// the gate plus a pure admission filter, both of which are inert while A4 is off. The parser
// still constructs a closed envelope from known fields and still grants no permission.
const { a4ContractEnabled, admitReadArgs, a4SemanticRoutingEnabled, A4_SEMANTIC_GUIDANCE } = require('./a4Contract')
const { JUDGMENT_KEY, judgeExecutiveJudgment } = require('./executiveJudgment') // X3: the position, judged not copied

/**
 * distillPrompt.js — COO behaviour (not a chatbot).
 * Aroma understands, JUDGES, RECOMMENDS, and PROPOSES (Proposal-first) — and never
 * claims work is created, dispatched, approved, or done before it actually happens.
 *
 * modes:
 *  chat      — greeting / question / chit-chat → just talk
 *  recommend — advisory ("should I do X or Y?") → give a RECOMMENDATION + reasons + offer
 *  ask       — only when essential info is genuinely missing
 *  commit    — operational (decision/task/reminder) → an execution PROPOSAL only;
 *              STAGE-HONEST (proposed, awaiting Louie's approval — NOT created/
 *              dispatched/executed). Dispatch/Run/Worker are the post-approval
 *              governance layer, never claimed by this classifier.
 * Output: strict JSON, Traditional Chinese. Never expose raw chain-of-thought.
 */

// ── FROZEN GOVERNANCE WORDING ────────────────────────────────────────────────
// B1-1a governance wording v2
// Owner sign-off: 2026-07-15
// Proposal-first / approval-gated
// The commit/execution wording below is Owner-signed-off. It must NEVER again claim
// work is created, dispatched, approved, or done at model-output time. The old
// "派給對應的工人 / 完成後我回報 / 你只做到…建立任務" phrasing must not return.
// Machine-verified by src/intake/distillGovernanceWording.test.js.
// IDENTITY LIVES IN THE PERSONA, NOT HERE. This prompt used to open with its own
// identity sentence — and it called Louie "CEO" while the persona calls him "Chef".
// Two contradictory identity sentences sat in the same system string, one after the
// other. The sentence is removed rather than corrected: the classifier's job is to
// classify, and a second voice describing who she is can only ever drift from the
// first. The persona is now the single source of identity.
const SYSTEM_PROMPT = `你的職責：理解 → 判斷 → 建議 → 提出提案（Proposal）。派工、執行與完成後的正式回報，屬於 Louie 批准後由治理層推進的階段；你不得在尚未發生時宣稱它們已經發生或必然會發生。你像一位懂 Louie 生意的可靠主管。

只輸出「有效的 JSON」,不要 markdown 圍欄。文字用「繁體中文」(技術詞如 hub-api-v1、main 保留原文)。

【先判斷 intent】greeting / question / brainstorm / chit_chat / context / advisory / decision / task / reminder / approval / unclear

【再選 mode 與格式】

mode="chat"（greeting / question / chit_chat / context）:
{ "intent":"...", "mode":"chat", "reply":"<自然口語的回應。提問就直接回答;背景/現況就表示理解並確認。>" }

mode="recommend"（advisory / brainstorm —— Louie 在徵詢意見或二選一）:
不要只反問!你是 COO,要先給出「建議 + 理由」,再邀請他同意。
{ "intent":"advisory", "mode":"recommend",
  "reply":"<一句明確的建議,例如「我建議先接 POS。」>",
  "reasons":["<理由1>","<理由2>","<理由3>"],
  "offer":"<若他同意你會做什麼,例如「若你同意,我就建立專案並拆成任務。」>" }

mode="ask"（unclear —— 真的缺關鍵資訊才用）:
{ "intent":"unclear", "mode":"ask", "reply":"<一句最關鍵的釐清問題>" }

mode="commit"（decision / task / reminder —— 操作型):
{
  "intent":"...", "mode":"commit",
  "reply":"<階段誠實：你已理解並整理出一項執行提案（Proposal），等待 Louie 批准；尚未執行，也尚未派工。不要預先假設 Proposal 已成功建立，正式紀錄以系統結果為準。>",
  "judgment":"<我的判斷:為什麼這樣決定,2–3 句;不是逐步推理>",
  "decision":{ "statement":"<一句>", "rationale":"<1–2 句>" },
  "tasks":[ { "title":"<行動>", "note":"<背景/完成標準>", "capability":"<architecture|coding|execution|browser|verification|ssh|ops>" } ],
  "risks":[ { "title":"<風險>", "detail":"<說明>" } ],
  "next_step":"<一句話下一步>"
}

【背景/現況 ≠ 指令 —— 最容易犯的錯】intent="context":
當 Louie 只是「陳述背景、現況、關係、事實或想法」,而【沒有】明確要求你現在去做/建立/修改/停止/執行某件事——這是 context,一律用 mode="chat" 回應(表示理解並確認),【絕對不要】產生 decision 或 task。
只有當 Louie 明確下達行動要求(做/建立/改/停/查/派工…)時,才用 mode="commit"。判斷不確定時,傾向 context/chat,不要擅自建立任務。
- context/chat(不建立任務)例:「從今天開始我們一起開發 Aroma System」「我們公司主要做餐飲」「Aroma 有三個門市」「我昨天跟供應商談過了」「我最近在想香香的定位」。
- commit(建立任務)例:「幫我把 Timeline 的輪詢在終止狀態後停掉」「建立一個新的供應商資料表」。

【需要補充資料時 —— READ / ASK / FINAL 三選一】
若本次輸出 schema 包含 nextRead，每一次回應都是以下三者之一：

READ（nextRead = 某一個操作）
- 當你可以自己判斷出要讀邊一個具體操作時，就直接讀，唔好反問，亦唔好講「沒有資料」「未連接」或者靠估。
- 例：「幫我睇 Aroma System 最近啲發票。」→ nextRead.capability = "aroma_system.invoices"。唔需要問佢想睇邊一部分。
- 讀取結果會喺同一個 user turn 交返俾你。收到之後重新判斷：夠料就 nextRead = null 完成回答；仲差另一個操作先再 request 一次。

ASK（mode = "ask"，nextRead = null）
- 只喺你真係無法安全判斷要讀邊一個操作時先用，而且只問【一句】。
- 例：「你能看到 Aroma System 嗎？」→ Aroma System 有倉存、發票、供應商、盤點、訂貨建議、採購單等唔同部分，並無一個「總體」讀取操作，所以應該問一句：「可以嘗試讀取。你想我用倉存、發票、供應商、盤點、訂貨建議定係採購單即場驗證？」
- 唔好因為想快而亂揀一個操作扮驗證咗；亦唔好問 Louie 攞你自己讀得到嘅資料。

FINAL（nextRead = null）
- 現有資料已經足夠回答，直接答。

規則：
- capability 只能【原文照抄】schema 列出嘅其中一個操作名，唔可以自己砌名、砌方法或者砌路徑。
- nextRead 只用嚟讀取資料，不得用來執行寫入、修改、發送、購買、刪除或其他 action。
- 不要輸出你的逐步思考，只輸出決定與最終答案。

【最重要的規則:絕不謊稱已完成】
- commit 的 reply【絕對不能】說「我已合併/我幫你做好了/我現在就去做」。
- 正確說法：「我已理解，並把它整理成一項執行提案（Proposal）。這是提案，等待 Louie 批准；尚未執行，也尚未派給任何 Worker。正式 Proposal 是否成功建立，以系統紀錄為準。」
- 你只到「理解 → 判斷 → 提出提案」為止。正式 Proposal、Approval、Run、Dispatch、Worker 啟動、執行與驗證，都由治理層依正式紀錄推進；在你產生回覆的當下，不得假設其中任何一步已經發生。不要宣稱已建立正式紀錄、已批准、已派工、已開始執行或已完成。

其他規則:
- advisory/二選一 → 先給建議,不要只反問(除非真的資訊不足)。
- 每個 task 標一個 capability(給哪種能力做)。
- reply 自然口語;judgment 只給結論式判斷。tasks 至少 1;risks 可為 []。`

// ── WHOSE WORDS WERE THOSE ───────────────────────────────────────────────────
// This branched on `h.role === 'louie'`. The client sends `role: 'user'`, and NOTHING in
// this codebase has ever sent 'louie' as a chat role — that string is an owner id in the
// proposal and confirm layers, borrowed here for a field that never carries it. So the
// test was false on every line and the whole history came through as:
//
//     香香: <his question>
//     香香: <her answer>
//
// She read his questions as her own monologue for the life of the feature. A prior
// exchange that looks like something she already said gives her no reason to answer
// differently — which is what two near-identical replies a minute apart actually were.
//
// The branch is now on 'assistant', the role the client emits for her turns, and the
// DEFAULT IS THE OWNER: an unknown or missing role is his. Mislabelling her words as his
// costs a little context; mislabelling his as hers is the defect above.
// Machine-verified against the client's own role literals by historyAttribution.test.js —
// a hardcoded role name that nothing produces is how this survived.
function buildDistillPrompt (message, history = [], opts = {}) {
  let convo = ''
  if (Array.isArray(history) && history.length) {
    convo = '對話歷史(舊到新):\n' + history.slice(-8)
      .map(h => `${h.role === 'assistant' ? '香香' : 'Louie'}: ${h.text}`).join('\n') + '\n\n'
  }
  // ⛔ A4-1: THE SEMANTIC GUIDANCE IS APPENDED, GATED, AND CHAT-LANE ONLY.
  //
  // SYSTEM_PROMPT itself is untouched — it is exported and asserted on elsewhere, and an
  // A4-off turn must be byte-identical to 40a0f223.
  //
  // ⛔ `chatLane` IS REQUIRED, and the first version of this was wrong without it. A4-1 governs
  // knowledge READ INITIATION IN CHAT and nothing else, but this builder composes the system
  // string for EVERY lane — so appending unconditionally changed the proposal and email_draft
  // system strings too, and conversationContract's byte-identity assertion caught it. A lane
  // that cannot read has no use for guidance about when to read.
  //
  // 'shadow' does NOT append it either: shadow changes no behaviour.
  //
  // ⛔ AND IT GOES BEFORE THE CLASSIFIER, NEVER AFTER IT. The repository contract is
  // persona → guards → Conversation Contract → SYSTEM_PROMPT, with the classifier VERBATIM AND
  // LAST; buildPersonaSystemFromPersona appends `distillSystem` last precisely to hold that.
  // The first version appended the guidance after SYSTEM_PROMPT, which broke
  // 「classifier preserved verbatim at the END」. Prepending keeps that invariant intact and
  // still puts the guidance after the contract, because this whole string is the last segment.
  const a4Chat = opts && opts.chatLane === true && a4SemanticRoutingEnabled(process.env)
  const system = a4Chat ? A4_SEMANTIC_GUIDANCE + '\n\n' + SYSTEM_PROMPT : SYSTEM_PROMPT
  return { system, prompt: `${convo}Louie 現在說:「${message}」\n\n請先判斷 intent,再依規則輸出 JSON。` }
}

// --- Slice A: strict Distill output-contract parser (Option C) ----------------
// Reason taxonomy (frozen). Built-in JSON.parse owns all grammar/value-boundary
// decisions; leading/trailing/multiple/truncated all surface as invalid_json.
const REJECT_REASONS = Object.freeze({
  EMPTY_RESPONSE: 'empty_response',
  FENCE_MALFORMED: 'fence_malformed',
  INVALID_JSON: 'invalid_json',
  NOT_SINGLE_OBJECT: 'not_single_object',
  DUPLICATE_KEYS: 'duplicate_keys'
})

// Typed rejection. .message is safe (reason only, no raw model text). Raw sample
// lives ONLY in .diagnostic for server-side logging — never disclosed by Slice A.
class DistillParseError extends Error {
  constructor (reason, diagnostic) {
    super(`distill parse rejected: ${reason}`)
    this.name = 'DistillParseError'
    this.reason = reason
    this.diagnostic = diagnostic || {}
  }
}
function rejectWith (reason, text) {
  return new DistillParseError(reason, { rawSample: String(text).slice(0, 200) })
}

// Envelope: accept a bare payload or ONE code fence whose language tag is empty or
// "json" (case-insensitive; CRLF or LF). Anything else outside the JSON → reject.
// Trims ONLY JSON-insignificant whitespace (space/tab/LF/CR) — NOT a BOM or other
// Unicode whitespace, so a leading BOM survives to JSON.parse and is rejected.
//
// OUTERMOST-FENCE RULE: the wrapper opens at the very start and closes at the LAST
// closing fence, so a ``` appearing INSIDE the payload (which happens naturally
// whenever the reply discusses code) is part of the payload rather than a reason to
// reject. This tolerates only the WRAPPER — the extracted payload still goes through
// the same strict JSON.parse, the same duplicate-key scan and the same schema
// validation, so nothing malformed or non-conforming becomes acceptable. There is no
// salvage/best-effort path: a missing close fence, a non-json language tag, invalid
// JSON, stray prose or a schema violation are all still rejected, unchanged.
function validateEnvelope (text) {
  const s = String(text).replace(/^[ \t\n\r]+/, '').replace(/[ \t\n\r]+$/, '')
  if (s === '') throw rejectWith(REJECT_REASONS.EMPTY_RESPONSE, text)
  if (!s.startsWith('```')) return s // bare candidate — JSON.parse decides validity
  const firstNl = s.indexOf('\n')
  if (firstNl === -1 || !s.endsWith('```')) throw rejectWith(REJECT_REASONS.FENCE_MALFORMED, text)
  const lang = s.slice(3, firstNl).replace(/\r$/, '').trim()
  if (lang !== '' && !/^json$/i.test(lang)) throw rejectWith(REJECT_REASONS.FENCE_MALFORMED, text)
  // s already ends with the closing fence, so slicing to length-3 IS the outermost
  // extraction: everything between the opening line and the LAST fence.
  return s.slice(firstNl + 1, s.length - 3) // JSON.parse decides validity
}

// All-depth duplicate-key detection over a string JSON.parse has ALREADY accepted
// (so it is guaranteed well-formed; this scanner validates NO grammar). It only
// tracks object/array nesting and, per object scope, the set of DECODED keys — two
// keys that decode to the same value (e.g. "a" and "a") are duplicates. Keys
// are decoded per-token with JSON.parse; the object's own last-wins result is never
// used to judge duplicates. String contents (incl. escaped quotes/backslashes and
// braces) are skipped and never mistaken for structure or keys.
function assertNoDuplicateKeys (json, rawText) {
  const stack = []
  const n = json.length
  let i = 0
  while (i < n) {
    const c = json[i]
    if (c === '"') {
      let j = i + 1
      while (j < n) {
        if (json[j] === '\\') { j += 2; continue } // valid JSON → escape is well-formed
        if (json[j] === '"') break
        j++
      }
      const token = json.slice(i, j + 1)
      const top = stack[stack.length - 1]
      if (top && top.type === 'object' && top.expectKey) {
        const key = JSON.parse(token) // safe local decode of the key token only
        if (top.keys.has(key)) throw rejectWith(REJECT_REASONS.DUPLICATE_KEYS, rawText)
        top.keys.add(key)
        top.expectKey = false
      }
      i = j + 1
      continue
    }
    if (c === '{') { stack.push({ type: 'object', keys: new Set(), expectKey: true }); i++; continue }
    if (c === '[') { stack.push({ type: 'array' }); i++; continue }
    if (c === '}' || c === ']') { stack.pop(); i++; continue }
    if (c === ',') {
      const top = stack[stack.length - 1]
      if (top && top.type === 'object') top.expectKey = true
      i++; continue
    }
    i++ // ':' , whitespace, numbers, true/false/null — never a key
  }
}

/**
 * @param {string} text
 * @param {object} [diag]  OPTIONAL out-parameter for facts ABOUT the parse.
 *
 * The returned envelope is a CLOSED projection and stays closed — distillEnvelopeBaseline
 * freezes its key set, deliberately, and answerPlan is its one named exception. Coercion
 * is not envelope content; it is a fact about how the envelope was produced. So it is
 * written here instead of smuggled into the shape every consumer reads.
 */
function parseDistillResponse (text, diag) {
  const content = validateEnvelope(text) // bare/single-fence → inner string; else empty/fence_malformed
  let p
  try {
    p = JSON.parse(content)
  } catch (_) { throw rejectWith(REJECT_REASONS.INVALID_JSON, text) }
  if (p === null || typeof p !== 'object' || Array.isArray(p)) throw rejectWith(REJECT_REASONS.NOT_SINGLE_OBJECT, text)
  assertNoDuplicateKeys(content, text) // any-depth duplicate → reject BEFORE any normalization / intent read

  const intent = typeof p.intent === 'string' ? p.intent : 'unclear'
  const reply = (typeof p.reply === 'string' && p.reply.trim()) ? p.reply.trim() : '我在,你說。'
  // ── THE COERCION IS UNCHANGED. IT IS NO LONGER SILENT. ───────────────────────────
  // Anything unrecognised — a value we do not know, or no value at all — becomes 'chat'.
  // That is still what happens; the Owner ruled the behaviour stays this round.
  //
  // What changed is that 「the model said chat」 and 「the model said something we cannot
  // read」 were INDISTINGUISHABLE, and one of them means the classifier is answering a
  // different question than we think it is. On a proposal turn the difference decides
  // whether a work-order card can exist at all, so it must be visible.
  //
  // The RAW value is warned about, never put in the outcome record: that line's discipline
  // is that it can never carry model output, and a mode string is model output. What
  // travels there is the boolean.
  const MODES = ['commit', 'recommend', 'ask', 'chat']
  const modeCoerced = !MODES.includes(p.mode)
  const mode = modeCoerced ? 'chat' : p.mode
  if (modeCoerced) {
    const shown = typeof p.mode === 'string' ? JSON.stringify(p.mode.slice(0, 32)) : String(p.mode)
    console.warn(`[AROMA-HUB] Unrecognised distill mode=${shown} — coerced to 'chat'.`)
  }
  if (diag && typeof diag === 'object') diag.modeCoerced = modeCoerced
  // ── answerPlan — ADDITIVE, and only when the model actually sent one ──────────────
  // The projection is closed, which is correct and stays correct: an unknown key is still
  // dropped. This is one NAMED key, carried through unvalidated on purpose — answerPlan.js
  // owns its validation, against the evidence, which this parser has no access to. Passing
  // it verbatim keeps that responsibility in one place.
  //
  // It is `undefined` when absent, not null and not {}, so every existing lane's object is
  // byte-identical to before: `'answerPlan' in out` is false unless the model sent one.
  // distillEnvelopeBaseline.test.js pins that for chat, ask, commit/proposal, email-draft
  // and legacy, and u1DraftBehaviourFreeze.test.js pins the U1 path, which uses a
  // different parser entirely and cannot be reached from here.
  const answerPlan = (p.answerPlan && typeof p.answerPlan === 'object' && !Array.isArray(p.answerPlan))
    ? p.answerPlan
    : undefined

  const base = { intent, mode, reply, understanding: reply, judgment: '', decision: null, tasks: [], risks: [], next_step: '', reasons: [], offer: '' }
  if (answerPlan !== undefined) base.answerPlan = answerPlan

  // ── A3 REASONING LOOP: the ONE new field the model may use to ask for a read. ────
  //
  // ⛔ THIS PARSER BUILDS A CLOSED ENVELOPE, and that is why the field has to be added here
  // rather than merely to the schema: a provider can return `nextRead`, the schema can accept
  // it, and it still never reaches the pipeline because this function constructs a fresh
  // object from known fields. The reasoning loop appeared wired and did nothing — the whole
  // turn silently collapsed back to one model call.
  //
  // Only the SHAPE is admitted, and only a string capability. Everything else about it —
  // whether that source was authorised, whether it is read-shaped — is decided by the server
  // in intakeService.authorisedSourcesFor() and in reasoningLoop.js. A name here is a request,
  // never a permission.
  if (p.nextRead && typeof p.nextRead === 'object' && typeof p.nextRead.capability === 'string' && p.nextRead.capability) {
    base.nextRead = { capability: p.nextRead.capability }
    // ⛔ A4-0A: THE ARGUMENT CHANNEL, GATED AND CLOSED.
    //
    // With the gate off, `args` is not read at all and the envelope above is byte-identical to
    // today — a provider that sends args on an A4-off turn has them dropped exactly like any
    // other unknown field, because this function CONSTRUCTS a closed envelope rather than
    // copying one.
    //
    // With the gate on, admitReadArgs() rebuilds the same way: three known fields, or null.
    // `url`, `provider`, `endpoint` and friends are not blocked by a list — they have nowhere
    // to be written to. And this still grants nothing: authorisation remains
    // intakeService.authorisedSourcesFor() and the allowlist in reasoningLoop.js.
    if (a4ContractEnabled(process.env)) {
      base.nextRead.args = admitReadArgs(p.nextRead.args)
    }
  }


  // ── X3 EXECUTIVE JUDGMENT: THE POSITION, AS A NAMED FIELD. ──────────────────
  //
  // ⛔ SAME REASON nextRead HAD TO BE ADDED HERE AND NOT ONLY TO THE SCHEMA: this function
  // CONSTRUCTS a closed envelope from known keys, so a provider may return a judgement, the
  // schema may accept it, and it still reaches nobody. That is exactly how the reasoning loop
  // once appeared wired while doing nothing at all.
  //
  // ⛔ AND IT IS JUDGED, NOT COPIED. A status outside the closed list — or a `blocked` that
  // smuggles a position in — is DROPPED, never normalised to the nearest legal value. The turn
  // then behaves exactly as it did before X3: prose, and no manufactured stance.
  //
  // ⛔ `executiveJudgment`, NOT `judgment` — `base.judgment` above is the LEGACY COMMIT-MODE
  // SUMMARY STRING and stays a string on every lane. Two different things, two names.
  if (JUDGMENT_KEY in p) {
    const judged = judgeExecutiveJudgment(p[JUDGMENT_KEY])
    if (judged.ok) {
      base[JUDGMENT_KEY] = judged.judgment
    } else if (p[JUDGMENT_KEY] !== null && p[JUDGMENT_KEY] !== undefined) {
      // The reason is a closed server-side enum, never model text — same discipline as modeCoerced.
      console.warn('[AROMA-X3] executiveJudgment refused — ' + judged.reason)
      if (diag && typeof diag === 'object') diag.judgmentRefused = judged.reason
    }
  }
  if (mode === 'recommend') {
    return { ...base,
      reasons: Array.isArray(p.reasons) ? p.reasons.filter(x => typeof x === 'string') : [],
      offer: typeof p.offer === 'string' ? p.offer : '' }
  }
  if (mode !== 'commit') return base

  const decision = p.decision && typeof p.decision.statement === 'string'
    ? { statement: p.decision.statement, rationale: p.decision.rationale || '' } : null
  const tasks = Array.isArray(p.tasks)
    ? p.tasks.map(t => ({ title: t.title || '', note: t.note || '', capability: t.capability || 'ops' })).filter(t => t.title) : []
  const risks = Array.isArray(p.risks)
    ? p.risks.map(r => ({ title: r.title || '', detail: r.detail || '' })).filter(r => r.title) : []

  return { ...base, mode: 'commit',
    judgment: typeof p.judgment === 'string' ? p.judgment.trim() : (typeof p.summary === 'string' ? p.summary.trim() : ''),
    decision,
    tasks, // a commit may legitimately have zero tasks — never fabricate one to fill the shape
    risks,
    next_step: typeof p.next_step === 'string' ? p.next_step.trim() : '' }
}

module.exports = { buildDistillPrompt, parseDistillResponse, SYSTEM_PROMPT, DistillParseError, REJECT_REASONS }
