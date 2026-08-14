'use strict'

/**
 * sectionClaimClosure.test.js — Commit C, the four reviewer blockers.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ 1. THE VERDICT NEVER REACHED THE LOG. `onVerdict` existed and production never supplied
 *    it, so every section rejection was recorded as `order_contradicts_proof` whatever the
 *    real cause. Third time this project has shipped a mechanism the real path never called —
 *    `artifactStore` undefined in assembly, and the claim-binding block this codebase itself
 *    described as 「computed, returned, and acted on by nothing」.
 *
 * ⛔ 2. THE PROOF'S METRIC WAS NEVER COMPARED. Entitlement checked only that ONE complete proof
 *    existed. `inventory` proves absolute_shortfall and `orderPlanning` proves
 *    suggested_order_qty — both real — so a shortage claim could ride the wrong ordering.
 *
 * ⛔ 3. ORDERING STILL MATCHED ON TITLES AND ALLOWED ON ZERO MATCHES, so a section headed
 *    「採購單排序」 listing only purchase orders rode the inventory proof. And the duplicate-title
 *    test fed canonical refs production never sends.
 *
 * ⛔ 4. A SINGLE-CHARACTER CJK COUNT TOOK THE TRAILING DIGIT: 「最缺十二項」 became N=2, so a
 *    top-12 claim showing two items would have passed as a correct top-2.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { rankingSectionViolations, RANKING_METRIC } = require('./rankingProof')
const { validatePlan, logAnswerPlan } = require('./answerPlan')

const PROOF = { rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingCompleteWithinScope: true }
const ORDER_QTY_PROOF = { rankingMetric: RANKING_METRIC.SUGGESTED_ORDER_QTY, rankingCompleteWithinScope: true }

/** Rows exactly as itemsBySource supplies them: source, readKey, RAW sourceId, title. */
const rowOf = (id, title) => ({ source: 'aroma_system', readKey: 'aroma_system.inventory', sourceId: id, title })
const ABCD = [rowOf('1', 'A'), rowOf('2', 'B'), rowOf('3', 'C'), rowOf('4', 'D')]
/** Items exactly as validatePlan pushes them: { sourceId, title, facts } with the RAW id. */
const SEC = (heading, ids, rankingClaim, rows = ABCD) => ({
  heading,
  rankingClaim: rankingClaim || null,
  items: ids.map((id) => ({ sourceId: id, title: (rows.find((r) => r.sourceId === id) || {}).title, facts: [] }))
})

/** ⛔ TASK 001-H: the claim is DECLARED. The heading is only a leak-guard now. */
const TOP = (n) => ({ kind: 'top_n', n, metric: RANKING_METRIC.ABSOLUTE_SHORTFALL })
const ORD = { kind: 'ordering', n: null, metric: null }
const OTHER = (n) => ({ kind: 'top_n', n, metric: RANKING_METRIC.SUGGESTED_ORDER_QTY })
const gate = (sections, over = {}) => rankingSectionViolations(Object.assign({
  sections, rankedRows: ABCD, rankingEvidence: PROOF, rankedSourceCount: 1
}, over))

/* ═══ BLOCKER 2 — the proof must be the ordering the claim NAMES ═════════ */

test('*** C2. ⛔ A SHORTAGE SUPERLATIVE MAY NOT USE A suggested_order_qty PROOF ***', () => {
  // ⛔ Both are REAL metrics here, and the list IS in the proven order — so only the metric
  // comparison can refuse it. That comparison did not exist.
  assert.deepEqual(gate([SEC('目前最缺的四項', ['1', '2', '3', '4'], TOP(4))], { rankingEvidence: ORDER_QTY_PROOF }), [0],
    '⛔ a shortage claim was validated against a suggested-order ordering')
})

test('*** C2b. AND A BARE 「排序」 MAY STILL USE THAT PROOF — it names no measure ***', () => {
  assert.deepEqual(gate([SEC('訂貨建議排序', ['1', '2', '3', '4'], ORD)], { rankingEvidence: ORDER_QTY_PROOF }), [],
    '⛔ an ordering claim was refused for naming no metric')
})

test('*** C2c. and the matching proof still passes ***', () => {
  assert.deepEqual(gate([SEC('目前最缺的四項', ['1', '2', '3', '4'], TOP(4))]), [])
})

/* ═══ BLOCKER 3 — raw sourceId identity, production shape ════════════════ */

/** Two rows share a title; only the RAW sourceId tells them apart. */
const DUP = [rowOf('1', 'A'), rowOf('2', 'A'), rowOf('3', 'C')]
const gdup = (sections) => rankingSectionViolations({ sections, rankedRows: DUP, rankingEvidence: PROOF, rankedSourceCount: 1 })

test('*** C3. ⛔ DUPLICATE TITLES, DIFFERENT RAW IDS — A CORRECT TOP-N STILL PASSES ***', () => {
  assert.deepEqual(gdup([SEC('最缺的兩項', ['1', '2'], TOP(2), DUP)]), [], 'raw ids resolve within the ranked source')
  assert.deepEqual(gdup([SEC('最缺的兩項', ['2', '1'], TOP(2), DUP)]), [0], '⛔ and the order still matters')
})

test('*** C3b. ⛔ AN ITEM FROM ANOTHER SOURCE FAILS THE CLAIM CLOSED ***', () => {
  const foreign = { heading: '最缺的兩項', rankingClaim: TOP(2), items: [{ sourceId: '1', title: 'A' }, { sourceId: 'PO-99', title: 'Purchase Order 99' }] }
  assert.deepEqual(gate([foreign]), [0], '⛔ a foreign-source item was counted in a ranking claim')
})

test('*** C3c. ⛔ ORDERING NO LONGER SHIPS ON ZERO MATCHES — the borrowed-proof bypass ***', () => {
  // 「採購單排序」 listing only purchase orders matched no proven title and used to ALLOW,
  // riding the inventory proof: one source entitling another source's ranking.
  const pos = { heading: '採購單排序', rankingClaim: ORD, items: [{ sourceId: 'PO-1', title: 'PO One' }, { sourceId: 'PO-2', title: 'PO Two' }] }
  assert.deepEqual(gate([pos]), [0], '⛔ a foreign ranking rode the inventory proof')
})

test('*** C3d. and an ORDERING subsequence of its OWN rows still passes ***', () => {
  assert.deepEqual(gate([SEC('缺貨排序', ['1', '3'], ORD)]), [], 'A then C is a valid subsequence')
  assert.deepEqual(gate([SEC('缺貨排序', ['3', '1'], ORD)]), [0], 'but not reversed')
})

/* ═══ BLOCKER 4 — CJK counts above ten ══════════════════════════════════ */

/**
 * ⛔ TASK 001-H — BLOCKER 4 WAS A PARSING BLOCKER, AND THE PARSER IS GONE.
 *
 * 「最缺十二項」 once read as a top-2 because a single-character match took the trailing digit.
 * Blockers 9-12 then showed the same failure four more times with four more characters. The
 * count now arrives as an integer beside the section, so 「read as a smaller count」 has no
 * mechanism left — but the property Blocker 4 protected is exactly as load-bearing, and is
 * asserted here on the declared count instead.
 */

test('*** C4. ⛔ A TOP-12 CLAIM SHOWING 2 ITEMS IS REFUSED — the declared count is checked ***', () => {
  // ⛔ '1','2' ARE the proven top two, so a claim silently reduced to 2 would PASS. That is
  // what makes this fixture able to expose the defect at all — it was true of the parser and
  // it is true of the declaration.
  assert.deepEqual(gate([SEC('最缺十二項', ['1', '2'], TOP(12))]), [0], '⛔ a top-12 claim passed showing two')
  assert.deepEqual(gate([SEC('最缺兩項', ['1', '2'], TOP(2))]), [], 'and an honest two-item claim is fine')
})

test('*** C4b. ⛔ A COUNT LARGER THAN THE PROVEN SET IS REFUSED ***', () => {
  // Four rows are proven. A claim of eleven cannot be satisfied by any selection of them.
  assert.deepEqual(gate([SEC('最缺十一項', ['1', '2', '3', '4'], TOP(11))]), [0])
})

test('*** C4c. ⛔ AND A HEADING THAT NAMES A COUNT WITHOUT DECLARING ONE FAILS CLOSED ***', () => {
  /**
   * 「最缺十十項」 was the old unreadable-count case. Every such heading — readable, unreadable,
   * or written with a numeral nobody has listed — now takes the same path: it presents as a
   * ranking, it declared nothing, and it is refused. No vocabulary is consulted.
   */
  for (const h of ['最缺十十項', '最缺一億二項', '最缺卄項', '目前最缺四項食材']) {
    assert.deepEqual(gate([SEC(h, ['1', '2'], null)]), [0], '⛔ ' + h + ' shipped undeclared')
  }
})

/* ═══ BLOCKER 1 — the verdict must reach the REAL log ═══════════════════ */

const EVIDENCE = (over) => [Object.assign({
  // ⛔ readKey as production attaches it (readContext.js:840) — blocker 8.
  source: 'aroma_system', endpoint: 'inventory', readKey: 'aroma_system.inventory', trust: 'live',
  shownCount: 4, matchingTotal: 199, sourceTotal: null,
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  rowShape: { hasLocation: false, hasAsOf: false, note: null },
  metrics: {}, derivations: {}, fieldLabels: {}, completeness: 'sample'
}, over || {})]

/** Run the REAL validatePlan, then the REAL logAnswerPlan projection. */
function loggedRankingDrops (sections, evidenceOver, rows = ABCD) {
  const r = validatePlan({ directAnswer: '', sections, limitations: [], followUp: null, unanswerable: false, citesEvidence: true }, {
    evidenceSets: EVIDENCE(evidenceOver),
    itemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.inventory', items: rows }],
    message: '而家倉存情況點？'
  })
  const lines = []
  logAnswerPlan({
    requestId: '11111111-2222-4333-8444-555555555555',
    outcome: 'degraded', reason: 'answer_unsupported',
    droppedItems: r.droppedItems, droppedFacts: r.droppedFacts, droppedSentences: r.droppedSentences,
    droppedLimitations: 0, modelItemCount: r.modelItemCount, keptItemCount: r.keptItemCount, drops: r.drops
  }, (l) => lines.push(l))
  return (lines[0].dropped || []).filter((d) => d.field === 'ranking_section')
}

const COMPLETE = { rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingDirection: 'desc', rankingCompleteWithinScope: true }
const whyIn = (sections, ev) => { const d = loggedRankingDrops(sections, ev); return d.length ? d[0].why : null }

test('*** C1. ⛔ THE REAL LOG DISTINGUISHES EVERY VERDICT — not one constant ***', () => {
  // ⛔ EXECUTED THROUGH validatePlan -> logAnswerPlan. A unit-level verdict that never reaches
  // the log cannot do the job this whole task exists to do.
  assert.deepEqual(loggedRankingDrops([SEC('缺貨狀況', ['2', '1'])], COMPLETE), [], 'not detected: no drop')
  assert.deepEqual(loggedRankingDrops([SEC('最缺的兩項', ['1', '2'], TOP(2))], COMPLETE), [], 'allowed: no drop')

  assert.equal(whyIn([SEC('最缺的兩項', ['2', '1'], TOP(2))], COMPLETE), 'order_mismatch')
  assert.equal(whyIn([SEC('最缺的兩項', ['1', '3'], TOP(2))], COMPLETE), 'membership_mismatch')
  assert.equal(whyIn([SEC('最新兩項', ['1', '2'], OTHER(2))], COMPLETE), 'metric_not_proven')
  assert.equal(whyIn([SEC('最缺的兩項', ['1', '2'], TOP(2))], { rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingCompleteWithinScope: false }), 'ranking_incomplete')
  // Evidence with no rankingMetric at all: the turn has zero ranked sources.
  assert.equal(whyIn([SEC('最缺的兩項', ['1', '2'], TOP(2))], {}), 'no_ranking_proof')
})

test('*** C1b. ⛔ THE LOGGED DROP CARRIES ENUM AND COUNT ONLY — no content ***', () => {
  const rows = [rowOf('1', 'Napa Cabbage'), rowOf('2', 'Jars for Red Chili Oil')]
  /**
   * ⛔ THE NOTE THIS TEST CARRIED IS NOW OBSOLETE, AND THAT IS THE POINT OF TASK 001-H.
   * It recorded that an ungrounded token in the heading made `validatePlan` blank the heading,
   * so the claim vanished and no verdict was produced. The claim no longer lives in the heading:
   * it is a field, the heading is blanked for EVERY ranking section by design, and the verdict
   * is produced either way. A whole class of 「the claim disappeared」 went with it.
   */
  const sec = {
    heading: '目前最缺的兩項',
    rankingClaim: TOP(2),
    items: [
      { sourceId: '2', title: 'Jars for Red Chili Oil', facts: [{ field: '缺口', value: '75' }] },
      { sourceId: '1', title: 'Napa Cabbage', facts: [] }
    ]
  }
  const drops = loggedRankingDrops([sec], COMPLETE, rows)
  assert.equal(drops.length, 1, 'the rejection reached the log')
  const json = JSON.stringify(drops)
  for (const banned of ['目前最缺的兩項', 'Napa Cabbage', 'Jars for Red Chili Oil', '75', '缺口']) {
    assert.ok(!json.includes(banned), '⛔ content reached the log: ' + json)
  }
  assert.equal(drops[0].why, 'order_mismatch')
  assert.equal(drops[0].shape, 'evaluated_rejected')
  assert.equal(drops[0].length, 1, 'rankedSourceCount rides as a plain count')
})
