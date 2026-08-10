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
const { resolveDataDir } = require('../store/dataDir')
const C = require('./wisdomContract')

/** ⛔ AN HONEST LABEL, CARRIED IN CODE so a future reader cannot miss it. */
const DURABILITY_STATUS = 'UNVERIFIED'

const LOCK_STALE_MS = 10000
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

function pidAlive (pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return !!(e && e.code === 'EPERM') }
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
      if (err && err.code === 'ENOENT') return emptyDb()
      throw err
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
   * ⛔ AN IDENTIFIABLE LIVE HOLDER IS NEVER BROKEN — NOT EVEN AN OLD ONE.
   *
   * The first version read `if (!holderDead && ageMs <= LOCK_STALE_MS) return false`, which
   * says the opposite of what its own comment claimed: a LIVE writer whose lock had simply
   * aged past the window was deleted out from under it. Two processes then hold the lock at
   * once and the whole read-modify-write guarantee is gone — quietly, because both writes
   * appear to succeed and only one survives.
   *
   * Age is a FALLBACK for the case where nobody can be identified, never a verdict on someone
   * who can be. The three cases are disjoint and exhaustive:
   *
   *   A. valid PID, ALIVE   → never break. A slow writer keeps its lock however long it takes.
   *   B. valid PID, DEAD    → break immediately. A crashed holder must not block anybody.
   *   C. no usable PID      → age only. Break after LOCK_STALE_MS, because there is nobody to ask.
   *
   * A waiter is still bounded by `lockTimeoutMs`, so 「never break a live lock」 can never mean
   * 「wait forever」.
   */
  function breakLockIfStale () {
    let ageMs
    try { ageMs = Date.now() - fs.statSync(lockFile).mtimeMs } catch (_) { return false }

    let info = null
    try { info = JSON.parse(fs.readFileSync(lockFile, 'utf8')) } catch (_) { info = null }
    const holderPid = (info && Number.isInteger(info.pid) && info.pid > 0) ? info.pid : null

    if (holderPid !== null) {
      // A. identified and alive — the lock is legitimately held, whatever its age.
      if (pidAlive(holderPid)) return false
      // B. identified and dead.
      try { fs.unlinkSync(lockFile) } catch (_) { /* someone else broke it first */ }
      return true
    }

    // C. unidentifiable holder: empty, truncated, or without a usable pid. Age is all there is.
    if (ageMs <= LOCK_STALE_MS) return false
    try { fs.unlinkSync(lockFile) } catch (_) {}
    return true
  }

  function acquireLock () {
    const deadline = Date.now() + lockTimeoutMs
    for (;;) {
      try {
        // `wx` is the whole mechanism: atomic create-or-fail, cross-process.
        const fd = fs.openSync(lockFile, 'wx')
        try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })) } finally { fs.closeSync(fd) }
        return
      } catch (err) {
        if (!err || err.code !== 'EEXIST') throw err
        if (breakLockIfStale()) continue
        if (Date.now() >= deadline) throw new Error('wisdom store is busy (lock timeout)')
        sleepSync(15)
      }
    }
  }

  const releaseLock = () => { try { fs.unlinkSync(lockFile) } catch (_) {} }

  /** Every mutation is one locked read-modify-write. No caller may skip it. */
  function withLock (fn) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    acquireLock()
    try { return fn() } finally { releaseLock() }
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
    return withLock(() => {
      const db = load()
      sweepStaleTemps()
      db.lessons.push(lesson)
      pushEvent(db, C.EVENT.CANDIDATE_CREATED, { lessonId: lesson.id, state: lesson.validation.state, createdBy: lesson.provenance.createdBy })
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
    return withLock(() => {
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
    return withLock(() => {
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

    return withLock(() => {
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

module.exports = { createWisdomStore, DURABILITY_STATUS, emptyDb, assertPersistedShape, LOCK_STALE_MS }
