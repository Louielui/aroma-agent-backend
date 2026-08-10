'use strict'

/**
 * wisdomStore.js — the Wisdom domain's own durable-shaped store.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ A SEPARATE FILE, ON PURPOSE.
 *
 * Lessons do NOT go into aroma-truth.json. That file holds operational truth — decisions,
 * tasks, events the business runs on — and a learning subsystem that is still being designed
 * has no business sharing a document with it. A bug here must not be able to corrupt that.
 *
 * ⛔ AND `src/store/store.js` IS NOT REFACTORED TO SHARE CODE. Extracting a common core would
 * mean editing the operational store during the very tranche whose purpose is to be reversible.
 * The safety PROPERTIES are reproduced deliberately; the risk is not.
 *
 * ⛔ DURABILITY IS NOT CLAIMED. This file writes atomically and locks correctly. It has NOT
 * been through backup and isolated restore verification, so nothing here or in the docs may
 * call it durable, backed up or restore-safe. See `durabilityStatus` below.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { resolveDataDir } = require('../store/dataDir')
const C = require('./wisdomContract')

/** ⛔ AN HONEST LABEL, CARRIED IN CODE so a future reader cannot miss it. */
const DURABILITY_STATUS = 'UNVERIFIED'

const LOCK_TIMEOUT_MS = 5000
const RENAME_RETRY_MS = 500
const TMP_SWEEP_MS = 60000
const MAX_APPLICATION_NOTE = C.MAX_NOTE_CHARS

const emptyDb = () => ({ schemaVersion: C.SCHEMA_VERSION, lessons: [], applications: [], events: [] })

/** The one error shape every unreadable-store path uses. */
const unreadable = (why) => new Error(
  'wisdom store is unreadable (' + why + ') — refusing to treat it as empty. The file was NOT modified.'
)

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== ''

/**
 * ⛔ READ-ONLY VALIDATION. It answers 「is this the shape we wrote?」 and nothing else.
 *
 * It never truncates, defaults, redacts, rewrites, drops a bad record or skips one. A reader
 * that repairs what it reads destroys the evidence that something went wrong — and a store
 * that quietly drops the malformed third lesson reports two where three were learned.
 */
function assertPersistedRef (ref, where) {
  if (!isPlainObject(ref)) throw unreadable(where + ' is not an object')
  const keys = Object.keys(ref).sort()
  if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'kind') throw unreadable(where + ' must carry exactly {kind, id}')
  if (!C.REF_KINDS.has(ref.kind)) throw unreadable(where + '.kind is not a known ref kind')
  if (!isNonEmptyString(ref.id) || ref.id.length > C.MAX_ID_CHARS) throw unreadable(where + '.id is invalid')
}

function assertPersistedRefs (refs, where) {
  if (!Array.isArray(refs)) throw unreadable(where + ' is not an array')
  if (refs.length > C.MAX_REFS) throw unreadable(where + ' exceeds the bounded ref count')
  refs.forEach((r, i) => assertPersistedRef(r, where + '[' + i + ']'))
}

function assertPersistedLesson (l, i) {
  const at = 'lessons[' + i + ']'
  if (!isPlainObject(l)) throw unreadable(at + ' is not an object')
  if (l.schemaVersion !== C.SCHEMA_VERSION) throw unreadable(at + '.schemaVersion is unsupported')
  if (!isNonEmptyString(l.id) || l.id.length > C.MAX_ID_CHARS) throw unreadable(at + '.id is invalid')

  for (const f of ['situation', 'action', 'outcome', 'lesson']) {
    if (!isNonEmptyString(l[f])) throw unreadable(at + '.' + f + ' is missing or not a string')
    if (l[f].length > C.MAX_SEMANTIC_CHARS) throw unreadable(at + '.' + f + ' exceeds its bound')
  }

  const c = l.confidence
  if (!isPlainObject(c)) throw unreadable(at + '.confidence is not an object')
  if (c.value !== null) {
    if (typeof c.value !== 'number' || !Number.isFinite(c.value) || c.value < 0 || c.value > 1) {
      throw unreadable(at + '.confidence.value is invalid')
    }
    // ⛔ A stored number with no basis is a number nobody can argue with.
    if (!C.CONFIDENCE_BASES.has(c.basis)) throw unreadable(at + '.confidence.basis is required with a value')
  } else if (c.basis !== null && !C.CONFIDENCE_BASES.has(c.basis)) {
    throw unreadable(at + '.confidence.basis is not a known basis')
  }

  const v = l.validation
  if (!isPlainObject(v)) throw unreadable(at + '.validation is not an object')
  if (!C.STATES.has(v.state)) throw unreadable(at + '.validation.state is not a known state')
  if (v.authority !== null && !C.AUTHORITIES.has(v.authority)) throw unreadable(at + '.validation.authority is not permitted')
  if (v.reason !== null && !isNonEmptyString(v.reason)) throw unreadable(at + '.validation.reason is invalid')
  if (v.validatedAt !== null && !isNonEmptyString(v.validatedAt)) throw unreadable(at + '.validation.validatedAt is invalid')
  if (v.supersededBy !== null && !isNonEmptyString(v.supersededBy)) throw unreadable(at + '.validation.supersededBy is invalid')
  // ⛔ A validated lesson with no authority would be a belief nobody blessed.
  if (v.state === C.STATE.VALIDATED && !C.AUTHORITIES.has(v.authority)) throw unreadable(at + ' is validated with no owner authority')
  assertPersistedRefs(v.evidenceRefs, at + '.validation.evidenceRefs')

  const p = l.provenance
  if (!isPlainObject(p)) throw unreadable(at + '.provenance is not an object')
  if (!C.SOURCE_TYPES.has(p.sourceType)) throw unreadable(at + '.provenance.sourceType is not a known source type')
  if (!C.CREATED_BYS.has(p.createdBy)) throw unreadable(at + '.provenance.createdBy is not a known creator')
  if (!isNonEmptyString(p.createdAt)) throw unreadable(at + '.provenance.createdAt is missing')
  assertPersistedRefs(p.sourceRefs, at + '.provenance.sourceRefs')

  if (!Array.isArray(l.redactedKinds)) throw unreadable(at + '.redactedKinds is not an array')
  if (!isPlainObject(l.scope)) throw unreadable(at + '.scope is not an object')
  if (!Array.isArray(l.scope.tags)) throw unreadable(at + '.scope.tags is not an array')
}

function assertPersistedApplication (a, i) {
  const at = 'applications[' + i + ']'
  if (!isPlainObject(a)) throw unreadable(at + ' is not an object')
  if (a.schemaVersion !== C.SCHEMA_VERSION) throw unreadable(at + '.schemaVersion is unsupported')
  if (!isNonEmptyString(a.id) || a.id.length > C.MAX_ID_CHARS) throw unreadable(at + '.id is invalid')
  if (!isNonEmptyString(a.lessonId) || a.lessonId.length > C.MAX_ID_CHARS) throw unreadable(at + '.lessonId is invalid')
  // ⛔ Only a validated lesson may ever have been applied, so any other stored state is corrupt.
  if (a.lessonStateAtApplication !== C.STATE.VALIDATED) throw unreadable(at + '.lessonStateAtApplication is invalid')
  if (!isNonEmptyString(a.appliedAt)) throw unreadable(at + '.appliedAt is missing')
  if (a.outcome !== null && !C.APPLICATION_OUTCOMES.has(a.outcome)) throw unreadable(at + '.outcome is not a known outcome')
  if (a.note !== null && typeof a.note !== 'string') throw unreadable(at + '.note is invalid')
  if (!Array.isArray(a.redactedKinds)) throw unreadable(at + '.redactedKinds is not an array')
  if (a.contextRef !== null) assertPersistedRef(a.contextRef, at + '.contextRef')
  if (a.outcomeEvidenceRef !== null) assertPersistedRef(a.outcomeEvidenceRef, at + '.outcomeEvidenceRef')
}

const EVENT_TYPES = new Set(Object.values(C.EVENT))

function assertPersistedEvent (e, i) {
  const at = 'events[' + i + ']'
  if (!isPlainObject(e)) throw unreadable(at + ' is not an object')
  if (!EVENT_TYPES.has(e.type)) throw unreadable(at + '.type is not a known event type')
  if (!isNonEmptyString(e.at)) throw unreadable(at + '.at is missing')
}

/** Top level first, then every record. Anything wrong makes the whole store unavailable. */
function assertPersistedShape (db) {
  if (!isPlainObject(db)) throw unreadable('top level is not an object')
  if (db.schemaVersion !== C.SCHEMA_VERSION) throw unreadable('schemaVersion is missing or unsupported')
  for (const key of ['lessons', 'applications', 'events']) {
    if (!Array.isArray(db[key])) throw unreadable(key + ' is not an array')
  }
  db.lessons.forEach(assertPersistedLesson)
  db.applications.forEach(assertPersistedApplication)
  db.events.forEach(assertPersistedEvent)
  return db
}

function sleepSync (ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Create a Wisdom store bound to one file.
 *
 * ⛔ THE PATH IS INJECTABLE AND TESTS MUST INJECT IT. Every test in this domain passes a temp
 * directory; none may reach the Owner's real data, and a test that forgot to would be writing
 * fixture lessons into production memory.
 */
function createWisdomStore (options = {}) {
  const dir = options.dir || path.join(resolveDataDir(), 'wisdom')
  const file = options.file || path.join(dir, 'wisdom.json')
  const lockFile = file + '.lock'
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  const lockTimeoutMs = Number.isFinite(options.lockTimeoutMs) ? options.lockTimeoutMs : LOCK_TIMEOUT_MS

  /* ── read ──────────────────────────────────────────────────────────── */

  /**
   * ⛔ MISSING AND UNREADABLE ARE DIFFERENT ANSWERS.
   * Absent means first run and is legitimately empty. Anything else — truncated, half-written,
   * not JSON — THROWS. Treating corruption as 「no lessons yet」 is how a store silently becomes
   * empty and then confidently reports that nothing was ever learned.
   */
  function load () {
    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (err) {
      // ⛔ ABSENT IS THE ONLY LEGITIMATE EMPTY. First run, nothing learned yet — a true answer.
      if (err && err.code === 'ENOENT') return emptyDb()
      /**
       * ⛔ AND EVERY OTHER READ FAILURE IS UNREADABLE, NOT EMPTY.
       *
       * The previous version let a raw fs error escape here while the comment above `load()`
       * promised one common 「unreadable」 contract. A permission error, a locked file, an I/O
       * fault or a directory where the store should be would each have surfaced as something
       * else entirely — and a caller that catches broadly would then have had every excuse to
       * treat it as 「no lessons」. The error CODE is carried for diagnosis; the file's contents
       * are not, because they could not be read.
       */
      throw unreadable('read failed: ' + ((err && err.code) || 'unknown'))
    }
    let db
    try {
      db = JSON.parse(raw)
    } catch (err) {
      throw unreadable((err && err.message) || 'invalid JSON')
    }
    /**
     * ⛔ NO COERCION. A FILE THAT EXISTS MUST BE THE RIGHT SHAPE.
     *
     * The first version ended `Array.isArray(db.lessons) ? db.lessons : base.lessons`, which
     * turns `"lessons": {}` — structurally corrupt, and perfectly valid JSON — into `[]`. The
     * store then answers 「nothing was ever learned」 with total confidence. That is the exact
     * failure `load()` exists to prevent, reintroduced one line below the comment forbidding it.
     *
     * Absent means first run. Present means it must parse AND validate, or the store is
     * unavailable and the file is left exactly as it was found.
     */
    assertPersistedShape(db)
    return db
  }

  /* ── lock ──────────────────────────────────────────────────────────── */

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ⛔ FAIL CLOSED. W0 HAS NO AUTOMATIC CRASH RECOVERY, ON PURPOSE.
   *
   * Earlier versions tried to reclaim a lock left behind by a dead process — first by age,
   * then by pid, then by an atomic rename with an identity check. Each round closed the hole
   * it was aimed at and left a smaller one: reclaim-then-restore has a window where the
   * replacement owner's lock is briefly absent, and 「check the token, then unlink the path」 is
   * two operations however tightly they are written. Recovery cannot be made safe with the
   * primitives available here, and a guarantee that is ALMOST true about mutual exclusion is
   * not a guarantee at all.
   *
   * So W0 does not attempt it. If the lock file exists, EVERY case is the same answer:
   *
   *     live pid, fresh      → BUSY        dead pid, fresh      → BUSY
   *     live pid, very old   → BUSY        dead pid, very old   → BUSY
   *     malformed or empty   → BUSY        no pid at all        → BUSY
   *
   * Nothing on the mutation path deletes, renames, replaces, repairs or reclaims an existing
   * lock. A waiter waits out its bounded timeout and then refuses, having changed nothing.
   *
   * ⛔ THE COST IS STATED PLAINLY: a crashed writer leaves Wisdom unavailable until somebody
   * removes the file by hand. For a subsystem that is unwired, not production-active and whose
   * durability is UNVERIFIED, temporary unavailability is a far better failure than two writers
   * who both believe they own the store. False progress is worse than an honest stop.
   *
   * ⛔ CRASH RECOVERY = NOT IMPLEMENTED. Stale-lock recovery is MANUAL / FUTURE GOVERNED
   * MAINTENANCE ONLY, with its own Owner GO. It is deliberately not built here.
   * ══════════════════════════════════════════════════════════════════════════
   */

  /** Read the lock's own description of itself. `null` when absent or unparseable. */
  function readLockInfo () {
    let raw
    try { raw = fs.readFileSync(lockFile, 'utf8') } catch (_) { return null }
    try {
      const info = JSON.parse(raw)
      return (info && typeof info === 'object' && !Array.isArray(info)) ? info : null
    } catch (_) { return null }
  }

  /**
   * Acquire the lock, or refuse.
   *
   * ⛔ EXCLUSIVITY COMES FROM ONE THING: `wx` is an atomic create-or-fail, and no code path in
   * this store removes a lock it did not create. Those two facts together are the guarantee.
   * The ownership token below is for safe release and diagnosis — it is NOT what makes the
   * critical section exclusive.
   */
  function acquireLock () {
    const deadline = Date.now() + lockTimeoutMs
    for (;;) {
      const token = crypto.randomBytes(12).toString('hex')
      try {
        const fd = fs.openSync(lockFile, 'wx')
        try {
          fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token }))
        } finally { fs.closeSync(fd) }
        return token
      } catch (err) {
        if (!err || err.code !== 'EEXIST') throw err
        // ⛔ NO INSPECTION, NO JUDGEMENT, NO RECOVERY. The lock exists; that is the whole answer.
        if (Date.now() >= deadline) {
          throw new Error('wisdom store is busy (lock timeout) — an existing lock was found and W0 never reclaims one')
        }
        sleepSync(15)
      }
    }
  }

  /**
   * Release MY lock.
   *
   * ⛔ AN HONEST DESCRIPTION OF WHAT THIS GUARANTEES. Reading the token and then unlinking the
   * path is two operations, so this is NOT an atomic compare-and-delete and is not claimed to
   * be one. It does not need to be: with automatic reclamation gone, nothing in this store can
   * replace my lock while I hold it, so the file I read is the file I remove. The token check
   * is a DEFENCE against interference from outside the store — a maintenance script, a person —
   * and in that case the safe answer is to leave the file alone.
   *
   * ⛔ WHEN IN DOUBT, LEAVE IT. An orphan lock makes Wisdom unavailable until someone looks at
   * it. Deleting a lock that might be somebody else's breaks mutual exclusion. Those are not
   * comparable costs.
   */
  function releaseLock (token) {
    const info = readLockInfo()
    if (!info || info.token !== token) return false
    try { fs.unlinkSync(lockFile) } catch (_) {}
    return true
  }

  /**
   * A defensive re-check immediately before writing.
   *
   * ⛔ THIS IS NOT THE FOUNDATION OF EXCLUSIVITY AND MUST NOT BE DESCRIBED AS ONE. The gap
   * between this check and the write is not atomic. Exclusivity comes from the exclusive
   * creation of the lock plus the absence of any reclamation path. This only catches the case
   * where something OUTSIDE this store interfered mid-write, and turns it into a refusal.
   */
  function assertStillOwner (token) {
    const info = readLockInfo()
    if (!info || info.token !== token) {
      throw new Error('wisdom store lock was lost before commit — refusing to write')
    }
  }

  /** Every mutation is one exclusive read-modify-write. No caller may skip it. */
  function withLock (fn) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const token = acquireLock()
    try { return fn(token) } finally { releaseLock(token) }
  }

  /* ── write ─────────────────────────────────────────────────────────── */

  function renameWithRetry (from, to) {
    const deadline = Date.now() + RENAME_RETRY_MS
    for (;;) {
      try { fs.renameSync(from, to); return } catch (err) {
        // Windows can refuse a rename while a reader still holds the file. Bounded, deliberately.
        if (Date.now() >= deadline) throw err
        sleepSync(10)
      }
    }
  }

  /**
   * ⛔ TEMP → fsync → ATOMIC RENAME. A reader sees the complete old document or the complete
   * new one, never a half. fsync happens BEFORE the rename so a power cut cannot leave a
   * renamed-but-empty file — which would look exactly like 「nothing was ever learned」.
   */
  function save (db) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.tmp-' + process.pid + '-' + Math.random().toString(16).slice(2, 10)
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeSync(fd, JSON.stringify(db, null, 2))
      fs.fsyncSync(fd)
    } finally { fs.closeSync(fd) }
    renameWithRetry(tmp, file)
  }

  function sweepStaleTemps () {
    const prefix = path.basename(file) + '.tmp-'
    let entries
    try { entries = fs.readdirSync(path.dirname(file)) } catch (_) { return }
    for (const name of entries) {
      if (!name.startsWith(prefix)) continue
      const p = path.join(path.dirname(file), name)
      try { if (Date.now() - fs.statSync(p).mtimeMs > TMP_SWEEP_MS) fs.unlinkSync(p) } catch (_) {}
    }
  }

  /**
   * ⛔ EVENTS CARRY IDS AND STATES, NEVER LESSON TEXT. An event log that quotes the lesson is a
   * second, unredacted copy of it with no lifecycle of its own — superseding a lesson would
   * leave its words sitting in the ledger forever.
   */
  function pushEvent (db, type, fields) {
    db.events.push(Object.assign({ type, at: clock() }, fields))
  }

  const findLesson = (db, id) => db.lessons.find((l) => l && l.id === id) || null

  /* ── API ───────────────────────────────────────────────────────────── */

  function createCandidate (input = {}) {
    const lesson = C.buildCandidate(input, { clock })
    return withLock((token) => {
      const db = load()
      sweepStaleTemps()
      db.lessons.push(lesson)
      pushEvent(db, C.EVENT.CANDIDATE_CREATED, { lessonId: lesson.id, state: lesson.validation.state, createdBy: lesson.provenance.createdBy })
      // ⛔ THE LAST THING BEFORE THE WRITE: am I still the owner?
      assertStillOwner(token)
      save(db)
      return JSON.parse(JSON.stringify(lesson))
    })
  }

  const getLesson = (id) => { const l = findLesson(load(), id); return l ? JSON.parse(JSON.stringify(l)) : null }

  function listLessons (filter = {}) {
    const state = filter && filter.state
    if (state != null) C.fromEnum(state, C.STATES, 'state')
    const all = load().lessons.filter((l) => l && (state == null || l.validation.state === state))
    return JSON.parse(JSON.stringify(all))
  }

  /** One judged transition, with the authority gate and the transition table both applied. */
  function judge (id, input, targetState, eventType, mutate) {
    const judgement = C.buildJudgement(input)
    return withLock((token) => {
      const db = load()
      const lesson = findLesson(db, id)
      if (!lesson) throw new C.WisdomContractError('unknown lesson: ' + id, 'NOT_FOUND')
      C.assertTransition(lesson.validation.state, targetState)
      if (mutate) mutate(db, lesson, judgement)
      lesson.validation.state = targetState
      lesson.validation.authority = judgement.authority
      lesson.validation.reason = judgement.reason
      lesson.validation.evidenceRefs = judgement.evidenceRefs
      if (targetState === C.STATE.VALIDATED) lesson.validation.validatedAt = clock()
      pushEvent(db, eventType, { lessonId: lesson.id, state: targetState, authority: judgement.authority })
      // ⛔ THE LAST THING BEFORE THE WRITE: am I still the owner?
      assertStillOwner(token)
      save(db)
      return JSON.parse(JSON.stringify(lesson))
    })
  }

  const validateLesson = (id, input = {}) => judge(id, input, C.STATE.VALIDATED, C.EVENT.VALIDATED)
  const rejectLesson = (id, input = {}) => judge(id, input, C.STATE.REJECTED, C.EVENT.REJECTED)

  /**
   * ⛔ SUPERSESSION REPLACES, IT DOES NOT DELETE. The old lesson stays, marked, pointing at the
   * one that replaced it — so 「why did 香香 stop believing that?」 has an answer.
   */
  function supersedeLesson (id, input = {}) {
    const replacementId = C.boundedId(input && input.supersededBy, 'supersededBy')
    return judge(id, input, C.STATE.SUPERSEDED, C.EVENT.SUPERSEDED, (db, lesson) => {
      if (replacementId === lesson.id) throw new C.WisdomContractError('a lesson cannot supersede itself', 'BAD_REPLACEMENT')
      const replacement = findLesson(db, replacementId)
      if (!replacement) throw new C.WisdomContractError('unknown replacement lesson: ' + replacementId, 'NOT_FOUND')
      // ⛔ A CANDIDATE MAY NOT RETIRE A BELIEF. Otherwise an unvalidated proposal could remove
      // a validated one and nothing would be believed in its place.
      if (replacement.validation.state !== C.STATE.VALIDATED) {
        throw new C.WisdomContractError('replacement lesson must be validated, not ' + replacement.validation.state, 'BAD_REPLACEMENT')
      }
      lesson.validation.supersededBy = replacementId
    })
  }

  /* ── application / outcome ledger ──────────────────────────────────── */

  /**
   * ⛔ ONLY A VALIDATED LESSON MAY BE APPLIED. Recording that a candidate was 「used」 would mean
   * something already acted on an unvalidated belief, and the ledger would be evidence of the
   * exact thing W0 exists to prevent.
   */
  function recordApplication (input = {}) {
    const lessonId = C.boundedId(input.lessonId, 'lessonId')
    const contextRef = C.normaliseRefs(input.contextRef == null ? [] : [input.contextRef], 'contextRef')[0] || null
    return withLock((token) => {
      const db = load()
      const lesson = findLesson(db, lessonId)
      if (!lesson) throw new C.WisdomContractError('unknown lesson: ' + lessonId, 'NOT_FOUND')
      if (lesson.validation.state !== C.STATE.VALIDATED) {
        throw new C.WisdomContractError('only a validated lesson may be applied (state: ' + lesson.validation.state + ')', 'NOT_VALIDATED')
      }
      const record = {
        schemaVersion: C.SCHEMA_VERSION,
        id: C.newId('app'),
        lessonId,
        contextRef,
        // The state AT APPLICATION, so a later supersession cannot rewrite what was believed
        // at the moment it was used.
        lessonStateAtApplication: lesson.validation.state,
        appliedAt: clock(),
        outcome: null,
        outcomeEvidenceRef: null,
        note: null,
        redactedKinds: [],
        outcomeRecordedAt: null
      }
      db.applications.push(record)
      pushEvent(db, C.EVENT.APPLIED, { lessonId, applicationId: record.id })
      // ⛔ THE LAST THING BEFORE THE WRITE: am I still the owner?
      assertStillOwner(token)
      save(db)
      return JSON.parse(JSON.stringify(record))
    })
  }

  /**
   * ⛔ THE OUTCOME IS RECORDED AND NOTHING IS RECALCULATED.
   * W0 deliberately does NOT move `confidence` when an application helped or hurt. One lucky
   * success is not a rule and one bad day is not a refutation; turning outcomes into belief is
   * the validation engine's job (W4), with its own Owner GO.
   */
  function recordApplicationOutcome (input = {}) {
    const applicationId = C.boundedId(input.applicationId, 'applicationId')
    const outcome = C.fromEnum(input.outcome, C.APPLICATION_OUTCOMES, 'outcome')
    const evidenceRef = C.normaliseRefs(input.evidenceRef == null ? [] : [input.evidenceRef], 'evidenceRef')[0] || null
    const noteText = C.boundedText(input.note, MAX_APPLICATION_NOTE, 'note', { required: false })
    const { redact } = require('../lab/redaction')
    const redacted = noteText == null ? { text: null, hits: [] } : redact(noteText)

    return withLock((token) => {
      const db = load()
      const record = db.applications.find((a) => a && a.id === applicationId)
      if (!record) throw new C.WisdomContractError('unknown application: ' + applicationId, 'NOT_FOUND')
      if (record.outcome != null) throw new C.WisdomContractError('application outcome already recorded', 'ALREADY_RECORDED')
      record.outcome = outcome
      record.outcomeEvidenceRef = evidenceRef
      record.note = redacted.text
      record.redactedKinds = [...new Set(redacted.hits)].sort()
      record.outcomeRecordedAt = clock()
      pushEvent(db, C.EVENT.APPLICATION_OUTCOME, { lessonId: record.lessonId, applicationId, outcome })
      // ⛔ THE LAST THING BEFORE THE WRITE: am I still the owner?
      assertStillOwner(token)
      save(db)
      return JSON.parse(JSON.stringify(record))
    })
  }

  const listApplications = () => JSON.parse(JSON.stringify(load().applications))
  const listEvents = () => JSON.parse(JSON.stringify(load().events))

  return {
    file,
    dir: path.dirname(file),
    durabilityStatus: DURABILITY_STATUS,
    createCandidate,
    getLesson,
    listLessons,
    validateLesson,
    rejectLesson,
    supersedeLesson,
    recordApplication,
    recordApplicationOutcome,
    listApplications,
    listEvents
  }
}

module.exports = { createWisdomStore, DURABILITY_STATUS, emptyDb, assertPersistedShape, unreadable }
