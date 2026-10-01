'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createSupervisor } = require('./runtimeSupervisor')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { acquireLease } = require('./supervisorLease')
const down = { state: 'unavailable', reason: 'not_running', alive: false }
test('persistent recovery continues past three failures with bounded backoff and resets after healthy operation', async () => {
  let now = 0, starts = 0, healthy = false
  const child = () => ({ pid: 100 + starts, running: () => false })
  const s = createSupervisor({ component: 'hindsight', clock: () => now, probe: async () => healthy ? { state: 'ready', reason: null, alive: true } : down,
    start: async () => { starts++; return child() }, save: () => {} })
  for (let i = 0; i < 8; i++) { await s.tick(); now += 300000 }
  assert.equal(starts, 8)
  assert.ok(Date.parse(s.status().nextRetryAt) - now <= 60000)
  healthy = true; await s.tick()
  assert.equal(s.status().state, 'ready')
  assert.equal(s.status().consecutiveFailures, 0)
  assert.equal(s.status().nextRetryAt, null)
})
test('foreign and existing services are measured without launching or terminating a process', async () => {
  let starts = 0, stops = 0, healthy = false
  const s = createSupervisor({ component: 'bridge', clock: () => 0,
    probe: async () => healthy ? { state: 'ready', reason: null, alive: true } : { state: 'foreign', reason: 'identity_mismatch', alive: null },
    start: () => { starts++; return { stop: () => stops++ } }, save: () => {} })
  await s.tick(); assert.equal(s.status().state, 'foreign')
  healthy = true; await s.tick(); assert.equal(s.status().state, 'ready')
  assert.equal(starts, 0); assert.equal(stops, 0)
})
test('startup is serialized and dependency failure does not restart a live owned process', async () => {
  let calls = 0, now = 0, ready = false, stops = 0
  const child = { pid: 123, running: () => true, stop: () => stops++ }
  const s = createSupervisor({ component: 'bridge', clock: () => now, start: async () => { calls++; return child }, save: () => {},
    probe: async () => ready ? { state: 'degraded', reason: 'database_unavailable', alive: true } : down })
  await Promise.all([s.tick(), s.tick()]); assert.equal(calls, 1)
  now += 10000; await s.tick(); assert.equal(calls, 1)
  ready = true; now += 300000; await s.tick()
  assert.equal(s.status().state, 'degraded'); assert.equal(stops, 0)
})
test('owned wedged process restarts only after warmup and repeated liveness failures', async () => {
  let now = 0, starts = 0, stops = 0, running = true
  const s = createSupervisor({ component: 'hindsight', clock: () => now, probe: async () => down, save: () => {},
    start: async () => { starts++; running = true; return { pid: starts + 900, running: () => running, stop: async () => { stops++; running = false } } } })
  await s.tick(); now = 290000; await s.tick(); assert.equal(stops, 0)
  for (let i = 0; i < 3; i++) { now += 10000; await s.tick() }
  assert.equal(stops, 1)
  assert.equal(s.status().reason, 'liveness_failed')
  now += 60000; await s.tick(); assert.equal(starts, 2)
})
test('one active lease prevents duplicate supervisors, but a dead or stale owner can recover', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-supervisor-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let now = 0
  const first = acquireLease({ dir, component: 'bridge', pid: 1, clock: () => now, isAlive: () => true })
  assert.ok(first)
  assert.equal(acquireLease({ dir, component: 'bridge', pid: 2, clock: () => now, isAlive: () => true }), null)
  now = 130000
  const recovered = acquireLease({ dir, component: 'bridge', pid: 2, clock: () => now, isAlive: () => true })
  assert.ok(recovered)
  assert.equal(first.renew(), false)
  first.release()
  assert.equal(recovered.renew(), true)
  recovered.release()
  assert.ok(acquireLease({ dir, component: 'bridge', pid: 3, clock: () => now, isAlive: () => false }))
})
test('a failed owned-process stop stays visible and cannot create a second owned process', async () => {
  let now = 0, starts = 0
  const s = createSupervisor({ component: 'bridge', clock: () => now, probe: async () => down, save: () => {},
    start: async () => { starts++; return { pid: 123, running: () => true, stop: async () => false } } })
  await s.tick(); now = 300000
  await s.tick(); await s.tick(); await s.tick()
  assert.equal(s.status().reason, 'recovery_failed')
  await s.tick(); assert.equal(starts, 1)
})
test('a truncated lease from a crashed writer is recovered only after its freshness window', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-supervisor-partial-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'bridge.lock'); fs.writeFileSync(file, '{')
  fs.utimesSync(file, new Date(0), new Date(0))
  assert.equal(acquireLease({ dir, component: 'bridge', pid: 1, clock: () => 1000, isAlive: () => false }), null)
  const recovered = acquireLease({ dir, component: 'bridge', pid: 1, clock: () => 130000, isAlive: () => false })
  assert.ok(recovered); recovered.release()
})
