'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
test('worker page and requests require owner auth; cross-origin and arbitrary work are refused', async t => {
  const calls = []
  const { createApp } = require('../../app')
  const app = createApp({ ownerPassword: 'fixture-owner', serviceToken: 'fixture-service', runPersistence: false, proposalPersistence: false,
    workerDeps: { artifactStore: null, runner: null }, workerFlowOptions: { request: async b => { calls.push(b); return { enabled: false, runs: [] } } } })
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const url = 'http://127.0.0.1:' + server.address().port
  for (const route of ['/workers', '/api/v1/worker-flow', '/project-work', '/api/v1/project-work']) assert.equal((await fetch(url + route)).status, 401)
  const headers = { authorization: 'Bearer fixture-service', 'content-type': 'application/json', host: '127.0.0.1:8090', origin: 'http://127.0.0.1:8090' }
  assert.equal((await fetch(url + '/workers', { headers })).status, 200)
  assert.equal(calls.length, 0)
  const send = (b, h = headers) => new Promise((resolve, reject) => {
    const req = require('node:http').request(url + '/api/v1/worker-flow', { method: 'POST', headers: h }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })) })
    req.on('error', reject); req.end(JSON.stringify(b))
  })
  assert.equal((await send({ op: 'start' }, { ...headers, origin: 'http://evil.test' })).status, 403)
  assert.equal((await send({ op: 'start', command: 'anything' })).status, 400)
  assert.equal((await send({ op: '__proto__' })).status, 400)
  assert.equal(calls.length, 0)
  assert.equal((await send({ op: 'status' })).status, 200)
  assert.deepEqual(calls, [{ op: 'status' }])
})
