'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createTestStore } = require('../memory/structuredStore')
const { createMailMemory } = require('./mailMemory')
const { createGateway, OWNER } = require('../memory/governed')
function fixture () {
  const store = createTestStore(); let allowed = true; let rev = 0
  const rows = new Map()
  const mailbox = { status: () => ({ state: allowed ? 'connected' : 'not_connected', mailbox: 'adm@example.test' }),
    lease: actor => { const start = rev; return () => { if (!allowed || !actor.owner || start !== rev) throw Error('mail_access_denied') } },
    read: async (actor, id) => { mailbox.lease(actor)(); if (!rows.has(id)) throw Error('missing'); return structuredClone(rows.get(id)) },
    scan: async () => ({ messages: [...rows.values()].map(r => ({ id: r.id })), nextPageToken: null }) }
  const memory = createMailMemory({ store, mailbox, clock: () => '2026-09-29T20:00:00.000Z' })
  const add = (id, body, at = '2026-09-29T12:00:00Z') => rows.set(id, { id, threadId: 'aaa', body, subject: 'Invoice', from: 'Vendor', date: at, internalDate: String(Date.parse(at)), mailbox: 'adm@example.test', bodyState: 'available', bodyTruncated: false, readAt: '2026-09-29T20:00:00Z' })
  return { store, mailbox, memory, add, revoke: () => { allowed = false; rev++ }, owner: { owner: true } }
}
test('mail snapshots deduplicate, preserve provenance, and replies flag the same approved task for review', async () => {
  const f = fixture(); f.add('abc', 'Please confirm the invoice.')
  await f.memory.capture(f.owner, await f.mailbox.read(f.owner, 'abc'))
  await f.memory.capture(f.owner, await f.mailbox.read(f.owner, 'abc'))
  let list = await f.memory.list(f.owner, '')
  assert.equal(list.items.length, 1); let row = list.items[0]
  assert.equal(row.details.assignee, null); assert.equal(row.details.deadline, null)
  assert.equal(row.status, 'candidate'); assert.equal(row.details.messageIds.length, 1)
  row = await f.memory.update(f.owner, row.id, row.version, { action: 'approve', text: 'Check the invoice', assignee: 'Louie', deadline: null, taskState: 'open' })
  assert.equal(row.approval.kind, 'owner'); assert.equal(row.status, 'active')
  f.add('abd', 'Correction: invoice cancelled.', '2026-09-29T13:00:00Z')
  await f.memory.capture(f.owner, await f.mailbox.read(f.owner, 'abd'))
  list = await f.memory.list(f.owner, '')
  assert.equal(list.items.length, 1); row = list.items[0]
  assert.equal(row.details.needsReview, true); assert.equal(row.text, 'Check the invoice'); assert.equal(row.details.taskState, 'open')
  assert.equal(row.details.messageIds.length, 2)
  assert.ok((await f.memory.detail(f.owner, row.id)).audit.length >= 3)
  await assert.rejects(f.memory.update(f.owner, row.id, 1, { action: 'reject' }), /conflict/)
})
test('mail content cannot escape through generic memory, agents, audit, or revoked source reads', async () => {
  const f = fixture(); f.add('abc', 'Secret invoice')
  await f.memory.capture(f.owner, await f.mailbox.read(f.owner, 'abc'))
  const row = (await f.memory.list(f.owner, '')).items[0]
  const gateway = createGateway({ store: f.store })
  assert.equal((await gateway.list(OWNER)).length, 0)
  await assert.rejects(gateway.get(OWNER, row.id), /permission/)
  await assert.rejects(gateway.audit(OWNER, row.id), /permission/)
  assert.equal((await gateway.recall(OWNER, 'invoice')).length, 0)
  await assert.rejects(f.memory.list({ sub: 'ivy' }, ''), /denied/)
  f.revoke()
  await assert.rejects(f.memory.list(f.owner, ''), /denied/)
  await assert.rejects(f.memory.detail(f.owner, row.id), /denied/)
})
test('capture failures stay visible; synchronization retries without inventing a complete history', async () => {
  const f = fixture(); f.add('abc', 'Invoice')
  const result = await f.memory.sync()
  assert.equal(result.captured, 1); assert.equal(result.hasMore, false)
  assert.equal((await f.memory.list(f.owner, 'invoice')).items.length, 1)
  assert.equal((await f.memory.sync()).captured, 0)
  const row = (await f.memory.list(f.owner, '')).items[0]
  f.mailbox.read = async () => { f.revoke(); throw Error('revoked') }
  await assert.rejects(f.memory.detail(f.owner, row.id))
})
test('durable page progress resumes after restart and a failed page does not advance the watermark', async () => {
  const f = fixture(); f.add('abc', 'First batch'); f.add('abd', 'Second batch')
  const queries = []; let fail = true
  f.mailbox.scan = async (actor, input) => {
    queries.push(input)
    if (!input.pageToken) return { messages: [{ id: 'abc' }], nextPageToken: 'page-two' }
    if (fail) throw Error('provider_failure')
    return { messages: [{ id: 'abd' }], nextPageToken: null }
  }
  assert.equal((await f.memory.sync()).hasMore, true)
  const next = createMailMemory({ store: f.store, mailbox: f.mailbox, clock: () => '2026-09-29T21:00:00.000Z' })
  await assert.rejects(next.sync(), /provider_failure/)
  assert.equal((await next.status()).completedAt, null)
  assert.equal((await next.status()).error, 'mail_memory_sync_unavailable')
  fail = false; assert.equal((await next.sync()).captured, 1)
  assert.equal(queries[0].q, queries[2].q); assert.equal(queries[2].pageToken, 'page-two')
  assert.equal((await next.status()).completedAt, '2026-09-29T20:00:00.000Z')
  assert.equal((await next.list(f.owner, 'Second')).items.length, 1)
})
test('revocation during store read fails closed and a source-bound ID cannot be adopted by generic memory', async () => {
  const f = fixture(); f.add('abc', 'Private evidence'); await f.memory.capture(f.owner, await f.mailbox.read(f.owner, 'abc'))
  const thread = (await f.memory.list(f.owner, '')).items[0]
  const gateway = createGateway({ store: f.store })
  await assert.rejects(gateway.propose(OWNER, { id: thread.id, type: 'episodic', scope: 'domain:email', subject: 'Attempt', text: thread.text,
    source: { kind: 'owner', id: 'attempt', at: null, attribution: 'owner_statement' } }), /permission/)
  const original = f.store.all
  f.store.all = async () => { const rows = await original(); f.revoke(); return rows }
  await assert.rejects(f.memory.list(f.owner, ''), /denied/)
})
