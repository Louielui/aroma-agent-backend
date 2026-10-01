'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createTestStore } = require('../memory/structuredStore')
const { createMailMemory } = require('./mailMemory')

function fixture () {
  const store = createTestStore(); let enabled = true; let revision = 0; let semanticFail = false; let paused = false
  const calls = []; const documents = new Map(); let hits = []
  const owner = { owner: true }
  const mailbox = { status: () => ({ mailbox: 'adm@example.test' }),
    lease: actor => { const at = revision; return () => { if (!enabled || actor?.owner !== true || at !== revision) throw Error('mail_access_denied') } },
    check: async actor => mailbox.lease(actor)(), read: async actor => { mailbox.lease(actor)(); return {} } }
  const client = { get: async id => documents.get(id) || null,
    retainAutomatic: async (id, text, source) => { calls.push({ id, text, source }); const d = { id, text, facts: 1 }; documents.set(id, d); return d },
    recall: async query => { if (semanticFail) throw Error('secret-provider-detail'); return hits },
    forget: async id => documents.delete(id) }
  const engine = { forMailSource: account => { assert.equal(account, 'adm@example.test'); return client }, forScope: () => { throw Error('shared_bank_forbidden') } }
  const memory = createMailMemory({ store, mailbox, engine, allowed: () => !paused, clock: () => '2026-10-01T16:00:00.000Z' })
  const add = (id, body, subject = 'Vendor delivery', extra = {}) => memory.capture(owner,
    { id, threadId: 'aaa', mailbox: 'adm@example.test', subject, from: 'Vendor <vendor@example.test>', body,
      date: '2026-09-30T12:00:00Z', internalDate: '1790769600000', bodyState: 'available', bodyTruncated: false, ...extra })
  return { store, owner, mailbox, client, engine, memory, calls, documents, add, hits: value => { hits = value },
    pause: value => { paused = value }, revoke: () => { enabled = false; revision++ }, restore: () => { enabled = true; revision++ }, fail: () => { semanticFail = true } }
}
test('mail source indexing preserves canonical ID, original date and hash in a dedicated bank', async () => {
  const f = fixture(); await f.add('abc', 'We agreed to deliver blue crates next Friday.')
  const result = await f.memory.indexNext(f.owner)
  assert.equal(result.state, 'saved'); assert.equal(f.calls.length, 1)
  const row = (await f.store.all()).find(r => r.source.kind === 'admin_mail_message')
  assert.equal(row.index.state, 'saved'); assert.equal(row.index.facts, 1)
  assert.equal(row.index.contentHash, row.details.hash); assert.equal(f.calls[0].source.id, 'abc')
  assert.equal(f.calls[0].source.at, '2026-09-30T12:00:00.000Z')
  assert.match(f.calls[0].text, new RegExp(row.id)); assert.match(f.calls[0].text, new RegExp(row.details.hash))
  assert.equal((await f.memory.indexNext(f.owner)).state, 'idle')
  await assert.rejects(f.memory.indexNext({ sub: 'ivy' }), /denied/)
})
test('semantic hits resolve only current authorized originals, include citations, and lexical fallback reports outage', async () => {
  const f = fixture(); await f.add('abc', 'We agreed to deliver blue crates next Friday.')
  await f.memory.indexNext(f.owner); const row = (await f.store.all()).find(r => r.source.kind === 'admin_mail_message')
  f.hits([{ documentId: row.index.documentId, text: 'INVENTED: 500 crates were delivered' }, { documentId: 'unknown', text: 'leak' }])
  const semantic = await f.memory.recall(f.owner, 'previous carton arrangement')
  assert.equal(semantic.length, 1); assert.equal(semantic[0].text, row.text); assert.equal(semantic[0].documentId, row.id)
  assert.equal(semantic[0].sourceId, 'abc'); assert.equal(semantic[0].date, row.source.at)
  assert.equal(semantic[0].contentHash, row.details.hash); assert.match(semantic[0].url, /#all\/abc$/)
  assert.doesNotMatch(JSON.stringify(semantic), /INVENTED|500|leak/); assert.equal(semantic.retrieval.semantic, 'ok')
  f.fail(); const fallback = await f.memory.recall(f.owner, 'blue crates')
  assert.equal(fallback.length, 1); assert.equal(fallback.retrieval.semantic, 'unavailable'); assert.equal(fallback.retrieval.source, 'ok')
  await assert.rejects(f.memory.recall({ sub: 'ivy' }, 'crates'), /denied/)
  f.revoke(); await assert.rejects(f.memory.recall(f.owner, 'crates'), /denied/)
})
test('revocation and canonical archival during retrieval cannot leak prior content', async () => {
  const f = fixture(); await f.add('abc', 'Private vendor promise'); await f.memory.indexNext(f.owner)
  const row = (await f.store.all()).find(r => r.source.kind === 'admin_mail_message')
  f.client.recall = async () => { f.revoke(); return [{ documentId: row.index.documentId }] }
  await assert.rejects(f.memory.recall(f.owner, 'promise'), /denied/)
  const g = fixture(); await g.add('abc', 'Private vendor promise'); await g.memory.indexNext(g.owner)
  const current = (await g.store.all()).find(r => r.source.kind === 'admin_mail_message')
  g.client.recall = async () => { await g.store.commit([{ expected: current.version, row: { ...current, version: current.version + 1, status: 'archived' } }], { op: 'archive', actor: 'owner' }); return [{ documentId: current.index.documentId }] }
  assert.equal((await g.memory.recall(g.owner, 'promise')).length, 0)
})
test('revised originals reject stale semantic hits; current owner decision outranks unapproved claims', async () => {
  const f = fixture(); await f.add('abc', 'Vendor suggests blue crates.'); await f.memory.indexNext(f.owner)
  const old = (await f.store.all()).find(r => r.source.kind === 'admin_mail_message')
  await f.add('abc', 'Correction: vendor suggests green crates.')
  f.hits([{ documentId: old.index.documentId }])
  assert.equal((await f.memory.recall(f.owner, 'old blue promise')).length, 0)
  const thread = (await f.memory.list(f.owner)).items[0]
  await f.memory.update(f.owner, thread.id, thread.version, { action: 'approve', text: 'Owner decided to order red crates.', assignee: null, deadline: null, taskState: 'open' })
  const rows = await f.memory.recall(f.owner, 'red crates')
  assert.equal(rows[0].canonicalDecision.text, 'Owner decided to order red crates.')
  assert.equal(rows[0].canonicalDecision.approval.kind, 'owner'); assert.equal(rows[0].canonicalDecision.dispatchPermission, false)
  assert.equal(rows[0].text, 'Correction: vendor suggests green crates.')
})
test('indexing failure keeps raw source available; racing source revision is never overwritten', async () => {
  const f = fixture(); await f.add('abc', 'A delivery promise.')
  f.client.retainAutomatic = async () => { throw Error('memory_timeout') }
  const failed = await f.memory.indexNext(f.owner); assert.equal(failed.state, 'unconfirmed')
  assert.equal((await f.memory.recall(f.owner, 'delivery promise')).length, 1)
  const g = fixture(); await g.add('abc', 'Original promise.')
  g.client.retainAutomatic = async (id, text) => { await g.add('abc', 'Revised promise.'); return { id, text, facts: 1 } }
  assert.equal((await g.memory.indexNext(g.owner)).state, 'changed')
  const row = (await g.store.all()).find(r => r.source.kind === 'admin_mail_message')
  assert.equal(row.text, 'Revised promise.'); assert.notEqual(row.index.state, 'saved')
})
test('partial bodies and bounded retrieval are explicit and never claim full mail history', async () => {
  const f = fixture(); await f.add('abc', 'Vendor delivery. '.repeat(400), 'Delivery', { bodyTruncated: true, date: null })
  const rows = await f.memory.recall(f.owner, 'delivery')
  assert.equal(rows[0].date, null); assert.equal(rows[0].partial, true); assert.ok(rows[0].text.length <= 4000)
  assert.equal(rows.retrieval.coverage, 'saved_sources_only'); assert.equal(rows.retrieval.partialBodies, 1)
})
test('foreground cancellation releases indexing without replacing canonical retry state', async () => {
  const f = fixture(); await f.add('abc', 'Vendor agreed to deliver on Friday.')
  let begin; const began = new Promise(resolve => { begin = resolve })
  f.client.withSignal = signal => ({ ...f.client, retainAutomatic: async () => { begin(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('memory_timeout')), { once: true })); return null } })
  const job = f.memory.indexNext(f.owner); await began
  f.memory.cancelAnalysis(); assert.equal((await job).state, 'yielded')
  const row = (await f.store.all()).find(r => r.source.kind === 'admin_mail_message')
  assert.equal(row.index.state, 'source_only'); assert.equal(row.index.attempts, 0)
  assert.equal((await f.memory.status()).hindsight.busy, false)
})
test('automatic semantic indexing stops after three failures and explicit retry queues only current source', async () => {
  const f = fixture(); await f.add('abc', 'Vendor agreed Friday.'); let calls = 0
  f.client.retainAutomatic = async () => { calls++; throw Error('memory_unavailable') }
  for (let n = 0; n < 3; n++) {
    assert.equal((await f.memory.indexNext(f.owner)).state, 'unconfirmed')
    const row = (await f.store.all()).find(r => r.source.kind === 'admin_mail_message')
    if (n < 2) await f.store.commit([{ expected: row.version, row: { ...row, version: row.version + 1, index: { ...row.index, nextRetryAt: null } } }], { op: 'test_clock', actor: 'owner' })
  }
  assert.equal((await f.memory.indexNext(f.owner)).state, 'idle'); assert.equal(calls, 3)
  const state = (await f.memory.status()).hindsight
  assert.equal(state.exhausted, 1); assert.equal(state.retrying, 0); assert.equal(state.failed, 1)
  await assert.rejects(f.memory.retryIndex({ sub: 'ivy' }), /denied/)
  assert.equal((await f.memory.retryIndex(f.owner)).count, 1)
  assert.equal((await f.memory.indexNext(f.owner)).state, 'unconfirmed'); assert.equal(calls, 4)
})
test('archived threads, expired and superseded messages, and inconsistent original hashes stay out of recall', async () => {
  for (const change of ['thread_archive', 'expired', 'superseded', 'hash_changed']) {
    const f = fixture(); await f.add('abc', 'Private delivery promise.')
    const row = (await f.store.all()).find(r => r.source.kind === (change === 'thread_archive' ? 'admin_mail_thread' : 'admin_mail_message'))
    if (change === 'thread_archive') row.status = 'archived'
    if (change === 'expired') row.expiresAt = '2026-09-30T00:00:00.000Z'
    if (change === 'superseded') row.supersededBy = 'xx-replacement'
    if (change === 'hash_changed') row.text = 'Invented delivery promise.'
    await f.store.commit([{ expected: row.version, row: { ...row, version: row.version + 1 } }], { op: 'test_change', actor: 'owner' })
    assert.equal((await f.memory.recall(f.owner, 'delivery promise')).length, 0, change)
  }
})
test('malformed semantic result falls back to canonical lexical records rather than throwing or silently emptying', async () => {
  const f = fixture(); await f.add('abc', 'Delivery promise.')
  f.client.recall = async () => ({ results: 'invalid' })
  const result = await f.memory.recall(f.owner, 'delivery promise')
  assert.equal(result.length, 1); assert.equal(result.retrieval.semantic, 'unavailable')
})
test('explicit disaster recovery rebuilds a lost dedicated bank while preserving originals and Owner decision', async () => {
  const f = fixture(); await f.add('abc', 'Vendor agreed Friday.'); await f.memory.indexNext(f.owner)
  const thread = (await f.memory.list(f.owner)).items[0]
  await f.memory.update(f.owner, thread.id, thread.version, { action: 'approve', text: 'Owner chose Monday.', assignee: null, deadline: null, taskState: 'open' })
  const before = await f.store.get(thread.id); const evidence = (await f.store.all()).find(r => r.source.kind === 'admin_mail_message')
  f.documents.clear(); assert.equal((await f.memory.indexNext(f.owner)).state, 'idle')
  await assert.rejects(f.memory.rebuildIndex({ sub: 'ivy' }), /denied/)
  assert.equal((await f.memory.rebuildIndex(f.owner)).count, 1)
  const after = await f.store.get(thread.id); assert.deepEqual(after, before)
  assert.equal((await f.memory.indexNext(f.owner)).state, 'queued')
  assert.equal((await f.memory.indexNext(f.owner)).state, 'saved'); assert.equal(f.documents.size, 1)
  const restored = await f.store.get(evidence.id)
  assert.equal(restored.text, evidence.text); assert.equal(restored.details.hash, evidence.details.hash)
  assert.equal(restored.source.at, evidence.source.at); assert.equal(restored.index.documentId, evidence.index.documentId)
})
test('rebuild queue uses bounded durable commits and reports progress on interruption', async () => {
  const f = fixture()
  for (const id of ['abc', 'abd', 'abe']) { await f.add(id, 'Vendor agreed Friday ' + id); await f.memory.indexNext(f.owner) }
  const original = f.store.commit; let calls = 0; let fail = true
  f.store.commit = async (changes, audit) => {
    if (audit.op === 'mail_index_rebuild') { assert.equal(changes.length, 1); calls++; if (fail && calls === 2) throw Error('database_temporarily_unavailable') }
    return original(changes, audit)
  }
  assert.equal((await f.memory.rebuildIndex(f.owner)).count, 3)
  assert.equal((await f.memory.indexNext(f.owner)).state, 'rebuild_failed')
  assert.equal((await f.store.all()).filter(r => r.source.kind === 'admin_mail_message' && r.index.state === 'pending').length, 1)
  fail = false; assert.equal((await f.memory.rebuildIndex(f.owner)).count, 3)
  assert.equal((await f.memory.indexNext(f.owner)).state, 'queued')
  assert.equal((await f.memory.status()).hindsight.rebuild.queued, 3)
})
test('lexical source recall includes the actual matching original when its quote is beyond the first four thousand characters', async () => {
  const f = fixture(); const body = 'General statement. '.repeat(300) + 'RareZebra agreed Friday.'
  await f.add('abc', body)
  const result = await f.memory.recall(f.owner, 'RareZebra')
  assert.equal(result.length, 1); assert.match(result[0].text, /RareZebra agreed Friday/)
  assert.ok(result[0].excerptOffset > 4000); assert.equal(result[0].partial, true)
  assert.equal(body.slice(result[0].excerptOffset, result[0].excerptOffset + result[0].text.length), result[0].text)
})
test('mail semantic status separates configured, observed connectivity, partial indexing and original authority', async () => {
  const f = fixture(); await f.add('abc', 'Vendor agreed Friday. '.repeat(1200))
  let status = (await f.memory.status()).hindsight
  assert.equal(status.configured, true); assert.equal(status.connected, null); assert.equal(status.connectionState, 'unverified')
  assert.equal(status.connectionCheckedAt, null); assert.equal(status.pending, 1)
  assert.equal((await f.memory.indexNext(f.owner)).state, 'saved')
  status = (await f.memory.status()).hindsight
  assert.equal(status.connected, true); assert.equal(status.connectionState, 'verified')
  assert.equal(status.partialIndex, 1); assert.equal(status.saved, 1); assert.equal(status.pending, 0)
  const thread = (await f.memory.list(f.owner)).items[0]
  assert.equal(thread.status, 'candidate'); assert.equal(thread.approval, null)
  f.fail(); await f.memory.recall(f.owner, 'vendor agreed')
  status = (await f.memory.status()).hindsight
  assert.equal(status.connected, false); assert.equal(status.connectionState, 'unavailable')
  assert.equal(status.connectionCheckedAt, '2026-10-01T16:00:00.000Z'); assert.equal(status.saved, 1)
})
test('durable rebuild manifest resumes after a crash between source reset and checkpoint before any model call', async () => {
  const f = fixture()
  for (const id of ['abc', 'abd', 'abe']) { await f.add(id, 'Vendor agreed Friday ' + id); await f.memory.indexNext(f.owner) }
  const callsBefore = f.calls.length
  const declared = await f.memory.rebuildIndex(f.owner)
  const started = (await f.memory.status()).hindsight.rebuild
  assert.equal(started.state, 'queued'); assert.equal(started.total, 3); assert.equal(started.queued, 0)
  assert.equal(started.cutoff, '2026-10-01T16:00:00.000Z'); assert.equal(started.id, declared.id)
  const original = f.store.commit; let fail = true
  f.store.commit = async (changes, audit) => {
    if (fail && audit.op === 'mail_index_rebuild_checkpoint' && changes[0].row.details.state.queued === 1) { fail = false; throw Error('simulated_process_interruption') }
    return original(changes, audit)
  }
  assert.equal((await f.memory.indexNext(f.owner)).state, 'rebuild_failed')
  assert.equal(f.calls.length, callsBefore)
  const alreadyQueued = (await f.store.all()).filter(r => r.source.kind === 'admin_mail_message' && r.index.rebuildId === declared.id)
  assert.equal(alreadyQueued.length, 1)
  const firstVersion = alreadyQueued[0].version
  const restarted = createMailMemory({ store: f.store, mailbox: f.mailbox, engine: f.engine, clock: () => '2026-10-01T16:01:00.000Z' })
  assert.equal((await restarted.indexNext(f.owner)).state, 'queued')
  assert.equal(f.calls.length, callsBefore)
  const complete = (await restarted.status()).hindsight.rebuild
  assert.equal(complete.id, declared.id); assert.equal(complete.state, 'completed')
  assert.equal(complete.total, 3); assert.equal(complete.queued, 3); assert.equal(complete.remaining, 0)
  assert.equal((await f.store.get(alreadyQueued[0].id)).version, firstVersion)
  assert.equal((await restarted.indexNext(f.owner)).state, 'saved')
})
test('rebuild progress is bounded, pauses while runtime or source permission is unavailable, and excludes sources created after cutoff', async () => {
  const f = fixture()
  for (let n = 1; n <= 25; n++) await f.add(n.toString(16), 'Vendor agreed Friday ' + n)
  const declared = await f.memory.rebuildIndex(f.owner)
  f.pause(true); assert.equal((await f.memory.indexNext(f.owner)).state, 'paused')
  assert.equal((await f.memory.status()).hindsight.rebuild.queued, 0)
  f.pause(false); f.revoke(); await assert.rejects(f.memory.indexNext(f.owner), /denied/)
  assert.equal((await f.memory.status()).hindsight.rebuild.queued, 0)
  f.restore(); assert.equal((await f.memory.indexNext(f.owner)).state, 'rebuilding')
  const progress = (await f.memory.status()).hindsight.rebuild
  assert.equal(progress.queued, 20); assert.equal(progress.remaining, 5); assert.equal(f.calls.length, 0)
  const next = createMailMemory({ store: f.store, mailbox: f.mailbox, engine: f.engine, clock: () => '2026-10-01T16:01:00.000Z' })
  await next.capture(f.owner, { id: 'abc', threadId: 'aaa', mailbox: 'adm@example.test', subject: 'New mail', from: 'Vendor', body: 'Arrived later.', date: null, bodyState: 'available' })
  assert.equal((await next.indexNext(f.owner)).state, 'queued')
  const finished = (await next.status()).hindsight.rebuild
  assert.equal(finished.queued, 25); assert.equal(finished.remaining, 0)
  const later = (await f.store.all()).find(r => r.source.id === 'abc' && r.source.kind === 'admin_mail_message')
  assert.notEqual(later.index.rebuildId, declared.id); assert.equal(f.calls.length, 0)
})
