'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { buildReadResultReply } = require('./readResultView')
const row = { source: 'public_knowledge', trust: 'live', sourceId: 'web-1', retrievedAt: '2026-10-11T20:55:04.902Z',
  fields: { provider: 'claude_subscription_search', consulted: true, sourceTitle: 'Weather source', url: 'https://weather.gc.ca/forecast' } }
test('the real reply formatter preserves links, original evidence time and unknown freshness in both languages', () => {
  for (const message of ['今天 Winnipeg 天氣如何？', 'What is the weather in Winnipeg today?']) {
    const input = { message, reply: 'A bounded weather summary.', itemsBySource: [{ source: 'public_knowledge', items: [row, row] }] }
    const out = buildReadResultReply(input)
    assert.equal(out.reply.split('https://weather.gc.ca/forecast').length - 1, 1)
    assert.ok(out.reply.includes(row.retrievedAt)); assert.match(out.reply, /未確認|unconfirmed/)
    assert.match(out.reply, /並非網站原文或此刻觀測|not publisher text or a current observation/)
    assert.equal(out.reply.includes('published today'), false)
  }
})
test('no evidence, failed reads, invented model URLs and legacy providers gain no public attribution', () => {
  for (const r of [null, { ...row, trust: 'unavailable' }, { ...row, fields: { ...row.fields, consulted: false } },
    { ...row, fields: { ...row.fields, url: 'javascript:alert(1)' } }, { ...row, fields: { ...row.fields, provider: 'legacy' } }]) {
    const out = buildReadResultReply({ message: 'Weather?', reply: 'No verified current answer.', itemsBySource: [{ source: 'public_knowledge', items: r ? [r] : [] }] })
    assert.equal(out.reply.includes('Search retrieved'), false)
  }
})
test('a public-only answer preserves the observed excerpt, units, uncertainty and age without releasing the model draft', () => {
  const observed = { ...row, content: 'At 11:05 CDT: 10°C. The source date is unconfirmed.', fields: { ...row.fields, contentKind: 'web_search_cited_summary' } }
  const out = buildReadResultReply({ message: 'Weather today?', reply: 'Invented 99°C right now.', itemsBySource: [{ source: 'public_knowledge', items: [observed] }] })
  assert.match(out.reply, /11:05 CDT: 10°C/); assert.match(out.reply, /earlier observations/)
  assert.ok(out.reply.includes(row.fields.url)); assert.ok(out.reply.includes(row.retrievedAt)); assert.doesNotMatch(out.reply, /99°C/)
  const mixed = buildReadResultReply({ message: 'Compare public weather and company records', reply: 'A bounded comparison.', itemsBySource: [{ source: 'public_knowledge', items: [observed] }, { source: 'gmail', items: [{ source: 'gmail', trust: 'live' }] }] })
  assert.doesNotMatch(mixed.reply, /These are excerpts/)
})
