'use strict'
/**
 * executiveJudgment.js — X3. The position, before the question.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY PROSE WAS NEVER GOING TO BE ENOUGH, AND PHASE 0 SETTLED IT.
 *
 * The chat lane's envelope offers exactly five keys: intent, nextRead, mode, reply,
 * answerPlan. `judgment`, `decision`, `reasons` and `offer` exist in the parser but are
 * reachable only from the legacy commit/recommend path — on a chat turn there has never been
 * a structured place to put a POSITION. Everything had to travel as free prose inside `reply`
 * or `directAnswer`, where 「我建議先做 A」 and 「你比較重視邊樣？」 are the same shape. No
 * amount of system-prompt wording changes that: you cannot require a slot that does not exist,
 * and you cannot stop a question replacing a position when neither has a name.
 *
 * ⛔ SO THE SLOT IS THE TRANCHE. Four bounded fields, one closed enum. The server may require
 * it, preserve it, order it before a question and refuse a malformed state — and it may do
 * NOTHING ELSE. The stance itself comes from the reasoning model; deterministic code that
 * decided 「A is better than B」 from enums would be a business opinion authored by a router.
 *
 * ⛔ AND IT IS A DECISION SUMMARY, NOT A REASONING TRACE. There is no `reasoning`,
 * `rationale`, `analysis` or `stepByStep` here and there will not be one: that would be a
 * second prose channel with none of the grounding the answer path has. No confidence score
 * either — 「72%」 is pseudo-precision about a judgement nobody measured.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ⛔ THREE STATES, AND `blocked` IS NOT 「I would like more information」.
 *
 *   decided      enough basis for a normal recommendation.
 *   provisional  something is missing AND a useful best-current call is still possible.
 *   blocked      no responsible provisional position exists at all.
 *
 * The middle one is the point of X3. Missing information is the ordinary condition of running
 * a restaurant; treating it as a reason to have no opinion is how 「你想點？」 became the answer
 * to questions that deserved one.
 */
const JUDGMENT_STATUS = Object.freeze({
  DECIDED: 'decided',
  PROVISIONAL: 'provisional',
  BLOCKED: 'blocked'
})
const STATUSES = Object.freeze(Object.values(JUDGMENT_STATUS))

/** The one envelope key. See withJudgment for why it is not simply `judgment`. */
const JUDGMENT_KEY = 'executiveJudgment'

/** Bounded, because an unbounded judgement field is where deliberation would hide. */
const MAX_STATEMENT_CHARS = 220
const MAX_ITEM_CHARS = 160
const MAX_ITEMS = 3

const JUDGMENT_REFUSED = Object.freeze({
  ABSENT: 'no_judgment_returned',
  NOT_AN_OBJECT: 'judgment_was_not_an_object',
  BAD_STATUS: 'status_is_not_in_the_closed_list',
  BAD_STATEMENT: 'statement_missing_or_too_long',
  BLOCKED_WITH_STATEMENT: 'blocked_must_not_carry_a_position'
})

/**
 * The provider-side contract.
 *
 * ⛔ NULLABLE, AND `type: ['object','null']` DELIBERATELY — the same shape `nextRead` uses two
 * files away. Strict structured-output mode requires every declared key to be present, so
 * 「this turn owes no judgement」 has to be expressible as an explicit null rather than an
 * omission. A schema that could only be satisfied by inventing a judgement would manufacture
 * one on every retrieval turn.
 */
function judgmentSchema () {
  return {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['status', 'statement', 'uncertainties', 'changeIf'],
    properties: {
      status: {
        type: 'string',
        enum: STATUSES,
        description: 'decided＝有足夠基礎給出建議；provisional＝仍有關鍵未知，但可以給出有用的暫定判斷；blocked＝連負責任的暫定判斷也無法給出。'
      },
      statement: {
        type: 'string',
        description: '一句表達你的立場，例如「我建議先做 A」。blocked 時填空字串。不要在這裡展開理由。'
      },
      uncertainties: {
        type: 'array',
        items: { type: 'string' },
        description: '最多三項會影響建議的關鍵未知，每項一句；沒有就留空，不必湊滿。'
      },
      changeIf: {
        type: 'array',
        items: { type: 'string' },
        description: '最多三項會改變建議的具體條件，每項一句；沒有就留空，不必湊滿。'
      }
    },
    description: '只有 Owner 要求判斷時才填，否則 null。這不是推理過程，不要寫思考步驟或分析。'
  }
}

const bound = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const boundList = (v, maxItems, maxChars) => Object.freeze(
  (Array.isArray(v) ? v : [])
    .map((x) => bound(x, maxChars))
    .filter(Boolean)
    .slice(0, maxItems))

/**
 * Judge a raw judgement.
 *
 * ⛔ IT NEVER NORMALISES A STATUS. A value outside the closed list is refused, not mapped to
 * the nearest one — the same rule the executive frame keeps, for the same reason: a
 * manufactured state is an opinion nobody produced.
 *
 * ⛔ AND `blocked` MAY NOT CARRY A POSITION. 「我做唔到判斷，不過我建議 A」 is the exact shape
 * X3 exists to prevent: a fabricated recommendation wearing an honest label.
 *
 * @returns {{ok:true, judgment:object} | {ok:false, reason:string}}
 */
function judgeExecutiveJudgment (raw) {
  if (raw === null || raw === undefined) return { ok: false, reason: JUDGMENT_REFUSED.ABSENT }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: JUDGMENT_REFUSED.NOT_AN_OBJECT }
  if (!STATUSES.includes(raw.status)) return { ok: false, reason: JUDGMENT_REFUSED.BAD_STATUS }

  const statement = bound(raw.statement, MAX_STATEMENT_CHARS)
  if (raw.status === JUDGMENT_STATUS.BLOCKED) {
    if (statement) return { ok: false, reason: JUDGMENT_REFUSED.BLOCKED_WITH_STATEMENT }
  } else if (!statement) {
    return { ok: false, reason: JUDGMENT_REFUSED.BAD_STATEMENT }
  }

  return {
    ok: true,
    judgment: Object.freeze({
      status: raw.status,
      statement,
      uncertainties: boundList(raw.uncertainties, MAX_ITEMS, MAX_ITEM_CHARS),
      changeIf: boundList(raw.changeIf, MAX_ITEMS, MAX_ITEM_CHARS)
    })
  }
}

/**
 * The Owner-visible block.
 *
 * ⛔ THE POSITION IS THE FIRST LINE, AND THAT ORDER IS THE WHOLE PRODUCT CHANGE. The caller
 * places this at the TOP of the reply, above everything the existing renderer produces and far
 * above `followUp`, so a question can accompany a judgement but can never stand in for one.
 *
 * ⛔ `blocked` RENDERS NO POSITION. There is nothing to render — that is what blocked means.
 */
function renderJudgment (j) {
  if (!j || !STATUSES.includes(j.status)) return null
  const out = []
  if (j.status === JUDGMENT_STATUS.BLOCKED) {
    out.push('我目前無法給出負責任的判斷。')
  } else {
    out.push(j.statement)
    if (j.status === JUDGMENT_STATUS.PROVISIONAL) out.push('（這是暫定判斷。）')
  }
  if (j.uncertainties.length) out.push('未知：' + j.uncertainties.join('；'))
  if (j.changeIf.length) out.push('會改變建議的情況：' + j.changeIf.join('；'))
  return out.join('\n')
}

/**
 * ⛔ THE ONE PROMPT SENTENCE, AND IT IS A REQUIREMENT, NOT ENCOURAGEMENT.
 *
 * Attached only when the Executive Understanding says a decision is owed. A turn that owes no
 * judgement is told nothing at all — 「我下個月有咩行程？」 must stay a retrieval turn.
 */
function judgmentDirective (plan) {
  const frame = plan && plan.executiveFrame
  if (!frame || frame.decisionNeeded !== true) return null
  const lines = [
    '【判斷】Owner 目前要求你提出判斷。請填 executiveJudgment，不要只反問。',
    '· 有足夠基礎 → status=decided，statement 說明立場。',
    '· 仍有關鍵未知，但可以提出有用的初步立場 → status=provisional，statement 說明暫定建議，uncertainties 與 changeIf 只列真正影響建議的項目。',
    '· 只有連負責任的暫定建議也無法給出時，才用 status=blocked（statement 留空），並問最關鍵的問題。',
    '⛔ 資料不足不等於不能給初步意見；但推斷不是已確認事實。',
    '普通建議的 reply 是完整且唯一的正文：先直接承接目標並給建議，再簡短說明理由及必要的不確定性。補充判斷欄位由介面收起，不要依賴它們替正文補上重要限制。',
    '簡單建議通常兩至四句即可；遵守使用者要求的句數，不要例行列出三項理由或全部系統狀態。',
    '假設例子不能證明實際發生頻率、時間成本、風險或哪項一定比較省時。比較依據不足時，提出暫定建議及可驗證的下一步，不要自行補造理由。'
  ]
  if (frame.answerPosture === 'evidence_first') {
    lines.push('· 無法讀取的資料屬於 uncertainties，不要換成另一個剛好能回答的問題。')
  }
  return lines.join('\n')
}

/**
 * ⛔ THE ENVELOPE KEY IS `executiveJudgment`, AND THE NAME IS A PHASE-0 FINDING, NOT A STYLE
 * CHOICE. `judgment` IS ALREADY TAKEN: parseDistillResponse builds a closed envelope whose base
 * carries `judgment: ''` — a legacy commit-mode SUMMARY STRING, populated from `p.judgment` or
 * `p.summary` and returned on every chat turn as `judgment: ''`. Reusing that key would have
 * put an object where a string is contractually expected, on a lane distillEnvelopeBaseline
 * pins. Two different things, two different names.
 *
 * ⛔ AND THE SHAPE IS UNTOUCHED WHEN NO DECISION IS OWED — the SAME OBJECT returned, not a clone
 * with equal content, exactly as withReadArgs does when A4 is off. A retrieval turn cannot
 * differ from today by so much as a key order, so 「我下個月有咩行程？」 cannot start growing a
 * judgement field.
 */
function withJudgment (schema, plan) {
  const frame = plan && plan.executiveFrame
  if (!schema || !frame || frame.decisionNeeded !== true) return schema
  return Object.freeze({
    ...schema,
    required: [...schema.required, JUDGMENT_KEY],
    properties: { ...schema.properties, [JUDGMENT_KEY]: judgmentSchema() }
  })
}

module.exports = {
  JUDGMENT_STATUS,
  JUDGMENT_KEY,
  STATUSES,
  JUDGMENT_REFUSED,
  MAX_STATEMENT_CHARS,
  MAX_ITEM_CHARS,
  MAX_ITEMS,
  judgmentSchema,
  withJudgment,
  judgeExecutiveJudgment,
  renderJudgment,
  judgmentDirective
}
