'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseMailRequest, createMailChat, todayQuery } = require('./mailChat')
test('mail routing uses explicit Owner words and separates search, summary and full text', () => {
  assert.equal(parseMailRequest('香香，行政部今天有什麼要我跟進？').mode, 'summary')
  assert.equal(parseMailRequest('搜尋行政部電郵：invoice').q, 'invoice')
  assert.equal(parseMailRequest('搜尋行政部電郵：' + 'x'.repeat(401)).q.length, 401)
  assert.equal(parseMailRequest('行政部電郵全文 abc123').id, 'abc123')
  assert.deepEqual(parseMailRequest('行政部電郵記憶：invoice'), { mode: 'memory', q: 'invoice' })
  assert.equal(parseMailRequest('不要讀行政部電郵'), null)
  assert.equal(parseMailRequest('例如「行政部今天有什麼要我跟進？」'), null)
  assert.equal(parseMailRequest('幫我寄行政部電郵'), null)
  assert.equal(parseMailRequest('我的電郵'), null)
  assert.match(todayQuery(new Date('2026-09-29T20:00:00Z')), /^after:\d+ before:\d+$/)
})
test('summaries cite only retrieved IDs and validate follow-up evidence; source content never acts', async () => {
  let models = 0; let invalid = false; let revoked = false
  const mailbox = { search: async () => ({ mailbox: 'adm@example.test', messages: [{ id: 'abc123' }], truncated: true, readAt: 'now' }),
    read: async () => ({ id: 'abc123', body: 'Please confirm delivery.', bodyState: 'available', link: 'https://mail.google.com/mail/?authuser=adm#all/abc123' }),
    lease: () => () => { if (revoked) throw Error('mail_access_denied') } }
  const chat = createMailChat({ mailbox, adapterFactory: () => ({ complete: async () => { models++; return { text: JSON.stringify({ items: [{ id: invalid ? 'unknown' : 'abc123', summary: 'Delivery confirmation', followUp: 'Confirm with supplier', quote: 'Please confirm delivery.' }] }) } } }) })
  const result = await chat.answer({ mode: 'summary', today: true }, 'question')
  assert.equal(models, 1); assert.match(result.reply, /abc123/); assert.equal(result.messageCount, 1)
  invalid = true; const fallback = await chat.answer({ mode: 'summary' }, 'question')
  assert.equal(fallback.summaryState, 'unavailable'); assert.ok(!fallback.reply.includes('Confirm with supplier'))
  revoked = true; await assert.rejects(chat.answer({ mode: 'summary' }, 'question'), /mail_access_denied/)
})
test('empty search never starts a model; read failure stays an error', async () => {
  let calls = 0
  const chat = createMailChat({ mailbox: { search: async () => ({ messages: [], mailbox: 'adm@example.test' }), lease: () => () => {} }, adapterFactory: () => { calls++; throw Error('unexpected') } })
  assert.equal((await chat.answer({ mode: 'search', q: 'none' }, 'question')).messageCount, 0); assert.equal(calls, 0)
})
test('mail memory is recalled only through its source gate without model generation', async () => {
  let access = true; let models = 0
  const chat = createMailChat({ mailbox: {}, memory: { list: async () => {
    if (!access) throw Error('mail_access_denied')
    return { items: [{ subject: 'Invoice', text: 'Owner decided to review', source: { url: 'https://mail.google.com/mail/#all/abc' }, status: 'active', details: { needsReview: true } }] }
  } }, adapterFactory: () => { models++; throw Error('unexpected') } })
  assert.match((await chat.answer({ mode: 'memory', q: 'invoice' })).reply, /Owner decided to review/)
  assert.equal(models, 0); access = false; await assert.rejects(chat.answer({ mode: 'memory', q: '' }), /denied/)
})
test('natural historical mail intent and scoped follow-up stay in the transient source-bound lane', () => {
  assert.deepEqual(parseMailRequest('上次供應商答應了甚麼？'), { mode: 'recall', q: '上次供應商答應了甚麼？' })
  assert.equal(parseMailRequest('上次行政部電郵原話是甚麼？').mode, 'recall')
  assert.equal(parseMailRequest('What did the supplier promise in their previous email?').mode, 'recall')
  assert.equal(parseMailRequest('佢原話係點？', [{ role: 'user', text: '上次供應商答應了甚麼？' }]).mode, 'recall')
  assert.equal(parseMailRequest('佢話哪天？', [{ role: 'user', content: '上次供應商答應了甚麼？' }]).mode, 'recall')
  assert.equal(parseMailRequest('佢原話係點？', [{ role: 'assistant', text: 'Previous vendor email' }]), null)
  assert.equal(parseMailRequest('行政部今天有甚麼電郵？').mode, 'summary')
  assert.equal(parseMailRequest('供應商最新價錢是多少？'), null)
  assert.equal(parseMailRequest('寄出電郵通知供應商上次承諾'), null)
  assert.equal(parseMailRequest('What was in my personal email last Friday?'), null)
})
test('natural recall renders current originals and approved decision with hash/date citations without another model', async () => {
  let models = 0; let recalled
  const chat = createMailChat({ mailbox: {}, memory: { recall: async (actor, query) => {
    assert.equal(actor.owner, true); recalled = query
    const rows = [{ documentId: 'xx-test', sourceId: 'abc', text: 'Vendor promised Friday.', date: null,
      contentHash: 'abc-hash', url: 'https://mail.google.com/mail/#all/abc', subject: 'Delivery', from: 'Vendor', partial: true,
      canonicalDecision: { text: 'Owner decided Monday.', approval: { kind: 'owner' }, needsReview: true } }]
    rows.retrieval = { source: 'ok', semantic: 'unavailable', coverage: 'saved_sources_only', total: 9, truncated: true }; return rows
  } }, adapterFactory: () => { models++; throw Error('unexpected') } })
  const result = await chat.answer({ mode: 'recall', q: 'supplier promise' }, 'question')
  assert.equal(recalled, 'supplier promise'); assert.equal(result.messageCount, 1); assert.equal(result.summaryState, 'not_requested')
  assert.match(result.reply, /Vendor promised Friday/); assert.match(result.reply, /Owner decided Monday/)
  assert.match(result.reply, /abc-hash/); assert.match(result.reply, /xx-test/); assert.equal(models, 0)
  assert.equal(result.sourceBound, true)
})
