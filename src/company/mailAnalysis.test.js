'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createMailAnalyzer } = require('./mailAnalysis')
const evidence = [{ id: 'abc', body: 'Louie please confirm by 2026-10-02. Invoice cancelled.', partial: false }]
const result = (category = 'decision') => ({ category, summary: 'Review invoice', messageId: 'abc', quote: 'please confirm',
  task: ['decision', 'follow_up'].includes(category) ? { text: 'Confirm invoice', messageId: 'abc', quote: 'Louie please confirm by 2026-10-02.', assignee: 'Louie', deadline: '2026-10-02' } : null,
  change: { kind: 'cancellation', messageId: 'abc', quote: 'Invoice cancelled.' } })
test('classifications remain evidence-backed suggestions; unknown fields stay null', async () => {
  for (const category of ['decision', 'follow_up', 'notification', 'promotion', 'unknown']) {
    const analyzer = createMailAnalyzer({ adapterFactory: () => ({ complete: async () => ({ text: JSON.stringify(result(category)), model: 'fixture' }) }) })
    const output = await analyzer.analyze({ evidence, decision: null })
    assert.equal(output.category, category); assert.equal(output.change.kind, 'cancellation')
    assert.equal(output.task?.deadline ?? null, ['decision', 'follow_up'].includes(category) ? '2026-10-02' : null)
  }
  const r = result(); r.task.assignee = r.task.deadline = null
  const analyzer = createMailAnalyzer({ adapterFactory: () => ({ complete: async () => ({ text: JSON.stringify(r) }) }) })
  assert.equal((await analyzer.analyze({ evidence })).task.assignee, null)
})
test('fabricated citations, inferred dates and unsupported people are rejected', async () => {
  for (const mutate of [r => { r.quote = 'missing' }, r => { r.task.deadline = '2026-10-03' }, r => { r.task.assignee = 'Ivy' }, r => { r.change.messageId = 'fff' }, r => { r.category = 'promotion' }]) {
    const r = result(); mutate(r)
    const analyzer = createMailAnalyzer({ adapterFactory: () => ({ complete: async () => ({ text: JSON.stringify(r) }) }) })
    await assert.rejects(analyzer.analyze({ evidence }), /invalid_mail_analysis/)
  }
})
test('timeout does not start overlapping subscription calls; failure can later retry', async () => {
  let release; let calls = 0
  const analyzer = createMailAnalyzer({ timeoutMs: 5, adapterFactory: () => ({ complete: () => { calls++; return new Promise(r => { release = r }) } }) })
  await assert.rejects(analyzer.analyze({ evidence }), /timeout/)
  await assert.rejects(analyzer.analyze({ evidence }), /busy/); assert.equal(calls, 1)
  release({ text: JSON.stringify(result()) }); await new Promise(r => setImmediate(r))
  const pending = analyzer.analyze({ evidence }); await Promise.resolve(); release({ text: JSON.stringify(result()) }); assert.equal((await pending).category, 'decision')
})
test('subscription unavailable is an error with no API fallback', async () => {
  const previous = process.env.CHAT_BACKEND
  process.env.CHAT_BACKEND = 'disabled'
  try { await assert.rejects(createMailAnalyzer().analyze({ evidence }), /subscription_unavailable/) }
  finally { if (previous === undefined) delete process.env.CHAT_BACKEND; else process.env.CHAT_BACKEND = previous }
})
