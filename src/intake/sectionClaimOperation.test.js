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

/* ═══════════════════════════════════════════════════════════════════════
   COMMIT F — BLOCKER 10: the boundary was still a hand-written list
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * ⛔ E9 WAS HOLLOW AND THE REVIEWER WAS RIGHT. The lookbehind only blocked a restart after a
 * character that was itself IN `CJK_NUMERAL_CHARS`. Any numeral outside that string reopened
 * the original bug unchanged — measured before the fix:
 *     「最缺一万二項」  → N=2   (万, simplified 10,000, not in the list)
 *     「最缺卄二項」    → N=2   (卄, a variant of 廿)
 *     「最缺壱十二項」  → N=12  (壱, the accounting one)
 * And E9d proved nothing about it, because 卅 was ALREADY in the list: it showed a listed
 * character failing closed, not that an unknown one cannot tail-restart.
 *
 * ⛔ EVERY CASE BELOW USES A CHARACTER THE OLD LIST NEVER CONTAINED.
 */

const NEVER_LISTED = [
  ['最缺一万二項', '万 — simplified 10,000'],
  ['最缺卄二項', '卄 — a variant of 廿'],
  ['最缺壱十二項', '壱 — accounting 1'],
  ['最缺弐十二項', '弐 — accounting 2'],
  ['最缺陌二項', '陌 — an archaic 100']
]

for (const [heading, why] of NEVER_LISTED) {
  test(`*** F10. ⛔ 「${heading}」 IS count_unparsed, NEVER A SMALLER COUNT (${why}) ***`, () => {
    const c = classifySectionHeading(heading)
    assert.equal(c.claim, true, 'still a claim')
    assert.notEqual(c.n, 2, '⛔ tail-restarted into a top-2 claim')
    assert.notEqual(c.n, 12, '⛔ tail-restarted into a top-12 claim')
    assert.equal(c.n, null, heading)
    assert.equal(c.countUnparsed, true, heading)
  })
}

test('*** F10b. ⛔ AND ONE FAILS CLOSED IN THE GATE WITH TWO CORRECT ITEMS PRESENT ***', () => {
  // ⛔ 'P','Q' ARE the proven top two, so any mis-read into N=2 would have PASSED.
  const line = logLine([SEC('訂貨建議排序一万二項', ['1', '2'], opRows)], [opEvidence()], opGroups)
  assert.equal(line.rankingGate[0].status, 'evaluated_rejected')
  assert.equal(line.rankingGate[0].reason, 'count_unparsed', 'reason: ' + line.rankingGate[0].reason)
})

test('*** F10c. THE READABLE COUNTS ARE UNCHANGED — the feature still works ***', () => {
  assert.equal(classifySectionHeading('最缺四項').n, 4)
  assert.equal(classifySectionHeading('最缺十項').n, 10)
  assert.equal(classifySectionHeading('最缺十二項').n, 12)
  assert.equal(classifySectionHeading('最缺二十一項').n, 21)
  assert.equal(classifySectionHeading('目前最缺的四項').n, 4, 'the production heading that began this task')
  assert.equal(classifySectionHeading('最缺4項').n, 4, 'Arabic digits')
  assert.equal(classifySectionHeading('top 3 shortages').n, 3, 'Latin top-N')
})

test('*** F10d. AND A SUPERLATIVE WITH NO COUNT IS NOT MISREAD AS A BROKEN ONE ***', () => {
  // 「最緊急缺貨項目」 contains 項 but claims no count. It must stay a prefix claim, not
  // count_unparsed — otherwise the fix would refuse every honest superlative heading.
  const c = classifySectionHeading('最緊急缺貨項目')
  assert.equal(c.kind, 'superlative')
  assert.equal(c.n, null)
  assert.equal(c.countUnparsed, false, '⛔ a heading with no count was refused as unreadable')
})

/* ═══════════════════════════════════════════════════════════════════════
   COMMIT G — BLOCKER 11: "I could not read N" must never become "there was no N"
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * ⛔ COMMIT F'S OWN CLOSING CLAIM WAS WRONG, AND THE REVIEWER CAUGHT IT.
 * F said under-reading a count could only be stricter. It is not: a demoted heading takes the
 * bare-superlative branch, and that branch uses `n = claimedIds.length` — whatever the section
 * happened to list. So 「最缺卄項」 (卄 = twenty) listing ONE proven row was a prefix of length 1
 * and PASSED. Stricter on order, plainly looser on cardinality.
 *
 * ⛔ AND THE SECOND CASE IS AN EVERYDAY HEADING, not an exotic character:
 * 「目前最缺的四項排序」 — the anchor took the RIGHTMOST claim marker, moved past 排序, and skipped
 * the 四項 in between. A four-item claim became a no-N superlative.
 */

/**
 * ⛔ A SHORTAGE heading asserts absolute_shortfall, so it needs an INVENTORY proof. Testing it
 * against the order-planning proof would be refused as metric_not_proven — a true verdict for
 * the wrong reason, which would tell us nothing about the count.
 */
const shortageRows = [rowOf(OP_INVENTORY, '1', 'P'), rowOf(OP_INVENTORY, '2', 'Q'), rowOf(OP_INVENTORY, '3', 'R')]
const shortageGroups = [{ source: 'aroma_system', readKey: OP_INVENTORY, items: shortageRows }]
const shortageEvidence = () => opEvidence({ readKey: OP_INVENTORY, endpoint: 'inventory', rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL })
const shortageLine = (heading, ids) => logLine([SEC(heading, ids, shortageRows)], [shortageEvidence()], shortageGroups)

test('*** G11. ⛔ 「最缺卄項」 LISTING ONE ROW MUST NOT PASS ***', () => {
  // ⛔ THE EXACT SHAPE THAT PASSED BEFORE: exotic numeral, section lists only proven #1.
  const c = classifySectionHeading('最缺卄項')
  assert.equal(c.countUnparsed, true, '⛔ a written count was read as no count at all')
  assert.equal(c.kind, 'top_n', '⛔ demoted to a bare superlative')
  const line = shortageLine('最缺卄項', ['1'])
  assert.equal(line.rankingGate[0].status, 'evaluated_rejected', '⛔ a top-20 claim shipped showing one item')
  assert.equal(line.rankingGate[0].reason, 'count_unparsed', 'reason: ' + line.rankingGate[0].reason)
})

test('*** G11b. ⛔ 「最缺壱項」 IS NOT A NO-N SUPERLATIVE ***', () => {
  const c = classifySectionHeading('最缺壱項')
  assert.equal(c.countUnparsed, true)
  assert.notEqual(c.kind, 'superlative', '⛔ an asserted quantity became no quantity')
})

test('*** G11c. ⛔ 「目前最缺的四項排序」 STILL YIELDS N=4 ***', () => {
  // ⛔ The anchor must take the EARLIEST claim marker; taking the latest skipped 四項 entirely.
  const c = classifySectionHeading('目前最缺的四項排序')
  assert.equal(c.n, 4, '⛔ the count between two claim markers was skipped')
  assert.equal(c.kind, 'top_n')
})

test('*** G11d. ⛔ AND THAT HEADING LISTING ONLY THREE ITEMS IS REJECTED ***', () => {
  // Three items under a four-item claim: correct order, wrong cardinality.
  const line = shortageLine('目前最缺的四項排序', ['1', '2', '3'])
  assert.equal(line.rankingGate[0].status, 'evaluated_rejected', '⛔ a four-item claim passed showing three')
  assert.equal(line.rankingGate[0].reason, 'membership_mismatch', 'reason: ' + line.rankingGate[0].reason)
})

test('*** G11e. A GENUINE NO-N SUPERLATIVE IS STILL LEGITIMATE ***', () => {
  // 「最緊急缺貨項目」 contains 項 inside the WORD 項目 and claims no quantity. Only a real
  // absence may take the prefix path — but it must still be able to.
  const c = classifySectionHeading('最緊急缺貨項目')
  assert.equal(c.kind, 'superlative')
  assert.equal(c.n, null)
  assert.equal(c.countUnparsed, false, '⛔ a heading with no count was refused as unreadable')
  const line = shortageLine('最緊急缺貨項目', ['1'])
  assert.equal(line.rankingGate[0].status, 'evaluated_allowed', 'the proven first row is a valid prefix')
})

test('*** G11f. THE READABLE COUNTS ARE ALL UNCHANGED ***', () => {
  assert.equal(classifySectionHeading('最缺四項').n, 4)
  assert.equal(classifySectionHeading('最缺十二項').n, 12)
  assert.equal(classifySectionHeading('最缺二十一項').n, 21)
  assert.equal(classifySectionHeading('最缺4項').n, 4)
  assert.equal(classifySectionHeading('top 3 shortages').n, 3)
  assert.equal(classifySectionHeading('目前最缺的四項').n, 4, 'the production heading')
})
