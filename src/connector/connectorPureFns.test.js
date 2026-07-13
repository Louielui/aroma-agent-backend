'use strict'

/**
 * connectorPureFns.test.js — Phase 2 Gate 1. Unit tests for the three pure
 * connector functions: classificationPolicy, connectorSafeSummary,
 * connectorResultId. Deterministic (injected now/rng); no I/O, no network.
 *
 *   Run: node --test src/connector/connectorPureFns.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { classify, CLASSIFICATION_POLICY_VERSION, SAFE_FIELD_ALLOWLIST } = require('./classificationPolicy')
const { buildSafeSummary, MAX_SUMMARY_LEN, SUMMARY_TEMPLATE_VERSION } = require('./connectorSafeSummary')
const { mint, validate, DEFAULT_TTL_MS } = require('./connectorResultId')

const safeItem = (o = {}) => ({
  proposalId: 'prop_1', executionId: 'task_1', status: 'succeeded',
  finishedAt: '2026-07-13T10:00:00.000Z', sourceTaskId: 'srctask_1',
  resultSummary: 'created hello.txt', ...o
})

// ── classificationPolicy ─────────────────────────────────────────────────────
test('classify: terminal + no sensitive → SAFE_NON_SENSITIVE with the outward allowlist', () => {
  const r = classify(safeItem())
  assert.equal(r.classification, 'SAFE_NON_SENSITIVE')
  assert.equal(r.policyVersion, CLASSIFICATION_POLICY_VERSION)
  assert.deepEqual(r.allowedFields, ['proposalId', 'executionId', 'status', 'finishedAt'])
  assert.deepEqual(SAFE_FIELD_ALLOWLIST, ['proposalId', 'executionId', 'status', 'finishedAt'])
  assert.ok(!r.allowedFields.includes('sourceTaskId'), 'sourceTaskId is NOT outward-allowlisted (C-04)')
})

test('classify: non-terminal / missing field → UNCLASSIFIED, empty allowlist (fail-closed)', () => {
  assert.equal(classify(safeItem({ status: 'running' })).classification, 'UNCLASSIFIED')
  assert.equal(classify(safeItem({ proposalId: '' })).classification, 'UNCLASSIFIED')
  assert.equal(classify(null).classification, 'UNCLASSIFIED')
  assert.deepEqual(classify(safeItem({ status: 'running' })).allowedFields, [])
})

test('classify: sensitive marker anywhere → SENSITIVE (authoritative; ignores external safe-claim)', () => {
  assert.equal(classify(safeItem({ resultSummary: 'updated payroll for salary run' })).classification, 'SENSITIVE')
  assert.equal(classify(safeItem({ error: 'HUB_TOKEN missing' })).classification, 'SENSITIVE')
  // an external "isSafe" claim must NOT flip a sensitive item to safe
  assert.equal(classify(safeItem({ isSafe: true, resultSummary: 'bank invoice export' })).classification, 'SENSITIVE')
})

test('classify: deterministic (same input → same output)', () => {
  assert.deepEqual(classify(safeItem()), classify(safeItem()))
})

// ── connectorSafeSummary ─────────────────────────────────────────────────────
const ALLOW = ['proposalId', 'executionId', 'status', 'finishedAt']

test('buildSafeSummary: SAFE item + full allowlist → OK, deterministic fixed template', () => {
  const r = buildSafeSummary(safeItem(), { allowedFields: ALLOW })
  assert.equal(r.ok, true); assert.equal(r.code, 'OK'); assert.equal(r.templateVersion, SUMMARY_TEMPLATE_VERSION)
  assert.equal(r.summary, 'Execution task_1 for proposal prop_1: succeeded, finished 2026-07-13T10:00:00.000Z')
  assert.deepEqual(buildSafeSummary(safeItem(), { allowedFields: ALLOW }), r) // deterministic, no LLM
})

test('buildSafeSummary: a template field not in allowlist → NOT_SAFE (withheld)', () => {
  const r = buildSafeSummary(safeItem(), { allowedFields: ['proposalId', 'executionId', 'finishedAt'] }) // missing 'status'
  assert.equal(r.ok, false); assert.equal(r.code, 'NOT_SAFE'); assert.equal(r.summary, null)
})

test('buildSafeSummary: missing/invalid field value → MISSING_FIELD', () => {
  const r = buildSafeSummary(safeItem({ finishedAt: '' }), { allowedFields: ALLOW })
  assert.equal(r.code, 'MISSING_FIELD'); assert.equal(r.summary, null)
})

test('buildSafeSummary: over-length → OVERLENGTH, suppressed (NO truncation)', () => {
  const r = buildSafeSummary(safeItem(), { allowedFields: ALLOW, maxLength: 10 })
  assert.equal(r.code, 'OVERLENGTH'); assert.equal(r.summary, null)
})

test('buildSafeSummary: prohibited content in a rendered field → PROHIBITED_CONTENT, withheld', () => {
  const r = buildSafeSummary(safeItem({ executionId: 'task_deadbeefdeadbeefdeadbeefdeadbeef01' }), { allowedFields: ALLOW })
  assert.equal(r.code, 'PROHIBITED_CONTENT'); assert.equal(r.summary, null)
})

// ── connectorResultId ────────────────────────────────────────────────────────
const CTX = { principal: 'aroma_mcp_svc', app: 'chatgpt-mcp', window: 'w1', egressPolicyVersion: 'egr-1', classificationPolicyVersion: 'clf-1' }
const fixedRng = (n) => Buffer.alloc(n, 7)

test('mint: opaque id + full six-element binding + TTL default 300000', () => {
  const { id, record } = mint({ ...CTX, now: 1000, rng: fixedRng })
  assert.equal(typeof id, 'string'); assert.ok(id.length > 0)
  assert.equal(record.principal, 'aroma_mcp_svc'); assert.equal(record.app, 'chatgpt-mcp'); assert.equal(record.window, 'w1')
  assert.equal(record.egressPolicyVersion, 'egr-1'); assert.equal(record.classificationPolicyVersion, 'clf-1')
  assert.equal(record.issuedAt, 1000); assert.equal(record.expiresAt, 1000 + DEFAULT_TTL_MS)
  assert.equal(DEFAULT_TTL_MS, 300000)
  // deterministic id under injected rng
  assert.equal(mint({ ...CTX, now: 1000, rng: fixedRng }).id, id)
})

test('mint: missing binding or now → throws (fail-closed)', () => {
  assert.throws(() => mint({ ...CTX, now: 1000, principal: '' , rng: fixedRng }))
  assert.throws(() => mint({ ...CTX, rng: fixedRng })) // no now
})

test('validate: matching context within TTL → valid OK', () => {
  const { id, record } = mint({ ...CTX, now: 1000, rng: fixedRng })
  assert.deepEqual(validate({ id, record, ...CTX, now: 2000 }), { valid: true, code: 'OK' })
})

test('validate: expired → EXPIRED', () => {
  const { id, record } = mint({ ...CTX, now: 1000, ttlMs: 500, rng: fixedRng })
  assert.deepEqual(validate({ id, record, ...CTX, now: 1600 }), { valid: false, code: 'EXPIRED' })
})

test('validate: principal / app / window mismatch → specific code', () => {
  const { id, record } = mint({ ...CTX, now: 1000, rng: fixedRng })
  assert.equal(validate({ id, record, ...CTX, principal: 'someone', now: 1500 }).code, 'PRINCIPAL_MISMATCH')
  assert.equal(validate({ id, record, ...CTX, app: 'other', now: 1500 }).code, 'APP_MISMATCH')
  assert.equal(validate({ id, record, ...CTX, window: 'w2', now: 1500 }).code, 'WINDOW_MISMATCH')
})

test('validate: policy-version change → POLICY_VERSION_CHANGED (T-13 handle reuse invalid)', () => {
  const { id, record } = mint({ ...CTX, now: 1000, rng: fixedRng })
  assert.equal(validate({ id, record, ...CTX, classificationPolicyVersion: 'clf-2', now: 1500 }).code, 'POLICY_VERSION_CHANGED')
  assert.equal(validate({ id, record, ...CTX, egressPolicyVersion: 'egr-2', now: 1500 }).code, 'POLICY_VERSION_CHANGED')
})

test('validate: wrong id → ID_MISMATCH', () => {
  const { record } = mint({ ...CTX, now: 1000, rng: fixedRng })
  assert.equal(validate({ id: 'not-the-id', record, ...CTX, now: 1500 }).code, 'ID_MISMATCH')
})
