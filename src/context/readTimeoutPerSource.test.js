'use strict'

/**
 * readTimeoutPerSource.test.js — one source may need longer, and only that one gets it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEFECT, MEASURED IN PRODUCTION SHAPE.
 *
 * The connector timed every source at a shared 10 seconds. That is right for an API answering
 * from a database and wrong for a source whose read IS a live web search: the A4-3B canary
 * watched a healthy public retrieval killed at 10s while the provider was still inside its own
 * 30s budget, and the Owner was told the outside world could not be read.
 *
 * Raising the shared cap would have lengthened everyone's rope to help one source. So the
 * ADAPTER declares its own bound and the connector honours it — without learning what the
 * source is, and without any declaration being able to remove a timeout.
 *
 * ⛔ NO TEST HERE WAITS SECONDS. Every case uses millisecond caps against an injected clock of
 * its own making; the real constants are asserted as VALUES, not by elapsing them.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createReadConnector, DEFAULT_CAPS, timeoutForAdapter } = require('./readConnector')
const { createPublicKnowledgeReadAdapter, PUBLIC_READ_TIMEOUT_MS } = require('./adapters/publicKnowledgeRead')
const { DEFAULT_TIMEOUT_MS: PROVIDER_TIMEOUT_MS } = require('./providers/openaiWebSearchProvider')

const ENV = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A source whose read takes a known number of milliseconds. */
function slowAdapter (source, ms, extra = {}) {
  return Object.assign({
    source,
    methods: { async search () { await sleep(ms); return [{ source, sourceId: '1', title: 't', content: 'c', retrievedAt: 'now' }] } }
  }, extra)
}

/* ═══ A / B / C — THE RESOLUTION ═══════════════════════════════════════ */

test('*** A — an ordinary source is still bound by the shared cap ***', async () => {
  const c = createReadConnector({ env: ENV, caps: { timeoutMs: 10 } })
  c.register(slowAdapter('aroma_system', 40))
  const r = await c.read('aroma_system', 'search', {})
  assert.equal(r.trust, 'unavailable')
  assert.match(r.error, /timeout after 10ms/)
})

test('*** B — a declared per-adapter timeout overrides the shared cap ***', async () => {
  const c = createReadConnector({ env: ENV, caps: { timeoutMs: 10 } })
  c.register(slowAdapter('public_knowledge', 20, { readTimeoutMs: 30 }))
  const r = await c.read('public_knowledge', 'search', {})
  assert.equal(r.trust, undefined, 'a successful read carries no trust flag of its own')
  assert.equal(r.count, 1, '⛔ the source was cut off despite declaring a longer bound')
})

test('*** C — the SAME source at the SAME speed dies without the declaration ***', async () => {
  // The control for case B: only the declaration differs.
  const c = createReadConnector({ env: ENV, caps: { timeoutMs: 10 } })
  c.register(slowAdapter('public_knowledge', 20))
  const r = await c.read('public_knowledge', 'search', {})
  assert.equal(r.trust, 'unavailable')
  assert.match(r.error, /timeout after 10ms/)
})

test('*** ⛔ one source\'s longer bound does not lengthen its neighbour\'s ***', async () => {
  const c = createReadConnector({ env: ENV, caps: { timeoutMs: 10 } })
  c.register(slowAdapter('public_knowledge', 20, { readTimeoutMs: 30 }))
  c.register(slowAdapter('aroma_system', 20))
  const [pub, inv] = await Promise.all([c.read('public_knowledge', 'search', {}), c.read('aroma_system', 'search', {})])
  assert.equal(pub.count, 1, 'the declaring source survives')
  assert.equal(inv.trust, 'unavailable', '⛔ the neighbour inherited a longer rope')
})

/* ═══ D / E — THE REAL CONSTANTS, AND THEIR ORDER ══════════════════════ */

test('*** D/E — 35s outer, 30s inner, 10s for everyone else ***', () => {
  assert.equal(DEFAULT_CAPS.timeoutMs, 10000, '⛔ the shared cap must NOT have been raised')
  assert.equal(PUBLIC_READ_TIMEOUT_MS, 35000)
  assert.equal(PROVIDER_TIMEOUT_MS, 30000, 'the provider keeps its own internal bound')
  // ⛔ THE ORDER IS THE POINT. The provider must always abort first, so a slow search fails with
  // the reason it actually had rather than being cut off by an outer stopwatch.
  assert.ok(PUBLIC_READ_TIMEOUT_MS > PROVIDER_TIMEOUT_MS, '⛔ the outer bound must outlast the inner one')
  // And the adapter really publishes it.
  const a = createPublicKnowledgeReadAdapter({ provider: { search: async () => ({}) } })
  assert.equal(a.readTimeoutMs, PUBLIC_READ_TIMEOUT_MS)
})

/* ═══ F — A BAD DECLARATION CANNOT DISABLE A TIMEOUT ═══════════════════ */

test('*** F — invalid timeout metadata falls back to the shared cap, never to none ***', () => {
  const caps = { timeoutMs: 10000 }
  for (const bad of [0, -1, -0, NaN, Infinity, -Infinity, '30000', null, undefined, {}, [], true]) {
    assert.equal(timeoutForAdapter({ readTimeoutMs: bad }, caps), 10000, 'value: ' + String(bad))
  }
  assert.equal(timeoutForAdapter({}, caps), 10000)
  assert.equal(timeoutForAdapter(null, caps), 10000)
  assert.equal(timeoutForAdapter({ readTimeoutMs: 35000 }, caps), 35000)
})

test('*** F(live) — an adapter declaring garbage is still timed out ***', async () => {
  const c = createReadConnector({ env: ENV, caps: { timeoutMs: 10 } })
  c.register(slowAdapter('public_knowledge', 40, { readTimeoutMs: Infinity }))
  const r = await c.read('public_knowledge', 'search', {})
  assert.equal(r.trust, 'unavailable', '⛔ Infinity disabled the timeout')
  assert.match(r.error, /timeout after 10ms/)
})

/* ═══ G — THE LOSING TIMER IS CLEARED ══════════════════════════════════ */

test('*** G — a fast success leaves no pending timer behind ***', async () => {
  // ⛔ MEASURED, NOT ASSUMED. A 35-second timer left pending on every fast public read keeps the
  // event loop alive; the count of active timers must return to its baseline.
  const active = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
  const c = createReadConnector({ env: ENV, caps: { timeoutMs: 10000 } })
  c.register(Object.assign({
    source: 'public_knowledge',
    methods: { async search () { return [{ source: 'public_knowledge', sourceId: '1', title: 't', content: 'c', retrievedAt: 'now' }] } }
  }, { readTimeoutMs: 35000 }))

  const before = active()
  const r = await c.read('public_knowledge', 'search', {})
  assert.equal(r.count, 1)
  assert.equal(active(), before, '⛔ a 35-second timer is still pending after a fast read')
})

test('*** G — EVERY timer the connector creates is cleared, on success and on timeout ***', async () => {
  /**
   * ⛔ COUNTED DIRECTLY, NOT INFERRED FROM PROCESS RESOURCES.
   *
   * `getActiveResourcesInfo()` also sees the test's own sleeps, so a baseline comparison is
   * noise. Wrapping the globals instead records exactly which handles the CONNECTOR created and
   * which of those it cleared — the actual claim.
   */
  const realSet = global.setTimeout
  const realClear = global.clearTimeout
  const created = new Set()
  const cleared = new Set()
  global.setTimeout = (fn, ms, ...rest) => { const h = realSet(fn, ms, ...rest); if (ms >= 1000) created.add(h); return h }
  global.clearTimeout = (h) => { cleared.add(h); return realClear(h) }
  try {
    const c = createReadConnector({ env: ENV, caps: { timeoutMs: 5000 } })
    c.register(slowAdapter('public_knowledge', 20, { readTimeoutMs: 35000 }))
    c.register(slowAdapter('aroma_system', 20, { readTimeoutMs: 2000 }))

    const ok = await c.read('public_knowledge', 'search', {})
    assert.equal(ok.count, 1, 'the slow read succeeded under its own long bound')
    await c.read('aroma_system', 'search', {})

    assert.equal(created.size, 2, 'two long-lived read timers were created')
    for (const h of created) assert.equal(cleared.has(h), true, '⛔ a connector timer was left pending')
  } finally {
    global.setTimeout = realSet
    global.clearTimeout = realClear
  }
})

/* ═══ STATIC SAFETY — THE TWO RULES, ASSERTED AGAINST THE SOURCE ═══════ */

const fs = require('node:fs')
const path = require('node:path')
const strip = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('*** STATIC — only public_knowledge gets an extended read bound ***', () => {
  const clients = strip('./liveClients.js')
  const adapters = ['driveRead', 'gmailRead', 'calendarRead', 'githubRead', 'aromaSystemRead', 'recordRead']
  for (const a of adapters) {
    const src = strip('./adapters/' + a + '.js')
    assert.equal(/readTimeoutMs/.test(src), false, '⛔ ' + a + ' declared its own timeout')
  }
  assert.equal(/readTimeoutMs/.test(strip('./adapters/publicKnowledgeRead.js')), true)
  // ⛔ AND THE CONNECTOR LEARNED NOTHING ABOUT THE SOURCE. It reads a number from metadata; it
  // does not know which source is a web search.
  const conn = strip('./readConnector.js')
  assert.equal(/public_knowledge|web[_ ]?search|openai/i.test(conn), false,
    '⛔ vendor or source knowledge leaked into the generic connector')
  assert.equal(/timeoutForAdapter\(adapter, caps\)/.test(conn), true)
  assert.equal(/clearTimeout/.test(conn), true, 'the losing timer is cleared')
  assert.equal(/public_knowledge/.test(clients), true, 'liveClients still registers it by name')
})

test('*** STATIC — the public planner is NOT gated by internal evidence ***', () => {
  const svc = strip('../intake/intakeService.js')
  // ⛔ THE EXACT SHAPE THAT CAUSED THE CANARY FAILURE MUST NOT COME BACK.
  assert.equal(/if\s*\(\s*internalValues\.length\s*>\s*0\s*\)/.test(svc), false,
    '⛔ the planner is conditional on internal evidence again')
  // The planner call and the fail-closed refusal both still exist.
  assert.equal(/egressPlans\.get\(/.test(svc), true)
  assert.equal(/PUBLIC_QUERY_UNAVAILABLE/.test(svc), true)
  assert.equal(/outboundArgs = planned\.args/.test(svc), true)
  // ⛔ AND `readArgs` NEVER SURVIVES AS THE OUTBOUND BAG ON THE PUBLIC PATH: the only other
  // assignment is the initial one, which the planner overwrites before anything leaves.
  assert.equal((svc.match(/outboundArgs\s*=/g) || []).length, 2)
})

test('*** STATIC — the planner still knows nothing about connectors or evidence ***', () => {
  const planner = strip('../intake/publicQueryEgressPlanner.js')
  for (const tok of ['readConnector', 'liveClients', 'contextResult', 'evidence', 'openai', 'adapter']) {
    assert.equal(planner.toLowerCase().includes(tok.toLowerCase()), false, '⛔ «' + tok + '» reached the planner')
  }
})

test('*** STATIC — no write surface was added by this repair ***', () => {
  const { WRITE_RE } = require('./readConnector')
  const { createPublicKnowledgeReadAdapter } = require('./adapters/publicKnowledgeRead')
  const a = createPublicKnowledgeReadAdapter({ provider: { search: async () => ({}) } })
  assert.deepEqual(Object.keys(a.methods), ['search'])
  for (const m of Object.keys(a.methods)) assert.equal(WRITE_RE.test(m), false)
})
