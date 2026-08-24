'use strict'

/**
 * liveEgressFence.test.js — A TEST PROCESS MAY NOT SPEND MONEY BECAUSE A KEY HAPPENED TO BE
 * IN THE SHELL.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED, NOT SUSPECTED. Running the canonical `node --test` from a developer shell that
 * carried ANTHROPIC_API_KEY originated ~41 live Haiku calls per run
 * (`claude-haiku-4-5-20251001`) and CHANGED 7–8 A4 outcomes. The path was one `||`:
 *
 *     intakeService.js  decide: (readDeps && readDeps.recoveryWorker) || defaultRecoveryWorker
 *                       defaultRecoveryWorker → new ClaudeAdapter({model: PINNED}) → axios.post
 *
 * `ClaudeAdapter` reads `process.env.ANTHROPIC_API_KEY` unconditionally and the worker's model
 * is an explicit pin, so an absent CLAUDE_MODEL did not stop it. THE CREDENTIAL ALONE WAS THE
 * TRIGGER — and, because `runRecoveryWorker` catches the no-key throw and returns `failed`,
 * the difference between the two runs was silent.
 *
 * ⛔ 57 CALL SITES INJECT A `finalVerifier` AND NO `recoveryWorker`. Fixing them one at a time
 * is the discipline that produced the defect. The fence is the mechanism.
 *
 * ── WHERE THE FENCE GOES, AND WHY NOT ANYWHERE ELSE ─────────────────────────
 * · NOT a test bootstrap — node has no preload hook for a bare `node --test`, and the bare
 *   command IS the observed defect.
 * · NOT `adapterFactory` — `defaultRecoveryWorker` and `a4Runtime` both call
 *   `new ClaudeAdapter(...)` directly, so fencing the factory would not have stopped this.
 * · NOT A CONSTRUCTOR — `connectionState.projectConnections` constructs adapters on every
 *   real turn to check credential PRESENCE. Construction is legal; EGRESS is not.
 * · The DEFAULT TRANSPORT. It is the last line before the socket, it is already the
 *   designated test seam in all three files, and an injected transport bypasses it by
 *   construction — which is what keeps the existing suite byte-identical.
 *
 * ⛔ NOT ONE PAID CALL RUNS HERE. Every case is either a pure decision, an injected spy, or a
 * loopback server this file starts on 127.0.0.1 itself.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const {
  liveEgressAllowed, assertLiveEgressAllowed, fencedAxiosPost, fencedFetch,
  PAID_OPT_IN, BLOCKED_MARKER
} = require('./liveEgressFence')
const { ClaudeAdapter } = require('./ClaudeAdapter')
const { OpenAIAdapter } = require('./OpenAIAdapter')
const { createOpenAIWebSearchProvider } = require('../context/providers/openaiWebSearchProvider')

const TEST_CTX = { NODE_TEST_CONTEXT: 'child-v8' }
const PROD_ARGV = ['node', 'C:/Aroma/aroma-agent-backend/src/index.js']
const PROD_MAIN = 'C:/Aroma/aroma-agent-backend/src/index.js'
const SYNTHETIC = 'synthetic-not-a-real-key'

async function withEnv (over, fn) {
  const saved = {}
  for (const k of Object.keys(over)) { saved[k] = process.env[k]; if (over[k] === null) delete process.env[k]; else process.env[k] = over[k] }
  try { return await fn() } finally { for (const k of Object.keys(over)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
}

/** Capture console.error without letting a throw leave it swapped. */
async function captureStderr (fn) {
  const lines = []
  const real = console.error
  console.error = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
  try { return { value: await fn(), lines } } catch (e) { return { error: e, lines } } finally { console.error = real }
}

/** A loopback HTTP server. THE ONLY NETWORK ANY TEST IN THIS FILE TOUCHES. */
function loopback () {
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: 'http://127.0.0.1:' + server.address().port + '/v1/messages' }))
  })
}

/* ═══ A — THE DECISION MATRIX. Pure; no adapter, no socket. ════════════ */

test('*** A — a test process is BLOCKED on every signal the store detector already trusts ***', () => {
  assert.equal(liveEgressAllowed(TEST_CTX, [], null), false, 'NODE_TEST_CONTEXT')
  assert.equal(liveEgressAllowed({}, ['node', '--test', 'x'], null), false, 'the runner process itself')
  assert.equal(liveEgressAllowed({}, [], 'C:/x/foo.test.js'), false, 'node foo.test.js directly')
  assert.equal(liveEgressAllowed({}, [], 'C:/x/foo.test.cjs'), false)
  assert.equal(liveEgressAllowed({}, [], 'C:/x/foo.test.mjs'), false)
})

test('*** A — ORDINARY RUNTIME IS NEVER FENCED. This is the production non-impact assertion ***', () => {
  assert.equal(liveEgressAllowed({}, PROD_ARGV, PROD_MAIN), true)
  assert.equal(liveEgressAllowed({ ANTHROPIC_API_KEY: 'k', CLAUDE_MODEL: 'm' }, PROD_ARGV, PROD_MAIN), true)
})

test('*** A — the ONLY key is RUN_PAID_E2E === "1", literally ***', () => {
  assert.equal(liveEgressAllowed(Object.assign({}, TEST_CTX, { [PAID_OPT_IN]: '1' }), [], null), true)
  for (const v of [undefined, '', '0', 'true', 'yes', 'TRUE', ' 1', '1 ', 'on']) {
    const env = Object.assign({}, TEST_CTX)
    if (v !== undefined) env[PAID_OPT_IN] = v
    assert.equal(liveEgressAllowed(env, [], null), false, '⛔ «' + String(v) + '» must not opt in to paid work')
  }
})

test('*** A — A CREDENTIAL GRANTS NOTHING. This is the whole defect, stated as an assertion ***', () => {
  const env = Object.assign({}, TEST_CTX, { ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', CLAUDE_MODEL: 'claude-haiku-4-5-20251001' })
  assert.equal(liveEgressAllowed(env, [], null), false)
})

/* ═══ B — CONSTRUCTION STAYS LEGAL ════════════════════════════════════ */

test('*** B — construction is NOT egress: projectConnections builds adapters on every real turn ***', async () => {
  await withEnv({ [PAID_OPT_IN]: null, ANTHROPIC_API_KEY: SYNTHETIC, OPENAI_API_KEY: SYNTHETIC }, async () => {
    assert.doesNotThrow(() => new ClaudeAdapter({ model: 'claude-haiku-4-5-20251001' }))
    assert.doesNotThrow(() => new OpenAIAdapter({ model: 'gpt-5.6-terra', apiKey: SYNTHETIC }))
    assert.doesNotThrow(() => createOpenAIWebSearchProvider({ apiKey: SYNTHETIC }))
  })
})

/* ═══ C — AN INJECTED TRANSPORT IS UNTOUCHED ══════════════════════════ */

test('*** C — ClaudeAdapter with an injected transport works with NO opt-in ***', async () => {
  await withEnv({ [PAID_OPT_IN]: null, ANTHROPIC_API_KEY: SYNTHETIC }, async () => {
    const calls = []
    const transport = async (url, body) => {
      calls.push({ url, model: body.model })
      return { data: { content: [{ type: 'text', text: 'ok' }], model: body.model, usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' } }
    }
    const r = await new ClaudeAdapter({ model: 'claude-haiku-4-5-20251001', transport }).complete('hi', { maxTokens: 8 })
    assert.equal(r.text, 'ok')
    assert.equal(calls.length, 1)
  })
})

test('*** C — OpenAIAdapter with an injected post works with NO opt-in ***', async () => {
  await withEnv({ [PAID_OPT_IN]: null }, async () => {
    const calls = []
    const post = async (url, body) => {
      calls.push({ url, model: body.model })
      return { data: { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }
    }
    const r = await new OpenAIAdapter({ model: 'gpt-5.6-terra', apiKey: SYNTHETIC, post }).complete('hi')
    assert.equal(r.text, 'ok')
    assert.equal(calls.length, 1)
  })
})

test('*** C — the web search provider with an injected transport works with NO opt-in ***', async () => {
  await withEnv({ [PAID_OPT_IN]: null }, async () => {
    const calls = []
    const transport = async (url) => { calls.push(url); return { status: 200, async json () { return { output: [], usage: {} } } } }
    const p = createOpenAIWebSearchProvider({ apiKey: SYNTHETIC, transport })
    const out = await p.search({ query: 'beef index' })
    assert.equal(calls.length, 1, '⛔ an injected transport must still be reached')
    assert.ok(out && typeof out === 'object')
  })
})

/* ═══ D — THE BLOCK IS LOUD, AND IT CARRIES NOTHING ═══════════════════ */

const SECRET_KEY = 'SYNTHETIC_KEY_VALUE_MUST_NOT_APPEAR'
const OWNER_TEXT = 'SYNTHETIC_OWNER_MESSAGE_MUST_NOT_APPEAR'

test('*** D — a blocked default call throws BEFORE the network and says so out loud ***', async () => {
  await withEnv({ [PAID_OPT_IN]: null }, async () => {
    const { error, lines } = await captureStderr(() => fencedAxiosPost('anthropic')(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: OWNER_TEXT }] },
      { headers: { 'x-api-key': SECRET_KEY } }
    ))
    assert.ok(error, '⛔ a default provider call must not resolve inside a test process')
    assert.equal(error.liveEgressBlocked, true, 'the error must be deterministically markable')
    assert.match(error.message, /RUN_PAID_E2E/, 'the message must name the opt-in')
    assert.equal(lines.length, 1, '⛔ exactly one marker — a withheld call may not be silent, nor a storm')
    assert.ok(lines[0].includes(BLOCKED_MARKER))
    assert.ok(lines[0].includes('anthropic'), 'the marker may name the provider')
    assert.ok(lines[0].includes('api.anthropic.com'), 'and the host it was going to')
  })
})

test('*** D — the marker and the error carry no key, no body, no Owner text ***', async () => {
  await withEnv({ [PAID_OPT_IN]: null }, async () => {
    const { error, lines } = await captureStderr(() => fencedAxiosPost('anthropic')(
      'https://api.anthropic.com/v1/messages?k=' + SECRET_KEY,
      { model: 'm', system: OWNER_TEXT, messages: [{ role: 'user', content: OWNER_TEXT }] },
      { headers: { 'x-api-key': SECRET_KEY } }
    ))
    const all = lines.join('\n') + '\n' + String(error && error.message) + '\n' + String(error && error.stack)
    for (const forbidden of [SECRET_KEY, OWNER_TEXT, 'x-api-key', '/v1/messages']) {
      assert.equal(all.includes(forbidden), false, '⛔ «' + forbidden + '» reached a log or an error message')
    }
  })
})

test('*** D — fencedFetch blocks on the same terms ***', async () => {
  await withEnv({ [PAID_OPT_IN]: null }, async () => {
    const { error, lines } = await captureStderr(() => fencedFetch('openai_web_search')(
      'https://api.openai.com/v1/responses',
      { method: 'POST', headers: { Authorization: 'Bearer ' + SECRET_KEY }, body: OWNER_TEXT }
    ))
    assert.equal(error && error.liveEgressBlocked, true)
    assert.equal(lines.length, 1)
    assert.ok(lines[0].includes('openai_web_search'))
    assert.equal((lines.join('\n') + String(error.message)).includes(SECRET_KEY), false)
  })
})

test('*** D — assertLiveEgressAllowed is silent and returns when it allows ***', async () => {
  await withEnv({ [PAID_OPT_IN]: '1' }, async () => {
    const { error, lines } = await captureStderr(async () => {
      assertLiveEgressAllowed('anthropic', 'https://api.anthropic.com/v1/messages')
      return 'allowed'
    })
    assert.equal(error, undefined)
    assert.deepEqual(lines, [], '⛔ an ALLOWED call must not print a block marker')
  })
})

/* ═══ E — EARN THE ZERO. The instrument must be able to record NON-zero. ══
 *
 * ⛔ WITHOUT THIS TEST A PERMANENT `throw` WOULD PASS EVERY CASE ABOVE — and would silently
 * break the three RUN_PAID_E2E suites that legitimately spend money. So the fenced helper is
 * proved to REACH a socket when it permits one. The socket is 127.0.0.1, started here, and
 * nothing external is contacted.
 */

test('*** E — with the opt-in, fencedAxiosPost REACHES the socket exactly once (loopback only) ***', async () => {
  const { server, seen, url } = await loopback()
  try {
    await withEnv({ [PAID_OPT_IN]: '1' }, async () => {
      const res = await fencedAxiosPost('anthropic')(url, { hello: 'world' }, { timeout: 5000 })
      assert.equal(res.status, 200)
      assert.deepEqual(res.data, { ok: true })
    })
    assert.equal(seen.length, 1, '⛔ the fence must pass through to axios, not merely refrain from throwing')
    assert.equal(seen[0].method, 'POST')
  } finally { server.close() }
})

test('*** E — and fencedFetch reaches the same loopback socket ***', async () => {
  const { server, seen, url } = await loopback()
  try {
    await withEnv({ [PAID_OPT_IN]: '1' }, async () => {
      const res = await fencedFetch('openai_web_search')(url, { method: 'POST', body: '{}' })
      assert.equal(res.status, 200)
    })
    assert.equal(seen.length, 1)
  } finally { server.close() }
})

test('*** E — and WITHOUT the opt-in the same loopback call never arrives ***', async () => {
  const { server, seen, url } = await loopback()
  try {
    await withEnv({ [PAID_OPT_IN]: null }, async () => {
      await captureStderr(() => fencedAxiosPost('anthropic')(url, {}, { timeout: 5000 }))
    })
    assert.equal(seen.length, 0, '⛔ blocked means the request never left — measured at the receiver')
  } finally { server.close() }
})
