'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createTestStore } = require('../memory/structuredStore')
const OWNER = { owner: true }
const { createMailHistory } = require('./mailHistory')
function fixture (count = 24) {
  const store = createTestStore(); const retained = new Set(); const reads = []; const scans = []
  let at = '2026-10-01T12:00:00.000Z'; let revoked = false; let failedId = null
  const mailbox = { status: () => ({ mailbox: 'adm@example.test' }),
    lease: actor => { if (!actor?.owner) throw Error('mail_access_denied'); return () => { if (revoked) throw Error('mail_access_denied') } },
    scan: async (_, options) => {
      scans.push(options); const offset = Number(options.pageToken || 0)
      return { messages: Array.from({ length: Math.min(10, count - offset) }, (_, i) => ({ id: (offset + i + 1).toString(16) })), nextPageToken: offset + 10 < count ? String(offset + 10) : null }
    },
    read: async (_, id) => { reads.push(id); if (id === failedId) throw Error('offline'); return { id, date: new Date(2020, 0, Number.parseInt(id, 16)).toISOString(), body: 'Evidence ' + id, bodyState: 'available' } }
  }
  const memory = { enabled: () => true, capture: async (_, message) => { const state = retained.has(message.id) ? 'unchanged' : 'saved'; retained.add(message.id); return { state } } }
  return { store, mailbox, memory, retained, reads, scans, advance: () => { at = '2026-10-01T12:02:00.000Z' }, fail: id => { failedId = id }, revoke: () => { revoked = true },
    history: () => createMailHistory({ store, mailbox, memory, clock: () => at }) }
}
test('full history is snapshot bounded, paginated and durable across worker restart', async () => {
  const f = fixture(); let worker = f.history(); assert.equal((await worker.status()).state, 'not_started')
  await worker.control(OWNER, 'start'); await worker.tick()
  assert.equal(f.retained.size, 10); assert.equal((await worker.status()).state, 'running')
  worker = f.history(); await worker.tick(); await worker.tick()
  const done = await worker.status(); assert.equal(done.state, 'completed'); assert.equal(done.processed, 24); assert.equal(done.retained, 24)
  assert.equal(done.pages, 3); assert.equal(done.excluded, 0); assert.equal(done.completedAt, '2026-10-01T12:00:00.000Z')
  assert.match(f.scans[0].q, /^in:anywhere before:\d+$/); assert.equal(new Set(f.scans.map(p => p.q)).size, 1)
  assert.equal(done.oldestAt, new Date(2020, 0, 1).toISOString()); assert.equal(done.newestAt, new Date(2020, 0, 24).toISOString())
  assert.equal((await f.store.all())[0].source.kind, 'admin_mail_history_import')
})
test('pause, cancel and resume preserve progress; paused capture cannot advance it', async () => {
  const f = fixture(); const worker = f.history(); await worker.control(OWNER, 'start'); await worker.tick()
  await worker.control(OWNER, 'pause'); await worker.tick(); assert.equal(f.retained.size, 10)
  await worker.control(OWNER, 'cancel'); assert.equal((await worker.status()).state, 'cancelled')
  await worker.control(OWNER, 'resume'); await worker.tick(); assert.equal(f.retained.size, 20)
  await worker.control(OWNER, 'pause'); await worker.control(OWNER, 'resume')
  f.memory.capture = async () => ({ state: 'paused' }); await worker.tick()
  assert.equal((await worker.status()).processed, 20); assert.equal((await worker.status()).state, 'failed')
})
test('failure in the middle of a page resumes the remaining messages without inflated coverage', async () => {
  const f = fixture(); const worker = f.history(); await worker.control(OWNER, 'start'); f.fail('4'); await worker.tick()
  assert.equal((await worker.status()).processed, 3); assert.equal((await worker.status()).state, 'failed')
  f.fail(null); f.advance(); await f.history().tick(); assert.equal((await worker.status()).processed, 10)
  assert.deepEqual(f.reads.slice(0, 8), ['1', '2', '3', '4', '4', '5', '6', '7'])
  assert.equal(f.scans.length, 1)
})
test('deleted mail, excluded sensitive evidence and partial bodies remain explicit in coverage', async () => {
  const f = fixture(4)
  f.mailbox.read = async (_, id) => { if (id === '1') throw Error('mail_message_gone'); return { id, bodyTruncated: id === '4', date: null } }
  f.memory.capture = async (_, m) => m.id === '2' ? { state: 'excluded', reason: 'sensitive_content' } : m.id === '3' ? { state: 'body_unavailable' } : { state: 'saved' }
  const worker = f.history(); await worker.control(OWNER, 'start'); await worker.tick()
  const done = await worker.status(); assert.equal(done.state, 'completed'); assert.equal(done.retained, 1); assert.equal(done.excluded, 3); assert.equal(done.partial, 1)
  assert.deepEqual(done.exclusionReasons, { mail_message_gone: 1, excluded: 1, body_unavailable: 1 })
  assert.equal(done.oldestAt, null); assert.equal(done.newestAt, null)
})
test('source revocation denies controls and never advances the saved cursor', async () => {
  const f = fixture(); const worker = f.history(); await assert.rejects(worker.control({ owner: false }, 'start'), /mail_access_denied/)
  await worker.control(OWNER, 'start'); f.memory.capture = async () => { f.revoke(); return { state: 'saved' } }; await worker.tick()
  assert.equal((await worker.status()).processed, 0); await assert.rejects(worker.control(OWNER, 'resume'), /mail_access_denied/)
})
test('large corpus traverses every page and preserves source boundary after resume', async () => {
  const f = fixture(1234); let worker = f.history(); await worker.control(OWNER, 'start')
  for (let i = 0; i < 124; i++) { if (i === 42) worker = f.history(); await worker.tick() }
  const done = await worker.status(); assert.equal(done.processed, 1234); assert.equal(done.retained, 1234); assert.equal(done.pages, 124); assert.equal(done.state, 'completed')
  assert.equal(f.retained.size, 1234); assert.equal(f.reads.length, 1234)
  const other = createMailHistory({ store: f.store, mailbox: { ...f.mailbox, status: () => ({ mailbox: 'other@example.test' }) }, memory: f.memory })
  assert.equal((await other.status()).state, 'not_started')
})
