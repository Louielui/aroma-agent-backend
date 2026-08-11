'use strict'
/**
 * browseAnswer.test.js — the RENDERER layer. What the Owner reads.
 *
 * ⛔ NO NETWORK, NO MODEL.
 * ⛔ HR-57: the layer is in the test name. These assert the WORDS; browseEvidence.test.js
 *    asserts the fields. Neither stands for the other.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { describeBrowseRun } = require('./browseEvidence')
const { renderBrowseAnswer } = require('./browseAnswer')

const ORIGIN = 'https://www.realcanadiansuperstore.ca'
const ORDER = { allowedOrigins: [ORIGIN], siteLabel: 'Real Canadian Superstore', searchParam: 'search-bar' }
const obs = (o) => Object.assign({
  product: 'Kraft Peanut Butter', packageSize: '1kg', price: '$5.99',
  sourceOrigin: ORIGIN, observedAt: '2026-08-11T10:00:00Z'
}, o || {})
const render = (input, q) => renderBrowseAnswer(describeBrowseRun(Object.assign({ order: ORDER }, input)), { query: q || 'peanut butter' })

test('*** RENDERER — ⛔ it NEVER says the shop sells it at that price ***', () => {
  const a = render({ observations: [obs()], searchPerformed: true })
  // The deleted file rendered 「查到：<product> — <price>」, which is a claim about what the shop
  // charges. What we hold is one row of page one, filtered by a predicate nobody chose.
  assert.equal(/賣|售價係|price is/.test(a.text.split('\n')[0]), false, 'the lead line is not a price claim')
  assert.match(a.text, /標價/, 'it reports what the page displayed')
  assert.match(a.text, /唔係.*「售價」/, 'and says outright that it is not the shop price')
})

test('*** RENDERER — ⛔ 「搵唔到」 is said, and 「冇貨」 is refused, IN THE WORDS ***', () => {
  const a = render({ observations: [], searchPerformed: true })
  // NO_RELEVANT_RESULTS is a fact about OUR SEARCH. 「Superstore 冇花生醬」 is a claim about the
  // shop's shelves that one page cannot support — A1's gate calls that ABSENCE_AS_PROOF. The
  // Owner asked for the distinction to be visible in the REPLY, not only in the field.
  assert.match(a.text, /搵唔到/)
  assert.match(a.text, /唔係講.*冇貨/, 'the distinction is stated, not left to a field')
  assert.equal(a.readState, 'NO_RELEVANT_RESULTS')
})

test('*** RENDERER — a blocked read says we never got there, and claims nothing ***', () => {
  const a = render({ observations: [], navigation: { blocked: true, reason: 'origin not allowed' } })
  assert.match(a.text, /去唔到/)
  assert.match(a.text, /origin not allowed/, 'the reason travels')
  assert.equal(/搵唔到|標價/.test(a.text), false, 'a failure to arrive is not a finding of absence')
})

test('*** RENDERER — ⛔ every qualifier comes from a DESCRIPTOR FIELD, not a hand-written caveat ***', () => {
  const noStore = render({ observations: [obs()], searchPerformed: true })
  assert.match(noStore.text, /第一頁/, 'completeness: sample')
  assert.match(noStore.text, /數唔到/, 'matchingTotal: null')
  assert.match(noStore.text, /篩選/, 'filtersApplied: null — HR-58, replacing the old prose sentence')
  assert.match(noStore.text, /未揀分店/, 'rowShape.hasLocation: false')

  const withStore = render({ observations: [obs()], storeContext: 'Winnipeg Grant Park' })
  assert.match(withStore.text, /Winnipeg Grant Park/)
  assert.equal(/未揀分店/.test(withStore.text), false)

  const stated = render({ observations: [obs()], pageStatedTotal: 87 })
  assert.equal(/數唔到/.test(stated.text), false, 'the page printed a total, so that line goes away')
})

test('*** RENDERER — ⛔ THE CEILING: mayAssertClaim is false, and it is false ALWAYS ***', () => {
  const a = render({ observations: [obs()], searchPerformed: true })
  // A1's gate refuses every browse result with TRUNCATED, unconditionally, because a results
  // page is truncated by construction. That rule is right about 「there are N items」 and too
  // blunt for 「THIS row showed THIS price」 — A1's own source names the gap and defers it.
  //
  // So this layer REPORTS observations and never asserts a claim, and it carries the gate's
  // verdict out unmodified rather than routing around a check that always says no.
  assert.equal(a.mayAssertClaim, false)
  assert.equal(a.gate, 'TRUNCATED')

  const stated = render({ observations: [obs()], pageStatedTotal: 87, storeContext: 'X' })
  assert.equal(stated.mayAssertClaim, false, 'even with a stated total and a chosen store')
})

test('*** RENDERER — an unpriced product is reported as unpriced, not as a price ***', () => {
  const a = render({ observations: [obs({ price: null })], searchPerformed: true })
  assert.match(a.text, /未能核實價格/)
  assert.equal(/\$5\.99/.test(a.text), false)
})
