'use strict'

/**
 * wisdomRecall.test.js — what may be remembered out loud, and what may never be.
 *
 * ⛔ PURE. No store, no network, no model. Lessons are supplied as plain objects.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildWisdomBlock, SAFETY_HEADER, CAPS, OPEN, CLOSE } = require('./wisdomRecall')
const { STATE } = require('./wisdomContract')

let n = 0
function lesson (over = {}) {
  n += 1
  return Object.assign({
    id: 'lsn_' + String(n).padStart(3, '0'),
    situation: 'situation ' + n,
    action: 'action ' + n,
    outcome: 'outcome ' + n,
    lesson: 'lesson ' + n,
    confidence: { value: null, basis: null },
    scope: { domain: 'ordering', tags: ['beef'] },
    validation: { state: STATE.VALIDATED, authority: 'owner', reason: 'r', evidenceRefs: [], validatedAt: '2026-08-0' + ((n % 9) + 1) + 'T00:00:00.000Z', supersededBy: null }
  }, over)
}
const from = (arr, caps) => buildWisdomBlock({ listLessonsFn: () => arr, caps })

/* ═══ SELECTION ════════════════════════════════════════════════════════ */

test('*** validated lessons are included ***', () => {
  const r = from([lesson()])
  assert.ok(r.block.startsWith(OPEN))
  assert.ok(r.block.endsWith(CLOSE))
  assert.equal(r.includedIds.length, 1)
})

test('*** ⛔ candidate, rejected and superseded NEVER appear ***', () => {
  for (const state of [STATE.CANDIDATE, STATE.REJECTED, STATE.SUPERSEDED]) {
    const l = lesson({ validation: { state, authority: 'owner', reason: 'r', evidenceRefs: [], validatedAt: '2026-08-01T00:00:00.000Z', supersededBy: null } })
    const r = from([l])
    // ⛔ A candidate is a proposal nobody agreed with; a rejected or superseded lesson is a
    // belief that was specifically withdrawn. Either resurfacing is worse than never having it.
    assert.equal(r.block, null, state + ' produced a block')
    assert.equal(r.includedIds.length, 0)
    assert.equal(r.excludedCount, 1)
  }
})

test('*** a mixed list yields ONLY the validated ones ***', () => {
  const good = lesson()
  const bad = lesson({ validation: { state: STATE.CANDIDATE, authority: null, reason: null, evidenceRefs: [], validatedAt: null, supersededBy: null } })
  const gone = lesson({ validation: { state: STATE.SUPERSEDED, authority: 'owner', reason: 'r', evidenceRefs: [], validatedAt: '2026-08-09T00:00:00.000Z', supersededBy: 'lsn_x' } })
  const r = from([bad, good, gone])
  assert.deepEqual(r.includedIds, [good.id])
  assert.equal(r.block.includes(bad.lesson), false)
  assert.equal(r.block.includes(gone.lesson), false)
})

test('*** an unknown future state is excluded BY DEFAULT ***', () => {
  // The filter is an allowlist, so a state invented later is not silently admitted.
  const weird = lesson({ validation: { state: 'provisionally_true', authority: 'owner', reason: 'r', evidenceRefs: [], validatedAt: '2026-08-09T00:00:00.000Z', supersededBy: null } })
  assert.equal(from([weird]).block, null)
})

/* ═══ ORDER ════════════════════════════════════════════════════════════ */

test('*** newest validated first, ties broken deterministically by id ***', () => {
  const a = lesson({ id: 'lsn_bbb', validation: { state: STATE.VALIDATED, authority: 'owner', reason: 'r', evidenceRefs: [], validatedAt: '2026-08-01T00:00:00.000Z', supersededBy: null } })
  const b = lesson({ id: 'lsn_aaa', validation: { state: STATE.VALIDATED, authority: 'owner', reason: 'r', evidenceRefs: [], validatedAt: '2026-08-01T00:00:00.000Z', supersededBy: null } })
  const c = lesson({ id: 'lsn_ccc', validation: { state: STATE.VALIDATED, authority: 'owner', reason: 'r', evidenceRefs: [], validatedAt: '2026-08-05T00:00:00.000Z', supersededBy: null } })

  assert.deepEqual(from([a, b, c]).includedIds, ['lsn_ccc', 'lsn_aaa', 'lsn_bbb'])
  // ⛔ Input order must not matter: two identical turns cannot differ for reasons nobody can name.
  assert.deepEqual(from([c, b, a]).includedIds, ['lsn_ccc', 'lsn_aaa', 'lsn_bbb'])
})

/* ═══ CAPS — WHOLE RECORDS ONLY ════════════════════════════════════════ */

test('*** the lesson cap is respected ***', () => {
  const many = Array.from({ length: CAPS.maxLessons + 4 }, () => lesson())
  assert.equal(from(many).includedIds.length, CAPS.maxLessons)
})

test('*** ⛔ a record is included WHOLE or not at all ***', () => {
  const huge = lesson({ lesson: 'z'.repeat(600) })
  const small = lesson()
  // 300 comfortably fits an ordinary record and cannot fit the oversized one.
  const r = from([huge, small], { perLessonChars: 300 })
  // ⛔ Half a lesson is a different lesson: 「never order before checking stock」 truncated is
  // 「never order」.
  assert.equal(r.includedIds.includes(huge.id), false)
  assert.equal(r.block.includes('zzzz'), false)
  assert.ok(r.includedIds.includes(small.id))
})

test('*** the whole-block cap stops on a record boundary ***', () => {
  const many = Array.from({ length: 5 }, () => lesson())
  const r = from(many, { wholeBlockChars: 900 })
  assert.ok(r.block.length <= 900)
  assert.ok(r.block.endsWith(CLOSE), 'the block is always closed')
  // Every included id is present in full.
  for (const id of r.includedIds) assert.ok(r.block.includes('- id: ' + id))
})

/* ═══ THE SAFETY HEADER ════════════════════════════════════════════════ */

test('*** the block states EXACTLY what wisdom is not ***', () => {
  const r = from([lesson()])
  assert.ok(r.block.includes(SAFETY_HEADER))
  // ⛔ THE CRITICAL CLAIMS, PINNED. The model reads text, not architecture diagrams.
  for (const claim of [
    'LEARNED HEURISTICS',
    'NOT current facts',
    'NOT the Owner\'s instructions',
    'NOT approvals',
    'NOT authorization',
    'never override current live evidence',
    'CURRENT EVIDENCE WINS',
    'NOT the probability that anything is true now'
  ]) {
    assert.ok(r.block.includes(claim), 'missing claim: ' + claim)
  }
})

/* ═══ HONEST NULLS ═════════════════════════════════════════════════════ */

test('*** null confidence renders as "not established", never as a number ***', () => {
  const r = from([lesson({ confidence: { value: null, basis: null } })])
  assert.ok(r.block.includes('Confidence: not established'))
  assert.equal(/Confidence: 0\./.test(r.block), false, '⛔ an unmeasured number appeared')

  const withValue = from([lesson({ confidence: { value: 0.75, basis: 'observed_outcomes' } })])
  assert.ok(withValue.block.includes('Confidence: 0.75 (observed_outcomes)'))
})

test('*** the six canonical concepts are all rendered ***', () => {
  const r = from([lesson()])
  for (const label of ['Situation:', 'Action:', 'Outcome:', 'Lesson:', 'Confidence:', 'Validation:']) {
    assert.ok(r.block.includes(label), 'missing: ' + label)
  }
  assert.ok(r.block.includes('id: '), 'traceable')
  assert.ok(r.block.includes('Scope: ordering · beef'))
})

/* ═══ RAW EVIDENCE CANNOT APPEAR — IT IS NOT STORED ════════════════════ */

test('*** ⛔ there is no field through which raw evidence could reach the block ***', () => {
  // A lesson carries refs (kind + id) and nothing else, so even a caller who wanted to put a
  // transcript in front of the model has no field to put it in.
  const l = lesson()
  l.validation.evidenceRefs = [{ kind: 'task', id: 'task_42' }]
  l.provenance = { sourceType: 'task_result', sourceRefs: [{ kind: 'conversation', id: 'conv_9' }], createdBy: 'system', createdAt: '2026-08-01T00:00:00.000Z' }
  const r = from([l])
  assert.equal(r.block.includes('task_42'), false, 'refs are not rendered as content')
  assert.equal(r.block.includes('conv_9'), false)
})

/* ═══ FAIL SOFT, NEVER PARTIAL ═════════════════════════════════════════ */

test('*** a broken or absent source produces NO block, not a half one ***', () => {
  assert.equal(buildWisdomBlock({}).block, null)
  assert.equal(buildWisdomBlock({ listLessonsFn: () => { throw new Error('store unreadable') } }).block, null)
  assert.equal(buildWisdomBlock({ listLessonsFn: () => 'not an array' }).block, null)
  assert.equal(from([]).block, null)
})

/* ═══ PURITY ═══════════════════════════════════════════════════════════ */

test('*** the renderer mutates nothing it is given ***', () => {
  const l = lesson()
  const before = JSON.stringify(l)
  from([l])
  assert.equal(JSON.stringify(l), before)
})
