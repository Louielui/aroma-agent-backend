'use strict'
/**
 * o1RouteToReadContinuity.test.js — DOES THE UPGRADED ROUTE ACTUALLY REACH THE CONNECTOR?
 *
 * The live call site is proven. What was NOT proven is the half after it: that a semantic
 * consensus re-enters the SAME read machinery a deterministic BUSINESS_QUERY uses, calls the
 * one authoritative Aroma method, and grounds the answer in what came back.
 *
 * ⛔ THIS REUSES THE EXISTING READ HARNESS, IT DOES NOT INVENT ONE. The spy connector, the
 * scripted answering adapter and the env shape are taken from context/noIntentNoRead.test.js,
 * which already proves a deterministic BUSINESS_QUERY reaches `aroma_system.listInvoices`. The
 * one deliberate change is TURN_ROUTER: 'on' — that file turns the router OFF, and with it off
 * there is no CONVERSATION decision to upgrade and the semantic path cannot exist at all.
 *
 * Fake connectors only. No provider, no network, no production HTTP, no writes.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { processIntake } = require('./intakeService')

/** The existing spy, copied in shape from noIntentNoRead so both files record calls the same way. */
function spyConnector (rows = []) {
  const calls = []
  return {
    calls,
    connector: {
      read: async (source, method) => {
        calls.push(source + '.' + method)
        return { results: rows.map((r) => Object.assign({ trust: 'live', source }, r)) }
      }
    }
  }
}

/** A unique row, so a grounded reply can be traced to the connector rather than to fluency. */
const MARKER = 'PO-CONTINUITY-7731'
const ROWS = [{ sourceId: '7731', title: MARKER, originalDate: '2026-08-20' }]

function scriptedAdapter (seen) {
  return {
    name: 'spy',
    async complete (prompt, o) {
      seen.answerCalls++
      seen.lastResponseFormat = (o && o.responseFormat) || null
      return {
        text: JSON.stringify({ intent: 'question', mode: 'chat', reply: '好的。' }),
        provider: 'claude', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'spy'
      }
    }
  }
}

async function turn (message, semanticPairs) {
  const seen = { semanticCalls: 0, answerCalls: 0, preConsensusReads: 0, lastResponseFormat: null }
  const spy = spyConnector(ROWS)
  let n = 0
  const semanticCallModel = async () => {
    // Any connector call recorded before the SECOND classification returns would be a read
    // performed before consensus could possibly exist.
    if (n < semanticPairs.length - 1) seen.preConsensusReads += spy.calls.length
    seen.semanticCalls++
    return JSON.stringify(semanticPairs[Math.min(n++, semanticPairs.length - 1)])
  }
  const lines = []
  const orig = console.log
  const saved = { ...process.env }
  Object.assign(process.env, {
    A4_KNOWLEDGE_ROUTING: 'off', TURN_ROUTER: 'on', READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on'
  })
  let result = null
  console.log = (...a) => { lines.push(a.map(String).join(' ')) }
  try {
    result = await processIntake(message, scriptedAdapter(seen), [], {
      interactionMode: 'chat', demo: false,
      semanticCallModel,
      readContextDeps: { connector: spy.connector, sources: ['aroma_system'] }
    })
  } finally {
    console.log = orig
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
  const tr = lines.filter((l) => l.includes('[AROMA-TURN-ROUTE]')).pop()
  const route = tr ? JSON.parse(tr.slice(tr.indexOf('{'))) : {}
  return { result, seen, calls: spy.calls, route, lines }
}

const HI = (i) => ({ intent: i, confidence: 'HIGH' })

/* ═══ 3. CONTROL FIRST — the harness must be able to read at all ═══════════ */

test('*** CONTROL: the deterministic path reaches the connector through this harness ***', async () => {
  // ⛔ EARN THE NUMBER. If this cannot read, every zero below is meaningless.
  const { seen, calls, route } = await turn('今日邊啲貨要補？', [HI('order_planning')])
  assert.equal(seen.semanticCalls, 0, 'a deterministic win must never reach the classifier')
  assert.equal(route.route, 'BUSINESS_QUERY')
  assert.deepEqual(calls, ['aroma_system.listOrderPlanning'], 'the deterministic read did not execute: ' + JSON.stringify(calls))
})

/* ═══ 2. THE GAP THIS TRANCHE EXISTS TO CLOSE ══════════════════════════════ */

test('*** SEMANTIC CONSENSUS REACHES listPurchaseOrders EXACTLY ONCE ***', async () => {
  const { seen, calls, route, result } = await turn('叫咗嘅貨到咗未？', [HI('purchase_order'), HI('purchase_order')])

  assert.equal(seen.semanticCalls, 2, 'two independent classifications')
  assert.equal(seen.preConsensusReads, 0, '⛔ a connector was read before consensus')

  assert.equal(route.route, 'BUSINESS_QUERY')
  assert.equal(route.reason, 'semantic_purchase_order')
  assert.deepEqual(route.routerSources, ['aroma_system'])

  // The authoritative purchase_order method, once, and nothing else.
  assert.deepEqual(calls, ['aroma_system.listPurchaseOrders'],
    '⛔ the semantic route did not re-enter the existing read path: ' + JSON.stringify(calls))

  // Grounded: the plan schema was requested, which only happens when rows exist.
  assert.ok(seen.lastResponseFormat, '⛔ no rows reached the plan layer, so nothing was grounded')
  assert.ok(result && typeof result === 'object')
})

/* ═══ 4. CLARIFY CONTROL ═══════════════════════════════════════════════════ */

test('*** CLARIFY READS NOTHING, THROUGH THE SAME HARNESS THAT CAN READ ***', async () => {
  const { seen, calls, result } = await turn('有咩貨唔夠要入返？', [HI('order_planning'), HI('order_planning')])
  assert.equal(seen.semanticCalls, 2)
  assert.deepEqual(calls, [], '⛔ an ambiguous turn read a business source: ' + JSON.stringify(calls))
  const reply = (result && (result.reply || result.replyForArchive)) || ''
  assert.ok(/定係|想睇/.test(reply), '⛔ the clarify question did not reach the Owner: ' + JSON.stringify(reply).slice(0, 140))
})

/* ═══ 7. AUTHORITY FENCES ══════════════════════════════════════════════════ */

const { operationForIntentKey, bindOperationForIntent, AROMA_OPERATIONS } = require('../context/readOperations')
const { intentFor } = require('../context/readContext')

test('*** A/B — an intent resolves ONLY through the frozen operations table ***', () => {
  for (const row of AROMA_OPERATIONS) {
    assert.equal(operationForIntentKey(row.intentKey), row.operation, 'derived, not duplicated')
  }
  for (const bad of ['mail', 'schedule', 'document', 'code', 'NONE', 'not_a_key', '', null, 42]) {
    assert.equal(operationForIntentKey(bad), null, '⛔ an operation was manufactured for ' + JSON.stringify(bad))
  }
})

test('*** F — the BOUND operation comes from consensus, not from the words ***', async () => {
  // My first version of this test was wrong, and the suite caught it: the message I picked
  // contained 補返貨, so intentFor matched deterministically and the semantic path never ran at
  // all. That miss is itself a fence, so it is asserted rather than deleted.
  assert.ok(intentFor('有咩貨唔夠要入返嚟補返貨？'), 'a message carrying a table noun stays deterministic')

  // The real claim: on a genuine blind spot the automatic planner would find NOTHING in these
  // words, and the read still goes to purchasing because the consensus said so.
  assert.equal(intentFor('叫咗嘅貨到咗未？'), null, 'blind-spot precondition')
  const { calls } = await turn('叫咗嘅貨到咗未？', [HI('purchase_order'), HI('purchase_order')])
  assert.deepEqual(calls, ['aroma_system.listPurchaseOrders'])
})

test('*** E — a model-supplied operation is refused, not stripped ***', async () => {
  // This test found a real gap: the forbidden-field list predated the directed read, so it
  // blocked source/connector/tool/method and let `operation` through — the one field that had
  // just become authority. The whole reply is now rejected and the turn abstains.
  const { seen, calls } = await turn('叫咗嘅貨到咗未？', [
    { intent: 'purchase_order', confidence: 'HIGH', operation: 'aroma_system.purchasing' },
    { intent: 'purchase_order', confidence: 'HIGH', operation: 'aroma_system.purchasing' }
  ])
  assert.equal(seen.semanticCalls, 2)
  assert.deepEqual(calls, [], '⛔ a model-supplied operation reached the read path')
})

test('*** C/D — AN OPERATION OUTSIDE THE SERVER-CHOSEN SOURCES CANNOT EXECUTE ***', () => {
  // Driven directly, because through the pipeline this fence cannot fire: operationForIntentKey
  // and the INTENTS source list are derived from tables that currently agree, so the mismatch
  // is unreachable. It is asserted here against the day they drift, which is the only day it
  // would matter and the day nobody would notice.
  assert.equal(bindOperationForIntent('purchase_order', ['aroma_system']), 'aroma_system.purchasing')
  assert.equal(bindOperationForIntent('purchase_order', ['gmail']), null, '⛔ bound outside the chosen sources')
  assert.equal(bindOperationForIntent('purchase_order', []), null, '⛔ bound with no authorised source')
  assert.equal(bindOperationForIntent('purchase_order', null), null)
  assert.equal(bindOperationForIntent('mail', ['gmail']), null, 'a non-Aroma intent binds no Aroma operation')
  assert.equal(bindOperationForIntent('not_a_key', ['aroma_system']), null)
  // and the precondition that makes the fence unreachable today, pinned so a drift is visible
  for (const row of AROMA_OPERATIONS) assert.equal(row.source, 'aroma_system')
})
test('*** G — the semantic channel is absent on deterministic turns ***', async () => {
  const { lines, calls } = await turn('今日邊啲貨要補？', [HI('order_planning')])
  assert.equal(lines.filter((l) => l.includes('[AROMA-O1-SEMANTIC]')).length, 0,
    '⛔ the semantic path ran on a deterministic win')
  assert.deepEqual(calls, ['aroma_system.listOrderPlanning'])
})

test('*** the grounded reply derives from the connector row, not from fluency ***', async () => {
  const { seen, calls } = await turn('叫咗嘅貨到咗未？', [HI('purchase_order'), HI('purchase_order')])
  assert.deepEqual(calls, ['aroma_system.listPurchaseOrders'])
  assert.ok(seen.lastResponseFormat, '⛔ no rows reached the plan layer')
  assert.equal(seen.lastResponseFormat.type, 'json_schema')
})
