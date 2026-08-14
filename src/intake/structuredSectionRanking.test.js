'use strict'

/**
 * structuredSectionRanking.test.js — TASK 001-H. Cardinality stops being read out of Chinese.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THE PREVIOUS APPROACH WAS ABANDONED, IN ONE LINE PER ROUND.
 *
 *   Blocker  9  「一億二項」 → N=2       a numeral run restarted after an unlisted character
 *   Blocker 10  「壱十二項」 → N=12      the boundary was still a hand-written list
 *   Blocker 11  「最缺卄項」 → no count  and no count means 「however many you listed」
 *   Blocker 12  「最缺四項食材」 → no count  because an ordinary NOUN follows the counter
 *
 * Four rounds, four characters, one shape: deciding HOW MANY from prose needs a vocabulary,
 * every vocabulary was incomplete, and every incompleteness was exploitable. Measured on
 * `superlative-section@b8c3719`: the only variant that satisfied Blocker 12 re-adopted the
 * character list and reopened Blockers 10 and 11 inside a single test run.
 *
 * > **Owner ruling: cardinality is DECLARED by the model in a closed structure and VERIFIED by
 * > the server. Heading parsing is demoted to a leak-guard — it may answer 「is this presenting
 * > a ranking?」 and nothing else.**
 *
 * ⛔ A DECLARATION CONFERS NO AUTHORITY. It says what is being claimed so the server knows what
 * to prove. Every entitlement in A–G still has to be earned: proof ownership by `readKey`,
 * metric, completeness, membership, order.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { rankingSectionViolations, looksLikeRankingHeading, normaliseRankingClaim, RANKING_METRIC } = require('./rankingProof')
const { validatePlan, logAnswerPlan, ANSWER_PLAN_SCHEMA } = require('./answerPlan')
const { buildReadResultReply } = require('./readResultView')

/* ── production shape: readKey on the evidence AND on every row ───────────── */

const OP_INVENTORY = 'aroma_system.inventory'
const OP_REPLENISH = 'aroma_system.replenishment'

const rowOf = (readKey, id, title) => ({
  source: 'aroma_system', readKey, sourceId: id, title, entityType: 'inventory_item',
  content: 'x', fields: { id }, trust: 'live'
})

/** Five rows in the PROVEN absolute-shortfall order. */
const ROWS = ['A', 'B', 'C', 'D', 'E'].map((t, n) => rowOf(OP_INVENTORY, String(n + 1), t))
const GROUPS = [{ source: 'aroma_system', readKey: OP_INVENTORY, items: ROWS }]

const evidenceOf = (over) => Object.assign({
  source: 'aroma_system', entityType: 'inventory_item', endpoint: 'inventory',
  readKey: OP_INVENTORY, trust: 'live',
  shownCount: 5, matchingTotal: 5, sourceTotal: null,
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  rowShape: { hasLocation: false, hasAsOf: false, note: null },
  metrics: {}, derivations: {}, fieldLabels: {}, completeness: 'sample',
  rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingDirection: 'desc',
  rankingCompleteWithinScope: true
}, over || {})

/** A section as the MODEL sends it: a heading, items, and a declared claim (or null). */
const SEC = (heading, titles, rankingClaim) => ({
  heading,
  rankingClaim: rankingClaim === undefined ? null : rankingClaim,
  items: titles.map((t) => {
    const row = ROWS.find((r) => r.title === t)
    return { sourceId: row ? row.sourceId : t, title: t, facts: [] }
  })
})

const TOP = (n) => ({ kind: 'top_n', n, metric: RANKING_METRIC.ABSOLUTE_SHORTFALL })
const SUP = () => ({ kind: 'superlative', n: null, metric: RANKING_METRIC.ABSOLUTE_SHORTFALL })
const ORD = () => ({ kind: 'ordering', n: null, metric: null })

function runPlan (sections, evidenceSets, itemsBySource) {
  return validatePlan(
    { directAnswer: '', sections, limitations: [], followUp: null, unanswerable: false, citesEvidence: true },
    { evidenceSets: evidenceSets || [evidenceOf()], itemsBySource: itemsBySource || GROUPS, message: '而家缺貨最嚴重嘅係咩？' }
  )
}

/** The real log projection — what production actually writes. */
function logLine (sections, evidenceSets, itemsBySource) {
  const r = runPlan(sections, evidenceSets, itemsBySource)
  const lines = []
  logAnswerPlan({
    requestId: '11111111-2222-4333-8444-555555555555',
    outcome: 'degraded', reason: 'answer_unsupported',
    droppedItems: r.droppedItems, droppedFacts: r.droppedFacts, droppedSentences: r.droppedSentences,
    droppedLimitations: 0, modelItemCount: r.modelItemCount, keptItemCount: r.keptItemCount,
    drops: r.drops, rankingVerdicts: r.rankingVerdicts, rankingClaims: r.rankingClaims
  }, (l) => lines.push(l))
  return lines[0]
}

const gateOf = (line) => (line.rankingGate && line.rankingGate[0]) || null

/* ═══════════════════════════════════════════════════════════════════════════
   A. THE SCHEMA — required and nullable, because strict mode has no "optional"
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** H1. ⛔ rankingClaim IS REQUIRED AND NULLABLE, and its enums are closed ***', () => {
  const sec = ANSWER_PLAN_SCHEMA.properties.sections.items
  assert.ok(sec.required.includes('rankingClaim'), '⛔ omitted from required = a live 400 from OpenAI')
  const rc = sec.properties.rankingClaim
  assert.deepEqual(rc.type, ['object', 'null'], 'optionality is a NULL UNION, never an omission')
  assert.equal(rc.additionalProperties, false)
  assert.deepEqual(rc.required.slice().sort(), ['kind', 'metric', 'n'])
  assert.deepEqual(rc.properties.kind.enum, ['ordering', 'superlative', 'top_n'])
  assert.deepEqual(rc.properties.n.type, ['integer', 'null'])
  // ⛔ anyOf, never a union type beside an enum: Anthropic rejects that pairing outright and
  // OpenAI accepts it, so the provider fence is the only thing that can see the difference.
  assert.deepEqual(rc.properties.metric.anyOf, [
    { type: 'string', enum: ['absolute_shortfall', 'suggested_order_qty'] },
    { type: 'null' }
  ])
})

/* ═══════════════════════════════════════════════════════════════════════════
   B. THE LEAK-GUARD — a boolean, and it never counts anything
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** H2. THE LEAK-GUARD ANSWERS ONE QUESTION AND RETURNS A BOOLEAN ***', () => {
  for (const h of ['缺貨排序', '最緊急缺貨項目', '目前最缺四項食材', '最缺卄項', 'top 3 shortages']) {
    assert.equal(looksLikeRankingHeading(h), true, h)
  }
  // ⛔ ORDINARY HEADINGS STAY ORDINARY. A high-recall guard that fires on these would refuse
  // every factual section in the system.
  for (const h of ['缺貨狀況', '缺貨項目', '目前庫存']) {
    assert.equal(looksLikeRankingHeading(h), false, h)
  }
})

test('*** H3. ⛔ A RANKING HEADING WITH NO DECLARATION FAILS CLOSED ***', () => {
  const line = logLine([SEC('缺貨排序', ['A', 'B'], null)])
  assert.equal(gateOf(line).status, 'evaluated_rejected')
  assert.equal(gateOf(line).reason, 'ranking_claim_missing', 'reason: ' + gateOf(line).reason)
})

test('*** H4. ⛔ AND EVERY SHAPE THAT DEFEATED THE PARSER NOW FAILS CLOSED ***', () => {
  /**
   * ⛔ THE FOUR BLOCKERS, AS ONE RULE. Each of these once produced a wrong N or no N at all;
   * none of them can produce a number now, because nothing reads a number from a heading.
   * A section that presents a ranking without declaring one is refused whatever it says.
   */
  const HEADINGS = [
    ['最缺一億二項', 'Blocker 9 — the run restarted after 億'],
    ['最缺壱十二項', 'Blocker 10 — 壱 was outside the list'],
    ['最缺卄項', 'Blocker 11 — an unreadable count became no count'],
    ['目前最缺四項食材', 'Blocker 12 — an ordinary noun follows the counter'],
    ['最缺三個貨品', 'Blocker 12 — counter + noun'],
    ['最缺兩款產品', 'Blocker 12 — counter + noun'],
    ['最緊急缺貨項目', 'a genuine no-N superlative is still a ranking claim']
  ]
  for (const [h, why] of HEADINGS) {
    const line = logLine([SEC(h, ['A'], null)])
    assert.equal(gateOf(line).status, 'evaluated_rejected', h + ' — ' + why)
    assert.equal(gateOf(line).reason, 'ranking_claim_missing', h + ' reason: ' + gateOf(line).reason)
  }
})

test('*** H5. AN ORDINARY SECTION IS UNTOUCHED — heading and all ***', () => {
  for (const h of ['缺貨狀況', '缺貨項目', '目前庫存']) {
    const r = runPlan([SEC(h, ['A', 'B'], null)])
    assert.equal(r.rankingVerdicts[0].status, 'not_detected', h)
    assert.equal(r.plan.sections.length, 1, h + ' — an ordinary section was dropped')
    assert.equal(r.plan.sections[0].heading, h, h + ' — an ordinary heading was rewritten')
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   C. SHAPE VALIDATION — a declaration that contradicts itself proves nothing
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** H6. ⛔ AN ILL-SHAPED DECLARATION IS REFUSED, NOT REPAIRED ***', () => {
  const BAD = [
    [{ kind: 'best', n: null, metric: null }, 'kind outside the enum'],
    [{ kind: 'top_n', n: null, metric: null }, 'top_n with no n'],
    [{ kind: 'top_n', n: 0, metric: null }, 'top_n with n = 0'],
    [{ kind: 'top_n', n: -2, metric: null }, 'a negative n'],
    [{ kind: 'top_n', n: 2.5, metric: null }, 'a fractional n'],
    [{ kind: 'top_n', n: '2', metric: null }, 'n as a string'],
    [{ kind: 'superlative', n: 3, metric: null }, 'superlative carrying an n'],
    [{ kind: 'ordering', n: 1, metric: null }, 'ordering carrying an n'],
    [{ kind: 'top_n', n: 2, metric: 'proportional_shortfall' }, 'a metric nothing sorts by'],
    [{ kind: 'top_n', n: 2, metric: 'made_up' }, 'a metric outside the enum'],
    ['top_n', 'a bare string instead of an object']
  ]
  for (const [claim, why] of BAD) {
    const line = logLine([SEC('缺貨排序', ['A', 'B'], claim)])
    assert.equal(gateOf(line).status, 'evaluated_rejected', why)
    assert.equal(gateOf(line).reason, 'ranking_claim_invalid', why + ' — reason: ' + gateOf(line).reason)
  }
})

test('*** H7. normaliseRankingClaim reports presence and validity SEPARATELY ***', () => {
  // ⛔ 「absent」 and 「present but broken」 are different verdicts. Collapsing them is how a
  // missing declaration would quietly become a shape error, or worse, an allowed section.
  assert.deepEqual(normaliseRankingClaim(null), { present: false, valid: false, kind: null, n: null, metric: null })
  assert.deepEqual(normaliseRankingClaim(undefined), { present: false, valid: false, kind: null, n: null, metric: null })
  assert.equal(normaliseRankingClaim({ kind: 'top_n', n: 2, metric: null }).valid, true)
  assert.equal(normaliseRankingClaim({ kind: 'nope', n: null, metric: null }).present, true)
  assert.equal(normaliseRankingClaim({ kind: 'nope', n: null, metric: null }).valid, false)
})

/* ═══════════════════════════════════════════════════════════════════════════
   D. EVERY A–G ENTITLEMENT STILL HAS TO BE EARNED
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** H8. ⛔ NO RANKED SOURCE — a declaration does not create a proof ***', () => {
  const bare = evidenceOf()
  delete bare.rankingMetric
  delete bare.rankingCompleteWithinScope
  const line = logLine([SEC('缺貨排序', ['A', 'B'], TOP(2))], [bare])
  assert.equal(gateOf(line).reason, 'no_ranking_proof', 'reason: ' + gateOf(line).reason)
})

test('*** H9. ⛔ TWO ORDERINGS IN ONE TURN — attribution is ambiguous, so it is refused ***', () => {
  const second = evidenceOf({ readKey: OP_REPLENISH, endpoint: 'orderPlanning', rankingMetric: RANKING_METRIC.SUGGESTED_ORDER_QTY })
  const groups = GROUPS.concat([{ source: 'aroma_system', readKey: OP_REPLENISH, items: [rowOf(OP_REPLENISH, '9', 'Z')] }])
  const line = logLine([SEC('缺貨排序', ['A', 'B'], TOP(2))], [evidenceOf(), second], groups)
  assert.equal(gateOf(line).reason, 'no_ranking_proof', 'reason: ' + gateOf(line).reason)
})

test('*** H10. ⛔ THE PROOF MUST OWN THESE ROWS — by readKey, not by source name ***', () => {
  // The proof is Order Planning's; the rows on screen are Inventory's. Same source, different
  // operation — the shape that shipped a real ranking as `no_ranking_proof` in Commit E.
  const opEv = evidenceOf({ readKey: OP_REPLENISH, endpoint: 'orderPlanning', rankingMetric: RANKING_METRIC.SUGGESTED_ORDER_QTY })
  const line = logLine([SEC('缺貨排序', ['A', 'B'], TOP(2))], [opEv], GROUPS)
  assert.equal(gateOf(line).reason, 'no_ranking_proof', 'reason: ' + gateOf(line).reason)
  assert.equal(gateOf(line).rankedSourceCount, 0)
})

test('*** H11. ⛔ THE DECLARED METRIC MUST BE THE ONE ACTUALLY SORTED ON ***', () => {
  const claim = { kind: 'top_n', n: 2, metric: RANKING_METRIC.SUGGESTED_ORDER_QTY }
  const line = logLine([SEC('缺貨排序', ['A', 'B'], claim)])
  assert.equal(gateOf(line).reason, 'metric_not_proven', 'reason: ' + gateOf(line).reason)
})

test('*** H12. ⛔ AN INCOMPLETE ORDERING ENTITLES NOTHING, however neat the sequence ***', () => {
  const line = logLine([SEC('缺貨排序', ['A', 'B'], TOP(2))], [evidenceOf({ rankingCompleteWithinScope: false })])
  assert.equal(gateOf(line).reason, 'ranking_incomplete', 'reason: ' + gateOf(line).reason)
})

/* ═══════════════════════════════════════════════════════════════════════════
   E. CARDINALITY — the whole point of the change
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** H13. ⛔ top_n = EXACTLY N ITEMS. Three under a four-claim is refused ***', () => {
  const line = logLine([SEC('缺貨排序', ['A', 'B', 'C'], TOP(4))])
  assert.equal(gateOf(line).status, 'evaluated_rejected', '⛔ a four-item claim shipped showing three')
  assert.equal(gateOf(line).reason, 'cardinality_mismatch', 'reason: ' + gateOf(line).reason)
})

test('*** H14. ⛔ AND ONE ITEM UNDER A TWENTY-CLAIM IS REFUSED — Blocker 11, structurally ***', () => {
  // The exact defect: 「最缺卄項」 (twenty) listing one proven row. The count now arrives as data.
  const line = logLine([SEC('最缺卄項', ['A'], TOP(20))])
  assert.equal(gateOf(line).status, 'evaluated_rejected')
  assert.equal(gateOf(line).reason, 'cardinality_mismatch', 'reason: ' + gateOf(line).reason)
})

test('*** H15. ⛔ A CLAIM LARGER THAN THE PROVEN SET IS REFUSED ***', () => {
  const line = logLine([SEC('缺貨排序', ['A', 'B', 'C', 'D', 'E'], TOP(9))])
  assert.equal(gateOf(line).reason, 'cardinality_mismatch', 'reason: ' + gateOf(line).reason)
})

test('*** H16. top_n = EXACTLY proven[0:N], IN ORDER ***', () => {
  assert.equal(gateOf(logLine([SEC('缺貨排序', ['A', 'B'], TOP(2))])).status, 'evaluated_allowed')
  // Right count, wrong members.
  assert.equal(gateOf(logLine([SEC('缺貨排序', ['A', 'C'], TOP(2))])).reason, 'membership_mismatch')
  // Right members, wrong order.
  assert.equal(gateOf(logLine([SEC('缺貨排序', ['B', 'A'], TOP(2))])).reason, 'order_mismatch')
})

test('*** H17. superlative = AN EXACT PREFIX OF WHAT IS DISPLAYED ***', () => {
  assert.equal(gateOf(logLine([SEC('最缺', ['A'], SUP())])).status, 'evaluated_allowed')
  assert.equal(gateOf(logLine([SEC('最缺', ['A', 'B'], SUP())])).status, 'evaluated_allowed')
  assert.equal(gateOf(logLine([SEC('最缺', ['A', 'C'], SUP())])).reason, 'membership_mismatch')
  assert.equal(gateOf(logLine([SEC('最缺', ['B'], SUP())])).reason, 'membership_mismatch')
})

test('*** H18. ordering KEEPS A–G LEGAL-SUBSEQUENCE SEMANTICS ***', () => {
  // ⛔ Proven A B C D E. A ranking may legitimately show a subset — but never out of order,
  // and never a row the proof does not contain.
  assert.equal(gateOf(logLine([SEC('缺貨排序', ['A', 'C', 'E'], ORD())])).status, 'evaluated_allowed', 'A C E')
  assert.equal(gateOf(logLine([SEC('缺貨排序', ['B', 'D'], ORD())])).status, 'evaluated_allowed', 'B D')
  assert.equal(gateOf(logLine([SEC('缺貨排序', ['A'], ORD())])).status, 'evaluated_allowed', 'A')
  assert.equal(gateOf(logLine([SEC('缺貨排序', ['A', 'C', 'B'], ORD())])).reason, 'order_mismatch', 'A C B')
})

/**
 * ⛔ H19 AS FIRST WRITTEN PROVED NOTHING, AND THE REVIEWER WAS RIGHT TO SAY SO.
 *
 * Its two assertions were `status !== 'evaluated_rejected_never'` — a status that does not
 * exist, so it can never fail — and `sections.length <= 1`, which holds just as well when the
 * section is ALLOWED. The name promised that a foreign row breaks membership; the body checked
 * neither membership nor the outcome. Same false-green family as E9d and the first H35.
 *
 * ⛔ AND THE DEFECT IT WAS SUPPOSED TO COVER WAS REAL. `validatePlan` resolves items before the
 * gate and drops the ones that name no retrieved row, so the gate saw A alone: one item cannot
 * be out of order, and one item IS a valid prefix. The claim was narrowed into a passing one.
 */

const ALIEN = { sourceId: '99', title: 'Z', facts: [] }
const withAlien = (rankingClaim) => ({ heading: '缺貨排序', rankingClaim, items: [{ sourceId: '1', title: 'A', facts: [] }, ALIEN] })

test('*** H19. ⛔ AN ITEM DROPPED BEFORE THE GATE REJECTS THE WHOLE SECTION ***', () => {
  for (const [claim, kind] of [[ORD(), 'ordering'], [SUP(), 'superlative'], [TOP(2), 'top_n']]) {
    const r = runPlan([withAlien(claim)])
    assert.equal(r.plan.sections.length, 0, '⛔ ' + kind + ': a narrowed claim shipped')
    assert.equal(r.rankingVerdicts[0].status, 'evaluated_rejected', kind)
    assert.equal(r.rankingVerdicts[0].reason, 'membership_mismatch', kind + ': ' + r.rankingVerdicts[0].reason)
  }
})

test('*** H19b. AND AN ORDINARY SECTION KEEPS PER-ITEM DROPPING, UNCHANGED ***', () => {
  // ⛔ The rule must not leak onto non-ranking content: one bad row there costs one row, not
  // the section. That is today's behaviour and it is deliberately untouched.
  const r = runPlan([{ heading: '缺貨狀況', rankingClaim: null, items: [{ sourceId: '1', title: 'A', facts: [] }, ALIEN] }])
  assert.equal(r.plan.sections.length, 1, '⛔ an ordinary section was dropped whole')
  assert.equal(r.plan.sections[0].items.length, 1, 'the invented row is gone, the real one stays')
  assert.equal(r.rankingVerdicts[0].status, 'not_detected')
})

/* ═══ THE LEAK-GUARD AND THE WORDING OUR OWN SCHEMA TEACHES ═════════════ */

/**
 * ⛔ THE SCHEMA WAS TEACHING A SHAPE THE GUARD COULD NOT SEE. `rankingClaim.kind`'s own
 * description reads 「top_n＝指定數量的頭 N 項」 — and 「頭四項缺貨」 was classified as an ordinary
 * section, so a wrong order under that heading shipped unchecked.
 */
test('*** H19c. ⛔ 頭 / 前 / 第 OPEN A RANKING, AND WITHOUT A DECLARATION IT FAILS CLOSED ***', () => {
  for (const h of ['頭四項缺貨', '前四項', '第一名', '頭三個最緊要嘅', '前兩位']) {
    assert.equal(looksLikeRankingHeading(h), true, '⛔ the guard missed ' + h)
    const line = logLine([SEC(h, ['A'], null)])
    assert.equal(gateOf(line).reason, 'ranking_claim_missing', h + ': ' + gateOf(line).reason)
  }
})

test('*** H19d. ⛔ AND 「目前庫存」 IS STILL NOT A RANKING — the anchor is what protects it ***', () => {
  // 「目前」 contains 「前」. An unanchored selection word would refuse one of the three ordinary
  // headings this guard exists to leave alone.
  for (const h of ['缺貨狀況', '缺貨項目', '目前庫存', '目前缺口', '存貨清單']) {
    assert.equal(looksLikeRankingHeading(h), false, '⛔ false positive on ' + h)
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   F. THE REPLACEMENT BOUNDARY — the model heading reaches zero downstream bytes
   ═══════════════════════════════════════════════════════════════════════════ */

const SENTINEL = 'ZZ-INJECTED-SENTINEL-ZZ'

test('*** H20. ⛔ ON SUCCESS THE MODEL HEADING IS REPLACED, NOT KEPT ***', () => {
  const r = runPlan([SEC('最缺嘅嘢' + SENTINEL, ['A', 'B'], TOP(2))])
  assert.equal(r.plan.sections.length, 1, 'the section survived')
  const h = r.plan.sections[0].heading
  assert.equal(h.includes(SENTINEL), false, '⛔ the model heading survived into the validated plan')
  assert.equal(h.includes('最缺嘅嘢'), false, '⛔ part of the model heading survived')
  assert.ok(h.length > 0, 'an allowed ranking section must still be titled')
})

test('*** H21. ⛔ THE SERVER HEADING NAMES THE VERIFIED CLAIM, and only that ***', () => {
  const top = runPlan([SEC(SENTINEL, ['A', 'B'], TOP(2))]).plan.sections[0].heading
  const sup = runPlan([SEC(SENTINEL, ['A'], SUP())]).plan.sections[0].heading
  const ord = runPlan([SEC(SENTINEL, ['A', 'C'], ORD())]).plan.sections[0].heading
  assert.notEqual(top, sup, 'top_n and superlative must not render identically')
  assert.notEqual(top, ord, 'top_n and ordering must not render identically')
  for (const h of [top, sup, ord]) assert.equal(h.includes(SENTINEL), false)
  assert.ok(/2/.test(top), 'the verified N belongs in the heading: ' + top)
})

test('*** H22. ⛔ SENTINEL SURVIVAL — the real seam, the real log, the real reply ***', () => {
  /**
   * ⛔ THE PROOF THAT MATTERS. Everything above runs the validator; this runs the path
   * production runs, captures the bytes production writes, and looks for the sentinel in all
   * of them. A gate that is correct in a unit test and bypassed at runtime is this project's
   * most frequently repeated defect.
   */
  const captured = []
  const realLog = console.log
  console.log = (...a) => captured.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  let out
  try {
    out = buildReadResultReply({
      message: '而家缺貨最嚴重嘅係咩？',
      reply: '',
      answerPlan: {
        directAnswer: '', answerClaims: null, unanswerable: false, citesEvidence: true,
        sections: [SEC('最缺的兩項 ' + SENTINEL, ['A', 'B'], TOP(2))],
        limitations: [], followUp: null
      },
      evidenceSets: [evidenceOf()],
      itemsBySource: GROUPS,
      perSource: [],
      requestId: '22222222-3333-4444-8555-666666666666'
    })
  } finally { console.log = realLog }

  const logged = captured.join('\n')
  assert.equal(String(out.reply).includes(SENTINEL), false, '⛔ the sentinel reached the rendered reply')
  assert.equal(logged.includes(SENTINEL), false, '⛔ the sentinel reached the application log')
  assert.equal(String(out.reply).includes('最缺的兩項'), false, '⛔ the model heading reached the reply')
  // And the section really did ship — a sentinel absent because nothing rendered proves nothing.
  assert.equal(/\*\*A\*\*/.test(String(out.reply)), true, 'the verified rows must still be on screen: ' + out.reply)
})

test('*** H23. ⛔ A REJECTED RANKING SECTION TAKES ITS HEADING WITH IT ***', () => {
  const r = runPlan([SEC('最缺的四項 ' + SENTINEL, ['A', 'B', 'C'], TOP(4))])
  assert.equal(r.plan.sections.length, 0, 'the section must be dropped whole')
  assert.equal(JSON.stringify(r.plan).includes(SENTINEL), false, '⛔ the heading outlived its section')
})

test('*** H24. ⛔ ONCE ON THE STRUCTURED PATH, FAILURE NEVER FALLS BACK TO AN ORDINARY SECTION ***', () => {
  // A declared claim over a turn with no proof at all. The temptation is to render it as an
  // ordinary list of true rows; that would ship the ranking with its evidence removed.
  const bare = evidenceOf()
  delete bare.rankingMetric
  const r = runPlan([SEC('缺貨排序', ['A', 'B'], TOP(2))], [bare])
  assert.equal(r.plan.sections.length, 0, '⛔ a refused ranking section fell through as ordinary content')
})

/* ═══════════════════════════════════════════════════════════════════════════
   G. COUNTERS — enum and count only
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** H25. ⛔ THE COUNTERS RECORD SHAPE, NEVER CONTENT ***', () => {
  const line = logLine([
    SEC('缺貨狀況', ['A'], null), //            ordinary
    SEC('缺貨排序', ['A', 'B'], TOP(2)), //     ranking-looking AND declared
    SEC('最緊急缺貨項目', ['A'], null), //       ranking-looking, NOT declared
    SEC('目前庫存', ['B'], SUP()) //            declared without looking like one
  ])
  assert.deepEqual(line.rankingClaims, { looksRanking: 2, declared: 2, missing: 1 })
  assert.equal(JSON.stringify(line).includes('缺貨排序'), false, '⛔ a heading reached the log')
  assert.equal(JSON.stringify(line).includes('最緊急缺貨項目'), false, '⛔ a heading reached the log')
})

test('*** H26. THE COUNTERS ARE ZERO ON AN ORDINARY TURN, not absent ***', () => {
  const line = logLine([SEC('缺貨狀況', ['A'], null)])
  assert.deepEqual(line.rankingClaims, { looksRanking: 0, declared: 0, missing: 0 })
})

/* ═══════════════════════════════════════════════════════════════════════════
   H. THE GATE ORDER IS PINNED — a repair must know WHICH check failed
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** H27. ⛔ GATE ORDER: the FIRST failing check is the one reported ***', () => {
  // Every fixture below fails several checks at once. The reported reason must be the earliest
  // in the pinned order — claim → shape → sources → metric → completeness → cardinality →
  // membership → order — because a reason that depends on evaluation order is not a reason.
  const bare = evidenceOf({ rankingCompleteWithinScope: false })
  delete bare.rankingMetric
  // missing declaration + no proof + wrong everything -> the declaration is reported
  assert.equal(gateOf(logLine([SEC('缺貨排序', ['C', 'A'], null)], [bare])).reason, 'ranking_claim_missing')
  // broken shape + no proof -> the shape is reported
  assert.equal(gateOf(logLine([SEC('缺貨排序', ['C', 'A'], { kind: 'top_n', n: null, metric: null })], [bare])).reason, 'ranking_claim_invalid')
  // valid shape + no proof + wrong order -> the proof is reported
  assert.equal(gateOf(logLine([SEC('缺貨排序', ['C', 'A'], TOP(2))], [bare])).reason, 'no_ranking_proof')
  // proof present but incomplete + wrong order -> completeness is reported
  assert.equal(gateOf(logLine([SEC('缺貨排序', ['C', 'A'], TOP(2))], [evidenceOf({ rankingCompleteWithinScope: false })])).reason, 'ranking_incomplete')
  // complete proof + wrong count + wrong order -> cardinality is reported
  assert.equal(gateOf(logLine([SEC('缺貨排序', ['C', 'A'], TOP(3))])).reason, 'cardinality_mismatch')
})

test('*** H28. rankingSectionViolations still returns the REJECTED INDICES ***', () => {
  const out = rankingSectionViolations({
    sections: [SEC('缺貨狀況', ['A'], null), SEC('缺貨排序', ['A', 'C'], TOP(2))],
    rankedRows: ROWS,
    rankingEvidence: evidenceOf(),
    rankedSourceCount: 1
  })
  assert.deepEqual(out, [1], 'index 1 is the offending section')
})

/* ═══════════════════════════════════════════════════════════════════════════
   I. THE FULL PATH — processIntake, a real turn, the bytes the Owner receives
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⛔ EVERYTHING ABOVE RUNS THE VALIDATOR. These run the turn.
 *
 * This project has shipped a correct gate that production never called three times —
 * `artifactStore` undefined in assembly, `onVerdict` never supplied, and the claim-binding block
 * this codebase describes in its own words as 「computed, returned, and acted on by nothing」. A
 * mutation that only unit tests can see is not evidence that the runtime is protected.
 */
const { processIntake } = require('./intakeService')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')

const LIVE_NOW = '2026-08-09T00:00:00.000Z'
/**
 * ⛔ SIX ROWS, because `LIMITS.maxItemsPerSection` is 5. A six-item declaration in which every
 * item is REAL is the only fixture that can expose the cap: with five or fewer rows the sixth
 * item would be an unresolvable id, and the unresolved-item signal would mask the cap.
 */
const LIVE_ROWS = [['A', '1', 70], ['B', '2', 39], ['C', '3', 37], ['D', '4', 20], ['E', '5', 15], ['F', '6', 10]]

async function withEnv (fn) {
  const all = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on', [A4_AMBIGUITY_FLAG]: 'on' }
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const liveConnector = {
  async read (source) {
    return {
      asOf: LIVE_NOW, source, count: LIVE_ROWS.length,
      results: LIVE_ROWS.map(([t, id, sf]) => ({ source, sourceId: id, title: t, entityType: 'inventory_item', content: 'x', fields: { id, parLevel: '100', currentStock: String(100 - sf) }, trust: 'live', retrievedAt: LIVE_NOW, originalDate: null, link: null, error: null })),
      evidence: Object.assign(evidenceOf({ shownCount: LIVE_ROWS.length }), {
        returnedRows: 199, limit: null, limitKnown: true, truncated: false, completeWithinScope: true,
        rankedBy: 'parLevel - currentStock desc', dataAsOf: null, retrievedAt: LIVE_NOW, provenance: 'FAKE'
      })
    }
  }
}

const liveTurn = (sections) => {
  const envelopes = [
    { intent: 'answer', mode: 'chat', reply: null, nextRead: { capability: 'aroma_system.inventory' }, answerPlan: null },
    { intent: 'answer', mode: 'chat', reply: '', nextRead: null, answerPlan: { directAnswer: '', sections, limitations: [], followUp: null, unanswerable: false, citesEvidence: true } }
  ]
  let n = 0
  const adapter = { label: 'claude', async complete () { const e = envelopes[Math.min(n++, envelopes.length - 1)]; return { text: JSON.stringify(e), usage: { inputTokens: 1, outputTokens: 1 } } } }
  return processIntake('現在缺貨最嚴重的是什麼？', adapter, [], {
    demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '33333333-4444-4555-8666-777777777777',
    readContextDeps: { connector: liveConnector, sources: ['aroma_system', 'public_knowledge'], sourceIntentResolver: async () => ({ intent: 'internal' }) }
  })
}

const liveSection = (heading, titles, rankingClaim) => ({
  heading,
  rankingClaim: rankingClaim === undefined ? null : rankingClaim,
  items: titles.map((t) => ({ sourceId: LIVE_ROWS.find((r) => r[0] === t)[1], title: t, facts: [] }))
})

test('*** H29. ⛔ LIVE: A FOUR-CLAIM SHOWING THREE ROWS DOES NOT REACH THE OWNER ***', async () => {
  await withEnv(async () => {
    // ⛔ A, B, C ARE the proven top three, in the proven order. Everything about this section is
    // correct except HOW MANY it says there are — which is the one thing four rounds of blockers
    // could not pin, and the only thing this contract changed.
    const out = await liveTurn([liveSection('目前最缺的四項', ['A', 'B', 'C'], TOP(4))])
    const reply = String(out && out.reply != null ? out.reply : '')
    assert.equal(/\*\*A\*\*/.test(reply), false, '⛔ a four-item claim shipped showing three: ' + reply)
    assert.ok(reply.trim().length > 0, '⛔ SILENCE — the Owner must still be told something')
  })
})

test('*** H30. ⛔ LIVE: THE PROVEN SECTION SHIPS UNDER THE SERVER\'S OWN HEADING ***', async () => {
  await withEnv(async () => {
    const out = await liveTurn([liveSection('目前最缺的兩項 ' + SENTINEL, ['A', 'B'], TOP(2))])
    const reply = String(out && out.reply != null ? out.reply : '')
    assert.equal(/\*\*A\*\*/.test(reply), true, 'the verified rows must be on screen: ' + reply)
    assert.equal(reply.includes(SENTINEL), false, '⛔ the model heading reached the Owner')
    assert.equal(reply.includes('目前最缺的兩項'), false, '⛔ the model heading reached the Owner')
    assert.ok(/###\s*\S/.test(reply), 'the section is titled by the server: ' + reply)
  })
})

test('*** H31. ⛔ A GROUNDED MODEL HEADING IS REPLACED TOO — the blanking is load-bearing ***', () => {
  /**
   * ⛔ THE MUTATION FOUND THIS TEST, NOT THE OTHER WAY AROUND.
   *
   * Removing the blanking in `validatePlan` left the whole ranking suite GREEN. Every heading
   * fixture above carries an injected sentinel, and an ungrounded token makes `proseIsGrounded`
   * blank the heading anyway — so the tests could not tell the two mechanisms apart. A fixture
   * that cannot expose the defect proves nothing; that is the lesson of Commit E9d, restated.
   *
   * This heading is ORDINARY CHINESE that survives grounding. It is the only shape in which the
   * blanking is the thing doing the work, and the server's title is asserted exactly — not
   * 「contains」, not 「is not the model's」, but equal to the template composed from the verified
   * claim, so a heading that merely appended the server's words would fail too.
   */
  const r = runPlan([SEC('目前最缺的兩項', ['A', 'B'], TOP(2))])
  assert.equal(r.plan.sections.length, 1, 'the section is allowed')
  const h = r.plan.sections[0].heading
  assert.equal(h.includes('目前最缺的兩項'), false, '⛔ the model heading survived a successful validation')
  assert.equal(h, runPlan([SEC('', ['A', 'B'], TOP(2))]).plan.sections[0].heading,
    '⛔ the title depends on what the model wrote — it must depend only on the verified claim')
  assert.ok(h.length > 0, 'and an allowed ranking section is still titled')
})

test('*** H32. ⛔ LIVE: A RANKING HEADING WITH NO DECLARATION SHIPS NO ROWS ***', async () => {
  await withEnv(async () => {
    // The order is CORRECT and the rows are real. Only the declaration is missing — so only the
    // leak-guard can refuse it, and it must, or an unproven ranking reaches the Owner again.
    const out = await liveTurn([liveSection('目前最缺的兩項', ['A', 'B'], null)])
    const reply = String(out && out.reply != null ? out.reply : '')
    assert.equal(/\*\*A\*\*/.test(reply), false, '⛔ an undeclared ranking shipped: ' + reply)
    assert.ok(reply.trim().length > 0, '⛔ SILENCE')
  })
})

test('*** H33. ⛔ LIVE: A DECLARED METRIC THE TURN DID NOT PROVE SHIPS NOTHING ***', async () => {
  await withEnv(async () => {
    // The turn proves absolute_shortfall. The section declares suggested_order_qty over the same
    // rows in the same order — a real metric, proven by a DIFFERENT read, so a correct-looking
    // sequence must not be enough.
    const claim = { kind: 'top_n', n: 2, metric: 'suggested_order_qty' }
    const out = await liveTurn([liveSection('訂貨建議頭兩項', ['A', 'B'], claim)])
    const reply = String(out && out.reply != null ? out.reply : '')
    assert.equal(/\*\*A\*\*/.test(reply), false, '⛔ a shortfall ordering answered a suggested-order claim: ' + reply)
  })
})

test('*** H34. ⛔ LIVE: THE RIGHT COUNT OF THE WRONG ROWS SHIPS NOTHING ***', async () => {
  await withEnv(async () => {
    // Two items under a top-2 claim, in the proven relative order — but B outranks C, so these
    // are not the top two. Cardinality passes; membership is the only check that can refuse it.
    const out = await liveTurn([liveSection('目前最缺的兩項', ['A', 'C'], TOP(2))])
    const reply = String(out && out.reply != null ? out.reply : '')
    assert.equal(/\*\*A\*\*/.test(reply), false, '⛔ A and C shipped as the worst two: ' + reply)
  })
})

test('*** H35. ⛔ LIVE: THE COUNTERS REACH THE REAL ANSWER_PLAN LINE ***', async () => {
  /**
   * ⛔ THE SEAM, NOT THE COUNTER. `validatePlan` counts and `logAnswerPlan` projects; without the
   * one line in `readResultView` that carries the value between them, every production line would
   * read 0/0/0 while the validator held the true numbers. That exact defect has shipped twice in
   * this file's history — `droppedLimitations` and `rankingVerdicts` — and both times the unit
   * tests were green because they called `logAnswerPlan` directly with the numbers in hand.
   */
  await withEnv(async () => {
    const captured = []
    const realLog = console.log
    console.log = (...a) => captured.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
    try {
      await liveTurn([liveSection('目前最缺的兩項', ['A', 'B'], null)])
    } finally { console.log = realLog }
    /**
     * ⛔ EXACTLY ONE LINE, AND IT MUST BE THIS TURN'S.
     *
     * Written as `.join('\n')` first, and it produced a FALSE GREEN: run with the whole file the
     * capture picked up a neighbouring test's line, which happened to carry the numbers this test
     * wanted, and the assertion passed while this turn's own line read 0/0/0. Run alone it failed.
     * That is how the missing `readResultView` seam was found — by the test disagreeing with
     * itself between two ways of running it.
     */
    const emitted = captured.filter((l) => l.includes('ANSWER_PLAN'))
    assert.equal(emitted.length, 1, 'exactly one ANSWER_PLAN line, this turn\'s: ' + emitted.length)
    const line = emitted[0]
    assert.ok(line.includes('"rankingClaims"'), '⛔ the counters never reached the real line: ' + line)
    assert.ok(/"looksRanking":1/.test(line), '⛔ the ranking-looking section was not counted: ' + line)
    assert.ok(/"missing":1/.test(line), '⛔ the missing declaration was not counted: ' + line)
    assert.equal(line.includes('目前最缺的兩項'), false, '⛔ a heading reached the log')
  })
})

test('*** H36. ⛔ LIVE: A FOREIGN ROW SINKS THE WHOLE RANKING SECTION, IN EVERY KIND ***', async () => {
  /**
   * ⛔ THE MANDATED FULL-PATH PROOF. H19 runs the validator; this runs the turn. The alien row
   * is dropped as an invention long before the gate, so without the signal the gate sees a
   * one-item claim — correct, proven, and NOT what the model declared.
   */
  await withEnv(async () => {
    for (const [claim, kind] of [[ORD(), 'ordering'], [SUP(), 'superlative'], [TOP(2), 'top_n']]) {
      const sec = { heading: '缺貨排序', rankingClaim: claim, items: [{ sourceId: '1', title: 'A', facts: [] }, { sourceId: '99', title: 'Z', facts: [] }] }
      const out = await liveTurn([sec])
      const reply = String(out && out.reply != null ? out.reply : '')
      assert.equal(/\*\*A\*\*/.test(reply), false, '⛔ ' + kind + ': a narrowed claim reached the Owner: ' + reply)
      assert.ok(reply.trim().length > 0, '⛔ SILENCE — ' + kind)
    }
  })
})

test('*** H37. ⛔ LIVE: 「頭四項缺貨」 WITH NO DECLARATION SHIPS NOTHING ***', async () => {
  await withEnv(async () => {
    // The order is correct and the rows are real. Only recognition can refuse it.
    const out = await liveTurn([liveSection('頭四項缺貨', ['A', 'B'], null)])
    const reply = String(out && out.reply != null ? out.reply : '')
    assert.equal(/\*\*A\*\*/.test(reply), false, '⛔ an undeclared top-N shipped: ' + reply)
    assert.ok(reply.trim().length > 0, '⛔ SILENCE')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   J. THE SECOND WAY AN ITEM VANISHES BEFORE THE GATE — and a padded heading
   ═══════════════════════════════════════════════════════════════════════════ */

/** Six proven rows, so an all-valid six-item declaration still loses one to the cap. */
const SIX = ['A', 'B', 'C', 'D', 'E', 'F'].map((t, n) => rowOf(OP_INVENTORY, String(n + 1), t))
const SIX_GROUPS = [{ source: 'aroma_system', readKey: OP_INVENTORY, items: SIX }]
const sixItems = () => SIX.map((r) => ({ sourceId: r.sourceId, title: r.title, facts: [] }))
const sixSection = (rankingClaim, heading) => ({ heading: heading || '缺貨排序', rankingClaim, items: sixItems() })
const runSix = (sec) => runPlan([sec], [evidenceOf()], SIX_GROUPS)

test('*** J1. ⛔ AN ITEM LOST TO THE SECTION CAP NARROWS THE CLAIM TOO ***', () => {
  /**
   * ⛔ THE SAME DEFECT THROUGH A DIFFERENT DOOR. The unresolved-item signal closed one route;
   * `sec.items.slice(0, LIMITS.maxItemsPerSection)` is the other, and it cuts BEFORE the
   * resolver runs, so the sixth item never becomes an unresolved one — it simply is not there.
   *
   *     declared `ordering` A B C D E F → F cut by the cap → the gate validates A B C D E → PASS
   *     declared `superlative`          → six declared items become a five-item prefix → PASS
   *
   * So the invariant is not 「an item failed to resolve」. It is: ANY declared ranking item that
   * disappears before the gate fails the whole claim closed.
   */
  for (const [claim, kind] of [[ORD(), 'ordering'], [SUP(), 'superlative']]) {
    const r = runSix(sixSection(claim))
    assert.equal(r.plan.sections.length, 0, '⛔ ' + kind + ': a six-item claim shipped as five')
    assert.equal(r.rankingVerdicts[0].reason, 'membership_mismatch', kind + ': ' + r.rankingVerdicts[0].reason)
  }
})

test('*** J1b. AND A FIVE-ITEM DECLARATION — exactly at the cap — still passes ***', () => {
  // ⛔ The boundary matters in both directions: a rule that refused everything at the cap would
  // refuse the largest legitimate ranking the system can render.
  const sec = { heading: '缺貨排序', rankingClaim: ORD(), items: sixItems().slice(0, 5) }
  const r = runSix(sec)
  assert.equal(r.plan.sections.length, 1, 'reason: ' + JSON.stringify(r.rankingVerdicts))
  assert.equal(r.rankingVerdicts[0].status, 'evaluated_allowed')
})

test('*** J1c. AN ORDINARY SECTION OVER THE CAP KEEPS TODAY\'S BEHAVIOUR ***', () => {
  // ⛔ The cap is a rendering limit, not a claim. On a non-ranking section it must still simply
  // truncate — turning it into a whole-section rejection would delete evidence the Owner is
  // entitled to, which is a new defect rather than a fix.
  const r = runSix({ heading: '缺貨狀況', rankingClaim: null, items: sixItems() })
  assert.equal(r.plan.sections.length, 1, '⛔ an ordinary section was dropped whole')
  assert.equal(r.plan.sections[0].items.length, 5, 'truncated at the cap, as before')
  assert.equal(r.rankingVerdicts[0].status, 'not_detected')
})

test('*** J2. ⛔ THE SELECTION GUARD WAS FAIL-OPEN ON LEADING WHITESPACE ***', () => {
  /**
   * `/^[頭前第]/` is anchored to the first character and the heading was never trimmed, so one
   * leading space turned a recognised ranking into an ordinary section — and with
   * `rankingClaim: null` that ships unproven. Padding is not an exotic input; it is what a model
   * emits when it is formatting.
   */
  for (const h of [' 頭四項缺貨', '\t第一名', '\n前四項', '  第一位']) {
    assert.equal(looksLikeRankingHeading(h), true, '⛔ padding defeated the guard: ' + JSON.stringify(h))
  }
  for (const h of [' 目前庫存', '\t缺貨狀況', '  缺貨項目']) {
    assert.equal(looksLikeRankingHeading(h), false, '⛔ false positive on ' + JSON.stringify(h))
  }
})

test('*** J2b. AND THE OTHER PADDING-SENSITIVE GUARD IN THIS FILE IS ALREADY TOLERANT ***', () => {
  /**
   * ⛔ AUDITED, NOT ASSUMED. `SELECTION_WORD_RE` was the only `^`-anchored pattern in
   * rankingProof.js. The one other pattern that mentions the start of the string —
   * `RANKING_PRESENTATION_RE`\u2019s enumerator branch — is written `(^|[\n\s])`, so a padded
   * enumeration matches through the whitespace alternative rather than the anchor. Measured here
   * rather than reasoned about, because that is the claim this test exists to keep true.
   */
  assert.equal(looksLikeRankingHeading('1. 缺貨'), true, 'unpadded enumeration')
  assert.equal(looksLikeRankingHeading(' 1. 缺貨'), true, '⛔ a padded enumeration stopped being one')
  assert.equal(looksLikeRankingHeading('\t1. 缺貨'), true, '⛔ a tabbed enumeration stopped being one')
})

test('*** J3. ⛔ LIVE: A RANKING BIGGER THAN THE TURN CAN RENDER SHIPS NOTHING ***', async () => {
  /**
   * ⛔ THIS TEST PASSED BEFORE THE FIX, AND THAT IS RECORDED HERE RATHER THAN QUIETLY REUSED.
   *
   * Measured, not assumed: `readContext` keeps at most `caps.maxItemsPerSource` = 4 rows from a
   * source, and the section cap is 5. Four is LOWER, so in a live turn a six-item declaration
   * loses items 5 and 6 to the RESOLVER, not to the cap — the route closed in the previous
   * commit. The cap route cannot be reached through `processIntake` while 4 < 5.
   *
   * ⛔ THAT IS A COINCIDENCE OF TWO UNRELATED NUMBERS, NOT A GUARANTEE. Raise
   * `maxItemsPerSource` to 6 and the cap becomes the binding constraint on the live path. So the
   * cap is pinned one layer down, at the render seam, in J3b — and this test keeps the live
   * end-to-end statement it can honestly make: a declared ranking the turn cannot render whole
   * does not reach the Owner, whichever of the two routes removed the item.
   */
  await withEnv(async () => {
    const items = LIVE_ROWS.map(([t, id]) => ({ sourceId: id, title: t, facts: [] }))
    const captured = []
    const realLog = console.log
    console.log = (...x) => captured.push(x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y))).join(' '))
    let out
    try {
      out = await liveTurn([{ heading: '缺貨排序', rankingClaim: ORD(), items }])
    } finally { console.log = realLog }
    const reply = String(out && out.reply != null ? out.reply : '')
    assert.equal(/\*\*A\*\*/.test(reply), false, '⛔ a six-item claim shipped shortened: ' + reply)
    assert.ok(reply.trim().length > 0, '⛔ SILENCE')
    const line = captured.filter((l) => l.includes('ANSWER_PLAN')).join('\n')
    assert.ok(/"reason":"membership_mismatch"/.test(line),
      '⛔ refused for some other reason — this test would then prove nothing: ' + line)
  })
})

test('*** J3b. ⛔ THE CAP ROUTE, AT THE RENDER SEAM, WITH SIX RETRIEVABLE ROWS ***', async () => {
  /**
   * ⛔ THE ONLY PLACE THE CAP CAN ACTUALLY BE THE THING THAT CUTS. `buildReadResultReply` is the
   * seam `processIntake` calls to turn a plan into the reply, and it accepts the retrieved rows
   * directly — so six REAL rows can be supplied and the sixth item is removed by the section cap
   * and by nothing else. Without the `overCapItems` term the gate sees a tidy five-item ranking
   * in the proven order and allows it.
   */
  for (const [claim, kind] of [[ORD(), 'ordering'], [SUP(), 'superlative']]) {
    const out = buildReadResultReply({
      message: '而家缺貨最嚴重嘅係咩？',
      reply: '',
      answerPlan: {
        directAnswer: '', answerClaims: null, unanswerable: false, citesEvidence: true,
        sections: [{ heading: '缺貨排序', rankingClaim: claim, items: sixItems() }],
        limitations: [], followUp: null
      },
      evidenceSets: [evidenceOf()],
      itemsBySource: SIX_GROUPS,
      perSource: [],
      requestId: '55555555-6666-4777-8888-999999999999'
    })
    const reply = String(out && out.reply != null ? out.reply : '')
    assert.equal(/\*\*A\*\*/.test(reply), false, '⛔ ' + kind + ': the cap silently shortened a claim and it shipped: ' + reply)
  }
})

test('*** J4. ⛔ LIVE: A PADDED RANKING HEADING WITH NO DECLARATION SHIPS NOTHING ***', async () => {
  await withEnv(async () => {
    const out = await liveTurn([liveSection(' 頭四項缺貨', ['A', 'B'], null)])
    const reply = String(out && out.reply != null ? out.reply : '')
    assert.equal(/\*\*A\*\*/.test(reply), false, '⛔ one leading space shipped an unproven ranking: ' + reply)
    assert.ok(reply.trim().length > 0, '⛔ SILENCE')
  })
})
