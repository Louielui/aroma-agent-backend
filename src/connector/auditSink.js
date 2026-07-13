'use strict'

/**
 * auditSink.js — Phase 2 Gate 1 (MCP connector). The append-only audit CONTRACT
 * (Option 2). This is the pure, unit-testable core: it stamps authoritative
 * fields, enforces fail-closed durability, sanitizes detail, and gates reads to
 * the auditor identity. The physical separate-identity service, the sealed-segment
 * / fsync storage, and the #3/#4/#5 channel bindings land in a later slice — this
 * module is the seam they conform to.
 *
 * Invariants:
 *   - The sink STAMPS seq (monotonic), ts (from the injected clock), and
 *     sourceIdentity (from the authenticated channel). Any seq/ts/sourceIdentity in
 *     the caller payload is IGNORED (anti-forgery).
 *   - Durable-or-throw: append returns ok ONLY after writer.appendDurable confirms
 *     durability. On failure it raises AuditUnavailableError so the caller DENYs the
 *     operation and never claims success.
 *   - onHealth is best-effort; if it throws, that is surfaced on the raised error
 *     but NEVER swallowed into a silent pass — fail-closed is always the append throw.
 *   - detail is sanitized with the SAME prohibited patterns as connectorSafeSummary,
 *     so a sensitive value can never leak into the audit trail.
 *   - Reads require the auditor identity (#5); the writer identities (#3/#4) cannot read.
 */

const { PROHIBITED_PATTERNS } = require('./connectorSafeSummary')

const EVENT_TYPES = new Set([
  'ACCESS_AUDIT', 'INVOCATION', 'WRITE_ATTEMPT_DENIED', 'SUPPRESSION', 'ERROR', 'POLICY_CHANGE', 'HEALTH_ALERT'
])
const OUTCOMES = new Set(['ALLOW', 'DENY', 'SUPPRESSED', 'ERROR'])

class AuditUnavailableError extends Error {
  constructor (message, opts = {}) {
    super(message)
    this.name = 'AuditUnavailableError'
    if (opts.cause !== undefined) this.cause = opts.cause
    if (opts.healthError !== undefined) this.healthError = opts.healthError
  }
}

/** Deep-redact any string value matching a prohibited pattern. Returns {value, redacted}. */
function sanitizeDetail (value, depth) {
  if (depth > 5 || value == null) return { value, redacted: false }
  if (typeof value === 'string') {
    for (const re of PROHIBITED_PATTERNS) if (re.test(value)) return { value: '[REDACTED]', redacted: true }
    return { value, redacted: false }
  }
  if (Array.isArray(value)) {
    let red = false
    const out = value.map(v => { const r = sanitizeDetail(v, depth + 1); red = red || r.redacted; return r.value })
    return { value: out, redacted: red }
  }
  if (typeof value === 'object') {
    let red = false
    const out = {}
    for (const k of Object.keys(value)) { const r = sanitizeDetail(value[k], depth + 1); red = red || r.redacted; out[k] = r.value }
    return { value: out, redacted: red }
  }
  return { value, redacted: false }
}

/**
 * @param {{ writer: { appendDurable: (record:object)=>void }, clock: ()=>string,
 *   onHealth?: (info:object)=>void, seqStart?: number, auditorIdentity?: string }} options
 * @returns {{ append: function, read: function }}
 */
function createAuditSink (options = {}) {
  const { writer, clock, onHealth, seqStart, auditorIdentity } = options
  if (!writer || typeof writer.appendDurable !== 'function') throw new TypeError('createAuditSink requires writer.appendDurable')
  if (typeof clock !== 'function') throw new TypeError('createAuditSink requires an injected clock')
  const emitHealth = typeof onHealth === 'function' ? onHealth : () => {}

  let seq = Number.isInteger(seqStart) ? seqStart : 0
  const records = [] // contract-level mirror; real read binds to #5 + durable storage later

  function append (entry = {}) {
    const authenticatedIdentity = entry.authenticatedIdentity
    if (typeof authenticatedIdentity !== 'string' || authenticatedIdentity === '') {
      throw new TypeError('append requires authenticatedIdentity (from the authenticated channel)')
    }
    if (!EVENT_TYPES.has(entry.eventType)) throw new TypeError('append: invalid eventType')
    if (!OUTCOMES.has(entry.outcome)) throw new TypeError('append: invalid outcome')
    if (typeof entry.correlationId !== 'string' || entry.correlationId === '') throw new TypeError('append requires correlationId')

    const san = sanitizeDetail(entry.detail == null ? null : entry.detail, 0)
    const nextSeq = seq + 1

    // Authoritative stamping — payload seq/ts/sourceIdentity are NOT read (anti-forgery).
    const record = {
      seq: nextSeq,
      ts: clock(),
      sourceIdentity: authenticatedIdentity,
      eventType: entry.eventType,
      correlationId: entry.correlationId,
      principal: typeof entry.principal === 'string' ? entry.principal : null,
      app: typeof entry.app === 'string' ? entry.app : null,
      outcome: entry.outcome,
      detail: san.value
    }
    if (san.redacted) {
      record.detailRedacted = true
      record.anomaly = 'detail contained prohibited content; redacted'
    }

    try {
      writer.appendDurable(record) // returns only after fsync/durable
    } catch (werr) {
      let healthError
      try {
        emitHealth({ kind: 'AUDIT_UNAVAILABLE', seqAttempt: nextSeq, error: werr && werr.message ? werr.message : String(werr) })
      } catch (herr) {
        healthError = herr // best-effort; surfaced below, never swallowed into success
      }
      throw new AuditUnavailableError('audit append not durable — DENY the operation', { cause: werr, healthError })
    }

    seq = nextSeq
    records.push(record)
    return { ok: true, seq: nextSeq, ts: record.ts }
  }

  function read (query = {}) {
    const { readerIdentity, filter } = query
    if (typeof auditorIdentity !== 'string' || auditorIdentity === '' || readerIdentity !== auditorIdentity) {
      const err = new Error('audit read denied — auditor identity required')
      err.code = 'READ_DENIED'
      throw err
    }
    let out = records.slice()
    if (filter && typeof filter === 'object') {
      if (filter.correlationId) out = out.filter(r => r.correlationId === filter.correlationId)
      if (filter.eventType) out = out.filter(r => r.eventType === filter.eventType)
    }
    return out
  }

  return { append, read }
}

module.exports = { createAuditSink, AuditUnavailableError, EVENT_TYPES, OUTCOMES }
