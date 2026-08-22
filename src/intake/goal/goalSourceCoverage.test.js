'use strict'

/**
 * goalSourceCoverage.test.js — C4.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE PRODUCTION TURN THIS FILE EXISTS FOR: 97425e9d-2d23-41fa-9afd-bddf98fa3955.
 *
 * The Owner asked for his Gmail to be prioritised. Gmail was enabled, authorised and
 * available_to_attempt — and was never read. The goal decomposer's operation enum held the six
 * aroma_system views and NOTHING else, so 「Gmail」 was not a thing the plan could name: the
 * required fact came back UNAVAILABLE for want of an operation, an aroma_system operation went
 * into the same plan, and the answer arrived as four inventory rows.
 *
 * The planning vocabulary and the execution vocabulary disagreed. `readOperations` has always
 * said a non-Aroma source IS its own operation; the planner could not see that rule because it
 * lived inside a function rather than in a table.
 *
 * ⛔ WHAT THESE TESTS DO NOT CLAIM. They prove the plan CAN now name Gmail, that naming it is
 * not permission, and that no Aroma rule was loosened to make room. They cannot prove a model
 * will choose well — the reasoning brain's own substitution on that turn is recorded separately
 * as OPUS_SUBSTITUTION_VIOLATION_PENDING_RETEST and is not addressed here.
 *
 * No network, no connector, no model call: `decomposeGoal` is driven through its injected
 * `callModel` seam.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/intake/goal/goalSourceCoverage.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const readOperations = require('../../context/readOperations')
const { operationsForSources, resolveReadOperation, isSourceLevelOperation, SOURCE_LEVEL_OPERATIONS } = readOperations
const catalogue = require('./operationCatalogue')
const { operationNames, entityTypes, catalogueForPrompt } = catalogue
const { judgeGoalPlan, goalPlanSchema, STATUS, REASON } = require('./goalPlanContract')
const { sourcesForPlan, requirementBlock } = require('./goalGate')
const { decomposeGoal } = require('./goalDecomposer')

/** The Owner's exact wording from the production defect, sanitised of nothing — it names no data. */
const OWNER_QUESTION = '幫我看看最近 Gmail，有哪些事情我需要優先處理？\n你直接幫我排優先次序和告訴我為什麼。'

const ENABLED_ALL = ['drive', 'gmail', 'calendar', 'github', 'aroma_system']
const AROMA_OPS = [
  'aroma_system.inventory', 'aroma_system.suppliers', 'aroma_system.daily_counts',
  'aroma_system.replenishment', 'aroma_system.purchasing', 'aroma_system.invoices'
]

const fact = (over) => Object.assign(
  { id: 'f1', need: '需要嘅嘢', operation: null, entity: null, fields: [], necessity: 'required' }, over)
const planOf = (facts) => {
  const j = judgeGoalPlan({ facts, joins: [] })
  assert.ok(j.ok, 'the plan must judge: ' + j.reason)
  return j.plan
}
const judge1 = (over) => planOf([fact(over)]).facts[0]

/** The enum the provider is actually handed. */
function schemaOperationEnum () {
  const s = goalPlanSchema()
  const f = s.properties.facts.items.properties.operation
  const branch = f.anyOf.find((b) => Array.isArray(b.enum))
  return branch.enum
}

/* ═══ 1–4. THE FOUR CONNECTED PRIVATE SOURCES ARE NAMEABLE ═══════════════════ */

describe('C4 (1-4) gmail / drive / calendar / github exist in the planning vocabulary', () => {
  for (const src of ['gmail', 'drive', 'calendar', 'github']) {
    test('*** ⛔ ' + src + ' is in the schema enum the decomposer is given ***', () => {
      assert.ok(schemaOperationEnum().includes(src),
        '⛔ ' + src + ' cannot be named by a plan — the ' + (src === 'gmail' ? 'exact production' : '') + ' defect')
      assert.ok(operationNames().includes(src))
      assert.ok(isSourceLevelOperation(src))
    })

    test('*** ⛔ a REQUIRED ' + src + ' fact is not refused for want of an operation ***', () => {
      const f = judge1({ operation: src })
      assert.notEqual(f.status, STATUS.UNAVAILABLE,
        '⛔ ' + src + ' was declared unavailable although the source is real')
      assert.equal(f.status, STATUS.PARTIAL)
      assert.equal(f.reason, REASON.SOURCE_LEVEL_NO_FIELD_PROOF)
    })

    test('*** ⛔ and it becomes the source the turn may read ***', () => {
      assert.deepEqual(sourcesForPlan(planOf([fact({ operation: src })]), ENABLED_ALL), [src])
    })
  }

  test('*** the source class promises NO fields and NO entity — it has not been measured ***', () => {
    const rendered = catalogueForPrompt().filter((e) => e.kind === 'source')
    assert.ok(rendered.length >= 4)
    for (const e of rendered) {
      assert.deepEqual(e.fields, [], e.operation + ' must not advertise fields')
      assert.equal(e.entity, null, e.operation + ' must not advertise an entity')
      assert.ok(typeof e.note === 'string' && e.note.length > 0, 'the absence is stated, not silent')
    }
    // ⛔ AND THE TYPED SIDE STILL CARRIES ITS CAPTURE. A shared renderer that flattened both
    // classes would have quietly deleted the measured field names the Aroma judge depends on.
    const inv = catalogueForPrompt().find((e) => e.operation === 'aroma_system.inventory')
    assert.ok(Array.isArray(inv.fields) && inv.fields.length > 0, 'the typed catalogue still carries fields')
    assert.equal(inv.entity, 'inventory_item')
  })
})

/* ═══ 5. THE CLOSED VOCABULARY SURVIVES ══════════════════════════════════════ */

describe('C4 (5) a bare string is not authority — membership is', () => {
  test('*** ⛔ invented sources are refused, in the schema AND in the judge AND in the gate ***', () => {
    for (const bogus of ['dropbox', 'random_source', 'gmail2', 'aroma_system.fake', 'GMAIL', 'Gmail', 'notion', 'g mail']) {
      assert.equal(schemaOperationEnum().includes(bogus), false, 'enum admits ' + bogus)
      assert.equal(isSourceLevelOperation(bogus), false, 'membership admits ' + bogus)
      assert.equal(judge1({ operation: bogus }).status, STATUS.UNAVAILABLE, 'judge admits ' + bogus)
      assert.deepEqual(sourcesForPlan(planOf([fact({ operation: bogus })]), ENABLED_ALL.concat([bogus])), [],
        '⛔ ' + bogus + ' reached the read set')
    }
  })

  test('*** ⛔ SEEN TO FAIL — the same call with a REAL member succeeds ***', () => {
    // Without this the test above would pass on a function that refused everything.
    assert.deepEqual(sourcesForPlan(planOf([fact({ operation: 'gmail' })]), ENABLED_ALL), ['gmail'])
  })

  test('*** surrounding whitespace is trimmed — the SAME rule the existing resolver uses ***', () => {
    // ⛔ STATED, NOT HIDDEN. `resolveReadOperation` has always trimmed, so
    // ' aroma_system.inventory ' resolves today and did before C4. Membership follows that
    // convention rather than inventing a stricter one for external sources only — a
    // divergence there would be a second rule nobody could remember. Padding is not an
    // invented name; case still is.
    assert.equal(isSourceLevelOperation(' gmail '), true)
    assert.equal(isSourceLevelOperation('Gmail'), false)
    assert.deepEqual(sourcesForPlan(planOf([fact({ operation: ' gmail ' })]), ENABLED_ALL), ['gmail'])
  })

  test('*** the source table is DERIVED from ALL_SOURCES, not retyped ***', () => {
    const { ALL_SOURCES } = require('../../context/liveClients')
    const expected = ALL_SOURCES.filter((s) => s !== 'aroma_system' && s !== 'public_knowledge')
    assert.deepEqual(SOURCE_LEVEL_OPERATIONS.map((o) => o.operation), expected,
      '⛔ a second hand-written vocabulary has appeared — that is the defect, again')
  })
})

/* ═══ 6. NAMING IS NOT PERMISSION ════════════════════════════════════════════ */

describe('C4 (6) a plan cannot authorise a source the turn does not have', () => {
  test('*** ⛔ gmail named, gmail not enabled -> nothing is read ***', () => {
    assert.deepEqual(sourcesForPlan(planOf([fact({ operation: 'gmail' })]), ['aroma_system']), [])
  })

  test('*** ⛔ nothing enabled -> nothing is read, whatever the plan says ***', () => {
    for (const src of ['gmail', 'drive', 'calendar', 'github']) {
      assert.deepEqual(sourcesForPlan(planOf([fact({ operation: src })]), []), [])
    }
  })

  test('*** an ENRICHING source fact never pulls a read either ***', () => {
    assert.deepEqual(
      sourcesForPlan(planOf([fact({ operation: 'gmail', necessity: 'enriching' })]), ENABLED_ALL), [])
  })
})

/* ═══ 7–10. NO AROMA SUBSTITUTION ════════════════════════════════════════════ */

describe('C4 (7-10) an external request does not become an Aroma operation', () => {
  for (const src of ['gmail', 'drive', 'calendar', 'github']) {
    test('*** ⛔ a ' + src + ' plan reads ' + src + ' and no Aroma view ***', () => {
      const got = sourcesForPlan(planOf([fact({ operation: src })]), ENABLED_ALL)
      assert.deepEqual(got, [src])
      assert.equal(got.includes('aroma_system'), false, '⛔ Aroma was substituted for ' + src)
    })
  }

  test('*** ⛔ the requirement block names the source truthfully, never as nonexistent ***', () => {
    const block = requirementBlock(planOf([fact({ need: '最近嘅郵件', operation: 'gmail' })]))
    assert.ok(block.includes('gmail'), 'the block must name gmail')
    assert.equal(/UNAVAILABLE/.test(block.split('\n')[1]), false,
      '⛔ the fact line still calls a live source unavailable')
    assert.ok(block.includes('唔好就近搵一個似樣嘅頂替'), 'the no-substitution rule still travels')
  })

  test('*** ⛔ a source that is genuinely off is reported off, and still not substituted ***', () => {
    // Gmail disabled for the turn: the plan may name it, the read set stays empty, and no
    // neighbouring source is offered in its place.
    const plan = planOf([fact({ operation: 'gmail' })])
    assert.deepEqual(sourcesForPlan(plan, ['aroma_system', 'drive', 'calendar', 'github']), [],
      '⛔ a disabled Gmail request borrowed another source')
  })
})

/* ═══ 11. THE EXACT PRODUCTION REGRESSION ════════════════════════════════════ */

describe('C4 (11) production request 97425e9d, re-run without a network', () => {
  /** The provider, faked: it returns the plan the real Owner question deserves. */
  function fakeModel (planBody) {
    const calls = []
    return {
      calls,
      fn: async ({ prompt, responseFormat }) => {
        calls.push({ prompt, schemaName: responseFormat && responseFormat.name })
        return { text: JSON.stringify(planBody), usage: { inputTokens: 1, outputTokens: 1 } }
      }
    }
  }

  test('*** ⛔ THE DEFECT: the decomposer is offered Gmail in its own prompt ***', async () => {
    const m = fakeModel({ facts: [], joins: [] })
    await decomposeGoal({ question: OWNER_QUESTION, callModel: m.fn })
    assert.equal(m.calls.length, 1)
    // ⛔ THE PROMPT, NOT A CONSTANT. The catalogue reaches the model as JSON inside the prompt;
    // asserting on operationNames() alone would pass even if the prompt renderer dropped it.
    assert.ok(m.calls[0].prompt.includes('"gmail"'),
      '⛔ Gmail is absent from the decomposer prompt — the production defect is unfixed')
    assert.equal(m.calls[0].schemaName, 'goal_plan')
  })

  test('*** ⛔ a Gmail-backed required fact survives the judge and reaches the read set ***', async () => {
    const m = fakeModel({
      facts: [{ id: 'f1', need: '最近收到嘅郵件同各自嘅緊急程度', operation: 'gmail', entity: null, fields: [], necessity: 'required' }],
      joins: []
    })
    const out = await decomposeGoal({ question: OWNER_QUESTION, callModel: m.fn })
    assert.ok(out.ok, 'the plan must be usable: ' + out.reason)
    const f = out.plan.facts[0]
    assert.equal(f.operation, 'gmail')
    assert.notEqual(f.status, STATUS.UNAVAILABLE, '⛔ Gmail declared unavailable — the production defect')
    assert.notEqual(f.reason, REASON.NO_OPERATION, '⛔ still structurally unnameable')
    assert.deepEqual(sourcesForPlan(out.plan, ENABLED_ALL), ['gmail'])
    const block = requirementBlock(out.plan)
    assert.ok(block.includes('gmail'))
    assert.equal(block.includes('aroma_system'), false, '⛔ an Aroma operation entered a Gmail-only plan')
  })

  test('*** ⛔ and inventory is NOT pulled in, because this question does not ask for it ***', async () => {
    const m = fakeModel({
      facts: [{ id: 'f1', need: '最近收到嘅郵件', operation: 'gmail', entity: null, fields: [], necessity: 'required' }],
      joins: []
    })
    const out = await decomposeGoal({ question: OWNER_QUESTION, callModel: m.fn })
    const sources = sourcesForPlan(out.plan, ENABLED_ALL)
    assert.equal(sources.includes('aroma_system'), false,
      '⛔ aroma_system.inventory reappeared as a substitute — the exact production failure')
  })
})

/* ═══ 12. THE AROMA CONTRACT IS UNTOUCHED ════════════════════════════════════ */

describe('C4 (12) the six typed operations keep their strict field judging', () => {
  test('*** all six remain in the enum, in their original order and position ***', () => {
    assert.deepEqual(operationNames().slice(0, 6), AROMA_OPS,
      '⛔ the typed operations moved — an Aroma plan is no longer offered what it was')
  })

  test('*** entityTypes() gained nothing — an unmeasured source has no entity to offer ***', () => {
    assert.deepEqual(entityTypes(),
      ['inventory_item', 'supplier', 'daily_count', 'order_suggestion', 'purchase_order', 'invoice'])
  })

  test('*** ⛔ entity mismatch still refuses ***', () => {
    const f = judge1({ operation: 'aroma_system.invoices', entity: 'inventory_item', fields: ['currentStock'] })
    assert.equal(f.status, STATUS.UNAVAILABLE)
    assert.equal(f.reason, REASON.ENTITY_MISMATCH)
  })

  test('*** ⛔ unknown field still refuses ***', () => {
    const f = judge1({ operation: 'aroma_system.inventory', entity: 'inventory_item', fields: ['not_a_real_field'] })
    assert.equal(f.status, STATUS.UNAVAILABLE)
    assert.equal(f.reason, REASON.UNKNOWN_FIELD)
  })

  test('*** ⛔ no named field still refuses — the source class must not have relaxed this ***', () => {
    const f = judge1({ operation: 'aroma_system.inventory', entity: 'inventory_item', fields: [] })
    assert.equal(f.status, STATUS.UNAVAILABLE)
    assert.equal(f.reason, REASON.NO_FIELDS)
  })

  test('*** a good Aroma fact is still AVAILABLE, with its measured fields ***', () => {
    const f = judge1({ operation: 'aroma_system.inventory', entity: 'inventory_item', fields: ['currentStock'] })
    assert.equal(f.status, STATUS.AVAILABLE)
    assert.deepEqual(sourcesForPlan(planOf([fact({ operation: 'aroma_system.inventory', entity: 'inventory_item', fields: ['currentStock'] })]), ENABLED_ALL), ['aroma_system'])
  })
})

/* ═══ 13. THE PUBLIC FENCE ═══════════════════════════════════════════════════ */

describe('C4 (13) public_knowledge is not widened, reachable or renamed', () => {
  test('*** ⛔ public_knowledge is absent from the planning vocabulary entirely ***', () => {
    for (const n of operationNames()) assert.equal(/public_knowledge/.test(n), false, 'enum leaked ' + n)
    for (const n of schemaOperationEnum()) assert.equal(/public_knowledge/.test(n), false, 'schema leaked ' + n)
    for (const e of catalogueForPrompt()) assert.equal(/public_knowledge/.test(e.operation), false, 'prompt leaked ' + e.operation)
    assert.equal(isSourceLevelOperation('public_knowledge'), false)
    assert.equal(isSourceLevelOperation('public_knowledge.search'), false)
  })

  test('*** ⛔ a bare public_knowledge name reaches no read set ***', () => {
    assert.deepEqual(sourcesForPlan(planOf([fact({ operation: 'public_knowledge' })]), ENABLED_ALL.concat(['public_knowledge'])), [],
      '⛔ C4 made the bare public source nameable')
  })

  test('*** the dotted public operation behaves EXACTLY as it did before C4 ***', () => {
    /**
     * ⛔ THIS IS A CHARACTERISATION, AND THE HONEST WORDING MATTERS.
     *
     * `sourcesForPlan` has never checked STATUS — it checks necessity, an operation that
     * resolves, and membership of the turn's enabled set. So a plan naming
     * `public_knowledge.search` while public_knowledge is ENABLED has always yielded that
     * source, at base d4708ff and before. C4 neither opened nor closed it, and claiming
     * either would be a false guarantee in a test that looks like a fence.
     *
     * What C4 DOES guarantee is above: the name is not in B's enum, schema or prompt, so a
     * conforming plan cannot produce it — and the source is off in production regardless.
     */
    assert.deepEqual(
      sourcesForPlan(planOf([fact({ operation: 'public_knowledge.search' })]), ['aroma_system', 'public_knowledge']),
      ['public_knowledge'],
      'base behaviour changed — that is a C4 side effect and must be explained, not absorbed')
    // And with the source NOT enabled — production's actual state — it reaches nothing.
    assert.deepEqual(sourcesForPlan(planOf([fact({ operation: 'public_knowledge.search' })]), ENABLED_ALL), [])
  })

  test('*** its own execution vocabulary is byte-unchanged ***', () => {
    assert.deepEqual(operationsForSources(['public_knowledge']), ['public_knowledge.search'])
    const hit = resolveReadOperation('public_knowledge.search')
    assert.equal(hit.source, 'public_knowledge')
    assert.equal(hit.method, 'search')
  })
})

/* ═══ 14. PLANNING AND EXECUTION NOW AGREE ═══════════════════════════════════ */

describe('C4 (14) the two vocabularies agree for every supported private source', () => {
  test('*** ⛔ every source-level planning name is an executable operation ***', () => {
    const executable = operationsForSources(SOURCE_LEVEL_OPERATIONS.map((o) => o.source))
    for (const o of SOURCE_LEVEL_OPERATIONS) {
      assert.ok(executable.includes(o.operation),
        '⛔ ' + o.operation + ' can be planned but not executed — the C4 defect, mirrored')
    }
  })

  test('*** ⛔ and every planning name resolves to itself as a source ***', () => {
    for (const o of SOURCE_LEVEL_OPERATIONS) {
      assert.deepEqual(sourcesForPlan(planOf([fact({ operation: o.operation })]), [o.source]), [o.source])
    }
  })

  test('*** the reasoning loop\'s own vocabulary is unchanged for Aroma ***', () => {
    assert.deepEqual(operationsForSources(['aroma_system']), AROMA_OPS)
    assert.deepEqual(operationsForSources(['gmail', 'drive']), ['gmail', 'drive'])
  })
})

/* ═══ 15. NOTHING HERE TOUCHES THE WORLD ═════════════════════════════════════ */

describe('C4 (15) no connector, no model, no network', () => {
  test('*** the decomposer is driven entirely through its injected seam ***', async () => {
    let called = 0
    const out = await decomposeGoal({
      question: OWNER_QUESTION,
      callModel: async () => { called++; return { text: JSON.stringify({ facts: [], joins: [] }) } }
    })
    assert.equal(called, 1)
    assert.equal(typeof out.ok, 'boolean')
  })

  test('*** and it refuses outright with no model supplied — no fallback call exists ***', async () => {
    const out = await decomposeGoal({ question: OWNER_QUESTION })
    assert.equal(out.ok, false)
    assert.equal(out.reason, 'no_model_call_supplied')
  })
})

/* ═══ ADJACENT, RECORDED NOT FIXED ═══════════════════════════════════════════ */

describe('C4 adjacent — the turn router misses an explicitly named Gmail', () => {
  /**
   * ⛔ CHARACTERISATION, NOT A REPAIR. Production 97425e9d routed CONVERSATION with
   * routerSources [] although the Owner wrote 「Gmail」 in the first clause. The router is a
   * separate authority and its repair is a separate tranche; this pins TODAY'S behaviour so the
   * next tranche can see it change. It is expected to FAIL once that tranche lands, and that
   * failure is the signal, not a regression.
   */
  test('*** C4_ADJACENT_ROUTER_GMAIL_MISS — recorded as today\'s behaviour ***', () => {
    const { routeTurn } = require('../turnRouter')
    const decision = routeTurn(OWNER_QUESTION, { env: { TURN_ROUTER: 'on' } })
    assert.ok(decision && typeof decision.route === 'string')
    assert.equal((decision.sources || []).includes('gmail'), false,
      'if this now passes gmail through, the router tranche has landed — update this test')
    assert.equal(decision.route, 'CONVERSATION')
    // ⛔ AND THE ROUTER IS NOT SIMPLY MUTE. Without this the assertion above would hold on a
    // router that named nothing for anything, and the characterisation would be worthless.
    const control = routeTurn('而家倉存仲有幾多貨？', { env: { TURN_ROUTER: 'on' } })
    assert.equal(control.route, 'BUSINESS_QUERY')
    assert.deepEqual(control.sources, ['aroma_system'],
      'the router does name sources — it just does not name gmail for a question that says Gmail')
  })
})
