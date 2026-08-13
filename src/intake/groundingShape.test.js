'use strict'

/**
 * groundingShape.test.js — WHICH numeric failure, never WHICH number.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED, requestId 01b900ee-9c7f-4753-b241-d2fb1912430a on bootCommit dfd556b.
 * The derived-prose repair shipped and `number_not_in_evidence` was STILL first in the drop
 * array. The live-shaped test that "proved" the repair had scripted one very clean sentence —
 * 「Napa Cabbage … 缺口 70。」 — so it proved that the canonical SHAPE passes, not that the
 * model writes it.
 *
 * Every distinct failure inside the numeric check collapsed to one word, so the record could
 * not say which. ⛔ AND IT MUST NOT BE GUESSED — a percentage, two rows in one sentence, a
 * label that did not match, a numeral before its label, and an ordinary unsupported number are
 * five different repairs. A plausible inference has been wrong six times this week.
 *
 * ⛔ OBSERVABILITY ONLY. Not one decision changes; `sentenceIsSupported` is now a thin
 * boolean wrapper over the reporting form, and every existing suite must stay green.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { validatePlan, logAnswerPlan } = require('./answerPlan')

const NAPA = 'Napa Cabbage'
const JARS = 'Jars for Red Chili Oil'
const DERIVATIONS = { 缺口: { minus: ['parLevel', 'currentStock'] } }

const row = (id, title, fields) => ({
  source: 'aroma_system', readKey: 'aroma_system.inventory', sourceId: id, title,
  entityType: 'inventory_item', content: 'x', fields, trust: 'live'
})

/** Napa: par 100 − stock 30 = 缺口 70, and a genuine raw `pack` 69. */
const ONE_ROW = [row('1', NAPA, { id: '1', parLevel: '100', currentStock: '30', pack: '69' })]
/** Two canonical rows sharing one title. */
const DUP_ROWS = [
  row('1', NAPA, { id: '1', parLevel: '100', currentStock: '30' }),
  row('9', NAPA, { id: '9', parLevel: '50', currentStock: '30' })
]

const EVIDENCE = [{
  source: 'aroma_system', entityType: 'inventory_item', endpoint: 'inventory', trust: 'live',
  shownCount: 1, matchingTotal: 199, sourceTotal: null,
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  rowShape: { hasLocation: false, hasAsOf: false, note: null },
  metrics: {}, derivations: DERIVATIONS, fieldLabels: {}, completeness: 'sample'
}]

const NEUTRAL = '而家倉存情況點？'
const ctx = (items) => ({
  evidenceSets: EVIDENCE,
  itemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.inventory', items }],
  message: NEUTRAL
})
const PLAN = (directAnswer) => ({ directAnswer, sections: [], limitations: [], followUp: null, unanswerable: false })

/** The `shape` on the sentence drop, or null. */
const shapeOf = (r) => {
  const d = (r.drops || []).find((x) => x && x.kind === 'sentence')
  return d ? (d.shape || null) : null
}
const whyOf = (r) => {
  const d = (r.drops || []).find((x) => x && x.kind === 'sentence')
  return d ? d.why : null
}

/* ═══ EACH BRANCH MAPS TO EXACTLY ONE ENUM ══════════════════════════════ */

const CASES = [
  {
    name: 'derived_wrong_value',
    // A declared label bound 69; the server computes 70. 69 is also a REAL raw field, so
    // without the derivation rule this would have laundered — see derivedProse.test.js.
    prose: `${NAPA} 缺口 69。`,
    items: ONE_ROW
  },
  {
    name: 'derived_no_one_row',
    // Two canonical rows share the title, so no single server value exists to compare.
    prose: `${NAPA} 缺口 70。`,
    items: DUP_ROWS
  },
  {
    name: 'derived_unbound',
    // ⛔ THE OPEN LIMIT, NOW COUNTABLE: the numeral is written BEFORE its label, so nothing
    // binds, and 12345 is in no row.
    prose: `${NAPA} 12345 係缺口。`,
    items: ONE_ROW
  },
  {
    name: 'raw_unsupported',
    // No declared label anywhere in the sentence. An ordinary unsupported number.
    prose: `${NAPA} 每箱 12345。`,
    items: ONE_ROW
  },
  {
    name: 'cjk_unsupported',
    // A CJK-written count that is in no row.
    prose: `${NAPA} 有三十七項。`,
    items: ONE_ROW
  }
]

for (const c of CASES) {
  test(`*** ⛔ ${c.name} IS REPORTED AS ITS OWN SHAPE ***`, () => {
    const r = validatePlan(PLAN(c.prose), ctx(c.items))
    assert.equal(r.plan.directAnswer, '', 'the sentence is still dropped — behaviour unchanged')
    assert.equal(whyOf(r), 'number_not_in_evidence', '⛔ the top-level why must stay compatible')
    assert.equal(shapeOf(r), c.name, '⛔ wrong shape: ' + shapeOf(r))
  })
}

test('*** ⛔ THE FIVE SHAPES ARE DISTINCT, AND ALL FIT THE 20-CHAR LOG FIELD ***', () => {
  const seen = CASES.map((c) => shapeOf(validatePlan(PLAN(c.prose), ctx(c.items))))
  assert.equal(new Set(seen).size, CASES.length, '⛔ two branches collapse to one name: ' + seen)
  // ⛔ The serializer truncates `shape` at 20. A longer name would be silently renamed.
  for (const s of seen) assert.ok(s.length <= 20, '⛔ would be truncated in the log: ' + s)
})

/* ═══ SUCCESS EMITS NO DETAIL ═══════════════════════════════════════════ */

test('*** ⛔ A SENTENCE THAT PASSES EMITS NO FAILURE DETAIL AT ALL ***', () => {
  const r = validatePlan(PLAN(`${NAPA} 缺口 70。`), ctx(ONE_ROW))
  assert.equal(r.plan.directAnswer, `${NAPA} 缺口 70。`, 'still accepted — behaviour unchanged')
  assert.deepEqual((r.drops || []).filter((d) => d && d.kind === 'sentence'), [],
    '⛔ a successful sentence produced a failure record')
})

test('*** and an ordinary raw sentence still passes with no detail ***', () => {
  const r = validatePlan(PLAN(`${NAPA} 每箱 69。`), ctx(ONE_ROW))
  assert.equal(r.plan.directAnswer, `${NAPA} 每箱 69。`)
  assert.deepEqual((r.drops || []).filter((d) => d && d.kind === 'sentence'), [])
})

/* ═══ ⛔ NO CONTENT MAY REACH A LOG LINE ════════════════════════════════ */

test('*** ⛔ NO SENTENCE, TITLE, NUMERAL, LABEL OR USER TEXT REACHES THE LOG ***', () => {
  const secret = 'Sysco'
  const sentence = `${NAPA} 同 ${JARS} 都缺貨，${JARS} 缺口 69，供應商 ${secret}。`
  const r = validatePlan(PLAN(sentence), ctx(ONE_ROW))

  const lines = []
  logAnswerPlan({
    requestId: '11111111-2222-4333-8444-555555555555',
    outcome: 'degraded', reason: 'answer_unsupported',
    droppedItems: r.droppedItems, droppedFacts: r.droppedFacts,
    droppedSentences: r.droppedSentences, droppedLimitations: 0,
    modelItemCount: r.modelItemCount, keptItemCount: r.keptItemCount,
    drops: r.drops
  }, (l) => lines.push(l))

  const json = JSON.stringify(lines[0])
  // ⛔ SHOWN, NOT ASSERTED IN PROSE: every one of these was fed in above.
  for (const banned of [sentence, NAPA, JARS, secret, '缺口', '69', NEUTRAL]) {
    assert.ok(!json.includes(banned), '⛔ content reached the log: ' + json)
  }
  // And the shape that IS carried is one of the closed enum values.
  const ALLOWED = new Set(['derived_wrong_value', 'derived_no_one_row', 'derived_unbound', 'raw_unsupported', 'cjk_unsupported'])
  for (const d of lines[0].dropped) {
    if (d.kind === 'sentence' && d.shape) assert.ok(ALLOWED.has(d.shape), '⛔ unenumerated shape: ' + d.shape)
  }
})

test('*** ⛔ AND THE DETAIL RIDES ON A FIELD THE SERIALIZER ALREADY SHIPPED ***', () => {
  const r = validatePlan(PLAN(`${NAPA} 缺口 69。`), ctx(ONE_ROW))
  const lines = []
  logAnswerPlan({ requestId: '11111111-2222-4333-8444-555555555555', outcome: 'degraded', reason: 'answer_unsupported', droppedItems: 0, droppedFacts: 0, droppedSentences: 1, droppedLimitations: 0, modelItemCount: 0, keptItemCount: 0, drops: r.drops }, (l) => lines.push(l))
  const d = lines[0].dropped.find((x) => x.kind === 'sentence')
  assert.ok(d, 'the sentence drop reached the log')
  assert.equal(d.why, 'number_not_in_evidence', 'the compatible top-level reason')
  assert.equal(d.shape, 'derived_wrong_value', '⛔ the detail did not survive the projection')
})

/* ═══ ⛔ MIXED CASE — A VALID DERIVATION PLUS AN UNRELATED BAD NUMBER ════ */

/**
 * ⛔ THE EYE MUST NOT MISREPORT. `labelSeen` alone said 「a declared label appeared」, so any
 * later unsupported numeral was blamed on the derivation layer — even when the derivation had
 * worked perfectly. This observability exists precisely to stop us repairing the wrong layer;
 * an eye that misreports is worse than none, because we would follow it.
 *
 * None of the first ten tests covered this: they each had a single numeral.
 */
test('*** ⛔ A VALID DERIVATION + AN UNRELATED BAD NUMBER IS raw_unsupported ***', () => {
  // 缺口 70 is correct, server-validated and consumed. 12345 is the real problem.
  const r = validatePlan(PLAN(`${NAPA} 缺口 70，預測 12345。`), ctx(ONE_ROW))
  assert.equal(r.plan.directAnswer, '', 'the sentence still drops — behaviour unchanged')
  assert.equal(whyOf(r), 'number_not_in_evidence', 'top-level why unchanged')
  assert.equal(shapeOf(r), 'raw_unsupported',
    '⛔ a working derivation was blamed for an unrelated numeral: ' + shapeOf(r))
})

test('*** ⛔ AND THE NUMERAL-BEFORE-LABEL CASE IS STILL derived_unbound ***', () => {
  // Nothing bound here, so the derivation layer IS the right place to look.
  const r = validatePlan(PLAN(`${NAPA} 12345 係缺口。`), ctx(ONE_ROW))
  assert.equal(shapeOf(r), 'derived_unbound', '⛔ the genuine unbound case was reclassified')
})

test('*** ⛔ THE TWO ARE TOLD APART ON OTHERWISE IDENTICAL INPUT ***', () => {
  // Same row, same label, same unsupported numeral. The ONLY difference is whether a
  // derivation successfully bound — so that is the only thing that can be deciding.
  const mixed = shapeOf(validatePlan(PLAN(`${NAPA} 缺口 70，預測 12345。`), ctx(ONE_ROW)))
  const unbound = shapeOf(validatePlan(PLAN(`${NAPA} 12345，缺口。`), ctx(ONE_ROW)))
  assert.notEqual(mixed, unbound, '⛔ bound and unbound collapse to one shape')
  assert.equal(mixed, 'raw_unsupported')
  assert.equal(unbound, 'derived_unbound')
})

test('*** ⛔ AND A VALID DERIVATION WITH NO OTHER NUMBER STILL PASSES CLEAN ***', () => {
  const r = validatePlan(PLAN(`${NAPA} 缺口 70。`), ctx(ONE_ROW))
  assert.equal(r.plan.directAnswer, `${NAPA} 缺口 70。`)
  assert.deepEqual((r.drops || []).filter((d) => d && d.kind === 'sentence'), [])
})
