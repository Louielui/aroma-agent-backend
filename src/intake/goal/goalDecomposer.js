'use strict'

/**
 * goalDecomposer.js — ONE call, before the loop, that says what the question NEEDS.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS IS NOT A SECOND REASONING LOOP, AND A TEST SAYS SO.
 *
 * `intake/reasoningLoop.js` already exists and is already wired. It runs Reason → Read →
 * Observe → Final, bounded at three steps, choosing from a closed vocabulary. Nothing here
 * loops, reads, or executes; there is no step counter and no capability dispatch in this file.
 *
 * What the loop cannot do is state a REQUIREMENT. It is greedy: at each step it picks one next
 * read, so it discovers 「this question needs something this system does not have」 by wandering
 * into it, or never. That is the gap, and it is the whole of what this file fills.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ IT NEVER RECEIVES A DATA ROW ──────────────────────────────────────────
 * The prompt is the question plus a catalogue of SHAPES generated from frozen tables. No
 * inventory, no invoices, no counts. That is what keeps the call cheap, and more importantly it
 * is what stops the decomposer reasoning over evidence nobody gave it — planning and reading
 * stay different jobs.
 *
 * ── PROVIDER NEUTRAL, STRUCTURALLY ──────────────────────────────────────────
 * Handed `callModel`; never learns what is behind it. No provider name, no adapter import, no
 * branch — the same arrangement `reasoningLoop.js` uses, and a test greps for it.
 */

const { catalogueForPrompt } = require('./operationCatalogue')
const { goalPlanSchema, judgeGoalPlan, MAX_FACTS } = require('./goalPlanContract')

const REFUSED = Object.freeze({
  NO_QUESTION: 'no_question_to_decompose',
  NO_MODEL: 'no_model_call_supplied',
  MODEL_FAILED: 'the_decomposer_call_did_not_return_a_usable_plan'
})

/**
 * The instruction. Short on purpose: the enums do the constraining, not the prose.
 *
 * ⛔ NOTHING HERE ASKS THE MODEL TO BE HONEST ABOUT AVAILABILITY. It cannot lie usefully — every
 * status is recomputed from the catalogue in `judgeGoalPlan`. The prompt only has to get the
 * question decomposed; the contract decides what is true.
 */
/**
 * ⛔ X1 — CONTEXT, AND IT IS LABELLED AS CONTEXT IN THE PROMPT ITSELF.
 *
 * These are the recall blocks production ALREADY built, a few lines earlier in the same
 * prompt build. Nothing is queried, read or retrieved here: they arrive as strings that
 * already exist, so X1 adds no store read, no connector call and no model call.
 *
 * ⛔ THEY ANSWER ONE QUESTION ONLY: 「what is Louie talking about」. They do NOT answer
 * 「what is true right now」. A remembered decision is not a live row — it carries no source,
 * no id and no trust, and can never become an evidence citation, because every citation is
 * checked against the evidence index and recall never enters it. The prompt says so in the
 * same words rather than relying on the model to infer it.
 */
function contextSection (contextBlocks) {
  const blocks = (Array.isArray(contextBlocks) ? contextBlocks : [])
    .filter((b) => typeof b === 'string' && b.trim() !== '')
  if (!blocks.length) return []
  return [
    '【背景 — 呢啲係 CONTEXT，唔係 EVIDENCE】',
    '用嚟理解 Owner 而家講緊乜。唔可以當佢係「而家嘅事實」，亦唔可以因為佢入面提過某個來源就當要讀嗰個來源。',
    blocks.join(String.fromCharCode(10)),
    ''
  ]
}

/**
 * ⛔ X2 — THE CURRENT EXCHANGE, KEPT APART FROM MEMORY ON PURPOSE.
 *
 * `contextSection` above carries recall of OTHER conversations. This carries the turns of
 * THIS one. They are rendered as two different blocks with two different labels because
 * they answer two different questions — 「what did we decide before」 versus 「what are we in
 * the middle of right now」 — and production 7b0699ce proved the second one was missing.
 */
function workingSection (workingContext) {
  const block = (workingContext && typeof workingContext.block === 'string') ? workingContext.block : ''
  return block ? [block, ''] : []
}

function buildPrompt (question, catalogue, contextBlocks, workingContext) {
  return [
    /**
     * ⛔ THE ORDER OF THESE FIVE STEPS IS THE TRANCHE.
     *
     * This used to open 「你只係講要答呢條問題需要邊幾樣事實」 — a question about TOOLS, asked
     * before anyone had established what the Owner wanted. That is how a request to prioritise
     * Gmail became four inventory rows: nothing in the turn ever held the goal, so the first
     * component with an answer got to define the problem.
     */
    '你係 Aroma 系統嘅 cognitive core。喺諗「要讀啲乜」之前，你要先搞清楚 Owner 想達成乜。',
    '',
    '照呢個次序做：',
    '1. Owner 真正想解決嘅係咩問題（唔係佢用咗邊啲字）。',
    '2. 一個有用嘅答案要做到乜先算數。',
    '3. 呢條問題係咪需要你落判斷，定係淨係攞返記錄就夠。',
    '4. 咁樣答，實際需要邊幾樣事實。',
    '5. 最後先至將嗰啲事實對應去讀取操作。',
    '',
    'Owner 條問題：',
    question,
    '',
    ...workingSection(workingContext),
    ...contextSection(contextBlocks),
    '你可以要求嘅讀取操作（呢個就係全部，冇其他）：',
    JSON.stringify(catalogue, null, 1),
    '',
    '規則：',
    '- 最多 ' + MAX_FACTS + ' 樣事實。',
    '- 每樣事實要指明 operation、entity、同你需要嘅欄位名。',
    '- 如果冇任何 operation 承載得到某樣事實，operation 同 entity 都填 null。**唔好就近搵一個似樣嘅頂替。**',
    '- 如果要把兩個 operation 嘅記錄對起身，喺 joins 度講明，唔好當佢一定接得通。',
    /**
     * ⛔ MENTIONING A SOURCE IS NOT ASKING FOR IT. Stated because the opposite is the easy
     * mistake: 「唔好讀 Gmail，我只係想討論 Gmail 點運作」 contains the word Gmail twice and
     * requires reading it zero times. This is an UNDERSTANDING rule — X1 adds no new veto, and
     * authorisation is still decided entirely by sourcesForPlan and the Owner's own flags.
     */
    '- 提到一個來源嘅名，唔等於要讀嗰個來源。討論、舉例、或者明講「唔好讀」，都唔算需要嗰啲資料。',
    '- executive_frame 要填晒：taskType、decisionNeeded、successDefinition、answerPosture。',
    '- executive_frame 唔係推理過程。唔好喺度寫思考步驟、分析或者理由，淨係填嗰四格。'
  ].join(String.fromCharCode(10))
}

/**
 * Decompose one question into a bounded, judged requirement.
 *
 * @param {{question:string, callModel:Function, model?:string}} input
 * @returns {Promise<{ok:boolean, reason?:string, plan?:object, usage?:object}>}
 */
async function decomposeGoal (input = {}) {
  const question = typeof input.question === 'string' ? input.question.trim() : ''
  if (!question) return { ok: false, reason: REFUSED.NO_QUESTION }
  if (typeof input.callModel !== 'function') return { ok: false, reason: REFUSED.NO_MODEL }

  const catalogue = catalogueForPrompt()
  const startedAt = Date.now()

  let raw = null
  let usage = null
  try {
    const res = await input.callModel({
      prompt: buildPrompt(question, catalogue, input.contextBlocks, input.workingContext),
      responseFormat: { type: 'json_schema', name: 'goal_plan', schema: goalPlanSchema(), strict: true }
    })
    // The adapter may hand back a parsed object or a JSON string; both are accepted, and
    // anything else is a failure rather than a guess.
    const body = res && (res.parsed || res.json || res.text || res.content || res)
    raw = typeof body === 'string' ? JSON.parse(body) : body
    usage = (res && res.usage) || null
  } catch (e) {
    return { ok: false, reason: REFUSED.MODEL_FAILED, detail: e && e.message ? e.message : String(e) }
  }

  const judged = judgeGoalPlan(raw)
  /**
   * ⛔ X2 — A REFUSED FACT PLAN STILL REPORTS WHAT HE WAS UNDERSTOOD TO WANT.
   *
   * `ok:false` still means 「there is no usable fact plan」 and callers still treat it exactly
   * as they did — `decomposeOnce` returns null, `sourcesForPlan` narrows nothing, the pre-B
   * fallback stands. What changes is that the understanding no longer dies with it.
   */
  if (!judged.ok) return { ok: false, reason: judged.reason, understanding: judged.understanding || null }

  return {
    ok: true,
    plan: judged.plan,
    /**
     * ⛔ MEASURED, NOT ESTIMATED. Owner instruction: the per-query cost is taken from the first
     * real run. Whatever the provider reported is carried verbatim, and `null` stays null —
     * an absent usage block is not a zero.
     */
    usage: Object.freeze({
      inputTokens: usage && usage.inputTokens != null ? usage.inputTokens : (usage && usage.prompt_tokens != null ? usage.prompt_tokens : null),
      outputTokens: usage && usage.outputTokens != null ? usage.outputTokens : (usage && usage.completion_tokens != null ? usage.completion_tokens : null),
      model: (input.model || (usage && usage.model)) || null,
      elapsedMs: Date.now() - startedAt
    })
  }
}

module.exports = { decomposeGoal, buildPrompt, REFUSED }
