'use strict'

/**
 * evidenceIdentity.test.js — one row, one identity, across two reads of the same source.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE MEASURED DEFECT.
 *
 * `aroma_system.replenishment` and `aroma_system.purchasing` can each return a row whose raw
 * id is 7. Ids are per-table sequences, so this is ordinary, not exotic — and the production
 * turn dbda7d7f read exactly those two operations.
 *
 * The row reference was `source#sourceId`, so both were `aroma_system#7`. evidenceIndex did
 * `byId.set(ref, row)` (last write wins) and validatePlan resolved an item with `byId.get()`
 * and rendered `row.title`. The measured result was MIS-ATTRIBUTION, not a safe drop:
 *
 *     **PO-7 Gordon**
 *     現有 0.000      ← an ORDER-PLANNING fact, under the PURCHASE ORDER's title
 *
 * ── THE CONTRACT ─────────────────────────────────────────────────────────────
 *   source  — unchanged. The connector: aroma_system / gmail / drive / calendar / github.
 *   readKey — the grain the read happened at. The OPERATION for a model-directed Aroma read;
 *             the SOURCE everywhere else, so every existing path is byte-identical.
 *   canonical row ref — `<readKey>#<sourceId>`.
 *   legacy alias — bare `7` and `aroma_system#7` resolve ONLY when exactly one canonical row
 *             owns them. Two owners is AMBIGUOUS and fails closed. Never last-write-wins,
 *             never first row, never title or entity-type matching.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { evidenceIndex, validatePlan, withRowRefs, DISTILL_WITH_PLAN_SCHEMA } = require('./answerPlan')
const { verifyClaimBindings, BINDING } = require('./claimBinding')

const NOW = '2026-08-08T21:41:45.000Z'

/* ═══ FIXTURES: TWO OPERATIONS, ONE RAW ID ════════════════════════════════ */

const PLAN_ROW = {
  sourceId: '7', title: 'Napa Cabbage', entityType: 'order_suggestion',
  content: 'id=7 · name=Napa Cabbage · live_qty=0.000 · par_level=75.000',
  fields: { id: '7', name: 'Napa Cabbage', live_qty: '0.000', par_level: '75.000' }
}
const PO_ROW = {
  sourceId: '7', title: 'PO-7 Gordon', entityType: 'purchase_order',
  content: 'id=7 · supplier=Gordon · status=sent · itemCount=9',
  fields: { id: '7', supplier: 'Gordon', status: 'sent', itemCount: '9' }
}

const SPEC = {
  listOrderPlanning: { rows: [PLAN_ROW], matchingTotal: 47, endpoint: 'orderPlanning', scope: { field: null, window: null, declaredBy: 'reader' } },
  listPurchaseOrders: { rows: [PO_ROW], matchingTotal: 13, endpoint: 'purchaseOrders', scope: { field: 'createdAt', window: 'last_30_days', declaredBy: 'reader' } }
}

function twoOpConnector (over = {}) {
  const reads = []
  const spec = Object.assign({}, SPEC, over)
  return {
    reads,
    connector: {
      async read (source, method) {
        reads.push({ source, method })
        const s = spec[method] || { rows: [], matchingTotal: 0, endpoint: method, scope: { field: null, window: null, declaredBy: 'reader' } }
        const rows = s.rows.map((r) => Object.assign({ source, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }, r))
        return {
          asOf: NOW, source, count: rows.length, results: rows,
          evidence: {
            source, endpoint: s.endpoint, entityType: rows.length ? rows[0].entityType : 'unknown',
            rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {},
            matchingTotal: s.matchingTotal, shownCount: rows.length, sourceTotal: null,
            queryScope: s.scope, completeWithinScope: s.completeWithinScope === true,
            completeness: 'sample', usedFallback: false, retrievedAt: NOW, trust: 'live',
            provenance: 'Aroma System ' + s.endpoint
          }
        }
      }
    }
  }
}

/** Captures BOTH the rendered prompt and the shaped schema — TEST 2 needs both. */
function scriptedAdapter (label, envelopes) {
  const calls = []
  return {
    label,
    calls,
    async complete (prompt, opts = {}) {
      calls.push({
        prompt: String(prompt),
        schemaName: opts.responseFormat ? opts.responseFormat.name : null,
        schema: opts.responseFormat ? opts.responseFormat.schema : null
      })
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error(label + ' called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: label, latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ = (capability) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: { capability }, answerPlan: null })
const FINAL = (plan) => ({ intent: 'question', mode: 'chat', reply: '睇咗。', nextRead: null, answerPlan: plan })

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

async function withPlanLog (fn) {
  const captured = []
  const original = console.log
  console.log = (...args) => {
    if (args[0] === '[AROMA-ANSWER-PLAN]') { try { captured.push(JSON.parse(args[1])) } catch (_) {} }
  }
  try { return { result: await fn(), captured } } finally { console.log = original }
}

const BROAD = '根據而家嘅資料，幫我判斷今日有咩需要我優先處理。'
const run = (msg, adapter, deps) => processIntake(msg, adapter, [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
})

const REPL = 'aroma_system.replenishment'
const PURC = 'aroma_system.purchasing'
const twoReads = (plan) => [READ(REPL), READ(PURC), FINAL(plan)]

/* ═══ TEST 1 — SAME RAW ID, TWO OPERATIONS, NO CROSS-ATTRIBUTION ══════════ */

test('*** 1 — two operations, same raw id: both render, neither borrows the other ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOpConnector()
    const PLAN = {
      directAnswer: '兩樣都要跟。',
      answerClaims: null,
      unanswerable: false,
      citesEvidence: true,
      sections: [{
        heading: '要跟進',
        items: [
          { sourceId: `${REPL}#7`, title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }] },
          { sourceId: `${PURC}#7`, title: 'PO-7 Gordon', facts: [{ field: '項目數', value: '9' }] }
        ]
      }],
      limitations: [],
      followUp: null
    }
    const a = scriptedAdapter('claude', twoReads(PLAN))
    const { result, captured } = await withPlanLog(() => run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] }))

    assert.equal(captured[0].droppedItems, 0, 'both canonical rows resolve')
    assert.equal(captured[0].keptItemCount, 2, 'two entities, two items')
    const reply = String(result.reply)
    assert.ok(reply.includes('Napa Cabbage'), 'the order-planning entity keeps its own title')
    assert.ok(reply.includes('PO-7 Gordon'), 'the purchase order keeps its own title')

    // ⛔ THE MIS-ATTRIBUTION ASSERTION. Each fact must sit under ITS OWN row.
    const napaBlock = reply.slice(reply.indexOf('Napa Cabbage'), reply.indexOf('PO-7 Gordon') > reply.indexOf('Napa Cabbage') ? reply.indexOf('PO-7 Gordon') : undefined)
    assert.ok(napaBlock.includes('0.000'), 'the order-planning quantity belongs to Napa Cabbage')
    assert.equal(napaBlock.includes('項目數'), false, '⛔ and the purchase order\'s field must NOT appear under it')
  })
})

/* ═══ TEST 2 — PROMPT REF == SCHEMA ENUM == VALIDATOR INDEX ═══════════════ */

test('*** 2 — the ref the model is SHOWN is byte-identical to the schema enum ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOpConnector()
    const a = scriptedAdapter('claude', twoReads({
      directAnswer: 'ok', answerClaims: null, unanswerable: false, citesEvidence: false, sections: [], limitations: [], followUp: null
    }))
    await run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] })

    const finalCall = a.calls[2]
    const enumRefs = finalCall.schema.properties.answerPlan.properties.sections
      .items.properties.items.items.properties.sourceId.enum
    assert.deepEqual([...enumRefs].sort(), [`${PURC}#7`, `${REPL}#7`].sort(),
      'the schema pins exactly the two canonical refs — no collapse to one aroma_system#7')

    // The SAME tokens must appear in the observation the model actually reads.
    for (const ref of enumRefs) {
      assert.ok(finalCall.prompt.includes(`ref=${ref}`),
        `⛔ the prompt must show ${ref} verbatim — no subsystem may reconstruct a different ref`)
    }
    assert.equal(finalCall.prompt.includes('ref=aroma_system#7'), false,
      'the ambiguous legacy ref must not be what she is shown when two operations collide')
  })
})

test('*** 2b — and the validator indexes those same canonical refs ***', () => {
  const items = [
    { source: 'aroma_system', readKey: REPL, items: [Object.assign({ source: 'aroma_system', readKey: REPL }, PLAN_ROW)] },
    { source: 'aroma_system', readKey: PURC, items: [Object.assign({ source: 'aroma_system', readKey: PURC }, PO_ROW)] }
  ]
  const index = evidenceIndex([], items)
  assert.ok(index.byId.has(`${REPL}#7`), 'canonical replenishment ref is indexed')
  assert.ok(index.byId.has(`${PURC}#7`), 'canonical purchasing ref is indexed')
  assert.equal(index.byId.get(`${REPL}#7`).title, 'Napa Cabbage')
  assert.equal(index.byId.get(`${PURC}#7`).title, 'PO-7 Gordon')
})

/* ═══ TEST 3 — AMBIGUOUS LEGACY ALIASES FAIL CLOSED ══════════════════════ */

test('*** 3 — with two owners, bare "7" and "aroma_system#7" resolve to NOTHING ***', () => {
  const itemsBySource = [
    { source: 'aroma_system', readKey: REPL, items: [Object.assign({ source: 'aroma_system', readKey: REPL }, PLAN_ROW)] },
    { source: 'aroma_system', readKey: PURC, items: [Object.assign({ source: 'aroma_system', readKey: PURC }, PO_ROW)] }
  ]
  const plan = {
    directAnswer: 'x', citesEvidence: true, unanswerable: false, limitations: [], followUp: null,
    sections: [{ heading: 'h', items: [
      { sourceId: '7', title: 'Napa Cabbage', facts: [] },
      { sourceId: 'aroma_system#7', title: 'PO-7 Gordon', facts: [] }
    ] }]
  }
  const out = validatePlan(plan, { evidenceSets: [], itemsBySource, message: 'x' })
  assert.equal(out.droppedItems, 2,
    '⛔ NO LAST-WRITE-WINS. An ambiguous alias selects no row at all — not the first, not the last.')
  assert.equal(out.plan.sections.length, 0, 'nothing renders from an ambiguous citation')
})

test('*** 3b — with ONE owner, the legacy aliases still resolve ***', () => {
  const itemsBySource = [
    { source: 'aroma_system', readKey: 'aroma_system', items: [Object.assign({ source: 'aroma_system', readKey: 'aroma_system' }, PLAN_ROW)] }
  ]
  for (const alias of ['7', 'aroma_system#7']) {
    const plan = {
      directAnswer: 'x', citesEvidence: true, unanswerable: false, limitations: [], followUp: null,
      sections: [{ heading: 'h', items: [{ sourceId: alias, title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }] }] }]
    }
    const out = validatePlan(plan, { evidenceSets: [], itemsBySource, message: 'x' })
    assert.equal(out.droppedItems, 0, `legacy alias ${alias} must still work when it is unambiguous`)
    assert.equal(out.plan.sections[0].items[0].title, 'Napa Cabbage')
  }
})

/* ═══ TEST 4 — LIVE ROWS + A SECOND LIVE ZERO-ROW READ ═══════════════════ */

test('*** 4 — replenishment rows + purchasing zero rows: both truths, distinguishable ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOpConnector({ listPurchaseOrders: { rows: [], matchingTotal: 0, endpoint: 'purchaseOrders', scope: { field: 'createdAt', window: 'last_30_days', declaredBy: 'reader' } } })
    const PLAN = {
      directAnswer: '訂貨建議一共有 47 項。',
      answerClaims: null, unanswerable: false, citesEvidence: true,
      sections: [{ heading: '要跟進', items: [{ sourceId: `${REPL}#7`, title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }] }] }],
      limitations: [], followUp: null
    }
    const a = scriptedAdapter('claude', twoReads(PLAN))
    const { result, captured } = await withPlanLog(() => run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] }))

    assert.equal(captured[0].droppedSentences, 0, 'replenishment evidence survives (47 is only knowable from it)')
    assert.equal(captured[0].droppedItems, 0, 'replenishment rows survive')

    // The model must be able to tell the two reads apart in the observation itself.
    const finalPrompt = a.calls[2].prompt
    assert.ok(finalPrompt.includes(`SCOPE [${REPL}]`), 'the replenishment scope line is labelled by readKey')
    assert.ok(finalPrompt.includes(`SCOPE [${PURC}]`), 'and the zero-row purchasing read has its OWN scope line')
    assert.ok(String(result.reply).includes('47'))

    // No row ref may be invented for a read that returned none.
    const enumRefs = a.calls[2].schema.properties.answerPlan.properties.sections
      .items.properties.items.items.properties.sourceId.enum
    assert.deepEqual(enumRefs, [`${REPL}#7`], 'zero-row purchasing contributes an evidence key, never a row ref')
  })
})

/* ═══ TEST 5 — CLAIM BINDING, ROW_LOCAL ══════════════════════════════════ */

const twoEvidenceSets = [
  { source: 'aroma_system', readKey: REPL, trust: 'live', matchingTotal: 47, sourceTotal: null, completeWithinScope: false, queryScope: { field: null, window: null, declaredBy: 'reader' } },
  { source: 'aroma_system', readKey: PURC, trust: 'live', matchingTotal: 13, sourceTotal: null, completeWithinScope: true, queryScope: { field: 'createdAt', window: 'last_30_days', declaredBy: 'reader' } }
]
const twoItemGroups = [
  { source: 'aroma_system', readKey: REPL, items: [Object.assign({ source: 'aroma_system', readKey: REPL }, PLAN_ROW)] },
  { source: 'aroma_system', readKey: PURC, items: [Object.assign({ source: 'aroma_system', readKey: PURC }, PO_ROW)] }
]

test('*** 5 — row_local verifies on canonical refs, and refuses ambiguous aliases ***', () => {
  const ctx = { evidenceSets: twoEvidenceSets, itemsBySource: twoItemGroups }

  const good = verifyClaimBindings([{
    text: 'x', claimKind: 'row_local', evidenceSources: [REPL, PURC],
    sourceIds: [`${REPL}#7`, `${PURC}#7`], scope: null
  }], ctx)
  assert.equal(good[0].binding, BINDING.VERIFIED, 'canonical refs resolve to their own reads')

  for (const ambiguous of ['7', 'aroma_system#7']) {
    const bad = verifyClaimBindings([{
      text: 'x', claimKind: 'row_local', evidenceSources: [REPL], sourceIds: [ambiguous], scope: null
    }], ctx)
    assert.equal(bad[0].binding, BINDING.UNVERIFIED, `ambiguous ${ambiguous} must not verify`)
  }
})

test('*** 5b — a canonical ref from a read the claim did not declare is refused ***', () => {
  const out = verifyClaimBindings([{
    text: 'x', claimKind: 'row_local', evidenceSources: [REPL], sourceIds: [`${PURC}#7`], scope: null
  }], { evidenceSets: twoEvidenceSets, itemsBySource: twoItemGroups })
  assert.equal(out[0].binding, BINDING.UNVERIFIED,
    'a row must belong to one of the declared reads — but NOT by the old every-id-under-every-source rule')
})

/* ═══ TEST 6 — CLAIM BINDING, SET_SCOPED ═════════════════════════════════ */

test('*** 6 — set_scoped resolves the EXACT EvidenceSet by readKey ***', () => {
  const ctx = { evidenceSets: twoEvidenceSets, itemsBySource: twoItemGroups }
  // purchasing declares createdAt/last_30_days and is complete within it.
  const ok = verifyClaimBindings([{
    text: 'x', claimKind: 'set_scoped', evidenceSources: [PURC], sourceIds: [],
    scope: { field: 'createdAt', window: 'last_30_days' }
  }], ctx)
  assert.equal(ok[0].binding, BINDING.VERIFIED, 'checked against purchasing, not whichever was stored last')

  // The same scope declared against replenishment must NOT pass — its scope is different.
  const wrong = verifyClaimBindings([{
    text: 'x', claimKind: 'set_scoped', evidenceSources: [REPL], sourceIds: [],
    scope: { field: 'createdAt', window: 'last_30_days' }
  }], ctx)
  assert.equal(wrong[0].binding, BINDING.UNVERIFIED, 'scope belongs to the read it was declared on')
})

test('*** 6b — a bare source matching TWO live evidence sets is ambiguous ***', () => {
  const out = verifyClaimBindings([{
    text: 'x', claimKind: 'set_scoped', evidenceSources: ['aroma_system'], sourceIds: [],
    scope: { field: 'createdAt', window: 'last_30_days' }
  }], { evidenceSets: twoEvidenceSets, itemsBySource: twoItemGroups })
  assert.equal(out[0].binding, BINDING.UNVERIFIED, '⛔ must not silently select one of two reads')
  assert.equal(out[0].reason, 'evidence_source_ambiguous')
})

test('*** 6c — a bare source with exactly ONE live evidence set still works ***', () => {
  const single = [{ source: 'aroma_system', readKey: 'aroma_system', trust: 'live', matchingTotal: 13, sourceTotal: null, completeWithinScope: true, queryScope: { field: 'createdAt', window: 'last_30_days', declaredBy: 'reader' } }]
  const out = verifyClaimBindings([{
    text: 'x', claimKind: 'set_scoped', evidenceSources: ['aroma_system'], sourceIds: [],
    scope: { field: 'createdAt', window: 'last_30_days' }
  }], { evidenceSets: single, itemsBySource: [] })
  assert.equal(out[0].binding, BINDING.VERIFIED, 'legacy compatibility holds while it is unambiguous')
})

/* ═══ TEST 7 — THE AUTOMATIC LEGACY PATH IS UNCHANGED ════════════════════ */

test('*** 7 — an automatic single Aroma read keeps ref=aroma_system#<id> ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOpConnector()
    const PLAN = {
      directAnswer: '訂貨建議一共有 47 項。', answerClaims: null, unanswerable: false, citesEvidence: true,
      sections: [{ heading: '訂貨建議', items: [{ sourceId: 'aroma_system#7', title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }] }] }],
      limitations: [], followUp: null
    }
    const a = scriptedAdapter('claude', [FINAL(PLAN)])
    const { result, captured } = await withPlanLog(() => run('今日要訂咩貨？', a, { connector: tc.connector, sources: ['aroma_system'] }))

    assert.equal(a.calls.length, 1, 'automatic read, one call')
    assert.ok(a.calls[0].prompt.includes('ref=aroma_system#7'),
      '⛔ NO OPERATION NAMESPACE IS INTRODUCED where a source is read once')
    assert.ok(a.calls[0].prompt.includes('SCOPE [aroma_system]'), 'and the scope line is unchanged too')
    const enumRefs = a.calls[0].schema.properties.answerPlan.properties.sections
      .items.properties.items.items.properties.sourceId.enum
    assert.deepEqual(enumRefs, ['aroma_system#7'])
    assert.equal(captured[0].droppedItems, 0, 'and it validates exactly as before')
    assert.ok(String(result.reply).includes('Napa Cabbage'))
  })
})

/* ═══ TEST 8 — NO TRUTH RULE IS RELAXED ══════════════════════════════════ */

test('*** 8 — invented rows and wrong quantities are still refused ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOpConnector()
    const PLAN = {
      directAnswer: '有 42 項要跟。', answerClaims: null, unanswerable: false, citesEvidence: true,
      sections: [{
        heading: '要跟進',
        items: [
          { sourceId: `${REPL}#7`, title: 'Napa Cabbage', facts: [{ field: '現有', value: '999.000' }] },
          { sourceId: `${REPL}#404`, title: 'Phantom', facts: [{ field: '現有', value: '1.000' }] }
        ]
      }],
      limitations: [], followUp: null
    }
    const a = scriptedAdapter('claude', twoReads(PLAN))
    const { result, captured } = await withPlanLog(() => run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] }))
    assert.ok(captured[0].droppedItems >= 1, 'the invented canonical ref is still an invention')
    assert.equal(String(result.reply).includes('Phantom'), false)
    assert.equal(String(result.reply).includes('42'), false, 'the unmeasured count still drops')
  })
})

/* ═══ TEST 9 — THE PRODUCTION TWO-READ SHAPE ═════════════════════════════ */

test('*** 9 — READ → READ → FINAL: both reads survive and both get the plan schema ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOpConnector()
    const PLAN = {
      directAnswer: '兩樣都要跟。', answerClaims: null, unanswerable: false, citesEvidence: true,
      sections: [{ heading: '要跟進', items: [
        { sourceId: `${REPL}#7`, title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }] },
        { sourceId: `${PURC}#7`, title: 'PO-7 Gordon', facts: [{ field: '項目數', value: '9' }] }
      ] }],
      limitations: [], followUp: null
    }
    const a = scriptedAdapter('claude', twoReads(PLAN))
    const { captured } = await withPlanLog(() => run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] }))
    assert.deepEqual(tc.reads.map((r) => r.method), ['listOrderPlanning', 'listPurchaseOrders'])
    assert.equal(a.calls[1].schemaName, 'distill_with_answer_plan', 'step 2 grounds')
    assert.equal(a.calls[2].schemaName, 'distill_with_answer_plan', 'step 3 grounds')
    assert.equal(captured[0].keptItemCount, 2, 'the validator saw BOTH row groups')
  })
})

/* ═══ TEST 10 — STRICT OPENAI SCHEMA ═════════════════════════════════════ */

function violations (schema) {
  const nodes = []
  const walk = (n, p) => {
    if (!n || typeof n !== 'object') return
    if (n.properties && typeof n.properties === 'object') nodes.push({ p, n })
    for (const k of Object.keys(n)) walk(n[k], p + '.' + k)
  }
  walk(schema, 'root')
  return nodes.flatMap(({ p, n }) => {
    const req = Array.isArray(n.required) ? n.required : []
    return Object.keys(n.properties).filter((k) => !req.includes(k)).map((k) => p + '.' + k)
  })
}

test('*** 10 — the shaped schema with two colliding-id operations is strict-valid ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOpConnector()
    const a = scriptedAdapter('claude', twoReads({
      directAnswer: 'ok', answerClaims: null, unanswerable: false, citesEvidence: false, sections: [], limitations: [], followUp: null
    }))
    await run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] })
    const schema = a.calls[2].schema
    assert.deepEqual(violations(schema), [], 'every property is in required, at every node')
    const enumRefs = schema.properties.answerPlan.properties.sections.items.properties.items.items.properties.sourceId.enum
    assert.equal(enumRefs.length, 2, 'no duplicate collapse')
    assert.equal(new Set(enumRefs).size, 2, 'and the two are distinct')
    for (const e of enumRefs) assert.ok(e.length > 0)
  })
})

test('*** 10b — withRowRefs never emits an empty enum ***', () => {
  const shaped = withRowRefs(DISTILL_WITH_PLAN_SCHEMA, [])
  assert.equal(shaped.properties.answerPlan.properties.sections.items.properties.items.items.properties.sourceId.enum, undefined)
  assert.deepEqual(violations(shaped), [])
})

/* ═══ TEST 11 — TELEMETRY REPORTS SOURCE KINDS, NOT OPERATIONS ═══════════ */

test('*** 11 — sourcesRead stays de-duplicated source kinds, not inflated ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOpConnector()
    const routes = []
    const original = console.log
    console.log = (...args) => { if (args[0] === '[AROMA-TURN-ROUTE]') { try { routes.push(JSON.parse(args[1])) } catch (_) {} } }
    try {
      const a = scriptedAdapter('claude', twoReads({
        directAnswer: 'ok', answerClaims: null, unanswerable: false, citesEvidence: false, sections: [], limitations: [], followUp: null
      }))
      await run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] })
    } finally { console.log = original }
    const withSources = routes.filter((r) => Array.isArray(r.sourcesRead) && r.sourcesRead.length)
    for (const r of withSources) {
      assert.deepEqual(r.sourcesRead, ['aroma_system'],
        'two operations are one external source — provenance is not source telemetry')
    }
  })
})
