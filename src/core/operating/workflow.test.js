'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createManager, TOOLS } = require('./manager')
const { createMemoryRunStore } = require('./runStore')
const owner = { role: 'owner', id: 'owner' }
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture (options = {}) {
  const events = []; const store = options.runStore || createMemoryRunStore()
  return { store, events, manager: createManager({ activity: { append: e => events.push(e), list: () => events },
    gateway: { read: async (actor, tool) => ({ state: 'ok', count: 1, rows: [{ title: tool }], tool }) }, runStore: store, ...options }) }
}
test('accepted jobs persist and expose progress; duplicate request ids never repeat reads', async () => {
  let release; let reads = 0
  const f = fixture({ gateway: { read: async () => { reads++; if (reads === 1) await new Promise(r => { release = r }); return { state: 'ok', count: 1, rows: [] } } } })
  const key = randomUUID(); const run = f.manager.start(owner, { requestId: key })
  assert.equal(run.state, 'queued'); await tick()
  assert.equal(f.manager.get(run.id).steps[0].state, 'running')
  assert.equal(f.manager.start(owner, { requestId: key }).id, run.id)
  assert.throws(() => f.manager.start(owner, { requestId: randomUUID() }), /briefing_busy/)
  release(); await f.manager.wait(run.id)
  assert.equal(reads, TOOLS.length); assert.equal(f.manager.get(run.id).state, 'completed')
  assert.equal(f.manager.get(run.id).sections[0].count, 1)
  assert.equal(f.manager.start(owner, { requestId: key }).id, run.id); assert.equal(reads, TOOLS.length)
  assert.equal(f.store.get(run.id).state, 'completed')
})
test('cancel stops subsequent tools and late results cannot overwrite cancellation; retries link once', async () => {
  let release; let calls = 0
  const f = fixture({ gateway: { read: async () => { calls++; await new Promise(r => { release = r }); return { state: 'ok', count: 1, rows: [] } } } })
  const run = f.manager.start(owner, { requestId: randomUUID() }); await tick()
  f.manager.cancel(owner, run.id); await f.manager.wait(run.id)
  assert.equal(f.manager.get(run.id).state, 'cancelled'); assert.equal(calls, 1)
  release(); await tick(); assert.equal(f.manager.get(run.id).sections.length, 0)
  const retry = f.manager.retry(owner, run.id)
  assert.equal(retry.retryOf, run.id); assert.equal(f.manager.retry(owner, run.id).id, retry.id)
  f.manager.cancel(owner, retry.id); await f.manager.wait(retry.id)
})
test('timeouts terminate a hung tool and recovery marks unfinished work interrupted without replay', async () => {
  const f = fixture({ gateway: { read: () => new Promise(() => {}) }, stepTimeoutMs: 15, runTimeoutMs: 60 })
  const run = f.manager.start(owner, { requestId: randomUUID() }); await f.manager.wait(run.id)
  assert.equal(f.manager.get(run.id).state, 'timed_out')
  assert.equal(f.manager.get(run.id).steps[0].count, null)
  const interrupted = { ...f.store.get(run.id), id: randomUUID(), state: 'running', finishedAt: null }
  f.store.save(interrupted)
  let calls = 0
  const recovered = fixture({ runStore: f.store, gateway: { read: async () => { calls++; throw Error() } } })
  assert.equal(recovered.manager.get(interrupted.id).state, 'interrupted'); assert.equal(calls, 0)
  assert.equal(recovered.manager.get(run.id).state, 'timed_out')
})
test('malformed results and persistence failures never become successful runs', async () => {
  const f = fixture({ gateway: { read: async () => ({ count: 0 }) } })
  const run = f.manager.start(owner, { requestId: randomUUID() }); await f.manager.wait(run.id)
  assert.equal(f.manager.get(run.id).state, 'unavailable')
  assert.ok(f.manager.get(run.id).sections.every(s => s.count === null))
  let reads = 0
  const bad = fixture({ activity: { append: () => { throw Error('SECRET') } }, gateway: { read: async () => { reads++ } } })
  assert.throws(() => bad.manager.start(owner, { requestId: randomUUID() }), /audit_unavailable/)
  assert.equal(reads, 0)
})
