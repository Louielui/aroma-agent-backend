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
function buildPrompt (question, catalogue) {
  return [
    '你係 Aroma 系統嘅 goal decomposer。你唔答問題，你只係講：要答呢條問題，需要邊幾樣事實。',
    '',
    'Owner 條問題：',
    question,
    '',
    '你可以要求嘅讀取操作（呢個就係全部，冇其他）：',
    JSON.stringify(catalogue, null, 1),
    '',
    '規則：',
    '- 最多 ' + MAX_FACTS + ' 樣事實。',
    '- 每樣事實要指明 operation、entity、同你需要嘅欄位名。',
    '- 如果冇任何 operation 承載得到某樣事實，operation 同 entity 都填 null。**唔好就近搵一個似樣嘅頂替。**',
    '- 如果要把兩個 operation 嘅記錄對起身，喺 joins 度講明，唔好當佢一定接得通。'
  ].join('\n')
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
      prompt: buildPrompt(question, catalogue),
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
  if (!judged.ok) return { ok: false, reason: judged.reason }

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
