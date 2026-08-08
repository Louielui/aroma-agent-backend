'use strict'

/**
 * claimBindingIntegration.test.js — A2 Phase 2. What must NOT change.
 *
 * The unit tests next door prove the verifier is correct. These prove it is INERT: that
 * adding a claim declaration changes no owner-visible byte, that `facts[]` validation is
 * untouched and row-local, and that the strict-schema guarantees still hold.
 *
 * 「it only adds metadata」 is a claim about code, and this project has been wrong about
 * exactly that before — a counter added to end a silent drop, itself silently dropped.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { validatePlan, ANSWER_PLAN_SCHEMA, DISTILL_WITH_PLAN_SCHEMA } = require('./answerPlan')
const { CLAIM_KIND, BINDING } = require('./claimBinding')

const NOW = '2026-08-08T12:00:00.000Z'

const EVIDENCE = {
  source: 'aroma_system',
  endpoint: 'purchaseOrders',
  entityType: 'purchase_order',
  trust: 'live',
  returnedRows: 2,
  shownCount: 2,
  matchingTotal: 2,
  sourceTotal: null,
  queryScope: { field: 'createdAt', window: 'last_30_days', declaredBy: 'reader' },
  filtersApplied: null,
  limit: 100,
  limitKnown: true,
  truncated: false,
  completeWithinScope: true,
  rowShape: { hasLocation: false, hasAsOf: true, note: null },
  metrics: {},
  completeness: 'complete',
  dataAsOf: null,
  retrievedAt: NOW
}

const ROWS = [{
  source: 'aroma_system',
  items: [
    { source: 'aroma_system', sourceId: 'PO1', title: 'PO-0001', entityType: 'purchase_order', content: 'id=PO1 · status=received', fields: { id: 'PO1', status: 'received' }, trust: 'live', retrievedAt: NOW },
    { source: 'aroma_system', sourceId: 'PO2', title: 'PO-0002', entityType: 'purchase_order', content: 'id=PO2 · status=open', fields: { id: 'PO2', status: 'open' }, trust: 'live', retrievedAt: NOW }
  ]
}]

const PLAN = {
  directAnswer: 'PO-0001 已收貨。',
  sections: [{ heading: '採購單', items: [{ sourceId: 'PO1', title: 'PO-0001', facts: [{ field: '狀態', value: 'received' }] }] }],
  limitations: [],
  followUp: null,
  unanswerable: false,
  citesEvidence: true
}

const CLAIMS = [{
  text: 'PO-0001 已收貨。',
  claimKind: CLAIM_KIND.ROW_LOCAL,
  evidenceSources: ['aroma_system'],
  sourceIds: ['PO1'],
  scope: { field: null, window: null }
}]

const run = (plan) => validatePlan(plan, { evidenceSets: [EVIDENCE], itemsBySource: ROWS, message: '' })

/* ═══ 9. OWNER-VISIBLE OUTPUT IS UNCHANGED ═══════════════════════════════════ */

test('*** ⛔ adding answerClaims changes NO owner-visible byte ***', () => {
  const without = run(PLAN)
  const with_ = run(Object.assign({}, PLAN, { answerClaims: CLAIMS }))
  assert.deepEqual(with_.plan, without.plan,
    'the rendered plan — directAnswer, sections, limitations, followUp — must be identical')
  assert.equal(JSON.stringify(with_.plan), JSON.stringify(without.plan), 'byte-identical')
})

test('*** every existing counter is unchanged by a claim declaration ***', () => {
  const a = run(PLAN)
  const b = run(Object.assign({}, PLAN, { answerClaims: CLAIMS }))
  for (const k of ['droppedFacts', 'droppedItems', 'droppedSentences', 'droppedLimitations',
    'sectionsNotDeclared', 'modelItemCount', 'keptItemCount', 'answerSurvived']) {
    assert.deepEqual(b[k], a[k], k + ' must not move')
  }
  assert.deepEqual(b.drops, a.drops, 'and no new drop is recorded')
})

test('*** ⛔ an INVALID claim declaration still changes nothing ***', () => {
  // The whole point of Phase 2: verification happens, enforcement does not.
  const bad = [{ text: 'x', claimKind: CLAIM_KIND.SOURCE_WIDE, evidenceSources: ['gmail'], sourceIds: [], scope: { field: null, window: null } }]
  const v = run(Object.assign({}, PLAN, { answerClaims: bad }))
  assert.equal(v.claimBindings[0].binding, BINDING.UNVERIFIED, 'the verdict is recorded')
  assert.equal(JSON.stringify(v.plan), JSON.stringify(run(PLAN).plan), 'and acted on by nothing')
})

/* ═══ 6. UNBOUND IS RECORDED, NOT INFERRED ══════════════════════════════════ */

test('*** a plan with no answerClaims yields NO bindings — UNBOUND, not guessed ***', () => {
  const v = run(PLAN)
  assert.deepEqual(v.claimBindings, [],
    'backward compatibility: an omitting provider is valid and its binding state is empty')
})

/* ═══ 8. facts[] VALIDATION IS UNCHANGED, AND ROW-LOCAL ═════════════════════ */

test('*** ⛔ facts[] survive a TRUNCATED source — row-local truth is not set-wide ***', () => {
  // BLOCKER 2, at the integration layer. PO1 came back; that 500 others did not is
  // irrelevant to 「PO1.status = received」.
  const truncated = Object.assign({}, EVIDENCE, {
    truncated: true, completeWithinScope: false, matchingTotal: null, returnedRows: 100, limit: 100, completeness: 'sample'
  })
  const v = validatePlan(PLAN, { evidenceSets: [truncated], itemsBySource: ROWS, message: '' })
  assert.equal(v.keptItemCount, 1, 'the row survived')
  assert.equal(v.droppedFacts, 0, 'and so did its fact')
  assert.equal(v.plan.sections[0].items[0].facts.length, 1)
})

test('*** a fact whose value is NOT in the row is still dropped — the check is unweakened ***', () => {
  const lying = JSON.parse(JSON.stringify(PLAN))
  lying.sections[0].items[0].facts[0].value = 'cancelled'
  const v = run(lying)
  assert.equal(v.droppedFacts, 1, 'row-local binding still proves the VALUE, not just the row')
})

test('*** facts[] never consult claimBindings ***', () => {
  // Same plan, one with a claim declaration that is UNVERIFIED. The fact must be unaffected.
  const bad = [{ text: 'x', claimKind: 'nonsense', evidenceSources: [], sourceIds: [], scope: { field: null, window: null } }]
  const a = run(PLAN)
  const b = run(Object.assign({}, PLAN, { answerClaims: bad }))
  assert.equal(b.droppedFacts, a.droppedFacts)
  assert.equal(b.keptItemCount, a.keptItemCount)
})

/* ═══ 10. THE STRICT SCHEMA GUARANTEES SURVIVE ══════════════════════════════ */

test('*** ⛔ additionalProperties:false still holds, at every level ***', () => {
  assert.equal(ANSWER_PLAN_SCHEMA.additionalProperties, false)
  const claims = ANSWER_PLAN_SCHEMA.properties.answerClaims
  assert.equal(claims.items.additionalProperties, false, 'a claim object is closed')
  assert.equal(claims.items.properties.scope.additionalProperties, false, 'and so is its scope')
})

test('*** answerClaims is OPTIONAL — required[] is unchanged ***', () => {
  assert.deepEqual(
    ANSWER_PLAN_SCHEMA.required.slice().sort(),
    ['citesEvidence', 'directAnswer', 'followUp', 'limitations', 'sections', 'unanswerable'].sort(),
    'adding it to required would break every existing provider and force an invented binding'
  )
  assert.equal(ANSWER_PLAN_SCHEMA.required.includes('answerClaims'), false)
})

test('*** claimKind is a CLOSED enum — a model cannot invent a fourth kind ***', () => {
  const e = ANSWER_PLAN_SCHEMA.properties.answerClaims.items.properties.claimKind.enum
  assert.deepEqual(e.slice().sort(), ['row_local', 'set_scoped', 'source_wide'])
})

test('*** the outer distill schema still closes additionalProperties ***', () => {
  assert.equal(DISTILL_WITH_PLAN_SCHEMA.additionalProperties, false)
  assert.ok(DISTILL_WITH_PLAN_SCHEMA.properties.answerPlan, 'and still carries the plan')
})
