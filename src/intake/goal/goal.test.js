'use strict'
/**
 * goal.test.js — the decomposer, and the three rules the Owner asked to be STRUCTURAL.
 *
 * ⛔ NO NETWORK, NO MODEL, NO PAID CALL. `callModel` is a fake in every case.
 * ⛔ The two acceptance cases are asserted as CASES, including the one whose correct answer is
 *    「cannot be answered」 — recorded so nobody later reads a refusal as a regression.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cat = require('./operationCatalogue')
const { STATUS, REASON, JOIN_STATUS, PLAN_REFUSED, MAX_FACTS, goalPlanSchema, judgeGoalPlan } = require('./goalPlanContract')
const { decomposeGoal, REFUSED } = require('./goalDecomposer')
const { AROMA_OPERATIONS } = require('../../context/readOperations')
const { ROW_SHAPE, QUERY_SCOPE, SERVER_LIMITS } = require('../../context/adapters/aromaSystemRead')

const REPLEN = 'aroma_system.replenishment'
const INVOICES = 'aroma_system.invoices'
const COUNTS = 'aroma_system.daily_counts'
const INVENTORY = 'aroma_system.inventory'

const plan = (facts, joins) => judgeGoalPlan({ question_restated: 'q', facts, joins: joins || [] })

/* ═══ THE CATALOGUE ASSEMBLES, AND DESCRIBES NOTHING ITSELF ════════════════ */

test('*** the catalogue is assembled from the frozen tables, and every operation resolves ***', () => {
  assert.equal(cat.CATALOGUE.length, AROMA_OPERATIONS.length)
  for (const op of AROMA_OPERATIONS) {
    const key = cat.ENDPOINT_OF_INTENT[op.intentKey]
    assert.ok(key, '⛔ no endpoint key for intent ' + op.intentKey)
    // ⛔ DRIFT: the tables are keyed independently, so a rename in one is a failing test here
    // rather than a catalogue entry that silently loses its shape.
    assert.ok(ROW_SHAPE[key], 'ROW_SHAPE missing ' + key)
    assert.ok(QUERY_SCOPE[key], 'QUERY_SCOPE missing ' + key)
    assert.ok(Object.prototype.hasOwnProperty.call(SERVER_LIMITS, key), 'SERVER_LIMITS missing ' + key)
    const e = cat.operationEntry(op.operation)
    assert.ok(e && e.entityType, 'no entity type for ' + op.operation)
  }
})

test('*** ⛔ the prompt catalogue carries SHAPES and not one data row ***', () => {
  const forPrompt = cat.catalogueForPrompt()
  const allowed = ['operation', 'label', 'entity', 'numbers', 'hasLocation', 'hasTimestamp', 'note', 'window', 'limit']
  for (const row of forPrompt) {
    for (const k of Object.keys(row)) assert.ok(allowed.includes(k), '⛔ unexpected key reaching the model: ' + k)
  }
  // The decomposer file must not import a reader at all — planning is not reading.
  const src = fs.readFileSync(path.resolve(__dirname, 'goalDecomposer.js'), 'utf8')
  assert.equal(/require\([^)]*(aromaSystemRead|readConnector|contextResult)/.test(src), false,
    '⛔ the decomposer reached for a reader')
})

test('*** field tiers: a metric is VERIFIED here, a spelling is only a CANDIDATE ***', () => {
  assert.equal(cat.fieldTier(REPLEN, 'live_qty'), cat.FIELD_TIER.VERIFIED)
  assert.equal(cat.fieldTier(REPLEN, 'supplierId'), cat.FIELD_TIER.CANDIDATE)
  assert.equal(cat.fieldTier(REPLEN, 'unit_cost'), cat.FIELD_TIER.UNKNOWN)
  // ⛔ A NEIGHBOUR'S METRIC IS NOT THIS ENDPOINT'S. `total` is on invoices, never on planning.
  assert.equal(cat.fieldTier(INVOICES, 'total'), cat.FIELD_TIER.VERIFIED)
  assert.equal(cat.fieldTier(REPLEN, 'total'), cat.FIELD_TIER.UNKNOWN)
})

/* ═══ RULE 1 — NO NEAREST-NEIGHBOUR SUBSTITUTION ══════════════════════════ */

test('*** ⛔ RULE 1 — a need nothing carries is UNAVAILABLE, decided by the enum and not the model ***', () => {
  const r = plan([{ id: 'cost', need: '每碟菜嘅成本', operation: null, entity: null, fields: [] }])
  assert.equal(r.plan.facts[0].status, STATUS.UNAVAILABLE)
  assert.equal(r.plan.facts[0].reason, REASON.NO_OPERATION)
  assert.equal(r.plan.sufficient, false)
  assert.equal(r.plan.reads.length, 0, 'an unavailable fact buys no read')
})

test('*** ⛔ RULE 1 — costing answered from INVOICES is refused on the ENTITY, with nobody reading the need ***', () => {
  // The dangerous shape: invoices are adjacent, carry money, and `total` is a real verified
  // field there. Only the entity check catches this.
  const r = plan([{ id: 'cost', need: '每碟菜嘅成本', operation: INVOICES, entity: 'inventory_item', fields: ['total'] }])
  assert.equal(r.plan.facts[0].status, STATUS.UNAVAILABLE)
  assert.equal(r.plan.facts[0].reason, REASON.ENTITY_MISMATCH)
})

test('*** ⛔ there is no cost entity and no costing operation to name in the first place ***', () => {
  const schema = goalPlanSchema()
  const ops = schema.properties.facts.items.properties.operation.enum
  const ents = schema.properties.facts.items.properties.entity.enum
  assert.equal(ops.some((o) => o && /cost/i.test(o)), false)
  assert.equal(ents.some((e) => e && /cost/i.test(e)), false)
  assert.ok(ops.includes(null), 'null must be sayable — it is the honest answer')
  assert.equal(ops.filter(Boolean).length, AROMA_OPERATIONS.length, 'the enum IS the closed list')
})

/* ═══ RULE 2 — A FIELD NAME IS NOT A FIELD ════════════════════════════════ */

test('*** ⛔ RULE 2 — a CANDIDATE field caps a fact at PARTIAL, and an UNKNOWN one kills it ***', () => {
  const partial = plan([{ id: 'sup', need: '供應商', operation: REPLEN, entity: 'order_suggestion', fields: ['supplierId'] }])
  assert.equal(partial.plan.facts[0].status, STATUS.PARTIAL)
  assert.equal(partial.plan.facts[0].reason, REASON.UNVERIFIED_FIELD)

  const dead = plan([{ id: 'c', need: '成本', operation: REPLEN, entity: 'order_suggestion', fields: ['unit_cost'] }])
  assert.equal(dead.plan.facts[0].status, STATUS.UNAVAILABLE)
  assert.equal(dead.plan.facts[0].reason, REASON.UNKNOWN_FIELD)
})

/* ═══ RULE 3 — A JOIN IS A HYPOTHESIS ═════════════════════════════════════ */

test('*** ⛔ RULE 3 — a declared join is UNVERIFIED, and it costs sufficiency ***', () => {
  const r = plan(
    [{ id: 'a', need: '缺口', operation: REPLEN, entity: 'order_suggestion', fields: ['live_qty'] }],
    [{ from: REPLEN, to: 'aroma_system.suppliers', on: 'supplierId' }]
  )
  assert.equal(r.plan.joins[0].status, JOIN_STATUS.UNVERIFIED)
  assert.equal(r.plan.sufficient, false, 'an unverified edge cannot be traversed')
})

/* ═══ THE SERVER OWNS THE VERDICT ═════════════════════════════════════════ */

test('*** ⛔ the model\'s own status and sufficiency are thrown away ***', () => {
  const r = judgeGoalPlan({
    question_restated: 'q',
    sufficient: true, // the model's opinion
    facts: [{ id: 'x', need: '成本', operation: null, entity: null, fields: [], status: 'AVAILABLE' }],
    joins: []
  })
  assert.equal(r.plan.sufficient, false)
  assert.equal(r.plan.facts[0].status, STATUS.UNAVAILABLE, 'recomputed, not accepted')
})

test('*** a plan over the fact bound is REFUSED, never quietly truncated ***', () => {
  const five = Array.from({ length: MAX_FACTS + 1 }, (_, i) => ({ id: 'f' + i, need: 'n', operation: REPLEN, entity: 'order_suggestion', fields: ['live_qty'] }))
  const r = judgeGoalPlan({ question_restated: 'q', facts: five, joins: [] })
  assert.equal(r.ok, false)
  assert.equal(r.reason, PLAN_REFUSED.TOO_MANY_FACTS)
})

/* ═══ ACCEPTANCE CASE 1 — COSTCO ══════════════════════════════════════════ */

test('*** ACCEPTANCE 1 — Costco: shortfall is answerable; supplier and incoming are not yet ***', () => {
  const r = plan([
    { id: 'shortfall', need: '邊啲貨低過安全存量、爭幾多', operation: REPLEN, entity: 'order_suggestion', fields: ['live_qty', 'par_level', 'suggested_order_qty'] },
    { id: 'incoming', need: '有冇貨喺途中', operation: REPLEN, entity: 'order_suggestion', fields: ['incoming_qty'] },
    { id: 'supplier', need: '邊個供應商', operation: REPLEN, entity: 'order_suggestion', fields: ['supplierId'] }
  ])

  const by = Object.fromEntries(r.plan.facts.map((f) => [f.id, f]))
  // The one the Owner can actually use today.
  assert.equal(by.shortfall.status, STATUS.AVAILABLE)
  assert.deepEqual(r.plan.reads, [REPLEN])

  // ⛔ AND THE TWO THAT ARE NOT. `incoming_qty` was referenced by a real reply, which is not an
  // audit — it is absent from the measured metric table, so it is UNKNOWN here and says so.
  assert.equal(by.incoming.status, STATUS.UNAVAILABLE)
  assert.equal(by.incoming.reason, REASON.UNKNOWN_FIELD)
  assert.equal(by.supplier.status, STATUS.PARTIAL)
  assert.equal(r.plan.sufficient, false)
  assert.ok(r.plan.missing.length >= 2)
})

/* ═══ ACCEPTANCE CASE 2 — 上次盤點同存量 ══════════════════════════════════ */

test('*** ACCEPTANCE 2 — 「上次盤點同存量對唔對得上」 is NOT ANSWERABLE, and that is the PASS ***', () => {
  const r = plan(
    [
      { id: 'count', need: '上次盤點數', operation: COUNTS, entity: 'daily_count', fields: ['itemCount'] },
      { id: 'stock', need: '而家嘅存量', operation: INVENTORY, entity: 'inventory_item', fields: ['currentStock'] }
    ],
    [{ from: COUNTS, to: INVENTORY, on: 'ingredientId' }]
  )

  // ⛔ THE REAL BLOCKER IS NOT THE JOIN. It is that inventory carries no timestamp, so a timed
  // count and an untimed stock number have no common basis to be compared on.
  assert.equal(r.plan.joins[0].status, JOIN_STATUS.NO_SHARED_TIME_BASIS)
  assert.ok(/冇時間戳/.test(r.plan.joins[0].detail))

  // The 7-day window on daily counts is surfaced too, from the table and not from the question.
  assert.ok(r.plan.scopeHazards.some((h) => h.operation === COUNTS && h.window === 'last_7_days'))

  assert.equal(r.plan.sufficient, false)
  // ⛔ Owner ruling, on the record: this refusal is a PASS. It is the system saying WHY it
  // cannot answer instead of assembling a comparison that looks like one.
  assert.ok(r.plan.missing.length >= 2, 'and it says what is missing rather than going quiet')
})

/* ═══ THE CALL ITSELF ═════════════════════════════════════════════════════ */

test('*** decomposeGoal: one call, schema-forced, usage carried verbatim ***', async () => {
  const calls = []
  const callModel = async (args) => {
    calls.push(args)
    return {
      parsed: { question_restated: '邊啲貨要補', facts: [{ id: 'a', need: '缺口', operation: REPLEN, entity: 'order_suggestion', fields: ['live_qty'] }], joins: [] },
      usage: { inputTokens: 812, outputTokens: 96 }
    }
  }
  const r = await decomposeGoal({ question: '邊啲貨要補？', callModel, model: 'test-model' })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 1, '⛔ ONE call. This is not a loop.')
  assert.equal(calls[0].responseFormat.type, 'json_schema')
  assert.equal(calls[0].responseFormat.strict, true)
  assert.equal(r.plan.facts[0].status, STATUS.AVAILABLE)
  assert.equal(r.usage.inputTokens, 812)
  assert.equal(r.usage.outputTokens, 96)
  assert.equal(r.usage.model, 'test-model')
})

test('*** an absent usage block stays null — it is not a zero ***', async () => {
  const callModel = async () => ({ parsed: { question_restated: 'q', facts: [{ id: 'a', need: 'n', operation: REPLEN, entity: 'order_suggestion', fields: ['live_qty'] }], joins: [] } })
  const r = await decomposeGoal({ question: 'q', callModel })
  assert.equal(r.usage.inputTokens, null)
  assert.equal(r.usage.outputTokens, null)
})

test('*** a decomposer that fails is a refusal, never a guessed plan ***', async () => {
  const boom = async () => { throw new Error('provider down') }
  const r = await decomposeGoal({ question: 'q', callModel: boom })
  assert.equal(r.ok, false)
  assert.equal(r.reason, REFUSED.MODEL_FAILED)
  assert.equal(r.plan, undefined)

  assert.equal((await decomposeGoal({ question: '', callModel: boom })).reason, REFUSED.NO_QUESTION)
  assert.equal((await decomposeGoal({ question: 'q' })).reason, REFUSED.NO_MODEL)
})

/* ═══ NOT WIRED, AND NOT A SECOND LOOP ════════════════════════════════════ */

test('*** ⛔ B is not wired into the runtime, and is not a second reasoning loop ***', () => {
  const SRC = path.resolve(__dirname, '..', '..')
  const offenders = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== 'goal') walk(p); continue }
      if (!/\.js$/.test(n) || /\.test\.js$/.test(n)) continue
      if (/require\([^)]*goal\/(goalDecomposer|goalPlanContract|operationCatalogue)/.test(fs.readFileSync(p, 'utf8'))) {
        offenders.push(path.relative(SRC, p))
      }
    }
  }
  walk(SRC)
  assert.deepEqual(offenders, [], '⛔ B reached production before it was proven')

  // ⛔ AND NO SECOND LOOP. The existing reasoningLoop owns stepping and dispatch; this file
  // must contain neither, or the third instance of 「build a second copy」 has happened again.
  const dec = fs.readFileSync(path.resolve(__dirname, 'goalDecomposer.js'), 'utf8')
    .split('\n').filter((l) => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) }).join('\n')
  assert.equal(/MAX_(REASONING_)?STEPS|maxSteps|for\s*\(|while\s*\(/.test(dec), false, '⛔ a step loop appeared in the decomposer')
  assert.equal(/runReasoningLoop|capability|dispatch/i.test(dec), false, '⛔ the decomposer started executing things')
})
