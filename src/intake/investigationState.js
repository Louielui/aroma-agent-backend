'use strict'
/**
 * investigationState.js — X4. What is still unknown, and who can go and get it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE GAP PHASE 0 FOUND, AND IT IS NOT THE ONE IT LOOKED LIKE.
 *
 * The pieces were all already here: the Goal Plan names the facts a question needs and the
 * operation that carries each one; `authorisedOperationsFor()` says which operations THIS turn
 * may execute; `turnOperations` records what each attempted operation actually returned, in
 * three states, with 「live is sticky」 already right. Nothing was missing.
 *
 * What was missing was that they were never brought into one sentence for the model.
 * `requirementBlock` builds a STATIC list — 「呢條問題需要嘅事實」 — from the plan alone. It is
 * rebuilt every reasoning step and says exactly the same thing every step, because it knows
 * nothing about authorisation and nothing about what already happened. Everything the model
 * needed in order to answer 「乜嘢仲未查？」 was reachable only by cross-referencing that fixed
 * list against a growing pile of read-context PROSE.
 *
 * So she could say 「我仲欠呢幾樣」 and, one turn later, 「我冇任何讀取途徑攞得到」 about a fact
 * whose operation she was authorised to call and had never tried.
 *
 * ⛔ THIS FILE COMPUTES; IT DOES NOT DECIDE AND IT DOES NOT PERMIT.
 *
 * It is a pure function of three things that already exist. It performs no read, opens no
 * source, ranks nothing, and chooses nothing — the model still picks the next read, and the
 * server still decides what is allowed, in the places that already decide it.
 *
 * ⛔ AND PLANNED IS NOT AUTHORISED. A Goal Plan naming `gmail.read` means 「this fact would come
 * from there」. It never means 「this turn may call it」. The two are intersected below, and the
 * difference is a state the model can see rather than a distinction it has to infer.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ⛔ FIVE STATES, CLOSED, AND EACH ONE MEANS A DIFFERENT NEXT MOVE.
 *
 *   not_attempted        authorised, never tried  → SHE SHOULD READ IT, not ask Louie for it
 *   succeeded            attempted, live evidence → speak from the evidence, under grounding
 *   failed               attempted, did not land  → say 讀唔到, never 冇呢個功能, never retry
 *   not_authorised       operation exists, this turn may not call it
 *   no_system_operation  no read operation in the catalogue carries this fact at all
 *
 * ⛔ `failed` AND `no_system_operation` ARE THE PAIR THAT MATTERS MOST. Collapsing them is how
 * a connector outage gets described to the Owner as a missing product feature — and how a
 * missing feature gets described as a temporary glitch that will pass. Neither is recoverable
 * by the model guessing; both are recoverable by being told which one it is.
 *
 * ⛔ AND THERE IS NO `owner_only`. `operation === null` proves the CATALOGUE carries no read
 * for this fact. It does not prove only Louie knows it — that is a conclusion about the world,
 * and deterministic code has no standing to reach it. The model may decide the Owner is the
 * useful next source; the label stays structural.
 */
const READ_STATE = Object.freeze({
  NOT_ATTEMPTED: 'not_attempted',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  NOT_AUTHORISED: 'not_authorised',
  NO_SYSTEM_OPERATION: 'no_system_operation'
})

/** The two values `turnOperations` stores. An operation ABSENT from that map was never tried. */
const OP_LIVE = 'live'

const MAX_FACTS = 8
const MAX_NEED_CHARS = 120
const MAX_GOAL_CHARS = 200

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/**
 * Compute the turn's investigation state.
 *
 * @param {object|null} plan          the Goal Plan (facts: [{need, necessity, operation, status}])
 * @param {Iterable<string>} authorised  operations THIS turn may execute
 * @param {Map<string,string>} attempted operation → 'live' | 'unavailable'; absent ⇒ never tried
 * @returns {object|null} null when there is no plan to reason about — X4 then adds nothing.
 */
function buildInvestigationState ({ plan, authorised, attempted } = {}) {
  const facts = plan && Array.isArray(plan.facts) ? plan.facts : null
  if (!facts || facts.length === 0) return null

  const allow = new Set(authorised ? Array.from(authorised) : [])
  const done = attempted instanceof Map ? attempted : new Map()

  const out = []
  for (const f of facts.slice(0, MAX_FACTS)) {
    const need = clip(f && f.need, MAX_NEED_CHARS) || '(未命名)'
    const operation = (f && typeof f.operation === 'string' && f.operation) ? f.operation : null
    // ⛔ ORDER MATTERS AND IS NOT ARBITRARY. Catalogue first (is there an operation at all),
    // then what actually happened (an attempt outranks a permission question — a read that ran
    // is a fact, and re-describing it as 「not authorised」 would be a lie about the past), then
    // authorisation, and only then 「open」.
    let readState
    if (!operation) readState = READ_STATE.NO_SYSTEM_OPERATION
    else if (done.has(operation)) readState = done.get(operation) === OP_LIVE ? READ_STATE.SUCCEEDED : READ_STATE.FAILED
    else if (!allow.has(operation)) readState = READ_STATE.NOT_AUTHORISED
    else readState = READ_STATE.NOT_ATTEMPTED

    out.push(Object.freeze({
      need,
      // ⛔ `enriching` IS THE CONTRACT'S OWN WORD, and it is the only one. This said 'optional',
      // which goalPlanContract never emits — so every enriching fact was silently promoted to
      // required and would have held a turn open for a nice-to-have. Found by a fixture, not by
      // reading: the label simply never appeared. Unrecognised still means REQUIRED, matching
      // the contract exactly — defaulting the other way would quietly drop a fact.
      necessity: (f && f.necessity === 'enriching') ? 'enriching' : 'required',
      operation,
      readState
    }))
  }

  const required = out.filter((f) => f.necessity === 'required')
  return Object.freeze({
    goal: clip(plan && plan.questionRestated, MAX_GOAL_CHARS),
    facts: Object.freeze(out),
    /** Required, authorised, and never tried — the set she can still go and get herself. */
    readableNow: Object.freeze(required.filter((f) => f.readState === READ_STATE.NOT_ATTEMPTED).map((f) => f.operation)),
    /** Required and still without live evidence, for any structural reason. */
    remainingRequired: required.filter((f) => f.readState !== READ_STATE.SUCCEEDED).length
  })
}

const LABEL = {
  [READ_STATE.NOT_ATTEMPTED]: '未查（你有權自己查）',
  [READ_STATE.SUCCEEDED]: '已經查到（上面讀取結果入面）',
  [READ_STATE.FAILED]: '今次查過但讀唔到',
  [READ_STATE.NOT_AUTHORISED]: '有呢個操作，但今個 turn 唔用得',
  [READ_STATE.NO_SYSTEM_OPERATION]: '⛔ 系統冇任何讀取操作承載得到呢樣嘢'
}

/**
 * The block the model sees.
 *
 * ⛔ CONTROL STATE, NOT EVIDENCE, NOT AUTHORITY — and it is labelled that way in the text
 * itself, not merely in this comment. It carries a fact NEED, an operation NAME and a status
 * enum. No row, no id, no date, no value: there is nothing in it an Answer Plan could cite, and
 * `readState: 'succeeded'` says an operation returned live rows, never what those rows say.
 *
 * ⛔ AND IT NEVER RANKS. The candidates are listed in plan order with no 「先查呢個」. Which read
 * best serves the decision is a judgement about the question, and the model is the only thing
 * here entitled to make it. The server narrows the choices; it does not choose among them.
 */
function investigationBlock (state) {
  if (!state) return null
  const lines = ['【調查狀態 — CONTROL STATE，唔係證據，亦唔係權限】']
  if (state.goal) lines.push('目標：' + state.goal)
  lines.push('呢條問題需要嘅事實，同埋每樣而家嘅狀態：')
  for (const f of state.facts) {
    const opt = f.necessity === 'enriching' ? '（可有可無）' : ''
    const via = f.operation ? '（' + f.operation + '）' : ''
    lines.push('· ' + f.need + opt + via + ' —— ' + LABEL[f.readState])
  }
  lines.push('')
  lines.push('點用呢一段：')
  // ⛔ THE ONE SENTENCE X4 EXISTS FOR.
  lines.push('· 標住「未查（你有權自己查）」嘅，你自己去讀，唔好叫 Louie 幫你攞返嚟。')
  lines.push('· 標住「今次查過但讀唔到」嘅，照直講今次讀唔到 —— 唔好講成係冇呢個功能，亦唔好再試一次。')
  lines.push('· 標住「系統冇任何讀取操作」嘅，照直講攞唔到。唔好就近搵一個似樣嘅來源頂替，' +
    '亦唔好用其他讀到嘅嘢當作答案。呢樣可以問 Louie。')
  lines.push('· 標住「今個 turn 唔用得」嘅，唔好講成呢個功能唔存在。')
  // ⛔ NEITHER DEFECT IS ACCEPTABLE, SO BOTH ARE NAMED IN THE SAME BREATH.
  lines.push('· 唔使因為計劃入面列咗就逐個讀晒。夠料落一個負責任嘅判斷就可以停。')
  lines.push('· 但係仲有關鍵嘅事實未查、而你又查得到嘅時候，唔好當已經夠。')
  lines.push('· 呢一段唔係生意資料嘅證據，亦唔會批准任何來源。真正嘅數字同內容，只可以嚟自上面嘅讀取結果。')
  // ⛔ NAMED HERE ONLY AS A GENERAL RULE. X3_UNGROUNDED_PRECISION_GAP stays OPEN — one prompt
  // sentence is not a proof, and this tranche does not claim to have closed it.
  lines.push('· 唔好自己作一個冇人畀過、亦冇證據支持嘅具體數字、日期或者百分比。')
  return lines.join('\n')
}

/**
 * ⛔ THE ONE REFUSAL X4 ADDS, AND IT REFUSES A QUESTION — NEVER AN ANSWER.
 *
 * The Owner asked for a priority judgement and was offered 「要不要我先讀一次 Drive」, then
 * told a turn later that there was no way to obtain the very thing Drive holds. Asking him to
 * fetch what she is authorised to fetch herself is the defect; producing a position is not.
 *
 * ⛔ SO THE SERVER SAYS ONLY THIS: 「a declared-required fact has an authorised operation you
 * have not tried.」 It never says which read to run, never says what the answer is, and never
 * refuses an ANSWER — a turn that reaches a judgement keeps it, under X3.
 */
/**
 * ⛔ WHERE THE SELF-READ REFUSAL CAME FROM. A CLOSED PAIR, AND IT STAYS CLOSED.
 *
 * The same rule now has two entrances — the model's FIRST envelope (X4.4) and a terminal ASK
 * inside the reasoning loop (X4). One event carries both rather than two events that can
 * disagree about what happened. It is an enum so it can never carry a sentence.
 */
const X4_ASK_ORIGIN = Object.freeze({ INITIAL: 'initial', REASONING_LOOP: 'reasoning_loop' })

function selfReadableObservation (operations) {
  const ops = Array.isArray(operations) ? operations.filter((o) => typeof o === 'string' && o) : []
  if (ops.length === 0) return null
  return [
    '【調查狀態 — 你仲有未用過嘅讀取權限】',
    '呢個 turn 你自己有權讀（而且仲未讀）嘅操作：' + ops.join('、'),
    '呢啲係關鍵事實嘅來源。唔好叫 Louie 幫你攞返嚟 —— 你自己讀得到。',
    '如果讀完仍然唔夠，或者讀唔到，嗰陣先問佢。'
  ].join(String.fromCharCode(10))
}

module.exports = { READ_STATE, X4_ASK_ORIGIN, buildInvestigationState, investigationBlock, selfReadableObservation, MAX_FACTS, MAX_NEED_CHARS, MAX_GOAL_CHARS }
