'use strict'
/**
 * routeAuthorSplit.test.js — route deterministically, author only when it is an action.
 *
 * ⛔ NO NETWORK. The llm is a counter.
 *
 * HR-71: this is a DELETION of a second router, not the addition of a first. turnRouter has
 * decided ACTION vs everything else, deterministically, since before this classifier existed.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { classifyIntent } = require('./intent')

function counter (result) {
  const state = { calls: 0 }
  state.llm = async () => { state.calls++; return result }
  return state
}
const DEVELOP = { intent: 'develop', task: 'edit line 2', targetProject: 'backend' }

test('*** ⛔ the ROUTER outranks the model: a hallucinated develop cannot become a work order ***', async () => {
  // Real messages from the Owner's record. The model is rigged to claim 'develop' on all of
  // them; the deterministic router said UTILITY / BUSINESS_QUERY, and that is not overridable.
  for (const m of ['聽日幾號？', '12乘34係幾多？', '香香，到 aroma system，看看今天要向 costco 訂什麼貨']) {
    const c = counter({ intent: 'develop', task: 'rm -rf', targetProject: 'backend', reply: '答你嘅嘢' })
    const r = await classifyIntent(m, c.llm)
    assert.equal(r.intent, 'chat', '⛔ ' + m + ' must never become a work order')
    assert.equal(r.task, undefined, 'and it carries no task')
    // ⛔ THE REPLY SURVIVES. My first version of this split skipped the model call entirely and
    // silently dropped the answer — this one call authors the chat reply too.
    assert.equal(r.reply, '答你嘅嘢')
  }
})

test('*** an ACTION still authors, and the task passes through verbatim ***', async () => {
  const c = counter(DEVELOP)
  const r = await classifyIntent('幫我改 docs/canary/agent-canary.md，第二行改成 line 3', c.llm)
  assert.equal(c.calls, 1, 'exactly one call — the authoring one')
  assert.equal(r.intent, 'develop')
  assert.equal(r.task, 'edit line 2')
})

test('*** ⛔ the CONVERSATION fallback is UNCHANGED — the model still decides ***', async () => {
  // routeTurn returns CONVERSATION with reason 'default' when nothing matched, at confidence
  // 'high'. It cannot express 「might be either」, and on a nine-character median most ordinary
  // chat lands here. Short-circuiting it would lose work requests; asking on it would
  // interrogate the Owner for saying 你好. So it keeps today's behaviour exactly.
  const c = counter(DEVELOP)
  const r = await classifyIntent('你好', c.llm)
  assert.equal(c.calls, 1, 'the residue still costs one call, as it did before the split')
  assert.equal(r.intent, 'develop', 'and the model, not the router, decided it')
})

test('*** ⛔ a router failure falls back to the MODEL, never to a guess ***', async () => {
  // Failing closed to "it must be chat" here would rebuild the lost-instruction defect inside
  // the very component added to stop paying for it.
  const turnRouter = require('../intake/turnRouter')
  const real = turnRouter.routeTurn
  turnRouter.routeTurn = () => { throw new Error('router exploded') }
  try {
    const c = counter(DEVELOP)
    const r = await classifyIntent('幫我改 docs/x.md', c.llm)
    assert.equal(c.calls, 1, 'the model is consulted exactly as it was before the split')
    assert.equal(r.intent, 'develop')
  } finally { turnRouter.routeTurn = real }
})

test('*** the classifier-unavailable contract survives the split ***', async () => {
  // The split must not reintroduce the lost instruction on the path it still uses.
  const r = await classifyIntent('幫我改 docs/x.md，第二行改成 line 3', async () => {
    throw Object.assign(new Error('timeout of 120000ms exceeded'), { isTimeout: true })
  })
  assert.equal(r.intent, 'unavailable')
  assert.equal(r.reason, 'timeout')
})
