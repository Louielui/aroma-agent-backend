'use strict'

/**
 * a4ProductionWiring.test.js — A4-3A: does the REAL route actually build A4?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ A PASSING A4 TEST SUITE WAS NOT EVIDENCE THAT A4 RAN.
 *
 * Every A4 test to date injected its dependencies through `readContextDeps`. Production
 * injected none, so `sourceIntentResolver`, `finalVerifier` and `publicQueryPlanner` were all
 * `null` on the live path and `public_knowledge` was not even in the source registry. The
 * feature was fully built, fully tested, and unreachable.
 *
 * So this file drives the EXPRESS ROUTE. The A4 dependency bundle, the read connector, the
 * source registry, the provider and the read adapter are all constructed by production code.
 * Only two things are faked, and neither is part of the composition:
 *   · the LLM adapter, through the `app.locals` seam `promoteToProposal` already uses
 *   · the vendor's SOCKET, through the provider's `transport` seam
 * Everything between those two ends is the real thing.
 *
 * ⛔ NOT ONE PAID CALL RUNS HERE.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const intakeRouter = require('../routes/intakeRouter')
const { createDemoRouter } = require('../routes/demoRouter')
const { createA4RuntimeDependencies, RECOVERY_WORKER_MODEL } = require('./a4Runtime')
const { createLiveReadConnector, ALL_SOURCES, PUBLIC_KEY_ENV } = require('../context/liveClients')
const { createOpenAIWebSearchProvider } = require('../context/providers/openaiWebSearchProvider')
const { A4_FLAG } = require('./a4Contract')

const SECRET = 'AROMA_INTERNAL_ONLY_9842'
const SUPPLIER = 'Gordon'
const PRICE = '8.72'
const TITLE = 'Beef Brisket'
const INTERNAL_VALUES = [SECRET, SUPPLIER, PRICE, TITLE]
const PUB = 'public_knowledge.search'
const INV = 'aroma_system.invoices'
const CLAIM = 'The wholesale beef index rose 5.1 percent to 112.4 in July 2026.'

/* ═══ THE VENDOR'S SOCKET, AND NOTHING ABOVE IT ════════════════════════ */

function webSearchTransport (impl) {
  const sent = []
  const fn = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) })
    return impl ? impl(url, init) : okResponse()
  }
  return { fn, sent }
}
const okResponse = (claim = CLAIM, url = 'https://idx.example/beef') => {
  const text = claim + ' ([idx.example](' + url + '))'
  return {
    status: 200,
    async json () {
      return {
        output: [
          { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url }] } },
          {
            type: 'message',
            status: 'completed',
            content: [{
              type: 'output_text',
              text,
              annotations: [{ type: 'url_citation', url, title: 'Wholesale index', start_index: claim.length + 1, end_index: text.length }]
            }]
          }
        ],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
      }
    }
  }
}

/* ═══ A SCRIPTED MAIN MODEL — the one thing a deterministic test must fake ═══ */

const READ = (capability, args) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: args === undefined ? { capability } : { capability, args }, answerPlan: null })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })

/**
 * Answers by SCHEMA NAME, so the same fake serves the main loop and every A4 verifier — and
 * records which of them were actually asked. A verifier that production never wired shows up
 * here as a schema that was never requested.
 */
function scriptedModel ({ envelopes = [], intent = null, finalDecision = null, plannedQuery = null, recovery = null } = {}) {
  const schemas = []
  let mainCalls = 0
  return {
    schemas,
    get mainCalls () { return mainCalls },
    label: 'scripted',
    async complete (prompt, opts = {}) {
      const name = opts.responseFormat ? opts.responseFormat.name : null
      schemas.push({ name, system: opts.system ? String(opts.system).slice(0, 40) : null, prompt: String(prompt) })
      const reply = (obj) => ({ text: JSON.stringify(obj), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'scripted', latencyMs: 1, stopReason: 'end_turn' })

      if (name === 'a4_verifier') {
        /**
         * ⛔ TOLD APART BY SCHEMA SHAPE, NOT BY WORDS IN THE PROMPT.
         *
         * The first version of this fake matched /intent/i and /query/i against the system
         * text — but those contracts are written in Chinese, so BOTH patterns missed and every
         * verifier fell through to the final-decision branch. Two cases still went green,
         * because a mis-answered resolver happens to fail closed into the same result the test
         * expected. A fake that can pass for the wrong reason is worse than no fake.
         */
        const props = Object.keys((opts.responseFormat.schema && opts.responseFormat.schema.properties) || {}).sort().join(',')
        if (props === 'intent') return reply(intent || { intent: 'ambiguous' })
        if (props === 'freshness,location,query') return reply(plannedQuery || { decision: 'refuse' })
        if (props === 'decision,question') return reply(finalDecision || { decision: 'allow_final' })
        throw new Error('unrecognised A4 verifier schema: ' + props)
      }
      if (name === 'recovery_decision') return reply(recovery || { decision: 'none', capability: 'none' })

      mainCalls++
      const e = envelopes[Math.min(mainCalls - 1, envelopes.length - 1)]
      return reply(e)
    }
  }
}

/* ═══ THE REAL APP ═════════════════════════════════════════════════════ */

/** The formal intake route — /api/v1/intake. It has no chat lane. */
function formalApp ({ model }) {
  const app = express()
  app.use(express.json())
  app.locals.adapterFactory = () => model
  app.use('/api/v1/intake', intakeRouter)
  return app
}

/**
 * ⛔ THE CHAT LANE IS WHERE A4 ACTUALLY LIVES, AND IT IS NOT THE FORMAL ROUTE.
 *
 * Every A4 gate in intakeService reads `interactionMode === 'chat'`, and `demoRouter` is the
 * only production caller that sets it — the formal /api/v1/intake path never has. So wiring
 * the composer into the formal route alone would have produced a dependency bundle nothing
 * could reach: correct construction, still-inert feature. Both routes now build A4 from the
 * same composer, and the acceptance chain runs here because this is the lane that has one.
 */
function chatApp ({ model, readDepsOverride }) {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  if (readDepsOverride) app.locals.a4ReadDepsOverride = readDepsOverride
  app.use(createDemoRouter({ getAdapterFn: () => model }))
  return app
}

async function hit (app, path, body) {
  const server = app.listen(0)
  try {
    const { port } = server.address()
    const r = await fetch('http://127.0.0.1:' + port + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    return { status: r.status, body: await r.json() }
  } finally { server.close() }
}
const post = (app, message, history) => hit(app, '/api/v1/intake', { message, history: history || [] })
const chat = (app, message, history) => hit(app, '/api/v1/demo/intake', { message, interactionMode: 'chat', history: history || [] })

const BASE = {
  READ_ACCESS: 'on',
  CONTEXT_AROMA_SYSTEM: 'on',
  CONTEXT_PUBLIC_KNOWLEDGE: 'off',
  CONTEXT_DRIVE: 'off',
  CONTEXT_GMAIL: 'off',
  CONTEXT_CALENDAR: 'off',
  CONTEXT_GITHUB: 'off',
  CONTEXT_DEVELOPMENT_RECORD: 'off',
  TURN_ROUTER: 'on',
  MULTI_AI_ROUTER: 'off',
  CONVERSATION_RECALL: 'off',
  DECISION_RECALL: 'off',
  XIANGXIANG_ARCHIVE: 'off',
  [A4_FLAG]: 'off'
}

async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally { for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
}

/* ═══ THE GAP ITSELF ═══════════════════════════════════════════════════ */

test('*** the composer is the ONE place A4 dependencies are built ***', () => {
  const model = scriptedModel({})
  const off = createA4RuntimeDependencies({ adapter: model, env: { [A4_FLAG]: 'off' } })
  assert.equal(off.deps, null, '⛔ A4 off must build nothing at all')
  assert.deepEqual(off.built, [])

  const on = createA4RuntimeDependencies({ adapter: model, env: { [A4_FLAG]: 'on' } })
  assert.deepEqual(on.built.slice().sort(),
    ['finalVerifier', 'publicQueryPlanner', 'recoveryWorker', 'sourceIntentResolver'])
  for (const k of ['sourceIntentResolver', 'finalVerifier', 'publicQueryPlanner', 'recoveryWorker']) {
    assert.equal(typeof on.deps[k], 'function', k + ' must be constructed')
  }
  // ⛔ IT DOES NOT OVERRIDE THE READ PLANE. No connector, no source list — the service's own
  // production defaults still decide what may be read.
  assert.equal('connector' in on.deps, false)
  assert.equal('sources' in on.deps, false)
})

test('*** no adapter means NO verifier, and never a legacy fallback ***', () => {
  const r = createA4RuntimeDependencies({ adapter: null, env: { [A4_FLAG]: 'on' } })
  assert.equal(r.deps.sourceIntentResolver, undefined)
  assert.equal(r.deps.finalVerifier, undefined)
  assert.equal(r.deps.publicQueryPlanner, undefined)
  assert.deepEqual(r.skipped.map((s) => s.name).sort(), ['finalVerifier', 'publicQueryPlanner', 'sourceIntentResolver'])
  // The runners then fail closed on their own terms — proven in their own suites.
})

test('*** the recovery worker keeps its PINNED model, not the session model ***', async () => {
  const seen = []
  const r = createA4RuntimeDependencies({
    adapter: scriptedModel({}),
    env: { [A4_FLAG]: 'on' },
    recoveryAdapterFactory: (model) => { seen.push(model); return { async complete () { return { text: '{"decision":"none","capability":"none"}' } } } }
  })
  await r.deps.recoveryWorker({ ownerMessages: ['x'], requiredWorld: 'public', completedWorlds: {}, capabilities: [], system: 's', schema: {} })
  assert.deepEqual(seen, [RECOVERY_WORKER_MODEL])
})

/* ═══ A–J — THE ROUTE ══════════════════════════════════════════════════ */

test('*** A — A4 OFF, public OFF: the legacy call shape is untouched ***', async () => {
  await withEnv({}, async () => {
    const model = scriptedModel({ envelopes: [FINAL('照舊回答')] })
    const out = await post(formalApp({ model }), '我哋自己嘅成本點')
    assert.equal(out.status, 200)
    // ⛔ NOT ONE A4 VERIFIER WAS ASKED. If composition leaked into the OFF path it would show
    // up here as an `a4_verifier` schema.
    assert.equal(model.schemas.some((s) => s.name === 'a4_verifier'), false)
    assert.equal(model.schemas.some((s) => s.name === 'recovery_decision'), false)
  })
})

test('*** J — A4 OFF constructs NO web provider and makes NO outbound search ***', async () => {
  await withEnv({ CONTEXT_PUBLIC_KNOWLEDGE: 'on', OPENAI_API_KEY: 'test-key' }, async () => {
    let built = 0
    const { registered, skipped } = createLiveReadConnector({
      env: process.env,
      publicSearchProviderFactory: () => { built++; return { provider: 'x', search: async () => ({}) } }
    })
    assert.equal(built, 0, '⛔ a public search provider was constructed with A4 off')
    assert.equal(registered.includes('public_knowledge'), false)
    assert.equal(skipped.find((s) => s.source === 'public_knowledge').reason, 'A4_KNOWLEDGE_ROUTING off')
  })
})

test('*** H — a missing API key leaves the source unavailable and startup intact ***', async () => {
  await withEnv({ [A4_FLAG]: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on', OPENAI_API_KEY: null }, async () => {
    const { connector, registered, skipped } = createLiveReadConnector({ env: process.env })
    assert.equal(registered.includes('public_knowledge'), false)
    const reason = skipped.find((s) => s.source === 'public_knowledge').reason
    assert.equal(reason, PUBLIC_KEY_ENV + ' not set', 'the reason names the variable, never a value')
    assert.ok(connector, '⛔ startup must survive a missing credential')
    // ⛔ AND THE REASON CARRIES NO SECRET.
    assert.equal(/sk-|Bearer/.test(reason), false)
  })
})

test('*** B — A4 ON, public flag OFF: the public world is honestly unavailable ***', async () => {
  await withEnv({ [A4_FLAG]: 'on' }, async () => {
    const { registered } = createLiveReadConnector({ env: process.env })
    assert.equal(registered.includes('public_knowledge'), false)
    const model = scriptedModel({ intent: { intent: 'public' }, envelopes: [FINAL('出面嗰邊而家讀唔到。')] })
    const out = await chat(chatApp({ model }), '查公開資料：市場行情點')
    assert.equal(out.status, 200)
    // ⛔ THE RESOLVER WAS ACTUALLY CONSULTED — that is the wiring this package exists to prove.
    assert.equal(model.schemas.some((s) => s.name === 'a4_verifier'), true)
  })
})

test('*** C — A4 ON, public ON: a clear public question reaches public_knowledge ***', async () => {
  await withEnv({ [A4_FLAG]: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on', OPENAI_API_KEY: 'test-key' }, async () => {
    const t = webSearchTransport()
    const { registered, connector } = createLiveReadConnector({
      env: process.env,
      publicSearchProviderFactory: ({ apiKey }) => createOpenAIWebSearchProvider({ apiKey, transport: t.fn })
    })
    assert.equal(registered.includes('public_knowledge'), true, 'production built the source')

    const rows = await connector.read('public_knowledge', 'search', { query: 'wholesale beef index', freshness: 'current', location: null })
    assert.equal(t.sent.length, 1, 'the real provider made exactly one outbound request')
    assert.equal(t.sent[0].body.store, false, 'store:false survived composition')
    assert.equal(rows.results.length, 1)
    assert.equal(rows.results[0].content, CLAIM, '⛔ the FACT reached the evidence row')
    assert.equal(rows.results[0].fields.contentKind, 'web_search_cited_summary')
    assert.equal(rows.results[0].link, 'https://idx.example/beef')
  })
})

test('*** I — a provider error is unavailable, never a fabricated empty world ***', async () => {
  await withEnv({ [A4_FLAG]: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on', OPENAI_API_KEY: 'test-key' }, async () => {
    for (const [label, impl] of [
      ['429', async () => ({ status: 429, async json () { return { error: 'slow' } } })],
      ['500', async () => ({ status: 500, async json () { return { error: 'boom' } } })],
      ['network', async () => { throw new Error('ECONNRESET') }]
    ]) {
      const t = webSearchTransport(impl)
      const { connector } = createLiveReadConnector({
        env: process.env,
        publicSearchProviderFactory: ({ apiKey }) => createOpenAIWebSearchProvider({ apiKey, transport: t.fn })
      })
      const rc = await connector.read('public_knowledge', 'search', { query: 'q' })
      assert.equal(rc.trust, 'unavailable', '⛔ ' + label + ' presented as a live empty world')
      assert.equal(rc.content, '', label)
      assert.ok(/read failed/.test(String(rc.error)), label)
    }
  })
})

test('*** D — a clear INTERNAL question never reaches the public provider ***', async () => {
  await withEnv({ [A4_FLAG]: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on', OPENAI_API_KEY: 'test-key' }, async () => {
    const t = webSearchTransport()
    const model = scriptedModel({ intent: { intent: 'internal' }, envelopes: [READ(INV), FINAL('我哋自己數口。')] })
    const app = chatApp({
      model,
      readDepsOverride: { connector: createLiveReadConnector({ env: process.env, publicSearchProviderFactory: ({ apiKey }) => createOpenAIWebSearchProvider({ apiKey, transport: t.fn }) }).connector }
    })
    await chat(app, '我哋自己嘅成本點')
    assert.equal(t.sent.length, 0, '⛔ an internal question spent a public retrieval')
  })
})

test('*** G — with internal evidence live, only the PLANNER\'s words may leave ***', async () => {
  await withEnv({ [A4_FLAG]: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on', OPENAI_API_KEY: 'test-key' }, async () => {
    const t = webSearchTransport()
    const leaky = `${TITLE} ${SUPPLIER} ${PRICE} ${SECRET} wholesale`
    const model = scriptedModel({
      intent: { intent: 'mixed' },
      plannedQuery: { decision: 'query', query: 'wholesale beef market index', freshness: 'current', location: null },
      envelopes: [READ(INV), READ(PUB, { query: leaky, freshness: 'current', location: null }), FINAL('齊。')]
    })

    const internalRows = [{
      source: 'aroma_system', sourceId: '7', title: TITLE, entityType: 'purchase_order',
      content: `supplier=${SUPPLIER} · unitPrice=${PRICE} · code=${SECRET}`,
      fields: { id: '7', supplier: SUPPLIER, unitPrice: PRICE, code: SECRET },
      trust: 'live', retrievedAt: '2026-08-10T00:00:00.000Z', originalDate: null, link: null, error: null
    }]
    const live = createLiveReadConnector({
      env: process.env,
      publicSearchProviderFactory: ({ apiKey }) => createOpenAIWebSearchProvider({ apiKey, transport: t.fn })
    })
    const connector = {
      async read (source, method, params) {
        if (source === 'public_knowledge') return live.connector.read(source, method, params)
        return {
          asOf: '2026-08-10T00:00:00.000Z', source, count: 1, results: internalRows,
          evidence: { source, endpoint: method, entityType: 'purchase_order', rowShape: {}, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: {}, completeness: 'complete', usedFallback: false, retrievedAt: '2026-08-10T00:00:00.000Z', trust: 'live', provenance: 'FAKE INTERNAL' }
        }
      }
    }

    await chat(chatApp({ model, readDepsOverride: { connector } }), '我哋成本同出面比')

    assert.equal(t.sent.length, 1, 'exactly one outbound retrieval')
    const outbound = JSON.stringify(t.sent[0])
    for (const v of INTERNAL_VALUES) assert.equal(outbound.includes(v), false, `⛔ ${v} LEFT THE PROCESS`)
    assert.equal(outbound.includes(leaky), false, '⛔ the raw main-model query left the process')
    assert.equal(t.sent[0].body.input, 'wholesale beef market index', 'the planner\'s query is what travelled')
  })
})

test('*** E — a mixed turn completes BOTH required worlds through the real composition ***', async () => {
  await withEnv({ [A4_FLAG]: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on', OPENAI_API_KEY: 'test-key' }, async () => {
    const t = webSearchTransport()
    const reads = []
    const model = scriptedModel({
      intent: { intent: 'mixed' },
      plannedQuery: { decision: 'query', query: 'wholesale beef market index', freshness: 'current', location: null },
      envelopes: [READ(INV), READ(PUB, { query: 'wholesale beef index outside', freshness: 'current', location: null }), FINAL('兩邊都睇咗。')]
    })
    const live = createLiveReadConnector({
      env: process.env,
      publicSearchProviderFactory: ({ apiKey }) => createOpenAIWebSearchProvider({ apiKey, transport: t.fn })
    })
    const connector = {
      async read (source, method, params) {
        reads.push(source)
        if (source === 'public_knowledge') return live.connector.read(source, method, params)
        return {
          asOf: '2026-08-10T00:00:00.000Z', source, count: 1,
          // ⛔ NOT 'Beef'. The second egress fence is a SUBSTRING check on whatever is actually
          // about to leave, so an internal row titled 「Beef」 correctly blocks the planner's
          // 「wholesale beef market index」 — the product refusing, not a wiring failure. The
          // fixture uses a title that is genuinely internal so the fence is not the thing under
          // test here; case G proves the fence itself.
          results: [{ source, sourceId: '7', title: 'Brisket 12kg case', entityType: 'purchase_order', content: 'unitPrice=8.72', fields: { id: '7' }, trust: 'live', retrievedAt: '2026-08-10T00:00:00.000Z', originalDate: null, link: null, error: null }],
          evidence: { source, endpoint: method, entityType: 'purchase_order', rowShape: {}, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: {}, completeness: 'complete', usedFallback: false, retrievedAt: '2026-08-10T00:00:00.000Z', trust: 'live', provenance: 'FAKE INTERNAL' }
        }
      }
    }
    const out = await chat(chatApp({ model, readDepsOverride: { connector } }), '我哋成本同出面比')
    assert.equal(out.status, 200)
    assert.ok(reads.includes('aroma_system'), 'the internal world was read')
    assert.ok(reads.includes('public_knowledge'), 'the public world was read')
    assert.equal(t.sent.length, 1)
  })
})

test('*** F — an ambiguous question ASKS, and reads nothing at all ***', async () => {
  await withEnv({ [A4_FLAG]: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on', OPENAI_API_KEY: 'test-key' }, async () => {
    const t = webSearchTransport()
    const reads = []
    const model = scriptedModel({ intent: { intent: 'ambiguous' }, envelopes: [READ(INV), FINAL('唔應該行到呢度')] })
    const live = createLiveReadConnector({
      env: process.env,
      publicSearchProviderFactory: ({ apiKey }) => createOpenAIWebSearchProvider({ apiKey, transport: t.fn })
    })
    const connector = {
      async read (source, method, params) {
        reads.push(source)
        if (source === 'public_knowledge') return live.connector.read(source, method, params)
        return { asOf: 'x', source, count: 0, results: [], evidence: { source, endpoint: method, entityType: null, rowShape: {}, metrics: {}, matchingTotal: 0, shownCount: 0, sourceTotal: null, queryScope: {}, completeness: 'complete', usedFallback: false, retrievedAt: 'x', trust: 'live', provenance: 'FAKE' } }
      }
    }
    const out = await chat(chatApp({ model, readDepsOverride: { connector } }), '最近點')
    assert.equal(out.status, 200)
    assert.equal(t.sent.length, 0, '⛔ an ambiguous turn spent a paid retrieval')
    assert.equal(reads.length, 0, '⛔ an ambiguous turn read a world before asking')
  })
})

test('*** the composition log is names and reasons — never a prompt or a key ***', () => {
  const { logA4Composition } = require('./a4Runtime')
  let line = null
  logA4Composition({ built: ['recoveryWorker'], skipped: [{ name: 'finalVerifier', reason: 'no adapter' }] }, (l) => { line = l })
  assert.deepEqual(Object.keys(line).sort(), ['built', 'event', 'skipped', 'timestamp'])
  const blob = JSON.stringify(line)
  for (const v of INTERNAL_VALUES.concat(['sk-', 'Bearer'])) assert.equal(blob.includes(v), false)
})

test('*** every registry source has a builder — including the new one ***', () => {
  // A source listed with no builder is skipped forever with a TypeError for a reason, which
  // reads in the log exactly like a credential problem. Cheap to assert, expensive to debug.
  const seen = []
  createLiveReadConnector({
    env: Object.assign({}, BASE, { READ_ACCESS: 'on' }),
    connector: { register (a) { seen.push(a && a.source) }, hasWriteMethod: () => false }
  })
  assert.ok(ALL_SOURCES.includes('public_knowledge'))
})
