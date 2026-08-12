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

test('*** ⛔ the CONVERSATION fallback narrows: the model decides only where a CHANGE is proposed ***', async () => {
  /**
   * ⛔ THIS ASSERTION WAS NARROWED ON PURPOSE, 2026-08-11, UNDER AN OWNER GO (HR-75).
   *
   * It used to assert that `classifyIntent('你好', …)` returns `develop` when the model says so
   * — 「the CONVERSATION fallback is UNCHANGED, the model still decides」. That was true, and it
   * is the hole the Owner walked into: 「給我 Aroma System 的 website」 also routes
   * CONVERSATION/'default', so his ordinary request became 「尚未建立任何提案」.
   *
   * ⛔ AND THE OLD ASSERTION CONTRADICTED THIS FILE'S OWN STATED INTENT, which is that 「a model
   * that hallucinates intent:'develop' on 「聽日幾號？」 can no longer create a work order」.
   * 「你好」 is that case exactly. The test was pinning the hallucination.
   *
   * NARROWED, NOT DELETED. The property it protects — a work request must never be lost to a
   * short-circuit — is asserted immediately below, and more strongly than before.
   */
  const c = counter(DEVELOP)
  const r = await classifyIntent('你好', c.llm)
  assert.equal(c.calls, 1, 'the residue still costs one call, as it did before the split')
  assert.equal(r.intent, 'chat', '⛔ 「你好」 proposes no change; a develop claim on it is refused')
})

test('*** ⛔ AND A REAL WORK REQUEST ON THE SAME FALLBACK IS STILL THE MODEL\'S TO DECIDE ***', async () => {
  // The half that matters more. Every genuine work request routes CONVERSATION/'default' too —
  // measured — so the guard MUST stay out of the way whenever a change is actually proposed.
  // A lost instruction is worse than a spurious proposal: the Owner asks for work, is told it
  // was a conversation, and never learns he asked.
  for (const m of ['幫我加一個匯出按鈕', '修復登入嗰個 bug', '部署最新版本上去']) {
    const c = counter(DEVELOP)
    const r = await classifyIntent(m, c.llm)
    assert.equal(r.intent, 'develop', '⛔ WORK REQUEST WOULD BE LOST: ' + m)
    assert.equal(c.calls, 1, 'and it still costs exactly one call')
  }
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
