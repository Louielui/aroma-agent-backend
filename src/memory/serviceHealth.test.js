'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { probeMemoryServices } = require('./serviceHealth')
const env = { XIANGXIANG_MEMORY: 'on', CODEX_CHAT_BRIDGE_TOKEN: 'a'.repeat(64), HINDSIGHT_TOKEN: 'private-token', HINDSIGHT_BANK: 'xiangxiang-owner', HINDSIGHT_URL: 'http://127.0.0.1:8888' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
function transport(url, init) {
  if (url.endsWith('/memory-store')) {
    assert.equal(init.headers.authorization, 'Bearer ' + env.CODEX_CHAT_BRIDGE_TOKEN)
    assert.deepEqual(JSON.parse(init.body), { op: 'health' })
    return json({ result: { state: 'connected', database: 'xiangxiang_memory_core', vector: true } })
  }
  assert.equal(init.headers.authorization, 'Bearer ' + env.HINDSIGHT_TOKEN)
  if (url.endsWith('/health/live')) return json({ status: 'alive', version: '0.10.2', uptime_seconds: 3 })
  if (url.endsWith('/stats')) return json({ bank_id: 'xiangxiang-owner', total_documents: 20 })
  if (url.endsWith('/health')) return json({ status: 'healthy', database: 'connected' })
  throw Error('unexpected_route')
}
test('read-only probes prove authenticated canonical database and Hindsight identity without model calls', async () => {
  const calls = []
  const status = await probeMemoryServices({ env, transport: (url, init) => { calls.push(url); return transport(url, init) } })
  assert.equal(status.state, 'ready')
  assert.equal(status.services.bridge.state, 'ready')
  assert.equal(status.services.database.state, 'ready')
  assert.equal(status.services.hindsight.state, 'ready')
  assert.equal(status.services.bridge.alive, true)
  assert.equal(calls.length, 4)
  assert.ok(calls.every(url => !url.includes('recall') && !url.includes('completion')))
})
test('connection refusal and lost authorization are separate, sanitized states', async () => {
  const status = await probeMemoryServices({ env, transport: async url => {
    if (url.includes(':8091')) throw Object.assign(Error('password=do-not-report'), { cause: { code: 'ECONNREFUSED' } })
    return json({ status: 'unauthorized', detail: 'secret' }, 401)
  } })
  assert.equal(status.state, 'unavailable')
  assert.equal(status.services.bridge.reason, 'not_running')
  assert.equal(status.services.bridge.alive, false)
  assert.equal(status.services.hindsight.reason, 'authorization_failed')
  assert.ok(!JSON.stringify(status).includes('secret'))
  assert.ok(!JSON.stringify(status).includes('password'))
})
test('dependency readiness failure reports degradation while retaining proven process liveness', async () => {
  const status = await probeMemoryServices({ env, transport: async (url, init) => {
    if (url.endsWith('/memory-store')) return json({ error: 'memory_database_unavailable' })
    if (url.endsWith('/health')) return json({ status: 'unhealthy', error: 'password=hidden' }, 503)
    return transport(url, init)
  } })
  assert.equal(status.state, 'degraded')
  assert.equal(status.services.bridge.alive, true)
  assert.equal(status.services.database.state, 'unavailable')
  assert.equal(status.services.hindsight.alive, true)
  assert.equal(status.services.hindsight.reason, 'database_unavailable')
  assert.ok(!JSON.stringify(status).includes('hidden'))
})
test('a database probe timeout retains measured Hindsight liveness', async () => {
  const status = await probeMemoryServices({ env, transport: async (url, init) => {
    if (url.endsWith('/health')) throw Object.assign(Error('hidden'), { name: 'TimeoutError' })
    return transport(url, init)
  } })
  assert.equal(status.services.hindsight.state, 'degraded')
  assert.equal(status.services.hindsight.alive, true)
  assert.equal(status.services.hindsight.reason, 'database_unavailable')
})
test('a foreign bank or wrong database can never pass as a connected memory service', async () => {
  const status = await probeMemoryServices({ env, transport: async (url, init) => {
    if (url.endsWith('/stats')) return json({ bank_id: 'foreign', total_documents: 0 })
    if (url.endsWith('/memory-store')) return json({ result: { state: 'connected', database: 'restaurant', vector: true } })
    return transport(url, init)
  } })
  assert.equal(status.state, 'unavailable')
  assert.equal(status.services.bridge.state, 'foreign')
  assert.equal(status.services.hindsight.state, 'foreign')
})
test('a lost configured semantic bank reports index recovery separately from foreign identity', async () => {
  const status = await probeMemoryServices({ env, transport: async (url, init) => url.endsWith('/stats') ? json({ detail: 'bank_not_found' }, 404) : transport(url, init) })
  assert.equal(status.services.hindsight.state, 'degraded')
  assert.equal(status.services.hindsight.reason, 'index_missing')
  assert.equal(status.services.hindsight.alive, true)
})
test('disabled or unconfigured probes cannot open sockets', async () => {
  let calls = 0
  const transport = () => { calls++; throw Error('unexpected_network') }
  const disabled = await probeMemoryServices({ env: {}, transport })
  assert.equal(disabled.state, 'disabled')
  const missing = await probeMemoryServices({ env: { XIANGXIANG_MEMORY: 'on' }, transport })
  assert.equal(missing.state, 'unavailable')
  assert.equal(missing.services.bridge.reason, 'not_configured')
  assert.equal(calls, 0)
})
