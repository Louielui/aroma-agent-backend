'use strict'
/**
 * executiveFrame.js — X1. What the Owner is trying to accomplish, as a closed object.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS EXISTS, AND WHAT PHASE 0 FOUND.
 *
 * The goal decomposer already produces `question_restated` — one sentence naming the Owner's
 * problem — and Phase 0 traced its consumers: there are NONE. It is written into the judged
 * plan and read by nothing. The one representation of what Louie wants was being generated,
 * paid for, and thrown away on every turn.
 *
 * Meanwhile THREE modules reinterpret the Owner's message independently — turnRouter by
 * keyword, ownerSourceIntentResolver by world, laneRouter by lane — and not one of them is
 * given his goal. That is the pipeline shape the Owner keeps feeling: every component asks a
 * narrow question about the words, and nothing holds the problem.
 *
 * ⛔ SO THIS IS A DECISION STATE, NOT A REASONING TRACE. Four bounded fields, two of them
 * closed enums, two of them one short sentence each. There is nowhere here to put
 * deliberation, and that is deliberate: chain of thought would be a second, unreviewable
 * prose channel with none of the grounding the answer path has.
 *
 * ⛔ AND IT CARRIES NO AUTHORITY. It says what the Owner wants. It cannot say what may be
 * read, written, executed or sent — `sourcesForPlan` still decides sources from FACTS and
 * their operations, and this object is not consulted there. See x1CognitiveCore.test.js.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** ⛔ SMALL AND CLOSED. Eight kinds of work, not a taxonomy. An unknown value is refused. */
const TASK_TYPE = Object.freeze([
  'diagnose', 'prioritize', 'recommend', 'plan', 'retrieve', 'act', 'understand', 'converse'
])

/**
 * ⛔ POSTURE IS SEMANTIC, NEVER PERMISSION.
 *
 *   direct         answerable from his message and non-evidence context.
 *   provisional    form a best current judgement, say what is uncertain, say what would narrow it.
 *   evidence_first a useful answer materially depends on what was read.
 *
 * `evidence_first` does not authorise a read and `direct` does not skip one. Authorisation is
 * READ_ACCESS plus the per-source flags plus `sourcesForPlan`, exactly as before X1.
 */
const ANSWER_POSTURE = Object.freeze(['direct', 'provisional', 'evidence_first'])

/** Bounded, because a frame that can grow is a place for prose to hide. */
const MAX_SUCCESS_CHARS = 200

const FRAME_REFUSED = Object.freeze({
  ABSENT: 'no_executive_frame_returned',
  NOT_AN_OBJECT: 'executive_frame_was_not_an_object',
  BAD_TASK_TYPE: 'task_type_is_not_in_the_closed_list',
  BAD_POSTURE: 'answer_posture_is_not_in_the_closed_list',
  BAD_DECISION_NEEDED: 'decision_needed_was_not_a_boolean',
  BAD_SUCCESS: 'success_definition_missing_or_too_long'
})

/** The provider-side contract. Strict mode: every property required, optionality as null. */
function executiveFrameSchema () {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['taskType', 'decisionNeeded', 'successDefinition', 'answerPosture'],
    description: 'Owner 想達成乜嘢。唔係推理過程，唔好喺呢度寫思考步驟。',
    properties: {
      taskType: {
        type: 'string',
        enum: TASK_TYPE,
        description: 'diagnose＝查原因；prioritize＝排先後；recommend＝畀建議；plan＝計劃點做；retrieve＝攞返啲資料；act＝要動手做嘢；understand＝想搞清楚點運作；converse＝傾偈。'
      },
      decisionNeeded: {
        type: 'boolean',
        description: '有用嘅答案係咪需要你落一個判斷？淨係列返記錄就夠嘅話填 false。'
      },
      successDefinition: {
        type: 'string',
        description: '一句：一個有用嘅答案要做到乜。唔係覆述問題。'
      },
      answerPosture: {
        type: 'string',
        enum: ANSWER_POSTURE,
        description: 'direct＝唔使讀嘢都答得到；provisional＝先畀一個初步判斷同講明唔確定喺邊；evidence_first＝答案真係要靠讀返嚟嘅資料。'
      }
    }
  }
}

/**
 * Judge a raw frame.
 *
 * ⛔ IT NEVER NORMALISES. A value outside the closed list is REFUSED, not mapped to the
 * nearest plausible one. Quietly turning 「diagnostic」 into `diagnose` would manufacture an
 * understanding nobody produced — the same class of defect as inventing evidence, one layer up.
 *
 * @returns {{ok:true, frame:object} | {ok:false, reason:string}}
 */
function judgeExecutiveFrame (raw) {
  if (raw === null || raw === undefined) return { ok: false, reason: FRAME_REFUSED.ABSENT }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: FRAME_REFUSED.NOT_AN_OBJECT }
  if (!TASK_TYPE.includes(raw.taskType)) return { ok: false, reason: FRAME_REFUSED.BAD_TASK_TYPE }
  if (!ANSWER_POSTURE.includes(raw.answerPosture)) return { ok: false, reason: FRAME_REFUSED.BAD_POSTURE }
  if (typeof raw.decisionNeeded !== 'boolean') return { ok: false, reason: FRAME_REFUSED.BAD_DECISION_NEEDED }
  const success = typeof raw.successDefinition === 'string' ? raw.successDefinition.trim() : ''
  if (!success || success.length > MAX_SUCCESS_CHARS) return { ok: false, reason: FRAME_REFUSED.BAD_SUCCESS }
  return {
    ok: true,
    frame: Object.freeze({
      taskType: raw.taskType,
      decisionNeeded: raw.decisionNeeded,
      successDefinition: success,
      answerPosture: raw.answerPosture
    })
  }
}

/**
 * The block the MAIN model sees.
 *
 * ⛔ CONTEXT, NOT EVIDENCE, AND IT SAYS SO IN ITS OWN TEXT. It carries no row, no id, no
 * source name and no count, so there is nothing in it an Answer Plan could cite even if the
 * model tried — every citation is checked against the evidence index, which this never enters.
 *
 * ⛔ AND THE LAST LINE IS THE POINT OF THE WHOLE TRANCHE. When a required fact cannot be read,
 * the answer must stay about the Owner's problem. It must not quietly become about whatever
 * happened to be readable — which is exactly what production 97425e9d did with four inventory
 * rows when the question was about Gmail.
 */
function executiveFrameBlock (plan) {
  const frame = plan && plan.executiveFrame
  /**
   * ⛔ S1 — WHEN HE IS ASKING FOR AN ABILITY, THE TRUTH ABOUT IT TRAVELS WITH THE GOAL.
   *
   * 「幫我加到 calendar」 has a goal AND a capability. Carrying the goal without the capability
   * is how a model ends up asking for a start time for an event it can never create.
   * `not_implemented` is authoritative and is stated as such; `implemented` is stated WITHOUT
   * any claim that it works right now, because nothing here has tried it.
   */
  const cap = plan && plan.requestedCapability
  const capImpl = plan && plan.requestedCapabilityImplementation
  const restated = plan && typeof plan.questionRestated === 'string' ? plan.questionRestated.trim() : ''
  if (!frame && !restated && !cap) return null

  const lines = ['【EXECUTIVE FRAME — 呢個係理解，唔係證據，亦唔係授權】']
  if (restated) lines.push('Owner 想解決嘅係：' + restated)
  if (frame) {
    lines.push('工作類型：' + frame.taskType)
    lines.push('需要你落判斷：' + (frame.decisionNeeded ? '係' : '唔使'))
    lines.push('作答姿態：' + frame.answerPosture)
    lines.push('點先算有用：' + frame.successDefinition)
    if (frame.answerPosture === 'provisional') {
      lines.push('（provisional：資料唔齊係一個限制，唔係叫你唔記得咗個問題。畀一個初步判斷、講明唔肯定喺邊、同埋補到啲乜就會準啲。）')
    }
  }
  if (cap) {
    lines.push('佢要求嘅能力：' + cap)
    if (capImpl === 'not_implemented') {
      lines.push('⛔ 呢個能力喺依家呢個版本【未實作】。呢個係確定嘅事實，唔係暫時連唔到。' +
        '唔好應承做、唔好扮問細節當跟住會做、亦唔好講成係connection問題。照直講做唔到，然後講返你幫得到嘅係邊部分。')
    } else if (capImpl === 'implemented') {
      lines.push('呢個能力已實作，但已實作唔等於而家連得到 —— 除非今個回合真係試過，否則唔好講到實得。')
    }
  }
  lines.push('⛔ 讀唔到嘅嘢係限制，唔係換題目嘅理由。手上啱好有嘅資料要服務上面呢個目標；如果佢答唔到，就照直講答唔到，唔好改為答另一條佢啱好答到嘅問題。')
  return lines.join('\n')
}

module.exports = {
  TASK_TYPE,
  ANSWER_POSTURE,
  MAX_SUCCESS_CHARS,
  FRAME_REFUSED,
  executiveFrameSchema,
  judgeExecutiveFrame,
  executiveFrameBlock
}
