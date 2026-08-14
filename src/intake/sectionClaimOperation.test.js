'use strict'

/**
 * sectionClaimOperation.test.js — Commit E, the last two reviewer blockers.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ 8. THE OPERATION NAME WAS REBUILT INSTEAD OF USED. Commit D derived it as
 *    `source + "." + endpoint`, which works for inventory ONLY because its endpoint and its
 *    operation happen to share a name. Order Planning is the standing counter-example and is
 *    already in production: `readOperations.js:72` names the operation
 *    `aroma_system.replenishment` while the adapter's endpoint is `orderPlanning`. Derivation
 *    produced `aroma_system.orderPlanning`, matched nothing, and a real ranking proof was
 *    reported as `no_ranking_proof`.
 *
 *    ⛔ AND THE COMMIT D TESTS COULD NOT HAVE CAUGHT IT. They called themselves
 *    production-shaped but omitted the `readKey` that `readContext.js:840` actually attaches,
 *    and used inventory, whose two names coincide. A fixture that cannot expose the defect is
 *    not evidence — the same false-green shape as earlier in this task.
 *
 * ⛔ 9. THE COUNT COULD STILL RESTART AFTER AN UNRECOGNISED CHARACTER. 「一億二項」 and 「廿二項」
 *    both failed at the first character and matched the trailing 「二項」 → N=2. Appending one
 *    character per bug found is a queue, not a rule.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { looksLikeRankingHeading, RANKING_METRIC } = require('./rankingProof')
const { validatePlan, logAnswerPlan } = require('./answerPlan')

/* ── production shape: readKey on the evidence AND on every row ───────── */

const OP_REPLENISH = 'aroma_system.replenishment' // operation
const EP_ORDER_PLANNING = 'orderPlanning' //          endpoint — deliberately a different name
const OP_INVENTORY = 'aroma_system.inventory'

const rowOf = (readKey, id, title) => ({ source: 'aroma_system', readKey, sourceId: id, title, entityType: 'order_suggestion', content: 'x', fields: { id }, trust: 'live' })

/** Order Planning rows, in the proven suggested_order_qty order. */
const opRows = [rowOf(OP_REPLENISH, '1', 'P'), rowOf(OP_REPLENISH, '2', 'Q'), rowOf(OP_REPLENISH, '3', 'R')]

/**
 * ⛔ EXACTLY WHAT `readContext.js:840` EMITS: the descriptor with `readKey` stamped on it.
 * Its `endpoint` is the adapter's (`orderPlanning`); its `readKey` is the operation.
 */
const opEvidence = (over) => Object.assign({
  source: 'aroma_system', entityType: 'order_suggestion', endpoint: EP_ORDER_PLANNING,
  readKey: OP_REPLENISH, trust: 'live',
  shownCount: 3, matchingTotal: 39, sourceTotal: null,
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  rowShape: { hasLocation: false, hasAsOf: false, note: null },
  metrics: {}, derivations: {}, fieldLabels: {}, completeness: 'sample',
  rankingMetric: RANKING_METRIC.SUGGESTED_ORDER_QTY, rankingDirection: 'desc', rankingCompleteWithinScope: true
}, over || {})

const SEC = (heading, ids, rows, rankingClaim) => ({
  heading,
  rankingClaim: rankingClaim || null,
  items: ids.map((id) => ({ sourceId: id, title: (rows.find((r) => r.sourceId === id) || {}).title, facts: [] }))
})

/**
 * ⛔ TASK 001-H: THE CLAIM IS DECLARED, AND THE HEADING IS ONLY A LEAK-GUARD.
 * Blockers 8 (operation identity) and 9-11 (the count) were closed on this file. Blocker 8 is
 * unchanged and still asserted below. Blockers 9-11 were all the same defect — a heading being
 * asked how many — and are now asserted as 「this shape cannot ship undeclared」 instead.
 */
const ORD = { kind: 'ordering', n: null, metric: null }
const TOP_SHORT = (n) => ({ kind: 'top_n', n, metric: RANKING_METRIC.ABSOLUTE_SHORTFALL })
const SUP_SHORT = { kind: 'superlative', n: null, metric: RANKING_METRIC.ABSOLUTE_SHORTFALL }
const TOP_ORDER_QTY = (n) => ({ kind: 'top_n', n, metric: RANKING_METRIC.SUGGESTED_ORDER_QTY })

function logLine (sections, evidenceSets, itemsBySource) {
  const r = validatePlan({ directAnswer: '', sections, limitations: [], followUp: null, unanswerable: false, citesEvidence: true },
    { evidenceSets, itemsBySource, message: '訂貨建議點？' })
  const lines = []
  logAnswerPlan({
    requestId: '11111111-2222-4333-8444-555555555555',
    outcome: 'degraded', reason: 'answer_unsupported',
    droppedItems: r.droppedItems, droppedFacts: r.droppedFacts, droppedSentences: r.droppedSentences,
    droppedLimitations: 0, modelItemCount: r.modelItemCount, keptItemCount: r.keptItemCount,
    drops: r.drops, rankingVerdicts: r.rankingVerdicts
  }, (l) => lines.push(l))
  return lines[0]
}

const opGroups = [{ source: 'aroma_system', readKey: OP_REPLENISH, items: opRows }]

/* ═══ BLOCKER 8 — use the operation identity the system already wrote ═══ */

test('*** E8. ⛔ A DIRECTED aroma_system.replenishment TURN FINDS ITS OWN PROOF ***', () => {
  // ⛔ The operation and the endpoint have DIFFERENT names. Rebuilding source + endpoint yields
  // `aroma_system.orderPlanning`, which matches no group — and a real proof reads as absent.
  const line = logLine([SEC('訂貨建議排序', ['1', '2', '3'], opRows, ORD)], [opEvidence()], opGroups)
  assert.deepEqual(line.rankingGate, [{ status: 'evaluated_allowed', reason: null, rankedSourceCount: 1 }],
    '⛔ a real ranking proof was reported as absent: ' + JSON.stringify(line.rankingGate))
})

test('*** E8b. ⛔ AND THE SAME TURN STILL REFUSES A WRONG ORDER ***', () => {
  const line = logLine([SEC('訂貨建議排序', ['2', '1'], opRows, ORD)], [opEvidence()], opGroups)
  assert.equal(line.rankingGate[0].status, 'evaluated_rejected')
  assert.equal(line.rankingGate[0].reason, 'order_mismatch', 'reason: ' + line.rankingGate[0].reason)
})

test('*** E8c. ⛔ THE PROOF STILL MAY NOT REACH A DIFFERENT OPERATION\'S ROWS ***', () => {
  // Two operations under one source; only replenishment carries a proof. The inventory rows are
  // ordered so they WOULD satisfy a top-two claim if the wrong group were bound.
  const invRows = [rowOf(OP_INVENTORY, '7', 'X'), rowOf(OP_INVENTORY, '8', 'Y')]
  const groups = [{ source: 'aroma_system', readKey: OP_INVENTORY, items: invRows }, ...opGroups]
  const invEv = Object.assign(opEvidence(), { readKey: OP_INVENTORY, endpoint: 'inventory' })
  delete invEv.rankingMetric
  const sec = { heading: '最多要訂嗰兩項', rankingClaim: TOP_ORDER_QTY(2), items: [{ sourceId: '7', title: 'X', facts: [] }, { sourceId: '8', title: 'Y', facts: [] }] }
  const line = logLine([sec], [invEv, opEvidence()], groups)
  assert.equal(line.rankingGate[0].status, 'evaluated_rejected', '⛔ inventory rows rode the replenishment proof')
})

test('*** E8d. ⛔ A PROOF WHOSE OPERATION HAS NO GROUP REPORTS no_ranking_proof ***', () => {
  const invRows = [rowOf(OP_INVENTORY, '7', 'X')]
  const sec = { heading: '訂貨建議排序', rankingClaim: ORD, items: [{ sourceId: '7', title: 'X', facts: [] }] }
  const line = logLine([sec], [opEvidence()], [{ source: 'aroma_system', readKey: OP_INVENTORY, items: invRows }])
  assert.equal(line.rankingGate[0].reason, 'no_ranking_proof', 'reason: ' + line.rankingGate[0].reason)
  assert.equal(line.rankingGate[0].rankedSourceCount, 0)
})

test('*** E8e. and LEGACY evidence with no readKey still resolves its single group ***', () => {
  // ⛔ The only sanctioned fallback: no readKey at all, one candidate group, and that group
  // carries no operation of its own. Nothing is rebuilt from source + endpoint.
  const legacyRows = [{ source: 'aroma_system', readKey: 'aroma_system', sourceId: '1', title: 'P', entityType: 'order_suggestion', content: 'x', fields: { id: '1' }, trust: 'live' },
    { source: 'aroma_system', readKey: 'aroma_system', sourceId: '2', title: 'Q', entityType: 'order_suggestion', content: 'x', fields: { id: '2' }, trust: 'live' }]
  const legacyEv = opEvidence()
  delete legacyEv.readKey
  const line = logLine([SEC('訂貨建議排序', ['1', '2'], legacyRows, ORD)], [legacyEv],
    [{ source: 'aroma_system', readKey: 'aroma_system', items: legacyRows }])
  assert.deepEqual(line.rankingGate, [{ status: 'evaluated_allowed', reason: null, rankedSourceCount: 1 }])
})

/* ═══════════════════════════════════════════════════════════════════════
   ⛔ BLOCKERS 9-12 — FOUR ROUNDS OF ASKING A HEADING HOW MANY
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every case below once produced a count nobody wrote:
 *
 *   「最缺一億二項」 → 2     the numeral run restarted after an unlisted 億      (Blocker 9)
 *   「最缺壱十二項」 → 12    壱 was outside the character list                    (Blocker 10)
 *   「最缺卄項」    → none  and 「no count」 means 「as many as you listed」        (Blocker 11)
 *   「最缺四項食材」 → none  because an ordinary NOUN follows the counter          (Blocker 12)
 *
 * Each fix widened a vocabulary and the next character walked around it. Measured on
 * `superlative-section@b8c3719`, the only variant that satisfied Blocker 12 reopened Blockers
 * 10 and 11 in one test run. So the heading is no longer asked: it is only recognised, and a
 * section that presents a ranking without declaring one is refused whatever it says.
 */

/** ⛔ A SHORTAGE claim needs an INVENTORY proof; the order-planning proof would be refused
 * as metric_not_proven — a true verdict for the wrong reason, telling us nothing. */
const shortageRows = [rowOf(OP_INVENTORY, '1', 'P'), rowOf(OP_INVENTORY, '2', 'Q'), rowOf(OP_INVENTORY, '3', 'R')]
const shortageGroups = [{ source: 'aroma_system', readKey: OP_INVENTORY, items: shortageRows }]
const shortageEvidence = () => opEvidence({ readKey: OP_INVENTORY, endpoint: 'inventory', rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL })
const shortageLine = (heading, ids, claim) => logLine([SEC(heading, ids, shortageRows, claim)], [shortageEvidence()], shortageGroups)

const ONCE_MISREAD = [
  ['最缺一億二項', 'Blocker 9 — restarted after 億, read as 2'],
  ['最缺廿二項', 'Blocker 9 — restarted after 廿, read as 2'],
  ['最缺一万二項', 'Blocker 10 — 万 was never in the list'],
  ['最缺壱十二項', 'Blocker 10 — 壱, the accounting one, read as 12'],
  ['最缺弐十二項', 'Blocker 10 — 弐, likewise'],
  ['最缺陌二項', 'Blocker 10 — 陌, an archaic 100'],
  ['最缺卄項', 'Blocker 11 — a written count became no count'],
  ['最缺壱項', 'Blocker 11 — likewise'],
  ['目前最缺的四項排序', 'Blocker 11 — the count between two markers was skipped'],
  ['目前最缺四項食材', 'Blocker 12 — an ordinary noun follows the counter'],
  ['最缺三個貨品', 'Blocker 12 — counter plus noun'],
  ['最缺兩款產品', 'Blocker 12 — counter plus noun'],
  ['最緊急缺貨項目', 'a genuine no-N superlative — still a ranking claim']
]

test('*** H-E9. ⛔ EVERY SHAPE THAT DEFEATED THE PARSER IS STILL RECOGNISED ***', () => {
  for (const [heading, why] of ONCE_MISREAD) {
    assert.equal(looksLikeRankingHeading(heading), true, '⛔ the leak-guard missed ' + heading + ' — ' + why)
  }
})

test('*** H-E9b. ⛔ AND EACH FAILS CLOSED WITH TWO CORRECT ITEMS PRESENT ***', () => {
  // ⛔ '1','2' ARE the proven top two, so any heading quietly read as a top-2 would have PASSED.
  // That is what makes these fixtures able to expose the defect at all.
  for (const [heading] of ONCE_MISREAD) {
    const line = shortageLine(heading, ['1', '2'], null)
    assert.equal(line.rankingGate[0].status, 'evaluated_rejected', heading)
    assert.equal(line.rankingGate[0].reason, 'ranking_claim_missing', heading + ': ' + line.rankingGate[0].reason)
  }
})

/* ═══ AND THE FEATURE STILL WORKS — declared, verified, allowed ═════════ */

test('*** H-G11. ⛔ A TWENTY-CLAIM SHOWING ONE ROW IS REFUSED — Blocker 11, structurally ***', () => {
  // The exact shape that passed before: 卄 = twenty, section lists only the proven first row.
  const line = shortageLine('最缺卄項', ['1'], TOP_SHORT(20))
  assert.equal(line.rankingGate[0].status, 'evaluated_rejected')
  assert.equal(line.rankingGate[0].reason, 'cardinality_mismatch', 'reason: ' + line.rankingGate[0].reason)
})

test('*** H-G11b. ⛔ A FOUR-CLAIM SHOWING THREE IS REFUSED — the production heading ***', () => {
  const line = shortageLine('目前最缺的四項排序', ['1', '2', '3'], TOP_SHORT(4))
  assert.equal(line.rankingGate[0].status, 'evaluated_rejected', '⛔ a four-item claim passed showing three')
  assert.equal(line.rankingGate[0].reason, 'cardinality_mismatch', 'reason: ' + line.rankingGate[0].reason)
})

test('*** H-G11c. A GENUINE NO-N SUPERLATIVE IS STILL LEGITIMATE ***', () => {
  // 「最緊急缺貨項目」 claims a prefix of what it shows, and the proven first row is one.
  const line = shortageLine('最緊急缺貨項目', ['1'], SUP_SHORT)
  assert.equal(line.rankingGate[0].status, 'evaluated_allowed', 'reason: ' + line.rankingGate[0].reason)
})

test('*** H-G11d. AND THE HONEST DECLARED COUNTS ALL PASS ***', () => {
  for (const n of [1, 2, 3]) {
    const ids = ['1', '2', '3'].slice(0, n)
    const line = shortageLine('目前最缺的幾項', ids, TOP_SHORT(n))
    assert.equal(line.rankingGate[0].status, 'evaluated_allowed', 'n=' + n + ': ' + line.rankingGate[0].reason)
  }
})
