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
const { spawnSync } = require('node:child_process')

const { createWisdomStore, DURABILITY_STATUS } = require('./wisdomStore')
const C = require('./wisdomContract')

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

test('*** parallel writer PROCESSES lose nothing and leave valid JSON ***', () => {
  // ⛔ A REAL MULTI-PROCESS TEST. In-process serialisation proves nothing about a lock whose
  // whole purpose is to hold across processes; last-write-wins would look fine here without it.
  const dir = tempDir()
  const file = path.join(dir, 'wisdom.json')
  const WRITERS = 4
  const PER_WRITER = 3

  const script = `
    const { createWisdomStore } = require(${JSON.stringify(path.resolve(__dirname, 'wisdomStore.js'))})
    const s = createWisdomStore({ file: ${JSON.stringify(file)} })
    for (let i = 0; i < ${PER_WRITER}; i++) {
      s.createCandidate({
        situation: 's', action: 'a', outcome: 'o',
        lesson: 'writer ' + process.argv[2] + ' item ' + i,
        provenance: { sourceType: 'manual', createdBy: 'system' }
      })
    }
  `
  const kids = []
  for (let w = 0; w < WRITERS; w++) kids.push(spawnSync(process.execPath, ['-e', script, String(w)], { encoding: 'utf8' }))
  for (const k of kids) assert.equal(k.status, 0, 'writer failed: ' + (k.stderr || '').slice(0, 400))

  const raw = fs.readFileSync(file, 'utf8')
  const db = JSON.parse(raw) // ⛔ throws if any writer left a half-written document
  assert.equal(db.lessons.length, WRITERS * PER_WRITER, '⛔ a write was lost')
  assert.equal(new Set(db.lessons.map((l) => l.id)).size, WRITERS * PER_WRITER, 'ids are unique')
  assert.equal(db.events.length, WRITERS * PER_WRITER)
  // No lock or temp files left behind.
  const left = fs.readdirSync(dir).filter((n) => n.includes('.lock') || n.includes('.tmp-'))
  assert.deepEqual(left, [], 'stale lock/temp files remain: ' + left.join(', '))
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
