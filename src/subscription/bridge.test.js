'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createBridge, validateInput } = require('./bridge')
const { SubscriptionError } = require('./codexClient')
test('bridge authenticates, rejects browser origins and preserves safe errors', async t => {
  let calls = 0
  const token = 'a'.repeat(64)
  const server = createBridge({ token, completeFn: async () => { calls++; throw new SubscriptionError('subscription_limit_reached') }, checkFn: async () => ({ model: 'gpt-6-astra', billing: 'chatgpt-subscription' }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const url = 'http://127.0.0.1:' + server.address().port
  const send = (route, body, headers = {}) => fetch(url + route, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  assert.equal((await send('/complete', { prompt: 'x' }, { authorization: 'bad' })).status, 401)
  assert.equal((await send('/complete', { prompt: 'x' }, { origin: 'http://evil' })).status, 401)
  assert.equal(calls, 0)
  assert.equal((await send('/status', 3)).status, 400)
  assert.equal((await send('/status', {})).status, 200)
  assert.equal((await send('/complete', { prompt: 'x', executable: 'bad' })).status, 503)
  const result = await send('/complete', { prompt: 'x' })
  assert.equal(result.status, 429)
  assert.deepEqual(await result.json(), { code: 'subscription_limit_reached' })
  assert.equal(calls, 1)
})
test('bridge serializes calls', async t => {
  let release
  const token = 'b'.repeat(64)
  const server = createBridge({ token, checkFn: async () => new Promise(resolve => { release = resolve }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const url = 'http://127.0.0.1:' + server.address().port + '/status'
  const send = () => fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: '{}' })
  const first = send()
  while (!release) await new Promise(resolve => setImmediate(resolve))
  assert.equal((await send()).status, 503)
  release({ ok: true })
  assert.equal((await first).status, 200)
})
test('bridge input is bounded and cannot supply model or execution settings', () => {
  for (const input of [null, [], { prompt: 'x', model: 'other' }, { prompt: 'x'.repeat(500001) }, { prompt: 'x', schema: [] }, { prompt: 'x', allowCredits: true }]) assert.throws(() => validateInput(input), SubscriptionError)
})
test('project-work bridge only accepts closed request shapes and shares the execution lane', async t => {
  const token = 'c'.repeat(64), calls = []
  let active = false
  const server = createBridge({ token, projectWork: { isActive: () => active, catalogue: () => ({ workOrders: [] }), list: () => [] , prepare: async (actor, body) => { calls.push({ actor, body }); return { run: {} } } } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const url = 'http://127.0.0.1:' + server.address().port
  const send = (route, body) => fetch(url + route, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const input = { op: 'prepare', projectId: 'aroma-agent-backend', recipe: 'context-fields-snapshot-v1', requestId: require('node:crypto').randomUUID(), bootCommit: 'a'.repeat(40) }
  assert.equal((await send('/project-work', { ...input, command: 'anything' })).status, 400); assert.equal(calls.length, 0)
  assert.equal((await send('/project-work', input)).status, 200); assert.equal(calls[0].actor.id, 'owner')
  active = true; assert.equal((await send('/status', {})).status, 503); assert.equal((await send('/project-work', { op: 'list' })).status, 200)
})
test('adoption and project work can be observed together but cannot dispatch overlapping writes', async t => {
  const token = 'd'.repeat(64), calls = []; let pending = true, workActive = false
  const server = createBridge({ token, projectWork: { isActive: () => workActive, catalogue: () => ({}), list: () => [], prepare: () => calls.push('work') }, projectAdoption: { isActive: () => pending, refresh: async () => {}, enabled: () => true, list: () => [], prepare: () => calls.push('adopt') } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const send = (route, body) => fetch('http://127.0.0.1:' + server.address().port + route, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await send('/project-work', { op: 'list' })).status, 200); assert.equal((await send('/project-adoption', { op: 'list' })).status, 200)
  assert.equal((await (await send('/project-work', { op: 'prepare', projectId: 'aroma-agent-backend', recipe: 'context-fields-snapshot-v1', requestId: require('node:crypto').randomUUID(), bootCommit: 'a'.repeat(40) })).json()).error, 'worker_busy')
  pending = false; workActive = true
  assert.equal((await send('/project-adoption', { op: 'list' })).status, 200)
  assert.equal((await (await send('/project-adoption', { op: 'prepare', action: 'adopt', runId: require('node:crypto').randomUUID(), requestId: require('node:crypto').randomUUID(), bootCommit: 'a'.repeat(40) })).json()).error, 'worker_busy')
  assert.deepEqual(calls, [])
  assert.equal((await send('/project-adoption', { op: 'reload', id: require('node:crypto').randomUUID(), command: 'anything' })).status, 400)
})
