'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createRemoteCodeSource } = require('./remoteSource')
const { createBridge } = require('../../subscription/bridge')
const OWNER = { id: 'owner', role: 'owner' }, bootCommit = 'a'.repeat(40)
test('service source hands only the boot commit to the fixed Owner bridge route, with cancellation and deadline', async () => {
  let seen
  const packet = { state: 'ok', evidence: { bootCommit } }
  const source = createRemoteCodeSource({ env: { READ_ACCESS: 'on' }, bootCommit, request: async (...args) => { seen = args; return packet } })
  assert.equal(await source.read(OWNER), packet); assert.equal(seen[0], '/code-diagnosis-source'); assert.deepEqual(seen[1], { bootCommit }); assert.ok(seen[3] instanceof AbortSignal)
  const control = new AbortController(); control.abort()
  await source.read(OWNER, { signal: control.signal }); assert.equal(seen[3].aborted, true)
})
test('service source refuses revoked access, foreign actors, bad boot identity and mismatched/failed bridge before source acceptance', async () => {
  let calls = 0
  const request = async () => { calls++; throw Error('private source details') }
  const source = createRemoteCodeSource({ env: { READ_ACCESS: 'off' }, bootCommit, request })
  await assert.rejects(source.read(OWNER), /read_access_disabled/); await assert.rejects(source.read({ id: 'ivy', role: 'owner' }), /permission_denied/); assert.equal(calls, 0)
  await assert.rejects(createRemoteCodeSource({ env: { READ_ACCESS: 'on' }, bootCommit: 'bad', request }).read(OWNER), /context_unavailable/); assert.equal(calls, 0)
  await assert.rejects(createRemoteCodeSource({ env: { READ_ACCESS: 'on' }, bootCommit, request }).read(OWNER), /^Error: context_unavailable$/)
  await assert.rejects(createRemoteCodeSource({ env: { READ_ACCESS: 'on' }, bootCommit, request: async () => ({ evidence: { bootCommit: 'b'.repeat(40) } }) }).read(OWNER), /context_unavailable/)
})
test('source bridge endpoint rejects browser/unauthorized/expanded requests and never calls model or worker execution', async t => {
  const token = 'c'.repeat(64), seen = []; let modelCalls = 0
  const server = createBridge({ token, completeFn: async () => { modelCalls++ }, codeSourceFactory: boot => ({ read: async (actor, options) => { seen.push({ boot, actor, signal: options.signal }); return { state: 'ok', evidence: { bootCommit: boot } } } }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const url = 'http://127.0.0.1:' + server.address().port + '/code-diagnosis-source'
  const send = (body, headers = {}) => fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  assert.equal((await send({ bootCommit }, { authorization: 'bad' })).status, 401)
  assert.equal((await send({ bootCommit }, { origin: 'http://127.0.0.1:8090' })).status, 401)
  for (const body of [null, [], 3, { bootCommit, path: '../.env' }, { bootCommit, command: 'git status' }, { bootCommit: 'invalid' }]) assert.equal((await send(body)).status, 400)
  assert.equal(seen.length, 0)
  const response = await send({ bootCommit }); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { state: 'ok', evidence: { bootCommit } })
  assert.deepEqual(seen[0].actor, OWNER); assert.equal(seen[0].boot, bootCommit); assert.ok(seen[0].signal instanceof AbortSignal); assert.equal(modelCalls, 0)
})
test('source bridge without host configuration stays unavailable; failed source details are never echoed', async t => {
  const token = 'd'.repeat(64)
  for (const codeSourceFactory of [null, () => ({ read: async () => { throw Error('private-path-or-credential') } })]) {
    const server = createBridge({ token, codeSourceFactory })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/code-diagnosis-source', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ bootCommit }) })
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { code: 'context_unavailable' })
  }
})
