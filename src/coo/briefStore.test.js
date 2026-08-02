'use strict'

/**
 * briefStore.test.js — third-party content must not survive the response.
 *
 * The brief quotes other people's email subjects, calendar summaries and file names. The
 * Owner's ruling is that those exist for one response and are never persisted. This file
 * proves the store REFUSES them rather than trusting callers to leave them out — and the
 * positive controls prove the refusal is real and not a shape that accepts everything.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createBriefStore, validateRecord, hashBrief, ALLOWED_FIELDS, FORBIDDEN_FIELDS } = require('./briefStore')

const GOOD = Object.freeze({
  briefId: 'brf_abc123',
  generatedAt: '2026-08-02T14:00:00.000Z',
  schemaVersion: 1,
  provider: 'none',
  model: 'none',
  sourceStatuses: [{ source: 'gmail', state: 'live', count: 3 }],
  itemCounts: { today: 1, importantUpdates: 2 },
  durationMs: 1234,
  contentHash: 'a'.repeat(64),
  outcome: 'ok'
})

/* ── 1. the permitted record ──────────────────────────────────────────────── */

test('*** the audit-metadata record is accepted ***', () => {
  const store = createBriefStore()
  const r = store.write(Object.assign({}, GOOD))
  assert.equal(r.ok, true)
  assert.equal(store.list().length, 1)
})

test('*** contentHash proves the brief existed without keeping a word of it ***', () => {
  const brief = { sections: { today: [{ text: 'Dinner with SYNTHETIC-NAME-A at 19:00' }] } }
  const h = hashBrief(brief)
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.equal(h.includes('SYNTHETIC'), false, 'the digest carries no plaintext')
  assert.equal(hashBrief(brief), h, 'and it is stable')
})

/* ── 2. every forbidden third-party field, one at a time ──────────────────── */

test('*** Gmail From / Subject / snippet are REFUSED ***', () => {
  const store = createBriefStore()
  for (const [field, value] of [['from', 'someone@example.com'], ['subject', 'Invoice 1042'], ['snippet', 'Hi Chef, about the...']]) {
    const r = store.write(Object.assign({}, GOOD, { [field]: value }))
    assert.equal(r.ok, false, field + ' must be refused')
    assert.equal(r.field, field)
  }
  assert.equal(store.list().length, 0, 'and NOTHING was written — not even a trimmed version')
})

test('*** Calendar summary/description, Drive fileName, GitHub title are REFUSED ***', () => {
  const store = createBriefStore()
  for (const field of ['summary', 'description', 'fileName', 'title', 'name']) {
    const r = store.write(Object.assign({}, GOOD, { [field]: 'anything' }))
    assert.equal(r.ok, false, field + ' must be refused')
  }
  assert.equal(store.list().length, 0)
})

test('*** the brief BODY is refused, however it is wrapped ***', () => {
  const store = createBriefStore()
  for (const field of ['brief', 'sections', 'items', 'text', 'body', 'content', 'block']) {
    assert.equal(store.write(Object.assign({}, GOOD, { [field]: { a: 1 } })).ok, false, field)
  }
  assert.equal(store.list().length, 0)
})

test('*** a whole brief object passed by mistake is refused outright ***', () => {
  // The realistic accident: someone writes `store.write({ ...audit, brief })`.
  const store = createBriefStore()
  const r = store.write(Object.assign({}, GOOD, { brief: { sections: { today: [{ text: 'private' }] } } }))
  assert.equal(r.ok, false)
  assert.equal(r.field, 'brief')
  assert.equal(JSON.stringify(store.list()).includes('private'), false, 'no fragment leaked through')
})

test('*** any unknown field is refused, not ignored ***', () => {
  // Closed, not open: a field nobody thought of is refused BECAUSE nobody thought of it.
  const r = validateRecord(Object.assign({}, GOOD, { attendeeEmail: 'a@b.c' }))
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'field not on the allowlist')
})

test('*** free-form nesting is refused wherever it appears ***', () => {
  assert.equal(validateRecord(Object.assign({}, GOOD, { outcome: 'ok', provider: 'none', model: 'none', durationMs: 1, schemaVersion: 1, itemCounts: { a: 'text hiding here' } })).ok, false)
  const withArray = Object.assign({}, GOOD)
  delete withArray.sourceStatuses
  assert.equal(validateRecord(Object.assign({}, withArray, { provider: ['x'] })).ok, false, 'an array in a scalar slot is refused')
})

test('*** sourceStatuses may carry ONLY source/state/count ***', () => {
  assert.equal(validateRecord(Object.assign({}, GOOD, {
    sourceStatuses: [{ source: 'gmail', state: 'live', count: 1, error: 'quota exceeded for chef@…' }]
  })).ok, false, 'not even an error string, which can quote content')

  assert.equal(validateRecord(Object.assign({}, GOOD, {
    sourceStatuses: [{ source: 'gmail', state: 'sort-of', count: 1 }]
  })).ok, false, 'and the state must be one of the three')
})

/* ── 3. positive controls ─────────────────────────────────────────────────── */

test('*** POSITIVE CONTROL — the allowlist and denylist actually differ ***', () => {
  for (const f of FORBIDDEN_FIELDS) {
    assert.equal(ALLOWED_FIELDS.includes(f), false, f + ' must not be on both lists')
  }
  assert.ok(FORBIDDEN_FIELDS.length > 0 && ALLOWED_FIELDS.length > 0)
})

test('*** POSITIVE CONTROL — a store that accepted everything would fail these ***', () => {
  const permissive = { write: (rec) => ({ ok: true, id: rec.briefId }) }
  const r = permissive.write(Object.assign({}, GOOD, { subject: 'Invoice 1042' }))
  assert.equal(r.ok, true, 'the permissive store accepts it...')
  assert.throws(() => {
    assert.equal(r.ok, false, 'subject must be refused')
  }, '...and the assertion catches that')
})

test('*** required fields are required ***', () => {
  for (const f of ['briefId', 'generatedAt', 'contentHash', 'outcome']) {
    const bad = Object.assign({}, GOOD)
    delete bad[f]
    assert.equal(validateRecord(bad).ok, false, f + ' is mandatory')
  }
  assert.equal(validateRecord(Object.assign({}, GOOD, { contentHash: 'not-a-digest' })).ok, false,
    'contentHash must really be a digest')
})
