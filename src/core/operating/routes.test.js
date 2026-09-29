'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')
const { createManagerRouter } = require('./routes')
test('HTTP workflow rejects forged plans, roles and cross-origin calls before reads', async t => {
  const app = express(); app.use(express.json())
  let calls = 0
  app.use(createManagerRouter({ manager: {
    briefing: async actor => { calls++; assert.deepEqual(actor, { id: 'owner', role: 'owner' }); return { state: 'completed' } },
    registry: () => ({ tools: [] }), activity: () => []
  } }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const url = 'http://127.0.0.1:' + server.address().port
  const send = (body, origin = 'http://127.0.0.1:8090') => new Promise((resolve, reject) => {
    const req = http.request(url + '/api/v1/manager/briefing', { method: 'POST', headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })) })
    req.on('error', reject); req.end(JSON.stringify(body))
  })
  assert.equal((await send({ actor: { role: 'owner' } })).status, 400)
  assert.equal((await send({ tool: 'gmail.send' })).status, 400)
  assert.equal((await send({}, 'http://evil.test')).status, 403)
  assert.equal(calls, 0)
  assert.equal((await send({})).status, 200)
  assert.equal(calls, 1)
  assert.equal((await fetch(url + '/api/v1/manager/activity')).status, 200)
})

test('the real app mounts the page and all operating endpoints behind owner authentication', async t => {
  const { createApp } = require('../../app')
  let calls = 0
  const app = createApp({ ownerPassword: 'fixture-owner', serviceToken: 'fixture-service', runPersistence: false, proposalPersistence: false,
    workerDeps: { artifactStore: null, runner: null },
    operatingManager: { registry: () => ({ tools: [{ id: 'fixture.read' }] }), activity: () => [], briefing: async () => { calls++; return { state: 'completed' } } }
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const url = 'http://127.0.0.1:' + server.address().port
  for (const route of ['/manager', '/api/v1/manager/registry', '/api/v1/manager/activity', '/api/v1/manager/runs', '/api/v1/manager/runs/unknown']) assert.equal((await fetch(url + route)).status, 401)
  assert.equal((await fetch(url + '/api/v1/manager/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401)
  assert.equal((await fetch(url + '/api/v1/manager/briefing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401)
  assert.equal(calls, 0)
  const registry = await fetch(url + '/api/v1/manager/registry', { headers: { authorization: 'Bearer fixture-service' } })
  assert.deepEqual(await registry.json(), { tools: [{ id: 'fixture.read' }] })
  const page = await fetch(url + '/manager', { headers: { authorization: 'Bearer fixture-service' } })
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.ok(html.includes('id="run"'))
  assert.ok(!html.includes('/*LABELS*/'))
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1]
  new (require('node:vm').Script)(script)
})
