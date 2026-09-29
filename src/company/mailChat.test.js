'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseMailRequest, createMailChat, todayQuery } = require('./mailChat')
test('mail routing uses explicit Owner words and separates search, summary and full text', () => {
  assert.equal(parseMailRequest('香香，行政部今天有什麼要我跟進？').mode, 'summary')
  assert.equal(parseMailRequest('搜尋行政部電郵：invoice').q, 'invoice')
  assert.equal(parseMailRequest('行政部電郵全文 abc123').id, 'abc123')
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
