'use strict'
/**
 * businessIntentBaseline.test.js — PIN TODAY'S NUMBERS SO TOMORROW'S ARE COMPARABLE.
 *
 * This test asserts what the deterministic router does RIGHT NOW against the labelled corpus.
 * It is not a pass/fail judgement on the router — several of these numbers are bad on purpose,
 * because that is the finding. It exists so any future change to intent matching has to state
 * what it moved, in which direction, and at what cost to precision.
 *
 * ⛔ IF YOU CHANGE THE MATCHER AND THIS FAILS, DO NOT JUST UPDATE THE NUMBERS. Recall going up
 * while false positives also go up is not an improvement; it is the trade this suite exists to
 * make visible. The precision line below is the one that must never regress.
 *
 * No model call, no connector, no network — intentFor and routeTurn are pure.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { run } = require('./measureBusinessIntent')

const m = run()

test('corpus shape is stable', () => {
  assert.equal(m.rows.length, 68)
  assert.equal(m.bizRead.length, 48)
  assert.equal(m.nonBiz.length, 16)
  assert.equal(m.actions.length, 4)
})

test('*** ⛔ PRECISION IS THE ASSET — ZERO FALSE POSITIVES, AND IT MUST STAY ZERO ***', () => {
  // 16 non-business rows, including 補充-style wording and 訂枱/訂機票. The deterministic
  // matcher fires on none of them. Any future recall work that breaks this line has made the
  // system worse, not better: a false positive is a wrong CONNECTOR read, not a wrong sentence.
  assert.equal(m.falsePos.length, 0, 'false positives: ' + m.falsePos.map((x) => x.r.q).join(', '))
})

test('BASELINE — recall is the gap: 27/48 intents correct', () => {
  assert.equal(m.correct.length, 27)
})

test('BASELINE — 20 business questions currently read nothing', () => {
  // Every one of these is a question a chef would actually ask, answered today from fluency
  // with no source consulted. This is the measured size of the O-1 blind spot.
  assert.equal(m.missToConversation.length, 20)
})

test('BASELINE — one cross-intent collision reads the WRONG source', () => {
  // 「叫咗嘅貨到咗未？」 asks whether ordered goods ARRIVED (purchase_order); the separable
  // matcher reads 叫貨 out of 叫咗嘅貨 and sends it to order_planning. Aspect, not vocabulary:
  // 叫貨 is "to order", 叫咗嘅貨 is "the goods that were ordered". Wrong-source is the most
  // dangerous failure class here, and the only one already present.
  assert.equal(m.crossIntent.length, 1)
  assert.equal(m.crossIntent[0].r.expect.intent, 'purchase_order')
  assert.equal(m.crossIntent[0].intent, 'order_planning')
})

test('BASELINE — 3 write requests are answered as reads (misroute, NOT widened authority)', () => {
  // 落單 / 寄信 / 開發票 fall to laneRouter's chat default, then match a business noun.
  // They are answered with a READ instead of becoming a proposal. Note what this is NOT:
  // BUSINESS_QUERY grants only the intent table's READ sources, so no write capability is
  // conferred. The failure direction is fail-safe; the behaviour is still wrong.
  assert.equal(m.actionErrors.length, 3)
  for (const x of m.actionErrors) {
    assert.deepEqual(x.sources, ['aroma_system'], 'read source only — never a write capability')
  }
})

test('BASELINE — canonical and topicalised forms are already solved', () => {
  const byCls = (c) => m.bizRead.filter((x) => x.r.cls === c)
  const okIn = (c) => byCls(c).filter((x) => x.intent === x.r.expect.intent).length
  assert.equal(okIn('A'), byCls('A').length, 'A: direct canonical must stay 100%')
  assert.equal(okIn('C'), byCls('C').length, 'C: topicalised must stay 100% (the 貨要補 tranche)')
})

test('*** ⛔ THE COLLOQUIAL CLASS IS WHERE THE SYSTEM ACTUALLY FAILS ***', () => {
  // 2/17. This single number is the case for a semantic layer: these are not missing words,
  // they are sentences whose business meaning is clear without any table noun in them.
  const b = m.bizRead.filter((x) => x.r.cls === 'B')
  const ok = b.filter((x) => x.intent === x.r.expect.intent)
  assert.equal(b.length, 17)
  assert.equal(ok.length, 2)
})
