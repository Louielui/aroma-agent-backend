'use strict'

/**
 * claudeModelGuard.test.js — ClaudeAdapter must never pick a model nobody chose.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEFECT, AND WHY IT STAYED INVISIBLE FOR SO LONG.
 *
 * The adapter resolved its model as:
 *
 *     config.model || process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022'
 *
 * That last model is RETIRED. Anthropic answers HTTP 404. But the resident launcher
 * (scripts/launcher/xiangxiang-body.ps1) sets CLAUDE_MODEL to a current build, so the live
 * service never reached the fallback — and nothing in the test suite did either.
 *
 * It surfaced the first time a process was started WITHOUT the launcher: the A4-3B Stage 1
 * viability gate, which failed 404 in 425ms before a single A4 call could be spent. That is the
 * dangerous shape of the bug. A fallback that only fires outside the one blessed startup path
 * does not look like a source defect when it fires; it looks like a provider outage.
 *
 * ⛔ SO MODEL CHOICE LEAVES TRANSPORT ENTIRELY. Explicit pin, then environment, then nothing.
 * ⛔ NOT ONE PAID CALL RUNS HERE — every case either injects a transport or asserts that
 *    transport is never reached.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { ClaudeAdapter } = require('./ClaudeAdapter')
const { RECOVERY_WORKER_MODEL } = require('../intake/a4Runtime')

const RETIRED = 'claude-3-5-haiku-20241022'
const PINNED = 'claude-haiku-4-5-20251001'
const KEY = 'test-key-never-real'

/** A transport that records every call and never touches a network. */
function spy (impl) {
  const calls = []
  const fn = async (url, body, cfg) => {
    calls.push({ url, model: body && body.model, body, headers: cfg && cfg.headers })
    return impl ? impl(url, body, cfg) : { data: { content: [{ type: 'text', text: 'ok' }], model: body.model, usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' } }
  }
  return { fn, calls }
}

async function withEnv (over, fn) {
  const saved = {}
  for (const k of Object.keys(over)) { saved[k] = process.env[k]; if (over[k] === null) delete process.env[k]; else process.env[k] = over[k] }
  try { return await fn() } finally { for (const k of Object.keys(over)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
}

/* ═══ A / B / C — THE RESOLUTION CHAIN ═════════════════════════════════ */

test('*** A — an explicit role pin WINS over the environment ***', async () => {
  // ⛔ THIS IS WHAT PROTECTS THE A4 RECOVERY WORKER. It constructs the adapter with its own
  // dated build; a CLAUDE_MODEL pointing somewhere else must not silently re-point a component
  // that was measured 40/40 on that exact model.
  await withEnv({ CLAUDE_MODEL: 'some-other-model', ANTHROPIC_API_KEY: KEY }, async () => {
    const t = spy()
    const a = new ClaudeAdapter({ model: PINNED, transport: t.fn })
    await a.complete('hi', { maxTokens: 8 })
    assert.equal(t.calls.length, 1)
    assert.equal(t.calls[0].model, PINNED, '⛔ the environment overrode an explicit role pin')
  })
})

test('*** B — no pin falls to CLAUDE_MODEL, and to nothing else ***', async () => {
  await withEnv({ CLAUDE_MODEL: PINNED, ANTHROPIC_API_KEY: KEY }, async () => {
    const t = spy()
    await new ClaudeAdapter({ transport: t.fn }).complete('hi', { maxTokens: 8 })
    assert.equal(t.calls[0].model, PINNED)
  })
  // Whitespace is not configuration.
  await withEnv({ CLAUDE_MODEL: '   ', ANTHROPIC_API_KEY: KEY }, async () => {
    const t = spy()
    await assert.rejects(() => new ClaudeAdapter({ transport: t.fn }).complete('hi'), /CLAUDE_MODEL is not set/)
    assert.equal(t.calls.length, 0)
  })
})

test('*** C / J — no model at all FAILS CLOSED, before any transport ***', async () => {
  await withEnv({ CLAUDE_MODEL: null, ANTHROPIC_API_KEY: KEY }, async () => {
    const t = spy()
    const a = new ClaudeAdapter({ transport: t.fn })
    await assert.rejects(() => a.complete('hi'), (e) => {
      assert.match(e.message, /ClaudeAdapter: CLAUDE_MODEL is not set/)
      // ⛔ THE MESSAGE NAMES THE VARIABLE, NEVER A VALUE — and never the key.
      assert.equal(e.message.includes(KEY), false)
      return true
    })
    assert.equal(t.calls.length, 0, '⛔ a request left the process with no model chosen')
    // ⛔ AND NOTHING WAS SUBSTITUTED.
    assert.equal(a._model, null)
  })
})

test('*** ⛔ the adapter NEVER invents a model, whatever is missing ***', async () => {
  for (const [label, env] of [
    ['no model, no key', { CLAUDE_MODEL: null, ANTHROPIC_API_KEY: null }],
    ['no model, key present', { CLAUDE_MODEL: null, ANTHROPIC_API_KEY: KEY }],
    ['empty model', { CLAUDE_MODEL: '', ANTHROPIC_API_KEY: KEY }]
  ]) {
    await withEnv(env, async () => {
      const t = spy()
      await assert.rejects(() => new ClaudeAdapter({ transport: t.fn }).complete('hi'), /is not set/, label)
      assert.equal(t.calls.length, 0, label + ': transport was reached')
    })
  }
})

test('*** I — the credential check is unchanged and still comes first ***', async () => {
  await withEnv({ CLAUDE_MODEL: PINNED, ANTHROPIC_API_KEY: null }, async () => {
    const t = spy()
    await assert.rejects(() => new ClaudeAdapter({ transport: t.fn }).complete('hi'), /ANTHROPIC_API_KEY is not set/)
    assert.equal(t.calls.length, 0)
  })
})

/* ═══ D / E / F — THE RETIRED STRING, THE LAUNCHER, THE ROLE PIN ═══════ */

test('*** D — the retired model exists nowhere in adapter CODE ***', () => {
  const raw = fs.readFileSync(path.resolve(__dirname, './ClaudeAdapter.js'), 'utf8')
  // Comments may describe the removal — that is the record of why. CODE may not contain it.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  assert.equal(code.includes(RETIRED), false, '⛔ the retired model is still selectable')
  assert.equal(/\|\|\s*['"]claude-/.test(code), false, '⛔ some other hardcoded model fallback appeared')
  // The resolution chain is exactly two sources and then nothing.
  assert.match(code, /pick\(config\.model\)\s*\|\|\s*pick\(process\.env\.CLAUDE_MODEL\)\s*\|\|\s*null/)
})

test('*** E — the launcher still pins a CURRENT model explicitly ***', () => {
  const launcher = fs.readFileSync(path.resolve(__dirname, '../../scripts/launcher/xiangxiang-body.ps1'), 'utf8')
  assert.match(launcher, new RegExp('\\$env:CLAUDE_MODEL\\s*=\\s*\'' + PINNED + '\''),
    '⛔ the resident path must keep choosing its model out loud')
  assert.equal(launcher.includes(RETIRED), false)
})

test('*** F — the A4 Recovery Worker pin is untouched by this repair ***', () => {
  assert.equal(RECOVERY_WORKER_MODEL, PINNED)
  const runtime = fs.readFileSync(path.resolve(__dirname, '../intake/a4Runtime.js'), 'utf8')
  assert.match(runtime, new RegExp("RECOVERY_WORKER_MODEL = '" + PINNED + "'"))
  // It constructs with an explicit model, which case A proves the environment cannot override.
  assert.match(runtime, /new \(require\('\.\.\/adapters\/ClaudeAdapter'\)\.ClaudeAdapter\)\(\{ model \}\)/)
})

/* ═══ G / H — NOTHING ELSE MOVED ═══════════════════════════════════════ */

test('*** H — the request shape for a configured model is unchanged, temperature included ***', async () => {
  await withEnv({ CLAUDE_MODEL: PINNED, ANTHROPIC_API_KEY: KEY }, async () => {
    const t = spy()
    await new ClaudeAdapter({ transport: t.fn }).complete('hi')
    const body = t.calls[0].body
    // ⛔ TEMPERATURE IS DELIBERATELY OUT OF SCOPE HERE. It is pinned by this test precisely so
    // that this repair cannot quietly become a second one; changing it belongs to the adapter
    // capability work, with its own decision behind it.
    assert.equal(body.temperature, 0.3)
    assert.equal(body.max_tokens, 1024)
    assert.equal(body.model, PINNED)
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }])
    // An explicit temperature still overrides, exactly as before.
    const t2 = spy()
    await new ClaudeAdapter({ transport: t2.fn }).complete('hi', { temperature: 0 })
    assert.equal(t2.calls[0].body.temperature, 0)
  })
})

test('*** G — structured output still reaches the provider unchanged ***', async () => {
  await withEnv({ CLAUDE_MODEL: PINNED, ANTHROPIC_API_KEY: KEY }, async () => {
    const schema = { type: 'object', properties: { intent: { type: 'string' } }, required: ['intent'], additionalProperties: false }
    const t = spy(async (url, body) => ({
      data: { content: [{ type: 'text', text: '{"intent":"internal"}' }], model: body.model, usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
    }))
    const r = await new ClaudeAdapter({ transport: t.fn }).complete('hi', {
      responseFormat: { type: 'json_schema', name: 'probe', schema, strict: true }
    })
    assert.equal(t.calls.length, 1)
    assert.equal(t.calls[0].body.model, PINNED)
    // ⛔ THE SCHEMA STILL TRAVELS, in the adapter's own `output_config` shape — unchanged by
    // this repair, which touches model resolution and nothing else.
    assert.deepEqual(t.calls[0].body.output_config, { format: { type: 'json_schema', schema } })
    assert.deepEqual(JSON.parse(r.text), { intent: 'internal' })
  })
})
