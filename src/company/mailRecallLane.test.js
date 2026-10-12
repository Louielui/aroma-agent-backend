'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')
const { createDemoRouter } = require('../routes/demoRouter')
const { createMailChat } = require('./mailChat')

test('historical mail and follow-up recheck source permission, save only receipts, and leave ordinary history clean', async t => {
  const savedFlag = process.env.TURN_ROUTER; delete process.env.TURN_ROUTER
  t.after(() => { if (savedFlag === undefined) delete process.env.TURN_ROUTER; else process.env.TURN_ROUTER = savedFlag })
  let access = true; let recalls = 0; let models = 0; const persisted = []; const ordinary = []; const journal = []
  const mailChat = createMailChat({ mailbox: {}, memory: { recall: async actor => {
    assert.equal(actor.owner, true); if (!access) throw Error('mail_access_denied'); recalls++
    const rows = [{ documentId: 'xx-source', sourceId: 'abc', date: null, contentHash: 'fixture-hash', subject: 'Delivery', text: 'PRIVATE MAIL PROMISE', url: 'https://mail.google.com/mail/#all/abc' }]
    rows.retrieval = { source: 'ok', semantic: 'not_connected', total: 1 }; return rows
  } }, adapterFactory: () => { models++; throw Error('unexpected_model') } })
  const app = express(); app.locals.conversationDemo = true; app.use(express.json())
  app.use((req, res, next) => req.headers.authorization === 'Bearer fixture-owner' ? next() : res.status(401).end())
  app.use(createDemoRouter({ mailChat, getAdapterFn: () => ({ providerName: 'spy' }),
    conversationStore: { appendTurn: turn => persisted.push(turn) }, memoryJournal: { event: (...args) => { journal.push(args); return { state: 'paused' } } },
    processIntakeFn: async (message, adapter, history) => { ordinary.push(history); return { mode: 'chat', reply: 'Ordinary response' } } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const base = 'http://127.0.0.1:' + server.address().port
  const post = (body, { origin = 'http://127.0.0.1:8090', owner = true } = {}) => new Promise((resolve, reject) => {
    const request = http.request(base + '/api/v1/demo/intake', { method: 'POST', headers: { host: '127.0.0.1:8090', origin,
      'content-type': 'application/json', ...(owner ? { authorization: 'Bearer fixture-owner' } : {}) } }, response => {
      let raw = ''; response.on('data', value => { raw += value }); response.on('end', () => resolve({ status: response.statusCode, body: raw ? JSON.parse(raw) : null }))
    }); request.on('error', reject); request.end(JSON.stringify({ interactionMode: 'chat', conversationId: 'mail-memory-fixture', ...body }))
  })
  const first = '上次供應商答應了甚麼？'
  assert.equal((await post({ message: first }, { owner: false })).status, 401)
  assert.equal((await post({ message: first }, { origin: 'https://evil.test' })).status, 403)
  assert.equal(recalls, 0)
  const response = await post({ message: first }); assert.equal(response.status, 200)
  assert.match(response.body.reply, /PRIVATE MAIL PROMISE/); assert.equal(response.body.sourceBound, true)
  assert.equal(persisted.length, 1); assert.doesNotMatch(persisted[0].replyText, /PRIVATE MAIL PROMISE/)
  assert.equal(journal.length, 0); assert.equal(models, 0); assert.equal(ordinary.length, 0)
  const history = [{ role: 'user', text: first }, { role: 'assistant', text: response.body.reply }]
  const followup = await post({ message: '佢原話係點？', history }); assert.equal(followup.status, 200)
  history.push({ role: 'user', text: '佢原話係點？' }, { role: 'assistant', text: followup.body.reply })
  access = false; assert.equal((await post({ message: '佢原話係點？', history })).status, 503)
  assert.equal(recalls, 2); assert.equal(persisted.length, 2)
  history.push({ role: 'assistant', text: 'PRIVATE ORPHAN MAIL', content: 'PRIVATE ORPHAN MAIL', sourceBound: true })
  const unrelated = await post({ message: 'Hello again', history }); assert.equal(unrelated.status, 200)
  assert.equal(ordinary.length, 1); assert.doesNotMatch(JSON.stringify(ordinary[0]), /PRIVATE MAIL PROMISE/)
  assert.doesNotMatch(JSON.stringify(ordinary[0]), /PRIVATE ORPHAN MAIL/)
})
