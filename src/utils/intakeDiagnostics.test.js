'use strict'

/**
 * intakeDiagnostics.test.js — B2-2 Slice B (unit).
 *
 * Locks the safe-disclosure boundary: type-based classification, metadata-only
 * diagnostics (NEVER the raw text / err.message / stack), stable client contract,
 * fail-safe sink, and the rawHash governance rule.
 *
 *   Run: node --test src/utils/intakeDiagnostics.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { handleIntakeError, classify, rawMeta, SAFE_MESSAGES } = require('./intakeDiagnostics')
const { DistillParseError } = require('../intake/distillPrompt')
const { IntakeUpstreamError } = require('../intake/intakeErrors')

// --- classification by REAL type -------------------------------------------
test('classify: DistillParseError → invalid_llm_output (instanceof, not name)', () => {
  const err = new DistillParseError('invalid_json', { rawSample: 'not json' })
  const c = classify(err)
  assert.equal(c.code, 'invalid_llm_output')
  assert.equal(c.stage, 'distill_parse')
  assert.equal(c.reason, 'invalid_json')
})
test('classify: IntakeUpstreamError → llm_unavailable', () => {
  const c = classify(new IntakeUpstreamError({ correlationId: 'x' }))
  assert.equal(c.code, 'llm_unavailable')
  assert.equal(c.reason, null)
})
test('classify: unknown error → internal_error; a same-name impostor is NOT misread', () => {
  assert.equal(classify(new Error('boom')).code, 'internal_error')
  const impostor = new Error('boom'); impostor.name = 'DistillParseError' // name spoof
  assert.equal(classify(impostor).code, 'internal_error', 'instanceof must ignore the spoofed name')
})

// --- client contract (status / body / retryable) ---------------------------
test('handleIntakeError: status + stable safe body per code', () => {
  const parse = handleIntakeError(new DistillParseError('duplicate_keys', { rawSample: '{}' }), { correlationId: 'cid1' }, { sink () {} })
  assert.equal(parse.status, 500)
  assert.deepEqual(parse.body, { error: { code: 'invalid_llm_output', message: SAFE_MESSAGES.invalid_llm_output, correlationId: 'cid1', retryable: true } })

  const up = handleIntakeError(new IntakeUpstreamError({ correlationId: 'cid2' }), {}, { sink () {} })
  assert.equal(up.status, 503)
  assert.equal(up.body.error.code, 'llm_unavailable')
  assert.equal(up.body.error.retryable, true)

  const internal = handleIntakeError(new Error('x'), { correlationId: 'cid3' }, { sink () {} })
  assert.equal(internal.status, 500)
  assert.equal(internal.body.error.code, 'internal_error')
  assert.equal(internal.body.error.retryable, false)
})
test('client body never carries detail / raw / message / stack', () => {
  const err = new DistillParseError('invalid_json', { rawSample: 'RAWLEAKMARKER sk-ant-SECRETKEY123456' })
  const { body } = handleIntakeError(err, { correlationId: 'cid' }, { sink () {} })
  const s = JSON.stringify(body)
  assert.ok(!s.includes('RAWLEAKMARKER'))
  assert.ok(!s.includes('sk-ant-SECRETKEY123456'))
  assert.ok(!('detail' in body))
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'correlationId', 'message', 'retryable'])
})

// --- correlation id: prefer the id carried by the error --------------------
test('correlationId: error-carried id wins; ctx is fallback', () => {
  const err = new DistillParseError('invalid_json', {}); err.correlationId = 'from-error'
  assert.equal(handleIntakeError(err, { correlationId: 'from-ctx' }, { sink () {} }).body.error.correlationId, 'from-error')
  const bare = new Error('x') // no correlationId → ctx fallback
  assert.equal(handleIntakeError(bare, { correlationId: 'from-ctx' }, { sink () {} }).body.error.correlationId, 'from-ctx')
})

// --- metadata-only diagnostic ----------------------------------------------
test('diagnostic entry is metadata-only — no raw text, no err.message', () => {
  let entry
  const err = new DistillParseError('invalid_json', { rawSample: 'SUPER_SECRET_NATURAL_LANGUAGE 客戶資料' })
  handleIntakeError(err, { correlationId: 'cid', endpoint: '/api/v1/intake' }, { sink: (e) => { entry = e } })
  const s = JSON.stringify(entry)
  assert.ok(!s.includes('SUPER_SECRET_NATURAL_LANGUAGE'), 'raw text must not appear in the diagnostic')
  assert.ok(!s.includes('客戶資料'))
  assert.equal(entry.event, 'INTAKE_ERROR')
  assert.equal(entry.code, 'invalid_llm_output')
  assert.equal(entry.reason, 'invalid_json')
  assert.equal(entry.rawPresent, true)
  assert.equal(entry.rawLength, err.diagnostic.rawSample.length)
  assert.equal(typeof entry.rawHash, 'string')
  assert.ok(!('rawSample' in entry) && !('stackSample' in entry))
})

// --- rawMeta + rawHash governance ------------------------------------------
test('rawMeta: undefined/empty rawSample is safe (rawPresent=false, length 0, hash null, no throw)', () => {
  for (const v of [undefined, null, '']) {
    const m = rawMeta(v)
    assert.deepEqual(m, { rawPresent: false, rawLength: 0, redactionHit: false, rawHash: null })
  }
  // The concrete governance fixture: DistillParseError with NO diagnostic.rawSample.
  const err = new DistillParseError('invalid_json') // diagnostic defaults to {}
  assert.equal(err.diagnostic.rawSample, undefined)
  let entry
  const out = handleIntakeError(err, { correlationId: 'cid' }, { sink: (e) => { entry = e } })
  assert.equal(entry.rawPresent, false)
  assert.equal(entry.rawLength, 0)
  assert.equal(entry.rawHash, null)
  assert.equal(out.body.error.code, 'invalid_llm_output') // still classified + safe
})
test('rawMeta: present sample → deterministic 12-hex hash; redactionHit reflects secret shapes', () => {
  const a = rawMeta('hello world')
  assert.equal(a.rawPresent, true)
  assert.equal(a.rawLength, 11)
  assert.match(a.rawHash, /^[a-f0-9]{12}$/)
  assert.equal(a.rawHash, rawMeta('hello world').rawHash) // deterministic
  assert.equal(a.redactionHit, false)
  assert.equal(rawMeta('token=sk-ant-abcdef123456').redactionHit, true)
})

// --- fail-safe sink ---------------------------------------------------------
test('sink failure is swallowed — handleIntakeError still returns a safe response', () => {
  const err = new DistillParseError('invalid_json', { rawSample: '{' })
  let result
  assert.doesNotThrow(() => {
    result = handleIntakeError(err, { correlationId: 'cid' }, { sink () { throw new Error('sink down') } })
  })
  assert.equal(result.status, 500)
  assert.equal(result.body.error.correlationId, 'cid')
})

test('production never emits stackSample even with INTAKE_DEBUG_STACK=1', () => {
  const err = new Error('with stack'); err.stack = 'Error: with stack\n  at /secret/path'
  const saveFlag = process.env.INTAKE_DEBUG_STACK
  const saveEnv = process.env.NODE_ENV
  try {
    process.env.INTAKE_DEBUG_STACK = '1'
    process.env.NODE_ENV = 'production'
    let entry
    handleIntakeError(err, { correlationId: 'cid' }, { sink: (e) => { entry = e } })
    assert.ok(!('stackSample' in entry), 'production must never include stackSample')
  } finally {
    if (saveFlag === undefined) delete process.env.INTAKE_DEBUG_STACK; else process.env.INTAKE_DEBUG_STACK = saveFlag
    if (saveEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saveEnv
  }
})

test('one final correlationId is shared by client body, Error, and diagnostic entry', () => {
  const err = new DistillParseError('invalid_json', { rawSample: '{' }); err.correlationId = 'the-final-id'
  let entry
  const { body } = handleIntakeError(err, { correlationId: 'ignored-ctx' }, { sink: (e) => { entry = e } })
  assert.equal(err.correlationId, 'the-final-id')
  assert.equal(body.error.correlationId, 'the-final-id')
  assert.equal(entry.correlationId, 'the-final-id')
})

// --- debug-stack gating -----------------------------------------------------
test('stackSample: off by default; on only when flag set AND non-production', () => {
  const err = new Error('with stack'); err.stack = 'Error: with stack\n  at /secret/path sk-ant-XYZ123456'
  const saveFlag = process.env.INTAKE_DEBUG_STACK
  const saveEnv = process.env.NODE_ENV
  try {
    delete process.env.INTAKE_DEBUG_STACK
    let e1; handleIntakeError(err, { correlationId: 'c' }, { sink: (e) => { e1 = e } })
    assert.ok(!('stackSample' in e1), 'no stack by default')

    process.env.INTAKE_DEBUG_STACK = '1'; process.env.NODE_ENV = 'development'
    let e2; handleIntakeError(err, { correlationId: 'c' }, { sink: (e) => { e2 = e } })
    assert.ok('stackSample' in e2, 'stack present in non-prod debug')
    assert.ok(!e2.stackSample.includes('sk-ant-XYZ123456'), 'stack is redacted')

    process.env.NODE_ENV = 'production'
    let e3; handleIntakeError(err, { correlationId: 'c' }, { sink: (e) => { e3 = e } })
    assert.ok(!('stackSample' in e3), 'never in production even with the flag')
  } finally {
    if (saveFlag === undefined) delete process.env.INTAKE_DEBUG_STACK; else process.env.INTAKE_DEBUG_STACK = saveFlag
    if (saveEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saveEnv
  }
})
