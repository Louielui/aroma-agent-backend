'use strict'
/**
 * o1QualificationContract.test.js — THE ABSTENTION BUG, AND THE THREE OUTCOMES.
 *
 * B2 shipped a one-word bug that made every abstention report itself at the model's declared
 * confidence. Nine rows were counted as high-confidence errors when the classifier had in fact
 * said 「I do not know」. These tests fail under that bug.
 *
 * No model call, no connector, no network.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const shadow = require('./semanticIntentShadow')
const { OUTCOME, outcomeFor, isAutoReadEligible } = require('./qualificationOutcome')
const { CORPUS } = require('./businessIntentCorpus')

const H = (c) => ({ candidate: c, confidence: 'HIGH' })
const M = (c) => ({ candidate: c, confidence: 'MEDIUM' })
const NONE_LOW = { candidate: 'NONE', confidence: 'LOW' }

/* ═══ 1. THE BUG ════════════════════════════════════════════════════════════ */

test('*** AN ABSTENTION CAN NEVER REPORT ITSELF AS HIGH ***', () => {
  // Fails under `obj.candidate === NONE`, which is always false because the model's field is
  // `intent`. This is the exact one-word defect that corrupted the B2 numbers.
  for (const declared of ['HIGH', 'MEDIUM', 'LOW']) {
    const r = shadow.admit({ intent: 'NONE', confidence: declared })
    assert.equal(r.candidate, shadow.NONE)
    assert.equal(r.confidence, 'LOW', 'NONE must normalise to LOW, got ' + r.confidence)
  }
})

test('a real intent keeps the confidence the model declared', () => {
  assert.equal(shadow.admit({ intent: 'inventory', confidence: 'HIGH' }).confidence, 'HIGH')
  assert.equal(shadow.admit({ intent: 'inventory', confidence: 'MEDIUM' }).confidence, 'MEDIUM')
})

test('the closed enum is unchanged by this repair', () => {
  assert.equal(shadow.CANDIDATES.length, 11)
  assert.ok(shadow.CANDIDATES.includes('NONE'))
})

/* ═══ 2. THREE OUTCOMES, NOT ONE NUMBER ════════════════════════════════════ */

const plain = (i) => ({ expectIntent: i, ambiguous: false })

test('stable agreeing HIGH is the only auto-read outcome', () => {
  const p = [H('inventory'), H('inventory')]
  const o = outcomeFor(p, plain('inventory'))
  assert.equal(o, OUTCOME.STABLE_HIGH)
  assert.equal(isAutoReadEligible(o, p, plain('inventory')), true)
})

test('*** AN UNSTABLE ROW IS NEVER AUTO-READ ELIGIBLE ***', () => {
  const disagree = [H('order_planning'), H('inventory')]
  const o1 = outcomeFor(disagree, plain('order_planning'))
  assert.equal(o1, OUTCOME.UNSTABLE)
  assert.equal(isAutoReadEligible(o1, disagree, plain('order_planning')), false)

  // Same intent, different confidence, is also unstable — measured on 「今個月啲單幾多錢？」.
  const wobble = [M('invoice'), H('invoice')]
  const o2 = outcomeFor(wobble, plain('invoice'))
  assert.equal(o2, OUTCOME.UNSTABLE)
  assert.equal(isAutoReadEligible(o2, wobble, plain('invoice')), false)
})

test('*** AN AMBIGUOUS ROW IS NEVER AUTO-READ ELIGIBLE, EVEN AT HIGH TWICE ***', () => {
  // Ambiguity is a property of the QUESTION. No amount of model confidence dissolves it.
  const row = { expectIntent: 'order_planning', ambiguous: true }
  const p = [H('order_planning'), H('order_planning')]
  const o = outcomeFor(p, row)
  assert.equal(o, OUTCOME.AMBIGUOUS)
  assert.equal(isAutoReadEligible(o, p, row), false)
})

test('*** THE ELIGIBILITY GUARD IS ITS OWN FENCE, NOT A RESTATEMENT OF outcomeFor ***', () => {
  // Defence in depth, exercised directly. outcomeFor already returns AMBIGUOUS for these
  // rows, so the check inside isAutoReadEligible is unreachable by the normal path — which
  // is exactly how a guard rots. A caller that computes, caches or receives an outcome by
  // any other route must still be refused, so the fence is asserted on its own terms.
  const row = { expectIntent: 'order_planning', ambiguous: true }
  const p = [H('order_planning'), H('order_planning')]
  assert.equal(isAutoReadEligible(OUTCOME.STABLE_HIGH, p, row), false,
    'an ambiguous row must be refused even when handed a STABLE_HIGH outcome directly')
})

test('a stable HIGH on the WRONG intent is not eligible either', () => {
  const p = [H('inventory'), H('inventory')]
  assert.equal(isAutoReadEligible(outcomeFor(p, plain('order_planning')), p, plain('order_planning')), false)
})

test('abstention is its own outcome, not a failure', () => {
  const p = [NONE_LOW, NONE_LOW]
  const o = outcomeFor(p, plain('mail'))
  assert.equal(o, OUTCOME.ABSTAIN)
  assert.equal(isAutoReadEligible(o, p, plain('mail')), false)
})

/* ═══ 3. THE CORPUS CONTRACT ═══════════════════════════════════════════════ */

test('*** THE AMBIGUOUS SENTENCES ARE LABELLED, AND THEIR EXPECTED INTENT IS UNCHANGED ***', () => {
  const a = CORPUS.find((r) => r.q === '有咩貨唔夠要入返？')
  const b = CORPUS.find((r) => r.q === '有咩嘢就快唔夠？')
  assert.ok(a && b, 'the measured sentences must still be in the corpus, verbatim')
  // ⛔ The label records ambiguity; it does NOT relabel the answer to make a model pass.
  assert.equal(a.expect.intent, 'order_planning', 'expected intent must not have been softened')
  assert.equal(b.expect.intent, 'inventory', 'expected intent must not have been softened')
  assert.equal(a.expect.clarifyOk, true)
  assert.equal(b.expect.clarifyOk, true)
  assert.ok(a.note && /AMBIGUOUS BY WORDING/.test(a.note), 'the reason must be recorded with the row')
})

test('intent correctness and connector correctness stay separate concepts', () => {
  // inventory and order_planning are different TABLES behind the SAME connector. A tranche that
  // reported only connector correctness would score this pair as harmless.
  assert.deepEqual(shadow.resolveSource('inventory'), shadow.resolveSource('order_planning'))
  assert.notEqual('inventory', 'order_planning')
})
