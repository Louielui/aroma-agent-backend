'use strict'

/**
 * firstReadInitiation.test.js — the loop must be able to START a read, not only extend one.
 *
 * > **Owner, in the real UI, 香香（GPT）: 「你能看到 aroma system 嗎？」**
 * > **Aroma answered that it could not verify whether Aroma System was accessible.**
 *
 * It could. The connector was authorised and working. `answerPlanFormat()` returned
 * `undefined` on a zero-row turn, so NO schema was sent, so `nextRead` was never offered —
 * the model had no structural way to ask. The loop could extend a read and never initiate one.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')

const NOW = '2026-08-08T12:00:00.000Z'

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

/** Records the SCHEMA each call was shown — the decision surface, never the prompt. */
function scriptedAdapter (label, envelopes) {
  const calls = []
  return {
    label,
    calls,
    async complete (prompt, opts = {}) {
      const nr = opts.responseFormat && opts.responseFormat.schema &&
        opts.responseFormat.schema.properties && opts.responseFormat.schema.properties.nextRead
      calls.push({
        schemaName: opts.responseFormat ? opts.responseFormat.name : null,
        readChoices: nr && nr.properties ? nr.properties.capability.enum : (nr ? 'null-only' : 'no-schema'),
        promptChars: String(prompt).length
      })
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error(label + ' called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { totalTokens: 2 }, model: label, latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ = (capability) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: { capability } })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })

const FLAGS = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off' }

async function withEnv (over, fn) {
  const all = Object.assign({}, FLAGS, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const run = (msg, adapter, deps, extra) => processIntake(msg, adapter, [], Object.assign({
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
}, extra || {}))

/* ═══ THE EXACT OWNER FAILURE ═══════════════════════════════════════════════ */

test('*** 你能看到 aroma system 嗎 — zero rows, and the model can still ASK ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const gpt = scriptedAdapter('openai', [READ('aroma_system'), FINAL('可以，我頭先讀咗。')])
    const claude = scriptedAdapter('claude', [FINAL('CLAUDE MUST NOT BE CALLED')])
    // MULTI_AI_ROUTER on: production never injects a GPT adapter with the router off, and
    // with it off the schema is built for Claude while the loop runs as OpenAI.
    process.env.MULTI_AI_ROUTER = 'on'
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key'
    const out = await run('你能看到 aroma system 嗎？', claude, { connector: fc.connector, sources: ['aroma_system'] },
      { openaiAdapter: gpt, providerHint: 'openai' })

    // 1. the FIRST call — before any row exists — was shown the choice
    assert.deepEqual(gpt.calls[0].readChoices, ['aroma_system'],
      'the decision surface must exist on a zero-read turn; this is the whole defect')
    assert.equal(gpt.calls[0].schemaName, 'distill_with_read_decision',
      'and it is the DECISION schema — no answerPlan is forced before evidence exists')

    // 2-4. it asked, the connector really ran, the observation reached call 2
    assert.ok(fc.reads.includes('aroma_system'), 'the connector was actually called')
    assert.equal(gpt.calls.length, 2, 'exactly two model calls')
    assert.ok(gpt.calls[1].promptChars > gpt.calls[0].promptChars, 'call 2 grew by the observation')
    assert.equal(gpt.calls[1].readChoices, 'null-only', 'aroma_system is no longer offered')

    // 5-6. same provider, no fallback, and an answer came back
    assert.equal(claude.calls.length, 0, 'the turn must not switch provider')
    assert.ok(typeof out.reply === 'string' && out.reply.length > 0)
  })
})

/* ═══ AN ORDINARY GREETING MUST NOT BE PUSHED THROUGH A READ ════════════════ */

test('*** 你好 — the model may answer directly: ONE call, ZERO reads ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [FINAL('你好！')])
    await run('你好', a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls.length, 1, 'no turn is forced through a read')
    assert.equal(fc.reads.length, 0, 'and nothing was read')
    assert.deepEqual(a.calls[0].readChoices, ['aroma_system'], 'offered; declining it is the model decision')
  })
})

/* ═══ THE AUTHORISATION BOUNDARY IS UNCHANGED ═══════════════════════════════ */

test('*** READ_ACCESS off → no read choices exposed at all ***', async () => {
  await withEnv({ READ_ACCESS: 'off' }, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [FINAL('冇讀到。')])
    await run('你能看到 aroma system 嗎？', a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls[0].readChoices, 'no-schema', 'nothing readable means nothing offered')
    assert.equal(fc.reads.length, 0)
  })
})

test('*** a source not authorised this turn is never exposed ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [FINAL('ok')])
    await run('你能看到咩？', a, { connector: fc.connector, sources: ['aroma_system'] })
    const choices = a.calls[0].readChoices
    assert.equal(Array.isArray(choices) && choices.includes('drive'), false, 'drive was never authorised this turn')
  })
})

test('*** the proposal lane is unchanged — no decision schema there ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [{ intent: 'task', mode: 'chat', reply: 'ok', nextRead: null }])
    await processIntake('幫我改 docs/x.md', a, [], {
      demo: true, interactionMode: 'proposal', requestId: '11111111-2222-4333-8444-555555555555',
      readContextDeps: { connector: fc.connector, sources: ['aroma_system'] }
    })
    assert.equal(a.calls[0].readChoices, 'no-schema', 'chat lane only')
  })
})
