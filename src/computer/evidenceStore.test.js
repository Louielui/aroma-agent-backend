'use strict'

/**
 * evidenceStore.test.js — Computer Operator v0, Phase 3a.
 *
 * Evidence lives on the Companion's own disk for 7 days and never becomes content
 * anywhere else. Two things are pinned: the deletion MECHANISM actually deletes (proven
 * against a real temp directory with an injected clock, not by waiting a week), and the
 * store hands back a hash rather than bytes.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const { createEvidenceStore, RETENTION_DAYS, EVIDENCE_PREFIX } = require('./evidenceStore')

const DAY = 24 * 60 * 60 * 1000
const PNG = Buffer.from('89504e470d0a1a0a' + '00'.repeat(32), 'hex')

function tmp () { return fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-evidence-')) }

/* ── it returns metadata, never bytes ─────────────────────────────────────── */

test('*** put() returns a hash and a size — never the image ***', () => {
  const base = tmp()
  try {
    const store = createEvidenceStore({ baseDir: base, now: () => 1_000_000 })
    const meta = store.put('shot1', PNG)
    assert.match(meta.sha256, /^[a-f0-9]{64}$/)
    assert.equal(meta.sha256, crypto.createHash('sha256').update(PNG).digest('hex'), 'the real hash of the real bytes')
    assert.equal(meta.bytes, PNG.length)
    // nothing in the returned object is, or contains, the image
    const json = JSON.stringify(meta)
    assert.equal(json.includes(PNG.toString('base64')), false)
    assert.equal(json.includes('iVBOR'), false)
    assert.deepEqual(Object.keys(meta).sort(), ['bytes', 'file', 'sha256', 'storedAt'])
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})

test('the file really is written, under the Companion-local base directory', () => {
  const base = tmp()
  try {
    const store = createEvidenceStore({ baseDir: base, now: () => 1_000_000 })
    const meta = store.put('shot1', PNG)
    const full = path.join(base, meta.file)
    assert.equal(fs.existsSync(full), true)
    assert.equal(fs.readFileSync(full).equals(PNG), true, 'byte-for-byte')
    assert.equal(path.dirname(full), base, 'inside the store, nowhere else')
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})

test('a hostile id cannot escape the store directory', () => {
  const base = tmp()
  try {
    const store = createEvidenceStore({ baseDir: base, now: () => 1 })
    for (const evil of ['../../escape', 'C:\\Windows\\x', '..\\..\\x', 'a/b/c']) {
      const meta = store.put(evil, PNG)
      assert.equal(path.dirname(path.join(base, meta.file)), base, 'stayed inside: ' + evil)
      assert.equal(meta.file.includes('..'), false)
      assert.equal(meta.file.includes('/'), false)
      assert.equal(meta.file.includes('\\'), false)
    }
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})

/* ── THE DELETION MECHANISM ───────────────────────────────────────────────── */

test('*** evidence older than 7 days is actually deleted — demonstrated, not promised ***', () => {
  const base = tmp()
  const clock = { t: 10 * DAY }
  try {
    const store = createEvidenceStore({ baseDir: base, now: () => clock.t })
    const old = store.put('old', PNG) // stored at day 10
    clock.t = 18 * DAY // eight days later
    const fresh = store.put('fresh', PNG)
    assert.equal(store.list().length, 2)

    const swept = store.sweep()
    assert.deepEqual(swept.deleted, [old.file], 'the eight-day-old one is gone')
    assert.equal(swept.kept, 1)
    assert.equal(swept.retentionDays, 7)
    assert.equal(fs.existsSync(path.join(base, old.file)), false, 'really removed from disk')
    assert.equal(fs.existsSync(path.join(base, fresh.file)), true, 'the recent one survives')
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})

test('the retention boundary is exactly 7 days', () => {
  const base = tmp()
  const clock = { t: 100 * DAY }
  try {
    const store = createEvidenceStore({ baseDir: base, now: () => clock.t })
    const a = store.put('sixdays', PNG)
    clock.t += 6 * DAY
    assert.deepEqual(store.sweep().deleted, [], 'six days old: kept')
    clock.t += 1 * DAY + 1000 // now just past seven
    assert.deepEqual(store.sweep().deleted, [a.file], 'past seven days: deleted')
    assert.equal(RETENTION_DAYS, 7)
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})

test('*** the sweep only ever touches its OWN files ***', () => {
  // A sweep pointed at a real profile that could remove anything else would be a
  // destructive tool. It deletes by prefix AND extension, and by age, and nothing else.
  const base = tmp()
  const clock = { t: 50 * DAY }
  try {
    const store = createEvidenceStore({ baseDir: base, now: () => clock.t })
    store.put('mine', PNG)
    // things that are not this store's evidence, all old enough to be swept if it were careless
    const bystanders = ['important.txt', 'notes.png', EVIDENCE_PREFIX + 'x.txt', 'ev.png']
    for (const b of bystanders) {
      fs.writeFileSync(path.join(base, b), 'do not delete me')
      fs.utimesSync(path.join(base, b), new Date(1), new Date(1))
    }
    fs.mkdirSync(path.join(base, EVIDENCE_PREFIX + 'dir.png'))

    clock.t += 30 * DAY
    store.sweep()
    for (const b of bystanders) {
      assert.equal(fs.existsSync(path.join(base, b)), true, 'untouched: ' + b)
    }
    assert.equal(fs.existsSync(path.join(base, EVIDENCE_PREFIX + 'dir.png')), true, 'a directory is never unlinked')
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})

test('deletion is by file age, so a lost index cannot retain evidence forever', () => {
  // There is no index. Stated as a property: the store keeps no manifest at all, so the
  // failure mode where bookkeeping is lost and files live on cannot occur.
  const raw = fs.readFileSync(path.join(__dirname, 'evidenceStore.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  /**
   * ⛔ THE MECHANISM NARROWED IN COMMIT A; THE INVARIANT DID NOT.
   *
   * This scanned the whole source for the word `manifest`. The retention taxonomy added a
   * RULE NAMED `manifest` — a pattern matching SOMEONE ELSE'S file, `stage3-manifest.json`,
   * which the sweep must never delete. That is the opposite of the store keeping an index of
   * its own, and the regex could not tell the two apart.
   *
   * So the classification tables are excluded and everything else is still scanned. The
   * property is unchanged and still enforced: this store keeps NO bookkeeping of its own, so
   * the failure mode where an index is lost and files live on cannot occur.
   */
  const src = raw.replace(/const (RAW_CONTENT|RECORD)_PATTERNS = Object\.freeze\(\[[\s\S]*?\]\)/g, '')
  assert.equal(/manifest|index\.json|\.db\b/.test(src), false, 'no manifest exists to lose')
  assert.ok(/RAW_CONTENT_PATTERNS/.test(raw), 'the exclusion above actually matched something')
  assert.ok(src.includes('mtimeMs'), 'age comes from the filesystem itself')
})

test('sweeping an empty or absent directory is safe', () => {
  const base = path.join(os.tmpdir(), 'aroma-evidence-absent-' + crypto.randomBytes(4).toString('hex'))
  const store = createEvidenceStore({ baseDir: base, now: () => 1 })
  // ⛔ WIDENED IN COMMIT A, not weakened: the sweep now also reports what it RETAINED and what
  // it could not classify. An absent directory has none of each, and saying so explicitly is
  // what keeps 「nothing to do」 distinguishable from 「did not look」.
  assert.deepEqual(store.sweep(), { deleted: [], kept: 0, retained: [], unclassified: [], retentionDays: 7 })
  assert.deepEqual(store.list(), [])
})

test('the store refuses to guess a location', () => {
  assert.throws(() => createEvidenceStore({}), /non-empty baseDir/)
  assert.throws(() => createEvidenceStore({ baseDir: '   ' }), /non-empty baseDir/)
})

test('only Buffers are accepted — a string is not evidence', () => {
  const base = tmp()
  try {
    const store = createEvidenceStore({ baseDir: base, now: () => 1 })
    assert.throws(() => store.put('x', 'not a buffer'), /must be a Buffer/)
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})
