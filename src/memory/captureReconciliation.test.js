'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createCapture } = require('./capture')
const sha = value => createHash('sha256').update(value).digest('hex')
const at = '2026-09-30T12:00:00.000Z'
function evidence(receipt, state = 'saved', migrated = false) {
  const source = { kind: migrated ? 'historical_import' : receipt.source.kind, id: receipt.source.id + ':' + (receipt.source.turn || ''), at: receipt.source.at,
    attribution: receipt.source.kind === 'briefing' ? 'measured_result' : 'historical_import' }
  const record = { id: receipt.id, text: receipt.text, subject: receipt.source.kind + ' · ' + receipt.source.id, version: 3, type: 'episodic', scope: 'private:owner', owner: 'owner', status: 'active',
    supersedes: null, supersededBy: null, expiresAt: null, source, approval: { kind: 'policy', id: 'owner_history', actor: 'owner', at },
    index: { state, facts: state === 'saved' ? 2 : 0, checkedAt: at, attempts: 1 } }
  return { record, indexed: { textHash: sha(receipt.text), facts: record.index.facts, state, canonicalVersion: record.version },
    origin: migrated ? { kind: 'capture_history_import', textHash: sha(receipt.text), source: structuredClone(source), approval: structuredClone(record.approval), firstVersion: 1, auditHash: 'a'.repeat(64) } : { kind: 'native_capture' } }
}
function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-reconcile-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let receipt; let calls = 0; let retains = 0; let available = true
  const client = { get: async () => null, retainAutomatic: async () => { retains++; throw Error('write_unconfirmed') },
    getCaptureEvidence: async () => { calls++; return options.proof ? options.proof(receipt) : evidence(receipt) } }
  const first = createCapture({ dir, client: { get: client.get, retainAutomatic: client.retainAutomatic } })
  receipt = options.briefing ? first.run({ id: options.id || 'briefing-fixture', state: 'complete', finishedAt: at, sections: [] })
    : first.turn({ id: options.id || 'conversation-fixture', now: at, userText: options.userText || 'A NON_BUSINESS test preference is green.', replyText: options.replyText || 'This is an isolated test suggestion.' }, 2)
  if (receipt.state === 'pending') {
    receipt.state = options.state || 'unconfirmed'; receipt.reason = options.reason || 'write_unconfirmed'; receipt.attempts = 2
    fs.writeFileSync(path.join(dir, receipt.id + '.json'), JSON.stringify(receipt))
  }
  const capture = createCapture({ dir, client, available: () => available })
  return { dir, capture, client, receipt, calls: () => calls, retains: () => retains, revoke: () => { available = false } }
}
test('stale briefing receipt reconciles verified canonical original without extraction or changing capture attempts', async t => {
  const f = setup(t, { briefing: true }); const before = f.capture.get(f.receipt.id)
  await f.capture.work()
  const after = f.capture.get(f.receipt.id)
  assert.equal(after.state, 'saved'); assert.equal(after.facts, 2); assert.equal(after.reason, null)
  assert.equal(f.calls(), 1); assert.equal(f.retains(), 0); assert.equal(after.attempts, before.attempts)
  assert.equal(after.text, before.text); assert.deepEqual(after.source, before.source); assert.equal(after.createdAt, before.createdAt)
  assert.equal(after.reconciliation.canonicalVersion, 3); assert.equal(after.reconciliation.textHash, sha(before.text))
  const restarted = createCapture({ dir: f.dir, client: f.client }); await restarted.work()
  assert.equal(restarted.get(after.id).state, 'saved'); assert.equal(f.calls(), 1)
})
test('documented historical capture import reconciles verified zero-fact evidence as raw only', async t => {
  const f = setup(t, { proof: r => evidence(r, 'raw_only', true) }); await f.capture.work()
  assert.equal(f.capture.get(f.receipt.id).state, 'raw_only'); assert.equal(f.capture.get(f.receipt.id).facts, 0)
  assert.equal(f.capture.get(f.receipt.id).reason, 'no_extracted_facts'); assert.equal(f.retains(), 0)
})
const invalid = [
  ['archived', p => { p.record.status = 'archived' }], ['superseded', p => { p.record.supersededBy = 'another-id' }],
  ['revision', p => { p.record.supersedes = 'another-id' }], ['expired', p => { p.record.expiresAt = '2020-01-01T00:00:00Z' }],
  ['invalid expiry', p => { p.record.expiresAt = 'invalid' }], ['wrong owner', p => { p.record.owner = 'ivy' }],
  ['wrong scope', p => { p.record.scope = 'domain:email' }], ['wrong type', p => { p.record.type = 'semantic' }],
  ['wrong policy', p => { p.record.approval.id = 'other' }], ['manual approval', p => { p.record.approval.kind = 'owner' }],
  ['wrong source id', p => { p.record.source.id += 'other' }], ['wrong source date', p => { p.record.source.at = '2026-09-29T00:00:00Z' }],
  ['wrong source kind', p => { p.record.source.kind = 'worker' }], ['wrong attribution', p => { p.record.source.attribution = 'assistant_claim' }],
  ['changed original', p => { p.record.text += ' corrected' }], ['wrong document hash', p => { p.indexed.textHash = 'b'.repeat(64) }],
  ['wrong canonical id', p => { p.record.id = 'xx-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }], ['racing version', p => { p.indexed.canonicalVersion++ }],
  ['source only', p => { p.record.index.state = 'source_only'; p.indexed.state = 'source_only' }],
  ['pending', p => { p.record.index.state = 'pending' }], ['saved zero facts', p => { p.record.index.facts = 0; p.indexed.facts = 0 }],
  ['raw-only positive facts', p => { p.record.index.state = 'raw_only'; p.indexed.state = 'raw_only' }],
  ['facts mismatch', p => { p.indexed.facts++ }], ['missing index date', p => { delete p.record.index.checkedAt }],
  ['unproved migration', p => { p.record.source.kind = 'historical_import' }]
]
for (const [name, alter] of invalid) test('unconfirmed capture is preserved for ' + name, async t => {
  const f = setup(t, { proof: r => { const p = evidence(r); alter(p); return p } })
  const file = path.join(f.dir, f.receipt.id + '.json'), before = fs.readFileSync(file)
  await f.capture.work(); assert.equal(f.capture.get(f.receipt.id).state, 'unconfirmed')
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(f.retains(), 0)
})
for (const field of ['textHash', 'source', 'approval', 'firstVersion', 'auditHash']) test('historical import requires intact ' + field + ' proof', async t => {
  const f = setup(t, { proof: r => { const p = evidence(r, 'raw_only', true); delete p.origin[field]; return p } })
  await f.capture.work(); assert.equal(f.capture.get(f.receipt.id).state, 'unconfirmed'); assert.equal(f.retains(), 0)
})
test('edited, forgotten, skipped and opt-out receipts are never read back', async t => {
  for (const state of ['edited', 'forgotten', 'skipped']) {
    const f = setup(t, { state }); await f.capture.work(); assert.equal(f.calls(), 0)
  }
  const f = setup(t, { userText: 'Do not remember this private fixture.' }); await f.capture.work(); assert.equal(f.calls(), 0)
  const legacy = setup(t, { reason: 'owner_opt_out' }); await legacy.capture.work(); assert.equal(legacy.calls(), 0)
})
test('pause or revoked availability during read-back leaves receipt unchanged', async t => {
  for (const action of ['pause', 'revoke']) {
    let release; const gate = new Promise(r => { release = r })
    const f = setup(t, { proof: async r => { await gate; return evidence(r) } })
    const before = fs.readFileSync(path.join(f.dir, f.receipt.id + '.json'))
    const running = f.capture.work(); await new Promise(r => setImmediate(r))
    await assert.rejects(f.capture.mutate(f.receipt.id, 'forgotten', async () => {}), /memory_busy/)
    if (action === 'pause') f.capture.setEnabled(false); else f.revoke()
    release(); await running
    assert.deepEqual(fs.readFileSync(path.join(f.dir, f.receipt.id + '.json')), before); assert.equal(f.retains(), 0)
  }
})
test('failed read-back is bounded, rotates past unresolved history and preserves human retry', async t => {
  const f = setup(t); const other = createCapture({ dir: f.dir, client: f.client }).turn({ id: 'second-fixture', now: at, userText: 'Another NON_BUSINESS fixture.', replyText: 'An isolated reply.' }, 2)
  other.state = 'unconfirmed'; other.reason = 'restart_interrupted'; other.attempts = 1
  fs.writeFileSync(path.join(f.dir, other.id + '.json'), JSON.stringify(other))
  const calls = []; const client = { ...f.client, getCaptureEvidence: async id => { calls.push(id); if (id === f.receipt.id) throw Error('permission_denied'); return evidence(other) } }
  const c = createCapture({ dir: f.dir, client }); await c.work(); assert.equal(calls.length, 1)
  await c.work(); assert.equal(calls.length, 2); assert.notEqual(calls[0], calls[1])
  assert.equal(c.get(other.id).state, 'saved'); assert.equal(c.get(f.receipt.id).state, 'unconfirmed')
  assert.equal(c.retry(f.receipt.id).state, 'pending'); assert.equal(f.retains(), 0)
})
test('read-back does not starve a newly pending receipt or treat legacy get as proof', async t => {
  const f = setup(t, { proof: () => null }); let writes = 0
  const client = { ...f.client, retainAutomatic: async (id, text) => { writes++; return { id, text, facts: 1 } } }
  const c = createCapture({ dir: f.dir, client }); const pending = c.turn({ id: 'new-pending', now: at, userText: 'New NON_BUSINESS event.', replyText: 'Fixture.' }, 2)
  await c.work(); assert.equal(c.get(pending.id).state, 'saved'); assert.equal(c.get(f.receipt.id).state, 'unconfirmed'); assert.equal(writes, 1)
  let legacyReads = 0
  const legacy = createCapture({ dir: f.dir, client: { get: async () => { legacyReads++; return { id: f.receipt.id, text: f.receipt.text, facts: 5 } }, retainAutomatic: async () => { throw Error('must not retry') } } })
  await legacy.work(); assert.equal(legacyReads, 0); assert.equal(legacy.get(f.receipt.id).state, 'unconfirmed')
})
