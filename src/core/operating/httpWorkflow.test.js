'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const express = require('express')
const { randomUUID } = require('node:crypto')
const { createManager } = require('./manager')
const { createManagerRouter } = require('./routes')

test('briefing memory HTTP rejects foreign origins and forged inputs, persists one candidate with an auditable source', async t => {
  const { createGateway, OWNER } = require('../../memory/governed')
  const { createTestStore } = require('../../memory/structuredStore')
  const { createBriefingMemory } = require('./briefingMemory')
  const gateway = createGateway({ store: createTestStore(), engine: {} })
  const run = { id: randomUUID(), state: 'partial', finishedAt: new Date().toISOString() }
  const memory = createBriefingMemory({ gateway, getRun: id => id === run.id ? run : null })
  const app = express(); app.use(express.json()); app.use(createManagerRouter({ manager: { proposeMemory: memory.propose } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const send = (body, origin = 'http://127.0.0.1:8090') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/v1/manager/runs/' + run.id + '/memory', method: 'POST', headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json' } }, res => {
      res.setEncoding('utf8'); let value = ''; res.on('data', chunk => { value += chunk }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(value) }))
    }); req.on('error', reject); req.end(JSON.stringify(body))
  })
  const input = { requestId: randomUUID(), kind: 'decision', subject: 'Acceptance', text: 'Use the measured source.' }
  assert.equal((await send(input, 'https://evil.test')).status, 403)
  assert.equal((await send({ ...input, status: 'active' })).status, 409)
  assert.equal((await gateway.list(OWNER)).length, 0)
  const first = await send(input); assert.equal(first.status, 200); assert.equal(first.body.record.status, 'candidate')
  assert.equal((await send(input)).body.record.id, first.body.record.id)
  assert.equal((await gateway.list(OWNER)).length, 1)
  assert.equal(first.body.record.source.id, run.id); assert.equal(first.body.record.details.quote, input.text)
})
test('workflow HTTP actions enforce same-origin fixed inputs; cancellation and idempotent retry expose durable outcomes', async t => {
  const manager = createManager({ gateway: { read: () => new Promise(() => {}) }, activity: { append () {}, list: () => [] } })
  const app = express(); app.use(express.json()); app.use(createManagerRouter({ manager }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const base = 'http://127.0.0.1:' + server.address().port
  const send = (body, origin = 'http://127.0.0.1:8090') => new Promise((resolve, reject) => {
    const req = http.request(base + '/api/v1/manager/runs', { method: 'POST', headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json' } }, res => {
      let value = ''; res.on('data', chunk => { value += chunk }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(value) }))
    }); req.on('error', reject); req.end(JSON.stringify(body))
  })
  const requestId = randomUUID()
  assert.equal((await send({ op: 'start', requestId }, 'https://evil.test')).status, 403)
  assert.equal((await send({ op: 'start', requestId, tool: 'gmail.send' })).status, 400)
  assert.equal(manager.list().length, 0)
  const first = await send({ op: 'start', requestId }); assert.equal(first.status, 200)
  const id = first.body.run.id
  assert.equal((await send({ op: 'start', requestId })).body.run.id, id)
  const status = await (await fetch(base + '/api/v1/manager/runs/' + id)).json()
  assert.equal(status.run.state, 'running'); assert.equal(status.run.steps[0].count, null)
  assert.equal((await send({ op: 'cancel', id })).body.run.state, 'cancelled')
  const retry = await send({ op: 'retry', id })
  assert.equal(retry.body.run.retryOf, id)
  assert.equal((await send({ op: 'retry', id })).body.run.id, retry.body.run.id)
  assert.equal((await send({ op: 'cancel', id: retry.body.run.id })).body.run.state, 'cancelled')
  const history = await (await fetch(base + '/api/v1/manager/runs')).json(); assert.equal(history.runs.length, 2)
})
