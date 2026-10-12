'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')
const { createDemoRouter } = require('../routes/demoRouter')
test('mail chat uses an isolated read workflow and stores no email body in history or memory', async t => {
  const saved = []; let journal = 0; let reads = 0; let models = 0
  const app = express(); app.locals.conversationDemo = true; app.use(express.json())
  app.use(createDemoRouter({ mailChat: { answer: async request => { reads++; assert.equal(request.mode, 'summary'); return { reply: 'PRIVATE EMAIL BODY', messageCount: 1 } } },
    memoryJournal: { event: () => { journal++; throw Error('mail must not enter memory') } },
    conversationStore: { appendTurn: input => { saved.push(input); return { messageCount: 2 } } },
    getAdapterFn: () => { models++; throw Error('ordinary intake must not run') } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const send = origin => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/v1/demo/intake', method: 'POST',
      headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json' } }, res => {
      let text = ''; res.on('data', x => { text += x }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }))
    }); req.on('error', reject); req.end(JSON.stringify({ message: '行政部今天有什麼要我跟進？', conversationId: 'mail-route-test' }))
  })
  assert.equal((await send('https://evil.test')).status, 403); assert.equal(reads, 0)
  const result = await send('http://127.0.0.1:8090')
  assert.equal(result.status, 200); assert.equal(result.body.reply, 'PRIVATE EMAIL BODY')
  assert.equal(reads, 1); assert.equal(journal, 0); assert.equal(models, 0)
  assert.equal(saved.length, 1); assert.equal(JSON.stringify(saved).includes('PRIVATE EMAIL BODY'), false)
})
test('briefing administrative mail reads the dedicated source with a bounded current-day scope', async () => {
  const { createGateway } = require('../core/operating/gateway')
  let query; let personal = 0
  const gateway = createGateway({ clock: () => '2026-09-29T20:00:00.000Z',
    connector: { read: () => { personal++; throw Error('wrong source') } }, mailbox: { search: async (actor, params) => {
      assert.equal(actor.owner, true); query = params.q
      return { messages: [{ id: 'abc', subject: 'Delivery', snippet: 'Confirm arrival', link: 'https://mail.google.com/mail/?authuser=adm#all/abc' }], truncated: true, readAt: '2026-09-29T20:00:00Z' }
    } } })
  const result = await gateway.read({ id: 'owner', role: 'owner' }, 'gmail.admin', 'knowledge')
  assert.equal(personal, 0); assert.match(query, /^after:\d+ before:\d+$/)
  assert.equal(result.state, 'ok'); assert.equal(result.count, 1); assert.equal(result.complete, false)
  assert.equal(result.rows[0].title, 'Delivery'); assert.equal(result.source, 'admin_mail')
  await assert.rejects(gateway.read({ role: 'admin' }, 'gmail.admin', 'knowledge'), /permission_denied/)
})
