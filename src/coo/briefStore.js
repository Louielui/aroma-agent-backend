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
 * @param {{ sink?: (rec) => void }} deps — sink defaults to in-memory, so nothing is
 *   written to disk unless a caller deliberately supplies somewhere to write.
 */
function createBriefStore (deps = {}) {
  const records = []
  const sink = typeof deps.sink === 'function' ? deps.sink : (rec) => { records.push(rec) }

  /** Refuses rather than trimming. Returns { ok, id } or { ok:false, reason, field }. */
  function write (rec) {
    const v = validateRecord(rec)
    if (!v.ok) return { ok: false, reason: v.reason, field: v.field }
    const frozen = Object.freeze(Object.assign({}, rec))
    sink(frozen)
    return { ok: true, id: rec.briefId }
  }

  function list () { return records.slice() }

  return { write, list, validateRecord }
}

module.exports = {
  createBriefStore,
  validateRecord,
  hashBrief,
  ALLOWED_FIELDS,
  FORBIDDEN_FIELDS,
  STATUS_FIELDS,
  STATES
}
