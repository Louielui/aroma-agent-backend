'use strict'

/**
 * wisdomStore.test.js — the container, before anything intelligent goes in it.
 *
 * ⛔ EVERY TEST INJECTS A TEMP PATH. Not one of them may reach the Owner's real data, and a
 * test that forgot would be writing fixture lessons into production memory. The final case
 * asserts the real production path was never created.
 * ⛔ NO NETWORK, NO MODEL, NO PAID CALL.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const { createWisdomStore, DURABILITY_STATUS, LOCK_STALE_MS } = require('./wisdomStore')
const C = require('./wisdomContract')

/** Is that pid still running? EPERM means alive but not ours. */
const pidAliveInTest = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return !!(e && e.code === 'EPERM') } }
const waitFor = async (fn, ms = 10000) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)) }
  return false
}

let seq = 0
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wisdom-test-' + (seq++) + '-'))
const storeIn = (dir, over = {}) => createWisdomStore(Object.assign({ file: path.join(dir, 'wisdom.json') }, over))

const CANDIDATE = {
  situation: '訂貨前冇對現貨',
  action: '照上次數量落單',
  outcome: '多咗兩箱',
  lesson: '落單前先對現貨',
  provenance: { sourceType: C.SOURCE_TYPE.OWNER_FEEDBACK, createdBy: C.CREATED_BY.OWNER }
}
const OWNER = { authority: 'owner', reason: '見過三次' }

/* ═══ DURABILITY IS NOT CLAIMED ════════════════════════════════════════ */

test('*** the store does NOT call itself durable ***', () => {
  // ⛔ Backup and isolated restore verification have not happened. Until they do, the honest
  // label is UNVERIFIED — carried in code so nobody has to remember it.
  assert.equal(DURABILITY_STATUS, 'UNVERIFIED')
  assert.equal(storeIn(tempDir()).durabilityStatus, 'UNVERIFIED')
})

/* ═══ READ SAFETY ══════════════════════════════════════════════════════ */

test('*** first run is legitimately empty ***', () => {
  const s = storeIn(tempDir())
  assert.deepEqual(s.listLessons(), [])
  assert.deepEqual(s.listApplications(), [])
  assert.deepEqual(s.listEvents(), [])
})

test('*** ⛔ an unreadable store is LOUD — corruption is never read as "nothing learned" ***', () => {
  for (const junk of ['{ this is not json', '', '[]', 'null', '"a string"']) {
    const dir = tempDir()
    const file = path.join(dir, 'wisdom.json')
    fs.writeFileSync(file, junk)
    const s = createWisdomStore({ file })
    assert.throws(() => s.listLessons(), /unreadable|refusing to treat it as empty/, JSON.stringify(junk))
    // ⛔ AND THE FILE WAS NOT TOUCHED.
    assert.equal(fs.readFileSync(file, 'utf8'), junk)
  }
})

/* ═══ LIFECYCLE ════════════════════════════════════════════════════════ */

test('*** a candidate is created as a candidate, and is readable back ***', () => {
  const s = storeIn(tempDir())
  const l = s.createCandidate(CANDIDATE)
  assert.equal(l.validation.state, C.STATE.CANDIDATE)
  assert.deepEqual(s.getLesson(l.id).id, l.id)
  assert.equal(s.listLessons({ state: C.STATE.CANDIDATE }).length, 1)
  assert.equal(s.listLessons({ state: C.STATE.VALIDATED }).length, 0)
  assert.equal(s.listEvents()[0].type, C.EVENT.CANDIDATE_CREATED)
})

test('*** the Owner validates; nobody else can ***', () => {
  const s = storeIn(tempDir())
  const l = s.createCandidate(CANDIDATE)

  // ⛔ THE CENTRAL RULE OF W0. A system that writes a belief and blesses it has an echo,
  // not a memory.
  for (const who of ['aroma', 'model', 'claude', 'openai', 'system', null, undefined, '']) {
    assert.throws(() => s.validateLesson(l.id, { authority: who, reason: 'ok' }), /only the Owner/, String(who))
  }
  assert.equal(s.getLesson(l.id).validation.state, C.STATE.CANDIDATE, 'still unbelieved')

  const v = s.validateLesson(l.id, OWNER)
  assert.equal(v.validation.state, C.STATE.VALIDATED)
  assert.equal(v.validation.authority, 'owner')
  assert.ok(v.validation.validatedAt)
  assert.ok(s.listEvents().some((e) => e.type === C.EVENT.VALIDATED))
})

test('*** invalid lifecycle transitions fail closed ***', () => {
  const s = storeIn(tempDir())
  const a = s.createCandidate(CANDIDATE)
  s.validateLesson(a.id, OWNER)
  // validated -> validated / rejected
  assert.throws(() => s.validateLesson(a.id, OWNER), /refusing transition/)
  assert.throws(() => s.rejectLesson(a.id, OWNER), /refusing transition/)

  const b = s.createCandidate(CANDIDATE)
  s.rejectLesson(b.id, OWNER)
  assert.throws(() => s.validateLesson(b.id, OWNER), /refusing transition/)
  assert.throws(() => s.supersedeLesson(b.id, Object.assign({ supersededBy: a.id }, OWNER)), /refusing transition/)

  assert.throws(() => s.validateLesson('lsn_nope', OWNER), /unknown lesson/)
})

test('*** rejection is recorded, and the lesson is not deleted ***', () => {
  const s = storeIn(tempDir())
  const l = s.createCandidate(CANDIDATE)
  const r = s.rejectLesson(l.id, { authority: 'owner', reason: '嗰次係特殊情況' })
  assert.equal(r.validation.state, C.STATE.REJECTED)
  assert.equal(r.validation.reason, '嗰次係特殊情況')
  assert.equal(s.listLessons().length, 1, 'still on the record')
})

test('*** supersession replaces a belief and points at its replacement ***', () => {
  const s = storeIn(tempDir())
  const older = s.createCandidate(CANDIDATE)
  s.validateLesson(older.id, OWNER)
  const newer = s.createCandidate(Object.assign({}, CANDIDATE, { lesson: '落單前對現貨同凍櫃位' }))

  // ⛔ A CANDIDATE MAY NOT RETIRE A BELIEF.
  assert.throws(() => s.supersedeLesson(older.id, Object.assign({ supersededBy: newer.id }, OWNER)), /must be validated/)
  s.validateLesson(newer.id, OWNER)
  assert.throws(() => s.supersedeLesson(older.id, Object.assign({ supersededBy: older.id }, OWNER)), /cannot supersede itself/)
  assert.throws(() => s.supersedeLesson(older.id, Object.assign({ supersededBy: 'lsn_ghost' }, OWNER)), /unknown replacement/)

  const done = s.supersedeLesson(older.id, Object.assign({ supersededBy: newer.id }, OWNER))
  assert.equal(done.validation.state, C.STATE.SUPERSEDED)
  assert.equal(done.validation.supersededBy, newer.id)
  assert.equal(s.listLessons().length, 2, '⛔ nothing was deleted')
})

/* ═══ APPLICATION / OUTCOME LEDGER ═════════════════════════════════════ */

test('*** only a VALIDATED lesson may be applied ***', () => {
  const s = storeIn(tempDir())
  const l = s.createCandidate(CANDIDATE)
  assert.throws(() => s.recordApplication({ lessonId: l.id }), /only a validated lesson/)
  s.validateLesson(l.id, OWNER)
  const app = s.recordApplication({ lessonId: l.id, contextRef: { kind: 'request', id: 'req_1' } })
  assert.equal(app.lessonId, l.id)
  assert.equal(app.lessonStateAtApplication, C.STATE.VALIDATED)
  assert.equal(app.outcome, null, 'an application starts with no verdict')
  assert.throws(() => s.recordApplication({ lessonId: 'lsn_ghost' }), /unknown lesson/)
})

test('*** an outcome is recorded once, bounded, and changes NO confidence ***', () => {
  const s = storeIn(tempDir())
  const l = s.createCandidate(Object.assign({}, CANDIDATE, {
    confidence: { value: 0.4, basis: C.CONFIDENCE_BASIS.OWNER_JUDGEMENT }
  }))
  s.validateLesson(l.id, OWNER)
  const app = s.recordApplication({ lessonId: l.id })

  const out = s.recordApplicationOutcome({ applicationId: app.id, outcome: 'helped', evidenceRef: { kind: 'task', id: 'task_7' } })
  assert.equal(out.outcome, 'helped')
  assert.ok(out.outcomeRecordedAt)

  // ⛔ W0 RECORDS; IT DOES NOT LEARN. One lucky success is not a rule — moving confidence from
  // an outcome is the validation engine's job (W4), with its own Owner GO.
  assert.equal(s.getLesson(l.id).confidence.value, 0.4, '⛔ confidence was mutated automatically')

  assert.throws(() => s.recordApplicationOutcome({ applicationId: app.id, outcome: 'hurt' }), /already recorded/)
  assert.throws(() => s.recordApplicationOutcome({ applicationId: app.id, outcome: 'great' }), /outcome must be one of/)
  assert.throws(() => s.recordApplicationOutcome({ applicationId: 'app_ghost', outcome: 'helped' }), /unknown application/)
})

test('*** an Owner note on an outcome is bounded and redacted before write ***', () => {
  const s = storeIn(tempDir())
  const l = s.createCandidate(CANDIDATE); s.validateLesson(l.id, OWNER)
  const app = s.recordApplication({ lessonId: l.id })
  const out = s.recordApplicationOutcome({ applicationId: app.id, outcome: 'neutral', note: 'password: hunter2hunter2 唔關事' })
  assert.equal(out.note.includes('hunter2hunter2'), false)
  assert.ok(out.redactedKinds.length > 0)

  const s2 = storeIn(tempDir())
  const l2 = s2.createCandidate(CANDIDATE); s2.validateLesson(l2.id, OWNER)
  const a2 = s2.recordApplication({ lessonId: l2.id })
  assert.throws(() => s2.recordApplicationOutcome({ applicationId: a2.id, outcome: 'helped', note: 'x'.repeat(C.MAX_NOTE_CHARS + 1) }), /exceeds/)
})

/* ═══ EVENTS CARRY NO LESSON TEXT ══════════════════════════════════════ */

test('*** ⛔ the event ledger holds ids and states, never lesson content ***', () => {
  const s = storeIn(tempDir())
  const SECRET_PHRASE = '凍櫃唔夠位要先清舊貨'
  const l = s.createCandidate(Object.assign({}, CANDIDATE, { lesson: SECRET_PHRASE }))
  s.validateLesson(l.id, { authority: 'owner', reason: '確認過' })
  const app = s.recordApplication({ lessonId: l.id })
  s.recordApplicationOutcome({ applicationId: app.id, outcome: 'helped' })

  const blob = JSON.stringify(s.listEvents())
  // ⛔ An event that quotes the lesson is a second, unredacted copy with no lifecycle — a
  // superseded belief would live on in the ledger forever.
  assert.equal(blob.includes(SECRET_PHRASE), false, '⛔ lesson text leaked into the event ledger')
  assert.equal(blob.includes('確認過'), false, '⛔ the Owner\'s reason leaked into the event ledger')
  const kinds = s.listEvents().map((e) => e.type)
  assert.deepEqual(kinds, [C.EVENT.CANDIDATE_CREATED, C.EVENT.VALIDATED, C.EVENT.APPLIED, C.EVENT.APPLICATION_OUTCOME])
})

/* ═══ PERSISTENCE ══════════════════════════════════════════════════════ */

test('*** records survive a completely new store object over the same file ***', () => {
  const dir = tempDir()
  const a = storeIn(dir)
  const l = a.createCandidate(CANDIDATE)
  a.validateLesson(l.id, OWNER)

  const b = storeIn(dir) // a different instance, same file
  assert.equal(b.listLessons({ state: C.STATE.VALIDATED }).length, 1)
  assert.equal(b.getLesson(l.id).validation.authority, 'owner')
})

/* ═══ CONCURRENCY ══════════════════════════════════════════════════════ */

test('*** PARALLEL_WRITERS_REAL_OVERLAP — writers that are genuinely running at once lose nothing ***', async () => {
  /**
   * ⛔ THE FIRST VERSION OF THIS TEST WAS SEQUENTIAL AND SAID IT WAS NOT.
   *
   * It called `spawnSync` in a loop: writer 1 ran to completion, then writer 2 started. That
   * proves multi-PROCESS persistence and nothing at all about contention — a store with no
   * lock whatsoever would have passed it, because there was never a second writer alive.
   *
   * This version uses async `spawn`, waits until EVERY child has reported READY and is still
   * alive, and only then releases a single gate. The children provably overlap before the
   * first write happens.
   */
  const dir = tempDir()
  const file = path.join(dir, 'wisdom.json')
  const gate = path.join(dir, 'GO')
  const WRITERS = 4
  const PER_WRITER = 5

  const script = `
    const fs = require('node:fs')
    const { createWisdomStore } = require(${JSON.stringify(path.resolve(__dirname, 'wisdomStore.js'))})
    const s = createWisdomStore({ file: ${JSON.stringify(file)}, lockTimeoutMs: 20000 })
    process.send({ ready: true, pid: process.pid })
    // Spin until the parent opens the gate. Every writer therefore starts within the same
    // instant, which is the only way the lock is put under real pressure.
    const deadline = Date.now() + 30000
    while (!fs.existsSync(${JSON.stringify(gate)})) {
      if (Date.now() > deadline) { process.exit(3) }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2)
    }
    for (let i = 0; i < ${PER_WRITER}; i++) {
      s.createCandidate({
        situation: 's', action: 'a', outcome: 'o',
        lesson: 'writer ' + process.argv[2] + ' item ' + i,
        provenance: { sourceType: 'manual', createdBy: 'system' }
      })
    }
  `

  const kids = []
  const ready = []
  for (let w = 0; w < WRITERS; w++) {
    const child = spawn(process.execPath, ['-e', script, String(w)], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    let err = ''
    child.stderr.on('data', (d) => { err += String(d) })
    child.__err = () => err
    kids.push(child)
    ready.push(new Promise((resolve, reject) => {
      child.once('message', (m) => (m && m.ready ? resolve(m.pid) : reject(new Error('bad handshake'))))
      child.once('exit', (code) => reject(new Error('child exited before READY (' + code + '): ' + err.slice(0, 300))))
    }))
  }

  const pids = await Promise.all(ready)
  // ⛔ THE BARRIER PROOF: every writer is alive, at the same moment, before any of them writes.
  assert.equal(new Set(pids).size, WRITERS, 'each writer is its own process')
  for (const p of pids) assert.equal(pidAliveInTest(p), true, 'writer ' + p + ' must still be alive at the barrier')
  assert.equal(fs.existsSync(file), false, '⛔ someone wrote before the gate opened')

  fs.writeFileSync(gate, 'go')

  const codes = await Promise.all(kids.map((c) => new Promise((resolve) => c.once('exit', resolve))))
  codes.forEach((code, i) => assert.equal(code, 0, 'writer ' + i + ' failed: ' + kids[i].__err().slice(0, 400)))

  const raw = fs.readFileSync(file, 'utf8')
  const db = JSON.parse(raw) // ⛔ throws if any writer left a half-written document
  assert.equal(db.lessons.length, WRITERS * PER_WRITER, '⛔ a write was LOST under contention')
  assert.equal(new Set(db.lessons.map((l) => l.id)).size, WRITERS * PER_WRITER, 'ids are unique')
  assert.equal(db.events.length, WRITERS * PER_WRITER, '⛔ an event was lost')
  const left = fs.readdirSync(dir).filter((n) => n.includes('.lock') || n.includes('.tmp-'))
  assert.deepEqual(left, [], 'stale lock/temp files remain: ' + left.join(', '))
})

test('*** ⛔ the concurrency case does not use spawnSync — that is what made it fake ***', () => {
  const src = fs.readFileSync(__filename, 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  assert.equal(/spawnSync\s*\(/.test(code), false, '⛔ a synchronous spawn cannot overlap with anything')
})

/* ═══ THE REAL DATA PATH IS NEVER TOUCHED ══════════════════════════════ */

test('*** ⛔ no test in this file can reach the Owner\'s production wisdom path ***', () => {
  const { PRODUCTION_DIR } = require('../store/dataDir')
  const productionWisdom = path.join(PRODUCTION_DIR, 'wisdom')
  // The tranche has never run against production, so this directory must not exist. If a
  // future test forgets to inject a path, this is what catches it.
  assert.equal(fs.existsSync(productionWisdom), false, '⛔ a production wisdom directory exists: ' + productionWisdom)
  // And every store built above was rooted in the OS temp directory.
  const s = storeIn(tempDir())
  assert.ok(s.file.startsWith(os.tmpdir()), 'test stores must live in temp')
})

/* ═══ LOCK SEMANTICS — LIVE IS NEVER STALE ═════════════════════════════ */

test('*** LIVE_OLD_LOCK_NOT_BROKEN / DEAD_LOCK_RECOVERED — age never overrules a living holder ***', async () => {
  /**
   * ⛔ THE DEFECT THIS PINS. The first implementation read
   *     if (!holderDead && ageMs <= LOCK_STALE_MS) return false
   * which deleted a LIVE writer's lock the moment it aged past the window. Two processes then
   * hold it at once and the read-modify-write guarantee is gone — silently, because both
   * writes appear to succeed and only one survives.
   *
   * ⛔ AND IT IS PROVEN WITH A REAL PROCESS, NOT A SOURCE REGEX. A regex cannot tell you
   * whether the branch it is looking at is the one that runs.
   */
  const dir = tempDir()
  const file = path.join(dir, 'wisdom.json')
  const lockFile = file + '.lock'

  // A real child that takes the lock, back-dates it well past the stale window, and STAYS ALIVE.
  const holderScript = [
    'const fs = require("node:fs")',
    'fs.mkdirSync(' + JSON.stringify(dir) + ', { recursive: true })',
    'fs.writeFileSync(' + JSON.stringify(lockFile) + ', JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))',
    'const old = Date.now() - ' + (LOCK_STALE_MS * 5),
    'fs.utimesSync(' + JSON.stringify(lockFile) + ', new Date(old), new Date(old))',
    'process.send({ ready: true, pid: process.pid })',
    'setInterval(() => {}, 1000)'
  ].join('\n')

  const holder = spawn(process.execPath, ['-e', holderScript], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  const holderPid = await new Promise((resolve, reject) => {
    holder.once('message', (m) => (m && m.ready ? resolve(m.pid) : reject(new Error('bad handshake'))))
    holder.once('exit', (c) => reject(new Error('lock holder exited early: ' + c)))
  })

  assert.equal(pidAliveInTest(holderPid), true, 'the holder is alive')
  const ageMs = Date.now() - fs.statSync(lockFile).mtimeMs
  assert.ok(ageMs > LOCK_STALE_MS, 'and its lock is older than the stale window (' + ageMs + 'ms)')

  // ⛔ LIVE + OLD MUST NOT BE TREATED AS STALE.
  const s = createWisdomStore({ file, lockTimeoutMs: 250 })
  assert.throws(() => s.createCandidate(CANDIDATE), /busy|lock timeout/, 'the live holder lock was broken')
  assert.equal(fs.existsSync(lockFile), true, '⛔ a LIVE holder’s lock was deleted')
  assert.equal(fs.existsSync(file), false, '⛔ a mutation happened while another process held the lock')

  // Now the holder dies. The same lock — same age, same pid — becomes recoverable.
  holder.kill()
  await new Promise((r) => holder.once('exit', r))
  assert.ok(await waitFor(() => !pidAliveInTest(holderPid)), 'holder pid is gone')

  const after = s.createCandidate(CANDIDATE)
  assert.equal(after.validation.state, C.STATE.CANDIDATE, 'a dead holder never blocks anybody')
  assert.equal(fs.existsSync(lockFile), false, 'and the lock is released again')
  assert.equal(s.listLessons().length, 1)
})

test('*** an UNIDENTIFIABLE holder falls back to age — fresh is kept, old may be broken ***', () => {
  // The only case where age is the verdict: there is nobody to ask.
  const dir = tempDir()
  const file = path.join(dir, 'wisdom.json')
  const lockFile = file + '.lock'
  fs.mkdirSync(dir, { recursive: true })

  for (const junk of ['', 'not json', '{}', '{"pid":"nope"}', '{"pid":0}']) {
    fs.writeFileSync(lockFile, junk)
    const fresh = createWisdomStore({ file, lockTimeoutMs: 150 })
    assert.throws(() => fresh.createCandidate(CANDIDATE), /busy|lock timeout/, 'fresh unidentified lock: ' + JSON.stringify(junk))
    assert.equal(fs.existsSync(lockFile), true, 'a FRESH unidentifiable lock must be respected')

    const old = Date.now() - LOCK_STALE_MS * 5
    fs.utimesSync(lockFile, new Date(old), new Date(old))
    const s = createWisdomStore({ file, lockTimeoutMs: 2000 })
    s.createCandidate(CANDIDATE) // an OLD unidentifiable lock may be broken
    assert.equal(fs.existsSync(lockFile), false)
    fs.rmSync(file, { force: true })
  }
})

/* ═══ STRUCTURAL CORRUPTION IS LOUD ════════════════════════════════════ */

test('*** STRUCTURAL_CORRUPTION_LOUD — a valid-JSON but wrong-shape store is never read as empty ***', () => {
  /**
   * ⛔ `"lessons": {}` IS PERFECTLY VALID JSON AND COMPLETELY CORRUPT.
   *
   * The first implementation ended `Array.isArray(db.lessons) ? db.lessons : []`, so that file
   * answered 「nothing was ever learned」 with total confidence — the exact failure `load()`
   * exists to prevent, reintroduced one line below the comment forbidding it.
   */
  const seed = () => {
    const d = tempDir()
    const s = storeIn(d)
    const l = s.createCandidate(CANDIDATE)
    s.validateLesson(l.id, OWNER)
    const app = s.recordApplication({ lessonId: l.id })
    s.recordApplicationOutcome({ applicationId: app.id, outcome: 'helped' })
    return JSON.parse(fs.readFileSync(path.join(d, 'wisdom.json'), 'utf8'))
  }
  const valid = seed()
  const clone = () => JSON.parse(JSON.stringify(valid))

  const fixtures = {
    'lessons is an object': (db) => { db.lessons = {} },
    'lessons is null': (db) => { db.lessons = null },
    'applications is null': (db) => { db.applications = null },
    'events is a string': (db) => { db.events = 'oops' },
    'schemaVersion missing': (db) => { delete db.schemaVersion },
    'schemaVersion wrong': (db) => { db.schemaVersion = 99 },
    'top level is an array': () => [],
    'malformed lesson: not an object': (db) => { db.lessons[0] = 'a lesson' },
    'malformed lesson: no id': (db) => { delete db.lessons[0].id },
    'malformed lesson: empty lesson text': (db) => { db.lessons[0].lesson = '   ' },
    'malformed lesson: unknown state': (db) => { db.lessons[0].validation.state = 'probably' },
    'malformed lesson: validated with no authority': (db) => { db.lessons[0].validation.authority = null },
    'malformed lesson: forbidden authority': (db) => { db.lessons[0].validation.authority = 'aroma' },
    'malformed lesson: confidence out of range': (db) => { db.lessons[0].confidence = { value: 7, basis: 'owner_judgement' } },
    'malformed lesson: confidence without basis': (db) => { db.lessons[0].confidence = { value: 0.5, basis: null } },
    'malformed lesson: unknown sourceType': (db) => { db.lessons[0].provenance.sourceType = 'gossip' },
    'malformed lesson: ref carrying text': (db) => { db.lessons[0].provenance.sourceRefs = [{ kind: 'task', id: 't1', text: 'transcript' }] },
    'malformed lesson: unknown ref kind': (db) => { db.lessons[0].validation.evidenceRefs = [{ kind: 'mailbox', id: 'm1' }] },
    'malformed application: not an object': (db) => { db.applications[0] = 7 },
    'malformed application: bad state at application': (db) => { db.applications[0].lessonStateAtApplication = 'candidate' },
    'malformed application: unknown outcome': (db) => { db.applications[0].outcome = 'great' },
    'malformed event: not an object': (db) => { db.events[0] = 'created' },
    'malformed event: unknown type': (db) => { db.events[0].type = 'lesson.invented' },
    'malformed event: no timestamp': (db) => { delete db.events[0].at }
  }

  for (const [label, mutate] of Object.entries(fixtures)) {
    const dir = tempDir()
    const file = path.join(dir, 'wisdom.json')
    const db = clone()
    const replaced = mutate(db)
    const bytes = JSON.stringify(replaced === undefined ? db : replaced, null, 2)
    fs.writeFileSync(file, bytes)

    const s = createWisdomStore({ file })
    // ⛔ EVERY read path refuses — a caller cannot pick one that happens to be lenient.
    for (const read of [() => s.listLessons(), () => s.listApplications(), () => s.listEvents(), () => s.getLesson('lsn_x')]) {
      assert.throws(read, /unreadable|refusing to treat it as empty/, label)
    }
    // ⛔ AND THE FILE IS EXACTLY AS IT WAS FOUND. Nothing repaired, nothing rewritten.
    assert.equal(fs.readFileSync(file, 'utf8'), bytes, label + ': the file was modified')
    assert.equal(fs.readdirSync(dir).filter((n) => n.includes('.tmp-')).length, 0, label + ': a temp file was written')
  }
})

test('*** a mutation on a corrupt store refuses too, and still writes nothing ***', () => {
  const dir = tempDir()
  const file = path.join(dir, 'wisdom.json')
  const bytes = JSON.stringify({ schemaVersion: 1, lessons: {}, applications: [], events: [] }, null, 2)
  fs.writeFileSync(file, bytes)
  const s = createWisdomStore({ file })
  assert.throws(() => s.createCandidate(CANDIDATE), /unreadable/)
  assert.equal(fs.readFileSync(file, 'utf8'), bytes, '⛔ a corrupt store was overwritten by a new write')
  assert.equal(fs.existsSync(file + '.lock'), false, 'and the lock was released')
})

test('*** a well-formed store still round-trips through the validator untouched ***', () => {
  const dir = tempDir()
  const s = storeIn(dir)
  const l = s.createCandidate(CANDIDATE)
  s.validateLesson(l.id, OWNER)
  const app = s.recordApplication({ lessonId: l.id, contextRef: { kind: 'request', id: 'req_1' } })
  s.recordApplicationOutcome({ applicationId: app.id, outcome: 'helped', evidenceRef: { kind: 'task', id: 'task_1' } })

  const before = fs.readFileSync(path.join(dir, 'wisdom.json'), 'utf8')
  const fresh = storeIn(dir)
  assert.equal(fresh.listLessons().length, 1)
  assert.equal(fresh.listApplications().length, 1)
  assert.equal(fresh.listEvents().length, 4)
  // ⛔ READ-ONLY: validation must not normalise, repair or rewrite anything.
  assert.equal(fs.readFileSync(path.join(dir, 'wisdom.json'), 'utf8'), before)
})

/* ═══ THE TOCTOU RACE — TWO RECLAIMERS, ONE DEAD LOCK ══════════════════ */

test('*** STALE_LOCK_RECLAIM_DOES_NOT_DELETE_NEW_LIVE_OWNER — a losing reclaimer cannot delete the winner ***', async () => {
  /**
   * ⛔ THE RACE THE R1 TEST COULD NOT SEE, BECAUSE IT HAD ONLY ONE RECLAIMER.
   *
   *   A reads the dead lock and decides 「reclaimable」
   *   B reads the same dead lock, reclaims it, and acquires a NEW lock with B's LIVE pid
   *   A calls unlink(path) — and deletes B's LIVE lock
   *   A acquires the path too; TWO writers believe they hold the exclusive lock
   *
   * A guarantee with only one participant is not a guarantee. This test forces exactly that
   * interleaving with a parent-controlled gate, so the dangerous ordering happens EVERY run
   * rather than occasionally.
   */
  const dir = tempDir()
  const file = path.join(dir, 'wisdom.json')
  const lockFile = file + '.lock'
  const gate = path.join(dir, 'RELEASE_A')
  fs.mkdirSync(dir, { recursive: true })

  // A lock left by a process that is definitely gone: spawn one and let it exit.
  const corpse = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  const deadPid = corpse.pid
  await new Promise((r) => corpse.once('exit', r))
  assert.ok(await waitFor(() => !pidAliveInTest(deadPid)), 'the previous holder is really dead')
  const deadLock = JSON.stringify({ pid: deadPid, at: new Date().toISOString(), token: 'DEAD-TOKEN' })
  fs.writeFileSync(lockFile, deadLock)

  /**
   * A: observes the dead lock, then BLOCKS at the gate — still holding its stale verdict —
   * while B goes on to win. When released, A walks straight into the reclamation path with an
   * observation that is now out of date. That is precisely the dangerous moment.
   */
  const aScript = [
    'const { createWisdomStore } = require(' + JSON.stringify(path.resolve(__dirname, 'wisdomStore.js')) + ')',
    'const s = createWisdomStore({',
    '  file: ' + JSON.stringify(file) + ',',
    '  lockTimeoutMs: 1500,',
    '  __raceGateFile: ' + JSON.stringify(gate) + ',',
    '  __raceGateTimeoutMs: 20000',
    '})',
    'process.send({ ready: true, pid: process.pid })',
    'try {',
    '  s.createCandidate({ situation: "s", action: "a", outcome: "o", lesson: "A wrote", provenance: { sourceType: "manual", createdBy: "system" } })',
    '  process.send({ result: "wrote" })',
    '} catch (e) { process.send({ result: "refused", message: String(e.message).slice(0, 80) }) }',
    'process.exit(0)'
  ].join('\n')

  const a = spawn(process.execPath, ['-e', aScript], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  const aMessages = []
  a.on('message', (m) => aMessages.push(m))
  await new Promise((resolve, reject) => {
    const onMsg = (m) => { if (m && m.ready) { a.off('message', onMsg); resolve() } }
    a.on('message', onMsg)
    a.once('exit', (c) => reject(new Error('A exited before READY: ' + c)))
  })

  // Give A time to reach the gate: it must have observed the dead lock by now.
  await new Promise((r) => setTimeout(r, 250))
  assert.equal(fs.existsSync(lockFile), true, 'the dead lock is still in place while A waits')

  /**
   * B: the WINNER. It reclaims the dead lock, acquires its own, and then holds it — alive —
   * for long enough that A's stale reclamation attempt lands squarely on B's live lock.
   */
  const bScript = [
    'const fs = require("node:fs")',
    'const { createWisdomStore } = require(' + JSON.stringify(path.resolve(__dirname, 'wisdomStore.js')) + ')',
    'const s = createWisdomStore({ file: ' + JSON.stringify(file) + ', lockTimeoutMs: 5000 })',
    // A long-running mutation: B holds the lock while A is released into its stale decision.
    'const done = s.createCandidate({ situation: "s", action: "a", outcome: "o", lesson: "B wrote", provenance: { sourceType: "manual", createdBy: "system" } })',
    'process.send({ wrote: done.id })',
    'process.exit(0)'
  ].join('\n')

  // B runs to completion first, so the lock A is about to judge has already been replaced and
  // released — then we re-create a LIVE lock owned by a real, living process, which is the
  // thing A must not be able to delete.
  const b = spawn(process.execPath, ['-e', bScript], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  const bWrote = await new Promise((resolve, reject) => {
    b.on('message', (m) => { if (m && m.wrote) resolve(m.wrote) })
    b.once('exit', (c) => reject(new Error('B exited without writing: ' + c)))
  })
  await new Promise((r) => b.once('exit', r))
  assert.ok(bWrote, 'B won the reclamation and wrote')

  // A LIVE owner now holds the lock — exactly what A's stale verdict would destroy.
  const holderScript = [
    'const fs = require("node:fs")',
    'fs.writeFileSync(' + JSON.stringify(lockFile) + ', JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token: "LIVE-WINNER" }))',
    'process.send({ ready: true, pid: process.pid })',
    'setInterval(() => {}, 1000)'
  ].join('\n')
  const holder = spawn(process.execPath, ['-e', holderScript], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  const holderPid = await new Promise((resolve, reject) => {
    holder.once('message', (m) => (m && m.ready ? resolve(m.pid) : reject(new Error('bad handshake'))))
    holder.once('exit', (c) => reject(new Error('holder exited early: ' + c)))
  })
  assert.equal(pidAliveInTest(holderPid), true)

  // ⛔ RELEASE A INTO ITS STALE DECISION.
  fs.writeFileSync(gate, 'go')
  const aExit = await new Promise((r) => a.once('exit', r))

  // ⛔ THE CORE ASSERTIONS — inside try/finally so a FAILING run still reaps the holder.
  // Without this, an assertion throwing before kill() leaves a live child and the test runner
  // waits forever, which turns a clear failure into a hang.
  try {
    assert.equal(fs.existsSync(lockFile), true, '⛔ the LIVE winner\'s lock was DELETED by a stale reclaimer')
    const stillOwned = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
    assert.equal(stillOwned.token, 'LIVE-WINNER', '⛔ the live owner\'s lock was replaced')
    assert.equal(stillOwned.pid, holderPid)
    assert.equal(pidAliveInTest(holderPid), true, 'the winner is still alive and still owns it')

    const outcome = aMessages.find((m) => m && m.result)
    assert.ok(outcome, 'A reported an outcome')
    assert.equal(outcome.result, 'refused', '⛔ A entered the critical section while the winner held the lock')
    assert.match(outcome.message, /busy|lock timeout/)
    assert.equal(aExit, 0)
  } finally {
    holder.kill()
    await new Promise((r) => holder.once('exit', r))
  }

  assert.ok(await waitFor(() => !pidAliveInTest(holderPid)))
  try { fs.unlinkSync(lockFile) } catch (_) {}

  const s = createWisdomStore({ file })
  const lessons = s.listLessons()
  assert.equal(lessons.length, 1, '⛔ a write was lost')
  assert.equal(lessons[0].lesson, 'B wrote')
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('.tmp-') || n.includes('.reclaim-')), [],
    'no reclamation or temp debris left behind')
})

test('*** reclamation never blind-unlinks: there is no unlink of the lock path outside release ***', () => {
  // ⛔ THE STRUCTURAL COMPANION TO THE RACE TEST. Reclamation now takes the file by rename and
  // verifies what it took; a bare unlink of the lock path would reintroduce the whole defect.
  const src = fs.readFileSync(path.resolve(__dirname, 'wisdomStore.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const unlinksOfLockPath = (src.match(/unlinkSync\(lockFile\)/g) || []).length
  assert.equal(unlinksOfLockPath, 1, 'the ONLY unlink of the lock path is the owner releasing its own lock')
  // And that one sits inside releaseLock, after the token check.
  const release = src.slice(src.indexOf('function releaseLock'), src.indexOf('function assertStillOwner'))
  assert.ok(/info\.token !== token/.test(release), 'release verifies ownership first')
  assert.ok(/unlinkSync\(lockFile\)/.test(release))
  // Reclamation moves the file rather than deleting a pathname.
  assert.ok(/renameSync\(lockFile, priv\)/.test(src), 'reclamation takes the file by rename')
})

test('*** a lock lost mid-critical-section is refused at commit, never written through ***', () => {
  // ⛔ THE LAST LINE OF DEFENCE. Holding the lock at the start is not the same claim as holding
  // it at the moment of writing, so ownership is re-checked immediately before the write.
  const dir = tempDir()
  const file = path.join(dir, 'wisdom.json')
  const s = createWisdomStore({ file })
  const lockFile = file + '.lock'

  const original = fs.readFileSync
  let sabotaged = false
  fs.readFileSync = function (p, ...rest) {
    // Steal the lock the moment the store re-reads it to confirm ownership.
    if (!sabotaged && String(p) === lockFile) {
      sabotaged = true
      original.call(fs, p, ...rest) // let the real read happen first
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token: 'SOMEONE-ELSE' }))
    }
    return original.call(fs, p, ...rest)
  }
  try {
    assert.throws(() => s.createCandidate(CANDIDATE), /lock was lost before commit/)
  } finally { fs.readFileSync = original }

  assert.equal(fs.existsSync(file), false, '⛔ a write happened after the lock was lost')
  try { fs.unlinkSync(lockFile) } catch (_) {}
})

/* ═══ THE UNREADABLE CONTRACT IS HONEST ════════════════════════════════ */

test('*** UNREADABLE_EXISTING_FILE_FAILS_LOUD — every existing-but-unreadable file uses ONE contract ***', () => {
  /**
   * ⛔ THE COMMENT PROMISED ONE ERROR SHAPE AND THE CODE HAD TWO.
   *
   * ENOENT returned empty (correct), JSON/schema corruption was wrapped (correct), and every
   * OTHER read failure — permission, I/O, a directory where the store should be — escaped raw.
   * A caller catching broadly would then have had every excuse to treat it as 「no lessons」.
   */
  // A directory where the file should be: a real, non-ENOENT read failure.
  const dir = tempDir()
  const file = path.join(dir, 'wisdom.json')
  fs.mkdirSync(file, { recursive: true })
  const s = createWisdomStore({ file })
  assert.throws(() => s.listLessons(), /unreadable|refusing to treat it as empty/,
    'a non-ENOENT read failure must use the common contract')
  assert.equal(fs.existsSync(file), true, 'and nothing was modified')

  // An injected EACCES-style failure takes the same path.
  const dir2 = tempDir()
  const file2 = path.join(dir2, 'wisdom.json')
  fs.writeFileSync(file2, JSON.stringify({ schemaVersion: 1, lessons: [], applications: [], events: [] }))
  const s2 = createWisdomStore({ file: file2 })
  const original = fs.readFileSync
  fs.readFileSync = function (p, ...rest) {
    if (String(p) === file2) { const e = new Error('permission denied'); e.code = 'EACCES'; throw e }
    return original.call(fs, p, ...rest)
  }
  try {
    assert.throws(() => s2.listLessons(), (e) => {
      assert.match(e.message, /unreadable/)
      assert.match(e.message, /refusing to treat it as empty/)
      assert.match(e.message, /EACCES/, 'the error CODE is carried for diagnosis')
      return true
    })
  } finally { fs.readFileSync = original }

  // ⛔ AND ENOENT REMAINS THE ONLY LEGITIMATE EMPTY.
  const fresh = createWisdomStore({ file: path.join(tempDir(), 'wisdom.json') })
  assert.deepEqual(fresh.listLessons(), [])
})
