'use strict'

/**
 * multiOperationGrounding.test.js — two Aroma operations are two reads, not one.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEFECT THIS FILE EXISTS FOR.
 *
 * The turn's grounding state is keyed by SOURCE:
 *
 *     turnPerSource.set(row.source, row)
 *     turnItems.set(g.source, g.items)
 *     turnEvidence.set(e.source, e)
 *
 * `aroma_system.replenishment` and `aroma_system.purchasing` are DIFFERENT reads of
 * DIFFERENT entities — and both carry `source === 'aroma_system'`. So the second one
 * overwrote the first, and the production shape (READ → READ → FINAL) reached the validator
 * holding only half of what had been read.
 *
 * Worse, the three writes disagree about WHEN they overwrite: `turnItems` is replaced only
 * when the new group is non-empty, while perSource and evidence are replaced unconditionally.
 * So live-then-zero-row left read A's ROWS paired with read B's EVIDENCE — a state that
 * describes neither read.
 *
 * This was latent until Truth Closure, which is what finally hands these structures to the
 * validator on the model-directed path. It is load-bearing now.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')

const NOW = '2026-08-08T21:41:45.000Z'

/* ═══ TWO GENUINELY DIFFERENT OPERATION SHAPES ════════════════════════════ */

const REPLENISHMENT_ROWS = [
  {
    sourceId: '7', title: 'Napa Cabbage', entityType: 'order_suggestion',
    content: 'id=7 · name=Napa Cabbage · live_qty=0.000 · par_level=75.000 · suggested_order_qty=75.000',
    fields: { id: '7', name: 'Napa Cabbage', live_qty: '0.000', par_level: '75.000', suggested_order_qty: '75.000' }
  },
  {
    sourceId: '8', title: 'Dark Soy Sauce', entityType: 'order_suggestion',
    content: 'id=8 · name=Dark Soy Sauce · live_qty=2.000 · par_level=12.000 · suggested_order_qty=10.000',
    fields: { id: '8', name: 'Dark Soy Sauce', live_qty: '2.000', par_level: '12.000', suggested_order_qty: '10.000' }
  }
]

const PURCHASING_ROWS = [
  {
    sourceId: '31', title: 'PO-31 Sysco', entityType: 'purchase_order',
    content: 'id=31 · supplier=Sysco · status=sent · itemCount=6',
    fields: { id: '31', supplier: 'Sysco', status: 'sent', itemCount: '6' }
  }
]

/** ⛔ PER-METHOD rows. A connector that returns the same row for both methods HIDES the
 *  overwrite entirely — the two buckets would be indistinguishable and the test would pass
 *  against the defect. */
function twoOperationConnector (overrides = {}) {
  const reads = []
  const byMethod = Object.assign({
    listOrderPlanning: { rows: REPLENISHMENT_ROWS, matchingTotal: 47, endpoint: 'orderPlanning' },
    listPurchaseOrders: { rows: PURCHASING_ROWS, matchingTotal: 13, endpoint: 'purchaseOrders' }
  }, overrides)
  return {
    reads,
    connector: {
      async read (source, method) {
        reads.push({ source, method })
        const spec = byMethod[method] || { rows: [], matchingTotal: 0, endpoint: method }
        const rows = spec.rows.map((r) => Object.assign({
          source, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null
        }, r))
        return {
          asOf: NOW,
          source,
          count: rows.length,
          results: rows,
          evidence: {
            source,
            endpoint: spec.endpoint,
            entityType: rows.length ? rows[0].entityType : 'unknown',
            rowShape: { hasLocation: false, hasAsOf: false, note: null },
            metrics: {},
            matchingTotal: spec.matchingTotal,
            shownCount: rows.length,
            sourceTotal: null,
            completeness: rows.length === spec.matchingTotal ? 'complete' : 'sample',
            usedFallback: false,
            retrievedAt: NOW,
            trust: 'live',
            provenance: 'Aroma System ' + spec.endpoint
          }
        }
      }
    }
  }
}

function scriptedAdapter (label, envelopes) {
  const calls = []
  return {
    label,
    calls,
    async complete (prompt, opts = {}) {
      calls.push({ schemaName: opts.responseFormat ? opts.responseFormat.name : null, schema: opts.responseFormat ? opts.responseFormat.schema : null })
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

/* ═══ A. BOTH OPERATIONS' EVIDENCE MUST SURVIVE ═══════════════════════════ */

test('*** A — replenishment + purchasing: the validator keeps supported facts from BOTH ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOperationConnector()
    const PLAN = {
      directAnswer: '有嘢要跟進。',
      answerClaims: null,
      unanswerable: false,
      citesEvidence: true,
      sections: [{
        heading: '要跟進',
        items: [
          // from READ 1 — order planning
          { sourceId: 'aroma_system#7', title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }] },
          // from READ 2 — purchase orders
          { sourceId: 'aroma_system#31', title: 'PO-31 Sysco', facts: [{ field: '項目數', value: '6' }] }
        ]
      }],
      limitations: [],
      followUp: null
    }
    const a = scriptedAdapter('claude', [
      READ('aroma_system.replenishment'), READ('aroma_system.purchasing'), FINAL(PLAN)
    ])
    const { result, captured } = await withPlanLog(() => run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] }))

    assert.deepEqual(tc.reads, [
      { source: 'aroma_system', method: 'listOrderPlanning' },
      { source: 'aroma_system', method: 'listPurchaseOrders' }
    ], 'both reads really ran')

    assert.equal(captured.length, 1, 'the validator ran')
    assert.equal(captured[0].droppedItems, 0,
      '⛔ THE BLOCKER: the second operation overwrote the first, so the row from READ 1 was ' +
      'no longer in the evidence index and its item was deleted as unverifiable')
    assert.equal(captured[0].keptItemCount, 2, 'both rows are real and both must be kept')
    assert.ok(String(result.reply).includes('Napa Cabbage'), 'READ 1 reached the Owner')
    assert.ok(String(result.reply).includes('PO-31 Sysco'), 'READ 2 reached the Owner')
  })
})

/* ═══ B. LIVE ROWS THEN A LIVE ZERO-ROW READ ══════════════════════════════ */

test('*** B — READ 1 rows + READ 2 live-but-empty: BOTH truths survive, unpaired ***', async () => {
  await withEnv({}, async () => {
    // READ 2 succeeds and matches nothing. Its evidence must not displace READ 1's, and
    // READ 1's rows must not be left describing READ 2's read.
    const tc = twoOperationConnector({ listPurchaseOrders: { rows: [], matchingTotal: 0, endpoint: 'purchaseOrders' } })
    const PLAN = {
      // 47 is READ 1's matchingTotal and comes from NOWHERE ELSE — it exists only in that
      // read's EvidenceSet. If READ 2's evidence displaced it, this sentence is unsupported.
      directAnswer: '訂貨建議一共有 47 項。',
      answerClaims: null,
      unanswerable: false,
      citesEvidence: true,
      sections: [{ heading: '要跟進', items: [{ sourceId: 'aroma_system#7', title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }] }] }],
      limitations: [],
      followUp: null
    }
    const a = scriptedAdapter('claude', [
      READ('aroma_system.replenishment'), READ('aroma_system.purchasing'), FINAL(PLAN)
    ])
    const { result, captured } = await withPlanLog(() => run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] }))

    assert.equal(captured.length, 1, 'the validator ran')
    assert.equal(captured[0].droppedSentences, 0,
      '⛔ READ 1 EVIDENCE SURVIVES: 47 is only knowable from the replenishment EvidenceSet. ' +
      'A zero-row second read must not displace it.')
    assert.equal(captured[0].droppedItems, 0, 'READ 1 rows survive too')
    assert.ok(String(result.reply).includes('47'), 'and the measured total reaches the Owner')
    assert.ok(String(result.reply).includes('Napa Cabbage'))
  })
})

/* ═══ C. TWO OPERATIONS, ONE sourceId VALUE ═══════════════════════════════ */

/**
 * ⛔ SCOPE STOP — REPORTED, NOT SILENTLY FIXED.
 *
 * The keying fix above stops one operation ERASING another. It cannot make two entities that
 * share an id distinguishable, because the evidence identity is `source#sourceId` and both
 * rows are `aroma_system#7`. `evidenceIndex` does `byId.set(source#id, row)` (last wins) and
 * `validatePlan` resolves an item with `byId.get(sourceId)` and renders `row.title`.
 *
 * MEASURED CONSEQUENCE — and it is mis-attribution, not a safe drop:
 *
 *     **PO-7 Gordon**
 *     現有 0.000        ← an ORDER-PLANNING fact, rendered under the PURCHASE ORDER's title
 *     **PO-7 Gordon**
 *     項目數 9
 *
 * Fixing it means changing the evidence identity/ref contract, which lives in THREE places
 * outside this file — readContext.renderItem (what the model is SHOWN as `ref=`),
 * answerPlan.evidenceIndex (what the validator indexes by), and the ref builder in
 * intakeService. That is beyond intakeService + tests, so it is reported rather than done.
 *
 * C1 asserts what the keying fix DOES achieve. C2 is the unmet requirement, kept as `todo` so
 * it is on the record. C3 PINS the current unsafe behaviour so it cannot quietly get worse and
 * so the eventual fix has an exact assertion to flip.
 */
test('*** C1 — under id collision, BOTH operations\' rows still reach the evidence ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOperationConnector({
      listPurchaseOrders: {
        rows: [{
          sourceId: '7', title: 'PO-7 Gordon', entityType: 'purchase_order',
          content: 'id=7 · supplier=Gordon · status=sent · itemCount=9',
          fields: { id: '7', supplier: 'Gordon', status: 'sent', itemCount: '9' }
        }],
        matchingTotal: 13,
        endpoint: 'purchaseOrders'
      }
    })
    // 47 is knowable ONLY from read 1's EvidenceSet; 9 only from read 2's row. Both surviving
    // proves neither read was erased, which is what the keying fix is responsible for.
    const PLAN = {
      directAnswer: '訂貨建議一共有 47 項。',
      answerClaims: null,
      unanswerable: false,
      citesEvidence: true,
      // CANONICAL, because the legacy `aroma_system#7` now has two owners and correctly
      // resolves to nothing (proved by C3). This test is about the KEYING fix — that neither
      // read was erased — so it cites the ref that names the read it means.
      sections: [{ heading: '要跟進', items: [{ sourceId: 'aroma_system.purchasing#7', title: 'PO-7 Gordon', facts: [{ field: '項目數', value: '9' }] }] }],
      limitations: [],
      followUp: null
    }
    const a = scriptedAdapter('claude', [
      READ('aroma_system.replenishment'), READ('aroma_system.purchasing'), FINAL(PLAN)
    ])
    const { result, captured } = await withPlanLog(() => run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] }))
    assert.equal(captured[0].droppedSentences, 0, 'read 1 evidence survived read 2')
    assert.equal(captured[0].droppedItems, 0, 'read 2 row survived too')
    assert.ok(String(result.reply).includes('47'))
  })
})

test('*** C3 — FORMERLY A LIMITATION PIN: a shared sourceId no longer mis-attributes ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOperationConnector({
      listPurchaseOrders: {
        rows: [{
          sourceId: '7', title: 'PO-7 Gordon', entityType: 'purchase_order',
          content: 'id=7 · supplier=Gordon · status=sent · itemCount=9',
          fields: { id: '7', supplier: 'Gordon', status: 'sent', itemCount: '9' }
        }],
        matchingTotal: 13,
        endpoint: 'purchaseOrders'
      }
    })
    const PLAN = {
      directAnswer: '兩樣都要跟。',
      answerClaims: null,
      unanswerable: false,
      citesEvidence: true,
      sections: [{
        heading: '要跟進',
        items: [
          { sourceId: 'aroma_system#7', title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }] },
          { sourceId: 'aroma_system#7', title: 'PO-7 Gordon', facts: [{ field: '項目數', value: '9' }] }
        ]
      }],
      limitations: [],
      followUp: null
    }
    const a = scriptedAdapter('claude', [
      READ('aroma_system.replenishment'), READ('aroma_system.purchasing'), FINAL(PLAN)
    ])
    const { result } = await withPlanLog(() => run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] }))

    // ⛔ INVERTED, as its own note instructed. The plan below cites the AMBIGUOUS legacy
    //  for both items, and with two owners that now resolves to NO row at
    // all — fail closed. Neither renders, and crucially neither renders under the OTHER's
    // name, which is the mis-attribution this pin existed to record.
    assert.equal(String(result.reply).includes('Napa Cabbage'), false,
      'an ambiguous citation selects nothing — not the first row, not the last')
    assert.equal(String(result.reply).includes('PO-7 Gordon'), false,
      '⛔ THE DEFECT IS GONE: no row is silently chosen to stand in for the other')
  })
})

test('*** C2 — two operations sharing a sourceId ARE citable as distinct entities ***',
  async () => {
    await withEnv({}, async () => {
    // Both operations return a row whose id is 7. They are different entities from different
    // endpoints; nothing may treat them as one identity.
    const tc = twoOperationConnector({
      listPurchaseOrders: {
        rows: [{
          sourceId: '7', title: 'PO-7 Gordon', entityType: 'purchase_order',
          content: 'id=7 · supplier=Gordon · status=sent · itemCount=9',
          fields: { id: '7', supplier: 'Gordon', status: 'sent', itemCount: '9' }
        }],
        matchingTotal: 13,
        endpoint: 'purchaseOrders'
      }
    })
    const PLAN = {
      directAnswer: '兩樣都要跟。',
      answerClaims: null,
      unanswerable: false,
      citesEvidence: true,
      sections: [{
        heading: '要跟進',
        items: [
          { sourceId: 'aroma_system.replenishment#7', title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }] },
          { sourceId: 'aroma_system.purchasing#7', title: 'PO-7 Gordon', facts: [{ field: '項目數', value: '9' }] }
        ]
      }],
      limitations: [],
      followUp: null
    }
    const a = scriptedAdapter('claude', [
      READ('aroma_system.replenishment'), READ('aroma_system.purchasing'), FINAL(PLAN)
    ])
    const { result, captured } = await withPlanLog(() => run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] }))

    // Both rows were really retrieved this turn, so both facts are real and both must survive.
    // If the ref contract cannot tell them apart, this is where it shows.
    assert.equal(captured.length, 1, 'the validator ran')
    assert.equal(captured[0].keptItemCount, 2, 'two real entities, two kept items')
    assert.ok(String(result.reply).includes('Napa Cabbage'), 'the order-planning entity survives')
    assert.ok(String(result.reply).includes('PO-7 Gordon'), 'the purchase-order entity survives')
  })
})

/* ═══ D. THE AUTOMATIC SINGLE-SOURCE PATH IS UNCHANGED ════════════════════ */

test('*** D — an automatic BUSINESS_QUERY read is unaffected ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOperationConnector()
    const PLAN = {
      directAnswer: '訂貨建議一共有 47 項。',
      answerClaims: null,
      unanswerable: false,
      citesEvidence: true,
      sections: [{ heading: '訂貨建議', items: [{ sourceId: 'aroma_system#7', title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }] }] }],
      limitations: [],
      followUp: null
    }
    const a = scriptedAdapter('claude', [FINAL(PLAN)])
    const { result, captured } = await withPlanLog(() => run('今日要訂咩貨？', a, { connector: tc.connector, sources: ['aroma_system'] }))
    assert.equal(a.calls.length, 1, 'one call — automatic read, no reasoning step')
    assert.equal(a.calls[0].schemaName, 'distill_with_answer_plan')
    assert.equal(captured[0].droppedItems, 0)
    assert.ok(String(result.reply).includes('Napa Cabbage'))
  })
})

/* ═══ G. UNSUPPORTED CLAIMS ARE STILL DROPPED ═════════════════════════════ */

test('*** G — an invented row is still refused across two operations ***', async () => {
  await withEnv({}, async () => {
    const tc = twoOperationConnector()
    const PLAN = {
      directAnswer: '有嘢要跟進。',
      answerClaims: null,
      unanswerable: false,
      citesEvidence: true,
      sections: [{
        heading: '要跟進',
        items: [
          { sourceId: 'aroma_system#7', title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }] },
          { sourceId: 'aroma_system#404', title: 'Phantom Supplier', facts: [{ field: '項目數', value: '99' }] }
        ]
      }],
      limitations: [],
      followUp: null
    }
    const a = scriptedAdapter('claude', [
      READ('aroma_system.replenishment'), READ('aroma_system.purchasing'), FINAL(PLAN)
    ])
    const { result, captured } = await withPlanLog(() => run(BROAD, a, { connector: tc.connector, sources: ['aroma_system'] }))
    assert.ok(captured[0].droppedItems >= 1, 'the invented row is refused by the EXISTING validator')
    assert.equal(String(result.reply).includes('Phantom Supplier'), false, 'and never reaches the Owner')
    assert.ok(String(result.reply).includes('Napa Cabbage'), 'while the real one survives')
  })
})
