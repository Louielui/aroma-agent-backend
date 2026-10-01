'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createBackupScheduler } = require('./backupScheduler')
function fixture (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-backup-schedule-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let now = Date.parse('2026-10-01T12:00:00Z'); let runs = 0; let fail = false
  const backup = async () => { runs++; if (fail) throw Error('secret_error_do_not_save'); return { path: '/private/canonical.json', restored: { state: 'verified', sha256: 'a'.repeat(64) }, recovery: { state: 'verified', files: 12 }, filesRestored: { state: 'isolated_files_restored', files: 12 } } }
  return { dir, clock: () => now, backup, runs: () => runs, fail: value => { fail = value }, advance: ms => { now += ms }, scheduler: () => createBackupScheduler({ dir, backup, clock: () => now }) }
}
test('daily backup is durable, bounded and reports actual isolated restore proof across restart', async t => {
  const f = fixture(t); let s = f.scheduler(); assert.equal(s.status().lastSucceededAt, null)
  await s.tick(); assert.equal(f.runs(), 1); assert.equal(s.status().state, 'verified'); assert.equal(s.status().filesRestored, 12)
  s = f.scheduler(); await s.tick(); assert.equal(f.runs(), 1)
  f.advance(86400000); await s.tick(); assert.equal(f.runs(), 2)
  assert.equal(s.status().lastSucceededAt, '2026-10-02T12:00:00.000Z')
})
test('backup failure is visible and backs off instead of printing provider errors or repeatedly retrying', async t => {
  const f = fixture(t); const s = f.scheduler(); f.fail(true); await s.tick()
  assert.equal(s.status().state, 'failed'); assert.equal(s.status().reason, 'backup_unavailable'); assert.equal(s.status().lastSucceededAt, null)
  assert.equal(s.status().trigger, 'scheduled'); assert.equal(f.scheduler().status().trigger, 'scheduled')
  assert.equal(s.status().lastSucceededTrigger, null)
  assert.doesNotMatch(fs.readFileSync(path.join(f.dir, 'backup-state.json'), 'utf8'), /secret_error/)
  await s.tick(); assert.equal(f.runs(), 1); f.advance(1800000); f.fail(false); await s.tick(); assert.equal(s.status().state, 'verified')
})
test('unknown or missing restore proof cannot count as a verified backup', async t => {
  const f = fixture(t); const s = createBackupScheduler({ dir: f.dir, clock: f.clock, backup: async () => ({ saved: { state: 'saved' }, path: '/private/no-proof' }) })
  await s.tick(); assert.equal(s.status().state, 'failed'); assert.equal(s.status().lastSucceededAt, null)
})
test('concurrent ticks invoke one backup and interrupted persisted running state retries after restart', async t => {
  const f = fixture(t); let finish; const gate = new Promise(resolve => { finish = resolve })
  const s = createBackupScheduler({ dir: f.dir, clock: f.clock, backup: async () => { await gate; return f.backup() } })
  const pending = s.tick(); await s.tick(); assert.equal(s.status().state, 'running')
  finish(); await pending; assert.equal(f.runs(), 1)
  const state = JSON.parse(fs.readFileSync(path.join(f.dir, 'backup-state.json'), 'utf8')); state.state = 'running'; state.nextAt = '2099-01-01T00:00:00Z'
  fs.writeFileSync(path.join(f.dir, 'backup-state.json'), JSON.stringify(state))
  await f.scheduler().tick(); assert.equal(f.runs(), 2)
})

test('scheduled and manual attempts retain their distinct verified proof provenance across restart', async t => {
  const f = fixture(t); let s = f.scheduler()
  assert.equal(s.status().trigger, null); assert.equal(s.status().lastSucceededTrigger, null)
  await s.tick()
  let persisted = JSON.parse(fs.readFileSync(path.join(f.dir, 'backup-state.json'), 'utf8'))
  assert.equal(persisted.trigger, 'scheduled'); assert.equal(persisted.lastSucceededTrigger, 'scheduled')
  s = f.scheduler(); await s.tick(); assert.equal(f.runs(), 1)
  assert.equal(s.status().trigger, 'scheduled'); assert.equal(s.status().lastSucceededTrigger, 'scheduled')
  await s.run(); assert.equal(f.runs(), 2)
  persisted = JSON.parse(fs.readFileSync(path.join(f.dir, 'backup-state.json'), 'utf8'))
  assert.equal(persisted.trigger, 'manual'); assert.equal(persisted.lastSucceededTrigger, 'manual')
  assert.equal(f.scheduler().status().lastSucceededTrigger, 'manual')
})

test('a failed manual attempt reports its own trigger without relabeling the earlier scheduled proof', async t => {
  const f = fixture(t); const s = f.scheduler(); await s.tick(); const before = s.status()
  let release
  const next = createBackupScheduler({ dir: f.dir, clock: f.clock, backup: async () => {
    await new Promise(resolve => { release = resolve }); throw Error('private_failure')
  } })
  const pending = next.run(); await next.tick()
  assert.equal(next.status().state, 'running'); assert.equal(next.status().trigger, 'manual')
  assert.equal(next.status().lastSucceededTrigger, 'scheduled')
  release(); await pending
  const restarted = f.scheduler()
  assert.equal(restarted.status().state, 'failed'); assert.equal(restarted.status().trigger, 'manual')
  assert.equal(restarted.status().lastSucceededTrigger, 'scheduled')
  assert.equal(restarted.status().lastSucceededAt, before.lastSucceededAt); assert.equal(restarted.status().sha256, before.sha256)
  await restarted.tick(); assert.equal(f.runs(), 1)
  f.advance(1800000); await restarted.tick()
  assert.equal(restarted.status().trigger, 'scheduled'); assert.equal(restarted.status().lastSucceededTrigger, 'scheduled')
})

test('an interrupted manual job is retried as a scheduled attempt while retaining the prior manual proof until success', async t => {
  const f = fixture(t); await f.scheduler().run()
  const file = path.join(f.dir, 'backup-state.json'); const state = JSON.parse(fs.readFileSync(file, 'utf8'))
  fs.writeFileSync(file, JSON.stringify({ ...state, state: 'running', nextAt: '2099-01-01T00:00:00Z' }))
  let release
  const restarted = createBackupScheduler({ dir: f.dir, clock: f.clock, backup: async () => {
    await new Promise(resolve => { release = resolve }); return f.backup()
  } })
  assert.equal(restarted.status().trigger, 'manual')
  const pending = restarted.tick()
  assert.equal(restarted.status().state, 'running'); assert.equal(restarted.status().trigger, 'scheduled')
  assert.equal(restarted.status().lastSucceededTrigger, 'manual')
  release(); await pending
  assert.equal(f.scheduler().status().trigger, 'scheduled'); assert.equal(f.scheduler().status().lastSucceededTrigger, 'scheduled')
})

test('legacy proof remains explicitly unknown until a newly verified attempt records its trigger', async t => {
  const f = fixture(t); const file = path.join(f.dir, 'backup-state.json')
  fs.writeFileSync(file, JSON.stringify({ state: 'verified', lastSucceededAt: '2026-09-30T12:00:00Z',
    nextAt: '2099-01-01T00:00:00Z', path: '/private/legacy.json', sha256: 'b'.repeat(64) }))
  const s = f.scheduler(); assert.equal(s.status().trigger, null); assert.equal(s.status().lastSucceededTrigger, null)
  await s.tick(); assert.equal(f.runs(), 0); assert.equal(s.status().lastSucceededTrigger, null)
  await s.run(); assert.equal(s.status().trigger, 'manual'); assert.equal(s.status().lastSucceededTrigger, 'manual')
})
