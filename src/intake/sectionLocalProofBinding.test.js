'use strict'

/**
 * sectionLocalProofBinding.test.js — a ranking SECTION binds to the proof that owns ITS rows.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED IN PRODUCTION, requestId 34705891-58fa-4e17-b31f-e6c05942c6e8, bootCommit
 * c382708, the first live turn after the Task 001-H deploy. The Owner asked
 * 「現在缺貨最嚴重的四項是什麼？請按缺口由大到小列四項。」 and the reasoning loop read TWO sources:
 *
 *     step 1  aroma_system.inventory      absolute_shortfall
 *     step 2  aroma_system.replenishment  suggested_order_qty
 *
 * `rankedGroup` is chosen TURN-WIDE and only when exactly one ranked evidence exists, so with
 * two proofs it selected nothing and the gate answered `no_ranking_proof` with
 * `rankedSourceCount: 2`. Correct under the old rule — and it means no ranking can ever ship
 * once the planner reads two orderable sources. The model had declared correctly
 * (`rankingClaims: {looksRanking:1, declared:1, missing:0}`); it was entitlement that failed.
 *
 * ⛔ AND THE ANSWER WAS ALREADY IN THE ROWS. Every validated row carries the server-resolved
 * operation identity — `readContext.js:847` stamps it, `answerPlan.js` resolves the row — so a
 * section's own items already know whether they are inventory or replenishment. Only the
 * proof-selection layer was not asking them.
 *
 * > **Owner ruling: bind per SECTION, from the server-carried readKey on its items. Zero
 * > readKeys, more than one readKey, or no single matching proof — fail closed. No model
 * > authority anywhere: not the heading, not the question, not a title, not a model-supplied
 * > readKey.**
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { RANKING_METRIC } = require('./rankingProof')
const { validatePlan, logAnswerPlan, ANSWER_PLAN_SCHEMA } = require('./answerPlan')
const { buildReadResultReply } = require('./readResultView')

/* ── production shape: readKey on the evidence AND on every row ───────────── */

const OP_INV = 'aroma_system.inventory'
const OP_REP = 'aroma_system.replenishment'
const OP_DAILY = 'aroma_system.daily_count'

const rowOf = (readKey, id, title) => ({
  source: 'aroma_system', readKey, sourceId: id, title, entityType: 'inventory_item',
  content: 'x', fields: { id }, trust: 'live'
})

/** Inventory, in the proven absolute-shortfall order. Raw ids 1..4. */
const INV = [rowOf(OP_INV, '1', 'Napa Cabbage'), rowOf(OP_INV, '2', 'Onion'), rowOf(OP_INV, '3', 'Carrot'), rowOf(OP_INV, '4', 'Leek')]
/**
 * Replenishment, in ITS OWN proven suggested-order order. Raw ids 7,8 — deliberately NOT
 * colliding with inventory's, so a bare id still resolves and the ranking gate is what decides.
 * A raw-id collision would drop the items as inventions before the gate and prove nothing.
 */
const REP = [rowOf(OP_REP, '7', 'Rice 20kg'), rowOf(OP_REP, '8', 'Oil 5L')]
/** A THIRD read whose metric is the SAME as inventory's — so metric can never identify a proof. */
const DAILY = [rowOf(OP_DAILY, '9', 'Count sheet')]

const evOf = (readKey, endpoint, metric, over) => Object.assign({
  source: 'aroma_system', entityType: 'inventory_item', endpoint,
  readKey, trust: 'live',
  shownCount: 4, matchingTotal: 4, sourceTotal: null,
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  rowShape: { hasLocation: false, hasAsOf: false, note: null },
  metrics: {}, derivations: {}, fieldLabels: {}, completeness: 'sample',
  rankingMetric: metric, rankingDirection: 'desc', rankingCompleteWithinScope: true
}, over || {})

const EV_INV = () => evOf(OP_INV, 'inventory', RANKING_METRIC.ABSOLUTE_SHORTFALL)
const EV_REP = () => evOf(OP_REP, 'orderPlanning', RANKING_METRIC.SUGGESTED_ORDER_QTY)
const EV_DAILY = () => evOf(OP_DAILY, 'dailyCount', RANKING_METRIC.ABSOLUTE_SHORTFALL)

const GROUPS = [
  { source: 'aroma_system', readKey: OP_REP, items: REP }, // replenishment FIRST on purpose
  { source: 'aroma_system', readKey: OP_INV, items: INV },
  { source: 'aroma_system', readKey: OP_DAILY, items: DAILY }
]
/** The live turn's shape: exactly the two proofs it actually held. */
const TWO_PROOFS = () => [EV_INV(), EV_REP()]

const TOP = (n) => ({ kind: 'top_n', n, metric: RANKING_METRIC.ABSOLUTE_SHORTFALL })
const TOP_QTY = (n) => ({ kind: 'top_n', n, metric: RANKING_METRIC.SUGGESTED_ORDER_QTY })
const SUP = () => ({ kind: 'superlative', n: null, metric: RANKING_METRIC.ABSOLUTE_SHORTFALL })
const ORD = () => ({ kind: 'ordering', n: null, metric: null })

const ALL = INV.concat(REP, DAILY)
/** A section as the MODEL sends it — raw sourceIds only. The model never names a readKey. */
const SEC = (heading, ids, rankingClaim, extraOnItems) => ({
  heading,
  rankingClaim: rankingClaim === undefined ? null : rankingClaim,
  items: ids.map((id) => Object.assign(
    { sourceId: id, title: (ALL.find((r) => r.sourceId === id) || {}).title, facts: [] },
    extraOnItems || {}))
})

function runPlan (sections, evidenceSets, itemsBySource, over) {
  return validatePlan(
    Object.assign({ directAnswer: '', sections, limitations: [], followUp: null, unanswerable: false, citesEvidence: true }, over || {}),
    { evidenceSets: evidenceSets || TWO_PROOFS(), itemsBySource: itemsBySource || GROUPS, message: '現在缺貨最嚴重的四項是什麼？請按缺口由大到小列四項。' }
  )
}

function logLine (sections, evidenceSets, itemsBySource, over) {
  const r = runPlan(sections, evidenceSets, itemsBySource, over)
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

const gateOf = (r) => (r.rankingVerdicts && r.rankingVerdicts[0]) || null

/* ═══════════════════════════════════════════════════════════════════════════
   A. THE LIVE FAILURE — two proofs, a section that belongs to exactly one
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** S1. ⛔ TWO PROOFS IN THE TURN, AN INVENTORY-ONLY SECTION IS STILL ENTITLED ***', () => {
  // ⛔ THE PRODUCTION TURN, EXACTLY. Before section-local binding this answered
  // `no_ranking_proof` with rankedSourceCount 2 — a correct refusal of a correct answer.
  const r = runPlan([SEC('缺貨排序', ['1', '2', '3', '4'], TOP(4))])
  const v = gateOf(r)
  assert.equal(v.status, 'evaluated_allowed', '⛔ still refused: ' + JSON.stringify(v))
  assert.equal(v.rankedSourceCount, 1, 'ONE usable proof for THIS section: ' + v.rankedSourceCount)
  assert.equal(r.plan.sections.length, 1, 'the section survives')
  assert.ok(r.plan.sections[0].heading.length > 0, 'and the server titles it')
})

test('*** S2. ⛔ AND THE REPLENISHMENT SECTION BINDS TO ITS OWN PROOF, NOT THE FIRST ONE ***', () => {
  /**
   * ⛔ THE DISCRIMINATOR AGAINST 「pick the first ranked proof」. These rows are replenishment's,
   * in replenishment's proven order, under replenishment's metric. Any implementation that
   * reaches for whichever proof it finds first binds inventory here and refuses a correct
   * ranking — which is the same false-refusal this whole change exists to end.
   */
  const r = runPlan([SEC('訂貨建議排序', ['7', '8'], TOP_QTY(2))])
  const v = gateOf(r)
  assert.equal(v.status, 'evaluated_allowed', '⛔ bound to the wrong proof: ' + JSON.stringify(v))
  assert.equal(v.rankedSourceCount, 1)
})

test('*** S3. ⛔ METRIC CANNOT IDENTIFY A PROOF — two reads can share one ***', () => {
  // inventory and daily_count both prove absolute_shortfall. Selecting by metric finds two and
  // has no way to choose; selecting by the section's own readKey has exactly one answer.
  const r = runPlan([SEC('缺貨排序', ['1', '2'], TOP(2))], [EV_INV(), EV_DAILY()])
  const v = gateOf(r)
  assert.equal(v.status, 'evaluated_allowed', '⛔ metric-only selection cannot resolve this: ' + JSON.stringify(v))
  assert.equal(v.rankedSourceCount, 1)
})

/* ═══════════════════════════════════════════════════════════════════════════
   B. A MIXED SECTION IS NOT ATTRIBUTABLE, SO IT FAILS CLOSED
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** S4. ⛔ A SECTION MIXING TWO OPERATIONS IS REFUSED WHOLE ***', () => {
  /**
   * ⛔ AND THE REASON IS ASSERTED, NOT JUST THE REFUSAL. A 「pick the first proof」 implementation
   * ALSO rejects this — as `membership_mismatch`, because row 7 is not in inventory's proof. That
   * is the right verdict for the wrong question: the section was never attributable in the first
   * place. Pinning the reason is what makes this test able to tell the two apart.
   */
  const r = runPlan([SEC('缺貨排序', ['1', '2', '7'], ORD())])
  const v = gateOf(r)
  assert.equal(v.status, 'evaluated_rejected')
  assert.equal(v.reason, 'no_ranking_proof', 'ownership ambiguity, not membership: ' + v.reason)
  assert.equal(v.rankedSourceCount, 0, 'no usable proof for THIS section')
  assert.equal(r.plan.sections.length, 0, '⛔ no partial repair, no pruning — the section is gone')
})

test('*** S5. ⛔ NO PRUNING TO THE MAJORITY, EVEN WHEN ONE OPERATION DOMINATES ***', () => {
  // Three inventory rows and one replenishment row, all in their own proven orders. A majority
  // rule would keep the inventory reading and ship a ranking the Owner did not receive rows for.
  const r = runPlan([SEC('缺貨排序', ['1', '2', '3', '7'], ORD())])
  const v = gateOf(r)
  assert.equal(v.reason, 'no_ranking_proof', 'reason: ' + v.reason)
  assert.equal(r.plan.sections.length, 0)
})

/* ═══════════════════════════════════════════════════════════════════════════
   C. THE MODEL HAS ZERO AUTHORITY OVER readKey
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** S6. THE MODEL-FACING SECTION SCHEMA EXPOSES NO readKey ***', () => {
  const item = ANSWER_PLAN_SCHEMA.properties.sections.items.properties.items.items
  assert.deepEqual(Object.keys(item.properties).sort(), ['facts', 'sourceId', 'title'])
  assert.equal(item.additionalProperties, false, 'a field the schema does not name cannot be sent')
  assert.deepEqual(item.required.slice().sort(), ['facts', 'sourceId', 'title'])
})

test('*** S7. ⛔ A FORGED readKey ON THE MODEL ITEM HAS ZERO EFFECT ***', () => {
  /**
   * ⛔ DEFENCE IN DEPTH. The schema above cannot carry this field — so this is the case where the
   * schema was bypassed: a direct caller, an internal path, a future refactor. The item claims
   * replenishment; `resolveRowRef` resolves its sourceId to an INVENTORY row; the validated item
   * must carry inventory and the section must bind to the inventory proof.
   */
  const forged = SEC('缺貨排序', ['1', '2'], TOP(2), { readKey: OP_REP })
  const r = runPlan([forged])
  const v = gateOf(r)
  assert.equal(v.status, 'evaluated_allowed', '⛔ the forged readKey changed the binding: ' + JSON.stringify(v))
  assert.equal(v.rankedSourceCount, 1)
  for (const it of r.plan.sections[0].items) {
    assert.equal(it.readKey, OP_INV, '⛔ a model-supplied readKey reached the validated item')
  }
})

test('*** S8. ⛔ AND A FORGED readKey CANNOT RESCUE A MIXED SECTION EITHER ***', () => {
  // Every item claims inventory; one of them really is replenishment. The server identity wins.
  const forged = SEC('缺貨排序', ['1', '2', '7'], ORD(), { readKey: OP_INV })
  const v = gateOf(runPlan([forged]))
  assert.equal(v.reason, 'no_ranking_proof', 'reason: ' + v.reason)
})

/* ═══════════════════════════════════════════════════════════════════════════
   D. THE SENTENCE PATH IS UNCHANGED — a section cannot rescue a directAnswer
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** S9. ⛔ TWO PROOFS: THE SECTION IS ALLOWED, THE SENTENCE IS STILL REFUSED ***', () => {
  /**
   * ⛔ A SENTENCE HAS NO SECTION IDENTITY. It names rows in prose, so there is nothing to bind it
   * to — and the whole basis of this change is server-resolved identity, which prose does not
   * have. The section gains a proof; the sentence must not gain one with it.
   */
  const r = runPlan([SEC('缺貨排序', ['1', '2'], TOP(2))], undefined, undefined,
    { directAnswer: '缺貨最嚴重嘅係 Napa Cabbage。' })
  assert.equal(gateOf(r).status, 'evaluated_allowed', 'the section is independently entitled')
  assert.equal(r.plan.directAnswer, '', '⛔ the sentence path was rescued by the section binding')
  assert.equal(r.droppedSentences, 1)
  assert.ok(r.drops.some((d) => d && d.field === 'ranking'), 'the sentence gate still recorded its refusal')
})

/* ═══════════════════════════════════════════════════════════════════════════
   E. LEGACY AND SINGLE-PROOF SHAPES ARE UNTOUCHED
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** S10. LEGACY ROWS WITH NO SERVER readKey KEEP THE OLD FALLBACK ***', () => {
  /**
   * ⛔ E8e, RESTATED HERE AS A CONTROL. Rows that never passed through a readKey-stamping read
   * carry no server identity, so there is nothing authoritative to bind by and today's
   * single-group fallback still applies. 「property absent」 is not 「server said null」.
   */
  const legacy = [
    { source: 'aroma_system', sourceId: '1', title: 'Napa Cabbage', entityType: 'inventory_item', content: 'x', fields: { id: '1' }, trust: 'live' },
    { source: 'aroma_system', sourceId: '2', title: 'Onion', entityType: 'inventory_item', content: 'x', fields: { id: '2' }, trust: 'live' }
  ]
  const ev = EV_INV()
  delete ev.readKey
  const r = runPlan([{ heading: '缺貨排序', rankingClaim: ORD(), items: [{ sourceId: '1', title: 'Napa Cabbage', facts: [] }, { sourceId: '2', title: 'Onion', facts: [] }] }],
    [ev], [{ source: 'aroma_system', items: legacy }])
  const v = gateOf(r)
  assert.equal(v.status, 'evaluated_allowed', '⛔ the legacy fallback was removed: ' + JSON.stringify(v))
})

test('*** S11. SINGLE-PROOF TURNS BEHAVE EXACTLY AS BEFORE ***', () => {
  const one = [EV_INV()]
  const groups = [{ source: 'aroma_system', readKey: OP_INV, items: INV }]
  assert.equal(gateOf(runPlan([SEC('缺貨排序', ['1', '2'], TOP(2))], one, groups)).status, 'evaluated_allowed', 'top-2')
  assert.equal(gateOf(runPlan([SEC('缺貨排序', ['2', '1'], TOP(2))], one, groups)).reason, 'order_mismatch', 'wrong order still fails')
  assert.equal(gateOf(runPlan([SEC('缺貨排序', ['1', '3'], TOP(2))], one, groups)).reason, 'membership_mismatch', 'wrong members still fail')
  assert.equal(gateOf(runPlan([SEC('缺貨排序', ['1'], SUP())], one, groups)).status, 'evaluated_allowed', 'superlative prefix')
  assert.equal(gateOf(runPlan([SEC('缺貨排序', ['1', '3'], ORD())], one, groups)).status, 'evaluated_allowed', 'ordering subsequence')
  const incomplete = [evOf(OP_INV, 'inventory', RANKING_METRIC.ABSOLUTE_SHORTFALL, { rankingCompleteWithinScope: false })]
  assert.equal(gateOf(runPlan([SEC('缺貨排序', ['1', '2'], TOP(2))], incomplete, groups)).reason, 'ranking_incomplete', 'unproven still fails')
  const bare = EV_INV()
  delete bare.rankingMetric
  assert.equal(gateOf(runPlan([SEC('缺貨排序', ['1', '2'], TOP(2))], [bare], groups)).reason, 'no_ranking_proof', 'zero proof still fails')
})

test('*** S12. ⛔ A PROOF WHOSE OPERATION OWNS NO SINGLE GROUP ENTITLES NOTHING ***', () => {
  /**
   * ⛔ REWRITTEN AFTER THE FIRST ATTEMPT COULD NOT REACH THE GATE. It withheld the inventory
   * group entirely — so the items resolved to nothing, were dropped as inventions, the section
   * was never pushed, and there was no verdict to assert on. A fixture that cannot reach the
   * check proves nothing about it.
   *
   * Two groups claim the SAME operation. The rows still resolve, so the section reaches the gate
   * — and the proof cannot say which of them it speaks for, which is the ambiguity to refuse.
   */
  const split = [
    { source: 'aroma_system', readKey: OP_INV, items: INV.slice(0, 2) },
    { source: 'aroma_system', readKey: OP_INV, items: INV.slice(2) }
  ]
  const r = runPlan([SEC('缺貨排序', ['1', '2'], TOP(2))], [EV_INV()], split)
  const v = gateOf(r)
  assert.equal(v.status, 'evaluated_rejected', 'reason: ' + JSON.stringify(v))
  assert.equal(v.reason, 'no_ranking_proof', 'reason: ' + v.reason)
  assert.equal(v.rankedSourceCount, 0)
})

test('*** S13. ⛔ A SECTION WHOSE METRIC IS NOT ITS OWN PROOF\'S IS STILL REFUSED ***', () => {
  // Inventory rows, inventory proof — but the claim declares the replenishment metric. Binding
  // decides WHICH proof; it never excuses the metric check.
  const v = gateOf(runPlan([SEC('缺貨排序', ['1', '2'], TOP_QTY(2))]))
  assert.equal(v.reason, 'metric_not_proven', 'reason: ' + v.reason)
})

/* ═══════════════════════════════════════════════════════════════════════════
   F. THE SEAM — retrieved rows to the rendered reply, nothing hand-inserted
   ═══════════════════════════════════════════════════════════════════════════ */

test('*** S14. ⛔ IDENTITY CONTINUITY: retrieved row → validated item → binding → the reply ***', () => {
  /**
   * ⛔ NOTHING IS HAND-INSERTED. The rows carry `readKey` exactly as `readContext.js:847` stamps
   * it; the item's identity is whatever `validatePlan` resolved; and the assertion is on the
   * bytes `buildReadResultReply` produced. A test that set `item.readKey` itself would prove the
   * gate can read a field, not that production fills it.
   */
  const captured = []
  const realLog = console.log
  console.log = (...a) => captured.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  let out
  try {
    out = buildReadResultReply({
      message: '現在缺貨最嚴重的四項是什麼？請按缺口由大到小列四項。',
      reply: '',
      answerPlan: {
        directAnswer: '', answerClaims: null, unanswerable: false, citesEvidence: true,
        sections: [SEC('目前最缺的四項 ZZ-SENTINEL-ZZ', ['1', '2', '3', '4'], TOP(4))],
        limitations: [], followUp: null
      },
      evidenceSets: TWO_PROOFS(),
      itemsBySource: GROUPS,
      perSource: [],
      requestId: '88888888-9999-4aaa-8bbb-cccccccccccc'
    })
  } finally { console.log = realLog }

  const reply = String(out && out.reply != null ? out.reply : '')
  assert.ok(/\*\*Napa Cabbage\*\*/.test(reply), '⛔ the entitled section did not ship: ' + reply)
  const order = ['Napa Cabbage', 'Onion', 'Carrot', 'Leek'].map((t) => reply.indexOf(t))
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'rows in the proven order: ' + reply)
  assert.equal(reply.includes('ZZ-SENTINEL-ZZ'), false, '⛔ the model heading reached the Owner')
  assert.equal(reply.includes('目前最缺的四項'), false, '⛔ the model heading reached the Owner')
  assert.ok(/###\s*\S/.test(reply), 'the server titled it')

  const emitted = captured.filter((l) => l.includes('ANSWER_PLAN'))
  assert.equal(emitted.length, 1, 'exactly one ANSWER_PLAN line')
  assert.ok(/"status":"evaluated_allowed"/.test(emitted[0]), '⛔ the real line did not record the allow: ' + emitted[0])
  assert.ok(/"rankedSourceCount":1/.test(emitted[0]), '⛔ the real line did not report one usable proof: ' + emitted[0])
  for (const banned of [OP_INV, OP_REP, 'Napa Cabbage', 'ZZ-SENTINEL-ZZ', '缺貨排序']) {
    assert.equal(emitted[0].includes(banned), false, '⛔ content reached the log: ' + banned)
  }
})

test('*** S15. THE LOG STILL CARRIES ENUM AND COUNT ONLY ON A REFUSAL ***', () => {
  const line = logLine([SEC('缺貨排序', ['1', '2', '7'], ORD())])
  assert.deepEqual(line.rankingGate, [{ status: 'evaluated_rejected', reason: 'no_ranking_proof', rankedSourceCount: 0 }])
  for (const banned of [OP_INV, OP_REP, 'Napa Cabbage', 'Rice 20kg']) {
    assert.equal(JSON.stringify(line).includes(banned), false, '⛔ content reached the log: ' + banned)
  }
})

test('*** S16. ⛔ THE SENTENCE GATE IS BYTE-IDENTICAL — not stricter either ***', () => {
  /**
   * ⛔ S9 COULD NOT SEE THIS, AND THE MUTATION FOUND THAT OUT. S9's sentence fails at
   * `no_declared_claim` — the first gate — so it never reaches the order check and cannot tell
   * whether the sentence was handed rows. A mutation that fed the section's rows to the sentence
   * path left S9 green.
   *
   * Here the sentence DOES declare a ranking claim and DOES name rows out of proven order. With
   * two ranked proofs the turn-wide selector binds nothing, so `rankedRows` is empty, the order
   * check has nothing to compare, and the sentence survives — exactly as it does today. Feeding
   * it section-derived rows would refuse it, which is a change to the sentence contract even
   * though it points the safe way. 「Do not change the sentence path」 means either direction.
   */
  const claims = [{ text: 'x', claimKind: 'ranking', metric: RANKING_METRIC.ABSOLUTE_SHORTFALL, evidenceSources: ['aroma_system'], sourceIds: [], scope: null }]
  const r = runPlan([SEC('缺貨排序', ['1', '2'], TOP(2))], undefined, undefined, {
    directAnswer: 'Onion 之後係 Napa Cabbage。',
    answerClaims: claims
  })
  assert.equal(gateOf(r).status, 'evaluated_allowed', 'the section is still independently entitled')
  assert.equal(r.plan.directAnswer, 'Onion 之後係 Napa Cabbage。',
    '⛔ the sentence path changed: ' + JSON.stringify(r.plan.directAnswer) + ' drops=' + JSON.stringify(r.drops))
  assert.equal(r.droppedSentences, 0, '⛔ the sentence gate became stricter because the section can now bind')
})
