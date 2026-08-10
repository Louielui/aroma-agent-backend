'use strict'

/**
 * wisdomContract.test.js — what a lesson must be before it is allowed to exist.
 *
 * ⛔ NO NETWORK, NO MODEL, NO STORE. Pure contract.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const C = require('./wisdomContract')

const CLOCK = () => '2026-08-10T00:00:00.000Z'
const base = (over = {}) => Object.assign({
  situation: '訂貨前冇對過現貨',
  action: '直接照上次數量落單',
  outcome: '多咗兩箱，凍櫃唔夠位',
  lesson: '落單前先對現貨，尤其凍櫃嘢',
  provenance: { sourceType: C.SOURCE_TYPE.OWNER_FEEDBACK, createdBy: C.CREATED_BY.OWNER }
}, over)

/* ═══ SHAPE ════════════════════════════════════════════════════════════ */

test('*** a valid candidate carries the six canonical fields and starts as candidate ***', () => {
  const l = C.buildCandidate(base(), { clock: CLOCK })
  assert.equal(l.schemaVersion, C.SCHEMA_VERSION)
  assert.ok(l.id.startsWith('lsn_'))
  for (const f of ['situation', 'action', 'outcome', 'lesson']) assert.equal(typeof l[f], 'string')
  assert.equal(l.confidence.value, null)
  assert.equal(l.confidence.basis, null)
  // ⛔ CREATION NEVER PRODUCES BELIEF. There is no input that yields `validated`.
  assert.equal(l.validation.state, C.STATE.CANDIDATE)
  assert.equal(l.validation.authority, null)
  assert.equal(l.validation.validatedAt, null)
  assert.equal(l.provenance.createdAt, CLOCK())
})

test('*** ⛔ createdBy confers NO validation authority, whatever it says ***', () => {
  for (const who of [C.CREATED_BY.AROMA, C.CREATED_BY.SYSTEM, C.CREATED_BY.OWNER]) {
    const l = C.buildCandidate(base({ provenance: { sourceType: C.SOURCE_TYPE.MANUAL, createdBy: who } }), { clock: CLOCK })
    assert.equal(l.validation.state, C.STATE.CANDIDATE, who + ' must still only create a candidate')
    assert.equal(l.validation.authority, null)
  }
  // And the authority allowlist admits exactly one actor.
  assert.deepEqual([...C.AUTHORITIES], ['owner'])
  for (const bad of ['aroma', 'model', 'claude', 'openai', 'system', 'Owner', '', null, undefined, 1]) {
    assert.throws(() => C.assertOwnerAuthority(bad, 'validate'), /only the Owner/)
  }
})

/* ═══ REQUIRED / BOUNDED TEXT ══════════════════════════════════════════ */

test('*** a lesson with nothing to say is not a lesson ***', () => {
  for (const missing of [undefined, null, '', '   ']) {
    assert.throws(() => C.buildCandidate(base({ lesson: missing })), /lesson/)
  }
})

test('*** over-bound text is REJECTED, never silently truncated ***', () => {
  // ⛔ Truncation can invert meaning: 「never order before checking stock」 cut short is
  // 「never order」. A malformed input must fail loudly instead.
  const long = 'x'.repeat(C.MAX_SEMANTIC_CHARS + 1)
  for (const f of ['situation', 'action', 'outcome', 'lesson']) {
    assert.throws(() => C.buildCandidate(base({ [f]: long })), new RegExp(f + '.*exceeds'))
  }
  const atLimit = 'y'.repeat(C.MAX_SEMANTIC_CHARS)
  assert.equal(C.buildCandidate(base({ lesson: atLimit }), { clock: CLOCK }).lesson.length, C.MAX_SEMANTIC_CHARS)
})

/* ═══ CONFIDENCE ═══════════════════════════════════════════════════════ */

test('*** null confidence is PRESERVED as null — never defaulted to 0.5 ***', () => {
  for (const c of [undefined, null, {}, { value: null }, { value: null, basis: null }]) {
    const l = C.buildCandidate(base({ confidence: c }), { clock: CLOCK })
    assert.equal(l.confidence.value, null, 'unknown must stay unknown')
    assert.equal(l.confidence.basis, null)
  }
})

test('*** confidence range is checked, and a value without a basis is malformed ***', () => {
  for (const v of [0, 0.5, 1]) {
    const l = C.buildCandidate(base({ confidence: { value: v, basis: C.CONFIDENCE_BASIS.OBSERVED_OUTCOMES } }), { clock: CLOCK })
    assert.equal(l.confidence.value, v)
  }
  for (const bad of [-0.01, 1.01, 2, -1]) {
    assert.throws(() => C.buildCandidate(base({ confidence: { value: bad, basis: C.CONFIDENCE_BASIS.OWNER_JUDGEMENT } })), /0\.\.1/)
  }
  for (const bad of [NaN, Infinity, '0.5', {}, []]) {
    assert.throws(() => C.buildCandidate(base({ confidence: { value: bad, basis: C.CONFIDENCE_BASIS.OWNER_JUDGEMENT } })), /finite number|0\.\.1/)
  }
  // ⛔ A NUMBER WITH NO PROVENANCE IS A NUMBER NOBODY CAN ARGUE WITH.
  assert.throws(() => C.buildCandidate(base({ confidence: { value: 0.9 } })), /basis is required/)
})

test('*** model_estimate is a permitted CANDIDATE basis and nothing more ***', () => {
  const l = C.buildCandidate(base({ confidence: { value: 0.8, basis: C.CONFIDENCE_BASIS.MODEL_ESTIMATE } }), { clock: CLOCK })
  assert.equal(l.confidence.basis, C.CONFIDENCE_BASIS.MODEL_ESTIMATE)
  assert.equal(l.validation.state, C.STATE.CANDIDATE, 'a model estimate cannot create belief')
})

/* ═══ CLOSED ENUMS ═════════════════════════════════════════════════════ */

test('*** unknown enum values are refused everywhere ***', () => {
  assert.throws(() => C.buildCandidate(base({ provenance: { sourceType: 'gossip', createdBy: 'owner' } })), /sourceType/)
  assert.throws(() => C.buildCandidate(base({ provenance: { sourceType: 'manual', createdBy: 'chatgpt' } })), /createdBy/)
  assert.throws(() => C.buildCandidate(base({ confidence: { value: 0.5, basis: 'vibes' } })), /basis/)
  assert.throws(() => C.fromEnum('nonsense', C.STATES, 'state'), /state must be one of/)
})

/* ═══ REFERENCES — IDENTIFIERS ONLY ════════════════════════════════════ */

test('*** refs are {kind, id} and CANNOT smuggle evidence text ***', () => {
  const refs = [{ kind: C.REF_KIND.TASK, id: 'task_123' }, { kind: C.REF_KIND.DECISION, id: 'dec_9' }]
  const l = C.buildCandidate(base({ provenance: { sourceType: 'task_result', createdBy: 'system', sourceRefs: refs } }), { clock: CLOCK })
  assert.deepEqual(l.provenance.sourceRefs, refs)

  // ⛔ THE EXACT SHAPE A TRANSCRIPT WOULD ARRIVE IN.
  assert.throws(() => C.normaliseRefs([{ kind: 'task', id: 't1', text: 'the whole email' }], 'refs'), /may only carry/)
  assert.throws(() => C.normaliseRefs([{ kind: 'task', id: 't1', snippet: 'body' }], 'refs'), /may only carry/)
  assert.throws(() => C.normaliseRefs([{ kind: 'mailbox', id: 't1' }], 'refs'), /kind must be one of/)
  assert.throws(() => C.normaliseRefs([{ kind: 'task', id: 'x'.repeat(C.MAX_ID_CHARS + 1) }], 'refs'), /exceeds/)
  assert.throws(() => C.normaliseRefs(new Array(C.MAX_REFS + 1).fill({ kind: 'task', id: 't' }), 'refs'), /exceeds/)
  assert.throws(() => C.normaliseRefs('task_1', 'refs'), /must be an array/)
})

/* ═══ REDACTION BEFORE PERSISTENCE ═════════════════════════════════════ */

test('*** secrets are redacted BEFORE the record exists, and only the redacted text survives ***', () => {
  const secret = 'sk-live-ABCDEF1234567890abcdef'
  const l = C.buildCandidate(base({
    lesson: '唔好將 api key ' + secret + ' 貼落 chat',
    outcome: 'password: hunter2hunter2 被人見到'
  }), { clock: CLOCK })

  const blob = JSON.stringify(l)
  assert.equal(blob.includes(secret), false, '⛔ the raw secret survived into the record')
  assert.equal(blob.includes('hunter2hunter2'), false)
  assert.ok(l.redactedKinds.length > 0, 'and what KIND was removed is recorded')
  // ⛔ KINDS, NOT VALUES.
  for (const k of l.redactedKinds) assert.equal(k.includes(secret), false)
})

/* ═══ TRANSITIONS ══════════════════════════════════════════════════════ */

test('*** the transition table is closed, and every backwards move is refused ***', () => {
  C.assertTransition(C.STATE.CANDIDATE, C.STATE.VALIDATED)
  C.assertTransition(C.STATE.CANDIDATE, C.STATE.REJECTED)
  C.assertTransition(C.STATE.VALIDATED, C.STATE.SUPERSEDED)
  for (const [from, to] of [
    [C.STATE.VALIDATED, C.STATE.CANDIDATE],
    [C.STATE.REJECTED, C.STATE.VALIDATED],
    [C.STATE.SUPERSEDED, C.STATE.VALIDATED],
    [C.STATE.VALIDATED, C.STATE.VALIDATED],
    [C.STATE.REJECTED, C.STATE.CANDIDATE],
    [C.STATE.CANDIDATE, C.STATE.SUPERSEDED]
  ]) {
    assert.throws(() => C.assertTransition(from, to), /refusing transition/, from + ' -> ' + to)
  }
  assert.throws(() => C.assertTransition('invented', C.STATE.VALIDATED), /unknown current state/)
})

test('*** a judgement needs the Owner AND a bounded, redacted reason ***', () => {
  const j = C.buildJudgement({ authority: 'owner', reason: '試過三次都係咁' })
  assert.equal(j.authority, 'owner')
  assert.equal(j.reason, '試過三次都係咁')
  assert.throws(() => C.buildJudgement({ authority: 'aroma', reason: 'ok' }), /only the Owner/)
  assert.throws(() => C.buildJudgement({ authority: 'owner' }), /reason is required/)
  assert.throws(() => C.buildJudgement({ authority: 'owner', reason: 'x'.repeat(C.MAX_REASON_CHARS + 1) }), /exceeds/)
  const scrubbed = C.buildJudgement({ authority: 'owner', reason: 'password: hunter2hunter2' })
  assert.equal(scrubbed.reason.includes('hunter2hunter2'), false)
})
