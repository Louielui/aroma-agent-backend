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

const { classifySectionHeading, RANKING_METRIC } = require('./rankingProof')
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

const SEC = (heading, ids, rows) => ({
  heading,
  items: ids.map((id) => ({ sourceId: id, title: (rows.find((r) => r.sourceId === id) || {}).title, facts: [] }))
})

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
  const line = logLine([SEC('訂貨建議排序', ['1', '2', '3'], opRows)], [opEvidence()], opGroups)
  assert.deepEqual(line.rankingGate, [{ status: 'evaluated_allowed', reason: null, rankedSourceCount: 1 }],
    '⛔ a real ranking proof was reported as absent: ' + JSON.stringify(line.rankingGate))
})

test('*** E8b. ⛔ AND THE SAME TURN STILL REFUSES A WRONG ORDER ***', () => {
  const line = logLine([SEC('訂貨建議排序', ['2', '1'], opRows)], [opEvidence()], opGroups)
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
  const sec = { heading: '最多要訂嗰兩項', items: [{ sourceId: '7', title: 'X', facts: [] }, { sourceId: '8', title: 'Y', facts: [] }] }
  const line = logLine([sec], [invEv, opEvidence()], groups)
  assert.equal(line.rankingGate[0].status, 'evaluated_rejected', '⛔ inventory rows rode the replenishment proof')
})

test('*** E8d. ⛔ A PROOF WHOSE OPERATION HAS NO GROUP REPORTS no_ranking_proof ***', () => {
  const invRows = [rowOf(OP_INVENTORY, '7', 'X')]
  const sec = { heading: '訂貨建議排序', items: [{ sourceId: '7', title: 'X', facts: [] }] }
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
  const line = logLine([SEC('訂貨建議排序', ['1', '2'], legacyRows)], [legacyEv],
    [{ source: 'aroma_system', readKey: 'aroma_system', items: legacyRows }])
  assert.deepEqual(line.rankingGate, [{ status: 'evaluated_allowed', reason: null, rankedSourceCount: 1 }])
})

/* ═══ BLOCKER 9 — a count may never restart mid-token ═══════════════════ */

test('*** E9. ⛔ 「一億二項」 AND 「廿二項」 ARE count_unparsed, NEVER N=2 ***', () => {
  for (const h of ['最缺一億二項', '最缺廿二項']) {
    const c = classifySectionHeading(h)
    assert.equal(c.claim, true, h + ' is still a claim')
    assert.notEqual(c.n, 2, '⛔ ' + h + ' silently became a top-2 claim')
    assert.equal(c.n, null, h)
    assert.equal(c.countUnparsed, true, h)
  }
})

test('*** E9b. ⛔ AND SUCH A HEADING FAILS CLOSED WITH TWO CORRECT ITEMS PRESENT ***', () => {
  // ⛔ 'P','Q' ARE the proven top two, so a mis-parsed N=2 would have PASSED. That is what makes
  // this fixture able to expose the defect at all.
  // ⛔ An ORDERING heading, deliberately: it asserts no metric, so the metric check cannot fire
  // first and the COUNT is what is under test. A shortage superlative here would be refused as
  // metric_not_proven against a suggested_order_qty proof — a true verdict for another reason.
  for (const h of ['訂貨建議排序一億二項', '訂貨建議排序廿二項']) {
    const line = logLine([SEC(h, ['1', '2'], opRows)], [opEvidence()], opGroups)
    assert.equal(line.rankingGate[0].status, 'evaluated_rejected', h)
    assert.equal(line.rankingGate[0].reason, 'count_unparsed', h + ' reason: ' + line.rankingGate[0].reason)
  }
})

test('*** E9c. and the readable counts are unchanged ***', () => {
  assert.equal(classifySectionHeading('最缺四項').n, 4)
  assert.equal(classifySectionHeading('最缺十項').n, 10)
  assert.equal(classifySectionHeading('最缺十二項').n, 12)
  assert.equal(classifySectionHeading('最缺二十一項').n, 21)
})

test('*** E9d. ⛔ THE RULE IS STRUCTURAL, NOT A LIST — an unseen numeral also fails closed ***', () => {
  // 卅 was never named in a blocker. It must behave like 廿 without anyone adding it as a case.
  const c = classifySectionHeading('最缺卅二項')
  assert.equal(c.n, null, '⛔ 卅二 became a different count')
  assert.equal(c.countUnparsed, true)
})
