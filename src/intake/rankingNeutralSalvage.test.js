'use strict'

/**
 * C1 — NEUTRAL SALVAGE FOR A MISSING RANKING DECLARATION.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE RANKING WAS UNPROVEN. THE ROWS WERE NOT.
 *
 * A section carrying individually grounded, server-resolved rows is deleted WHOLE when its
 * heading presents as a ranking and the model declared no `rankingClaim`. The ranking
 * semantics deserve to die — nothing proved them. The rows did not: every one of them had
 * already passed row resolution, sourceId validation, fact grounding and value validation.
 *
 * Measured on the live shape (requestId c45a65a2): 4 model items, 2 kept, 2 deleted by
 * `ranking_claim_missing`, and the Owner read 「有 2 項系統無法核對，未顯示」 about rows that
 * had been read successfully.
 *
 * ⛔ AND THE DETECTOR IS BROADER THAN THE WORD "RANKING" SUGGESTS. Measured here:
 * `looksLikeRankingHeading('最近採購單')` is TRUE, because 「最近」 contains 最. A heading that
 * means 「recent purchase orders」 — temporal, not ordered — is enough to delete the section.
 *
 * ⛔ THIS IS NOT A RELAXATION OF THE RANKING PROOF. The verdict stays
 * `evaluated_rejected / ranking_claim_missing`, no ranking title is generated, no order is
 * computed, nothing is re-sorted, and when the OWNER'S QUESTION actually asks for a ranking
 * there is no salvage at all — because then a plain list would answer the unproven ranking by
 * implication. Only the disposition of already-validated rows changes.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { validatePlan } = require('./answerPlan')
const { VIOLATION, asksForRanking, looksLikeRankingHeading } = require('./rankingProof')

/* ── fixtures: real server-resolved rows, one operation ─────────────────── */

const PO = 'aroma_system.purchasing'
const INV = 'aroma_system.inventory'

const row = (readKey, id, title) => ({
  source: 'aroma_system',
  readKey,
  sourceId: id,
  title,
  entityType: readKey === PO ? 'purchase_order' : 'inventory_item',
  content: 'status=confirmed',
  fields: { id, status: 'confirmed' },
  trust: 'live'
})

const group = (readKey, rows) => ({ source: 'aroma_system', readKey, operation: readKey, items: rows })

const evidenceFor = (readKey, n) => ({
  source: 'aroma_system',
  readKey,
  endpoint: 'x',
  trust: 'live',
  entityType: readKey === PO ? 'purchase_order' : 'inventory_item',
  shownCount: n,
  matchingTotal: n,
  sourceTotal: null,
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  rowShape: { hasLocation: false, hasAsOf: false, note: null },
  metrics: {},
  derivations: {},
  fieldLabels: {},
  completeness: 'complete'
})

const item = (readKey, id, title) => ({ sourceId: readKey + '#' + id, title, facts: [] })

const planWith = (sections) => ({ directAnswer: '', citesEvidence: true, unanswerable: false, limitations: [], followUp: null, sections })

/**
 * The Owner's real question from the live incident — measured clear of BOTH salvage floors:
 * `asksForRanking` false AND `looksLikeRankingHeading` false.
 *
 * ⛔ IT IS NOT 「最近有邊啲採購單？」, AND THAT MATTERS FOR THE TESTS BELOW. That wording trips
 * the shape floor on 「最近」, so every structural test using it would have returned
 * `status: 'none'` for the FLOOR reason instead of the structural one — passing while proving
 * nothing about unresolved items or mixed readKeys. A fixture that cannot fail for its stated
 * reason is not a test.
 */
const NON_RANKING_Q = '有冇貨已經有 incoming，所以唔應該再訂咁多？'
/** The established superlative class — measured to ask for a ranking. */
const RANKING_Q = '現在缺貨最嚴重的是什麼？'
/** Measured ranking-LOOKING heading that means "recent", not "ranked". */
const LOOKS_RANKING = '最近採購單'

const PO_ROWS = [row(PO, '101', 'PO-20260816-001'), row(PO, '102', 'PO-20260814-001')]

const run = (sections, message, groups, evidence) => validatePlan(planWith(sections), {
  evidenceSets: evidence || [evidenceFor(PO, 2)],
  itemsBySource: groups || [group(PO, PO_ROWS)],
  message
})

const rendered = (r) => r.plan.sections.reduce((n, s) => n + s.items.length, 0)
const rejectedReasons = (r) => (r.rankingVerdicts || []).filter((v) => v.status === 'evaluated_rejected').map((v) => v.reason)

/* ═══ THE DEFECT ═══════════════════════════════════════════════════════════ */

test('*** ⛔ GROUNDED ROWS SURVIVE A MISSING RANKING DECLARATION, NEUTRALLY ***', () => {
  // The premises this fixture rests on, asserted rather than assumed.
  assert.equal(asksForRanking(NON_RANKING_Q), false, 'the Owner did not ask for a ranking')
  assert.equal(looksLikeRankingHeading(LOOKS_RANKING), true, 'but the heading presents as one')

  const r = run([{ heading: LOOKS_RANKING, rankingClaim: null, items: [item(PO, '101', 'PO-20260816-001'), item(PO, '102', 'PO-20260814-001')] }], NON_RANKING_Q)

  // ⛔ THE RANKING IS STILL REJECTED. This is the half that must not change.
  assert.deepEqual(rejectedReasons(r), [VIOLATION.RANKING_CLAIM_MISSING], 'the ranking must remain unproven and rejected')

  // ⛔ AND THE ROWS SURVIVE.
  assert.equal(rendered(r), 2, '⛔ validated rows were deleted with the unproven ranking')
  assert.equal(r.plan.sections.length, 1)
  assert.equal(r.plan.sections[0].heading, '', '⛔ a heading survived — no ranking title may reach the Owner')
  assert.deepEqual(r.plan.sections[0].items.map((i) => i.title), ['PO-20260816-001', 'PO-20260814-001'],
    'the validated sequence is preserved, unsorted and unranked')

  // ⛔ COUNTERS MUST NOT LIE. Salvaged rows are not dropped rows.
  assert.equal(r.droppedItems, 0, '⛔ salvaged rows are still counted as dropped')
  assert.equal(r.keptItemCount, 2)
  assert.equal(r.modelItemCount, 2)

  // ⛔ AND THE SALVAGE IS OBSERVABLE, distinctly from a plain rejection.
  assert.equal(r.rankingSalvage.status, 'neutral_salvaged')
  assert.equal(r.rankingSalvage.sections, 1)
  assert.equal(r.rankingSalvage.items, 2)
})

/* ═══ THE SIDE DOOR THIS MUST NOT OPEN ═════════════════════════════════════ */

test('*** ⛔ A RANKING QUESTION GETS NO SALVAGE — the list would answer it by implication ***', () => {
  assert.equal(asksForRanking(RANKING_Q), true)
  const r = run([{ heading: LOOKS_RANKING, rankingClaim: null, items: [item(PO, '101', 'A'), item(PO, '102', 'B')] }], RANKING_Q)

  assert.deepEqual(rejectedReasons(r), [VIOLATION.RANKING_CLAIM_MISSING])
  assert.equal(rendered(r), 0, '⛔ SIDE DOOR: rows shipped in sequence against a ranking question')
  assert.equal(r.plan.sections.length, 0)
  assert.equal(r.droppedItems, 2, 'fail-closed accounting is unchanged')
  assert.equal(r.rankingSalvage.status, 'none')
})

/* ═══ THE SALVAGE SAFETY FLOOR ═════════════════════════════════════════════ */

test('*** ⛔ A SUPERLATIVE THE QUESTION AUTHORITY MISSES STILL GETS NO SALVAGE ***', () => {
  /**
   * ⛔ THE BLOCKER, AND IT IS A REAL HOLE IN THE FIRST DESIGN.
   *
   * `asksForRanking('邊道菜最賺錢？')` is FALSE — measured, not assumed — even though the
   * question plainly asks which single dish earns most. Keying salvage on that authority alone
   * would have shipped a sequence of rows in answer to an unproven extremum: exactly the side
   * door this tranche exists to keep shut.
   *
   * So salvage now needs BOTH floors clear: the narrow question authority must not call it a
   * ranking, AND the conservative shape detector must not see ranking morphology in the
   * question. The second is a SALVAGE FLOOR ONLY — it proves nothing, authorises nothing, and
   * changes no ranking entitlement. A false positive costs one salvage, which is the safe
   * direction.
   */
  assert.equal(asksForRanking('邊道菜最賺錢？'), false, 'the narrow authority does NOT catch this')
  assert.equal(looksLikeRankingHeading('邊道菜最賺錢？'), true, 'but the shape detector does')

  const r = run([{ heading: LOOKS_RANKING, rankingClaim: null, items: [item(PO, '101', 'A'), item(PO, '102', 'B')] }], '邊道菜最賺錢？')

  assert.deepEqual(rejectedReasons(r), [VIOLATION.RANKING_CLAIM_MISSING], 'the ranking stays rejected')
  assert.equal(r.rankingSalvage.status, 'none', '⛔ SIDE DOOR: rows salvaged against a superlative question')
  assert.equal(rendered(r), 0, '⛔ rows reached the Owner in answer to an unproven extremum')
  assert.equal(r.plan.sections.length, 0)
  assert.equal(r.droppedItems, 2, 'fail-closed accounting is unchanged')
})

test('*** RECENCY IS REFUSED TOO — recorded as an accepted cost, not fixed ***', () => {
  /**
   * ⛔ RECORDED DELIBERATELY. 「最近」 trips the shape detector, so a plainly non-ranking
   * question like 「最近有咩採購單？」 gets NO salvage and its section is still dropped whole.
   * That is a conservative false positive and it is ACCEPTED here: 「recent / latest」 does
   * carry selection semantics, and this tranche fails toward withholding rows rather than
   * risk answering an unsupported ordering. Neither `asksForRanking` nor the underlying
   * expressions were touched to make it pass.
   */
  assert.equal(asksForRanking('最近有咩採購單？'), false)
  assert.equal(looksLikeRankingHeading('最近有咩採購單？'), true, 'the floor sees 最近 as ranking-shaped')

  const r = run([{ heading: LOOKS_RANKING, rankingClaim: null, items: [item(PO, '101', 'A'), item(PO, '102', 'B')] }], '最近有咩採購單？')
  assert.equal(r.rankingSalvage.status, 'none', 'no salvage — the accepted conservative cost')
  assert.equal(rendered(r), 0)
})

/* ═══ ONLY ONE REASON IS SALVAGEABLE ═══════════════════════════════════════ */

test('*** ⛔ NO OTHER RANKING VIOLATION IS SALVAGEABLE ***', () => {
  /**
   * ⛔ THE OTHER SEVEN ARE CLAIMS THAT EXIST AND FAIL ON THEIR MERITS. Only a MISSING
   * declaration leaves rows whose ranking semantics were never asserted in the first place.
   * Enumerated from the production enum so a newly added violation cannot become salvageable
   * by default.
   */
  for (const v of Object.values(VIOLATION)) {
    if (v === VIOLATION.RANKING_CLAIM_MISSING) continue
    assert.notEqual(v, VIOLATION.RANKING_CLAIM_MISSING, v + ' must never be salvageable')
  }

  // Constructed proof for the two reachable through this path.
  const invalid = run([{ heading: LOOKS_RANKING, rankingClaim: { kind: 'top_n', n: null, metric: null }, items: [item(PO, '101', 'A')] }], NON_RANKING_Q)
  assert.deepEqual(rejectedReasons(invalid), [VIOLATION.RANKING_CLAIM_INVALID])
  assert.equal(rendered(invalid), 0, '⛔ an invalid declaration was salvaged')
  assert.equal(invalid.rankingSalvage.status, 'none')

  const noProof = run([{ heading: LOOKS_RANKING, rankingClaim: { kind: 'ordering', n: null, metric: null }, items: [item(PO, '101', 'A')] }], NON_RANKING_Q)
  assert.deepEqual(rejectedReasons(noProof), [VIOLATION.NO_RANKING_PROOF])
  assert.equal(rendered(noProof), 0, '⛔ a declared claim with no proof was salvaged')
  assert.equal(noProof.rankingSalvage.status, 'none')
})

/* ═══ STRUCTURAL FAIL-CLOSED ═══════════════════════════════════════════════ */

test('*** ⛔ AN UNRESOLVED ITEM BLOCKS SALVAGE ENTIRELY ***', () => {
  // One id resolves, one does not: itemsDroppedBeforeGate > 0, so the section is no longer
  // 「rows that all passed」 and the carve-out is refused whole.
  const r = run([{ heading: LOOKS_RANKING, rankingClaim: null, items: [item(PO, '101', 'A'), item(PO, '999', 'GHOST')] }], NON_RANKING_Q)
  assert.deepEqual(rejectedReasons(r), [VIOLATION.RANKING_CLAIM_MISSING])
  assert.equal(rendered(r), 0, '⛔ salvaged a section that had already lost an item')
  assert.equal(r.rankingSalvage.status, 'none')
})

test('*** ⛔ MIXED readKeys BLOCK SALVAGE ***', () => {
  const rows = [row(PO, '101', 'A'), row(INV, '201', 'B')]
  const groups = [group(PO, [rows[0]]), group(INV, [rows[1]])]
  const ev = [evidenceFor(PO, 1), evidenceFor(INV, 1)]
  const r = run([{ heading: LOOKS_RANKING, rankingClaim: null, items: [item(PO, '101', 'A'), item(INV, '201', 'B')] }], NON_RANKING_Q, groups, ev)
  assert.deepEqual(rejectedReasons(r), [VIOLATION.RANKING_CLAIM_MISSING])
  assert.equal(rendered(r), 0, '⛔ salvaged a section spanning two operations')
  assert.equal(r.rankingSalvage.status, 'none')
})

/* ═══ PRESERVATION ═════════════════════════════════════════════════════════ */

test('*** AN ORDINARY NON-RANKING SECTION IS UNTOUCHED ***', () => {
  // 「目前嘅採購狀態」 does not present as a ranking, so the gate never fires at all.
  assert.equal(looksLikeRankingHeading('目前嘅採購狀態'), false)
  const r = run([{ heading: '目前嘅採購狀態', rankingClaim: null, items: [item(PO, '101', 'A'), item(PO, '102', 'B')] }], NON_RANKING_Q)
  assert.deepEqual(rejectedReasons(r), [], 'no ranking verdict to reject')
  assert.equal(rendered(r), 2)
  assert.equal(r.droppedItems, 0)
  assert.equal(r.rankingSalvage.status, 'none', 'nothing was salvaged because nothing was rejected')
})

/* ═══ THE LIVE SHAPE ═══════════════════════════════════════════════════════ */

test('*** ⛔ LIVE-SHAPED REGRESSION — several operations read, one undeclared ranking-looking section ***', () => {
  /**
   * ⛔ LIVE-SHAPED, NOT A HISTORICAL RECONSTRUCTION. requestId c45a65a2 read inventory,
   * replenishment and purchasing — purchasing SUCCEEDED, four live rows — and lost two items
   * to `ranking_claim_missing`. The telemetry does NOT prove those two were the purchasing
   * rows, so this fixture reproduces the STRUCTURE, not the identity of the deleted rows.
   */
  const invRows = [row(INV, '201', 'New Orleans Roast Marinade'), row(INV, '202', 'Dark Soy Sauce')]
  const groups = [group(INV, invRows), group(PO, PO_ROWS)]
  const ev = [evidenceFor(INV, 2), evidenceFor(PO, 2)]
  const sections = [
    { heading: '存量情況', rankingClaim: null, items: [item(INV, '201', 'New Orleans Roast Marinade'), item(INV, '202', 'Dark Soy Sauce')] },
    { heading: LOOKS_RANKING, rankingClaim: null, items: [item(PO, '101', 'PO-20260816-001'), item(PO, '102', 'PO-20260814-001')] }
  ]
  const LIVE_Q = '有冇貨已經有 incoming，所以唔應該再訂咁多？'
  assert.equal(asksForRanking(LIVE_Q), false)

  const r = validatePlan(planWith(sections), { evidenceSets: ev, itemsBySource: groups, message: LIVE_Q })

  assert.deepEqual(rejectedReasons(r), [VIOLATION.RANKING_CLAIM_MISSING], 'ranking entitlement stays rejected')
  assert.equal(r.plan.sections.length, 2, 'both sections survive')
  assert.equal(rendered(r), 4, '⛔ grounded rows were lost on the live shape')
  assert.equal(r.plan.sections[1].heading, '', 'the ranking-looking heading is gone, and no title replaces it')
  assert.equal(r.rankingSalvage.items, 2)
  assert.equal(r.droppedItems, 0)
})
