'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createGateway, OWNER } = require('./governed')
const { createTestStore } = require('./structuredStore')
const { createRuntime } = require('./runtime')
const { spawnSync } = require('node:child_process')
const source = { kind: 'conversation', id: 'rebuild-fixture', at: '2026-09-29T00:00:00.000Z', attribution: 'owner_statement' }
test('Owner rebuild preserves approval and raw source while excluding source-bound, expired and nonactive rows', async () => {
  const store = createTestStore(), engine = { forScope: () => ({ retain: async () => ({ facts: 1 }), recall: async () => [] }) }
  const g = createGateway({ store, engine })
  const create = (id, text) => g.observe(OWNER, { type: 'episodic', subject: id, text, scope: 'private:owner', source: { ...source, id }, policy: 'owner_history' })
  let kept = await create('kept', 'Keep this exact owner history for recovery.')
  kept = await g.index(OWNER, kept.id)
  const archived = await create('archived', 'Archived history must stay excluded.')
  await g.transition(OWNER, archived.id, archived.version, 'archive')
  const short = await create('short', '好')
  const candidate = await g.propose(OWNER, { type: 'preference', subject: 'candidate', text: 'Unapproved preference stays unapproved.', scope: 'private:owner', source })
  const mail = { ...structuredClone(kept), id: 'xx-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', source: { ...source, kind: 'admin_mail_message' }, version: 1 }
  await store.commit([{ expected: 0, row: mail }], { op: 'mail_fixture' })
  const expired = { ...structuredClone(kept), id: 'xx-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expiresAt: '2020-01-01T00:00:00.000Z', version: 1 }
  await store.commit([{ expected: 0, row: expired }], { op: 'expired_fixture' })
  const result = await g.rebuildIndex(OWNER)
  assert.equal(result.queued, 1); assert.equal(result.sourceOnly, 1)
  const updated = await g.get(OWNER, kept.id)
  assert.equal(updated.index.state, 'pending'); assert.equal(updated.index.rebuildId, result.id)
  assert.equal(updated.text, kept.text); assert.deepEqual(updated.approval, kept.approval)
  assert.equal(updated.status, 'active'); assert.equal(updated.index.attempts, 0)
  assert.equal((await g.get(OWNER, short.id)).index.state, 'source_only')
  assert.equal((await g.get(OWNER, candidate.id)).version, candidate.version)
  assert.equal((await store.get(mail.id)).version, mail.version)
  assert.equal((await store.get(expired.id)).version, expired.version)
  assert.equal((await g.audit(OWNER, kept.id)).at(-1).op, 'index_rebuild_queued')
  const state = (await g.status(OWNER)).indexRebuild
  assert.equal(state.id, result.id); assert.equal(state.pending, 1); assert.equal(state.source_only, 1)
  await assert.rejects(g.rebuildIndex({ id: 'buyer', role: 'agent' }), /permission_denied/)
  await assert.rejects(g.rebuildIndex(OWNER, 'not-a-scope'), /permission_denied/)
})
test('rebuild survives a new runtime and reconstructs only lost semantic originals without losing canonical recall', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-index-rebuild-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createTestStore(), documents = new Map(); let writes = 0
  const engine = { forScope: () => ({ get: async id => documents.get(id) || null,
    retain: async (id, text) => { writes++; const doc = { id, text, facts: 1 }; documents.set(id, doc); return doc },
    recall: async () => { throw Error('engine-index-lost') } }) }
  const first = createRuntime({ store, engine, dir })
  first.event('conversation', 'rebuild-history', 'Harbor memory recovery fixture.', 'owner_statement')
  await first.drain(); assert.equal(writes, 1)
  const [row] = await first.gateway.list(OWNER)
  documents.clear()
  assert.equal((await first.ownerClient.recall('Harbor'))[0].documentId, row.id)
  const queued = await first.gateway.rebuildIndex(OWNER)
  const resumed = createRuntime({ store, engine, dir }); await resumed.drain()
  assert.equal(writes, 2)
  const rebuilt = await resumed.gateway.get(OWNER, row.id)
  assert.equal(rebuilt.index.state, 'saved'); assert.equal(rebuilt.index.rebuildId, queued.id)
  assert.equal((await resumed.gateway.status(OWNER)).indexRebuild.saved, 1)
  await resumed.gateway.rebuildIndex(OWNER); await resumed.gateway.index(OWNER, row.id)
  assert.equal(writes, 2, 'matching originals reconcile without repeated extraction')
})
test('SQL metadata queue is transaction-safe, source-bound, scope-bound and preserves Unicode', { skip: !fs.existsSync('C:/Aroma/hindsight-runtime/Scripts/python.exe') }, () => {
  const script = path.resolve(__dirname, '../../scripts/memory/indexRebuild.fixture.py')
  const result = spawnSync('C:/Aroma/hindsight-runtime/Scripts/python.exe', ['-B', '-X', 'utf8', script], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  const proof = JSON.parse(result.stdout)
  assert.equal(proof.passed, true); assert.equal(proof.queued, 1); assert.equal(proof.sourceOnly, 2)
  assert.equal(proof.unicode, '保留中文原文及已確認決定。')
})
