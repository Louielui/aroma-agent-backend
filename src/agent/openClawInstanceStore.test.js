'use strict'

/**
 * openClawInstanceStore.test.js — THE FILE, THE BYTES, AND WHAT THE MANAGER MAKES OF THEM.
 *
 * A disposable data directory per test file (AROMA_DATA_DIR), the real filesystem, the real
 * instance manager over the real store — plus targeted syscall failure injection through the
 * fsImpl mechanic to prove the commit point.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-x4b3-store-'))
process.env.AROMA_DATA_DIR = DATA

const test = require('node:test')
const assert = require('node:assert')

const { createOpenClawInstanceStore, FILE_NAME } = require('../agent/openClawInstanceStore')
const { resolveDataDir } = require('../store/dataDir')
const { createOpenClawInstanceManager, derivedPathsFor, unitNameFor, STATES } = require('../agent/openClawInstanceManager')

const APPROVAL = 'appr_x4b3'
const FILE = path.join(DATA, FILE_NAME)
const SPEC = { gatewayPort: 18901, envelopeObject: { dev: '2096', ino: '126262' }, repoObject: { dev: '2096', ino: '126263' } }
const rm = () => { try { fs.unlinkSync(FILE) } catch (_) {} }

/* ══════════════ the path ══════════════ */

test('S1. the file is exactly <resolveDataDir()>/openclaw-instances.json, and no option can move it', () => {
  const s = createOpenClawInstanceStore()
  assert.strictEqual(s.file, path.join(resolveDataDir(), 'openclaw-instances.json'))
  assert.strictEqual(path.dirname(s.file), DATA)
  const moved = createOpenClawInstanceStore({ file: '/tmp/elsewhere.json', path: '/tmp/x', dir: '/tmp' })
  assert.strictEqual(moved.file, s.file, 'the path is not a parameter')
  assert.ok(Object.isFrozen(s))
})

test('S2. a test process with AROMA_DATA_DIR redirected never touches the production data dir', () => {
  const { PRODUCTION_DIR } = require('../store/dataDir')
  const s = createOpenClawInstanceStore()
  assert.ok(!s.file.startsWith(PRODUCTION_DIR), 'never under ' + PRODUCTION_DIR)
  assert.ok(s.file.startsWith(DATA))
})

/* ══════════════ read ══════════════ */

test('R1. first read of a missing file is a fresh null-prototype empty object', () => {
  rm()
  const s = createOpenClawInstanceStore()
  const v = s.read()
  assert.strictEqual(Object.getPrototypeOf(v), null)
  assert.deepStrictEqual(Object.keys(v), [])
  assert.notStrictEqual(s.read(), v, 'a new object each time')
})

test('R2. ⛔ invalid JSON THROWS — never an empty store', () => {
  fs.writeFileSync(FILE, '{ this is not json', 'utf8')
  const s = createOpenClawInstanceStore()
  assert.throws(() => s.read(), /not valid JSON/)
  rm()
})

test('R3. ⛔ a read error other than ENOENT THROWS', () => {
  const failing = Object.assign({}, fs, { readFileSync: () => { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e } })
  const s = createOpenClawInstanceStore({ fsImpl: failing })
  assert.throws(() => s.read(), /instance store unreadable/)
})

test('R4. valid JSON is returned as parsed — arrays, null and scalars included — and the MANAGER refuses them', () => {
  for (const [label, text] of [['array', '[]'], ['null', 'null'], ['string', '"abc"'], ['number', '123'], ['true', 'true']]) {
    fs.writeFileSync(FILE, text, 'utf8')
    const s = createOpenClawInstanceStore()
    assert.deepStrictEqual(s.read(), JSON.parse(text), label + ': returned as-is, not turned into {}')
    const m = createOpenClawInstanceManager({ store: s })
    assert.throws(() => m.all(), /instance store is not a data object/, label + ': manager refuses')
    assert.throws(() => m.record(APPROVAL), /refuse:/, label)
  }
  rm()
})

/* ══════════════ write: atomic replacement ══════════════ */

test('W1. round-trip: what is written is what is read, and the on-disk bytes are the serialization', () => {
  rm()
  const s = createOpenClawInstanceStore()
  const doc = { [APPROVAL]: { approvalId: APPROVAL, state: 'PREPARED', observedPids: [1, 2] } }
  s.write(doc)
  assert.deepStrictEqual(s.read(), doc)
  assert.strictEqual(fs.readFileSync(FILE, 'utf8'), JSON.stringify(doc, null, 2))
  // no temp file is left behind
  assert.deepStrictEqual(fs.readdirSync(DATA).filter((f) => f.startsWith(FILE_NAME + '.')), [])
})

test('W2. ⛔ a failure before rename leaves the previous final file byte-for-byte unchanged', () => {
  rm()
  const s = createOpenClawInstanceStore()
  s.write({ v: 'ORIGINAL' })
  const before = fs.readFileSync(FILE)
  for (const [where, impl] of [
    ['openSync', Object.assign({}, fs, { openSync: () => { throw new Error('EMFILE') } })],
    ['writeSync', Object.assign({}, fs, { writeSync: () => { throw new Error('ENOSPC') } })],
    ['fsyncSync', Object.assign({}, fs, { fsyncSync: () => { throw new Error('EIO') } })],
    ['renameSync', Object.assign({}, fs, { renameSync: () => { throw new Error('EPERM') } })]
  ]) {
    const f = createOpenClawInstanceStore({ fsImpl: impl })
    assert.throws(() => f.write({ v: 'REPLACEMENT-' + where }), /write failed before commit/, where)
    assert.ok(fs.readFileSync(FILE).equals(before), where + ': final file untouched')
    assert.deepStrictEqual(createOpenClawInstanceStore().read(), { v: 'ORIGINAL' }, where + ': still reads the original')
    assert.deepStrictEqual(fs.readdirSync(DATA).filter((x) => x.startsWith(FILE_NAME + '.')), [], where + ': temp cleaned up')
  }
})

test('W3. ⛔ a serialization failure touches NOTHING on disk', () => {
  rm()
  const s = createOpenClawInstanceStore()
  s.write({ v: 'ORIGINAL' })
  const before = fs.readFileSync(FILE)
  const circular = {}; circular.self = circular
  assert.throws(() => s.write(circular), /circular|Converting/i)
  assert.ok(fs.readFileSync(FILE).equals(before))
  assert.deepStrictEqual(fs.readdirSync(DATA).filter((x) => x.startsWith(FILE_NAME + '.')), [])
  // ⛔ and not merely "cleaned up afterwards": serialization comes FIRST, so a failure there
  // makes NO filesystem call at all — no mkdir, no open, no write, no unlink
  const calls = []
  const spy = {}
  for (const k of ['mkdirSync', 'openSync', 'writeSync', 'fsyncSync', 'closeSync', 'renameSync', 'unlinkSync', 'readFileSync']) {
    spy[k] = (...a) => { calls.push(k); return fs[k](...a) }
  }
  const spied = createOpenClawInstanceStore({ fsImpl: spy })
  assert.throws(() => spied.write(circular), /circular|Converting/i)
  assert.deepStrictEqual(calls, [], 'zero syscalls on a serialization failure')
})

test('W4. the temp file is created exclusively (wx) beside the final file, written completely, fsync\'d, closed, then renamed', () => {
  rm()
  const calls = []
  const spy = Object.assign({}, fs, {
    openSync: (p, flags, mode) => { calls.push(['open', path.basename(p), flags, mode]); return fs.openSync(p, flags, mode) },
    writeSync: (fd, buf, off, len) => { calls.push(['write', len]); return fs.writeSync(fd, buf, off, len) },
    fsyncSync: (fd) => { calls.push(['fsync']); return fs.fsyncSync(fd) },
    closeSync: (fd) => { calls.push(['close']); return fs.closeSync(fd) },
    renameSync: (a, b) => { calls.push(['rename', path.basename(a), path.basename(b)]); return fs.renameSync(a, b) }
  })
  const s = createOpenClawInstanceStore({ fsImpl: spy })
  s.write({ v: 1 })
  const kinds = calls.map((c) => c[0])
  assert.deepStrictEqual(kinds, ['open', 'write', 'fsync', 'close', 'rename'], 'exact syscall order')
  assert.strictEqual(calls[0][2], 'wx', 'exclusive create')
  assert.strictEqual(calls[0][3], 0o600)
  assert.ok(calls[0][1].startsWith(FILE_NAME + '.') && calls[0][1].endsWith('.tmp'), 'temp beside final')
  assert.strictEqual(calls[4][2], FILE_NAME, 'renamed onto the final name')
  assert.strictEqual(calls[1][1], Buffer.byteLength(JSON.stringify({ v: 1 }, null, 2)), 'complete bytes')
})

test('W5. a cleanup failure after a failed write is never reported as success', () => {
  rm()
  const s = createOpenClawInstanceStore()
  s.write({ v: 'ORIGINAL' })
  const impl = Object.assign({}, fs, {
    renameSync: () => { throw new Error('EPERM') },
    unlinkSync: () => { throw new Error('cleanup also failed') }
  })
  const f = createOpenClawInstanceStore({ fsImpl: impl })
  assert.throws(() => f.write({ v: 'NEW' }), /write failed before commit \(EPERM\)/, 'the WRITE failure is what is reported')
  assert.deepStrictEqual(createOpenClawInstanceStore().read(), { v: 'ORIGINAL' })
  // clean the orphan temp this injected cleanup failure left behind
  for (const x of fs.readdirSync(DATA)) if (x.startsWith(FILE_NAME + '.')) fs.unlinkSync(path.join(DATA, x))
})

/* ══════════════ the manager over the REAL file store ══════════════ */

test('M1. the manager runs the whole pre-stop lifecycle over the real file store', () => {
  rm()
  const m = createOpenClawInstanceManager({ store: createOpenClawInstanceStore() })
  const p = m.prepare(APPROVAL, SPEC)
  assert.strictEqual(p.state, STATES.PREPARED)
  assert.strictEqual(p.unitName, unitNameFor(APPROVAL))
  assert.strictEqual(p.envelopeRoot, derivedPathsFor(APPROVAL).envelopeRoot)
  m.launchAttempted(APPROVAL)
  m.observeControlGroup(APPROVAL, '/user.slice/user-1000.slice/user@1000.service/app.slice/' + unitNameFor(APPROVAL))
  m.observePids(APPROVAL, [93018, 93017])
  const stopped = m.requestStop(APPROVAL)
  assert.strictEqual(stopped.state, STATES.STOP_REQUESTED)
  assert.deepStrictEqual(stopped.observedPids, [93017, 93018])
  // the bytes on disk are the manager's canonical record
  const onDisk = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  assert.strictEqual(onDisk[APPROVAL].state, STATES.STOP_REQUESTED)
  assert.strictEqual(onDisk[APPROVAL].envelopeObject.ino, '126262')
})

test('M2. ⛔ a NEW manager over the same file sees the exact lifecycle state', () => {
  const m2 = createOpenClawInstanceManager({ store: createOpenClawInstanceStore() })
  const rec = m2.record(APPROVAL)
  assert.strictEqual(rec.state, STATES.STOP_REQUESTED)
  assert.deepStrictEqual(rec.observedPids, [93017, 93018])
  assert.strictEqual(rec.observedControlGroup, '/user.slice/user-1000.slice/user@1000.service/app.slice/' + unitNameFor(APPROVAL))
  assert.strictEqual(rec.envelopeObject.dev, '2096')
  // identity is never reused: a second prepare for the same approval is refused by the reopened manager too
  assert.throws(() => m2.prepare(APPROVAL, SPEC), /already has an instance record/)
})

test('M3. ⛔ a corrupt file is refused by the manager on the way in — nothing is repaired, nothing is written', () => {
  const before = fs.readFileSync(FILE)
  fs.writeFileSync(FILE, '{"appr_x4b3": "not a record"}', 'utf8')
  const m = createOpenClawInstanceManager({ store: createOpenClawInstanceStore() })
  assert.throws(() => m.record(APPROVAL), /refuse:/)
  assert.throws(() => m.prepare('appr_other', SPEC), /refuse:/, 'a write path must not repair the store either')
  assert.strictEqual(fs.readFileSync(FILE, 'utf8'), '{"appr_x4b3": "not a record"}', 'untouched')
  fs.writeFileSync(FILE, before)
})
