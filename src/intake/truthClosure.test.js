'use strict'

/**
 * truthClosure.test.js — evidence the MODEL fetched must be proven like any other.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE PRODUCTION TURN THIS FILE EXISTS FOR.
 *
 * Request dbda7d7f-0899-4f65-87ff-97e9914af640, gpt-5.6-terra, 2026-08-08 16:41 Winnipeg.
 * Router: CONVERSATION/default. Automatic reads: ZERO.
 *   STEP 1 → READ aroma_system.replenishment  trust live
 *   STEP 2 → READ aroma_system.purchasing     trust live
 *   STEP 3 → FINAL
 * Genuine autonomous multi-step reasoning — and then:
 *   ANSWER_PLAN outcome=fallback reason=no_plan_returned
 *
 * No claim binding. No evidence validation. Business prose about stockout risk and expired
 * purchase orders reached the Owner having been proven against nothing at all.
 *
 * ── THE CAUSE, AND WHY THE ROUTER IS NOT THE PLACE TO FIX IT ─────────────────
 * The plan gate asked `route === 'BUSINESS_QUERY'`. The router answers 「what should be read
 * automatically from the ORIGINAL message」 and it was RIGHT: the message named no entity, so
 * nothing was read automatically. It cannot answer 「did the model later obtain real evidence」,
 * because at the moment it runs, that has not happened. Two different facts, one gate.
 *
 * The fix records provenance where it actually occurs — inside the reasoning loop's own
 * executeRead — and ORs it with the untouched automatic rule.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')

const NOW = '2026-08-08T21:41:45.000Z'

/* ═══ FIXTURES ═════════════════════════════════════════════════════════════ */

const ROW = (id, title, fields, content) => ({
  source: 'aroma_system',
  sourceId: String(id),
  title,
  originalDate: null,
  entityType: 'order_suggestion',
  content,
  fields,
  link: null,
  trust: 'live',
  error: null,
  retrievedAt: NOW
})

const REPLENISHMENT_ROW = ROW('7', 'Napa Cabbage',
  { id: 7, name: 'Napa Cabbage', live_qty: '0.000', par_level: '75.000', suggested_order_qty: '75.000' },
  'id=7 · name=Napa Cabbage · live_qty=0.000 · par_level=75.000 · suggested_order_qty=75.000')

/**
 * A connector whose behaviour is scripted PER CALL, so a turn can mix live, zero-row and
 * unavailable reads. Every call is recorded, so 「the connector was never touched」 is provable.
 */
function scriptedConnector (script) {
  const reads = []
  return {
    reads,
    connector: {
      async read (source, method) {
        reads.push({ source, method })
        const step = script[reads.length - 1] || script[script.length - 1]
        if (step === 'throw') throw new Error('upstream unavailable')
        // The row echoes the source actually requested, so this connector can stand in for a
        // non-Aroma source too (test B needs one: only aroma_system's plan is intent-derived,
        // so only it can return `notAsked` and produce no rows at all).
        const rows = step === 'empty' ? [] : [Object.assign({}, REPLENISHMENT_ROW, { source })]
        return {
          asOf: NOW,
          source,
          count: rows.length,
          results: rows,
          evidence: {
            source,
            entityType: 'order_suggestion',
            endpoint: 'orderPlanning',
            rowShape: { hasLocation: false, hasAsOf: false, note: null },
            metrics: {},
            matchingTotal: rows.length,
            shownCount: rows.length,
            completeness: 'complete',
            usedFallback: false,
            retrievedAt: NOW,
            trust: 'live',
            provenance: 'Aroma System'
          }
        }
      }
    }
  }
}

/** Records the SCHEMA NAME each model call was shown — the observable this turns on. */
function scriptedAdapter (label, envelopes) {
  const calls = []
  return {
    label,
    calls,
    async complete (prompt, opts = {}) {
      calls.push({
        schemaName: opts.responseFormat ? opts.responseFormat.name : null,
        schema: opts.responseFormat ? opts.responseFormat.schema : null,
        hasAnswerPlan: !!(opts.responseFormat && opts.responseFormat.schema &&
          opts.responseFormat.schema.properties && opts.responseFormat.schema.properties.answerPlan)
      })
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error(label + ' called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: label, latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ = (capability) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: { capability }, answerPlan: null })

/**
 * ⛔ AN ADAPTER THAT HONOURS THE SCHEMA IT WAS HANDED — required for H and I to mean anything.
 *
 * The scripted adapter above returns whatever it was told to, schema or no schema. That is fine
 * for asserting WHICH schema was sent, but it makes 「the validator ran」 vacuous: it would return
 * an Answer Plan even on the pre-fix build that never asked for one, so the test would pass
 * against the very defect it exists to catch. (Measured: H and I passed against the pre-fix
 * source. That is exactly the 「a stub proved the stages that worked」 failure this repo has hit
 * before.)
 *
 * A real strict provider cannot return a property the schema does not define. This one behaves
 * the same way: it emits `answerPlan` ONLY when the schema demands it.
 */
function schemaHonouringAdapter (label, steps) {
  const calls = []
  return {
    label,
    calls,
    async complete (prompt, opts = {}) {
      const schema = opts.responseFormat ? opts.responseFormat.schema : null
      const demandsPlan = !!(schema && schema.properties && schema.properties.answerPlan)
      calls.push({ schemaName: opts.responseFormat ? opts.responseFormat.name : null, schema, hasAnswerPlan: demandsPlan })
      const step = steps[calls.length - 1]
      if (!step) throw new Error(label + ' called more times than scripted: ' + calls.length)
      const body = step.read
        ? READ(step.read)
        : { intent: 'question', mode: 'chat', reply: '睇咗。', nextRead: null, ...(demandsPlan ? { answerPlan: step.final } : {}) }
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: label, latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

/** A plan whose every fact IS in the evidence above — the grounded case. */
const GOOD_PLAN = {
  directAnswer: '有 1 項需要補貨。',
  answerClaims: null,
  unanswerable: false,
  citesEvidence: true,
  sections: [{ heading: '訂貨建議', items: [{ sourceId: 'aroma_system#7', title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }, { field: '安全存量', value: '75.000' }] }] }],
  limitations: [],
  followUp: null
}
/** The zero-row honest answer: nothing cited, because nothing matched. */
const EMPTY_PLAN = {
  directAnswer: '讀到咗，但冇相符嘅記錄。',
  answerClaims: null,
  unanswerable: false,
  citesEvidence: false,
  sections: [],
  limitations: [],
  followUp: null
}
const FINAL_WITH_PLAN = (plan) => ({ intent: 'question', mode: 'chat', reply: '睇咗。', nextRead: null, answerPlan: plan })
const FINAL_NO_PLAN = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })

// ⛔ A4_KNOWLEDGE_ROUTING:'off' ADDED — these tests assert the AUTOMATIC-READ contract.
// A4-1 deliberately takes read initiation away from the keyword route: with A4 on, the turn
// reaches the model with zero rows and the model must ASK for the read. These suites script
// adapters that answer directly, so under A4 on they correctly read nothing — the contract
// they pin is the A4-off one, which remains a supported rollback and must stay provable.
// Same reasoning, and same recorded cost, as the TURN_ROUTER:'off' pins already here.
const FLAGS = { A4_KNOWLEDGE_ROUTING: 'off', READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off' }
async function withEnv (over, fn) {
  const all = Object.assign({}, FLAGS, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

/** Capture the real [AROMA-ANSWER-PLAN] sink — the only proof the validator ran. */
async function withPlanLog (fn) {
  const captured = []
  const original = console.log
  console.log = (...args) => {
    if (args[0] === '[AROMA-ANSWER-PLAN]') { try { captured.push(JSON.parse(args[1])) } catch (_) {} }
  }
  try { return { result: await fn(), captured } } finally { console.log = original }
}

/** The production shape: a broad operational question the router calls CONVERSATION. */
const BROAD = '根據而家嘅資料，幫我判斷今日有咩需要我優先處理。'

const run = (msg, adapter, deps, extra) => processIntake(msg, adapter, [], Object.assign({
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
}, extra || {}))

/* ═══ A. ZERO-READ CONVERSATION — UNCHANGED ════════════════════════════════ */

test('*** A — 你好: no read, no Answer Plan forced, one call ***', async () => {
  await withEnv({}, async () => {
    const sc = scriptedConnector(['live'])
    const a = scriptedAdapter('claude', [FINAL_NO_PLAN('你好！')])
    await run('你好', a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls.length, 1, 'one model call')
    assert.deepEqual(sc.reads, [], 'nothing read')
    assert.equal(a.calls[0].schemaName, 'distill_with_read_decision', 'the decision surface only')
    assert.equal(a.calls[0].hasAnswerPlan, false, '⛔ no evidence exists, so nothing evidence-shaped is demanded')
  })
})

/* ═══ B. THE LEGACY ROUTER FENCE STILL HOLDS ═══════════════════════════════ */

test('*** B — rows on a NON-business route STILL cannot force a plan ***', async () => {
  await withEnv({ CONTEXT_GMAIL: 'on' }, async () => {
    const sc = scriptedConnector(['live'])
    const a = scriptedAdapter('claude', [FINAL_NO_PLAN('你好！')])
    // forceSources bypasses the route's own list, putting rows on a CONVERSATION turn — the
    // only way to create the situation the original gate was built for. It must be unchanged:
    // rows alone, with NO model-directed read, still may not demand a plan.
    //
    // GMAIL, not aroma_system: only the Aroma plan is intent-derived, so 「你好」 would return
    // `notAsked` there and produce no rows at all — the fixture would prove nothing.
    await run('你好', a, { connector: sc.connector, sources: ['gmail'], forceSources: true })
    assert.ok(sc.reads.length > 0, 'rows really were retrieved automatically')
    assert.equal(a.calls[0].hasAnswerPlan, false,
      '⛔ THE INVARIANT THAT JUSTIFIED THE ROUTE GATE. Truth Closure keys on MODEL-DIRECTED ' +
      'provenance, never on the mere existence of rows — otherwise it would silently delete this rule.')
    // Which NON-plan outcome occurs is existing behaviour and not what this fence is about:
    // gmail was the only authorised source and it has now been read, so no choice remains and
    // answerPlanFormat returns no schema at all. The assertion is only that a plan was not demanded.
    assert.notEqual(a.calls[0].schemaName, 'distill_with_answer_plan')
  })
})

/* ═══ C. THE PRODUCTION DEFECT, FIXED ══════════════════════════════════════ */

test('*** C — CONVERSATION + model-directed LIVE read → next call gets the Answer Plan ***', async () => {
  await withEnv({}, async () => {
    const sc = scriptedConnector(['live'])
    const a = scriptedAdapter('claude', [READ('aroma_system.replenishment'), FINAL_WITH_PLAN(GOOD_PLAN)])
    await run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'] })

    assert.equal(a.calls[0].schemaName, 'distill_with_read_decision', 'call 1: no evidence yet')
    assert.equal(a.calls[0].hasAnswerPlan, false)
    assert.deepEqual(sc.reads, [{ source: 'aroma_system', method: 'listOrderPlanning' }], 'the model fetched it')
    assert.equal(a.calls[1].schemaName, 'distill_with_answer_plan',
      '⛔ THE FIX: evidence the MODEL fetched demands a plan, even though the ROUTER said CONVERSATION')
    assert.equal(a.calls[1].hasAnswerPlan, true)
  })
})

/* ═══ D. A LIVE ZERO-ROW READ IS STILL EVIDENCE ════════════════════════════ */

test('*** D — model-directed LIVE read matching ZERO rows still demands a plan ***', async () => {
  await withEnv({}, async () => {
    const sc = scriptedConnector(['empty'])
    const a = scriptedAdapter('claude', [READ('aroma_system.invoices'), FINAL_WITH_PLAN(EMPTY_PLAN)])
    await run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'] })

    assert.equal(sc.reads.length, 1, 'the read really ran')
    assert.equal(a.calls[1].schemaName, 'distill_with_answer_plan',
      '⛔ 「我睇過，冇嘢」 is cheap to say and expensive to be wrong about — it gets grounded too')
    assert.equal(a.calls[1].hasAnswerPlan, true)
    // No rows exist, so nothing may pin a row reference — and nothing invents one.
    const sourceId = a.calls[1].schema.properties.answerPlan.properties.sections
      .items.properties.items.items.properties.sourceId
    assert.equal(sourceId.enum, undefined, 'no row refs are fabricated for an empty read')
  })
})

/* ═══ E. A FAILED READ IS NOT EVIDENCE ═════════════════════════════════════ */

test('*** E — model-directed UNAVAILABLE read does NOT activate truth closure ***', async () => {
  await withEnv({}, async () => {
    const sc = scriptedConnector(['throw'])
    const a = scriptedAdapter('claude', [READ('aroma_system.replenishment'), FINAL_NO_PLAN('今次讀唔到。')])
    await run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'] })

    assert.equal(sc.reads.length, 1, 'it was attempted')
    assert.equal(a.calls[1].hasAnswerPlan, false,
      '⛔ a read that did not happen is not evidence, and may not open the grounding path')
    assert.equal(a.calls[1].schemaName, 'distill_with_read_decision')
    // And the three-state semantics are untouched: not retried, not called retrieved.
    assert.equal(sc.reads.length, 1, 'no automatic retry')
  })
})

test('*** E2 — a LIVE read is not cancelled by a later UNAVAILABLE one ***', async () => {
  await withEnv({}, async () => {
    const sc = scriptedConnector(['live', 'throw'])
    const a = scriptedAdapter('claude', [
      READ('aroma_system.replenishment'), READ('aroma_system.purchasing'), FINAL_WITH_PLAN(GOOD_PLAN)
    ])
    await run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls[2].hasAnswerPlan, true,
      'the first read really happened; a later failure does not un-retrieve its rows')
  })
})

/* ═══ F. TWO MODEL-DIRECTED READS — THE PRODUCTION SHAPE ═══════════════════ */

test('*** F — READ → READ → FINAL: the loop is not cut short by grounding ***', async () => {
  await withEnv({}, async () => {
    const sc = scriptedConnector(['live', 'live'])
    const a = scriptedAdapter('claude', [
      READ('aroma_system.replenishment'),
      READ('aroma_system.purchasing'),
      FINAL_WITH_PLAN(GOOD_PLAN)
    ])
    await run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'] })

    assert.equal(a.calls.length, 3, 'three decisions, exactly the production shape')
    assert.deepEqual(sc.reads, [
      { source: 'aroma_system', method: 'listOrderPlanning' },
      { source: 'aroma_system', method: 'listPurchaseOrders' }
    ], 'both model-directed reads ran, and no automatic read was invented')

    assert.equal(a.calls[1].hasAnswerPlan, true, 'step 2 already carries the plan schema')
    // ⛔ AND IT MAY STILL ASK FOR MORE. The plan schema also carries nextRead, so grounding
    // becoming active must not force the model to stop reading.
    assert.ok(a.calls[1].schema.properties.nextRead, 'step 2 may still request another read')
    assert.equal(a.calls[2].hasAnswerPlan, true, 'step 3 carries it too')
  })
})

/* ═══ G. THE AUTOMATIC BUSINESS PATH IS UNCHANGED ══════════════════════════ */

test('*** G — an automatic BUSINESS_QUERY read behaves exactly as before ***', async () => {
  await withEnv({}, async () => {
    const sc = scriptedConnector(['live'])
    const a = scriptedAdapter('claude', [FINAL_WITH_PLAN(GOOD_PLAN)])
    await run('今日要訂咩貨？', a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls.length, 1, 'one call — the automatic read needs no reasoning step')
    assert.equal(a.calls[0].schemaName, 'distill_with_answer_plan', 'and it demanded a plan, as always')
  })
})

/* ═══ H. THE VALIDATOR ACTUALLY RUNS ═══════════════════════════════════════ */

test('*** H — ⛔ no_plan_returned is GONE from the model-directed path ***', async () => {
  await withEnv({}, async () => {
    const sc = scriptedConnector(['live'])
    // ⛔ SCHEMA-HONOURING, deliberately: a real provider cannot emit a field the schema does not
    // define, so this fails on the pre-fix build exactly as production did.
    const a = schemaHonouringAdapter('claude', [{ read: 'aroma_system.replenishment' }, { final: GOOD_PLAN }])
    const { captured } = await withPlanLog(() => run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'] }))

    assert.equal(a.calls[1].hasAnswerPlan, true, 'the final call was actually ASKED for a plan')
    assert.equal(captured.length, 1, 'exactly one [AROMA-ANSWER-PLAN] line — the layer RAN')
    assert.notEqual(captured[0].reason, 'no_plan_returned',
      '⛔ THIS EXACT STRING IS THE PRODUCTION DEFECT (request dbda7d7f…). It must not come back.')
    assert.equal(captured[0].outcome, 'validated', 'the existing validator accepted a grounded plan')
    assert.equal(captured[0].keptItemCount, 1, 'and it kept the item that was real')
  })
})

/* ═══ I. AND IT STILL REFUSES WHAT IT ALWAYS REFUSED ═══════════════════════ */

test('*** I — an UNSUPPORTED model claim is filtered by the EXISTING validator ***', async () => {
  await withEnv({}, async () => {
    const sc = scriptedConnector(['live'])
    // The evidence holds ONE row: Napa Cabbage, live_qty 0.000, par_level 75.000.
    // This plan invents a second item and a quantity that was never retrieved.
    const LYING_PLAN = {
      directAnswer: '有 42 項需要補貨。',
      answerClaims: null,
      unanswerable: false,
      citesEvidence: true,
      sections: [{
        heading: '訂貨建議',
        items: [
          { sourceId: 'aroma_system#7', title: 'Napa Cabbage', facts: [{ field: '現有', value: '999.000' }] },
          { sourceId: 'aroma_system#999', title: 'Phantom Item', facts: [{ field: '現有', value: '5.000' }] }
        ]
      }],
      limitations: [],
      followUp: null
    }
    const a = schemaHonouringAdapter('claude', [{ read: 'aroma_system.replenishment' }, { final: LYING_PLAN }])
    const { result, captured } = await withPlanLog(() => run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'] }))

    assert.equal(a.calls[1].hasAnswerPlan, true, 'the final call was actually ASKED for a plan')
    assert.equal(captured.length, 1, 'the layer ran')
    assert.notEqual(captured[0].reason, 'no_plan_returned')
    // ⛔ NO NEW VALIDATOR WAS WRITTEN FOR THIS. These are the existing counters, doing what
    // they already do on the ordinary grounded path — which is the whole point of the change.
    assert.ok(captured[0].droppedItems + captured[0].droppedFacts + captured[0].droppedSentences > 0,
      'the invented row and/or the invented quantity were removed by the existing rules')
    assert.equal(String(result.reply).includes('Phantom Item'), false, 'the invented item never reaches the Owner')
    assert.equal(String(result.reply).includes('42'), false, 'nor the unmeasured count')
  })
})

/* ═══ J. THE SHAPED SCHEMA THIS PATH REACHES IS STRICT-COMPATIBLE ══════════ */

test('*** J — the schema reached by the model-directed path passes strict-mode rules ***', async () => {
  await withEnv({}, async () => {
    const sc = scriptedConnector(['live'])
    const a = scriptedAdapter('claude', [READ('aroma_system.replenishment'), FINAL_WITH_PLAN(GOOD_PLAN)])
    await run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'] })

    // The SAME walker strictSchemaCompat.test.js uses, applied to the ACTUAL shaped object
    // this path produced — not to the static schema, which cannot see withRowRefs/withReadChoices.
    const objectNodes = (node, path, out) => {
      if (!node || typeof node !== 'object') return out
      if (node.properties && typeof node.properties === 'object') out.push({ path, node })
      for (const k of Object.keys(node)) objectNodes(node[k], path + '.' + k, out)
      return out
    }
    const violations = objectNodes(a.calls[1].schema, 'root', []).flatMap(({ path, node }) => {
      const req = Array.isArray(node.required) ? node.required : []
      return Object.keys(node.properties).filter((k) => !req.includes(k)).map((k) => path + '.' + k)
    })
    assert.deepEqual(violations, [],
      'a property missing from required is a live 400 from OpenAI, not a style issue')
  })
})
