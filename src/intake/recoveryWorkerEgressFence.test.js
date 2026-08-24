'use strict'

/**
 * recoveryWorkerEgressFence.test.js — THE ACTUAL DEFECT, REPRODUCED AND CLOSED.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS IS THE ONE THAT COST MONEY.
 *
 * Canonical `node --test`, run from a developer shell carrying ANTHROPIC_API_KEY: ~41 live
 * `claude-haiku-4-5-20251001` calls per run, and 7–8 A4 outcomes that came out differently
 * from the same source. Removing the key restored the expected result. **The credential was a
 * behavioural input to the test suite.**
 *
 * The shape, exactly — `intakeService.js`:
 *
 *     terminalRefusals[missing] >= 2  &&  !workerUsed[missing]
 *       → runRecoveryWorker({ decide: (readDeps && readDeps.recoveryWorker) || defaultRecoveryWorker })
 *       → new ClaudeAdapter({ model: RECOVERY_WORKER_MODEL })   // model PINNED, so CLAUDE_MODEL
 *       → axios.post('https://api.anthropic.com/v1/messages')   // being unset did NOT stop it
 *
 * 57 sites inject a `finalVerifier` and no `recoveryWorker`. This fixture is one of them,
 * written the way they are written — DELIBERATELY. It does not inject a worker, because the
 * property under test is that NOT injecting one is now SAFE rather than expensive.
 *
 * ⛔ AND THE DIFFERENCE WAS SILENT, WHICH IS WHY THE MARKER IS ASSERTED HERE.
 * `runRecoveryWorker` catches whatever `decide` throws and returns `failed` — deliberately, so
 * an upstream error cannot carry the prompt back with it. The no-key run and the with-key run
 * therefore differed in behaviour and agreed in appearance. A fence that only threw would
 * restore the right ANSWER and keep the wrong SILENCE.
 *
 * ── CONTAINMENT: WHY THIS FILE CANNOT REACH A VENDOR ────────────────────────
 * The credential below is a synthetic string, not a key. The turn is driven by a scripted
 * adapter and a fake connector. And the first assertion in the fixture is a PRECONDITION —
 * `liveEgressAllowed() === false` — so if the fence were ever weakened, this test fails
 * BEFORE the intake turn runs rather than by making the call it exists to forbid.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')
const { liveEgressAllowed, BLOCKED_MARKER, PAID_OPT_IN } = require('../adapters/liveEgressFence')

const NOW = '2026-08-09T00:00:00.000Z'
const PUB = 'public_knowledge.search'
const BOTH = ['aroma_system', 'public_knowledge']

/** ⛔ A STRING, NOT A KEY. It never leaves this process; the fence stops the call above it. */
const SYNTHETIC_CREDENTIAL = 'synthetic-credential-not-a-real-key'

/* ═══ FIXTURES — the same shapes a4TerminalObligation.test.js uses ═════ */

function twoWorldConnector () {
  const internalReads = []; const publicReads = []
  return {
    internalReads,
    publicReads,
    connector: {
      async read (source, method, params) {
        const bucket = source === 'public_knowledge' ? publicReads : internalReads
        bucket.push({ method, params: JSON.parse(JSON.stringify(params || {})) })
        const rows = [{ source, sourceId: 'X-1', title: 'row', entityType: 'public_item', content: 'v=1', fields: { id: 'X-1' }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }]
        return { asOf: NOW, source, count: 1, results: rows, evidence: { source, endpoint: method, entityType: 'public_item', rowShape: { hasLocation: false, hasAsOf: true, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE' } }
      }
    }
  }
}

/** The main brain, scripted to REFUSE — which is what summons the recovery worker. */
function refusingAdapter (times) {
  const calls = []
  return {
    label: 'claude',
    calls,
    async complete () {
      calls.push(1)
      if (calls.length > times) throw new Error('adapter called more times than scripted: ' + calls.length)
      return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: '照舊答。', nextRead: null, answerPlan: null }), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'scripted', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const finalSpy = (decision) => {
  const fn = async () => ({ decision, question: null })
  fn.decision = decision
  return fn
}

const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on', [A4_AMBIGUITY_FLAG]: 'on' }

async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally { for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
}

/** Capture console.error, restoring it even if the turn throws. */
async function captureStderr (fn) {
  const lines = []
  const real = console.error
  console.error = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
  try { return { value: await fn(), lines } } catch (e) { return { error: e, lines } } finally { console.error = real }
}

/**
 * ⛔ DELIBERATELY NO `recoveryWorker`. That omission IS the fixture.
 * The intent is derived from the verifier's decision, exactly as the A4 suites do it.
 */
const DEPS = (c, decision) => ({
  connector: c.connector,
  sources: BOTH,
  publicQueryPlanner: async () => ({ query: 'wholesale market price trend', freshness: 'current', location: null }),
  sourceIntentResolver: async () => ({ intent: 'public' }),
  finalVerifier: finalSpy(decision)
})

const run = (msg, adapter, deps) => processIntake(msg, adapter, [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
})

/* ═══ THE REGRESSION ══════════════════════════════════════════════════ */

test('*** the recovery worker CANNOT reach Anthropic just because a credential exists ***', async () => {
  await withEnv({ ANTHROPIC_API_KEY: SYNTHETIC_CREDENTIAL, [PAID_OPT_IN]: null, CLAUDE_MODEL: null }, async () => {
    // ⛔ PRECONDITION, NOT DECORATION. If the fence is ever weakened, this file must fail HERE
    // — before the turn — rather than by originating the call it exists to forbid.
    assert.equal(liveEgressAllowed(), false, '⛔ this file must never be able to reach a vendor')

    const c = twoWorldConnector()
    const { error, lines, value: out } = await captureStderr(() =>
      run('市場價點', refusingAdapter(4), DEPS(c, 'require_public')))

    assert.equal(error, undefined, 'the turn must complete — a blocked call is not a broken turn')
    assert.ok(out && typeof out === 'object')

    // ⛔ THE HEADLINE: the worker asked, the fence refused, and NOTHING LEFT THE MACHINE.
    const blocked = lines.filter((l) => l.includes(BLOCKED_MARKER))
    assert.equal(blocked.length, 1, '⛔ exactly one blocked-egress marker — the worker is invoked once per obligation')
    assert.ok(blocked[0].includes('anthropic'), 'the marker names the provider')
    assert.ok(blocked[0].includes('api.anthropic.com'), 'and the host it was going to')

    // ⛔ AND NO READ WAS MANUFACTURED. The blocked worker routed nothing, so the public world
    // stays missing — the SAME fail-closed outcome the no-key canonical run already produced.
    assert.equal(c.publicReads.length, 0, '⛔ a refused worker must not produce a read')
  })
})

test('*** the marker carries no key, no prompt, no Owner message ***', async () => {
  await withEnv({ ANTHROPIC_API_KEY: SYNTHETIC_CREDENTIAL, [PAID_OPT_IN]: null, CLAUDE_MODEL: null }, async () => {
    assert.equal(liveEgressAllowed(), false)
    const c = twoWorldConnector()
    const { lines } = await captureStderr(() => run('市場價點', refusingAdapter(4), DEPS(c, 'require_public')))
    const blocked = lines.filter((l) => l.includes(BLOCKED_MARKER)).join('\n')
    for (const forbidden of [SYNTHETIC_CREDENTIAL, '市場價點', 'x-api-key', '/v1/messages']) {
      assert.equal(blocked.includes(forbidden), false, '⛔ «' + forbidden + '» reached the marker')
    }
  })
})

test('*** and with NO credential at all the turn behaves identically — the key changes nothing ***', async () => {
  const shape = async (over) => {
    const c = twoWorldConnector()
    let out
    await withEnv(Object.assign({ [PAID_OPT_IN]: null, CLAUDE_MODEL: null }, over), async () => {
      const r = await captureStderr(() => run('市場價點', refusingAdapter(4), DEPS(c, 'require_public')))
      out = r.value
    })
    return { publicReads: c.publicReads.length, reply: out && out.reply, mode: out && out.mode }
  }
  // ⛔ THE PROPERTY THE WHOLE TRANCHE EXISTS FOR, STATED AS ONE ASSERTION: the presence of a
  // provider credential must not change what an automated test observes.
  assert.deepEqual(
    await shape({ ANTHROPIC_API_KEY: SYNTHETIC_CREDENTIAL }),
    await shape({ ANTHROPIC_API_KEY: null }),
    '⛔ a credential in the environment changed the outcome of an automated test')
})
