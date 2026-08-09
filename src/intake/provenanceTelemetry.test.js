'use strict'

/**
 * provenanceTelemetry.test.js — model/provider provenance, and the external-read-context
 * signal, as produced by the REAL pipeline (Owner decision, 2026-08-02).
 *
 * WHY THIS FILE EXISTS. The first archived conversation recorded `model: null`, because
 * `telemetry.model` was never assigned anywhere in the codebase — the archive was faithfully
 * writing down a value nothing produced. The Owner's instruction was that provenance must come
 * from the real routing/adapter result, must not be null and must not be guessed. A test on the
 * archive alone cannot show that: the archive is only as truthful as what it is handed.
 *
 * So everything here goes through processIntake with fake ADAPTERS (no paid call) and asserts on
 * the telemetry object the router later reads. The adapters return DIFFERENT model ids, so
 * "the right model" is a claim that can fail — one adapter would make any id look correct.
 *
 * The same applies to readContextUsed: it is asserted from the provider that actually answered,
 * including on the fallback path, because that is the case a flag-based guess gets wrong.
 */

const test = require('node:test')
const assert = require('node:assert')

const { processIntake } = require('./intakeService')

const CHAT = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '好' })

/** An adapter that answers, reporting the model id it was built with. */
function adapterReturning (modelId) {
  const seen = []
  return {
    seen,
    async complete (prompt, opts) {
      seen.push({ prompt })
      return { text: CHAT, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, model: modelId, latencyMs: 3 }
    }
  }
}

/** An adapter that fails, to force the one-shot fallback. */
function failingAdapter () {
  return { async complete () { throw new Error('provider down') } }
}

function readDeps (sources = ['gmail']) {
  return {
    sources,
    connector: {
      async read (source) {
        return {
          asOf: '2026-08-02', source, count: 1,
          results: [{
            source, sourceId: source + '1', title: 'SENTINEL_' + source.toUpperCase(),
            retrievedAt: '2026-08-02', originalDate: '2026-08-01',
            content: 'SENTINEL_CONTENT_' + source.toUpperCase(), link: 'l', trust: 'live', error: null
          }]
        }
      }
    }
  }
}

const READ_ON = { A4_KNOWLEDGE_ROUTING: 'off', READ_ACCESS: 'on', CONTEXT_GMAIL: 'on', DECISION_RECALL: 'off', MULTI_AI_ROUTER: 'off' }
const READ_OFF = { READ_ACCESS: 'off', CONTEXT_GMAIL: 'off', DECISION_RECALL: 'off', MULTI_AI_ROUTER: 'off' }

async function withEnv (vars, fn) {
  const saved = {}
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

/* ── model / provider provenance ──────────────────────────────────────────── */

test('*** model comes from the ADAPTER RESULT, not from null and not from a guess ***', async () => {
  await withEnv(READ_OFF, async () => {
    const telemetry = {}
    const claude = adapterReturning('claude-haiku-4-5-20251001')
    await processIntake('早晨', claude, [], { demo: true, interactionMode: 'chat', providerHint: 'claude', telemetry })

    assert.equal(telemetry.provider, 'claude')
    assert.equal(telemetry.model, 'claude-haiku-4-5-20251001')
    assert.notEqual(telemetry.model, null)
  })
})

test('*** a DIFFERENT model id produces a different record — the value is read, not assumed ***', async () => {
  await withEnv(READ_OFF, async () => {
    const telemetry = {}
    await processIntake('早晨', adapterReturning('claude-sonnet-5-some-other-build'), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude', telemetry
    })
    assert.equal(telemetry.model, 'claude-sonnet-5-some-other-build')
  })
})

test('*** on a GPT turn, provenance is GPT\'s own model id ***', async () => {
  await withEnv(Object.assign({}, READ_OFF, { MULTI_AI_ROUTER: 'on' }), async () => {
    const telemetry = {}
    const gpt = adapterReturning('gpt-test-model')
    const claude = adapterReturning('claude-haiku-4-5-20251001')
    await processIntake('早晨', claude, [], {
      demo: true, interactionMode: 'chat', providerHint: 'openai', openaiAdapter: gpt, telemetry
    })
    assert.equal(telemetry.provider, 'openai')
    assert.equal(telemetry.model, 'gpt-test-model')
  })
})

test('*** after a fallback, provenance names the provider that ACTUALLY answered ***', async () => {
  await withEnv(Object.assign({}, READ_OFF, { MULTI_AI_ROUTER: 'on' }), async () => {
    const telemetry = {}
    const claude = adapterReturning('claude-haiku-4-5-20251001')
    await processIntake('早晨', claude, [], {
      demo: true, interactionMode: 'chat', providerHint: 'openai', openaiAdapter: failingAdapter(), telemetry
    })
    // GPT was attempted and failed; Claude produced the reply that was returned.
    assert.equal(telemetry.provider, 'claude')
    assert.equal(telemetry.model, 'claude-haiku-4-5-20251001')
    assert.equal(telemetry.fallbackUsed, true)
  })
})

/* ── the external-read-context signal ─────────────────────────────────────── */

test('*** read context actually injected → readContextUsed true, with source KINDS ***', async () => {
  await withEnv(READ_ON, async () => {
    const telemetry = {}
    const claude = adapterReturning('claude-haiku-4-5-20251001')
    await processIntake('睇下我封郵件', claude, [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: readDeps(['gmail']), telemetry
    })

    // the block really was in the prompt — this is what the signal claims
    assert.ok(claude.seen[0].prompt.includes('SENTINEL_GMAIL'), 'precondition: the block was injected')
    assert.equal(telemetry.readContextUsed, true)
    assert.deepEqual(telemetry.readContextSources, ['gmail'])
  })
})

test('*** READ_ACCESS off → readContextUsed is FALSE, so the reply is storable ***', async () => {
  await withEnv(READ_OFF, async () => {
    const telemetry = {}
    const claude = adapterReturning('claude-haiku-4-5-20251001')
    await processIntake('早晨', claude, [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: readDeps(['gmail']), telemetry
    })
    assert.equal(claude.seen[0].prompt.includes('SENTINEL_GMAIL'), false)
    assert.equal(telemetry.readContextUsed, false)
    assert.deepEqual(telemetry.readContextSources, [])
  })
})

test('*** the signal is a real BOOLEAN on every answered turn, never left undefined ***', async () => {
  // The archive fails SAFE on undefined, so an always-undefined signal would silently omit every
  // reply forever. Both directions must therefore be genuinely reported.
  for (const env of [READ_ON, READ_OFF]) {
    await withEnv(env, async () => {
      const telemetry = {}
      await processIntake('早晨', adapterReturning('m'), [], {
        demo: true, interactionMode: 'chat', providerHint: 'claude',
        readContextDeps: readDeps(['gmail']), telemetry
      })
      assert.equal(typeof telemetry.readContextUsed, 'boolean')
      assert.ok(Array.isArray(telemetry.readContextSources))
    })
  }
})

test('*** a fallback to Claude with context reports TRUE — the case a flag guess gets wrong ***', async () => {
  await withEnv(Object.assign({}, READ_ON, { MULTI_AI_ROUTER: 'on' }), async () => {
    const telemetry = {}
    const claude = adapterReturning('claude-haiku-4-5-20251001')
    await processIntake('睇下我封郵件', claude, [], {
      demo: true, interactionMode: 'chat', providerHint: 'openai', openaiAdapter: failingAdapter(),
      readContextDeps: readDeps(['gmail']), telemetry
    })
    assert.ok(claude.seen[0].prompt.includes('SENTINEL_GMAIL'), 'Claude answered WITH the block')
    assert.equal(telemetry.provider, 'claude')
    assert.equal(telemetry.readContextUsed, true)
    assert.deepEqual(telemetry.readContextSources, ['gmail'])
  })
})

test('*** the signal carries no retrieved content — kinds only ***', async () => {
  await withEnv(READ_ON, async () => {
    const telemetry = {}
    await processIntake('睇下我封郵件', adapterReturning('m'), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: readDeps(['gmail']), telemetry
    })
    const serialized = JSON.stringify(telemetry)
    assert.equal(serialized.includes('SENTINEL_GMAIL'), false, 'a title reached telemetry')
    assert.equal(serialized.includes('SENTINEL_CONTENT_GMAIL'), false, 'content reached telemetry')
    assert.equal(telemetry.readContextSources.every((s) => ['drive', 'gmail', 'calendar', 'github'].includes(s)), true)
  })
})
