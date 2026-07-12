'use strict'

/**
 * sandboxSweep.test.js — B2-12 startup-only sandbox cleanup.
 *
 * Every test uses a SCRATCH tmpDir with controlled mtimes (never mutates the real
 * os.tmpdir contents), injected TTL + now + rm. No dispatch, no worker.
 *
 *   Run: node --test src/workers/workspace/sandboxSweep.test.js
 */

const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { sweepAgedSandboxes, resolveSandboxTtl } = require('./tmpdirSandbox')

afterEach(() => { delete process.env.SANDBOX_TTL_HOURS })

function scratch () { return fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-sweep-scratch-')) }
/** Make a dir with content, then set its mtime to `ageHours` before `now`. */
function agedDir (root, name, ageHours, now) {
  const p = path.join(root, name)
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, 'x.txt'), 'sandbox content')
  const t = new Date(now - ageHours * 3600 * 1000)
  fs.utimesSync(p, t, t) // set mtime LAST (writing content would bump it)
  return p
}

test('deletes ONLY aged aroma-sandbox-* dirs; keeps fresh; never touches .aroma / data / other names', () => {
  const now = Date.now()
  const root = scratch()
  try {
    const aged = agedDir(root, 'aroma-sandbox-old', 25, now) // > 24h → delete
    const fresh = agedDir(root, 'aroma-sandbox-fresh', 1, now) // < 24h → keep
    const aromaEvidence = agedDir(root, '.aroma', 100, now) // durable evidence — NEVER touch
    const dataStore = agedDir(root, 'data', 100, now) // Proposal/Run store — NEVER touch
    const other = agedDir(root, 'other-dir', 100, now) // non-matching name → keep
    const prefixedFile = path.join(root, 'aroma-sandbox-file.txt')
    fs.writeFileSync(prefixedFile, 'not a dir') // prefixed FILE, not a dir → skip

    const s = sweepAgedSandboxes({ tmpDir: root, ttlHours: 24, now })

    assert.equal(fs.existsSync(aged), false, 'aged sandbox deleted')
    assert.equal(fs.existsSync(fresh), true, 'fresh sandbox kept (fail-safe)')
    assert.equal(fs.existsSync(aromaEvidence), true, '.aroma untouched')
    assert.equal(fs.existsSync(dataStore), true, 'data untouched')
    assert.equal(fs.existsSync(other), true, 'other-dir untouched')
    assert.equal(fs.existsSync(prefixedFile), true, 'prefixed FILE (not a dir) untouched')
    assert.equal(s.deleted, 1)
    assert.ok(s.scanned >= 6)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('.aroma/tasks, .aroma/results and data/* are NEVER touched even when aged (durable evidence safe)', () => {
  const now = Date.now()
  const root = scratch()
  try {
    fs.mkdirSync(path.join(root, '.aroma', 'tasks'), { recursive: true })
    fs.writeFileSync(path.join(root, '.aroma', 'tasks', 'exec.json'), '{"id":"task_e"}')
    fs.mkdirSync(path.join(root, '.aroma', 'results'), { recursive: true })
    fs.writeFileSync(path.join(root, '.aroma', 'results', 'res.json'), '{"ok":true}')
    fs.mkdirSync(path.join(root, 'data'), { recursive: true })
    fs.writeFileSync(path.join(root, 'data', 'aroma-runs.json'), '{"order":[]}')
    // age them well past TTL
    const t = new Date(now - 1000 * 3600 * 1000)
    for (const d of ['.aroma', 'data']) fs.utimesSync(path.join(root, d), t, t)

    sweepAgedSandboxes({ tmpDir: root, ttlHours: 1, now })

    assert.equal(fs.existsSync(path.join(root, '.aroma', 'tasks', 'exec.json')), true)
    assert.equal(fs.existsSync(path.join(root, '.aroma', 'results', 'res.json')), true)
    assert.equal(fs.existsSync(path.join(root, 'data', 'aroma-runs.json')), true)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('containment: a prefixed symlink/junction escaping tmpDir is SKIPPED — target NEVER deleted', (t) => {
  const now = Date.now()
  const root = scratch()
  const outside = scratch()
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'do not delete')
  const link = path.join(root, 'aroma-sandbox-escape')
  let made = false
  try { fs.symlinkSync(outside, link, 'junction'); made = true } catch (_) {
    try { fs.symlinkSync(outside, link, 'dir'); made = true } catch (_) {}
  }
  try {
    if (!made) return t.skip('symlink/junction not permitted on this host')
    // tiny TTL so ONLY containment (not age) can protect the escape target
    const s = sweepAgedSandboxes({ tmpDir: root, ttlHours: 0.0001, now })
    assert.equal(fs.existsSync(path.join(outside, 'precious.txt')), true, 'escape target NEVER deleted')
    assert.equal(s.deleted, 0, 'the escaping entry was skipped, not deleted')
  } finally {
    try { fs.rmSync(link, { recursive: true, force: true }) } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('best-effort: a delete failure on one entry is logged, sweep CONTINUES, summary reflects it', () => {
  const now = Date.now()
  const root = scratch()
  try {
    const a = agedDir(root, 'aroma-sandbox-a', 25, now)
    const b = agedDir(root, 'aroma-sandbox-b', 25, now)
    const rm = (p) => {
      if (p.endsWith('aroma-sandbox-a')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      fs.rmSync(p, { recursive: true, force: true })
    }
    const s = sweepAgedSandboxes({ tmpDir: root, ttlHours: 24, now, rm })
    assert.equal(s.errors, 1)
    assert.equal(s.deleted, 1)
    assert.equal(fs.existsSync(a), true, 'a failed to delete but the sweep did not abort')
    assert.equal(fs.existsSync(b), false, 'b was still processed after a errored')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('best-effort: sweep NEVER throws (missing/invalid tmpDir → empty summary, no crash)', () => {
  const gone = path.join(os.tmpdir(), 'aroma-nope-' + process.pid + '-does-not-exist')
  let s
  assert.doesNotThrow(() => { s = sweepAgedSandboxes({ tmpDir: gone, now: Date.now() }) })
  assert.deepEqual(s, { scanned: 0, deleted: 0, skipped: 0, errors: 0 })
})

test('TTL resolver: unset → 24; illegal/negative/zero/non-numeric/infinite → 24 (fail-safe); valid → parsed', () => {
  delete process.env.SANDBOX_TTL_HOURS
  assert.equal(resolveSandboxTtl(), 24)
  for (const bad of ['abc', '-5', '0', '   ', 'NaN', '1e999', 'ten']) {
    process.env.SANDBOX_TTL_HOURS = bad
    assert.equal(resolveSandboxTtl(), 24, `"${bad}" must fail-safe to 24`)
  }
  process.env.SANDBOX_TTL_HOURS = '48'
  assert.equal(resolveSandboxTtl(), 48)
  process.env.SANDBOX_TTL_HOURS = '0.5'
  assert.equal(resolveSandboxTtl(), 0.5)
})
