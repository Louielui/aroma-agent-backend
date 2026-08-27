'use strict'
/**
 * o1ProductionContract.test.js — THE EXACT FIRST READ, UNDER PRODUCTION FLAGS.
 *
 * Big Step F proved the server-derived operation reached the connector with A4 OFF. Production
 * runs A4 ON, and there it did not: with a neutral model nothing was read at all, and with a
 * model of its own opinion the turn read replenishment instead. Same defect, two costumes — the
 * server decided WHAT to read and never got to read it.
 *
 * ORDER IS THE PROPERTY, NOT THE TOTAL. A purchasing read that happens after the model has
 * already pulled replenishment has still let the substitution happen, so the assertions below
 * are on businessCalls[0], not on a count.
 *
 * Fake provider, fake main model, fake connectors. No network, no production HTTP, no writes.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { processIntake } = require('./intakeService')

const PRODUCTION_FLAGS = Object.freeze({
  TURN_ROUTER: 'on',
  A4_KNOWLEDGE_ROUTING: 'on',
  READ_ACCESS: 'on',
  CONTEXT_AROMA_SYSTEM: 'on'
})

const MARKER = 'PO-MARKER-7731'

function spyConnector (unavailableMethod) {
  const calls = []
  return {
    calls: calls,
    connector: {
      read: async (source, method) => {
        calls.push(source + '.' + method)
        if (unavailableMethod && method === unavailableMethod) return { results: [], unavailable: true }
        return { results: [{ trust: 'live', source: source, sourceId: '7731', title: MARKER }] }
      }
    }
  }
}

function adversarialAdapter (seen) {
  return {
    name: 'adversarial',
    async complete (prompt, o) {
      seen.answerCalls++
      seen.readRequestOffered = true
      return {
        text: JSON.stringify({
          intent: 'question',
          mode: 'chat',
          reply: 'ok',
          nextRead: { capability: 'aroma_system.replenishment' }
        }),
        provider: 'claude',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        model: 'adversarial'
      }
    }
  }
}

async function turn (message, semanticPairs, unavailableMethod) {
  const seen = { semanticCalls: 0, answerCalls: 0, readRequestOffered: false, preConsensusReads: 0 }
  const spy = spyConnector(unavailableMethod)
  let n = 0
  const lines = []
  const orig = console.log
  const saved = Object.assign({}, process.env)
  Object.assign(process.env, PRODUCTION_FLAGS)
  let result = null
  console.log = function () { lines.push(Array.prototype.slice.call(arguments).map(String).join(' ')) }
  try {
    result = await processIntake(message, adversarialAdapter(seen), [], {
      interactionMode: 'chat',
      demo: false,
      semanticCallModel: semanticPairs
        ? async () => {
            if (n < (semanticPairs.length - 1)) seen.preConsensusReads += spy.calls.length
            seen.semanticCalls++
            return JSON.stringify(semanticPairs[Math.min(n++, semanticPairs.length - 1)])
          }
        : undefined,
      readContextDeps: { connector: spy.connector, sources: ['aroma_system'] }
    })
  } finally {
    console.log = orig
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
  const o1 = lines.filter(function (l) { return l.indexOf('[AROMA-O1-SEMANTIC]') >= 0 }).pop()
  const sem = o1 ? JSON.parse(o1.slice(o1.indexOf('{'))) : {}
  return { result: result, seen: seen, calls: spy.calls, sem: sem, lines: lines }
}

const HI = function (i) { return { intent: i, confidence: 'HIGH' } }
const NONE_LOW = { intent: 'NONE', confidence: 'LOW' }

test('*** the harness really is production-like, A4 must be ON ***', () => {
  assert.equal(PRODUCTION_FLAGS.A4_KNOWLEDGE_ROUTING, 'on')
  assert.equal(PRODUCTION_FLAGS.TURN_ROUTER, 'on')
})

test('*** B — THE EXACT SERVER-DERIVED READ HAPPENS FIRST, UNDER A4 ON ***', async () => {
  const r = await turn('叫咗嘅貨到咗未？', [HI('purchase_order'), HI('purchase_order')])
  assert.equal(r.seen.semanticCalls, 2)
  assert.equal(r.seen.preConsensusReads, 0, 'a business read happened before consensus')
  assert.equal(r.sem.consensus, true)
  assert.equal(r.sem.serverOperation, 'aroma_system.purchasing')
  assert.equal(r.seen.readRequestOffered, true, 'the adversarial model never got its chance')
  assert.ok(r.calls.length > 0, 'nothing was read at all, the A4 gap is back')
  assert.equal(r.calls[0], 'aroma_system.listPurchaseOrders',
    'first business read was not the server-derived operation: ' + JSON.stringify(r.calls))
})

test('*** B — no same-source substitution afterwards either ***', async () => {
  const r = await turn('叫咗嘅貨到咗未？', [HI('purchase_order'), HI('purchase_order')])
  assert.deepEqual(r.calls, ['aroma_system.listPurchaseOrders'],
    'a same-source substitution followed the semantic read: ' + JSON.stringify(r.calls))
})

test('*** E — an unavailable semantic read does NOT degrade into a substitute ***', async () => {
  const r = await turn('叫咗嘅貨到咗未？', [HI('purchase_order'), HI('purchase_order')], 'listPurchaseOrders')
  assert.equal(r.calls[0], 'aroma_system.listPurchaseOrders', 'the bound operation must still be attempted')
  const others = r.calls.filter(function (c) { return c !== 'aroma_system.listPurchaseOrders' })
  assert.deepEqual(others, [], 'a failed semantic read was replaced by another table: ' + JSON.stringify(others))
})

test('*** A — deterministic unchanged, still reads order planning ***', async () => {
  const r = await turn('今日邊啲貨要補？', [HI('order_planning')])
  assert.equal(r.seen.semanticCalls, 0, 'a deterministic win never reaches the classifier')
  assert.ok(r.calls.indexOf('aroma_system.listOrderPlanning') >= 0,
    'the deterministic read stopped working: ' + JSON.stringify(r.calls))
})

test('*** C — clarify remains terminal to reads under the same pressure ***', async () => {
  const r = await turn('有咩貨唔夠要入返？', [HI('order_planning'), HI('order_planning')])
  assert.equal(r.sem.clarify, true)
  assert.deepEqual(r.calls, [], 'a clarified turn read: ' + JSON.stringify(r.calls))
  const reply = (r.result && (r.result.reply || r.result.replyForArchive)) || ''
  assert.ok(/定係|想睇/.test(reply), 'the clarification did not reach the Owner')
})

test('*** D — ABSTAIN leaves ordinary reasoning available ***', async () => {
  const r = await turn('聽日搞乜？', [NONE_LOW, NONE_LOW])
  assert.equal(r.seen.semanticCalls, 2)
  assert.equal(r.sem.clarify, false)
  assert.equal(r.seen.readRequestOffered, true, 'reasoning was globally suppressed, which it must not be')
})
