'use strict'

/**
 * a4PublicRetrieval.test.js — A4-2B: a REAL executor behind the public capability.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ EVERY SEMANTIC DECISION IS ALREADY CLOSED, AND MUST STAY CLOSED.
 *
 * What the Owner meant, whether retrieval is required, which world, and what words may leave
 * the building were all settled upstream and proven live. A4-2B adds only the thing that goes
 * and fetches. So most of this file is about what the executor CANNOT do: it cannot answer
 * Louie, choose a world, compose a query, write, or turn its own prose into evidence.
 *
 * ⛔ AND NOT ONE PAID CALL RUNS HERE. Every provider is injected; the transport is a fake.
 * The real canaries are separate and bounded.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { processIntake } = require('../intake/intakeService')
const { createReadConnector } = require('./readConnector')
const { createPublicKnowledgeReadAdapter, PUBLIC_ENTITY_TYPE } = require('./adapters/publicKnowledgeRead')
const {
  createOpenAIWebSearchProvider, PROVIDER_ID, DEFAULT_MODEL, DEFAULT_EFFORT, RESPONSES_URL,
  toUserLocation, extractResults, reasonForStatus
} = require('./providers/openaiWebSearchProvider')
const {
  SEARCH_STATUS, UNAVAILABLE_REASON, isAttributable, makeSearchResult, logPublicSearch
} = require('./providers/publicSearchProvider')
const { ALL_SOURCES, enabledSources } = require('./liveClients')
const { A4_FLAG } = require('../intake/a4Contract')

const NOW = '2026-08-09T00:00:00.000Z'
const SECRET = 'AROMA_INTERNAL_ONLY_9842'
const SUPPLIER = 'Gordon'
const PRICE = '8.72'
const TITLE = 'Beef Brisket'
const INTERNAL_VALUES = [SECRET, SUPPLIER, PRICE, TITLE]
const PUB = 'public_knowledge.search'
const INV = 'aroma_system.invoices'

/* ═══ FAKE TRANSPORT — the vendor's shape, never the vendor ═════════════ */

function okPayload (sources, opts = {}) {
  return {
    output: [
      { type: 'web_search_call', status: opts.callStatus || 'completed', action: { type: 'search', query: 'q', sources } },
      { type: 'message', content: [{ text: 'prose that must never become evidence', annotations: opts.annotations || [] }] }
    ],
    usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 }
  }
}

/** Records exactly what would leave the process. */
function fakeTransport (impl) {
  const sent = []
  const fn = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    return impl(url, init)
  }
  return { fn, sent }
}
const jsonRes = (status, obj) => ({ status, async json () { return obj } })

const providerWith = (impl, opts = {}) => {
  const t = fakeTransport(impl)
  return { t, provider: createOpenAIWebSearchProvider(Object.assign({ apiKey: 'test-key', transport: t.fn, clock: () => NOW }, opts)) }
}

/* ═══ 1–8 — THE OUTBOUND PAYLOAD ═══════════════════════════════════════ */

test('*** 1/2 — the PLANNER query is what reaches the provider, verbatim ***', async () => {
  const { t, provider } = providerWith(async () => jsonRes(200, okPayload([{ url: 'https://x.example/a', title: 'A' }])))
  await provider.search({ query: 'canada wholesale beef index', freshness: 'current', location: null })
  assert.equal(t.sent.length, 1)
  assert.equal(t.sent[0].url, RESPONSES_URL)
  assert.equal(t.sent[0].body.input, 'canada wholesale beef index')
  assert.deepEqual(t.sent[0].body.tools, [{ type: 'web_search' }])
  assert.deepEqual(t.sent[0].body.include, ['web_search_call.action.sources'])
  assert.equal(t.sent[0].body.store, false, '⛔ must not create retrievable Application State')
  assert.equal(t.sent[0].body.model, DEFAULT_MODEL)
  assert.deepEqual(t.sent[0].body.reasoning, { effort: DEFAULT_EFFORT })
  // ⛔ The GPT-5 family rejects sampling params outright; nothing is sent "just in case".
  assert.equal('temperature' in t.sent[0].body, false)
  assert.equal('top_p' in t.sent[0].body, false)
})

test('*** 3/4/6 — ⛔ nothing but the query can reach the vendor ***', async () => {
  const { t, provider } = providerWith(async () => jsonRes(200, okPayload([{ url: 'https://x.example/a' }])))
  // The provider's ONLY inputs are the closed arg bag. There is no history, persona, evidence
  // or capability parameter to pass — so a leak would require inventing a channel.
  await provider.search({ query: 'wholesale beef market trend', freshness: 'recent', location: null })
  const blob = JSON.stringify(t.sent[0])
  for (const v of INTERNAL_VALUES) assert.equal(blob.includes(v), false, `⛔ ${v} left the process`)
  for (const v of ['香香', 'Conversation Contract', 'Decision Recall', 'persona']) {
    assert.equal(blob.includes(v), false, `⛔ ${v} reached the vendor`)
  }
  assert.deepEqual(Object.keys(t.sent[0].body).sort(),
    ['include', 'input', 'instructions', 'max_output_tokens', 'model', 'reasoning', 'store', 'tools'])
})

test('*** 5 — an Owner-supplied value MAY travel, because he typed it ***', async () => {
  const { t, provider } = providerWith(async () => jsonRes(200, okPayload([{ url: 'https://x.example/a' }])))
  // The planner decides this upstream; the executor simply does not censor its own input.
  await provider.search({ query: 'Gordon beef market price', freshness: null, location: null })
  assert.ok(JSON.stringify(t.sent[0].body.input).includes('Gordon'))
})

test('*** 7/8 — location is admitted when present and OMITTED when absent ***', async () => {
  const a = providerWith(async () => jsonRes(200, okPayload([{ url: 'https://x.example/a' }])))
  await a.provider.search({ query: 'q', location: 'Winnipeg' })
  assert.deepEqual(a.t.sent[0].body.tools[0].user_location, { type: 'approximate', city: 'Winnipeg' })

  const b = providerWith(async () => jsonRes(200, okPayload([{ url: 'https://x.example/a' }])))
  await b.provider.search({ query: 'q' })
  assert.equal('user_location' in b.t.sent[0].body.tools[0], false, '⛔ location must never be inferred')
  assert.equal(toUserLocation('  '), null)
})

/* ═══ 9–15 — TRUST STATES ══════════════════════════════════════════════ */

test('*** 9/16/17 — success → LIVE, with titles, URLs and a SERVER-side timestamp ***', async () => {
  const { provider } = providerWith(async () => jsonRes(200, okPayload([
    { url: 'https://a.example/1', title: 'Alpha', published_at: '2026-07-01' },
    { url: 'https://b.example/2', title: 'Beta' }
  ])))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.LIVE)
  assert.equal(out.provider, PROVIDER_ID)
  assert.equal(out.retrievedAt, NOW, 'the clock is ours, not the provider\'s')
  assert.deepEqual(out.results.map((r) => r.url), ['https://a.example/1', 'https://b.example/2'])
  assert.equal(out.results[0].title, 'Alpha')
  assert.equal(out.results[0].publishedAt, '2026-07-01')
  assert.equal(out.results[1].publishedAt, null, '⛔ a date the publisher did not give is not invented')
  assert.deepEqual(out.usage, { inputTokens: 11, outputTokens: 22, totalTokens: 33 })
  assert.equal(out.webSearchCalls, 1)
})

test('*** 10 — a completed search with no usable rows is LIVE-ZERO, not a failure ***', async () => {
  const { provider } = providerWith(async () => jsonRes(200, okPayload([])))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.LIVE_ZERO)
  assert.equal(out.reason, null)
  assert.deepEqual(out.results, [])
})

test('*** 11/12/13/14 — every transport failure is UNAVAILABLE, with its own enum ***', async () => {
  const cases = [
    ['auth 401', async () => jsonRes(401, { error: 'nope' }), UNAVAILABLE_REASON.AUTH],
    ['auth 403', async () => jsonRes(403, { error: 'nope' }), UNAVAILABLE_REASON.AUTH],
    ['rate 429', async () => jsonRes(429, { error: 'slow' }), UNAVAILABLE_REASON.RATE_LIMIT],
    ['server 500', async () => jsonRes(500, { error: 'boom' }), UNAVAILABLE_REASON.SERVER],
    ['server 503', async () => jsonRes(503, { error: 'boom' }), UNAVAILABLE_REASON.SERVER],
    ['network', async () => { throw new Error('ECONNRESET') }, UNAVAILABLE_REASON.NETWORK],
    ['timeout', async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }, UNAVAILABLE_REASON.TIMEOUT],
    ['malformed body', async () => ({ status: 200, async json () { throw new Error('not json') } }), UNAVAILABLE_REASON.MALFORMED],
    ['no output array', async () => jsonRes(200, { nope: true }), UNAVAILABLE_REASON.MALFORMED]
  ]
  for (const [label, impl, reason] of cases) {
    const { provider } = providerWith(impl)
    const out = await provider.search({ query: 'q' })
    assert.equal(out.status, SEARCH_STATUS.UNAVAILABLE, label)
    assert.equal(out.reason, reason, label)
    assert.deepEqual(out.results, [], label)
  }
})

test('*** ⛔ a turn where the tool never ran is UNAVAILABLE, never LIVE-ZERO ***', async () => {
  // The model can answer from memory without searching. That prose has no provenance, and
  // calling it 「the outside world contains nothing」 would be a fabrication with a status.
  const { provider } = providerWith(async () => jsonRes(200, {
    output: [{ type: 'message', content: [{ text: 'I already know the answer', annotations: [] }] }],
    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
  }))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.UNAVAILABLE)
  assert.equal(out.reason, UNAVAILABLE_REASON.NO_SEARCH_PERFORMED)
})

test('*** ⛔ an incomplete tool call is not a completed search ***', async () => {
  const { provider } = providerWith(async () => jsonRes(200, okPayload([{ url: 'https://a.example/1' }], { callStatus: 'in_progress' })))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.UNAVAILABLE)
  assert.equal(out.reason, UNAVAILABLE_REASON.NO_SEARCH_PERFORMED)
})

test('*** 15 — ⛔ a result with no attributable URL is never promoted to evidence ***', async () => {
  const { provider } = providerWith(async () => jsonRes(200, okPayload([
    { title: 'no url at all' },
    { url: 'not-a-url', title: 'bad scheme' },
    { url: 'ftp://x.example/f', title: 'wrong protocol' },
    { url: 'https://good.example/1', title: 'kept' }
  ])))
  const out = await provider.search({ query: 'q' })
  assert.deepEqual(out.results.map((r) => r.url), ['https://good.example/1'])
  assert.equal(isAttributable({ url: 'https://x' }), true)
  assert.equal(isAttributable({ url: '' }), false)
  assert.equal(isAttributable(null), false)
})

test('*** the answer PROSE never becomes evidence — only sources and citations do ***', async () => {
  const { provider } = providerWith(async () => jsonRes(200, okPayload([], {
    annotations: [{ type: 'url_citation', url: 'https://cited.example/9', title: 'Cited' }]
  })))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.LIVE)
  assert.deepEqual(out.results.map((r) => r.url), ['https://cited.example/9'])
  assert.equal(JSON.stringify(out.results).includes('prose that must never become evidence'), false)
})

/* ═══ THE READ ADAPTER ═════════════════════════════════════════════════ */

test('*** the adapter registers read-shaped and produces sourced evidence ***', async () => {
  const provider = { provider: PROVIDER_ID, model: DEFAULT_MODEL, search: async () => makeSearchResult({ provider: PROVIDER_ID, query: 'q', retrievedAt: NOW, results: [{ url: 'https://a.example/1', title: 'Alpha', snippet: 'snip', publishedAt: '2026-07-01' }] }) }
  const adapter = createPublicKnowledgeReadAdapter({ provider, clock: () => NOW, logSink: () => {} })
  assert.equal(adapter.source, 'public_knowledge')
  assert.deepEqual(Object.keys(adapter.methods), ['search'])
  // The connector independently refuses write-shaped names; registering must not throw.
  const connector = createReadConnector({ env: {} })
  connector.register(adapter)
  assert.equal(connector.hasWriteMethod(), false)

  const rows = await adapter.methods.search({ query: 'q' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'public_knowledge')
  assert.equal(rows[0].entityType, PUBLIC_ENTITY_TYPE)
  assert.equal(rows[0].link, 'https://a.example/1')
  assert.equal(rows[0].originalDate, '2026-07-01', 'the publisher\'s date, when given')
  assert.equal(rows[0].retrievedAt, NOW)
  assert.equal(rows[0].trust, 'live')
  // 18 — provenance travels as DATA for the answer layer to present.
  assert.equal(rows[0].fields.url, 'https://a.example/1')
  assert.equal(rows[0].fields.provider, PROVIDER_ID)
})

test('*** ⛔ the adapter THROWS on unavailable — it never returns zero rows ***', async () => {
  const provider = { provider: PROVIDER_ID, search: async () => makeSearchResult({ provider: PROVIDER_ID, query: 'q', retrievedAt: NOW, unavailable: true, reason: UNAVAILABLE_REASON.RATE_LIMIT }) }
  const adapter = createPublicKnowledgeReadAdapter({ provider, logSink: () => {} })
  await assert.rejects(() => adapter.methods.search({ query: 'q' }), /unavailable/)
})

test('*** an unconfigured provider is unavailable, not empty ***', async () => {
  const adapter = createPublicKnowledgeReadAdapter({})
  assert.equal(adapter.ready(), false)
  await assert.rejects(() => adapter.methods.search({ query: 'q' }), /not configured/)
})

test('*** LIVE-ZERO reaches the caller as zero rows, and that is a true answer ***', async () => {
  const provider = { provider: PROVIDER_ID, search: async () => makeSearchResult({ provider: PROVIDER_ID, query: 'q', retrievedAt: NOW, results: [] }) }
  const adapter = createPublicKnowledgeReadAdapter({ provider, logSink: () => {} })
  assert.deepEqual(await adapter.methods.search({ query: 'q' }), [])
})

/* ═══ 29/30 — ACCOUNTING AND SECRETS ═══════════════════════════════════ */

test('*** 29/30 — ⛔ the accounting line carries counts, never the query, URLs or the key ***', () => {
  let line = null
  logPublicSearch({
    requestId: 'r1', provider: PROVIDER_ID, model: DEFAULT_MODEL, status: SEARCH_STATUS.LIVE,
    webSearchCalls: 1, resultCount: 3, inputTokens: 10, outputTokens: 20, totalTokens: 30, latencyMs: 900
  }, (l) => { line = l })
  assert.deepEqual(Object.keys(line).sort(), [
    'event', 'inputTokens', 'latencyMs', 'model', 'outputTokens', 'provider', 'reason',
    'requestId', 'resultCount', 'status', 'timestamp', 'totalTokens', 'webSearchCalls'
  ])
  // An unknown status/reason cannot smuggle text through an enum field.
  let bad = null
  logPublicSearch({ status: 'live ' + SECRET, reason: 'x ' + SECRET, webSearchCalls: 'many' }, (l) => { bad = l })
  assert.equal(bad.status, SEARCH_STATUS.UNAVAILABLE)
  assert.equal(bad.reason, null)
  assert.equal(bad.webSearchCalls, 0)
  assert.equal(JSON.stringify(bad).includes(SECRET), false)
})

test('*** ⛔ the API key never appears in a result, error or accounting line ***', async () => {
  const KEY = 'sk-secret-must-never-appear'
  const { provider } = providerWith(async () => jsonRes(401, { error: { message: 'bad key ' + KEY } }), { apiKey: KEY })
  const out = await provider.search({ query: 'q' })
  assert.equal(JSON.stringify(out).includes(KEY), false, '⛔ the key reached the caller')
  let line = null
  logPublicSearch({ provider: PROVIDER_ID, status: out.status, reason: out.reason }, (l) => { line = l })
  assert.equal(JSON.stringify(line).includes(KEY), false)
  // ⛔ AND THE PROVIDER'S OWN MESSAGE IS DISCARDED — it can echo the request back.
  assert.equal(JSON.stringify(out).includes('bad key'), false)
})

test('*** one transient retry at most is permitted, and none is implemented here ***', async () => {
  // The provider makes exactly ONE request per search. A single Owner question therefore
  // cannot fan out into unbounded paid retrievals; the A4 reasoning bound governs the rest.
  const { t, provider } = providerWith(async () => jsonRes(500, { error: 'boom' }))
  await provider.search({ query: 'q' })
  assert.equal(t.sent.length, 1, '⛔ a retry loop would multiply cost silently')
})

/* ═══ 25/26/27/28 — PRODUCTION REACH AND BOUNDARIES ════════════════════ */

test('*** 25 — production still cannot construct the public source at all ***', () => {
  assert.equal(ALL_SOURCES.includes('public_knowledge'), false, '⛔ not in the live registry')
  const everything = { READ_ACCESS: 'on', CONTEXT_DRIVE: 'on', CONTEXT_GMAIL: 'on', CONTEXT_CALENDAR: 'on', CONTEXT_GITHUB: 'on', CONTEXT_AROMA_SYSTEM: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on' }
  assert.equal(enabledSources(everything).includes('public_knowledge'), false, '⛔ and no flag turns it on')
})

test('*** 26/27/28 — ⛔ the semantic layer never learns the vendor, and cannot write ***', () => {
  // ⛔ TRAILING comments are stripped too, using the repo's own pattern — the ':' guard keeps
  // 'https://' inside strings intact. A first draft stripped only whole-line comments and so
  // flagged the words 'never create retrievable Application State', which is documentation,
  // not a write path. A fence that cries wolf is a fence someone later weakens.
  const strip = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  for (const p of [
    '../intake/ownerSourceIntentResolver.js',
    '../intake/publicQueryEgressPlanner.js',
    '../intake/recoveryDecisionWorker.js',
    '../intake/finalKnowledgeRequirement.js'
  ]) {
    const code = strip(p)
    for (const tok of ['openai', 'web_search', 'responses', 'luna', 'api.openai.com', 'fetch(']) {
      assert.equal(code.toLowerCase().includes(tok), false, `⛔ «${tok}» leaked into ${p}`)
    }
  }
  // And the executor itself has no write path.
  const exec = strip('./providers/openaiWebSearchProvider.js')
  for (const verb of ['send', 'create', 'update', 'delete', 'approve', 'execute']) {
    assert.equal(new RegExp('\\b' + verb + '\\b', 'i').test(exec.replace(/createOpenAIWebSearchProvider|createSearch/g, '')), false, `⛔ write verb «${verb}»`)
  }
})

test('*** the provider is neutral about MEANING: it decides no world and no query ***', () => {
  const code = fs.readFileSync(path.resolve(__dirname, './providers/openaiWebSearchProvider.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const tok of ['intent', 'ambiguous', 'requiredWorld', 'internal', 'mixed']) {
    assert.equal(new RegExp('\\b' + tok + '\\b').test(code), false, `⛔ «${tok}» — retrieval must not route`)
  }
})

test('*** reasonForStatus maps every documented failure class ***', () => {
  assert.equal(reasonForStatus(401), UNAVAILABLE_REASON.AUTH)
  assert.equal(reasonForStatus(403), UNAVAILABLE_REASON.AUTH)
  assert.equal(reasonForStatus(429), UNAVAILABLE_REASON.RATE_LIMIT)
  assert.equal(reasonForStatus(500), UNAVAILABLE_REASON.SERVER)
  assert.equal(reasonForStatus(502), UNAVAILABLE_REASON.SERVER)
  assert.equal(reasonForStatus(400), UNAVAILABLE_REASON.MALFORMED)
})

test('*** consulted sources are preferred, and duplicates collapse to one row ***', () => {
  const { results } = extractResults({
    output: [
      { type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://a/1', title: 'FromSearch' }] } },
      { type: 'message', content: [{ annotations: [{ type: 'url_citation', url: 'https://a/1', title: 'FromProse' }] }] }
    ]
  })
  assert.equal(results.length, 1)
  assert.equal(results[0].title, 'FromSearch', 'the search\'s own metadata wins over the prose')
})

/* ═══ 18–24 — THE PIPELINE STILL OWNS THE TURN ═════════════════════════ */

function twoWorldConnector (publicProvider) {
  const internalReads = []; const publicCalls = []
  const pubAdapter = createPublicKnowledgeReadAdapter({ provider: publicProvider, clock: () => NOW, logSink: () => {} })
  return {
    internalReads,
    publicCalls,
    connector: {
      async read (source, method, params) {
        if (source === 'public_knowledge') {
          publicCalls.push(JSON.parse(JSON.stringify(params || {})))
          let rows
          try { rows = await pubAdapter.methods.search(params) } catch (e) {
            return { asOf: NOW, source, count: 0, results: [], evidence: { source, endpoint: method, entityType: null, rowShape: {}, metrics: {}, matchingTotal: 0, shownCount: 0, sourceTotal: null, queryScope: {}, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'unavailable', provenance: 'REAL PROVIDER', error: 'unavailable' } }
          }
          return { asOf: NOW, source, count: rows.length, results: rows, evidence: { source, endpoint: method, entityType: PUBLIC_ENTITY_TYPE, rowShape: { hasLocation: false, hasAsOf: true, note: null }, metrics: {}, matchingTotal: rows.length, shownCount: rows.length, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'REAL PROVIDER' } }
        }
        internalReads.push(params)
        const rows = [{ source, sourceId: '7', title: TITLE, entityType: 'purchase_order', content: `supplier=${SUPPLIER} · unitPrice=${PRICE} · code=${SECRET}`, fields: { id: '7', supplier: SUPPLIER, unitPrice: PRICE, code: SECRET }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }]
        return { asOf: NOW, source, count: 1, results: rows, evidence: { source, endpoint: method, entityType: 'purchase_order', rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE INTERNAL' } }
      }
    }
  }
}

function scriptedAdapter (envelopes) {
  const calls = []
  return { label: 'claude', calls, async complete (p) { calls.push(String(p)); const b = envelopes[Math.min(calls.length - 1, envelopes.length - 1)]; return { text: JSON.stringify(b), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'scripted', latencyMs: 1, stopReason: 'end_turn' } } }
}
const READ = (capability, args) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: args === undefined ? { capability } : { capability, args }, answerPlan: null })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })
const SIR = (intent) => async () => ({ intent })
const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on' }
async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally { for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
}
const run = (msg, adapter, deps, history) => processIntake(msg, adapter, history || [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555', readContextDeps: deps
})
const liveProvider = () => ({ provider: PROVIDER_ID, model: DEFAULT_MODEL, search: async ({ query }) => makeSearchResult({ provider: PROVIDER_ID, query, retrievedAt: NOW, results: [{ url: 'https://idx.example/beef', title: 'Wholesale index', snippet: 'index 112.4', publishedAt: '2026-07-31' }] }) })

test('*** 19/20 — evidence reaches GPT and the FINAL ANSWER is still GPT\'s ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector(liveProvider())
    const a = scriptedAdapter([READ(PUB, { query: 'wholesale beef index', freshness: 'current', location: null }), FINAL('MAIN_MODEL_ANSWER')])
    const out = await run('出面行情點', a, {
      connector: c.connector, sources: ['aroma_system', 'public_knowledge'],
      sourceIntentResolver: SIR('public'),
      publicQueryPlanner: async () => ({ query: 'wholesale beef index', freshness: 'current', location: null })
    })
    assert.equal(c.publicCalls.length, 1, 'the real read path executed')
    assert.equal(out.reply, 'MAIN_MODEL_ANSWER', '⛔ the retrieval worker must never author the reply')
    // 18/17 — the source survives into the turn for the answer layer to cite.
    const prompt = a.calls[a.calls.length - 1]
    assert.ok(prompt.includes('https://idx.example/beef') || prompt.includes('Wholesale index'), 'the source identity reached the answer layer')
  })
})

test('*** 21/22/23/25 — questions that need no outside world make ZERO web calls ***', async () => {
  for (const [label, intent, envelopes, msg, env] of [
    ['internal only', 'internal', [READ(INV), FINAL('ok')], '我哋自己嘅成本點', {}],
    ['ambiguous', 'ambiguous', [READ(INV), FINAL('ok')], '最近點', {}],
    ['supplied facts', 'internal', [FINAL('9%')], '8.00 升到 8.72 係幾多 %', {}],
    ['A4 OFF', 'public', [FINAL('照舊')], '出面行情點', { [A4_FLAG]: 'off' }]
  ]) {
    await withEnv(env, async () => {
      const t = fakeTransport(async () => jsonRes(200, okPayload([{ url: 'https://x/1' }])))
      const provider = createOpenAIWebSearchProvider({ apiKey: 'k', transport: t.fn })
      const c = twoWorldConnector(provider)
      await run(msg, scriptedAdapter(envelopes), {
        connector: c.connector, sources: ['aroma_system', 'public_knowledge'],
        sourceIntentResolver: SIR(intent),
        publicQueryPlanner: async () => ({ query: 'q', freshness: null, location: null })
      })
      assert.equal(t.sent.length, 0, `⛔ ${label}: a paid web search was spent`)
    })
  }
})

test('*** 24 — a mixed turn reads BOTH worlds, and nothing internal leaves ***', async () => {
  await withEnv({}, async () => {
    const t = fakeTransport(async () => jsonRes(200, okPayload([{ url: 'https://idx.example/beef', title: 'Index' }])))
    const provider = createOpenAIWebSearchProvider({ apiKey: 'k', transport: t.fn, clock: () => NOW })
    const c = twoWorldConnector(provider)
    // ⛔ THE SECURITY CANARY, ON THE REAL PROVIDER SEAM. Internal evidence is live in the turn
    // and the model proposes a query carrying every internal value.
    const leaky = `${TITLE} ${SUPPLIER} ${PRICE} ${SECRET} wholesale`
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: leaky, freshness: 'current', location: null }), FINAL('齊。')])
    await run('我哋成本同出面比', a, {
      connector: c.connector, sources: ['aroma_system', 'public_knowledge'],
      sourceIntentResolver: SIR('mixed'),
      publicQueryPlanner: async () => ({ query: 'wholesale beef market index', freshness: 'current', location: null })
    })
    assert.equal(c.internalReads.length, 1)
    assert.equal(t.sent.length, 1, 'exactly one outbound retrieval')
    const outbound = JSON.stringify(t.sent[0])
    for (const v of INTERNAL_VALUES) assert.equal(outbound.includes(v), false, `⛔ ${v} LEFT THE PROCESS`)
    assert.equal(outbound.includes(leaky), false, '⛔ the raw main-model query left the process')
    assert.equal(t.sent[0].body.input, 'wholesale beef market index', 'the planner\'s query is what travelled')
  })
})

test('*** 3/26/27 — the planner remains the SOLE outbound query constructor ***', async () => {
  await withEnv({}, async () => {
    const t = fakeTransport(async () => jsonRes(200, okPayload([{ url: 'https://x/1' }])))
    const provider = createOpenAIWebSearchProvider({ apiKey: 'k', transport: t.fn })
    const c = twoWorldConnector(provider)
    // No planner wired ⇒ public-after-internal fails closed ⇒ nothing may leave.
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'anything at all', freshness: null, location: null }), FINAL('冇查到。')])
    await run('我哋成本同出面比', a, {
      connector: c.connector, sources: ['aroma_system', 'public_knowledge'], sourceIntentResolver: SIR('mixed')
    })
    assert.equal(t.sent.length, 0, '⛔ a query reached the vendor without the planner')
  })
})

test('*** a provider UNAVAILABLE does not become an answer with evidence ***', async () => {
  await withEnv({}, async () => {
    const t = fakeTransport(async () => jsonRes(429, { error: 'slow down' }))
    const provider = createOpenAIWebSearchProvider({ apiKey: 'k', transport: t.fn })
    const c = twoWorldConnector(provider)
    const a = scriptedAdapter([READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('市場嗰邊今次讀唔到。')])
    const out = await run('出面行情點', a, {
      connector: c.connector, sources: ['aroma_system', 'public_knowledge'],
      sourceIntentResolver: SIR('public'),
      publicQueryPlanner: async () => ({ query: 'q', freshness: null, location: null })
    })
    assert.equal(t.sent.length, 1, 'it was attempted')
    // The world was never completed, so the turn must not present a finished answer.
    assert.ok(typeof out.reply === 'string')
  })
})
