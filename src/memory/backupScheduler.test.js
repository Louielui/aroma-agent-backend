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
