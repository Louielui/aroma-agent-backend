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

/**
 * ⛔ WHAT AN UNDER-SPECIFIED REQUEST COSTS, END TO END.
 *
 * This originally asserted the observed symptom: the model asked for `aroma_system`, the loop
 * reported decisionType:'read' ok:false, and the connector count was zero.
 *
 * That exact turn is no longer reachable, and the reason IS the fix: `aroma_system` is not a
 * read operation any more, so a bare-source request is refused at the allowlist, out in the
 * open, instead of being silently vetoed downstream by a planner asking a question the model
 * had already answered. firstReadInitiation.test.js H3 pins that refusal.
 *
 * What this now pins is the half that MUST NOT CHANGE: on the AUTOMATIC path, a message with
 * no business intent still reads nothing at all.
 */
test('*** the AUTOMATIC read is still vetoed by notAsked, end to end ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [
      { intent: 'question', mode: 'chat', reply: '我需要知道你想睇邊一部分。', nextRead: null, answerPlan: null }
    ])
    const lines = []
    const realLog = console.log
    console.log = (...args) => {
      if (args[0] === '[AROMA-READ-SOURCE]') { try { lines.push(JSON.parse(args[1])) } catch (_) {} }
    }
    try {
      await processIntake(OWNER_MESSAGE, a, [], {
        demo: true,
        interactionMode: 'chat',
        providerHint: 'claude',
        requestId: '11111111-2222-4333-8444-555555555555',
        // forceSources bypasses the ROUTE narrowing, so the source really does reach the
        // planner and the veto under test is the planner's, not the router's.
        readContextDeps: { connector: fc.connector, sources: ['aroma_system'], forceSources: true }
      })
    } finally { console.log = realLog }

    assert.deepEqual(fc.reads, [], '⛔ no business intent, no automatic read — the rule that stays')
    const line = lines.find((l) => l && l.source === 'aroma_system')
    assert.ok(line, 'the skip is on the record')
    assert.equal(line.trust, 'not_asked', 'and it is not_asked — never a false read-failure claim')
  })
})
