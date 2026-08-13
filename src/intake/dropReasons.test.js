'use strict'

/**
 * dropReasons.test.js — which remover killed the conclusion, on the record.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE QUESTION THIS EXISTS TO ANSWER. On bootCommit 5dfb8fd, three fresh conversations
 * (264e6934 / c55f0c37 / 5f703ed0) each wrote a `directAnswer` that did not survive. The log
 * could prove the model wrote SOMETHING — `droppedSentences: 1`, and an empty plan yields 0 —
 * but not WHICH of five removers killed it:
 *
 *   sentenceIsSupported · TELEMETRY_RE · proseIsGrounded · barredTitles · the ranking gate
 *
 * All four sentence removers shared one counter and recorded nothing. The ranking gate DID
 * record its verdict — as `reason`, a field the drop serializer has never carried, so it was
 * computed and discarded.
 *
 * ⛔ THE TWO ANSWERS HAVE DIFFERENT REPAIRS, which is why this round only measures:
 *   ranking `why: no_declared_claim`, no upstream sentence drop → a legitimate answer died for
 *     want of a declaration; the repair belongs at proof → conclusion authority.
 *   an upstream sentence drop first → the sentence died before the ranking gate saw it; the
 *     repair belongs at grounding / derived facts.
 *
 * ⛔ AND NOTHING HERE MAY CARRY CONTENT. Enums and identifiers only.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { validatePlan, logAnswerPlan } = require('./answerPlan')
const { RANKING_METRIC, VERDICT } = require('./rankingProof')

const NAPA = 'Napa Cabbage'
const JARS = 'Jars for Red Chili Oil'

const ROWS = [
  { sourceId: '1', title: NAPA, entityType: 'inventory_item', content: 'par 100 · on hand 30', fields: { id: '1', parLevel: '100', currentStock: '30' }, source: 'aroma_system', trust: 'live' },
  { sourceId: '2', title: JARS, entityType: 'inventory_item', content: 'par 20 · on hand 0', fields: { id: '2', parLevel: '20', currentStock: '0' }, source: 'aroma_system', trust: 'live' }
]

const EVIDENCE = (over = {}) => [Object.assign({
  source: 'aroma_system',
  entityType: 'inventory_item',
  endpoint: 'inventory',
  trust: 'live',
  shownCount: 2,
  matchingTotal: 199,
  sourceTotal: null,
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  rowShape: { hasLocation: false, hasAsOf: false, note: null },
  metrics: {},
  derivations: {},
  fieldLabels: {},
  completeness: 'sample',
  rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL,
  rankingDirection: 'desc',
  rankingCompleteWithinScope: true
}, over)]

const ITEMS = [{ source: 'aroma_system', readKey: 'aroma_system', items: ROWS }]

const PLAN = (directAnswer, over = {}) => Object.assign({
  directAnswer, sections: [], limitations: [], followUp: null, unanswerable: false
}, over)

const ctx = (message, evidence = EVIDENCE()) => ({ evidenceSets: evidence, itemsBySource: ITEMS, message })

/** The `why` values on sentence drops, in order. */
const sentenceWhys = (r) => (r.drops || []).filter((d) => d && d.kind === 'sentence').map((d) => d.why)
/** The `why` on the ranking drop, if any. */
const rankingWhy = (r) => {
  const d = (r.drops || []).find((x) => x && x.field === 'ranking')
  return d ? d.why : null
}

/* ═══ 1. A SURVIVING SENTENCE RECORDS NOTHING ════════════════════════════ */

test('*** ⛔ A SENTENCE THAT SURVIVES PRODUCES NO DROP REASON ***', () => {
  const r = validatePlan(PLAN('餐廳系統有 199 項存貨記錄。'), ctx('而家倉存有咩？'))
  assert.equal(r.plan.directAnswer, '餐廳系統有 199 項存貨記錄。', 'the sentence survived')
  assert.deepEqual(sentenceWhys(r), [], '⛔ a surviving sentence was recorded as dropped')
  assert.equal(r.droppedSentences, 0)
})

/* ═══ 2. EACH REMOVER NAMES ITSELF ══════════════════════════════════════ */

test('*** ⛔ AN UNSUPPORTED NUMBER RECORDS number_not_in_evidence ***', () => {
  // 500 is in no row. This is the 「model did arithmetic」 case.
  const r = validatePlan(PLAN('餐廳系統有 500 項存貨記錄。'), ctx('而家倉存有咩？'))
  assert.deepEqual(sentenceWhys(r), ['number_not_in_evidence'])
  assert.equal(r.droppedSentences, 1)
})

test('*** ⛔ TELEMETRY PROSE RECORDS telemetry ***', () => {
  const r = validatePlan(PLAN('因為 shownCount 未列出，所以未顯示。'), ctx('而家倉存有咩？'))
  assert.ok(sentenceWhys(r).includes('telemetry'), 'got: ' + JSON.stringify(sentenceWhys(r)))
})

test('*** ⛔ AN UNRETRIEVED NAME RECORDS name_not_in_evidence ***', () => {
  // A supplier this turn never read. Recall is not evidence.
  const r = validatePlan(PLAN('Sysco 係我哋最大供應商。'), ctx('而家倉存有咩？'))
  assert.ok(sentenceWhys(r).includes('name_not_in_evidence'), 'got: ' + JSON.stringify(sentenceWhys(r)))
})

test('*** ⛔ THE FOUR ENUMS ARE DISTINCT AND CLOSED ***', () => {
  const seen = new Set()
  for (const a of ['餐廳系統有 500 項存貨記錄。', '因為 shownCount 未列出。', 'Sysco 係供應商。']) {
    for (const w of sentenceWhys(validatePlan(PLAN(a), ctx('而家倉存有咩？')))) seen.add(w)
  }
  const ALLOWED = new Set(['number_not_in_evidence', 'telemetry', 'name_not_in_evidence', 'row_name_not_cited'])
  for (const w of seen) assert.ok(ALLOWED.has(w), '⛔ an unenumerated sentence reason: ' + w)
  assert.ok(seen.size >= 2, 'the branches are distinguishable: ' + JSON.stringify([...seen]))
})

/* ═══ 3. THE RANKING VERDICT SURVIVES INTO THE LOG PROJECTION ═══════════ */

/** Run the REAL logger and capture the line it would emit. */
function loggedDrops (r) {
  const lines = []
  logAnswerPlan({
    requestId: '11111111-2222-4333-8444-555555555555',
    outcome: 'degraded',
    reason: 'answer_unsupported',
    droppedItems: r.droppedItems,
    droppedFacts: r.droppedFacts,
    droppedSentences: r.droppedSentences,
    droppedLimitations: 0,
    modelItemCount: r.modelItemCount,
    keptItemCount: r.keptItemCount,
    // ⛔ `drops` is the input field name; `dropped` is what the logger EMITS. Passing the
    // output name silently produced an empty array — the projection is what is under test, so
    // the test has to feed it the way production does.
    drops: r.drops
  }, (line) => lines.push(line))
  return (lines[0] && lines[0].dropped) || []
}

const RANKING_CASES = [
  {
    name: VERDICT.NO_DECLARED_CLAIM,
    plan: PLAN(`缺貨最嚴重嘅係 ${NAPA}。`),
    message: '現在缺貨最嚴重的是什麼？',
    evidence: EVIDENCE()
  },
  {
    name: VERDICT.METRIC_NOT_PROVEN,
    plan: PLAN(`${NAPA}。`, { answerClaims: [{ claimKind: 'extremum', metric: RANKING_METRIC.ABSOLUTE_SHORTFALL }] }),
    message: '邊個缺貨百分比最高？',
    evidence: EVIDENCE()
  },
  {
    name: VERDICT.RANKING_INCOMPLETE,
    plan: PLAN(`${NAPA}。`, { answerClaims: [{ claimKind: 'extremum', metric: RANKING_METRIC.ABSOLUTE_SHORTFALL }] }),
    message: '現在缺貨最嚴重的是什麼？',
    evidence: EVIDENCE({ rankingCompleteWithinScope: false })
  },
  {
    name: VERDICT.ORDER_CONTRADICTS_PROOF,
    plan: PLAN(`最嚴重係 ${JARS}，之後 ${NAPA}。`, { answerClaims: [{ claimKind: 'extremum', metric: RANKING_METRIC.ABSOLUTE_SHORTFALL }] }),
    message: '現在缺貨最嚴重的是什麼？',
    evidence: EVIDENCE()
  }
]

for (const c of RANKING_CASES) {
  test(`*** ⛔ ${c.name} SURVIVES INTO THE ACTUAL LOG LINE ***`, () => {
    const r = validatePlan(c.plan, ctx(c.message, c.evidence))
    assert.equal(rankingWhy(r), c.name, '⛔ wrong verdict in memory: ' + rankingWhy(r))
    // ⛔ THE POINT OF THIS TEST. It was already correct in memory before this round and still
    // never reached a log line, because the serializer does not carry `reason`.
    const logged = loggedDrops(r).find((d) => d && d.field === 'ranking')
    assert.ok(logged, '⛔ the ranking drop did not reach the log at all')
    assert.equal(logged.why, c.name, '⛔ the verdict was computed and discarded again')
  })
}

/* ═══ 4. NO CONTENT MAY REACH A LOG LINE ════════════════════════════════ */

test('*** ⛔ NO REPLY, SENTENCE, NAME OR ROW VALUE REACHES THE LOG ***', () => {
  const secret = 'Sysco'
  const sentence = `最嚴重係 ${JARS}，缺口 500 件，供應商 ${secret}。`
  const r = validatePlan(PLAN(sentence, {
    answerClaims: [{ claimKind: 'extremum', metric: RANKING_METRIC.ABSOLUTE_SHORTFALL }]
  }), ctx('現在缺貨最嚴重的是什麼？'))
  const json = JSON.stringify(loggedDrops(r))
  for (const banned of [sentence, secret, JARS, NAPA, '500', '現在缺貨最嚴重的是什麼？']) {
    assert.ok(!json.includes(banned), '⛔ content reached a drop line: ' + json)
  }
  // Sentence drops carry no sourceId either — a sentence has none to carry.
  for (const d of loggedDrops(r)) {
    if (d.kind === 'sentence') assert.equal(d.sourceId, '', '⛔ a sentence drop invented an id')
  }
})

test('*** ⛔ AND droppedSentences COUNTING IS UNCHANGED ***', () => {
  // One bad sentence, one good one: exactly one drop, and the good one still ships.
  const r = validatePlan(PLAN('餐廳系統有 500 項存貨記錄。餐廳系統有 199 項存貨記錄。'), ctx('而家倉存有咩？'))
  assert.equal(r.droppedSentences, 1, 'the counter did not move')
  assert.equal(r.plan.directAnswer, '餐廳系統有 199 項存貨記錄。', 'the surviving sentence is untouched')
  assert.equal(sentenceWhys(r).length, 1, 'one record beside one increment')
})
