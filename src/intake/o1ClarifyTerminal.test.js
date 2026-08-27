'use strict'
/**
 * o1ClarifyTerminal.test.js — CLARIFY IS TERMINAL TO READS, UNDER PRESSURE.
 *
 * This file exists because the previous acceptance passed while production failed. That harness
 * ran with A4_KNOWLEDGE_ROUTING off and a flat answering adapter that never asked to read
 * anything, so the machinery that caused the production failure was switched off in the test.
 * Every "reads = 0" it reported was true and meaningless.
 *
 * Here the flags match production and the answering adapter is ADVERSARIAL: given any chance it
 * demands aroma_system.replenishment. If clarify is terminal only in theory, this file goes red.
 *
 * Fake provider, fake connectors, fake stores. No network, no production HTTP, no writes.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { processIntake } = require('./intakeService')

/** The same relevant flags production runs with (launcher + runtimeContract STABLE_ENV). */
const PRODUCTION_FLAGS = Object.freeze({
  TURN_ROUTER: 'on',
  A4_KNOWLEDGE_ROUTING: 'on',
  READ_ACCESS: 'on',
  CONTEXT_AROMA_SYSTEM: 'on'
})

function spyConnector (rows) {
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

/**
 * ADVERSARIAL BY CONSTRUCTION. It always asks to read replenishment. On a clarified turn the
 * server must refuse it; on an ordinary turn it must be obeyed, which is what makes the control
 * cases meaningful rather than decorative.
 */
function adversarialAdapter (seen) {
  return {
    name: 'adversarial',
    async complete (prompt, o) {
      seen.answerCalls++
      seen.readRequestOffered = true
      seen.lastResponseFormat = (o && o.responseFormat) || null
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

async function turn (message, semanticPairs) {
  const seen = { semanticCalls: 0, answerCalls: 0, readRequestOffered: false, preConsensusReads: 0 }
  const spy = spyConnector([{ sourceId: '7731', title: 'PO-CLARIFY-7731', originalDate: '2026-08-20' }])
  let n = 0
  const semanticCallModel = semanticPairs
    ? async () => {
        if (n < (semanticPairs.length - 1)) seen.preConsensusReads += spy.calls.length
        seen.semanticCalls++
        return JSON.stringify(semanticPairs[Math.min(n++, semanticPairs.length - 1)])
      }
    : undefined

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
      semanticCallModel: semanticCallModel,
      readContextDeps: { connector: spy.connector, sources: ['aroma_system'] }
    })
  } finally {
    console.log = orig
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
  const tr = lines.filter(function (l) { return l.indexOf('[AROMA-TURN-ROUTE]') >= 0 }).pop()
  const route = tr ? JSON.parse(tr.slice(tr.indexOf('{'))) : {}
  const o1 = lines.filter(function (l) { return l.indexOf('[AROMA-O1-SEMANTIC]') >= 0 }).pop()
  const sem = o1 ? JSON.parse(o1.slice(o1.indexOf('{'))) : {}
  const reasoning = lines.filter(function (l) { return l.indexOf('[AROMA-REASONING]') >= 0 })
  return { result: result, seen: seen, calls: spy.calls, route: route, sem: sem, reasoning: reasoning, lines: lines }
}

const HI = function (i) { return { intent: i, confidence: 'HIGH' } }
const NONE_LOW = { intent: 'NONE', confidence: 'LOW' }

test('*** CLARIFY IS TERMINAL TO READS, WITH AN ADAPTER DEMANDING ONE ***', async () => {
  const r = await turn('有咩貨唔夠要入返？', [HI('order_planning'), HI('order_planning')])

  assert.equal(r.seen.semanticCalls, 2, 'two independent classifications')
  assert.equal(r.sem.clarify, true, 'the semantic decision must be CLARIFY')
  assert.equal(r.sem.consensus, false)

  // The pressure was genuinely present, otherwise the zero below is worthless.
  assert.equal(r.seen.readRequestOffered, true, 'the adversarial adapter never got to ask; the test proves nothing')

  assert.deepEqual(r.calls, [], 'a clarified turn performed a business read: ' + JSON.stringify(r.calls))

  const reply = (r.result && (r.result.reply || r.result.replyForArchive)) || ''
  assert.ok(/定係|想睇/.test(reply), 'the clarification did not reach the Owner: ' + JSON.stringify(reply).slice(0, 160))
  assert.equal(/建議訂|訂量|安全存量/.test(reply), false, 'the Owner got a business answer instead: ' + reply.slice(0, 120))
})

test('*** the reasoning loop is not merely empty, it is never entered ***', async () => {
  const r = await turn('有咩貨唔夠要入返？', [HI('order_planning'), HI('order_planning')])
  const entered = r.reasoning.filter(function (l) { return /"reasoningEntered":true/.test(l) })
  assert.equal(entered.length, 0, 'the reasoning loop was entered under clarify')
})

test('*** CONTROL A — deterministic reads normally, adversarial adapter obeyed ***', async () => {
  const r = await turn('今日邊啲貨要補？', [HI('order_planning')])
  assert.equal(r.seen.semanticCalls, 0, 'a deterministic win never reaches the classifier')
  assert.ok(r.calls.indexOf('aroma_system.listOrderPlanning') >= 0,
    'the deterministic read stopped working: ' + JSON.stringify(r.calls))
})

test('*** CONTROL B — semantic AUTO_READ stands, and does NOT become terminal-clarify ***', async () => {
  const r = await turn('叫咗嘅貨到咗未？', [HI('purchase_order'), HI('purchase_order')])
  assert.equal(r.seen.semanticCalls, 2)
  assert.equal(r.seen.preConsensusReads, 0)
  assert.equal(r.sem.consensus, true, 'consensus must stand')
  assert.equal(r.sem.clarify, false, 'terminal-clarify leaked onto AUTO_READ')
  assert.equal(r.sem.serverOperation, 'aroma_system.purchasing', 'the server binding must still be made')
  assert.equal(r.route.route, 'BUSINESS_QUERY')
  assert.deepEqual(r.route.routerSources, ['aroma_system'])

  // ⛔ WHAT THIS DELIBERATELY DOES NOT ASSERT, AND WHY.
  //
  // Under production flags (A4_KNOWLEDGE_ROUTING on) the DIRECTED automatic read does not
  // fire: the binding is computed and A4 owns the read decision from there. Measured:
  //   A4=off, neutral adapter -> listPurchaseOrders
  //   A4=on,  neutral adapter -> no read at all
  //   A4=on,  adversarial     -> whatever the model asked for, within the authorised source
  // So the semantic layer's contribution in production is the route upgrade and the source
  // authorisation, not the directed method. Asserting listPurchaseOrders here would be
  // asserting behaviour that only exists with A4 off — the same blindness this file was
  // written to remove. The read that does happen must still stay inside the authorised source.
  for (const c of r.calls) {
    assert.ok(c.indexOf('aroma_system.') === 0, 'a read escaped the authorised source: ' + c)
  }
})

test('*** CONTROL D — ABSTAIN keeps ordinary behaviour, A3 is NOT globally suppressed ***', async () => {
  const r = await turn('聽日搞乜？', [NONE_LOW, NONE_LOW])
  assert.equal(r.seen.semanticCalls, 2)
  assert.equal(r.sem.clarify, false, 'an abstention became a terminal clarify')
  assert.equal(r.seen.readRequestOffered, true, 'the adapter still got to ask')
})

/**
 * ⛔ REAL OBLIGATION PRESSURE — WITHOUT THIS, THE TERMINAL GATE IS NOT LOAD-BEARING.
 *
 * The mutation suite proved it: with only an adversarial nextRead in play, removing the terminal
 * state changed nothing, because clearing nextRead alone already blocked the loop. Production did
 * not fail that way — it failed through an entrance computed INDEPENDENTLY of nextRead. So the
 * pressure has to be real here too, and it is injected the same way recoveryWorkerEgressFence
 * injects it: a resolver that declares a public world is required.
 */
async function turnWithObligation (message, semanticPairs) {
  const seen = { semanticCalls: 0, readRequestOffered: false }
  const spy = spyConnector([{ sourceId: '1', title: 'X' }])
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
      semanticCallModel: async () => {
        seen.semanticCalls++
        return JSON.stringify(semanticPairs[Math.min(n++, semanticPairs.length - 1)])
      },
      readContextDeps: {
        connector: spy.connector,
        sources: ['aroma_system'],
        // forces decideWorldAsk toward an obligation, exactly as the egress-fence suite does
        sourceIntentResolver: async () => ({ intent: 'public' })
      }
    })
  } finally {
    console.log = orig
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
  const reasoning = lines.filter(function (l) { return l.indexOf('[AROMA-REASONING]') >= 0 })
  const o1 = lines.filter(function (l) { return l.indexOf('[AROMA-O1-SEMANTIC]') >= 0 }).pop()
  return { result: result, seen: seen, calls: spy.calls, reasoning: reasoning, sem: o1 ? JSON.parse(o1.slice(o1.indexOf('{'))) : {} }
}

test('*** EARN THE ZERO — obligation pressure genuinely opens the loop when clarify is absent ***', async () => {
  // Control for the test below. With no semantic clarify, the injected obligation must actually
  // drive the reasoning loop; otherwise the next test proves nothing.
  const r = await turnWithObligation('聽日搞乜？', [NONE_LOW, NONE_LOW])
  assert.equal(r.sem.clarify, false, 'this control must not be a clarify')
  const entered = r.reasoning.filter(function (l) { return /"reasoningEntered":true/.test(l) })
  assert.ok(entered.length > 0 || r.calls.length > 0,
    'the injected obligation produced no loop entry, so the terminal test would be vacuous')
})

test('*** CLARIFY CLOSES THE OBLIGATION ENTRANCE TOO ***', async () => {
  const r = await turnWithObligation('有咩貨唔夠要入返？', [HI('order_planning'), HI('order_planning')])
  assert.equal(r.sem.clarify, true, 'the semantic decision must be CLARIFY')
  const entered = r.reasoning.filter(function (l) { return /"reasoningEntered":true/.test(l) })
  assert.equal(entered.length, 0, 'the reasoning loop was entered under clarify via the obligation path')
  assert.deepEqual(r.calls, [], 'a clarified turn read through the obligation path: ' + JSON.stringify(r.calls))
  const reply = (r.result && (r.result.reply || r.result.replyForArchive)) || ''
  assert.ok(/定係|想睇/.test(reply), 'the clarification did not reach the Owner')
})
