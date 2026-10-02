'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { createStructuredStore, createTestStore } = require('./structuredStore')
const { createGateway, OWNER } = require('./governed')
const row = id => ({ id, source: { kind: 'conversation' }, text: '原文 😀' })

test('general memory pages keep the first cutoff and never request complete mail bodies', async () => {
  const calls = []
  const store = createStructuredStore({ invoke: async request => {
    calls.push(request)
    return calls.length === 1
      ? { items: [row('a')], nextSequence: 5, snapshotSequence: 12, hasMore: true }
      : { items: [row('b')], nextSequence: 8, snapshotSequence: 12, hasMore: false }
  } })
  assert.deepEqual(await store.generalRows(), [row('a'), row('b')])
  assert.deepEqual(calls, [
    { op: 'general_page', after: 0, snapshotSequence: null },
    { op: 'general_page', after: 5, snapshotSequence: 12 }
  ])
})

test('general memory rejects source-bound leaks, stalled cursors and changed cutoffs', async () => {
  for (const page of [
    { items: [{ ...row('a'), source: { kind: 'admin_mail_message' } }], nextSequence: 1, snapshotSequence: 1, hasMore: false },
    { items: [row('a')], nextSequence: 0, snapshotSequence: 1, hasMore: true },
    { items: [], nextSequence: 0, snapshotSequence: 1, hasMore: true },
    { items: [row('a')], nextSequence: 2, snapshotSequence: 1, hasMore: false }
  ]) await assert.rejects(createStructuredStore({ invoke: async () => page }).generalRows(), /memory_database_unavailable/)
  let calls = 0
  const store = createStructuredStore({ invoke: async () => ++calls === 1
    ? { items: [row('a')], nextSequence: 1, snapshotSequence: 2, hasMore: true }
    : { items: [row('b')], nextSequence: 2, snapshotSequence: 3, hasMore: false } })
  await assert.rejects(store.generalRows(), /memory_database_unavailable/)
})

test('Owner status and scoped lists use general rows and preserve decision counts', async () => {
  const sourceStore = createTestStore()
  const initial = createGateway({ store: sourceStore })
  const remembered = await initial.observe(OWNER, { type: 'episodic', scope: 'private:owner', subject: 'Bounded status acceptance',
    text: 'Original statement', source: { kind: 'conversation', id: 'test-only', at: null, attribution: 'owner_statement' } })
  let reads = 0
  const store = { ...sourceStore, all: async () => { throw Error('whole_mailbox_read_forbidden') },
    generalRows: async () => { reads++; return [remembered] } }
  const gateway = createGateway({ store })
  assert.deepEqual((await gateway.list(OWNER)).map(r => r.id), [remembered.id])
  const status = await gateway.status(OWNER)
  assert.equal(status.layers.find(r => r.type === 'episodic').total, 1)
  assert.equal(status.counts[remembered.status], 1)
  assert.equal(reads, 2)
  await assert.rejects(gateway.status({ id: 'worker', role: 'agent' }), /permission_denied/)
  assert.equal(reads, 2)
  store.grants = async () => [{ id: 'worker', scopes: ['domain:development'], writeScopes: [] }]
  assert.deepEqual(await gateway.list({ id: 'worker', role: 'agent' }), [])
  assert.equal(reads, 3)
  await assert.rejects(gateway.list({ id: 'worker', role: 'agent' }, { scope: 'private:owner' }), /permission_denied/)
  assert.equal(reads, 3)
})

test('PostgreSQL general pages filter mail before transport and keep byte bounds', () => {
  const result = spawnSync('C:/Aroma/hindsight-runtime/Scripts/python.exe', ['-B', '-X', 'utf8',
    path.resolve(__dirname, '../../scripts/memory/generalRows.fixture.py')], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { passed: true, sourceIsolation: true, fixedSnapshot: true, byteBound: true, unicode: true })
})
