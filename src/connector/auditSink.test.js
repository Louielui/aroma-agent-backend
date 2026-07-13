'use strict'

/**
 * auditSink.test.js — Phase 2 Gate 1. Unit tests for the append-only audit
 * contract (createAuditSink). Deterministic (injected writer/clock/onHealth).
 *
 *   Run: node --test src/connector/auditSink.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAuditSink, AuditUnavailableError } = require('./auditSink')

const okWriter = () => { const store = []; return { store, appendDurable: (r) => store.push(r) } }
const failWriter = (msg = 'not durable') => ({ appendDurable: () => { throw new Error(msg) } })
const fixedClock = () => '2026-07-13T00:00:00.000Z'
const base = (o = {}) => ({ authenticatedIdentity: 'backend_audit_writer', eventType: 'ACCESS_AUDIT', correlationId: 'corr_1', principal: 'aroma_mcp_svc', app: 'chatgpt-mcp', outcome: 'ALLOW', ...o })

test('sink STAMPS seq/ts/sourceIdentity — payload attempts to set them are ignored', () => {
  const w = okWriter()
  const sink = createAuditSink({ writer: w, clock: fixedClock, seqStart: 0, auditorIdentity: 'auditor' })
  const r = sink.append(base({ seq: 999, ts: 'HACK', sourceIdentity: 'FAKE' }))
  assert.deepEqual(r, { ok: true, seq: 1, ts: '2026-07-13T00:00:00.000Z' })
  const rec = w.store[0]
  assert.equal(rec.seq, 1)                                  // not 999
  assert.equal(rec.ts, '2026-07-13T00:00:00.000Z')         // not 'HACK'
  assert.equal(rec.sourceIdentity, 'backend_audit_writer') // not 'FAKE'
})

test('monotonic seq across successful appends', () => {
  const w = okWriter()
  const sink = createAuditSink({ writer: w, clock: fixedClock, auditorIdentity: 'auditor' })
  assert.equal(sink.append(base()).seq, 1)
  assert.equal(sink.append(base()).seq, 2)
  assert.equal(sink.append(base()).seq, 3)
})

test('durable-or-throw: writer failure → AuditUnavailableError, NO record, onHealth fired', () => {
  const health = []
  const sink = createAuditSink({ writer: failWriter('disk full'), clock: fixedClock, onHealth: (x) => health.push(x), auditorIdentity: 'auditor' })
  assert.throws(() => sink.append(base()), (e) => {
    assert.ok(e instanceof AuditUnavailableError)
    assert.equal(e.cause.message, 'disk full')
    return true
  })
  assert.equal(health.length, 1)
  assert.equal(health[0].kind, 'AUDIT_UNAVAILABLE')
})

test('onHealth that itself throws is NOT swallowed — append still throws (fail-closed)', () => {
  const sink = createAuditSink({
    writer: failWriter(), clock: fixedClock,
    onHealth: () => { throw new Error('pager down') },
    auditorIdentity: 'auditor'
  })
  assert.throws(() => sink.append(base()), (e) => {
    assert.ok(e instanceof AuditUnavailableError)          // still fail-closed
    assert.equal(e.healthError.message, 'pager down')       // surfaced, not swallowed
    return true
  })
})

test('correlation chaining: backend ACCESS_AUDIT + mcp INVOCATION share correlationId', () => {
  const w = okWriter()
  const sink = createAuditSink({ writer: w, clock: fixedClock, auditorIdentity: 'auditor' })
  sink.append(base({ authenticatedIdentity: 'backend_audit_writer', eventType: 'ACCESS_AUDIT', correlationId: 'corrX' }))
  sink.append(base({ authenticatedIdentity: 'mcp_audit_writer', eventType: 'INVOCATION', correlationId: 'corrX' }))
  const chained = sink.read({ readerIdentity: 'auditor', filter: { correlationId: 'corrX' } })
  assert.equal(chained.length, 2)
  assert.deepEqual(chained.map(r => r.sourceIdentity).sort(), ['backend_audit_writer', 'mcp_audit_writer'])
})

test('read requires the auditor identity — writer identities are denied', () => {
  const sink = createAuditSink({ writer: okWriter(), clock: fixedClock, auditorIdentity: 'auditor' })
  sink.append(base())
  assert.deepEqual(sink.read({ readerIdentity: 'auditor' }).length, 1)
  assert.throws(() => sink.read({ readerIdentity: 'mcp_audit_writer' }), (e) => e.code === 'READ_DENIED')
  assert.throws(() => sink.read({ readerIdentity: 'backend_audit_writer' }), (e) => e.code === 'READ_DENIED')
})

test('WRITE_ATTEMPT_DENIED event is recorded (T-15)', () => {
  const w = okWriter()
  const sink = createAuditSink({ writer: w, clock: fixedClock, auditorIdentity: 'auditor' })
  const r = sink.append(base({ authenticatedIdentity: 'mcp_audit_writer', eventType: 'WRITE_ATTEMPT_DENIED', outcome: 'DENY' }))
  assert.equal(r.ok, true)
  assert.equal(w.store[0].eventType, 'WRITE_ATTEMPT_DENIED')
  assert.equal(w.store[0].outcome, 'DENY')
})

test('POLICY_CHANGE is an accepted governance-auditable event type', () => {
  const w = okWriter()
  const sink = createAuditSink({ writer: w, clock: fixedClock, auditorIdentity: 'auditor' })
  const r = sink.append(base({ eventType: 'POLICY_CHANGE', outcome: 'ALLOW', detail: { policy: 'retention', from: '30d', to: '90d' } }))
  assert.equal(r.ok, true)
  assert.equal(w.store[0].eventType, 'POLICY_CHANGE')
})

test('detail prohibited content is redacted (still appended) — sensitive value cannot leak via audit', () => {
  const w = okWriter()
  const sink = createAuditSink({ writer: w, clock: fixedClock, auditorIdentity: 'auditor' })
  sink.append(base({ detail: { note: 'ok', leak: 'HUB_TOKEN=abc123', hex: 'deadbeefdeadbeefdeadbeefdeadbeef01', keep: 42 } }))
  const rec = w.store[0]
  assert.equal(rec.detail.note, 'ok')
  assert.equal(rec.detail.keep, 42)
  assert.equal(rec.detail.leak, '[REDACTED]')
  assert.equal(rec.detail.hex, '[REDACTED]')
  assert.equal(rec.detailRedacted, true)
  assert.match(rec.anomaly, /prohibited content/)
})

test('invalid eventType / outcome / missing fields → throw (fail-closed, malformed rejected)', () => {
  const sink = createAuditSink({ writer: okWriter(), clock: fixedClock, auditorIdentity: 'auditor' })
  assert.throws(() => sink.append(base({ eventType: 'NOPE' })))
  assert.throws(() => sink.append(base({ outcome: 'MAYBE' })))
  assert.throws(() => sink.append(base({ authenticatedIdentity: '' })))
  assert.throws(() => sink.append(base({ correlationId: '' })))
})
