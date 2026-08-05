'use strict'

/**
 * store.js — Aroma truth store (M1).
 *
 * Faithful JS implementation of Wall-E's DB-003 contract (Decision / Task /
 * Event / llm-usage), backed by a JSON file so data survives restarts without
 * any native module (better-sqlite3 needs a Windows build; this does not).
 *
 * When Aroma moves to Docker, Wall-E's TypeScript+SQLite hub can replace this
 * with the SAME contract — no caller changes (Principle 4: capability, not vendor).
 */

const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

// ONE resolver for all four stores — see store/dataDir.js (backlog M-3).
const { resolveDataDir } = require('./dataDir')
const DATA_DIR = resolveDataDir()
const DATA_FILE = path.join(DATA_DIR, 'aroma-truth.json')

const LOCK_FILE = DATA_FILE + '.lock'

// Overridable so a test can run in milliseconds instead of seconds, and so an operator can
// widen them without editing code. The defaults are the contract; the env is an escape hatch.
const envMs = (name, fallback) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}
/** How long a lock may be held before it is assumed abandoned. A write takes microseconds. */
const LOCK_STALE_MS = envMs('AROMA_STORE_LOCK_STALE_MS', 10000)
/** How long a writer waits before refusing. Refusing beats writing over someone else. */
const LOCK_TIMEOUT_MS = envMs('AROMA_STORE_LOCK_TIMEOUT_MS', 5000)
/** Windows can refuse a rename while a reader still holds the file. Bounded, deliberately. */
const RENAME_RETRY_MS = envMs('AROMA_STORE_RENAME_RETRY_MS', 500)
/** A killed writer cannot delete its own temp file; the next successful write sweeps it. */
const TMP_SWEEP_MS = envMs('AROMA_STORE_TMP_SWEEP_MS', 60000)

const emptyDb = () => ({ decisions: [], tasks: [], events: [], llm_usage: [], dispatches: [] })

/** A synchronous pause. The store's whole API is sync; a promise here would change it. */
function sleepSync (ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * LOAD — and the single most important line in this file is the one that is NOT here.
 *
 * This used to be `catch { return emptyDb() }`. On 2026-08-04 llm_usage measured
 * 29 → 125 → 32: a monotonically appending array LOST 93 records. The mechanism was not a
 * lost update. save() truncated-then-wrote, so a reader in another process could read a
 * partial document; JSON.parse threw; the catch answered "the store is empty"; the caller
 * pushed its one record and saved — and the erasure became permanent, as well-formed JSON
 * that passes every gate the backup pipeline has.
 *
 * An unknown answered as a fact. MISSING and UNREADABLE are different answers and this
 * function now gives different answers to them: absent is legitimately empty (first run),
 * anything else throws.
 */
function load () {
  let raw
  try {
    raw = fs.readFileSync(DATA_FILE, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return emptyDb()
    throw err
  }
  try {
    const db = JSON.parse(raw)
    if (!db || typeof db !== 'object' || Array.isArray(db)) throw new Error('not an object')
    return Object.assign(emptyDb(), db)
  } catch (err) {
    throw new Error('aroma-truth store is unreadable (' + ((err && err.message) || 'invalid') +
      ') — refusing to treat it as empty. The file was NOT modified.')
  }
}

/** Is that pid still running? EPERM means alive but not ours. */
function pidAlive (pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (err) { return !!err && err.code === 'EPERM' }
}

/**
 * A lock held by a DEAD process must not wedge the store forever — the honest failure mode
 * of a naive lock, and the reason this function exists. Breaking is itself racy, so the
 * breaker unlinks and then re-attempts an exclusive create: only one waiter can win it.
 */
function breakLockIfStale () {
  // AGE COMES FROM THE FILE, NOT FROM ITS CONTENTS — and that is the whole correction.
  //
  // The first version read the lock, and if it could not be parsed treated it as abandoned.
  // But `openSync(wx)` CREATES the file and only then writes into it, so there is a window
  // in which a perfectly live lock is a zero-byte file. A contender reading it in that
  // window parsed nothing, declared the holder abandoned, deleted a live lock, and two
  // processes wrote at once. The 6-process test measured it as 147 of 150 records.
  //
  // mtime is set at creation, so an empty lock is a NEW lock and is never stale.
  let ageMs = Infinity
  try { ageMs = Date.now() - fs.statSync(LOCK_FILE).mtimeMs } catch (_) { return false } // already gone

  let info = null
  try { info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) } catch (_) { info = null }

  // A holder we can identify and know to be dead is abandoned immediately. A holder we
  // cannot identify is only abandoned once it is older than the stale window.
  const holderDead = info && Number.isFinite(info.pid) && !pidAlive(info.pid)
  if (!holderDead && ageMs <= LOCK_STALE_MS) return false

  try { fs.unlinkSync(LOCK_FILE) } catch (_) { /* someone else broke it first */ }
  return true
}

function acquireLock () {
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx')       // atomic create — the whole mechanism
      try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() })) } finally { fs.closeSync(fd) }
      return
    } catch (err) {
      // EEXIST is the ordinary "someone holds it". EPERM/EACCES are what Windows returns
      // when the file is being created or deleted at the same instant — a contended lock,
      // not a permissions problem, and rethrowing it crashed a writer under real load.
      const contended = err && (err.code === 'EEXIST' || err.code === 'EPERM' || err.code === 'EACCES')
      if (!contended) throw err
      if (breakLockIfStale()) continue
      if (Date.now() >= deadline) {
        // REFUSE. A write that cannot be serialised must fail loudly; proceeding anyway is
        // how one process overwrites another's records with its own stale snapshot.
        throw new Error('aroma-truth store is locked by another process — refusing to write')
      }
      sleepSync(5)
    }
  }
}

function releaseLock () {
  try { fs.unlinkSync(LOCK_FILE) } catch (_) {}
}

/** Every read-modify-write goes through here, so two processes can never interleave one. */
function withLock (fn) {
  acquireLock()
  try { return fn() } finally { releaseLock() }
}

function renameWithRetry (from, to) {
  const deadline = Date.now() + RENAME_RETRY_MS
  for (;;) {
    try { fs.renameSync(from, to); return } catch (err) {
      const transient = err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES')
      if (!transient || Date.now() >= deadline) { try { fs.unlinkSync(from) } catch (_) {} ; throw err }
      sleepSync(5)
    }
  }
}

/**
 * SAVE — temp file, fsync, atomic rename.
 *
 * writeFileSync truncates and then writes, so a reader in another process can see a partial
 * document. rename is atomic on NTFS and POSIX: a reader sees the complete old file or the
 * complete new one, never a half. fsync before the rename so a power loss cannot leave a
 * renamed-but-empty file.
 */
function save (db) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = DATA_FILE + '.tmp-' + process.pid + '-' + Math.random().toString(16).slice(2, 10)
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(db, null, 2))
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  renameWithRetry(tmp, DATA_FILE)
  sweepStaleTemps()
}

/**
 * A process killed mid-write leaves its temp file behind — it cannot clean up after itself,
 * and that debris is harmless (it is never the live file; the name carries a pid and a
 * random suffix) but it should not accumulate forever. The next successful write sweeps
 * anything older than the sweep window, which is far beyond any real write.
 */
function sweepStaleTemps () {
  const prefix = path.basename(DATA_FILE) + '.tmp-'
  let names
  try { names = fs.readdirSync(DATA_DIR) } catch (_) { return }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue
    const p = path.join(DATA_DIR, name)
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > TMP_SWEEP_MS) fs.unlinkSync(p)
    } catch (_) { /* someone else swept it, or it is still in use */ }
  }
}

/** Persist a distilled intake: Decision + Tasks + Events, atomically. */
function persistIntake ({ understanding, decision, tasks = [], provenance = {} }) {
  // SERIALISED ACROSS PROCESSES. load->mutate->save is one critical section;
  // without this two processes each save their own snapshot and one set of
  // records simply disappears, with no corruption anywhere to notice.
  return withLock(() => {
  const db = load()
  const now = new Date().toISOString()

  const decisionId = 'dec_' + uuidv4().slice(0, 8)
  const storedDecision = {
    id: decisionId,
    statement: decision?.statement || understanding || '',
    rationale: decision?.rationale || '',
    provenance: {
      proposed_by: provenance.proposed_by || 'louie',
      source: provenance.source || 'homepage-intake',
      approved_by: provenance.approved_by || null,
      decided_at: now
    },
    data_class: 'operational',
    status: 'active'
  }
  db.decisions.push(storedDecision)
  db.events.push({ id: 'evt_' + uuidv4().slice(0, 8), type: 'decision.created', entity_id: decisionId, actor: 'louie', at: now })

  const storedTasks = tasks.map((t) => {
    const taskId = 'task_' + uuidv4().slice(0, 8)
    const task = { id: taskId, title: t.title || '', note: t.note || '', decision_id: decisionId, state: 'todo', created_at: now }
    db.events.push({ id: 'evt_' + uuidv4().slice(0, 8), type: 'task.created', entity_id: taskId, actor: 'louie', at: now })
    return task
  })
  db.tasks.push(...storedTasks)

  save(db)
  return { decision_id: decisionId, task_ids: storedTasks.map((t) => t.id), decision: storedDecision, tasks: storedTasks }
  })
}

/** Record LLM usage — metrics ONLY. Any content/secret fields are dropped. */
function recordLLMUsage (metrics = {}) {
  // SERIALISED ACROSS PROCESSES. load->mutate->save is one critical section;
  // without this two processes each save their own snapshot and one set of
  // records simply disappears, with no corruption anywhere to notice.
  return withLock(() => {
  const db = load()
  db.llm_usage.push({
    id: 'usg_' + uuidv4().slice(0, 8),
    model: metrics.model || 'unknown',
    request_count: 1,
    latency_ms: metrics.latencyMs || 0,
    estimated_tokens: metrics.totalTokens || 0,
    blocked: !!metrics.blocked,
    at: new Date().toISOString()
    // message content / api key are intentionally never accepted here
  })
  save(db)
  return { ok: true }
  })
}

/**
 * ── APPROVAL LIFECYCLE EVENTS — durable, uncapped, in the stream that already exists ──
 *
 * WHY THEY MOVED HERE. `approvalAudit` in app.js is an in-memory array capped at 500 plus
 * one console.log line. The Owner's first principle is that operational truth is permanent
 * and conversations are temporary; approval decisions were on the wrong side of that line —
 * they survived only as long as a log file.
 *
 * What the rotation actually destroyed, as opposed to what could be reconstructed:
 *   RECONSTRUCTABLE  approved / cancelled — the proposal record carries status and who.
 *   GONE FOREVER     every REFUSED attempt. A bad nonce, a dead session, an expired order,
 *                    a displayed-hash mismatch — nothing else in this system records that
 *                    someone tried and was turned away.
 *
 * NOT A SECOND DECISION STORE, which was the Owner's explicit constraint: two records of
 * what was decided is how they start disagreeing. This adds TYPES to `events`, the stream
 * that already carries decision.created / task.created / dispatch.*. The proposal record
 * stays the only statement of a proposal's STATUS; these are the record of what HAPPENED.
 *
 * NO CAP. Owner ruling: a limit that silently drops the oldest decision contradicts the
 * thing the record exists for. The numbers make it easy — real approvals are a handful a
 * week, and even 100 proposals a week across seven types is roughly 7 MB a year.
 *
 * IDS AND SHORT ENUMS ONLY. Same discipline as the metrics writer beside it: no goal, no
 * file path, no reply, no token. The reason is bounded so a long provider string cannot
 * smuggle content in through a field meant for an enum.
 */
const APPROVAL_EVENT_TYPES = Object.freeze([
  'sealed', // a card was put in front of the Owner — 「I never saw it」 vs 「I saw it and did nothing」
  'approved',
  'rejected',
  'cancelled',
  'expired', // NEW EMISSION: nothing emitted this before; a TTL simply lapsed in silence
  'executed',
  'refused' // an attempt that was turned away — the class with no other record anywhere
])
const MAX_ENUM = 64

function recordApprovalEvent (input = {}) {
  const type = String(input.type || '')
  if (!APPROVAL_EVENT_TYPES.includes(type)) {
    // REFUSED, NOT WRITTEN. A typo'd type would create a category nothing queries and
    // nothing counts — a silent hole in the one record that exists to have no holes.
    return { ok: false, error: `unknown approval event type: ${type.slice(0, MAX_ENUM)}` }
  }
  const short = (v) => (typeof v === 'string' && v ? v.slice(0, MAX_ENUM) : null)

  // SERIALISED ACROSS PROCESSES, exactly as recordLLMUsage is. load->mutate->save is one
  // critical section; without the lock two writers each save their own snapshot and one
  // set of records disappears leaving no corruption anywhere to notice. That is the defect
  // this trail must not have — it matters more here than it did for metering.
  return withLock(() => {
    const db = load()
    db.events.push({
      id: 'evt_' + uuidv4().slice(0, 8),
      type: 'approval.' + type,
      entity_id: short(input.approvalId),
      actor: short(input.actor) || 'louie',
      at: new Date().toISOString(),
      approval_id: short(input.approvalId),
      proposal_id: short(input.proposalId),
      work_order_hash: short(input.workOrderHash),
      reason: short(input.reason),
      entry_point: short(input.entryPoint)
      // Deliberately absent: goal, file paths, replies, tokens. See the header.
    })
    save(db)
    return { ok: true }
  })
}

/** EVERY approval event, oldest first. Not a tail — see the no-cap note above. */
function listApprovalEvents () {
  return load().events.filter((e) => typeof e.type === 'string' && e.type.startsWith('approval.'))
}

function listDecisions () { return load().decisions }
function listTasks () { return load().tasks }

/**
 * Return one Task by id, or null. Back-compat: a Task persisted before the
 * bridge simply has no `proposalId` field (missing ⇒ not promoted).
 */
function getTask (taskId) {
  return (load().tasks || []).find(t => t.id === taskId) || null
}

/**
 * Bind a Task to its promoted Proposal — the B2-7 bridge's ONE Task-store write.
 * Additive and non-destructive: it sets `task.proposalId` and nothing else.
 * Throws if the Task is unknown so the bridge can fail-closed (linking_failed).
 * @returns {object} the updated Task
 */
function setTaskProposalId (taskId, proposalId) {
  // SERIALISED ACROSS PROCESSES. load->mutate->save is one critical section;
  // without this two processes each save their own snapshot and one set of
  // records simply disappears, with no corruption anywhere to notice.
  return withLock(() => {
  const db = load()
  const task = (db.tasks || []).find(t => t.id === taskId)
  if (!task) throw new Error(`unknown task: ${taskId}`)
  task.proposalId = proposalId
  save(db)
  return task
  })
}
function listEvents () { return load().events.slice(-50).reverse() }
function usageSummary () {
  const u = load().llm_usage
  return {
    request_count: u.length,
    estimated_tokens: u.reduce((s, x) => s + (x.estimated_tokens || 0), 0),
    by_model: u.reduce((m, x) => { m[x.model] = (m[x.model] || 0) + 1; return m }, {})
  }
}

// ---- Dispatch state machine persistence ----
function createDispatch (d) {
  // SERIALISED ACROSS PROCESSES. load->mutate->save is one critical section;
  // without this two processes each save their own snapshot and one set of
  // records simply disappears, with no corruption anywhere to notice.
  return withLock(() => {
  const db = load()
  if (!db.dispatches) db.dispatches = []
  const now = new Date().toISOString()
  const dispatch = {
    id: 'dsp_' + uuidv4().slice(0, 8),
    task_id: d.task_id,
    decision_id: d.decision_id || null,
    capability: d.capability || 'ops',
    worker_id: d.worker_id,
    worker_name: d.worker_name,
    worker_role: d.worker_role || null,
    status: d.status || 'queued',
    result: null,
    error: null,
    created_at: now,
    updated_at: now
  }
  db.dispatches.push(dispatch)
  db.events.push({ id: 'evt_' + uuidv4().slice(0, 8), type: 'dispatch.created', entity_id: dispatch.id, actor: 'aroma', at: now })
  save(db)
  return dispatch
  })
}

function updateDispatch (id, patch) {
  // SERIALISED ACROSS PROCESSES. load->mutate->save is one critical section;
  // without this two processes each save their own snapshot and one set of
  // records simply disappears, with no corruption anywhere to notice.
  return withLock(() => {
  const db = load()
  const d = (db.dispatches || []).find(x => x.id === id)
  if (!d) return null
  Object.assign(d, patch, { updated_at: new Date().toISOString() })
  if (patch.status) {
    db.events.push({ id: 'evt_' + uuidv4().slice(0, 8), type: 'dispatch.' + patch.status, entity_id: id, actor: 'aroma', at: new Date().toISOString() })
    // reflect terminal states on the task
    const task = (db.tasks || []).find(t => t.id === d.task_id)
    if (task) {
      if (patch.status === 'completed') task.state = 'done'
      else if (patch.status === 'running') task.state = 'in_progress'
    }
  }
  save(db)
  return d
  })
}

function listDispatches () { return (load().dispatches || []).slice().reverse() }
function getDispatch (id) { return (load().dispatches || []).find(x => x.id === id) || null }

module.exports = { persistIntake, recordLLMUsage, recordApprovalEvent, listApprovalEvents, APPROVAL_EVENT_TYPES, listDecisions, listTasks, getTask, setTaskProposalId, listEvents, usageSummary, createDispatch, updateDispatch, listDispatches, getDispatch }
