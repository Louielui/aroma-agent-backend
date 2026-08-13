'use strict'

/**
 * superlativeSection.test.js — a superlative HEADING is a ranking claim.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED IN PRODUCTION, requestId a3a51702-b136-430d-8994-7a20e890f0f9, bootCommit
 * ebd6071. The Owner asked 「現在缺貨最嚴重的是什麼？」 and the reply carried
 *
 *     「目前最缺的四項」   Jars 20 → Napa 75 → New Orleans 39 → Dark Soy 37
 *
 * a top-N claim contradicting the proven absolute-shortfall order. It shipped because the
 * detector wanted an ordering WORD or an enumerator, and 「最缺」 is neither.
 *
 * ⛔ AND THE ZERO-SOURCE EARLY EXIT WAS A SECOND BYPASS: a turn that read nothing orderable
 * returned before any heading was examined, so a superlative section could ship with no
 * ranking proof at all.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { classifySectionHeading, CLAIM_KIND, rankingSectionViolations, RANKING_METRIC } = require('./rankingProof')

/* ═══ COMMIT A — DETECTION ══════════════════════════════════════════════ */

const CLAIMS = [
  ['目前最缺的四項', CLAIM_KIND.TOP_N, 4, RANKING_METRIC.ABSOLUTE_SHORTFALL],
  ['最嚴重的三項', CLAIM_KIND.TOP_N, 3, RANKING_METRIC.ABSOLUTE_SHORTFALL],
  ['最緊急缺貨項目', CLAIM_KIND.SUPERLATIVE, null, RANKING_METRIC.ABSOLUTE_SHORTFALL],
  ['缺貨排序', CLAIM_KIND.ORDERING, null, RANKING_METRIC.ABSOLUTE_SHORTFALL],
  ['缺貨排名', CLAIM_KIND.ORDERING, null, RANKING_METRIC.ABSOLUTE_SHORTFALL]
]

for (const [heading, kind, n, metric] of CLAIMS) {
  test(`*** ⛔ 「${heading}」 IS A RANKING CLAIM (${kind}) ***`, () => {
    const c = classifySectionHeading(heading)
    assert.equal(c.claim, true, '⛔ not recognised as a claim')
    assert.equal(c.kind, kind)
    assert.equal(c.n, n, 'claimed N')
    assert.equal(c.metric, metric)
  })
}

test('*** ⛔ ORDINARY SET HEADINGS ARE NOT RANKINGS ***', () => {
  // ⛔ The whole gate must stay off ordinary factual sections. A superlative QUESTION does not
  // make 「缺貨狀況」 into a ranking, and neither does this classifier.
  for (const h of ['缺貨狀況', '缺貨項目', '目前庫存', '存貨清單', '']) {
    assert.equal(classifySectionHeading(h).claim, false, '⛔ false positive on ' + JSON.stringify(h))
  }
})

test('*** ⛔ A SUPERLATIVE OVER AN UNPROVEN MEASURE CARRIES metric: null ***', () => {
  // 最新/最近 are dates; 最少 is the opposite end; 最平/最貴 are prices. None is ordered here.
  for (const h of ['最新入貨', '最近入貨', '最少要補', '最平嗰幾項', '最貴三項']) {
    const c = classifySectionHeading(h)
    assert.equal(c.claim, true, h + ' is still a claim')
    assert.equal(c.metric, null, '⛔ an unproven measure borrowed the shortfall proof: ' + h)
  }
})

/* ═══ COMMIT A — GATE ORDER AND THE ZERO-SOURCE BYPASS ══════════════════ */

const NAPA = 'Napa Cabbage'
const JARS = 'Jars for Red Chili Oil'
const NOLA = 'New Orleans Style Sauce'
const SOY = 'Dark Soy Sauce'

const SEC = (heading, titles) => ({ heading, items: titles.map((t) => ({ title: t })) })
/** The proven order, 75 > 39 > 37 > 20. */
const ROWS = [NAPA, NOLA, SOY, JARS].map((t, i) => ({ title: t, canonical: 'aroma_system.inventory#' + (i + 1) }))
const PROOF = { rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingCompleteWithinScope: true }

const gate = (sections, over = {}) => rankingSectionViolations(Object.assign({
  sections, rankedRows: ROWS, rankingEvidence: PROOF, rankedSourceCount: 1
}, over))

test('*** ⛔ THE PRODUCTION DEFECT: 「目前最缺的四項」 IN THE WRONG ORDER IS REFUSED ***', () => {
  // The exact order the Owner received.
  assert.deepEqual(gate([SEC('目前最缺的四項', [JARS, NAPA, NOLA, SOY])]), [0])
})

test('*** ⛔ THE ZERO-SOURCE BYPASS IS CLOSED — a claim with NO proof is refused ***', () => {
  // ⛔ This is the case that used to return before any heading was read.
  assert.deepEqual(gate([SEC('目前最缺的四項', [NAPA, NOLA, SOY, JARS])], { rankedSourceCount: 0, rankedRows: [], rankingEvidence: null }), [0],
    '⛔ a ranking claim shipped with no ranking proof at all')
})

test('*** ⛔ AND A NON-CLAIM SECTION IS STILL UNTOUCHED WITH ZERO SOURCES ***', () => {
  assert.deepEqual(gate([SEC('缺貨狀況', [JARS, NAPA])], { rankedSourceCount: 0, rankedRows: [], rankingEvidence: null }), [],
    '⛔ the gate fired on an ordinary section')
})

test('*** ⛔ AN UNPROVEN METRIC IS REFUSED BEFORE ANY ORDER CHECK ***', () => {
  // Order is irrelevant: nothing proves a 「最新」 ordering, so it cannot ship either way.
  assert.deepEqual(gate([SEC('最新入貨三項', [NAPA, NOLA, SOY])]), [0])
  assert.deepEqual(gate([SEC('最少要補三項', [JARS, SOY, NOLA])]), [0])
})

test('*** ⛔ MULTIPLE RANKED SOURCES STAY FAIL CLOSED ***', () => {
  assert.deepEqual(gate([SEC('目前最缺的四項', [NAPA, NOLA, SOY, JARS])], { rankedSourceCount: 2 }), [0])
})

test('*** ⛔ AN INCOMPLETE PROOF IS REFUSED EVEN IN THE RIGHT ORDER ***', () => {
  assert.deepEqual(gate([SEC('目前最缺的四項', [NAPA, NOLA, SOY, JARS])], {
    rankingEvidence: { rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingCompleteWithinScope: false }
  }), [0])
})

test('*** and the correct top-four in the proven order is ALLOWED ***', () => {
  assert.deepEqual(gate([SEC('目前最缺的四項', [NAPA, NOLA, SOY, JARS])]), [])
})
