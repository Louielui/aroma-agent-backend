'use strict'
/**
 * browseEvidence.test.js — the DESCRIPTOR layer. A1's vocabulary, not a second one.
 *
 * ⛔ NO NETWORK, NO MODEL. Every case is a constructed observation.
 * ⛔ HR-57: each test names the LAYER it runs at. The deleted suite asserted 「origin cannot be
 *    client-supplied」 against browseOrder and left the result layer unfenced — a real green
 *    light about one door, believed about the room.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { describeBrowseRun, admitObservation, OBSERVATION_REFUSED } = require('./browseEvidence')

const ORIGIN = 'https://www.realcanadiansuperstore.ca'
const ORDER = { allowedOrigins: [ORIGIN], siteLabel: 'Real Canadian Superstore', searchParam: 'search-bar' }
const obs = (o) => Object.assign({
  product: 'Kraft Peanut Butter', packageSize: '1kg', price: '$5.99',
  sourceOrigin: ORIGIN, observedAt: '2026-08-11T10:00:00Z'
}, o || {})

test('*** DESCRIPTOR — ⛔ an observation is admitted by the SEALED ORDER, not by a field it carries ***', () => {
  // The independent review's finding, and the one that mattered: the deleted code trusted
  // `source: 'browser'` and regex-checked that sourceOrigin merely LOOKED like a URL, so a
  // caller could mint a result from an origin the request fence would have refused.
  assert.equal(admitObservation(obs(), ORDER).ok, true)

  const foreign = admitObservation(obs({ sourceOrigin: 'https://evil.example' }), ORDER)
  assert.equal(foreign.ok, false)
  assert.equal(foreign.reason, OBSERVATION_REFUSED.ORIGIN_NOT_IN_ORDER)

  // ⛔ AND SELF-DECLARED PROVENANCE BUYS NOTHING. Whatever the caller says about itself.
  const lying = admitObservation(obs({ sourceOrigin: 'https://evil.example', source: 'browser', trusted: true }), ORDER)
  assert.equal(lying.ok, false, 'a field about itself cannot admit an origin the order excluded')
})

test('*** DESCRIPTOR — a refused observation is COUNTED, never silently dropped ***', () => {
  const e = describeBrowseRun({ order: ORDER, observations: [obs(), obs({ sourceOrigin: 'https://evil.example' })], searchPerformed: true })
  assert.equal(e.shownCount, 1)
  assert.equal(e.refusedObservations.length, 1)
  assert.equal(e.refusedObservations[0].reason, OBSERVATION_REFUSED.ORIGIN_NOT_IN_ORDER)
})

test('*** DESCRIPTOR — ⛔ a results page is a SAMPLE, and says so in four fields ***', () => {
  const e = describeBrowseRun({ order: ORDER, observations: [obs()], searchPerformed: true })
  assert.equal(e.completeness, 'sample', 'page one of an unknown number')
  assert.equal(e.truncated, true, 'there is always more we did not read')
  assert.equal(e.matchingTotal, null, 'the page printed no total, so we have none')
  assert.equal(e.sourceTotal, null, 'and no shop publishes its catalogue size')
})

test('*** DESCRIPTOR — matchingTotal exists ONLY when the page literally printed it ***', () => {
  const stated = describeBrowseRun({ order: ORDER, observations: [obs()], pageStatedTotal: 87 })
  assert.equal(stated.matchingTotal, 87, '「1-24 of 87」 is a fact the page asserted')
  // Counting the rows we happened to read establishes nothing about the total.
  const counted = describeBrowseRun({ order: ORDER, observations: [obs(), obs({ product: 'Skippy' })] })
  assert.equal(counted.matchingTotal, null)
  assert.equal(counted.shownCount, 2)
})

test('*** DESCRIPTOR — ⛔ filtersApplied is null, NOT [] ***', () => {
  const e = describeBrowseRun({ order: ORDER, observations: [obs()] })
  // [] asserts 「known to have NO filters」. The site applies a store predicate we did not
  // choose and cannot enumerate, so the honest value is UNKNOWN. (HR-58 — and this is what
  // replaces the deleted `locationDependent` boolean and its hand-written Chinese sentence.)
  assert.equal(e.filtersApplied, null)
  assert.notDeepEqual(e.filtersApplied, [])
})

test('*** DESCRIPTOR — the three readStates are A1\'s, and BLOCKED is a READ_FAILED ***', () => {
  const found = describeBrowseRun({ order: ORDER, observations: [obs()], searchPerformed: true })
  assert.equal(found.readState, 'RESULTS_FOUND')

  const none = describeBrowseRun({ order: ORDER, observations: [], searchPerformed: true })
  assert.equal(none.readState, 'NO_RELEVANT_RESULTS', 'we finished; the answer is 「none found」')

  const blocked = describeBrowseRun({ order: ORDER, observations: [], navigation: { blocked: true, reason: 'origin not allowed' } })
  assert.match(blocked.readState, /^READ_FAILED: /, 'we did not finish — a different kind entirely')
  assert.equal(blocked.truncated, false, 'nothing was read, so nothing was cut off')
})

test('*** DESCRIPTOR — rowShape.hasLocation reports THE READ, not the site ***', () => {
  const noStore = describeBrowseRun({ order: ORDER, observations: [obs()] })
  assert.equal(noStore.rowShape.hasLocation, false)
  const withStore = describeBrowseRun({ order: ORDER, observations: [obs()], storeContext: 'Winnipeg Grant Park' })
  assert.equal(withStore.rowShape.hasLocation, true, 'a fact about this run, not a static flag on the registry')
})
