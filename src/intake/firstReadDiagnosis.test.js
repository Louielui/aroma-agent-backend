'use strict'

/**
 * firstReadDiagnosis.test.js — WHERE the model-directed read actually stops.
 *
 * ⛔ DIAGNOSIS ONLY. This file changes nothing and fixes nothing. It exists because the WIP
 * commit said 「the model emits nextRead but the connector is never called. Cause NOT
 * identified」, and a cause that is not pinned by a test is a cause that gets re-guessed.
 *
 * ── THE STOPPING POINT, NAMED ────────────────────────────────────────────────
 * The reasoning model asks for `aroma_system`. buildReadContext then calls
 * planFor('aroma_system', { message: THE OWNER'S ORIGINAL MESSAGE }), and that branch ends in:
 *
 *     const method = aromaMethodFor(matchText)
 *     if (!method) return { notAsked: 'no business intent in the message' }
 *
 * 「你能看到 aroma system 嗎？」 expresses no Aroma business intent — it names the SYSTEM, not
 * stock, invoices, suppliers, counts, ordering or purchase orders — so `intentFor` returns null,
 * `aromaMethodFor` returns null, and fetchOne returns `{ skipped: true }` BEFORE connector.read()
 * is ever reached.
 *
 * So the model DID ask. The legacy AUTOMATIC-READ planner vetoed it, using a question the model
 * had already answered structurally.
 *
 * ⛔ AND THE notAsked RULE IS NOT THE DEFECT. It is what stops 「現在是幾點？」 from becoming an
 * inventory read. It stays. What is missing is the distinction between an AUTOMATIC read (the
 * planner picks the source AND the view from the message) and a MODEL-DIRECTED read (the view was
 * already chosen, structurally, and re-deriving it from the message throws that choice away).
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { planFor, aromaMethodFor, intentFor, buildReadContext } = require('../context/readContext')
const { processIntake } = require('./intakeService')

const NOW = '2026-08-08T12:00:00.000Z'
const OWNER_MESSAGE = '你能看到 aroma system 嗎？'

/* ═══ 1. THE PLANNER, IN ISOLATION ═════════════════════════════════════════ */

test('*** the Owner message carries no Aroma business intent — so aromaMethodFor is null ***', () => {
  assert.equal(intentFor(OWNER_MESSAGE), null, 'no intent in the table matches it')
  assert.equal(aromaMethodFor(OWNER_MESSAGE), null, 'and therefore no method')
})

test('*** ⛔ THE STOP: planFor returns notAsked, which is checked BEFORE any read ***', () => {
  const plan = planFor('aroma_system', { message: OWNER_MESSAGE, now: NOW })
  assert.equal(typeof plan.notAsked, 'string', 'this is the exact veto')
  assert.equal(plan.method, undefined, 'no method was produced, so there is nothing to read')
  assert.equal(plan.unavailable, undefined, 'and it is NOT an unavailability — nobody asked')
})

test('*** a message that DOES carry intent plans a read, so the planner itself works ***', () => {
  const plan = planFor('aroma_system', { message: '而家倉存入面有咩？', now: NOW })
  assert.equal(plan.method, 'listInventory')
  assert.equal(plan.notAsked, undefined)
})

/* ═══ 2. THE SAME STOP, THROUGH buildReadContext ═══════════════════════════ */

test('*** buildReadContext skips the source before connector.read() is called ***', async () => {
  const reads = []
  const connector = { async read (source, method) { reads.push({ source, method }); return { results: [] } } }
  const lines = []
  const rc = await buildReadContext({
    connector, message: OWNER_MESSAGE, sources: ['aroma_system'], now: NOW, logSink: (l) => lines.push(l)
  })
  assert.deepEqual(reads, [], '⛔ THE CONNECTOR WAS NEVER CALLED — this is the reported symptom')
  assert.equal(rc.block, null, 'so there is no observation to feed back to the model')
  assert.deepEqual(rc.perSource, [], 'and the source contributes no row at all')

  // The existing structural log already says exactly this, and has all along.
  const line = lines.find((l) => l && l.source === 'aroma_system')
  assert.ok(line, 'the skip IS logged — fail soft, never silent')
  assert.equal(line.trust, 'not_asked', '⛔ the named stopping point, in the existing telemetry')
})

/* ═══ 3. AND END-TO-END, WHERE IT WAS OBSERVED ═════════════════════════════ */

function fakeConnector () {
  const reads = []
  return {
    reads,
    connector: {
      async read (source) {
        reads.push(source)
        return {
          asOf: NOW,
          source,
          count: 1,
          results: [{ source, sourceId: 'X1', title: 'Row', entityType: 'inventory_item', content: 'id=X1', fields: { id: 'X1' }, trust: 'live', retrievedAt: NOW }],
          evidence: { source, trust: 'live', shownCount: 1, matchingTotal: 1, sourceTotal: null, completeness: 'complete', retrievedAt: NOW }
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
      calls.push({ schemaName: opts.responseFormat ? opts.responseFormat.name : null })
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error(label + ' called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { totalTokens: 2 }, model: label, latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const FLAGS = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off' }

async function withEnv (over, fn) {
  const all = Object.assign({}, FLAGS, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

test('*** the reasoning step reports ok:false, and the reason is the planner veto ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [
      { intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: { capability: 'aroma_system' } },
      { intent: 'question', mode: 'chat', reply: '我讀唔到。', nextRead: null, answerPlan: null }
    ])
    const events = []
    const realLog = console.log
    console.log = (...args) => {
      if (args[0] === '[AROMA-REASONING]') { try { events.push(JSON.parse(args[1])) } catch (_) {} }
    }
    try {
      await processIntake(OWNER_MESSAGE, a, [], {
        demo: true,
        interactionMode: 'chat',
        providerHint: 'claude',
        requestId: '11111111-2222-4333-8444-555555555555',
        readContextDeps: { connector: fc.connector, sources: ['aroma_system'] }
      })
    } finally { console.log = realLog }

    const readStep = events.find((e) => e && e.decisionType === 'read')
    assert.ok(readStep, 'the model DID make a read decision — the request was never the problem')
    assert.equal(readStep.capability, 'aroma_system')
    assert.equal(readStep.ok, false, '⛔ the read produced no observation')
    assert.deepEqual(fc.reads, [], '⛔ and the connector was never reached')
  })
})
