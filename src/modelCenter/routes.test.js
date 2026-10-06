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
