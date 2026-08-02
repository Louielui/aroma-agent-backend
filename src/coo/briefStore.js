'use strict'

/**
 * briefStore.js — audit metadata for a Morning Briefing, and NOTHING ELSE.
 *
 * ── WHY THIS IS A GUARD AND NOT A CONVENTION ──────────────────────────────
 * The brief's body quotes Gmail subjects, Calendar summaries, Drive filenames and GitHub
 * titles. Those are third-party content — often other people's names and words — and the
 * Owner's ruling is that they exist for the duration of one response and are never
 * persisted. A comment saying "don't store the body" is worth nothing the first time a
 * caller passes the whole object by mistake, which is the normal way this goes wrong.
 *
 * So persistence is CLOSED, not open: an allowlist of exactly the permitted keys, a
 * redundant denylist of the forbidden ones, and a recursive scan that rejects a record
 * carrying a nested object at all. A record that fails is REFUSED — not trimmed, not
 * sanitised — because silently accepting a reduced version of a wrong write teaches the
 * caller that the wrong write worked.
 *
 * The brief text itself is represented ONLY by contentHash, which proves that a given
 * brief was produced without retaining a word of what it said.
 */

const crypto = require('node:crypto')

/** Exactly what a stored record may contain. Anything else is a bug or a leak. */
const ALLOWED_FIELDS = Object.freeze([
  'briefId', 'generatedAt', 'schemaVersion', 'provider', 'model',
  'sourceStatuses', 'itemCounts', 'durationMs', 'contentHash', 'outcome'
])

/**
 * Redundant with the allowlist, and deliberately so. If someone widens ALLOWED_FIELDS
 * one day, these names still cannot get through.
 */
const FORBIDDEN_FIELDS = Object.freeze([
  'brief', 'sections', 'items', 'text', 'body', 'content', 'snippet', 'subject',
  'from', 'to', 'title', 'summary', 'description', 'fileName', 'name', 'link',
  'provenance', 'block', 'message', 'raw', 'html'
])

/** sourceStatuses rows: enums and counts only — no error strings, which can quote content. */
const STATUS_FIELDS = Object.freeze(['source', 'state', 'count'])
const STATES = Object.freeze(['live', 'live_zero', 'unavailable'])

function isPlainObject (v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

/** Hash the brief body so its existence is provable and its content is not kept. */
function hashBrief (brief) {
  return crypto.createHash('sha256').update(JSON.stringify(brief), 'utf8').digest('hex')
}

/**
 * Validate a candidate record. Returns { ok: true } or { ok: false, reason, field }.
 * Pure — callers can use it as a guard without writing anything.
 */
function validateRecord (rec) {
  if (!isPlainObject(rec)) return { ok: false, reason: 'record must be an object', field: null }

  for (const k of Object.keys(rec)) {
    if (FORBIDDEN_FIELDS.includes(k)) return { ok: false, reason: 'forbidden field', field: k }
    if (!ALLOWED_FIELDS.includes(k)) return { ok: false, reason: 'field not on the allowlist', field: k }
  }
  for (const k of ['briefId', 'generatedAt', 'contentHash', 'outcome']) {
    if (typeof rec[k] !== 'string' || rec[k] === '') return { ok: false, reason: 'missing required field', field: k }
  }
  if (!/^[0-9a-f]{64}$/.test(rec.contentHash)) return { ok: false, reason: 'contentHash must be a sha256 hex digest', field: 'contentHash' }

  // sourceStatuses: a fixed row shape, so a whole result can never ride in on it.
  if (rec.sourceStatuses !== undefined) {
    if (!Array.isArray(rec.sourceStatuses)) return { ok: false, reason: 'sourceStatuses must be an array', field: 'sourceStatuses' }
    for (const row of rec.sourceStatuses) {
      if (!isPlainObject(row)) return { ok: false, reason: 'sourceStatuses row must be an object', field: 'sourceStatuses' }
      for (const k of Object.keys(row)) {
        if (!STATUS_FIELDS.includes(k)) return { ok: false, reason: 'sourceStatuses row field not allowed: ' + k, field: 'sourceStatuses' }
      }
      if (!STATES.includes(row.state)) return { ok: false, reason: 'unknown source state', field: 'sourceStatuses' }
      if (typeof row.source !== 'string') return { ok: false, reason: 'source must be a string', field: 'sourceStatuses' }
      if (!Number.isFinite(row.count)) return { ok: false, reason: 'count must be a number', field: 'sourceStatuses' }
    }
  }

  // itemCounts: numbers only.
  if (rec.itemCounts !== undefined) {
    if (!isPlainObject(rec.itemCounts)) return { ok: false, reason: 'itemCounts must be an object', field: 'itemCounts' }
    for (const [k, v] of Object.entries(rec.itemCounts)) {
      if (!Number.isFinite(v)) return { ok: false, reason: 'itemCounts.' + k + ' must be a number', field: 'itemCounts' }
    }
  }

  // Catch-all: no free-form nesting anywhere else. Text hides in objects.
  for (const [k, v] of Object.entries(rec)) {
    if (k === 'sourceStatuses' || k === 'itemCounts') continue
    if (isPlainObject(v) || Array.isArray(v)) return { ok: false, reason: 'nested structures are not storable', field: k }
  }

  return { ok: true }
}

/**
 * WHERE THE AUDIT LIVES.
 *
 * The first version defaulted to an in-memory array, so every record died with the
 * process — an audit that a restart erases is not an audit. It is now an append-only
 * JSONL file under a directory with its OWN ACL, provisioned by
 * scripts/coo/provision-brief-audit.ps1 on the same model the conversation archive uses:
 * inheritance broken, and exactly SYSTEM + Administrators + the Owner account.
 * AromaOperator is deliberately absent — the Computer Operator account has no business
 * reading what the Owner was briefed about.
 *
 * Records are metadata only, so even a reader who has access learns counts and hashes,
 * never content.
 */
const DEFAULT_AUDIT_DIR = 'C:\\Aroma\\BriefAudit'
const AUDIT_FILE = 'brief-audit.jsonl'

/**
 * WHY THE RUNTIME DOES NOT CREATE THIS DIRECTORY.
 *
 * The first version called mkdirSync. A directory created at runtime inherits its parent's
 * ACL, so the audit store would have quietly existed with whatever `C:\Aroma` grants —
 * which includes accounts that must never read it. The protection would have looked
 * present (there is a provisioner, it is documented) while being absent in fact, and
 * nothing would have said so.
 *
 * Provisioning is therefore a DEPLOYMENT PREREQUISITE, and the runtime's job is to refuse
 * when it has not been met. `scripts/coo/provision-brief-audit.ps1` is run once, elevated,
 * by the Owner.
 */
const PROVISION_FAILURE = Object.freeze({
  MISSING: 'audit_dir_not_provisioned',
  ACL_UNREADABLE: 'audit_acl_unreadable',
  INHERITED: 'audit_acl_inheritance_not_broken',
  NO_SYSTEM: 'audit_acl_missing_system',
  NO_ADMINS: 'audit_acl_missing_administrators',
  NO_OWNER: 'audit_acl_missing_owner',
  OPERATOR_PRESENT: 'audit_acl_operator_present',
  WRITE_FAILED: 'audit_write_failed'
})

/** AromaOperator. Matched by SID, because a display name can be anything. */
const OPERATOR_SID = 'S-1-5-21-2042659270-2029498691-2127769412-1009'

/**
 * Verify the directory is provisioned as the ACL model requires. Read-only; it never
 * creates, never repairs. Returns { ok } or { ok:false, reason } with a fixed enum.
 */
function verifyAuditDir (dir, deps = {}) {
  const fs = deps.fs || require('node:fs')
  const run = deps.icacls || defaultIcacls

  if (!fs.existsSync(dir)) return { ok: false, reason: PROVISION_FAILURE.MISSING }

  let out
  try { out = run(dir) } catch (_) { return { ok: false, reason: PROVISION_FAILURE.ACL_UNREADABLE } }
  if (typeof out !== 'string' || out.trim() === '') return { ok: false, reason: PROVISION_FAILURE.ACL_UNREADABLE }

  // `(I)` marks an INHERITED ace. The provisioner breaks inheritance without copying, so
  // a single inherited entry means it has not run — or something re-enabled inheritance.
  if (/\(I\)/.test(out)) return { ok: false, reason: PROVISION_FAILURE.INHERITED }

  if (/\bS-1-5-21-\d+-\d+-\d+-\d+\b/.test(out) && out.includes(OPERATOR_SID)) {
    return { ok: false, reason: PROVISION_FAILURE.OPERATOR_PRESENT }
  }
  if (/AromaOperator/i.test(out)) return { ok: false, reason: PROVISION_FAILURE.OPERATOR_PRESENT }

  if (!/NT AUTHORITY\\SYSTEM|\bSYSTEM:/i.test(out)) return { ok: false, reason: PROVISION_FAILURE.NO_SYSTEM }
  if (!/BUILTIN\\Administrators|\bAdministrators:/i.test(out)) return { ok: false, reason: PROVISION_FAILURE.NO_ADMINS }

  // THE OWNER: a principal that is neither of the two machine ones.
  //
  // icacls prints `<path> PRINCIPAL:(FLAGS)` on the first line and `    PRINCIPAL:(FLAGS)`
  // on the rest, and a principal may contain a backslash and a space ("NT AUTHORITY\
  // SYSTEM"). So each line is taken up to its `:(`, the leading path is dropped from the
  // first, and what remains is the name. Counting entries would not do — an ACL of SYSTEM
  // + Administrators + Everyone has three and no human on it.
  const MACHINE = /^(NT AUTHORITY\\SYSTEM|BUILTIN\\Administrators|CREATOR OWNER|Everyone|BUILTIN\\Users|NT AUTHORITY\\Authenticated Users)$/i
  const principals = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^(.*?):\([^)]*\)/.exec(line.trim())
    if (!m) continue
    let name = m[1].trim()
    // Drop the directory path that precedes the principal on the first line.
    const idx = name.search(/\s(?=[^\s]*(\\|$))/)
    if (name.toLowerCase().startsWith(String(dir).toLowerCase())) name = name.slice(String(dir).length).trim()
    else if (idx > 0 && /^[A-Za-z]:\\/.test(name)) name = name.slice(idx).trim()
    if (name) principals.push(name)
  }
  if (!principals.some((p) => !MACHINE.test(p))) return { ok: false, reason: PROVISION_FAILURE.NO_OWNER }

  return { ok: true }
}

function defaultIcacls (dir) {
  const { execFileSync } = require('node:child_process')
  return execFileSync('icacls', [dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * Append one line, durably. NEVER creates the directory: an unprovisioned store refuses.
 * Throws on any write failure so the caller can report `stored:false` without guessing.
 */
function createFileSink (dir) {
  const fs = require('node:fs')
  const path = require('node:path')
  const file = path.join(dir, AUDIT_FILE)
  return (rec) => {
    // fsync the DATA. An audit line that is only in the page cache is not on disk, and
    // the crash that loses it is exactly the event you would want the record of.
    const fd = fs.openSync(file, 'a')
    try {
      fs.writeSync(fd, JSON.stringify(rec) + '\n')
      fs.fsyncSync(fd)
    } finally { fs.closeSync(fd) }
  }
}

function readAll (dir) {
  const fs = require('node:fs')
  const path = require('node:path')
  const file = path.join(dir, AUDIT_FILE)
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
}

/**
 * @param {{ sink?: (rec) => void, dir?: string, persist?: boolean }} deps
 *
 * PERSISTENCE IS OPT-IN, and that is not a style choice. The first version defaulted to
 * writing, so `createBriefStore()` with no arguments appended to a hard-coded absolute
 * path — and three existing tests, which had every reason to think they were using a
 * throwaway store, wrote records into the real audit file. An audit is evidence; a
 * default that lets anything write to it by omission is the wrong way round.
 *
 * Production wiring says `{ persist: true }` explicitly. Anything that has not thought
 * about it gets memory. A `dir` is honoured only together with persist.
 */
function createBriefStore (deps = {}) {
  const records = []
  const dir = deps.dir || DEFAULT_AUDIT_DIR
  const persist = deps.persist === true || (deps.persist !== false && typeof deps.dir === 'string')
  const verify = deps.verifyAuditDir || ((d) => verifyAuditDir(d, deps))
  const sink = typeof deps.sink === 'function'
    ? deps.sink
    : (persist ? createFileSink(dir) : (rec) => { records.push(rec) })

  /**
   * Refuses rather than trimming. Returns { ok, id } or { ok:false, reason, field }.
   *
   * A STORAGE FAILURE IS NEVER THE OWNER'S PROBLEM. Provisioning is checked before the
   * first write and a write error is caught, so a missing directory, a wrong ACL, a full
   * disk or a failed fsync all become `stored:false` with a fixed reason — and the brief,
   * which has already passed delivery validation, still reaches the Owner. The audit
   * exists to record what happened; refusing to answer because it could not be recorded
   * would trade the thing the Owner asked for against the note about it.
   */
  function write (rec) {
    const v = validateRecord(rec)
    if (!v.ok) return { ok: false, reason: v.reason, field: v.field }

    if (persist) {
      const p = verify(dir)
      if (!p.ok) return { ok: false, reason: p.reason, field: null }
    }

    const frozen = Object.freeze(Object.assign({}, rec))
    try {
      sink(frozen)
    } catch (_) {
      // The message is deliberately not kept: it is an fs error carrying a full path.
      return { ok: false, reason: PROVISION_FAILURE.WRITE_FAILED, field: null }
    }
    return { ok: true, id: rec.briefId }
  }

  /** Everything on record. Reads from disk when persisting, so a FRESH process sees it. */
  function list () {
    if (typeof deps.sink === 'function' || !persist) return records.slice()
    return readAll(dir)
  }

  return { write, list, validateRecord, dir, persist }
}

module.exports = {
  createBriefStore,
  validateRecord,
  hashBrief,
  createFileSink,
  verifyAuditDir,
  readAll,
  PROVISION_FAILURE,
  OPERATOR_SID,
  DEFAULT_AUDIT_DIR,
  AUDIT_FILE,
  ALLOWED_FIELDS,
  FORBIDDEN_FIELDS,
  STATUS_FIELDS,
  STATES
}
