'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')
const { createRouter } = require('./routes')
const { createMailMemory } = require('./mailMemory')
const { createTestStore } = require('../memory/structuredStore')
test('Owner HTTP mail read captures memory; approval is same-origin and exact-version; source loss blocks list/detail', async t => {
  let connected = true
  const mailbox = { status: () => ({ mailbox: 'adm@example.test', state: connected ? 'connected' : 'not_connected' }),
    lease: () => () => { if (!connected) throw Error('denied') },
    read: async () => { mailbox.lease()(); return { id: 'abc', threadId: 'aaa', mailbox: 'adm@example.test', body: 'Invoice due', bodyState: 'available', subject: 'Invoice' } } }
  const memory = createMailMemory({ store: createTestStore(), mailbox })
  const app = express(); app.use(express.json()); app.use(createRouter({ registry: {}, mailbox, mailMemory: memory, readers: {},
    requireOwner: (req, res, next) => req.headers.authorization === 'Bearer owner-test' ? next() : res.sendStatus(401) }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const call = (path, body, authorized = true, origin = 'http://127.0.0.1:8090') => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method: body ? 'POST' : 'GET',
      headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer owner-test' } : {}) } }, res => {
      let raw = ''; res.on('data', x => { raw += x }); res.on('end', () => resolve({ status: res.statusCode, cache: res.headers['cache-control'], raw, data: raw[0] === '{' ? JSON.parse(raw) : null }))
    }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined)
  })
  const root = '/api/v1/company-access/mail-memory'
  assert.equal((await call(root, null, false)).status, 401)
  assert.equal((await call('/api/v1/company-access/mail/abc')).data.memory.state, 'saved')
  const list = await call(root); assert.equal(list.cache, 'no-store'); assert.equal(list.data.items.length, 1)
  const row = list.data.items[0]
  const body = { op: 'update', id: row.id, version: row.version, input: { action: 'approve', text: 'Review invoice', assignee: null, deadline: null, taskState: 'open' } }
  assert.equal((await call(root, body, true, 'https://evil.test')).status, 403)
  assert.equal((await call(root, body)).data.status, 'active')
  assert.equal((await call(root, body)).status, 409)
  connected = false
  for (const path of [root, root + '?id=' + row.id]) { const result = await call(path); assert.equal(result.status, 403); assert.ok(!result.raw.includes('Invoice')) }
})
test('historical briefing mail is withheld after source access fails', async t => {
  const { createManagerRouter } = require('../core/operating/routes')
  let access = true
  const app = express(); app.use(createManagerRouter({ manager: { get: () => ({ id: 'fixture', sections: [{ source: 'admin_mail', state: 'ok', rows: [{ text: 'Secret invoice' }], count: 1 }] }) },
    mailbox: { check: async () => { if (!access) throw Error('revoked') }, lease: () => () => {} } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const url = 'http://127.0.0.1:' + server.address().port + '/api/v1/manager/runs/fixture'
  assert.ok((await (await fetch(url)).text()).includes('Secret invoice'))
  access = false; const result = await (await fetch(url)).json(); assert.equal(result.run.sections[0].rows, null); assert.equal(result.run.sections[0].count, null)
})
