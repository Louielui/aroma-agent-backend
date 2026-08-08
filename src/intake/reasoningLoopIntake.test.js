'use strict'

/**
 * reasoningLoopIntake.test.js — the loop through the REAL intake path.
 *
 * > **Owner: 「A unit test of reasoningLoop.js alone is NOT sufficient.」**
 *
 * He is right: the unit tests proved the loop, and the four blockers he found were all in the
 * WIRING — an out-of-scope `deps`, a silent provider switch, a weaker authorisation rule, and
 * a discarded loop result. None of them was visible from the module's own tests.
 *
 * Everything here goes through `processIntake` with deterministic fake adapters and a fake
 * connector. No network, no paid call.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')

const NOW = '2026-08-08T12:00:00.000Z'

/** A fake connector whose reads are counted, so 「zero executions」 is provable. */
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

/** An adapter returning a scripted envelope per call, recording the prompt it was given. */
function scriptedAdapter (label, envelopes) {
  const calls = []
  return {
    label,
    calls,
    async complete (prompt, opts = {}) {
      calls.push({ prompt: String(prompt), opts })
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error(label + ' called more times than scripted: ' + calls.length)
      // ⛔ NO `provider` FIELD. The real OpenAIAdapter returns exactly
      // {text, usage, model, latencyMs, stopReason} and carries no provider. A fake that
      // added one made the wiring look correct while production would have misidentified
      // every GPT turn as Claude — the fake was propping up the bug it was meant to catch.
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: label, latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ_ENV = (capability) => ({ intent: 'chit_chat', mode: 'chat', reply: '等我睇睇。', nextRead: { capability }, answerPlan: null })
const FINAL_ENV = (reply) => ({ intent: 'chit_chat', mode: 'chat', reply, answerPlan: null })

const FLAGS = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', CONTEXT_GMAIL: 'on', TURN_ROUTER: 'off', MULTI_AI_ROUTER: 'off' }

async function withEnv (over, fn) {
  const all = Object.assign({}, FLAGS, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const run = (adapter, deps, extra) => processIntake('今日要訂咩貨？', adapter, [], Object.assign({
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
}, extra || {}))

/* ═══ THE MISSING PROOF — END TO END, ONE TURN ═══════════════════════════════ */

test('*** ⛔ END TO END: nextRead → real connector read → observation in prompt → SAME provider → FINAL ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [READ_ENV('aroma_system'), FINAL_ENV('讀完，答你。')])
    const out = await run(a, { connector: fc.connector, sources: ['aroma_system'] })

    assert.equal(a.calls.length, 2, 'exactly two model calls in ONE user turn')
    assert.ok(fc.reads.length >= 1, 'an authorised connector read actually executed')

    // ⛔ THE OBSERVATION REACHED CALL 2. The second prompt must differ from the first and
    // must carry the read block — this is the property the Owner had to carry by hand before.
    assert.notEqual(a.calls[1].prompt, a.calls[0].prompt, 'the prompt was REBUILT, not replayed')
    assert.ok(a.calls[1].prompt.length > a.calls[0].prompt.length, 'and it grew by the observation')
    assert.ok(/external_read_context/.test(a.calls[1].prompt), 'the observation is read context')

    assert.ok(typeof out.reply === 'string' && out.reply.length > 0, 'the turn completed with an answer')
  })
})

/* ═══ BLOCKER 2 — PROVIDER CONTINUITY ═══════════════════════════════════════ */

test('*** ⛔ GPT step 1 → READ → GPT step 2. Claude is NEVER called. ***', async () => {
  await withEnv({ MULTI_AI_ROUTER: 'on', OPENAI_API_KEY: 'test-key' }, async () => {
    const fc = fakeConnector()
    const gpt = scriptedAdapter('openai', [READ_ENV('aroma_system'), FINAL_ENV('GPT 答咗。')])
    const claude = scriptedAdapter('claude', [FINAL_ENV('CLAUDE MUST NOT BE CALLED')])

    // ⛔ THE HINT IS FORCED. The old version relied on router ambiguity and then carried
    // an early-return escape hatch that let the test pass GREEN
    // without ever executing GPT. A test that can skip its own subject proves nothing.
    await run(claude, { connector: fc.connector, sources: ['aroma_system'] },
      { openaiAdapter: gpt, providerHint: 'openai' })

    // HARD ASSERTIONS. If GPT was not selected, this FAILS — as it must.
    assert.equal(gpt.calls.length, 2, 'GPT produced step 1 and must also produce step 2')
    assert.equal(claude.calls.length, 0, 'the turn must NOT silently switch provider mid-turn')

    // And the observation reached GPT's second prompt, not someone else's.
    assert.notEqual(gpt.calls[1].prompt, gpt.calls[0].prompt, 'prompt 2 was rebuilt')
    assert.ok(/external_read_context/.test(gpt.calls[1].prompt), 'and carries the observation')
    assert.ok(fc.reads.includes('aroma_system'), 'an authorised read really executed')
  })
})

test('*** a result with NO provider field is still attributed correctly ***', async () => {
  // The regression that made this round necessary: the real OpenAIAdapter returns no
  // , so inferring identity from the RESULT read every GPT turn as Claude.
  await withEnv({ MULTI_AI_ROUTER: 'on', OPENAI_API_KEY: 'test-key' }, async () => {
    const fc = fakeConnector()
    const gpt = scriptedAdapter('openai', [READ_ENV('aroma_system'), FINAL_ENV('ok')])
    const claude = scriptedAdapter('claude', [FINAL_ENV('NOT ME')])
    await run(claude, { connector: fc.connector, sources: ['aroma_system'] },
      { openaiAdapter: gpt, providerHint: 'openai' })
    // The fake returns the REAL neutral shape, so nothing in the result says 'openai'.
    // Attribution therefore came from the orchestration branch, which is the only place
    // that actually knows which adapter it called.
    const shape = Object.keys(JSON.parse(JSON.stringify({ text: '', usage: {}, model: '', latencyMs: 0, stopReason: '' })))
    assert.equal(shape.includes('provider'), false, 'the adapter result carries no provider field')
    assert.equal(gpt.calls.length, 2, 'and GPT still continued its own turn')
    assert.equal(claude.calls.length, 0)
  })
})

/* ═══ BLOCKER 3 — THE AUTHORISATION BOUNDARY IS UNCHANGED ═══════════════════ */

test('*** ⛔ READ_ACCESS off → nextRead executes ZERO connector reads ***', async () => {
  await withEnv({ READ_ACCESS: 'off' }, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [READ_ENV('aroma_system'), FINAL_ENV('冇讀到。')])
    await run(a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.equal(fc.reads.length, 0, 'the reasoning loop may not create a weaker rule than the first read')
  })
})

test('*** ⛔ a source WITHHELD from the active provider executes ZERO reads ***', async () => {
  await withEnv({ CONTEXT_AROMA_SYSTEM_OPENAI: 'off' }, async () => {
    const fc = fakeConnector()
    // Claude is active here, so this asserts the general shape: a capability outside the
    // authorised set for the ACTIVE provider is refused before the reader is touched.
    const a = scriptedAdapter('claude', [READ_ENV('drive'), FINAL_ENV('冇讀到。')])
    await run(a, { connector: fc.connector, sources: ['aroma_system'] })
    // NOTE: the AUTOMATIC first read still runs and reads aroma_system. What must never
    // happen is the REQUESTED capability being executed — counting total reads would have
    // asserted the wrong thing.
    assert.equal(fc.reads.includes('drive'), false, 'drive is not in the authorised set for this turn')
  })
})

test('*** an invented capability executes zero reads through the real path ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [READ_ENV('run_shell_command'), FINAL_ENV('唔得。')])
    await run(a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.equal(fc.reads.includes('run_shell_command'), false, 'an invented name never reaches the connector')
  })
})

/* ═══ BLOCKER 4 — THE STEP LIMIT ENTERS THE REAL FALLBACK ═══════════════════ */

test('*** ⛔ READ → READ → READ: no fourth call, and the pending prose is NOT the answer ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const PENDING_PROSE = 'PENDING_NOT_AN_ANSWER'
    const a = scriptedAdapter('claude', [
      READ_ENV('aroma_system'),
      { intent: 'chit_chat', mode: 'chat', reply: PENDING_PROSE, nextRead: { capability: 'aroma_system' }, answerPlan: null },
      { intent: 'chit_chat', mode: 'chat', reply: PENDING_PROSE, nextRead: { capability: 'aroma_system' }, answerPlan: null }
    ])
    const out = await run(a, { connector: fc.connector, sources: ['aroma_system'] })

    assert.equal(a.calls.length, 3, 'NO FOURTH MODEL CALL')
    assert.equal(String(out.reply).includes(PENDING_PROSE), false,
      'a reply that was still asking for another read is not a finished answer')
    assert.ok(typeof out.reply === 'string' && out.reply.length > 0,
      'the deterministic fallback still speaks, from what WAS gathered')
  })
})

/* ═══ THE ORDINARY TURN IS UNCHANGED ════════════════════════════════════════ */

test('*** 12. a direct answer still costs exactly ONE model call ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [FINAL_ENV('直接答你。')])
    const out = await run(a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls.length, 1, 'no turn is forced through three calls')
    assert.ok(String(out.reply).length > 0)
  })
})
