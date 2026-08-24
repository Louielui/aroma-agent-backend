'use strict'

/**
 * aromaSystemLiveEgressFence.test.js — A TEST MAY NOT CALL THE PRODUCTION RESTAURANT SYSTEM
 * BECAUSE AROMA_SYSTEM_KEY HAPPENED TO BE IN THE SHELL.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED, NOT SUSPECTED (TEST_AROMA_SYSTEM_AMBIENT_CREDENTIAL, Phase 0.5). A synthetic-key
 * canonical run recorded exactly one live attempt at `system.aromabistro741.com`, from
 * `a4ProductionWiring.test.js` test D — which injected the REAL `createLiveReadConnector({env:
 * process.env})` and faked only `public_knowledge`'s transport. The `aroma_system` branch was
 * left on the default transport, reached `fetch()`, and the test stayed GREEN throughout,
 * because this module's own fail-soft normalises any fetch failure to a plain `'network
 * error'` — indistinguishable from a real outage. See `aromaSystemRead.js`'s fence header for
 * the full trace.
 *
 * ⛔ NOT ONE LIVE AROMA SYSTEM CALL RUNS HERE. Every case below is a pure decision, an
 * injected fake, or an assertion that the default transport was never invoked.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const AR = require('./aromaSystemRead')
const {
  aromaSystemLiveEgressAllowed, createAromaSystemReadAdapter,
  AROMA_LIVE_OPT_IN, AROMA_OPT_IN_VALUE, AROMA_LIVE_BLOCKED_MARKER
} = AR

const TEST_CTX = { NODE_TEST_CONTEXT: 'child-v8' }
const PROD_ARGV = ['node', 'C:/Aroma/aroma-agent-backend/src/index.js']
const PROD_MAIN = 'C:/Aroma/aroma-agent-backend/src/index.js'

async function captureStderr (fn) {
  const lines = []
  const real = console.error
  console.error = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
  try { return { value: await fn(), lines } } catch (e) { return { error: e, lines } } finally { console.error = real }
}

/* ═══ A — THE DECISION MATRIX. Pure; no fetch, no adapter, no socket. ═══ */

test('*** A — a test process is BLOCKED on every signal the shared detector trusts ***', () => {
  assert.equal(aromaSystemLiveEgressAllowed(TEST_CTX, [], null), false, 'NODE_TEST_CONTEXT')
  assert.equal(aromaSystemLiveEgressAllowed({}, ['node', '--test', 'x'], null), false, 'the runner process itself')
  assert.equal(aromaSystemLiveEgressAllowed({}, [], 'C:/x/foo.test.js'), false, 'node foo.test.js directly')
  assert.equal(aromaSystemLiveEgressAllowed({}, [], 'C:/x/foo.test.cjs'), false)
  assert.equal(aromaSystemLiveEgressAllowed({}, [], 'C:/x/foo.test.mjs'), false)
})

test('*** A — ORDINARY RUNTIME IS NEVER BLOCKED. The production non-impact assertion ***', () => {
  assert.equal(aromaSystemLiveEgressAllowed({}, PROD_ARGV, PROD_MAIN), true)
  assert.equal(aromaSystemLiveEgressAllowed({ AROMA_SYSTEM_KEY: 'whatever-is-really-there' }, PROD_ARGV, PROD_MAIN), true,
    'production reads a real key every turn — the fence must not touch that path')
})

test('*** A — the ONLY key is RUN_LIVE_AROMA_SYSTEM_E2E === "1", literally ***', () => {
  assert.equal(AROMA_LIVE_OPT_IN, 'RUN_LIVE_AROMA_SYSTEM_E2E')
  assert.equal(AROMA_OPT_IN_VALUE, '1')
  assert.equal(aromaSystemLiveEgressAllowed(Object.assign({}, TEST_CTX, { [AROMA_LIVE_OPT_IN]: '1' }), [], null), true)
  for (const v of [undefined, '', '0', 'true', 'yes', 'TRUE', ' 1', '1 ', 'on']) {
    const env = Object.assign({}, TEST_CTX)
    if (v !== undefined) env[AROMA_LIVE_OPT_IN] = v
    assert.equal(aromaSystemLiveEgressAllowed(env, [], null), false,
      '⛔ «' + String(v) + '» must not unlock the production restaurant system')
  }
})

test('*** A — NEITHER THE PAID-MODEL NOR THE GOOGLE OPT-IN IS AROMA SYSTEM AUTHORITY ***', () => {
  // ⛔ Permission to spend on Anthropic/OpenAI, or to use the Owner's Google identity, is not
  // permission to call the production restaurant system with its one, unscoped key.
  assert.equal(aromaSystemLiveEgressAllowed(Object.assign({}, TEST_CTX, { RUN_PAID_E2E: '1' }), [], null), false,
    '⛔ RUN_PAID_E2E must never grant Aroma System live egress')
  assert.equal(aromaSystemLiveEgressAllowed(Object.assign({}, TEST_CTX, { RUN_LIVE_GOOGLE_E2E: '1' }), [], null), false,
    '⛔ RUN_LIVE_GOOGLE_E2E must never grant Aroma System live egress')
})

test('*** A — CREDENTIAL PRESENCE GRANTS NOTHING. This is the defect, as an assertion ***', () => {
  assert.equal(aromaSystemLiveEgressAllowed(Object.assign({}, TEST_CTX, { AROMA_SYSTEM_KEY: 'sk-real-looking-49-chars-xxxxxxxxxxxxxxxxxxxxx' }), [], null), false,
    '⛔ a key sitting in env must not, by itself, unlock the default transport')
})

/* ═══ B — INJECTED fetchFn IS NEVER FENCED, WITH NO OPT-IN ══════════════ */

test('*** B — an injected fetchFn executes exactly as before, no opt-in required ***', async () => {
  let calls = 0
  const adapter = createAromaSystemReadAdapter({
    apiKey: 'synthetic',
    fetchFn: async (url, init) => {
      calls++
      assert.match(String(url), /\/api\/v1\/ai\/invoices$/)
      assert.equal(init.method, 'GET')
      return { ok: true, status: 200, json: async () => ({ ok: true, count: 1, data: [{ id: 1 }] }) }
    }
  })
  const r = await adapter.methods.listInvoices({})
  assert.equal(calls, 1, '⛔ the injected transport must be reached exactly once')
  assert.equal(r.results.length, 1)
  assert.equal(r.results[0].trust, 'live')
})

/* ═══ C — DEFAULT FETCH IS BLOCKED, OBSERVABLY, BEFORE THE NETWORK ═════ */

test('*** C — default transport in a test process: one marker, zero fetch calls, fail-closed shape ***', async () => {
  const realFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async (...args) => { fetchCalls++; return realFetch.apply(globalThis, args) }
  try {
    const adapter = createAromaSystemReadAdapter({ apiKey: 'synthetic-test-key' }) // no fetchFn injected
    const { value: r, lines } = await captureStderr(() => adapter.methods.listInvoices({}))

    assert.equal(fetchCalls, 0, '⛔ the default fetch must NEVER be invoked from a test process without opt-in')
    const markerLines = lines.filter((l) => l.startsWith(AROMA_LIVE_BLOCKED_MARKER))
    assert.equal(markerLines.length, 1, '⛔ exactly one blocked marker must be emitted')
    assert.equal(markerLines[0].includes('sk-'), false)
    assert.equal(markerLines[0].includes('synthetic-test-key'), false, '⛔ the marker must never carry the key')
    assert.equal(markerLines[0].includes('Bearer'), false, '⛔ the marker must never carry Authorization content')

    assert.equal(r.results.length, 1, 'a blocked read still returns exactly one unavailable marker row')
    assert.equal(r.results[0].trust, 'unavailable')
    assert.equal(r.results[0].content, '', 'no business data leaks through a blocked read')
  } finally { globalThis.fetch = realFetch }
})

test('*** C — the marker JSON carries only identifiers, never secret material ***', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = realFetch
  try {
    const adapter = createAromaSystemReadAdapter({ apiKey: 'sk-test-should-never-appear-anywhere' })
    const { lines } = await captureStderr(() => adapter.methods.listInvoices({}))
    const marker = lines.find((l) => l.startsWith(AROMA_LIVE_BLOCKED_MARKER))
    assert.ok(marker)
    const json = JSON.parse(marker.slice(AROMA_LIVE_BLOCKED_MARKER.length + 1))
    assert.deepEqual(Object.keys(json).sort(), ['optIn', 'source'])
    assert.equal(json.source, 'aroma_system')
    assert.equal(json.optIn, AROMA_LIVE_OPT_IN)
  } finally { globalThis.fetch = realFetch }
})

/* ═══ D — CONSTRUCTION REMAINS LEGAL ═════════════════════════════════════ */

test('*** D — creating the adapter in a test process never throws merely because a key exists ***', () => {
  assert.doesNotThrow(() => createAromaSystemReadAdapter({ apiKey: 'synthetic' }))
  assert.doesNotThrow(() => createAromaSystemReadAdapter({ env: { AROMA_SYSTEM_KEY: 'synthetic-env-key' } }))
  const adapter = createAromaSystemReadAdapter({ apiKey: 'synthetic' })
  assert.equal(adapter.ready(), true, 'readiness reflects key presence only, unaffected by the fence')
})

/* ═══ E — PRODUCTION DECISION PERMITTED, WITHOUT CONTACTING PRODUCTION ═══ */

test('*** E — a production-shaped process is permitted — pure decision proof only, no call made ***', () => {
  assert.equal(aromaSystemLiveEgressAllowed({}, PROD_ARGV, PROD_MAIN), true)
  assert.equal(aromaSystemLiveEgressAllowed({ AROMA_SYSTEM_KEY: 'whatever' }, PROD_ARGV, PROD_MAIN), true)
  // ⛔ Deliberately: this test never constructs an adapter or calls fetch. The claim is about
  // the DECISION function only.
})

/* ═══ F — THE OTHER TWO OPT-INS GRANT NOTHING (repeated as its own numbered case) ══ */

test('*** F — RUN_PAID_E2E and RUN_LIVE_GOOGLE_E2E, alone or together, grant nothing ***', () => {
  const both = Object.assign({}, TEST_CTX, { RUN_PAID_E2E: '1', RUN_LIVE_GOOGLE_E2E: '1' })
  assert.equal(aromaSystemLiveEgressAllowed(both, [], null), false)
})

/* ═══ G — LOG SAFETY, END TO END THROUGH A REAL BLOCKED READ ════════════ */

test('*** G — a blocked read leaks no key and no Authorization content anywhere observable ***', async () => {
  const SECRET = 'sk-THIS-EXACT-STRING-MUST-NEVER-APPEAR-9182'
  const adapter = createAromaSystemReadAdapter({ apiKey: SECRET })
  const { value: r, lines } = await captureStderr(() => adapter.methods.listInvoices({}))
  const allText = lines.join('\n') + '\n' + JSON.stringify(r)
  assert.equal(allText.includes(SECRET), false, '⛔ the key leaked into a marker, log line or read result')
  assert.equal(allText.includes('Bearer'), false, '⛔ the Authorization scheme leaked')
})
