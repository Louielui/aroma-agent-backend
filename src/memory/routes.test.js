'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createApp } = require('../app')
test('memory page and mutations require owner authentication, same origin and explicit content', async t => {
  const calls = []
  const memory = { list: async () => ({ items: [], total: 0 }), retain: async (...a) => { calls.push(a); return { id: a[0], text: a[1], facts: 1 } }, forget: async id => { calls.push(id); return { state: 'deleted' } } }
  const app = createApp({ ownerPassword: 'fixture-owner', serviceToken: 'fixture-service', memoryClient: memory, runPersistence: false, proposalPersistence: false, workerDeps: { artifactStore: null, runner: null } })
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const base = 'http://127.0.0.1:' + server.address().port
  for (const path of ['/memory', '/api/v1/memory']) assert.equal((await fetch(base + path)).status, 401)
  const send = (body, origin = 'http://127.0.0.1:8090') => new Promise((resolve, reject) => {
    const r = require('node:http').request(base + '/api/v1/memory', { method: 'POST', headers: { host: '127.0.0.1:8090', origin, authorization: 'Bearer fixture-service', 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })) })
    r.on('error', reject); r.end(JSON.stringify(body))
  })
  assert.equal((await send({ op: 'save', text: 'Owner prefers green folders.' }, 'https://evil.test')).status, 403)
  assert.equal((await send({ op: 'save', text: 'Owner prefers green folders.', bank: 'other' })).status, 400)
  assert.equal(calls.length, 0)
  assert.equal((await send({ op: 'save', text: 'Owner prefers green folders.' })).status, 200)
  assert.match(calls[0][0], /^xx-/); assert.equal(calls[0][1], 'Owner prefers green folders.')
  const page = await fetch(base + '/memory', { headers: { authorization: 'Bearer fixture-service' } })
  assert.equal(page.status, 200); assert.ok((await page.text()).includes('memory-text'))
})
