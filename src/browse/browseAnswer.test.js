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

test('*** RENDERER — ⛔ ANY LINE CARRYING A PRICE CARRIES ITS PROVENANCE IN THE SAME LINE ***', () => {
  // Owner ruling: 「Not a caveat below, not a conditional warning. Part of the sentence.」
  //
  // The gate that would otherwise catch 「one row rendered as the price」 is
  // SAMPLE_TREATED_AS_WHOLE, and it fires only when a prose regex matches — measured at recall
  // 1/6 on this Owner's own replies, with three of four firings on self-limiting sentences. It
  // has never fired correctly on this shape, so nothing here waits for it.
  //
  // A caveat on the next line survives quoting for about one hop. A clause inside the sentence
  // travels with the number wherever the number goes.
  for (const input of [
    { observations: [obs()], searchPerformed: true },
    { observations: [obs()], storeContext: 'Winnipeg Grant Park' },
    { observations: [obs()], pageStatedTotal: 87 },
    { observations: [obs(), obs({ product: 'Skippy', price: '$4.49' })], searchPerformed: true }
  ]) {
    const a = render(input)
    for (const line of a.text.split('\n')) {
      if (!/\$\d/.test(line)) continue
      assert.match(line, /搜尋結果頁上嘅一行|同頁其他標價/,
        '⛔ a price appeared on a line that does not say what it is: ' + line)
    }
    const lead = a.text.split('\n')[0]
    assert.match(lead, /搜尋結果頁上嘅一行/)
    assert.match(lead, /唔係.*「售價」/, 'and it is one string with the price — not separable')
  }
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
  // completeness:'sample' — now carried INSIDE the price sentence rather than as a line below
  // it, which is the Owner's ruling and a stronger placement than the one this test first had.
  assert.match(noStore.text, /搜尋結果頁上嘅一行/, 'completeness: sample')
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
