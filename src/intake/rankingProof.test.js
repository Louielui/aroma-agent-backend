'use strict'

/**
 * rankingProof.test.js — a first place must be PROVEN, not written.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE ACCEPTANCE CASE THE OWNER NAMED, observed on the UI 2026-08-12, bootCommit 0bcdc2f:
 * replies that put Jars for Red Chili Oil (shortfall 20) AHEAD of Napa Cabbage (shortfall 70).
 *
 * > **Owner: a test asserting only that the word 「最嚴重」 appears is not sufficient — assert
 * > the ORDER against the proven ranking.**
 *
 * So the contradicting-order test below does not look for a word. It builds an answer whose
 * order disagrees with the adapter's proven ordering and requires that it not ship.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  RANKING_METRIC, DEFAULT_SHORTAGE_METRIC, VERDICT,
  asksForRanking, asksProportionally, metricAskedFor, presentedOrder, verifyRanking
} = require('./rankingProof')

const NAPA = 'Napa Cabbage' //  shortfall 70 — the proven first place
const JARS = 'Jars for Red Chili Oil' // shortfall 20

/** Rows as the adapter hands them over: ALREADY sorted, largest absolute shortfall first. */
const RANKED_ROWS = [
  { title: NAPA, sourceId: '1' },
  { title: JARS, sourceId: '2' }
]

const inventoryEvidence = (over = {}) => Object.assign({
  source: 'aroma_system',
  endpoint: 'inventory',
  trust: 'live',
  rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL,
  rankingDirection: 'desc',
  rankingCompleteWithinScope: true
}, over)

const orderPlanningEvidence = () => inventoryEvidence({
  endpoint: 'orderPlanning',
  rankingMetric: RANKING_METRIC.SUGGESTED_ORDER_QTY,
  // ⛔ The server cut at LIMIT 100 BEFORE the client sorted — first-of-what-arrived only.
  rankingCompleteWithinScope: false
})

const EXTREMUM = (metric) => [{ claimKind: 'extremum', metric }]

const ASK = '現在缺貨最嚴重的是什麼？'

/* ═══ THE QUESTION ═══════════════════════════════════════════════════════ */

test('*** a superlative question is recognised by SHAPE, not by a topic vocabulary ***', () => {
  for (const q of [ASK, '邊個最缺？', '缺貨排序點樣？', '最緊急係邊樣', 'what is the worst shortage', 'top 3 shortages']) {
    assert.equal(asksForRanking(q), true, 'missed: ' + q)
  }
  // ⛔ Ordinary questions must not enter this gate at all.
  for (const q of ['而家倉存有咩？', '牛肉幾錢？', 'show me the invoices', '']) {
    assert.equal(asksForRanking(q), false, 'false positive: ' + q)
  }
})

test('*** ⛔ THE OWNER\'S CONVENTION: 「最嚴重」 IS ABSOLUTE, AND SHE DOES NOT ASK ***', () => {
  assert.equal(DEFAULT_SHORTAGE_METRIC, RANKING_METRIC.ABSOLUTE_SHORTFALL)
  assert.equal(metricAskedFor(ASK), RANKING_METRIC.ABSOLUTE_SHORTFALL,
    '⛔ the default case must resolve without asking him what severe means')
  // A percentage must be asked for explicitly before the metric changes.
  assert.equal(asksProportionally('邊個缺貨百分比最高？'), true)
  assert.equal(metricAskedFor('邊個缺貨百分比最高？'), RANKING_METRIC.PROPORTIONAL_SHORTFALL)
  assert.equal(asksProportionally(ASK), false, '⛔ a plain question must not silently go proportional')
})

/* ═══ 1 — PROVEN ABSOLUTE RANKING SHIPS ══════════════════════════════════ */

test('*** ⛔ 1. SUPERLATIVE + PROVEN ABSOLUTE RANKING → SHIPS, naming the proven first ***', () => {
  const r = verifyRanking({
    message: ASK,
    directAnswer: `缺貨最嚴重嘅係 ${NAPA}，其次係 ${JARS}。`,
    evidenceSets: [inventoryEvidence()],
    rankedRows: RANKED_ROWS,
    claims: EXTREMUM(RANKING_METRIC.ABSOLUTE_SHORTFALL)
  })
  assert.equal(r.verdict, VERDICT.ALLOW, 'verdict: ' + r.verdict)
  assert.equal(r.ok, true)
})

/* ═══ THE ACCEPTANCE CASE ════════════════════════════════════════════════ */

test('*** ⛔ 2. AN ANSWER CONTRADICTING THE PROVEN ORDER DOES NOT SHIP ***', () => {
  // Identical inputs to test 1 except the ORDER of the two items. Nothing about the wording
  // differs — 「最嚴重」 appears in both — so only the order can be what fails.
  const r = verifyRanking({
    message: ASK,
    directAnswer: `最緊急缺貨項目係 ${JARS}，之後係 ${NAPA}。`,
    evidenceSets: [inventoryEvidence()],
    rankedRows: RANKED_ROWS,
    claims: EXTREMUM(RANKING_METRIC.ABSOLUTE_SHORTFALL)
  })
  assert.equal(r.verdict, VERDICT.ORDER_CONTRADICTS_PROOF, '⛔ shipped an order the evidence refutes')
  assert.equal(r.ok, false)
})

/* ═══ 3 — PROPORTIONAL IS A DIFFERENT QUESTION ═══════════════════════════ */

test('*** ⛔ 3. A PROPORTIONAL SUPERLATIVE IS REFUSED — no proportional ordering exists ***', () => {
  const r = verifyRanking({
    message: '邊個缺貨百分比最高？',
    directAnswer: `${JARS} 缺咗 100%。`,
    evidenceSets: [inventoryEvidence()],
    rankedRows: RANKED_ROWS,
    claims: EXTREMUM(RANKING_METRIC.PROPORTIONAL_SHORTFALL)
  })
  assert.equal(r.verdict, VERDICT.METRIC_NOT_PROVEN, 'verdict: ' + r.verdict)
})

test('*** ⛔ 3b. AND THE METRIC MAY NOT BE SWITCHED SILENTLY IN EITHER DIRECTION ***', () => {
  // An absolute ordering answering a proportional question, declared as absolute.
  const swapped = verifyRanking({
    message: '邊個缺貨百分比最高？',
    directAnswer: `${NAPA}。`,
    evidenceSets: [inventoryEvidence()],
    rankedRows: RANKED_ROWS,
    claims: EXTREMUM(RANKING_METRIC.ABSOLUTE_SHORTFALL)
  })
  assert.equal(swapped.verdict, VERDICT.METRIC_NOT_PROVEN,
    '⛔ a percentage question was answered with the absolute ordering')
})

/* ═══ 4 — orderPlanning MAY NOT CLAIM A GLOBAL FIRST ═════════════════════ */

test('*** ⛔ 4. orderPlanning: the server cut precedes the sort → no global first ***', () => {
  const r = verifyRanking({
    message: '訂貨建議入面邊個最多？',
    directAnswer: `${NAPA} 要訂最多。`,
    evidenceSets: [orderPlanningEvidence()],
    rankedRows: RANKED_ROWS,
    claims: EXTREMUM(RANKING_METRIC.SUGGESTED_ORDER_QTY)
  })
  assert.equal(r.verdict, VERDICT.RANKING_INCOMPLETE, 'verdict: ' + r.verdict)
  assert.equal(r.ok, false)
})

/* ═══ PROSE ALONE IS NOT A CLAIM ═════════════════════════════════════════ */

test('*** ⛔ 5. PROSE ALONE MAY NOT ASSERT A FIRST PLACE ***', () => {
  const r = verifyRanking({
    message: ASK,
    directAnswer: `缺貨最嚴重嘅係 ${NAPA}。`, // correct item, but nothing declared it
    evidenceSets: [inventoryEvidence()],
    rankedRows: RANKED_ROWS,
    claims: null
  })
  assert.equal(r.verdict, VERDICT.NO_DECLARED_CLAIM,
    '⛔ an undeclared superlative shipped because it happened to be right')
})

/* ═══ 6 — ORDINARY TURNS ARE UNTOUCHED ═══════════════════════════════════ */

test('*** ⛔ 6. NON-SUPERLATIVE QUESTIONS ARE NOT THIS GATE\'S BUSINESS ***', () => {
  const r = verifyRanking({
    message: '而家倉存有咩？',
    directAnswer: `有 ${NAPA} 同 ${JARS}。`,
    evidenceSets: [inventoryEvidence()],
    rankedRows: RANKED_ROWS,
    claims: null
  })
  assert.equal(r.verdict, VERDICT.NOT_ASKED)
  assert.equal(r.ok, true, '⛔ an ordinary turn was refused')
})

test('*** and a superlative over an UNRANKED source is not refused either ***', () => {
  // Suppliers and invoices carry no ranking. Refusing here would invent a rule for a
  // question this contract has no evidence about.
  const r = verifyRanking({
    message: '邊個供應商最貴？',
    directAnswer: 'Gordon。',
    evidenceSets: [{ source: 'aroma_system', endpoint: 'suppliers', trust: 'live', rankingMetric: null, rankingCompleteWithinScope: false }],
    rankedRows: [],
    claims: null
  })
  assert.equal(r.verdict, VERDICT.NOT_ASKED, 'verdict: ' + r.verdict)
})

/* ═══ THE ORDER READER ═══════════════════════════════════════════════════ */

test('*** presentedOrder reads FIRST MENTION, and ignores rows never named ***', () => {
  assert.deepEqual(presentedOrder(`先講 ${JARS}，再講 ${NAPA}。`, RANKED_ROWS), [JARS, NAPA])
  assert.deepEqual(presentedOrder(`只講 ${NAPA}。`, RANKED_ROWS), [NAPA])
  assert.deepEqual(presentedOrder('乜都冇講。', RANKED_ROWS), [])
  // An answer that names nothing cannot contradict an order — and must not be refused for it.
  const r = verifyRanking({
    message: ASK,
    directAnswer: '暫時睇唔到明顯缺貨。',
    evidenceSets: [inventoryEvidence()],
    rankedRows: RANKED_ROWS,
    claims: EXTREMUM(RANKING_METRIC.ABSOLUTE_SHORTFALL)
  })
  assert.equal(r.verdict, VERDICT.ALLOW)
})

/* ═══ THE DESCRIPTOR ITSELF ══════════════════════════════════════════════ */

test('*** ⛔ inventory MAY assert its ranking; orderPlanning MAY NOT ***', () => {
  const inv = verifyRanking({
    message: ASK,
    directAnswer: `${NAPA}。`,
    evidenceSets: [inventoryEvidence()],
    rankedRows: RANKED_ROWS,
    claims: EXTREMUM(RANKING_METRIC.ABSOLUTE_SHORTFALL)
  })
  assert.equal(inv.ok, true, 'inventory is audited unbounded, so its sort saw everything')

  const cut = verifyRanking({
    message: ASK,
    directAnswer: `${NAPA}。`,
    // Same metric, but the descriptor says the ordering was not complete within scope.
    evidenceSets: [inventoryEvidence({ rankingCompleteWithinScope: false })],
    rankedRows: RANKED_ROWS,
    claims: EXTREMUM(RANKING_METRIC.ABSOLUTE_SHORTFALL)
  })
  assert.equal(cut.verdict, VERDICT.RANKING_INCOMPLETE,
    '⛔ an incomplete ordering still produced an unqualified first place')
})

/* ═══ ⛔ THE WIRING. THE LAST GATE LIKE THIS WAS NEVER CONSUMED. ══════════ */

/**
 * ⛔ `claimBinding` was computed for months and, in `answerPlan.js`'s own words, 「ACTED ON BY
 * NOTHING」. A contract that is only unit-tested is exactly that defect again, so these run
 * through `validatePlan` — the real function on the real path — and assert the answer is
 * actually withheld.
 */
const { validatePlan } = require('./answerPlan')

const WIRED_EVIDENCE = [Object.assign(inventoryEvidence(), {
  shownCount: 2, matchingTotal: 199, sourceTotal: null,
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  rowShape: { hasLocation: false, hasAsOf: false, note: null },
  metrics: {}, derivations: {}, fieldLabels: {}, completeness: 'sample'
})]
const WIRED_ITEMS = [{ source: 'aroma_system', readKey: 'aroma_system', items: RANKED_ROWS }]

test('*** ⛔ WIRED: a contradicting order is WITHHELD by validatePlan, not just judged ***', () => {
  const r = validatePlan({
    directAnswer: `最緊急缺貨項目係 ${JARS}，之後係 ${NAPA}。`,
    sections: [], limitations: [], followUp: null, unanswerable: false,
    answerClaims: EXTREMUM(RANKING_METRIC.ABSOLUTE_SHORTFALL)
  }, { evidenceSets: WIRED_EVIDENCE, itemsBySource: WIRED_ITEMS, message: ASK })
  assert.equal(r.plan.directAnswer, '', '⛔ the contradicting superlative still shipped')
  assert.deepEqual(r.plan.sections, [], '⛔ the ordered list is the same claim in another costume')
})

test('*** ⛔ WIRED: an undeclared superlative is WITHHELD ***', () => {
  const r = validatePlan({
    directAnswer: `缺貨最嚴重嘅係 ${NAPA}。`,
    sections: [], limitations: [], followUp: null, unanswerable: false
  }, { evidenceSets: WIRED_EVIDENCE, itemsBySource: WIRED_ITEMS, message: ASK })
  assert.equal(r.plan.directAnswer, '', '⛔ prose alone asserted a first place')
})

test('*** ⛔ WIRED: an ORDINARY question is untouched — no new refusals ***', () => {
  const answer = `倉存有 ${NAPA}。`
  const r = validatePlan({
    directAnswer: answer,
    sections: [], limitations: [], followUp: null, unanswerable: false
  }, { evidenceSets: WIRED_EVIDENCE, itemsBySource: WIRED_ITEMS, message: '而家倉存有咩？' })
  assert.equal(r.plan.directAnswer, answer, '⛔ the gate fired on a non-superlative turn')
})
