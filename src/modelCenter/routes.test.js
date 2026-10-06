'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), express = require('express')
const { createModelCenterRouter } = require('./routes')
test('model center writes require same origin, closed shape and expose no inference endpoint', async t => {
  let saved = 0
  const center = { read: () => ({ revision: 0, brain: { model: 'claude-sonnet', effort: 'medium' }, scopes: {}, audit: [] }), saveBrain: async () => { saved++; return center.read() }, selection: () => ({ mode: 'central', revision: 0 }), saveSelection: async () => { saved++; return center.selection() } }
  const app = express(); app.use(express.json()); app.use(createModelCenterRouter({ center, catalogue: async () => ({ models: [] }) }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => server.close())
  const base = 'http://127.0.0.1:' + server.address().port
  assert.equal((await fetch(base + '/api/v1/model-center')).status, 200)
  const body = { revision: 0, model: 'claude-sonnet', effort: 'medium' }
  const post = (path, origin, value) => fetch(base + path, { method: 'PUT', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
  assert.equal((await post('/api/v1/model-center/brain', 'https://elsewhere.invalid', body)).status, 403)
  assert.equal((await post('/api/v1/model-center/brain', base, { ...body, apiKey: 'not allowed' })).status, 400)
  assert.equal(saved, 0)
  assert.equal((await post('/api/v1/model-center/brain', base, body)).status, 200); assert.equal(saved, 1)
  assert.equal((await post('/api/v1/model-center/execute', base, body)).status, 404)
})

test('investigation to approval to settings write keeps a durable origin and verifies current values', async t => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { randomUUID } = require('node:crypto')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'investigation-action-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const receipts = require('../investigation/receipts').createReceipts({ dir: path.join(dir, 'receipts') })
  const id = randomUUID(); receipts.begin(id, 'conversation'); receipts.finish(id, { investigation: { goal: 'Investigate usage', sections: [{ section: 'configuration', state: 'ok' }] } })
  const catalogue = async () => ({ models: [{ model: 'claude-sonnet', available: true, efforts: ['medium', 'low'] }] })
  const center = require('./service').createModelCenter({ dataDir: dir, catalogue })
  const app = express(); app.use(express.json()); app.use(createModelCenterRouter({ center, catalogue, receipts }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => server.close())
  const base = 'http://127.0.0.1:' + server.address().port
  const put = value => fetch(base + '/api/v1/model-center/brain', { method: 'PUT', headers: { origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
  const input = { model: 'claude-sonnet', effort: 'low', revision: 0, investigationId: id }
  assert.equal((await fetch(base + '/api/v1/model-center/investigations/' + id)).status, 200)
  assert.equal(center.read().brain.effort, 'medium', 'reading the recommendation is inert')
  assert.equal((await put({ ...input, investigationId: randomUUID() })).status, 400)
  const done = await (await put(input)).json(); assert.equal(done.action.state, 'verified')
  assert.equal((await put(input)).status, 409, 'replayed approval cannot apply again')
  const reopened = require('./service').createModelCenter({ dataDir: dir, catalogue })
  assert.equal(reopened.read().audit.length, 1); assert.equal(reopened.read().audit[0].investigationId, id)
  assert.equal(reopened.read().brain.effort, 'low')
  const record = await (await fetch(base + '/api/v1/model-center/investigations/' + id)).json()
  assert.equal(record.actions[0].currentMatches, true); assert.equal(record.actions[0].before.effort, 'medium')
})
