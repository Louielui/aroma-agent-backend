'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createTestStore } = require('../memory/structuredStore')
const { createMailMemory } = require('./mailMemory')
function fixture () {
  const store = createTestStore(), readAll = store.all, originalGet = store.get
  const reads = { full: 0, manifest: 0 }, calls = [], owner = { owner: true }
  let revision = 0, enabled = true, at = '2026-10-02T00:00:00.000Z', manifestHook = null, subscriptionError = null
  const mailbox = { status: () => ({ mailbox: 'adm@example.test' }),
    lease: actor => { const current = revision; return () => { if (!enabled || actor?.owner !== true || current !== revision) throw Error('mail_access_denied') } },
    check: async actor => mailbox.lease(actor)(), read: async actor => { mailbox.lease(actor)(); return {} } }
  store.mailRows = async () => { reads.full++; return readAll() }
  store.mailIndexRows = async () => {
    reads.manifest++
    if (manifestHook) await manifestHook()
    return (await readAll()).filter(r => ['admin_mail_message', 'admin_mail_thread'].includes(r.source.kind)).map(r => ({
      id: r.id, version: r.version, status: r.status, createdAt: r.createdAt,
      expiresAt: r.expiresAt, supersededBy: r.supersededBy, source: r.source,
      details: { mailbox: r.details.mailbox, hash: r.details.hash ?? null, threadId: r.details.threadId ?? null }, index: r.index }))
  }
  const client = { get: async () => null, retainAutomatic: async (id, text) => { calls.push({ id, text }); return { id, text, facts: 1 } } }
  const memory = createMailMemory({ store, mailbox, engine: { forMailSource: () => client }, clock: () => at,
    analyzer: { preflight: async () => { if (subscriptionError) throw Error(subscriptionError) } } })
  const add = (id, body = 'Vendor confirmed a delivery.', extra = {}) => memory.capture(owner, { id, threadId: id,
    mailbox: 'adm@example.test', subject: 'Delivery', from: 'vendor@example.test', date: '2026-10-01T12:00:00Z',
    internalDate: '1790856000000', body, bodyState: 'available', bodyTruncated: false, ...extra })
  return { store, memory, owner, reads, calls, client, add, readAll, originalGet, mailbox,
    subscription: error => { subscriptionError = error },
    manifest: fn => { manifestHook = fn }, revoke: () => { enabled = false; revision++ }, time: value => { at = value },
    change: async (row, changes) => store.commit([{ expected: row.version, row: { ...row, ...changes, version: row.version + 1 } }], { op: 'fixture_change', actor: 'owner' }) }
}
test('background index warms original eligibility once and uses body-free manifests thereafter', async () => {
  const f = fixture(); await f.add('aa'); await f.add('bb')
  assert.equal((await f.memory.indexNext(f.owner)).state, 'saved')
  assert.equal((await f.memory.indexNext(f.owner)).state, 'saved')
  assert.equal((await f.memory.indexNext(f.owner)).state, 'idle')
  assert.equal(f.reads.full, 1); assert.equal(f.reads.manifest, 2); assert.equal(f.calls.length, 2)
})
test('changed original is read and checked again; an approved Owner decision is preserved', async () => {
  const f = fixture(); await f.add('aa', 'Vendor chose blue crates.')
  const t = (await f.readAll()).find(r => r.source.kind === 'admin_mail_thread')
  await f.memory.update(f.owner, t.id, t.version, { action: 'approve', text: 'Owner chose red crates.', assignee: null, deadline: null, taskState: 'open' })
  await f.memory.indexNext(f.owner)
  await f.add('aa', 'Vendor correction: green crates.')
  const currentThread = (await f.readAll()).find(r => r.source.kind === 'admin_mail_thread')
  assert.equal((await f.memory.indexNext(f.owner)).state, 'saved')
  assert.match(f.calls[1].text, /green crates/); assert.doesNotMatch(f.calls[1].text, /blue crates/)
  assert.deepEqual(await f.store.get(t.id), currentThread)
  assert.equal(f.reads.full, 1)
})
test('cached eligibility never bypasses current archive, expiry, revocation or original hash checks', async () => {
  for (const mode of ['archive', 'expire', 'revoke', 'corrupt']) {
    const f = fixture(); await f.add('aa'); await f.add('bb'); await f.memory.indexNext(f.owner)
    f.manifest(async () => {
      f.manifest(null)
      const rows = await f.readAll(), message = rows.find(r => r.source.id === 'bb' && r.source.kind === 'admin_mail_message')
      if (mode === 'revoke') f.revoke()
      else if (mode === 'archive') {
        const thread = rows.find(r => r.source.id === 'bb' && r.source.kind === 'admin_mail_thread')
        await f.change(thread, { status: 'archived' })
      } else if (mode === 'expire') await f.change(message, { expiresAt: '2026-10-01T00:00:00.000Z' })
      else {
        // An inconsistent read with the same advertised revision must still fail the final body check.
        f.store.get = async id => { const r = await f.originalGet(id); if (id === message.id) r.text = 'Invented body'; return r }
      }
    })
    if (mode === 'revoke') await assert.rejects(f.memory.indexNext(f.owner), /denied/)
    else assert.ok(['idle', 'changed'].includes((await f.memory.indexNext(f.owner)).state), mode)
    assert.equal(f.calls.length, 1, mode)
  }
})
test('local policy reconciliation stays in batches of twenty and preserves exhausted retry state', async () => {
  const f = fixture()
  for (let n = 1; n <= 25; n++) await f.add(n.toString(16), 'Long original. '.repeat(3000))
  for (const r of (await f.readAll()).filter(r => r.source.kind === 'admin_mail_message')) {
    await f.change(r, { index: { state: 'unconfirmed', attempts: 3, nextRetryAt: '2030-01-01T00:00:00.000Z' } })
  }
  assert.equal((await f.memory.indexNext(f.owner)).count, 20)
  assert.equal((await f.memory.indexNext(f.owner)).count, 5)
  assert.equal((await f.memory.indexNext(f.owner)).state, 'idle')
  assert.equal(f.reads.full, 1); assert.equal(f.calls.length, 0)
  assert.ok((await f.readAll()).filter(r => r.source.kind === 'admin_mail_message').every(r => r.index.attempts === 3 && r.text.length > 32000))
})
test('new eligibility checks are bounded and yield before extraction while unclassified sources remain', async () => {
  const f = fixture(); await f.add('aa'); await f.memory.indexNext(f.owner)
  for (let n = 1; n <= 25; n++) await f.add((n + 256).toString(16), 'New original. '.repeat(3000))
  let bodyReads = 0
  f.store.get = async id => { const r = await f.originalGet(id); if (r?.source.kind === 'admin_mail_message') bodyReads++; return r }
  assert.equal((await f.memory.indexNext(f.owner)).state, 'scanning')
  assert.equal(bodyReads, 20); assert.equal(f.calls.length, 1)
  assert.equal((await f.memory.indexNext(f.owner)).count, 20)
  assert.equal((await f.memory.indexNext(f.owner)).count, 5)
  assert.equal(f.reads.full, 1)
})
test('manifest failure fails closed without reverting to a full body read or a model call', async () => {
  const f = fixture(); await f.add('aa'); await f.memory.indexNext(f.owner)
  f.manifest(() => { throw Error('memory_database_unavailable') })
  await assert.rejects(f.memory.indexNext(f.owner), /memory_database_unavailable/)
  assert.equal(f.reads.full, 1); assert.equal(f.calls.length, 1)
})
test('manifest path preserves durable retry deadlines and the exhausted source budget', async () => {
  const f = fixture(); await f.add('aa')
  let attempts = 0
  f.client.retainAutomatic = async () => { attempts++; throw Error('memory_timeout') }
  for (let n = 0; n < 3; n++) {
    assert.equal((await f.memory.indexNext(f.owner)).state, 'unconfirmed')
    assert.equal((await f.memory.indexNext(f.owner)).state, 'idle')
    const r = (await f.readAll()).find(r => r.source.kind === 'admin_mail_message')
    assert.equal(r.index.attempts, n + 1)
    if (r.index.nextRetryAt) f.time(r.index.nextRetryAt)
  }
  assert.equal((await f.memory.indexNext(f.owner)).state, 'idle')
  assert.equal(attempts, 3); assert.equal(f.reads.full, 1)
})
test('cached eligibility never bypasses the subscription gate or spends an original retry during quota wait', async () => {
  const f = fixture(); await f.add('aa'); await f.add('bb'); await f.memory.indexNext(f.owner)
  const before = (await f.readAll()).find(r => r.source.id === 'bb' && r.source.kind === 'admin_mail_message')
  let providerReads = 0
  f.client.get = async () => { providerReads++; return null }
  f.subscription('subscription_limit_reached')
  assert.equal((await f.memory.indexNext(f.owner)).state, 'backoff')
  assert.equal((await f.memory.indexNext(f.owner)).state, 'backoff')
  assert.deepEqual(await f.store.get(before.id), before)
  assert.equal(providerReads, 0); assert.equal(f.calls.length, 1); assert.equal(f.reads.full, 1)
})
test('a fresh process validates originals again instead of trusting the previous process cache', async () => {
  const f = fixture(); await f.add('aa'); await f.add('bb'); await f.memory.indexNext(f.owner)
  const restarted = createMailMemory({ store: f.store, mailbox: f.mailbox,
    engine: { forMailSource: () => f.client }, clock: () => '2026-10-02T00:00:00.000Z' })
  assert.equal((await restarted.indexNext(f.owner)).state, 'saved')
  assert.equal(f.reads.full, 2); assert.equal(f.calls.length, 2)
})
