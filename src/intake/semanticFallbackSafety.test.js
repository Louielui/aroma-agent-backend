'use strict'
/**
 * semanticFallbackSafety.test.js — WHEN THE PROVIDER MISBEHAVES, NOBODY READS.
 *
 * A partial success is not authority. One good answer and one silence is exactly the shape that
 * tempts a system into acting on half its evidence, so it is asserted here in every form it can
 * take: timeout, 5xx, malformed, refusal, and one-of-each.
 *
 * No network. Every callModel is injected.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { DECISION, resolveSemanticFallback, resolveSource } = require('./semanticFallback')

const ok = (i, c) => JSON.stringify({ intent: i, confidence: c })
const go = (callModel, message) => resolveSemanticFallback({
  message: message || '仲有幾多貨？', deterministicRoute: 'CONVERSATION', callModel, system: 'x'
})

/** Serves a different scripted reply to call A and call B. */
const pair = (a, b) => { let n = 0; return async () => { const r = n++ === 0 ? a : b; if (typeof r === 'function') return r(); return r } }
const boom = (msg) => () => { throw new Error(msg) }

test('*** BOTH CALLS TIMEOUT -> no read ***', async () => {
  const r = await go(pair(boom('ETIMEDOUT'), boom('ETIMEDOUT')))
  assert.notEqual(r.decision, DECISION.AUTO_READ)
  assert.deepEqual(r.sources, [])
})

test('*** ONE VALID HIGH + ONE TIMEOUT -> never auto-read ***', async () => {
  for (const scripted of [pair(ok('inventory', 'HIGH'), boom('ETIMEDOUT')), pair(boom('ETIMEDOUT'), ok('inventory', 'HIGH'))]) {
    const r = await go(scripted)
    assert.notEqual(r.decision, DECISION.AUTO_READ, '⛔ half the evidence became authority')
    assert.deepEqual(r.sources, [], '⛔ a source was selected on a partial result')
  }
})

test('*** PROVIDER 5xx ON BOTH -> no read ***', async () => {
  const r = await go(pair(boom('Request failed with status code 503'), boom('Request failed with status code 503')))
  assert.notEqual(r.decision, DECISION.AUTO_READ)
})

test('*** MALFORMED REPLIES -> no read ***', async () => {
  const cases = [
    [pair('not json at all', 'not json at all'), 'both malformed'],
    [pair(ok('inventory', 'HIGH'), 'not json at all'), 'one malformed'],
    [pair(ok('inventory', 'HIGH'), JSON.stringify({ intent: 'inventory' })), 'missing confidence'],
    [pair(ok('inventory', 'HIGH'), ok('payroll', 'HIGH')), 'out-of-enum on one side']
  ]
  for (const [scripted, label] of cases) {
    const r = await go(scripted)
    assert.notEqual(r.decision, DECISION.AUTO_READ, '⛔ auto-read on: ' + label)
    assert.deepEqual(r.sources, [], '⛔ source selected on: ' + label)
  }
})

test('*** HIGH/HIGH DISAGREEMENT -> CLARIFY, never a read ***', async () => {
  const r = await go(pair(ok('inventory', 'HIGH'), ok('order_planning', 'HIGH')))
  assert.equal(r.decision, DECISION.CLARIFY)
  assert.deepEqual(r.sources, [])
  assert.ok(r.clarifyQuestion && r.clarifyQuestion.length > 0, 'a clarify decision must carry a question')
})

test('*** MIXED CONFIDENCE ON THE SAME INTENT IS NOT CONSENSUS ***', async () => {
  for (const b of ['MEDIUM', 'LOW']) {
    const r = await go(pair(ok('invoice', 'HIGH'), ok('invoice', b)))
    assert.notEqual(r.decision, DECISION.AUTO_READ, '⛔ HIGH/' + b + ' auto-read')
  }
})

test('*** MEDIUM/MEDIUM -> CLARIFY ***', async () => {
  const r = await go(pair(ok('order_planning', 'MEDIUM'), ok('order_planning', 'MEDIUM')))
  assert.equal(r.decision, DECISION.CLARIFY)
})

test('*** NONE/NONE -> ABSTAIN, and no question is invented ***', async () => {
  const r = await go(pair(ok('NONE', 'LOW'), ok('NONE', 'LOW')))
  assert.equal(r.decision, DECISION.ABSTAIN)
  assert.equal(r.clarifyQuestion, null)
})

test('*** AN ENUM KEY THE TABLE DOES NOT KNOW READS NOTHING ***', async () => {
  // Defence in depth: even a perfect consensus resolves through the server's table, and a key
  // with no source there is not a licence to improvise one.
  assert.deepEqual(resolveSource('not_a_real_intent'), [])
  assert.deepEqual(resolveSource('NONE'), [])
})

test('*** THE FALLBACK NEVER OPENS ON A DETERMINISTIC WIN ***', async () => {
  let called = 0
  const spy = async () => { called++; return ok('inventory', 'HIGH') }
  for (const route of ['UTILITY', 'ACTION', 'BUSINESS_QUERY']) {
    const r = await resolveSemanticFallback({ message: 'x', deterministicRoute: route, callModel: spy, system: 'x' })
    assert.equal(r.applicable, false, '⛔ semantic fallback opened on ' + route)
    assert.deepEqual(r.sources, [])
  }
  assert.equal(called, 0, '⛔ the model was called on a turn the deterministic router had already won')
})

test('*** TWO INDEPENDENT CALLS, NOT ONE REPLY COPIED TWICE ***', async () => {
  let n = 0
  const distinct = async () => { n++; return ok('inventory', 'HIGH') }
  await go(distinct)
  assert.equal(n, 2, '⛔ the second opinion was not actually requested')
})

/* ═══ THE FENCES THAT TODAY'S INVARIANTS ALREADY MAKE UNREACHABLE ══════════ */

const { decideFromCalls } = require('./semanticFallback')
const A = (candidate, confidence, ok) => ({ ok: ok !== false, candidate, confidence })

test('*** A FAILED CALL CANNOT BECOME HALF A CONSENSUS ***', () => {
  // Unreachable through resolveSemanticFallback, because a thrown call is normalised to NONE
  // and can never match. Asserted directly so the `bothOk` fence survives the day that changes.
  const d = decideFromCalls(A('inventory', 'HIGH'), A('inventory', 'HIGH', false), false)
  assert.notEqual(d.decision, DECISION.AUTO_READ, '⛔ a failed call was counted as agreement')
  assert.deepEqual(d.sources, [])
})

test('*** NONE CAN NEVER AUTO-READ, EVEN IF IT ARRIVES AT HIGH ***', () => {
  // Unreachable today because admit() normalises NONE to LOW — the B3 repair. If that
  // normalisation is ever lost, this fence is the one that still refuses.
  const d = decideFromCalls(A('NONE', 'HIGH'), A('NONE', 'HIGH'), false)
  assert.notEqual(d.decision, DECISION.AUTO_READ, '⛔ an abstention auto-read')
  assert.deepEqual(d.sources, [])
})

test('*** AN INTENT WITH NO SOURCE IN THE TABLE READS NOTHING ***', () => {
  // Unreachable today because every enum key exists in INTENTS. This is the fence against the
  // two lists drifting apart, which is the failure a second source registry would cause.
  const d = decideFromCalls(A('inventory', 'HIGH'), A('inventory', 'HIGH'), false, () => [])
  assert.equal(d.decision, DECISION.ABSTAIN, '⛔ a sourceless intent produced a read')
  assert.deepEqual(d.sources, [])
})

test('*** AMBIGUOUS WORDING CLARIFIES EVEN ON AGREEING HIGH ***', () => {
  // The genuine gap: the measured ambiguous sentence happens to DISAGREE across passes, so the
  // agreement fence masked the ambiguity fence. Driven directly, both must hold independently.
  const d = decideFromCalls(A('order_planning', 'HIGH'), A('order_planning', 'HIGH'), true)
  assert.equal(d.decision, DECISION.CLARIFY, '⛔ ambiguous wording auto-read on agreement')
  assert.deepEqual(d.sources, [])
})

test('agreeing HIGH on unambiguous wording still auto-reads — the fences are not blanket refusals', () => {
  const d = decideFromCalls(A('inventory', 'HIGH'), A('inventory', 'HIGH'), false)
  assert.equal(d.decision, DECISION.AUTO_READ)
  assert.deepEqual(d.sources, ['aroma_system'])
})

test('*** NONE IS REFUSED BY ITS OWN FENCE, NOT ONLY BY THE SOURCE LOOKUP ***', () => {
  // The previous NONE test passed even with the `real` fence removed, because resolveSource
  // returns [] for NONE and the source guard caught it. Two fences, one test — so the inner one
  // was never actually exercised. Hand it a resolver that WOULD supply a source and the `real`
  // fence has to hold on its own.
  const d = decideFromCalls(A('NONE', 'HIGH'), A('NONE', 'HIGH'), false, () => ['aroma_system'])
  assert.notEqual(d.decision, DECISION.AUTO_READ, '⛔ NONE auto-read once the source guard was bypassed')
  assert.deepEqual(d.sources, [])
})
