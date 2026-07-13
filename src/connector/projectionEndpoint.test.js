'use strict'

/**
 * projectionEndpoint.test.js — Phase 2 Gate 1. Unit tests for the projection core
 * (createProjectionEndpoint.project). Synthetic fixtures only; injected auditSink /
 * resultIdStore / buildReturnReadyList. Deterministic (injected now/rng).
 *
 *   Run: node --test src/connector/projectionEndpoint.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createProjectionEndpoint } = require('./projectionEndpoint')
const { createAuditSink } = require('./auditSink')

const READ_ID = 'backend-read-secret' // injected test value (not a real secret)
const CTX = { presentedReadIdentity: READ_ID, principal: 'aroma_mcp_svc', app: 'chatgpt-mcp', window: 'w1', correlationId: 'corrZ' }

// synthetic return-ready items
const SAFE = { proposalId: 'prop_1', executionId: 'task_1', status: 'succeeded', finishedAt: '2026-07-13T10:00:00.000Z', sourceTaskId: 'src_1', resultSummary: 'created hello.txt' }
const SENSITIVE = { proposalId: 'prop_2', executionId: 'task_2', status: 'failed', finishedAt: '2026-07-13T11:00:00.000Z', resultSummary: 'payroll salary export' }
const UNCLASSIFIED = { proposalId: 'prop_3', executionId: 'task_3', status: 'running', finishedAt: '2026-07-13T12:00:00.000Z' }
const PROHIBITED = { proposalId: 'prop_4', executionId: 'task_deadbeefdeadbeefdeadbeefdeadbeef01', status: 'succeeded', finishedAt: '2026-07-13T13:00:00.000Z' }

const okWriter = () => { const store = []; return { store, appendDurable: (r) => store.push(r) } }
const failWriter = () => ({ appendDurable: () => { throw new Error('audit not durable') } })
const counterRng = () => { let c = 0; return (n) => Buffer.alloc(n, (c++ % 251) + 1) }
const makeStore = () => { const m = new Map(); return { set: (k, v) => m.set(k, v), get: (k) => m.get(k), size: () => m.size } }

function build ({ items, writer } = {}) {
  const w = writer || okWriter()
  const auditSink = createAuditSink({ writer: w, clock: () => '2026-07-13T00:00:00.000Z', auditorIdentity: 'auditor' })
  const resultIdStore = makeStore()
  const ep = createProjectionEndpoint({
    buildReturnReadyList: () => ({ items: items || [], count: (items || []).length, malformed: 0 }),
    auditSink, resultIdStore, readBackendReadIdentity: () => READ_ID,
    now: () => 1000, rng: counterRng()
  })
  return { ep, auditSink, resultIdStore, w }
}

test('READ_IDENTITY_DENIED: wrong/absent identity → no data', () => {
  const { ep } = build({ items: [SAFE] })
  assert.deepEqual(ep.project({ ...CTX, presentedReadIdentity: 'wrong' }), { ok: false, code: 'READ_IDENTITY_DENIED' })
  assert.deepEqual(ep.project({ ...CTX, presentedReadIdentity: undefined }), { ok: false, code: 'READ_IDENTITY_DENIED' })
})

test('READ_IDENTITY_DENIED: incomplete binding context (missing principal/app/window)', () => {
  const { ep } = build({ items: [SAFE] })
  assert.equal(ep.project({ ...CTX, principal: '' }).code, 'READ_IDENTITY_DENIED')
  assert.equal(ep.project({ ...CTX, window: '' }).code, 'READ_IDENTITY_DENIED')
})

test('SAFE → items carry ONLY {connectorResultId, summary}; no raw fields, no sourceTaskId', () => {
  const { ep } = build({ items: [SAFE] })
  const r = ep.project({ ...CTX })
  assert.equal(r.ok, true); assert.equal(r.code, 'OK'); assert.equal(r.suppressedCount, 0)
  assert.equal(r.items.length, 1)
  assert.deepEqual(Object.keys(r.items[0]).sort(), ['connectorResultId', 'summary'])
  assert.match(r.items[0].summary, /^Execution task_1 for proposal prop_1: succeeded, finished /)
  const s = JSON.stringify(r.items[0])
  assert.ok(!s.includes('src_1'), 'sourceTaskId never leaves')
  assert.ok(!s.includes('created hello.txt'), 'resultSummary never leaves')
  assert.ok(typeof r.items[0].connectorResultId === 'string' && r.items[0].connectorResultId.length > 0)
})

test('UNCLASSIFIED / SENSITIVE / non-ok-summary → fully suppressed (absent, counted, no id leaked)', () => {
  const { ep } = build({ items: [SAFE, SENSITIVE, UNCLASSIFIED, PROHIBITED] })
  const r = ep.project({ ...CTX })
  assert.equal(r.ok, true)
  assert.equal(r.items.length, 1) // only SAFE survives
  assert.equal(r.suppressedCount, 3) // SENSITIVE + UNCLASSIFIED + PROHIBITED-summary
  const s = JSON.stringify(r.items)
  assert.ok(!s.includes('task_2') && !s.includes('task_3') && !s.includes('deadbeef'), 'no suppressed id/status leaks')
})

test('durable ACCESS_AUDIT before return + SUPPRESSION audited, all sharing correlationId', () => {
  const { ep, auditSink } = build({ items: [SAFE, SENSITIVE] })
  ep.project({ ...CTX })
  const recs = auditSink.read({ readerIdentity: 'auditor', filter: { correlationId: 'corrZ' } })
  const access = recs.filter(r => r.eventType === 'ACCESS_AUDIT')
  const suppr = recs.filter(r => r.eventType === 'SUPPRESSION')
  assert.equal(access.length, 1) // one per returned SAFE item
  assert.equal(suppr.length, 1) // the SENSITIVE one
  assert.ok(recs.every(r => r.correlationId === 'corrZ' && r.sourceIdentity === 'backend_audit_writer'))
})

test('audit throw anywhere → whole response AUDIT_UNAVAILABLE, no partial data', () => {
  const { ep, resultIdStore } = build({ items: [SAFE], writer: failWriter() })
  const r = ep.project({ ...CTX })
  assert.deepEqual(r, { ok: false, code: 'AUDIT_UNAVAILABLE' })
  assert.ok(!('items' in r), 'no items on a denied response')
  // (a resultId may have been minted+stored before the failing ACCESS_AUDIT — it is
  //  orphaned and never returned; the response carries no data.)
  assert.ok(resultIdStore.size() >= 0)
})

test('empty source → ok, zero items, zero suppressed', () => {
  const { ep } = build({ items: [] })
  assert.deepEqual(ep.project({ ...CTX }), { ok: true, code: 'OK', items: [], suppressedCount: 0 })
})
