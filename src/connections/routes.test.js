'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createApp } = require('../app')
test('connections endpoints require owner and same origin, reject extra fields and protect callback state', async t => {
  const calls = []
  const manager = { list: () => ({ connections: [] }), test: async s => { calls.push(s); return { state: 'connected' } }, toggle: () => { calls.push('toggle'); return {} }, invalidate: () => calls.push('invalidate') }
  const flow = { begin: () => ({ cookie: 'fixture-cookie', url: 'https://accounts.google.com/o/oauth2/v2/auth' }), finish: async () => { throw Error('invalid_flow') } }
  const app = createApp({ ownerPassword: 'fixture-owner', serviceToken: 'fixture-service', connectionsManager: manager, connectionFlow: flow, runPersistence: false, proposalPersistence: false, workerDeps: { artifactStore: null, runner: null } })
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const base = 'http://127.0.0.1:' + server.address().port
  for (const path of ['/connections', '/api/v1/connections']) assert.equal((await fetch(base + path)).status, 401)
  const send = (body, origin = 'http://127.0.0.1:8090') => new Promise((resolve, reject) => {
    const r = require('node:http').request(base + '/api/v1/connections', { method: 'POST', headers: { host: '127.0.0.1:8090', origin, authorization: 'Bearer fixture-service', 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers })) }); r.on('error', reject); r.end(JSON.stringify(body))
  })
  assert.equal((await send({ op: 'test', source: 'gmail' }, 'https://evil.test')).status, 403)
  assert.equal((await send({ op: 'test', source: 'gmail', url: 'https://evil.test' })).status, 400)
  assert.equal(calls.length, 0)
  assert.equal((await send({ op: 'test', source: 'gmail' })).status, 200); assert.deepEqual(calls, ['gmail'])
  const start = await send({ op: 'authorize' }); assert.equal(start.status, 200); assert.match(start.headers['set-cookie'][0], /HttpOnly; SameSite=Lax; Secure/)
  const cb = await fetch(base + '/oauth/google/callback?state=forged&code=secret', { redirect: 'manual' }); assert.equal(cb.status, 303); assert.ok(!calls.includes('invalidate'))
  const page = await fetch(base + '/connections', { headers: { authorization: 'Bearer fixture-service' } }); assert.equal(page.status, 200); assert.ok((await page.text()).includes('id="cards"'))
})
