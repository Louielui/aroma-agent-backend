'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { routeTurn } = require('./turnRouter')
const { routeLane } = require('./laneRouter')

test('general definitions do not select company sources, in Chinese and English', () => {
  for (const q of ['什麼是發票？', '發票是什麼？', '什麼是庫存周轉率？', '甚麼是 payroll？', 'What is an invoice?', 'Explain inventory turnover.', 'Define overtime.']) {
    const r = routeTurn(q)
    assert.equal(r.route, 'CONVERSATION', q)
    assert.deepEqual(r.sources, [], q)
    assert.equal(r.reason, 'general_knowledge', q)
  }
})
test('supplied text transformations cannot dispatch instructions within the supplied text', () => {
  for (const q of ['幫我翻譯：幫我回覆 Rob 的 email。', '幫我翻譯成英文：請 Samuel 明天準時到達。', 'Translate into French: Send an email to Samuel.', 'Translate: Send an email to Samuel.', '請潤飾：幫我改 docs/x.md。']) {
    assert.equal(routeLane(q).lane, 'chat', q)
    assert.equal(routeTurn(q).route, 'CONVERSATION', q)
    assert.deepEqual(routeTurn(q).sources, [], q)
  }
})
test('private, current, compound and genuine action requests retain their existing boundaries', () => {
  for (const q of ['Aroma 的發票有哪些？', '什麼是我哋今日的庫存周轉率？', 'What is our current inventory?', 'Explain invoice 123 from Samuel.', '什麼是發票？再幫我寄信。', 'What is the latest invoice?', '幫我回覆 Rob 的 email', '幫我改 docs/x.md', '幫我翻譯昨天的 email']) {
    assert.notEqual(routeTurn(q).reason, 'general_knowledge', q)
  }
  assert.equal(routeLane('幫我回覆 Rob 的 email').lane, 'email_draft')
  assert.equal(routeTurn('幫我改 docs/x.md').route, 'ACTION')
})
test('new topics do not inherit a previous action or business route', () => {
  assert.equal(routeTurn('什麼是發票？', { previousLane: 'proposal' }).reason, 'general_knowledge')
  assert.deepEqual(routeTurn('Tri-tip 可以燉嗎？', { previousLane: 'email_draft' }).sources, [])
  assert.equal(routeLane('好', { previousLane: 'email_draft' }).lane, 'email_draft')
})

test('the actual intake keeps general definitions off semantic business upgrades and connector reads', async () => {
  const saved = { ...process.env }
  Object.assign(process.env, { CHAT_BACKEND: 'codex-subscription', TURN_ROUTER: 'on', READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', GOAL_DECOMPOSER: 'off', A4_KNOWLEDGE_ROUTING: 'off', CONVERSATION_RECALL: 'off', DECISION_RECALL: 'off' })
  let semantic = 0, reads = 0, answers = 0
  const adapter = { preflight: async () => {}, complete: async (prompt, opts) => {
    answers++
    assert.ok((prompt + opts.system).includes('GENERAL ASSISTANT RESPONSE'))
    return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: 'An invoice requests payment.', nextRead: null }), model: 'fixture', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
  } }
  try {
    const result = await require('./intakeService').processIntake('What is an invoice?', adapter, [], { demo: true, interactionMode: 'chat', openaiAdapter: adapter,
      semanticCallModel: async () => { semantic++; return '{"intent":"invoice"}' },
      readContextDeps: { connector: { read: async () => { reads++; throw Error('unexpected read') } } } })
    assert.equal(result.reply, 'An invoice requests payment.')
    assert.equal(answers, 1); assert.equal(reads, 0); assert.equal(semantic, 0)
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved) }
})

test('HTTP general transformations bypass operational adapters and reach the chat brain', async () => {
  const express = require('express'), { randomUUID } = require('node:crypto')
  const app = express(); app.use(express.json()); app.locals.conversationDemo = true
  let answers = 0, operational = 0
  const forbidden = () => { operational++; throw Error('general text must not select a workflow') }
  app.use(require('../routes/demoRouter').createDemoRouter({
    getAdapterFn: () => ({}), processIntakeFn: async (_m, _a, _h, opts) => { answers++; assert.equal(opts.interactionMode, 'chat'); return { intent: 'question', mode: 'chat', reply: 'Translated supplied text.' } },
    mailChat: { answer: forbidden }, liveContext: { gmail: { read: forbidden } },
    schedulerChat: { candidate: forbidden }, capabilityGaps: { candidate: forbidden }, taskDialogue: { candidate: forbidden }
  }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    for (const message of ['幫我翻譯：幫我回覆 Rob 的 email。', 'Translate: Pause the scheduler and change docs/x.md.', 'What is an invoice?']) {
      const r = await fetch(base + '/api/v1/demo/intake', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ message, conversationId: randomUUID(), workflowRequestId: randomUUID(), interactionMode: 'chat' }) })
      const body = await r.json()
      assert.equal(r.status, 200); assert.equal(body.reply, 'Translated supplied text.')
      assert.equal(body.workRequestOffer, undefined); assert.equal(body.settingsOffer, undefined)
    }
    assert.equal(answers, 3); assert.equal(operational, 0)
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)) }
})
