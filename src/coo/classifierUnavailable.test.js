'use strict'
/**
 * classifierUnavailable.test.js — a lost instruction must not look like a conversation.
 *
 * ⛔ NO NETWORK. The `llm` is injectable and every case here is a fake.
 *
 * The Owner asks for work, the classifier times out, and he used to receive a chat reply with
 * no Proposal and no trace. Not a degraded answer — a LOST INSTRUCTION he would never know he
 * had given. HR-67's shape, one subsystem over.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { classifyIntent } = require('./intent')

const DEV = '幫我改 docs/canary/agent-canary.md，第二行改成 line 3'

test('*** ⛔ a TIMEOUT is unavailable, never intent:chat ***', async () => {
  const r = await classifyIntent(DEV, async () => {
    throw Object.assign(new Error('Claude API network error: timeout of 30000ms exceeded'), { isTimeout: true })
  })
  assert.equal(r.intent, 'unavailable', '⛔ this is the whole defect: it used to be "chat"')
  assert.notEqual(r.intent, 'chat')
  assert.equal(r.reason, 'timeout', 'and WHICH kind of not-finding-out it was')
})

test('*** an unreadable response is unavailable, and says so distinctly from a timeout ***', async () => {
  const r = await classifyIntent(DEV, async () => {
    throw Object.assign(new Error('Claude response had no readable text block'), { unreadableResponse: true })
  })
  assert.equal(r.intent, 'unavailable')
  assert.equal(r.reason, 'unreadable')

  // The provider's own overload is a third arrival shape and no ceiling fixes it.
  const o = await classifyIntent(DEV, async () => { throw new Error('Overloaded') })
  assert.equal(o.reason, 'overloaded')
})

test('*** a garbage return value is unavailable, not chat ***', async () => {
  for (const bad of [null, undefined, 'a string', 42]) {
    const r = await classifyIntent(DEV, async () => bad)
    assert.equal(r.intent, 'unavailable', JSON.stringify(bad))
    assert.equal(r.reason, 'unreadable')
  }
})

test('*** ⛔ a REAL chat answer is still chat — the fix must not swallow the ordinary case ***', async () => {
  const r = await classifyIntent('聽日幾號？', async () => ({ intent: 'chat', reply: '聽日 8 月 12 號。' }))
  assert.equal(r.intent, 'chat')
  assert.equal(r.reply, '聽日 8 月 12 號。')
})

test('*** a valid development request is untouched ***', async () => {
  const r = await classifyIntent(DEV, async () => ({ intent: 'develop', task: 'edit line 2', targetProject: 'backend' }))
  assert.equal(r.intent, 'develop')
  assert.equal(r.task, 'edit line 2', 'the task is passed through VERBATIM')
})

test('*** ⛔ propose() reports unavailable and creates NO proposal ***', async () => {
  const { createProposalStore } = require('./proposal')
  // A runStore is required by construction — the store refuses to exist without the thing
  // that could start a Run. Never called on this path, which is part of what is asserted.
  const runStore = { startRun () { throw new Error('⛔ a Run must NEVER start from an unavailable classifier') } }
  const store = createProposalStore({ runStore, persistence: false })
  const before = store.listProposals ? store.listProposals().length : 0

  const out = await store.propose({
    conversationId: 'c1', message: DEV,
    llm: async () => { throw Object.assign(new Error('timeout of 30000ms exceeded'), { isTimeout: true }) }
  })

  assert.equal(out.intent, 'unavailable', '⛔ NOT chat — he asked for work and must be told we failed')
  assert.equal(out.proposal, null, 'and no half-built work order exists')
  assert.equal(out.reason, 'timeout')
  if (store.listProposals) assert.equal(store.listProposals().length, before, 'nothing was persisted')
})
