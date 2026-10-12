'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createRuntime } = require('./runtime')
const sha = text => createHash('sha256').update(text).digest('hex')
const ordered = v => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v
function initialAudit(row) {
  const snapshot = { ...structuredClone(row), version: 1, index: { state: 'pending', facts: null, attempts: 0 } }
  const event = { op: 'observe', actor: 'owner', at: row.createdAt, reason: null, recordId: row.id, version: 1, snapshot }
  return { ...event, previousHash: null, hash: sha(JSON.stringify(ordered(event))) }
}
function setup(t, migrated = false, state = 'saved') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-evidence-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let row = { id: 'xx-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', text: 'NON_BUSINESS source original for isolated capture read-back.', subject: 'conversation · isolated',
    version: 3, status: 'active', type: 'episodic', scope: 'private:owner', owner: 'owner', expiresAt: null, supersedes: null, supersededBy: null,
    source: { kind: migrated ? 'historical_import' : 'conversation', id: 'isolated:2', at: '2026-09-30T12:00:00.000Z', attribution: 'historical_import' },
    approval: { kind: 'policy', id: 'owner_history', actor: 'owner', at: '2026-09-30T12:01:00.000Z' },
    index: { state, facts: state === 'saved' ? 2 : 0, attempts: 1, checkedAt: '2026-09-30T12:02:00.000Z' }, createdAt: '2026-09-30T12:01:00.000Z' }
  let audit = initialAudit(row); let document = { id: row.id, text: row.text, facts: row.index.facts }
  const calls = { gets: 0, documents: 0, audits: 0, writes: 0, retains: 0 }; let afterDocument = () => {}
  const store = { get: async () => { calls.gets++; return structuredClone(row) }, audit: async () => { calls.audits++; return [structuredClone(audit)] },
    commit: async () => { calls.writes++; throw Error('readback_must_not_write') }, grants: async () => [] }
  const engine = { forScope: scope => { assert.equal(scope, 'private:owner'); return {
    get: async () => { calls.documents++; afterDocument(); return structuredClone(document) },
    retain: async () => { calls.retains++; throw Error('readback_must_not_retain') } } } }
  const runtime = createRuntime({ store, engine, dir: path.join(dir, 'memory-outbox') })
  return { runtime, calls, row: () => row, alter: fn => fn(row), audit: () => audit, document: () => document,
    mutateAfterDocument: fn => { afterDocument = () => fn(row) }, replaceAudit: value => { audit = value } }
}
test('strict capture evidence reads canonical and scoped document without changing legacy get or writing', async t => {
  const f = setup(t); const proof = await f.runtime.ownerClient.getCaptureEvidence(f.row().id)
  assert.equal(proof.record.version, 3); assert.equal(proof.record.status, 'active'); assert.equal(proof.record.scope, 'private:owner')
  assert.deepEqual(proof.record.source, f.row().source); assert.equal(proof.indexed.textHash, sha(f.row().text)); assert.equal(proof.indexed.facts, 2)
  assert.equal(proof.indexed.canonicalVersion, 3); assert.equal(proof.origin.kind, 'native_capture')
  assert.equal(f.calls.documents, 1); assert.equal(f.calls.gets, 2); assert.equal(f.calls.audits, 0)
  assert.equal(f.calls.writes, 0); assert.equal(f.calls.retains, 0)
  const old = await f.runtime.ownerClient.get(f.row().id)
  assert.equal(old.facts, 2); assert.equal(old.status, undefined); assert.equal(old.scope, undefined); assert.equal(old.source, undefined)
})
test('documented capture migration requires authenticated first audit snapshot matching original provenance', async t => {
  const f = setup(t, true, 'raw_only'); const proof = await f.runtime.ownerClient.getCaptureEvidence(f.row().id)
  assert.equal(proof.indexed.state, 'raw_only'); assert.equal(proof.indexed.facts, 0); assert.equal(proof.origin.kind, 'capture_history_import')
  assert.equal(proof.origin.firstVersion, 1); assert.equal(proof.origin.auditHash, f.audit().hash)
  assert.equal(proof.origin.textHash, sha(f.row().text)); assert.deepEqual(proof.origin.source, f.row().source)
  assert.deepEqual(proof.origin.approval, f.row().approval); assert.equal(f.calls.audits, 1); assert.equal(f.calls.writes, 0); assert.equal(f.calls.retains, 0)
})
for (const [name, alter] of [
  ['archived', r => { r.status = 'archived' }], ['expired', r => { r.expiresAt = '2020-01-01T00:00:00Z' }],
  ['invalid expiry', r => { r.expiresAt = 'invalid' }], ['superseded', r => { r.supersededBy = 'other' }],
  ['manual correction', r => { r.supersedes = 'other' }], ['wrong scope', r => { r.scope = 'domain:email' }],
  ['wrong owner', r => { r.owner = 'ivy' }], ['wrong policy', r => { r.approval.id = 'different' }],
  ['manual approval', r => { r.approval.kind = 'owner' }], ['pending', r => { r.index.state = 'pending' }],
  ['source-only', r => { r.index.state = 'source_only' }], ['invalid saved facts', r => { r.index.facts = 0 }],
  ['missing index date', r => { delete r.index.checkedAt }], ['wrong source', r => { r.source.kind = 'worker' }]
]) test('strict evidence refuses ' + name + ' before derived read', async t => {
  const f = setup(t); f.alter(alter)
  assert.equal(await f.runtime.ownerClient.getCaptureEvidence(f.row().id), null)
  assert.equal(f.calls.documents, 0); assert.equal(f.calls.writes, 0); assert.equal(f.calls.retains, 0)
})
for (const [name, alter] of [
  ['text differs', d => { d.text += ' corrected' }], ['facts differ', d => { d.facts++ }], ['id differs', d => { d.id = 'another' }]
]) test('strict evidence refuses derived document when ' + name, async t => {
  const f = setup(t); alter(f.document())
  assert.equal(await f.runtime.ownerClient.getCaptureEvidence(f.row().id), null); assert.equal(f.calls.writes, 0)
})
for (const [name, alter] of [
  ['version changes', r => { r.version++ }], ['archive races', r => { r.status = 'archived'; r.version++ }],
  ['expiry races', r => { r.expiresAt = '2020-01-01T00:00:00Z' }], ['source races', r => { r.source.at = '2026-09-29T00:00:00Z' }]
]) test('strict evidence checks latest canonical after read when ' + name, async t => {
  const f = setup(t); f.mutateAfterDocument(alter)
  assert.equal(await f.runtime.ownerClient.getCaptureEvidence(f.row().id), null); assert.equal(f.calls.writes, 0)
})
for (const [name, change] of [
  ['snapshot missing', a => { delete a.snapshot }], ['hash tampered', a => { a.hash = 'b'.repeat(64) }],
  ['genesis missing', a => { a.previousHash = 'a'.repeat(64) }], ['operator differs', a => { a.actor = 'ivy' }],
  ['text differs', a => { a.snapshot.text += ' changed' }], ['source differs', a => { a.snapshot.source.at = '2026-09-29T00:00:00Z' }],
  ['approval differs', a => { a.snapshot.approval.at = '2026-09-29T00:00:00Z' }]
]) test('migration proof fails closed when ' + name, async t => {
  const f = setup(t, true); const a = structuredClone(f.audit()); change(a); f.replaceAudit(a)
  assert.equal(await f.runtime.ownerClient.getCaptureEvidence(f.row().id), null); assert.equal(f.calls.writes, 0); assert.equal(f.calls.retains, 0)
})
