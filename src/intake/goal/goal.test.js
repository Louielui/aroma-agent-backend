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

// Facts default to required so existing cases keep their meaning.
const plan = (facts, joins) => judgeGoalPlan({ question_restated: 'q', facts: facts.map((f) => Object.assign({ necessity: 'required' }, f)), joins: joins || [] })

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
  // ⛔ C4 ADDS `kind`, AND IT IS STRUCTURE, NOT DATA — which is the property this guards.
  // The catalogue now carries two classes: typed Aroma operations with a measured field
  // capture, and source-level reads with none. The planner has to be able to tell them
  // apart, because the second class must not be handed fields it never had.
  const allowed = ['operation', 'label', 'entity', 'numbers', 'fields', 'arrays', 'hasLocation', 'hasTimestamp', 'note', 'window', 'limit', 'kind']
  for (const row of forPrompt) {
    for (const k of Object.keys(row)) assert.ok(allowed.includes(k), '⛔ unexpected key reaching the model: ' + k)
  }
  // The decomposer file must not import a reader at all — planning is not reading.
  const src = fs.readFileSync(path.resolve(__dirname, 'goalDecomposer.js'), 'utf8')
  assert.equal(/require\([^)]*(aromaSystemRead|readConnector|contextResult)/.test(src), false,
    '⛔ the decomposer reached for a reader')
})

test('*** field tiers after the capture — the four states 「CANDIDATE」 was hiding ***', () => {
  // A declared metric, and a field the capture found carrying values. Both usable.
  assert.equal(cat.fieldTier(REPLEN, 'live_qty'), cat.FIELD_TIER.VERIFIED)
  assert.equal(cat.fieldTier(REPLEN, 'incoming_qty'), cat.FIELD_TIER.PRESENT)
  assert.equal(cat.fieldTier(REPLEN, 'supplier_name'), cat.FIELD_TIER.PRESENT)

  // ⛔ PRESENT ON EVERY ROW AND EMPTY ON EVERY ROW. The invoices.supplierId shape, now
  // measured on two other endpoints. A name-only capture would have called these usable.
  assert.equal(cat.fieldTier('aroma_system.suppliers', 'cutoffTime'), cat.FIELD_TIER.ALWAYS_EMPTY)
  assert.equal(cat.fieldTier(COUNTS, 'items'), cat.FIELD_TIER.ALWAYS_EMPTY)

  // ⛔ NOTHING WAS LEARNED, WHICH IS NOT THE SAME AS NOTHING IS THERE. Invoices returned
  // zero rows — a 30-day window with no invoices in it.
  assert.equal(cat.fieldTier(INVOICES, 'supplierId'), cat.FIELD_TIER.UNOBSERVED)

  // ⛔ AND MEASURED ABSENCE. Order planning spells it snake_case; the camelCase guess that
  // used to rate CANDIDATE is now known not to be there. The capture demoted it.
  assert.equal(cat.fieldTier(REPLEN, 'supplierId'), cat.FIELD_TIER.UNKNOWN)
  assert.equal(cat.fieldTier(REPLEN, 'supplier_id'), cat.FIELD_TIER.PRESENT)

  // A neighbour's metric is still not this endpoint's.
  assert.equal(cat.fieldTier(REPLEN, 'total'), cat.FIELD_TIER.UNKNOWN)
  assert.equal(cat.fieldTier(REPLEN, 'unit_cost'), cat.FIELD_TIER.UNKNOWN)
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

  /**
   * ⛔ READ THROUGH `anyOf`, BECAUSE THE VALUES MOVED THERE AND DID NOT DIE.
   *
   * `operation` used to be `type: ['string','null']` with the enum alongside. Anthropic 400s
   * that shape — measured — so it is now `anyOf: [{string, enum}, {null}]`. Every property
   * this test protects is unchanged; only where the values live changed.
   */
  const branchesOf = (prop) => {
    assert.ok(Array.isArray(prop.anyOf), 'the nullable-enum spelling is anyOf (Anthropic 400s the union form)')
    const withEnum = prop.anyOf.find((b) => Array.isArray(b.enum))
    const withNull = prop.anyOf.find((b) => b.type === 'null')
    assert.ok(withEnum, 'one branch carries the closed list')
    assert.ok(withNull, 'null must be sayable — it is the honest answer, and it is its own branch now')
    return withEnum.enum
  }

  const ops = branchesOf(schema.properties.facts.items.properties.operation)
  const ents = branchesOf(schema.properties.facts.items.properties.entity)
  assert.equal(ops.some((o) => o && /cost/i.test(o)), false)
  assert.equal(ents.some((e) => e && /cost/i.test(e)), false)
  /**
   * ⛔ SAME PROPERTY, TWO AUTHORITATIVE TABLES. The enum still admits nothing that is not
   * declared somewhere: C4 did not open it, it joined a second closed table to the first.
   * Comparing the whole list, in order, against both declarations is strictly stronger than
   * the length check it replaces — a wrong name of the right count used to pass.
   */
  const { SOURCE_LEVEL_OPERATIONS } = require('../../context/readOperations')
  const declared = [
    ...AROMA_OPERATIONS.map((o) => o.operation),
    ...SOURCE_LEVEL_OPERATIONS.map((o) => o.operation)
  ]
  assert.deepEqual(ops.filter(Boolean), declared, 'the enum IS the closed list')
})

/* ═══ RULE 2 — A FIELD NAME IS NOT A FIELD ════════════════════════════════ */

test('*** ⛔ RULE 2 — an empty field and an unobserved one cap a fact at PARTIAL; an absent one kills it ***', () => {
  // ⛔ THE FIELD IS THERE AND IT HAS NEVER HELD ANYTHING. An answer cannot stand on it, and
  // the reason says which of the three failures this is rather than lumping them together.
  const empty = plan([{ id: 'cut', need: '落單截止時間', operation: 'aroma_system.suppliers', entity: 'supplier', fields: ['cutoffTime'] }])
  assert.equal(empty.plan.facts[0].status, STATUS.PARTIAL)
  assert.equal(empty.plan.facts[0].reason, REASON.ALWAYS_EMPTY_FIELD)

  const unseen = plan([{ id: 'inv', need: '發票供應商', operation: INVOICES, entity: 'invoice', fields: ['supplierId'] }])
  assert.equal(unseen.plan.facts[0].status, STATUS.PARTIAL)
  assert.equal(unseen.plan.facts[0].reason, REASON.UNOBSERVED_FIELD)

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

test('*** ACCEPTANCE 1 — Costco is ANSWERABLE, in ONE read and with NO join ***', () => {
  // ⛔ THE CAPTURE, NOT A WIDENED TABLE, IS WHY THIS PASSES NOW. `incoming_qty` is on 55 of 55
  // order-planning rows and non-empty on 55 of 55; `supplier_name` on 55 and non-empty on 53.
  // METRICS_OF was not touched — it still holds numbers only, and these are promoted by
  // measurement in a separate captured table.
  //
  // AND THE ANSWER IS BETTER THAN THE DESIGN EXPECTED: supplier is a column ON the
  // order-planning row, so the shortfall × supplier × incoming question needs one read and no
  // join at all. The design assumed an edge to `suppliers` that does not need traversing.
  const r = plan([
    { id: 'shortfall', need: '邊啲貨低過安全存量、爭幾多', operation: REPLEN, entity: 'order_suggestion', fields: ['ingredient_name', 'live_qty', 'par_level', 'suggested_order_qty'] },
    { id: 'incoming', need: '有冇貨喺途中', operation: REPLEN, entity: 'order_suggestion', fields: ['incoming_qty'] },
    { id: 'supplier', need: '邊個供應商', operation: REPLEN, entity: 'order_suggestion', fields: ['supplier_name'] }
  ])

  const by = Object.fromEntries(r.plan.facts.map((f) => [f.id, f]))
  assert.equal(by.shortfall.status, STATUS.AVAILABLE)
  assert.equal(by.incoming.status, STATUS.AVAILABLE)
  assert.equal(by.supplier.status, STATUS.AVAILABLE)

  assert.equal(r.plan.joins.length, 0, 'no edge to traverse — supplier is on the row')
  assert.equal(r.plan.scopeHazards.length, 0, 'order planning carries no window')
  assert.equal(r.plan.sufficient, true, '⛔ THE FIRST QUESTION THIS SYSTEM CAN FULLY ANSWER')
  assert.deepEqual(r.plan.missing, [])
  // ⛔ ONE read, not three. Three facts against one endpoint is one call, and the previous
  // version of this assertion demanded the wrong answer.
  assert.deepEqual(r.plan.reads, [REPLEN])
  assert.equal(r.plan.minimality.readCount, 1)
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

test('*** ⛔ B reaches production through ONE call site, and is not a second reasoning loop ***', () => {
  /**
   * ⛔ THIS ASSERTION WAS INVERTED ON PURPOSE, 2026-08-11, UNDER AN OWNER GO.
   *
   * It used to read 「B is not wired into the runtime」 and assert `offenders` was EMPTY — which
   * was true and load-bearing for as long as B was unproven. Wiring it made that test red, and
   * the red was correct: a guarantee changed, and something had to say so out loud.
   *
   * It is REPLACED rather than deleted, because a deleted assertion removes a guarantee in
   * silence (the R3.1 defect, and the reason `docs/TEST-NAME-LEDGER.txt` exists). The property
   * being protected has moved, not died: B may reach production, but through exactly one seam,
   * so a second entry point cannot appear without this going red again.
   */
  const SRC = path.resolve(__dirname, '..', '..')
  const offenders = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== 'goal') walk(p); continue }
      if (!/\.js$/.test(n) || /\.test\.js$/.test(n)) continue
      if (/require\([^)]*goal\/(goalDecomposer|goalPlanContract|operationCatalogue)/.test(fs.readFileSync(p, 'utf8'))) {
        // Separators normalised: this ran green on POSIX and would have failed only on Windows,
        // which is the machine it actually runs on.
        offenders.push(path.relative(SRC, p).replace(/\\/g, '/'))
      }
    }
  }
  walk(SRC)
  assert.deepEqual(offenders, ['intake/intakeService.js'],
    '⛔ B has exactly ONE call site. A second one is a second entry point with its own price ' +
    'and its own failure mode, and it must be a deliberate act rather than a discovery.')

  // ⛔ AND IT IS OFF UNLESS THE OWNER SAYS OTHERWISE. The wiring is load-bearing when the flag
  // is on, so the default is the thing that must not drift.
  const { goalDecomposerEnabled } = require('./goalGate')
  assert.equal(goalDecomposerEnabled({}), false, '⛔ GOAL_DECOMPOSER defaults OFF')
  assert.equal(goalDecomposerEnabled(process.env), false, '⛔ and it is not on in this environment')

  // ⛔ AND NO SECOND LOOP. The existing reasoningLoop owns stepping and dispatch; this file
  // must contain neither, or the third instance of 「build a second copy」 has happened again.
  const dec = fs.readFileSync(path.resolve(__dirname, 'goalDecomposer.js'), 'utf8')
    .split('\n').filter((l) => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) }).join('\n')
  assert.equal(/MAX_(REASONING_)?STEPS|maxSteps|for\s*\(|while\s*\(/.test(dec), false, '⛔ a step loop appeared in the decomposer')
  assert.equal(/runReasoningLoop|capability|dispatch/i.test(dec), false, '⛔ the decomposer started executing things')
})

/* ═══ SPARSE, AND THE RATIO THAT TRAVELS ══════════════════════════════════ */

test('*** ⛔ SPARSE is ALWAYS_EMPTY\'s neighbour — 3/36 cannot wear the same label as 55/55 ***', () => {
  assert.equal(cat.fieldTier('aroma_system.suppliers', 'email'), cat.FIELD_TIER.SPARSE)
  assert.equal(cat.fieldTier(REPLEN, 'latest_price'), cat.FIELD_TIER.SPARSE)
  assert.equal(cat.fieldTier(REPLEN, 'incoming_qty'), cat.FIELD_TIER.PRESENT)

  // ⛔ AND IT COSTS THE FACT. An answer built on 3 of 36 speaks for 8% of suppliers and is
  // silent about the rest — the invoices.supplierId failure with a smaller denominator.
  const r = plan([{ id: 'c', need: '點聯絡供應商', operation: 'aroma_system.suppliers', entity: 'supplier', fields: ['email'] }])
  assert.equal(r.plan.facts[0].status, STATUS.PARTIAL)
  assert.equal(r.plan.facts[0].reason, REASON.SPARSE_FIELD)
  assert.ok(/3\/36/.test(r.plan.facts[0].detail), 'the measured ratio is in the reason, not just a label')
})

test('*** ⛔ the ratio travels on BOTH sides of every threshold ***', () => {
  // Usable, and honest about how usable. 32 of 55 is an answer with a stated denominator,
  // not a refusal and not a silent generalisation.
  const r = plan([{ id: 'p', need: '入貨包裝', operation: REPLEN, entity: 'order_suggestion', fields: ['pack_size'] }])
  assert.equal(r.plan.facts[0].status, STATUS.AVAILABLE)
  const t = r.plan.facts[0].fieldTiers[0]
  assert.equal(t.tier, cat.FIELD_TIER.PARTIAL_COVERAGE)
  assert.deepEqual({ n: t.coverage.nonEmpty, d: t.coverage.present }, { n: 32, d: 55 })

  // And on a field that is complete, the ratio is still carried rather than dropped.
  const full = plan([{ id: 'i', need: '在途', operation: REPLEN, entity: 'order_suggestion', fields: ['incoming_qty'] }])
  assert.equal(full.plan.facts[0].fieldTiers[0].coverage.ratio, 1)
})

/* ═══ ONE LEVEL DEEPER ════════════════════════════════════════════════════ */

test('*** ⛔ purchase-order items carry a NAME and no ingredient id — the join is a spelling match ***', () => {
  const items = cat.arrayShapeOf('aroma_system.purchasing', 'items')
  assert.equal(items.elements, 207)
  const names = items.fields.map((f) => f.name)
  assert.deepEqual(names, ['itemName', 'purchaseOrderId', 'quantity', 'supplierItemName', 'unit'])

  // ⛔ THE FINDING. No ingredientId, no ingredient_id, nothing that resolves to order planning
  // except a display name — so matching PO lines to shortfall rows is a string comparison,
  // which is HR-56's defect sitting inside the join rather than beside it.
  assert.equal(names.some((n) => /ingredient/i.test(n)), false)

  // And the one field that might have carried a supplier's own code is sparse: 13 of 207.
  const sup = items.fields.find((f) => f.name === 'supplierItemName')
  assert.deepEqual({ n: sup.nonEmpty, d: sup.present }, { n: 13, d: 207 })
})

test('*** ⛔ daily-count items are 50 empty arrays — the count-vs-stock case has no per-item data at all ***', () => {
  const items = cat.arrayShapeOf(COUNTS, 'items')
  assert.equal(items.elements, 0, 'not one element across 50 rows')
  assert.equal(cat.fieldTier(COUNTS, 'items'), cat.FIELD_TIER.ALWAYS_EMPTY)
  // A name-only capture would have blessed this: present on 50 of 50 rows, correctly typed
  // as an array, and carrying nothing. It is what would have made 「上次盤點同存量對唔對得上」
  // look answerable right up until someone tried to read an item out of it.
})

/* ═══ MINIMALITY — THE JUDGE CARES, SO THE PLAN CANNOT PAD ════════════════ */

test('*** ⛔ three facts against one endpoint are ONE read ***', () => {
  const r = plan([
    { id: 'a', need: '缺口', operation: REPLEN, entity: 'order_suggestion', fields: ['live_qty'] },
    { id: 'b', need: '供應商', operation: REPLEN, entity: 'order_suggestion', fields: ['supplier_name'] },
    { id: 'c', need: '在途', operation: REPLEN, entity: 'order_suggestion', fields: ['incoming_qty'] }
  ])
  assert.deepEqual(r.plan.reads, [REPLEN])
  assert.equal(r.plan.minimality.readCount, 1)
  assert.equal(r.plan.minimality.factCount, 3, 'facts and reads are different counts')
})

test('*** ⛔ an ENRICHING read is listed and not performed, and cannot sink the plan ***', () => {
  const facts = [
    { id: 'a', need: '缺口', operation: REPLEN, entity: 'order_suggestion', fields: ['live_qty', 'par_level'], necessity: 'required' },
    { id: 'c', need: '在途', operation: REPLEN, entity: 'order_suggestion', fields: ['incoming_qty'], necessity: 'required' },
    { id: 'd', need: '採購單細節', operation: 'aroma_system.purchasing', entity: 'purchase_order', fields: ['poNumber', 'status'], necessity: 'enriching' }
  ]
  const r = judgeGoalPlan({ question_restated: 'q', facts, joins: [] }).plan
  assert.deepEqual(r.reads, [REPLEN], 'only required facts become reads')
  assert.deepEqual(r.minimality.enrichingReads, ['aroma_system.purchasing'])

  // ⛔ AND THE HAZARD ON THE ENRICHING READ DOES NOT COUNT. Purchasing carries a 30-day
  // window; a limitation on a read nobody performs is not a limitation on the answer.
  assert.equal(r.sufficient, true, 'the Costco shape, answered from one endpoint')

  // Marked required instead, the same fact costs a read AND brings its window with it.
  const asRequired = judgeGoalPlan({
    question_restated: 'q', joins: [],
    facts: facts.map((f) => f.id === 'd' ? Object.assign({}, f, { necessity: 'required' }) : f)
  }).plan
  assert.equal(asRequired.reads.length, 2)
  assert.equal(asRequired.sufficient, false)
})

test('*** an absent necessity is REQUIRED — a plan that forgets to say must not shrink ***', () => {
  const r = judgeGoalPlan({
    question_restated: 'q', joins: [],
    facts: [{ id: 'a', need: '缺口', operation: REPLEN, entity: 'order_suggestion', fields: ['live_qty'] }]
  }).plan
  assert.equal(r.facts[0].necessity, 'required')
  assert.deepEqual(r.reads, [REPLEN])
})
