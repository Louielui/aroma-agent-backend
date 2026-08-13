'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { runReasoningLoop, STOP } = require('./reasoningLoop')

/**
 * ⛔ THE TURN THAT CAUSED THIS, requestId a389dd4d-…, commit 7c64ac4, real UI path.
 *
 *   step 1 read aroma_system.purchasing     ok:true
 *   step 2 read aroma_system.inventory      ok:true
 *   step 3 read aroma_system.replenishment  ok:true
 *   stopReason:"step_limit"  observations:3
 *   [AROMA-ANSWER-PLAN] outcome:"fallback" reason:"no_plan_returned" modelItemCount:0
 *
 * Three successful reads, and then no budget left to say anything about them. Everything the
 * Owner read — no ranking, PO rows under an inventory heading, the triplicated count — came
 * from the fallback, which never had a plan to work from.
 */
const CAPS = ['aroma_system.purchasing', 'aroma_system.inventory', 'aroma_system.replenishment']

/** A model that reads until the budget is gone and would answer if ever asked. */
function readerThenAnswer (reads) {
  const calls = []
  return {
    calls,
    callModel: async ({ step, composeOnly }) => {
      calls.push({ step, composeOnly: composeOnly === true })
      if (composeOnly) return { type: 'final', result: { answer: 'composed' } }
      if (calls.filter((c) => !c.composeOnly).length <= reads) {
        return { type: 'read', capability: CAPS[(calls.length - 1) % CAPS.length] }
      }
      return { type: 'final', result: { answer: 'composed' } }
    }
  }
}

const okRead = async () => ({ ok: true, summary: 'rows' })

test('*** ⛔ THE CANARY TURN — three reads consume the budget and it STILL composes ***', () => {
  return (async () => {
    const m = readerThenAnswer(3)
    const out = await runReasoningLoop({
      callModel: m.callModel, executeRead: okRead, capabilities: CAPS
    })
    assert.equal(out.stopReason, STOP.COMPOSED_AFTER_READS, 'stopReason: ' + out.stopReason)
    assert.ok(out.result, '⛔ starvation still produced no answer')
    assert.equal(out.result.answer, 'composed')
    assert.equal(out.observations.length, 3, 'all three reads are carried into composition')
    // ⛔ The reserved call must be marked, so the model knows it may not read again.
    const reserved = m.calls.filter((c) => c.composeOnly)
    assert.equal(reserved.length, 1, 'exactly one reserved compose call')
  })()
})

test('*** ⛔ THE RESERVED CALL IS BOUNDED — it may not read, so it cannot extend the turn ***', () => {
  return (async () => {
    // A model that tries to keep reading on the reserved call must not be allowed to.
    let reads = 0
    const out = await runReasoningLoop({
      callModel: async ({ composeOnly }) => {
        if (composeOnly) return { type: 'read', capability: CAPS[0] } // tries to read again
        return { type: 'read', capability: CAPS[0] }
      },
      executeRead: async () => { reads++; return { ok: true, summary: 'r' } },
      capabilities: CAPS
    })
    assert.equal(reads, 3, '⛔ the reserved call performed a read: ' + reads)
    assert.equal(out.stopReason, STOP.STEP_LIMIT_NO_COMPOSE)
    assert.equal(out.result, null)
  })()
})

test('*** ⛔ EXHAUSTION AND GENUINE PLAN FAILURE ARE DIFFERENT STOP REASONS ***', () => {
  return (async () => {
    // Genuine failure: the model has budget left and still returns nothing usable.
    const genuine = await runReasoningLoop({
      callModel: async () => ({ type: 'final', result: null }),
      executeRead: okRead, capabilities: CAPS
    })
    // Exhaustion: reads consumed the budget, and the reserved call also produced nothing.
    const starved = await runReasoningLoop({
      callModel: async ({ composeOnly }) => composeOnly
        ? { type: 'final', result: null }
        : { type: 'read', capability: CAPS[0] },
      executeRead: okRead, capabilities: CAPS
    })
    assert.notEqual(genuine.stopReason, starved.stopReason,
      '⛔ indistinguishable in the log: both ' + genuine.stopReason)
    assert.equal(starved.stopReason, STOP.STEP_LIMIT_NO_COMPOSE)
    assert.equal(genuine.stopReason, STOP.FINAL, 'a model that answers with null still FINALised')
  })()
})

test('*** the fallback path survives — a genuine no-plan still returns no result ***', () => {
  return (async () => {
    const out = await runReasoningLoop({
      callModel: async () => ({ type: 'final', result: null }),
      executeRead: okRead, capabilities: CAPS
    })
    assert.equal(out.result, null, 'the caller still renders its deterministic fallback')
  })()
})

test('*** ⛔ A TURN THAT NEVER READ GETS NO RESERVED CALL — no free extra model call ***', () => {
  return (async () => {
    // Nothing was gathered, so there is nothing to compose FROM. Granting a call here would
    // buy a second attempt at planning, which is not what this reserve is for.
    let calls = 0
    const out = await runReasoningLoop({
      callModel: async () => { calls++; return { type: 'nonsense' } },
      executeRead: okRead, capabilities: CAPS
    })
    assert.equal(calls, 3, '⛔ a fourth call was granted with zero observations: ' + calls)
    assert.equal(out.stopReason, STOP.STEP_LIMIT)
  })()
})

test('*** an ordinary turn that finishes early is unchanged — no reserved call ***', () => {
  return (async () => {
    let calls = 0
    const out = await runReasoningLoop({
      callModel: async ({ step }) => {
        calls++
        if (step === 1) return { type: 'read', capability: CAPS[0] }
        return { type: 'final', result: { answer: 'done' } }
      },
      executeRead: okRead, capabilities: CAPS
    })
    assert.equal(out.stopReason, STOP.FINAL)
    assert.equal(calls, 2, 'two calls, no reserve — the budget was never exhausted')
  })()
})

/* ═══ THE COST OF THE DECISION MUST BE VISIBLE ═══════════════════════════ */

test('*** ⛔ ORDINARY TURNS PAY NOTHING EXTRA — the reserve is not a general raise ***', () => {
  return (async () => {
    // Answers immediately: one call, as before the bound moved.
    const straight = await runReasoningLoop({
      callModel: async () => ({ type: 'final', result: { answer: 'a' } }),
      executeRead: okRead, capabilities: CAPS
    })
    assert.equal(straight.modelCalls, 1, '⛔ an immediate answer got charged extra')

    // One read then answers: two calls.
    let n = 0
    const oneRead = await runReasoningLoop({
      callModel: async () => (++n === 1
        ? { type: 'read', capability: CAPS[0] }
        : { type: 'final', result: { answer: 'a' } }),
      executeRead: okRead, capabilities: CAPS
    })
    assert.equal(oneRead.modelCalls, 2, '⛔ a one-read turn got charged extra')
    assert.equal(oneRead.stopReason, STOP.FINAL)
  })()
})

test('*** ⛔ modelCalls IS COUNTED, NOT DERIVED — and 4 is the default worst case ***', () => {
  return (async () => {
    const m = readerThenAnswer(3)
    const out = await runReasoningLoop({
      callModel: m.callModel, executeRead: okRead, capabilities: CAPS
    })
    assert.equal(out.modelCalls, 4, 'three reads plus one reserved compose')
    assert.equal(out.modelCalls, m.calls.length, '⛔ the reported count is not the real count')

    // A turn with zero observations gets no reserve, so it stays at 3.
    const barren = await runReasoningLoop({
      callModel: async () => ({ type: 'nonsense' }),
      executeRead: okRead, capabilities: CAPS
    })
    assert.equal(barren.modelCalls, 3, 'nothing gathered, nothing reserved')
  })()
})

test('*** ⛔ THE RESERVED CALL IS NOT AN ESCAPE HATCH AROUND beforeTerminal ***', () => {
  return (async () => {
    // A required world was never satisfied. The guard refuses the final in the loop; it must
    // refuse it on the reserved call too, or an answer ships simply by arriving one step later.
    let refusals = 0
    const out = await runReasoningLoop({
      callModel: async ({ composeOnly }) => composeOnly
        ? { type: 'final', result: { answer: 'snuck through' } }
        : { type: 'read', capability: CAPS[0] },
      executeRead: okRead,
      capabilities: CAPS,
      beforeTerminal: async () => { refusals++; return { type: 'refuse', observation: { ok: false, error: 'world_missing' } } }
    })
    assert.equal(refusals, 1, 'the guard was consulted on the reserved call')
    assert.equal(out.result, null, '⛔ an answer the guard refused was shipped: ' + JSON.stringify(out.result))
    assert.equal(out.stopReason, STOP.BEFORE_TERMINAL)
  })()
})
