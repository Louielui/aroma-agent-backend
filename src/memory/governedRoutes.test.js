'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { createRuntime } = require('./runtime')
const { createTestStore } = require('./structuredStore')
const { createApp } = require('../app')
const { OWNER } = require('./governed')
test('live app composition gates six-layer UI, exact approvals and agent scopes separately', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-six-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const engine = { forScope: () => ({ recall: async () => [], retain: async (id, text) => ({ id, text, facts: 1 }) }) }
  const runtime = createRuntime({ store: createTestStore(), engine, dir })
  const app = createApp({ ownerPassword: 'test-owner', serviceToken: 'test-owner-service', governedMemory: runtime,
    operatingManager: { start: () => { assert.equal(runtime.status().pending, 1); throw Error('fixture_generation_failure') } },
    runPersistence: false, proposalPersistence: false, workerDeps: { artifactStore: null, runner: null } })
  app.locals.conversationDemo = true
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = 'http://127.0.0.1:' + server.address().port
  const request = (url, body, token = 'test-owner-service', origin = 'http://127.0.0.1:8090') => new Promise((resolve, reject) => {
    const req = require('node:http').request(base + url, { method: 'POST', headers: { host: '127.0.0.1:8090', ...(origin ? { origin } : {}), authorization: 'Bearer ' + token, 'content-type': 'application/json' } }, res => {
      let data = ''; res.on('data', c => { data += c }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }))
    }); req.on('error', reject); req.end(JSON.stringify(body))
  })
  assert.equal((await fetch(base + '/api/v1/memory/catalog')).status, 401)
  const page = await fetch(base + '/memory', { headers: { authorization: 'Bearer test-owner-service' } })
  assert.match(await page.text(), /reflect-form/); assert.equal(page.status, 200)
  const record = { type: 'decision', subject: 'Approval test', text: 'Use verified weight.', scope: 'domain:accounting',
    source: { kind: 'owner', id: 'test', at: null, attribution: 'owner_statement' } }
  const made = await request('/api/v1/memory/catalog', { op: 'propose', record })
  assert.equal(made.status, 200); const row = made.body.result
  assert.equal((await request('/api/v1/memory/catalog', { op: 'transition', id: row.id, version: row.version, action: 'approve' }, undefined, 'https://evil.test')).status, 403)
  assert.equal((await request('/api/v1/memory/catalog', { op: 'transition', id: row.id, version: row.version, action: 'approve' })).status, 200)
  const grant = await runtime.gateway.grant(OWNER, { id: 'buyer', scopes: ['domain:purchasing'], writeScopes: ['domain:purchasing'] })
  assert.equal((await request('/api/v1/agent-memory', { op: 'decision', subject: row.subject, scope: row.scope }, grant.token, null)).status, 403)
  assert.equal((await request('/api/v1/agent-memory', { op: 'transition', id: row.id, version: 2, action: 'archive' }, grant.token, null)).status, 403)
  assert.equal((await request('/api/v1/memory/catalog', { op: 'transition', id: row.id, version: 2, action: 'archive' }, grant.token)).status, 401)
  assert.equal((await request('/api/v1/agent-memory', { op: 'recall', query: 'verified', scope: 'domain:purchasing' }, grant.token, null)).status, 200)
  assert.equal((await request('/api/v1/memory/catalog', { op: 'consolidationSettings', enabled: false }, undefined, 'https://evil.test')).status, 403)
  assert.equal((await request('/api/v1/agent-memory', { op: 'consolidationSettings', enabled: false }, grant.token, null)).status, 403)
  assert.equal((await request('/api/v1/agent-memory', { op: 'consolidate', id: row.id }, grant.token, null)).status, 403)
  assert.equal((await request('/api/v1/memory/catalog', { op: 'consolidationSettings', enabled: false })).body.result.enabled, false)
  assert.equal(runtime.consolidation.status().enabled, false)
  assert.equal((await request('/api/v1/memory/catalog', { op: 'consolidationSettings', enabled: 'true' })).status, 400)
  const failed = await request('/api/v1/demo/intake', { message: '今日營運簡報', conversationId: require('node:crypto').randomUUID(), workflowRequestId: require('node:crypto').randomUUID() })
  assert.equal(failed.status, 503)
  assert.equal(runtime.status().pending, 2)
  await runtime.drain()
  const observed = await runtime.gateway.list(OWNER, { type: 'episodic' })
  assert.ok(observed.some(r => r.source.attribution === 'owner_statement' && r.text === '今日營運簡報'))
  assert.ok(observed.some(r => r.source.attribution === 'measured_result' && r.text.includes('503')))
})
test('durable receipt outbox survives restart, preserves attribution and is idempotent', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-outbox-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createTestStore()
  const engine = { forScope: () => ({ retain: async () => { throw Error('offline') }, recall: async () => { throw Error('offline') } }) }
  const first = createRuntime({ store, engine, dir })
  first.event('conversation', 'received-1', 'Owner prefers lavender folders.', 'owner_statement')
  assert.equal(first.status().pending, 1)
  const second = createRuntime({ store, engine, dir }); await second.drain()
  assert.equal(second.status().pending, 0)
  const records = await second.gateway.list(OWNER)
  assert.equal(records.length, 1); assert.equal(records[0].index.state, 'unconfirmed')
  assert.equal((await second.ownerClient.recall('lavender'))[0].documentId, records[0].id)
  assert.equal(first.event('conversation', 'secret', 'password=never-store-this', 'owner_statement').state, 'excluded')
  first.observeRead('gmail', { asOf: '2026-09-29T00:00:00.000Z', results: [{ id: 'supplier-email', title: 'Price notice', content: 'Supplier says prices may rise next week.' }] })
  await first.drain()
  const external = (await first.gateway.list(OWNER)).find(r => r.source.kind === 'gmail')
  assert.equal(external.status, 'candidate'); assert.equal(external.source.attribution, 'external_claim')
  assert.equal((await first.ownerClient.recall('prices')).length, 0)
})

test('restart respects durable retry dates, then reconciles originals without rewriting', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-retry-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createTestStore(); let reads = 0; let writes = 0
  const first = createRuntime({ store, dir, engine: { forScope: () => ({ retain: async () => { throw Error('memory_unavailable') } }) } })
  first.event('conversation', 'retry-source', 'Hello again.', 'owner_statement')
  await first.drain()
  const [row] = await store.all()
  assert.ok(row.index.nextRetryAt)
  const resumed = createRuntime({ store, dir, engine: { forScope: () => ({ get: async id => { reads++; return { id, text: row.text, facts: 0 } }, retain: async () => { writes++; throw Error('unexpected_write') } }) } })
  await resumed.drain(); assert.equal(reads, 0)
  await store.commit([{ expected: row.version, row: { ...row, version: row.version + 1, index: { ...row.index, nextRetryAt: '2026-01-01T00:00:00.000Z' } } }], { op: 'test_due' })
  await resumed.drain(); assert.equal(reads, 1); assert.equal(writes, 0)
  assert.equal((await store.get(row.id)).index.state, 'raw_only')
})

test('slow indexing cannot block persistence of the next conversation receipt', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ingress-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createTestStore(); let release; let started
  const began = new Promise(resolve => { started = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  const runtime = createRuntime({ store, dir, engine: { forScope: () => ({ retain: async () => { started(); await blocked; return { facts: 1 } } }) } })
  runtime.event('conversation', 'first', 'First receipt.', 'owner_statement')
  const first = runtime.drain(); await began
  try {
    runtime.event('conversation', 'second', 'Second receipt.', 'owner_statement')
    await runtime.drain()
    assert.equal((await store.all()).filter(r => r.text === 'Second receipt.').length, 1)
  } finally { release(); await first }
})

test('runtime reconciles legacy invalid short text once without contacting Hindsight', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-short-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createTestStore(); let calls = 0
  const runtime = createRuntime({ store, dir, engine: { forScope: () => { calls++; throw Error('must_not_contact_engine') } } })
  runtime.event('conversation', 'short-message', '好', 'owner_statement')
  await runtime.drain()
  const [row] = await store.all()
  await store.commit([{ expected: row.version, row: { ...row, version: row.version + 1, index: { state: 'unconfirmed', reason: 'memory_invalid_text', attempts: 1, checkedAt: '2026-09-29T00:00:00.000Z', nextRetryAt: null, facts: null } } }], { op: 'legacy_fixture' })
  const resumed = createRuntime({ store, dir, engine: { forScope: () => { calls++; throw Error('must_not_contact_engine') } } })
  await resumed.drain()
  const repaired = await store.get(row.id)
  assert.equal(repaired.index.state, 'source_only'); assert.equal(repaired.text, '好'); assert.equal(calls, 0)
  await resumed.drain()
  assert.equal((await store.get(row.id)).version, repaired.version)
})
