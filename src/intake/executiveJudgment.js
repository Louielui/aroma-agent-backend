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
        description: 'decided＝有足夠基礎，正常畀建議；provisional＝有嘢未知，但仍然可以畀一個有用嘅暫定判斷；blocked＝連一個負責任嘅暫定判斷都做唔到。'
      },
      statement: {
        type: 'string',
        description: '一句：你嘅立場。例如「我建議先做 A」。blocked 就填空字串。唔好喺度寫理由。'
      },
      uncertainties: {
        type: 'array',
        items: { type: 'string' },
        description: '最多三項，每項一句：而家未知、而會影響呢個判斷嘅嘢。'
      },
      changeIf: {
        type: 'array',
        items: { type: 'string' },
        description: '最多三項，每項一句：咩情況會令你改變上面嘅立場。'
      }
    },
    description: 'Owner 要你落判斷嗰陣先填，否則 null。唔係推理過程 —— 唔好喺度寫思考步驟或者分析。'
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
    out.push('我而家畀唔到一個負責任嘅判斷。')
  } else {
    out.push(j.statement)
    if (j.status === JUDGMENT_STATUS.PROVISIONAL) out.push('（呢個係暫定判斷。）')
  }
  if (j.uncertainties.length) out.push('未知：' + j.uncertainties.join('；'))
  if (j.changeIf.length) out.push('會改變我睇法嘅情況：' + j.changeIf.join('；'))
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
    '【判斷】Owner 呢條問題係要你落判斷。請填 judgment，唔好淨係反問。',
    '· 有足夠基礎 → status=decided，statement 寫低你嘅立場。',
    '· 有嘢未知但仍然講得出一個有用嘅初步立場 → status=provisional，照樣寫 statement，再喺 uncertainties 講明未知乜、喺 changeIf 講明咩情況會改變睇法。',
    '· 只有連一個負責任嘅暫定立場都做唔到，先至用 status=blocked（statement 留空），然後問一條最關鍵嘅問題。',
    '⛔ 資料唔齊唔等於冇意見。想問嘅嘢可以喺畀咗判斷之後先問。'
  ]
  if (frame.answerPosture === 'evidence_first') {
    lines.push('· 讀唔到嘅嘢當成 uncertainties，唔係換一條你啱好答到嘅問題。')
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
