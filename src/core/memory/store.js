'use strict'

/**
 * store — per-store append-only engine for the four memory stores.
 *
 * Truth = the append-only `records/` (content revisions) and `events/` (lifecycle
 * events) artifacts. `index.json` is a rebuildable PROJECTION/cache — never truth;
 * reads scan artifacts directly, so a crash after an artifact write but before the
 * index update loses nothing (rebuildIndex regenerates it).
 *
 * Every mutating op is append-only, lock-guarded, validated before any write,
 * atomic per-artifact, and read-back verified. No in-place edit, no delete.
 * No runtime/LLM/persona/intake/proposal coupling.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { MemoryError } = require('./errors')
const { isKnownStore, validateTransition, deriveState } = require('./lifecycle')
const { buildRevision, verifyRevision } = require('./envelope')
const { buildEvent, verifyEvent } = require('./events')
const { acquireLock, releaseLock } = require('./lock')
const { resolveActive, eventsForRevision } = require('./resolver')

// --- config (real use only; tests pass baseDir directly) --------------------
function resolveCoreDir () {
  const d = process.env.AROMA_CORE_DIR
  if (!d) throw new MemoryError('CONFIG_ERROR', 'AROMA_CORE_DIR is required (no default, never falls back to ./data or the repo)')
  if (!path.isAbsolute(d)) throw new MemoryError('CONFIG_ERROR', 'AROMA_CORE_DIR must be an absolute path')
  return d
}

// --- layout -----------------------------------------------------------------
function storeDir (baseDir, store) {
  if (!isKnownStore(store)) throw new MemoryError('VALIDATION_ERROR', `unknown store: ${store}`)
  return path.join(baseDir, store)
}
function recordsDir (baseDir, store, recordId) { return path.join(storeDir(baseDir, store), 'records', recordId) }
function eventsDir (baseDir, store, recordId) { return path.join(storeDir(baseDir, store), 'events', recordId) }
function ensureLayout (baseDir, store, recordId) {
  fs.mkdirSync(recordsDir(baseDir, store, recordId), { recursive: true })
  fs.mkdirSync(eventsDir(baseDir, store, recordId), { recursive: true })
}

// --- low-level atomic artifact write + read-back ----------------------------
function writeArtifactExclusive (finalPath, obj) {
  if (fs.existsSync(finalPath)) throw new MemoryError('DUPLICATE_ID', `artifact already exists: ${path.basename(finalPath)}`)
  const tmp = finalPath + '.tmp'
  let fd
  try { fd = fs.openSync(tmp, 'wx') } catch (e) { throw new MemoryError('READBACK_FAILED', 'temp artifact could not be created') }
  try { fs.writeFileSync(fd, JSON.stringify(obj), { encoding: 'utf8' }); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, finalPath)
}
function readJson (p) { return JSON.parse(fs.readFileSync(p, 'utf8')) }

// --- scanning (truth) -------------------------------------------------------
function listRecordIds (baseDir, store) {
  const dir = path.join(storeDir(baseDir, store), 'records')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory()).sort()
}

// Load revisions for a recordId; corrupt ones are isolated (flagged __unreadable).
function loadRevisions (baseDir, store, recordId) {
  const dir = recordsDir(baseDir, store, recordId)
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const revisionId = f.slice(0, -5)
    const p = path.join(dir, f)
    try { const rev = readJson(p); verifyRevision(rev); out.push(rev) } catch (e) { out.push({ __unreadable: true, revisionId, kind: 'revision' }) }
  }
  return out.sort((a, b) => (a.revision || 0) - (b.revision || 0))
}

// Load events for a recordId; corrupt ones are isolated (excluded from the log).
function loadEvents (baseDir, store, recordId) {
  const dir = eventsDir(baseDir, store, recordId)
  if (!fs.existsSync(dir)) return { events: [], corrupt: [] }
  const events = []; const corrupt = []
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const p = path.join(dir, f)
    try { const ev = readJson(p); verifyEvent(ev); events.push(ev) } catch (e) { corrupt.push(f.slice(0, -5)) }
  }
  events.sort((a, b) => a.sequence - b.sequence)
  return { events, corrupt }
}

function nextRevisionNumber (baseDir, store, recordId) {
  const revs = loadRevisions(baseDir, store, recordId)
  let max = 0
  for (const r of revs) if (!r.__unreadable && r.revision > max) max = r.revision
  return max + 1
}
function nextSequence (baseDir, store, recordId) {
  const { events } = loadEvents(baseDir, store, recordId)
  let max = 0
  for (const e of events) if (e.sequence > max) max = e.sequence
  return max + 1
}

// --- index projection (rebuildable cache; NOT truth) ------------------------
function buildIndexProjection (baseDir, store) {
  const idx = { store, generatedFromArtifacts: true, records: {} }
  for (const recordId of listRecordIds(baseDir, store)) {
    const revs = loadRevisions(baseDir, store, recordId)
    const { events, corrupt } = loadEvents(baseDir, store, recordId)
    idx.records[recordId] = {
      revisions: revs.map((r) => r.__unreadable ? { revisionId: r.revisionId, unreadable: true } : { revisionId: r.revisionId, revision: r.revision, contentHash: r.contentHash, supersedes: r.supersedes }),
      events: events.map((e) => ({ eventId: e.eventId, sequence: e.sequence, eventType: e.eventType, targetRevisionId: e.targetRevisionId, eventHash: e.eventHash })),
      corruptEvents: corrupt
    }
  }
  return idx
}
function rebuildIndex (baseDir, store) {
  const idx = buildIndexProjection(baseDir, store)
  const sdir = storeDir(baseDir, store)
  fs.mkdirSync(sdir, { recursive: true })
  const finalPath = path.join(sdir, 'index.json')
  const tmp = finalPath + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try { fs.writeFileSync(fd, JSON.stringify(idx, null, 2), { encoding: 'utf8' }); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, finalPath)
  return idx
}

// --- mutating ops (append-only, lock-guarded) -------------------------------
function createRevision (baseDir, store, input) {
  const sdir = storeDir(baseDir, store)
  fs.mkdirSync(sdir, { recursive: true })
  const lockId = acquireLock(sdir, { operation: 'createRevision', store })
  try {
    ensureLayout(baseDir, store, input.recordId)
    const revision = nextRevisionNumber(baseDir, store, input.recordId)
    const revisionId = input.revisionId || crypto.randomUUID()
    const rev = buildRevision({
      store, recordId: input.recordId, revisionId, revision,
      supersedes: input.supersedes != null ? input.supersedes : null,
      selectors: input.selectors, provenance: input.provenance, payload: input.payload,
      createdAtLabel: input.createdAtLabel
    })
    const finalPath = path.join(recordsDir(baseDir, store, input.recordId), `${revisionId}.json`)
    writeArtifactExclusive(finalPath, rev)
    // read-back verify
    const back = readJson(finalPath); verifyRevision(back)
    if (back.contentHash !== rev.contentHash) throw new MemoryError('READBACK_FAILED', 'revision read-back hash mismatch')
    rebuildIndex(baseDir, store)
    return rev
  } finally { releaseLock(sdir, lockId) }
}

function recordEvent (baseDir, store, input) {
  const sdir = storeDir(baseDir, store)
  fs.mkdirSync(sdir, { recursive: true })
  const lockId = acquireLock(sdir, { operation: 'recordEvent', store })
  try {
    // target revision must exist and be readable
    const revs = loadRevisions(baseDir, store, input.recordId)
    const target = revs.find((r) => r.revisionId === input.targetRevisionId)
    if (!target) throw new MemoryError('NOT_FOUND', 'target revision not found')
    if (target.__unreadable) throw new MemoryError('CORRUPT_RECORD', 'target revision is unreadable')
    const { events } = loadEvents(baseDir, store, input.recordId)
    const current = deriveState(store, eventsForRevision(events, input.targetRevisionId))
    // optimistic concurrency: caller's expected state must match the derived state
    if (input.expectedPreviousState !== current.state) throw new MemoryError('CONCURRENCY_CONFLICT', `expected ${input.expectedPreviousState} but current is ${current.state}`)
    // validate transition BEFORE writing anything (invalid -> no artifact)
    validateTransition(store, current, input.eventType)
    const sequence = nextSequence(baseDir, store, input.recordId)
    const eventId = input.eventId || crypto.randomUUID()
    const ev = buildEvent({
      store, recordId: input.recordId, targetRevisionId: input.targetRevisionId, eventId, sequence,
      eventType: input.eventType, actor: input.actor, approval: input.approval != null ? input.approval : null,
      rationale: input.rationale, expectedPreviousState: input.expectedPreviousState, timestampLabel: input.timestampLabel
    })
    const finalPath = path.join(eventsDir(baseDir, store, input.recordId), `${eventId}.json`)
    writeArtifactExclusive(finalPath, ev)
    const back = readJson(finalPath); verifyEvent(back)
    if (back.eventHash !== ev.eventHash) throw new MemoryError('READBACK_FAILED', 'event read-back hash mismatch')
    rebuildIndex(baseDir, store)
    return ev
  } finally { releaseLock(sdir, lockId) }
}

// --- read-only APIs ---------------------------------------------------------
function getRevision (baseDir, store, recordId, revisionId) {
  return loadRevisions(baseDir, store, recordId).find((r) => r.revisionId === revisionId) || null
}
function listRevisions (baseDir, store, recordId) { return loadRevisions(baseDir, store, recordId) }
function listEvents (baseDir, store, recordId) { return loadEvents(baseDir, store, recordId).events }
function getRecordState (baseDir, store, recordId, opts = {}) {
  const revs = loadRevisions(baseDir, store, recordId)
  const { events, corrupt } = loadEvents(baseDir, store, recordId)
  return { active: resolveActive(store, revs, events, opts), corruptEvents: corrupt, revisions: revs.length }
}
function resolveActiveRecord (baseDir, store, recordId, opts = {}) {
  const revs = loadRevisions(baseDir, store, recordId)
  const { events } = loadEvents(baseDir, store, recordId)
  return resolveActive(store, revs, events, opts)
}

// Governed query (NOT reasoning-time retrieval): deterministic filter + fixed limit.
function listRecords (baseDir, store, query = {}) {
  const limit = Number.isInteger(query.limit) && query.limit > 0 ? query.limit : 50
  const out = []
  for (const recordId of listRecordIds(baseDir, store)) {
    const active = resolveActiveRecord(baseDir, store, recordId, { asOf: query.asOf })
    if (query.onlyActive && active.status !== 'ACTIVE') continue
    let rev = null
    if (active.status === 'ACTIVE') rev = getRevision(baseDir, store, recordId, active.revisionId)
    if (rev) {
      if (query.category != null && rev.selectors.category !== query.category) continue
      if (query.project != null && rev.selectors.project !== query.project) continue
      if (query.tag != null && !rev.selectors.tags.includes(query.tag)) continue
    } else if (query.category != null || query.project != null || query.tag != null) {
      continue
    }
    out.push({ recordId, activeStatus: active.status, activeRevisionId: active.revisionId || null })
    if (out.length >= limit) break
  }
  return out
}

module.exports = {
  resolveCoreDir, storeDir, ensureLayout,
  createRevision, recordEvent, rebuildIndex, buildIndexProjection,
  getRevision, listRevisions, listEvents, getRecordState, resolveActiveRecord, listRecords,
  listRecordIds, loadRevisions, loadEvents
}
