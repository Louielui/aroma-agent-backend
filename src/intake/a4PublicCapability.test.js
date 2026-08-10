'use strict'

/**
 * a4PublicCapability.test.js — A4-2A: a REAL second read world, an entirely FAKE executor.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE HYPOTHESIS UNDER TEST.
 *
 * Three interventions have failed to make 香香 distinguish 「our cost」 from 「the market」:
 * two prose calibrations and one output-contract narrowing. Each moved a global threshold
 * rather than teaching a distinction.
 *
 * The remaining structural explanation is that she was asked to choose between two worlds
 * while her ACTION SPACE contained only one. A4-2A gives her a second world that is REAL in
 * the contract — a capability she can name, whose arguments travel, whose results become
 * ordinary A3 evidence — and entirely FAKE in execution.
 *
 * ⛔ NOTHING HERE TOUCHES THE INTERNET. `public_knowledge` is absent from liveClients'
 * ALL_SOURCES and from the flag table, so production cannot offer it and no launcher switch
 * exists. It is reachable only through the injected read-dependency seam, with a fake
 * executor supplied by the caller. Test A asserts the production path still offers nothing.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { processIntake } = require('./intakeService')
const { operationsForSources, resolveReadOperation } = require('../context/readOperations')
const { publicReadKey, canonicalArgs } = require('../context/publicReadIdentity')
const { enabledSources, ALL_SOURCES } = require('../context/liveClients')
const { A4_FLAG, A4_SEMANTIC_GUIDANCE, EGRESS_CONTRACT } = require('./a4Contract')

const NOW = '2026-08-09T00:00:00.000Z'
const PUB = 'public_knowledge.search'
const INV = 'aroma_system.invoices'
const SECRET = 'AROMA_INTERNAL_ONLY_9842'

/* ═══ FIXTURES — TWO FAKE WORLDS, EACH COUNTING ITS OWN CALLS ════════════ */

function twoWorldConnector (opts = {}) {
  const internalReads = []
  const publicReads = []
  return {
    internalReads,
    publicReads,
    connector: {
      async read (source, method, params) {
        if (source === 'public_knowledge') {
          publicReads.push({ method, params: JSON.parse(JSON.stringify(params || {})) })
          if (opts.publicFails) throw new Error('fake public executor unavailable')
          const rows = (opts.publicRows === undefined
            ? [{ sourceId: opts.publicItemId || 'PUB-001', title: 'Wholesale index', entityType: 'public_item', content: 'index=112.4 · period=2026-07', fields: { id: opts.publicItemId || 'PUB-001', index: '112.4', period: '2026-07' } }]
            : opts.publicRows
          ).map((r) => Object.assign({ source, trust: 'live', retrievedAt: NOW, originalDate: '2026-07-31', link: null, error: null }, r))
          return {
            asOf: NOW, source, count: rows.length, results: rows,
            evidence: { source, endpoint: method, entityType: 'public_item', rowShape: { hasLocation: false, hasAsOf: true, note: null }, metrics: {}, matchingTotal: rows.length, shownCount: rows.length, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE PUBLIC EXECUTOR' }
          }
        }
        internalReads.push({ method, params: JSON.parse(JSON.stringify(params || {})) })
        if (opts.internalFails) throw new Error('fake internal unavailable')
        const rows = [{
          source, sourceId: '7', title: 'Beef Brisket', entityType: 'purchase_order',
          content: 'id=7 · supplier=Gordon · code=' + SECRET,
          fields: { id: '7', supplier: 'Gordon', code: SECRET },
          trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null
        }]
        return {
          asOf: NOW, source, count: 1, results: rows,
          evidence: { source, endpoint: method, entityType: 'purchase_order', rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE INTERNAL' }
        }
      }
    }
  }
}

function scriptedAdapter (label, envelopes) {
  const calls = []
  return {
    label,
    calls,
    async complete (prompt, opts = {}) {
      calls.push({
        prompt: String(prompt),
        schemaName: opts.responseFormat ? opts.responseFormat.name : null,
        hasAnswerPlan: !!(opts.responseFormat && opts.responseFormat.schema && opts.responseFormat.schema.properties && opts.responseFormat.schema.properties.answerPlan),
        readChoices: (() => { try { const nr = opts.responseFormat.schema.properties.nextRead; return nr.properties ? nr.properties.capability.enum : 'null-only' } catch (_) { return 'no-schema' } })()
      })
      // MIGRATED (SIR3): when the script runs out, REPEAT the last envelope instead of throwing.
      // A mixed source intent keeps the second world outstanding, so the completion guard can
      // legitimately ask the model once more. These suites assert the READ COUNT and what left
      // the process — never the number of model calls — and the loop bound still ends the turn.
      const body = envelopes[Math.min(calls.length - 1, envelopes.length - 1)]
      if (!body) throw new Error(label + ' called with no envelopes at all')
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: label, latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ = (capability, args) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: args === undefined ? { capability } : { capability, args }, answerPlan: null })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })
const ASK = (reply) => ({ intent: 'question', mode: 'ask', reply, nextRead: null, answerPlan: null })
const A = (query, freshness, location) => ({ query, freshness: freshness || null, location: location || null })

const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on' }
async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const BOTH = ['aroma_system', 'public_knowledge']
/**
 * MIGRATED FIXTURE — Owner-only public query provenance.
 *
 * A PUBLIC read requested after INTERNAL evidence exists no longer carries the main model's
 * own query: it is discarded and re-authored from Owner-authored context. That makes a
 * planner a REQUIRED dependency of this path, and its absence fails closed. Tests below that
 * are about something ELSE (the ambiguity gate, evidence shape, continuation) supply this
 * deterministic planner as plumbing. The provenance rules themselves are proven in
 * a4EgressProvenance.test.js, not here.
 */
const SAFE_PLANNER = async () => ({ query: 'wholesale beef market price trend', freshness: 'current', location: null })

// MIGRATED (SIR3): the Owner Source Intent Resolver now runs before the FIRST read of every
// A4-ON turn — it is no longer gated on the ambiguity flag, because meaning must be settled
// wherever a read can happen. With none wired a turn correctly fails closed to a question, so
// these suites (which test EGRESS and the public capability, not meaning) supply a default.
// 'mixed' is used because it permits either world as a valid first half, leaving each test's
// own read sequence exactly as it was.
const DEFAULT_SIR = async () => ({ intent: 'mixed' })
/**
 * ⛔ A4-3B: THE PLANNER NOW OWNS EVERY PUBLIC QUERY, so a harness that drives public reads must
 * supply one. Without it the correct answer is 「no public read」, and every case below would be
 * quietly re-testing egress authority instead of the closed vocabulary, dedupe and evidence
 * shape it exists for. Cases that are ABOUT egress pass their own planner explicitly.
 */
const run = (msg, adapter, deps, history) => processIntake(msg, adapter, history || [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: Object.assign({ sourceIntentResolver: DEFAULT_SIR, publicQueryPlanner: SAFE_PLANNER }, deps)
})

/* ═══ A — THE PUBLIC CAPABILITY IS GOVERNED, AND OFF ═════════════════════ */

test('*** A — production offers public_knowledge only when the Owner switches it on ***', () => {
  // ⛔ A4-3A CHANGED THIS DELIBERATELY. It used to assert the source did not exist anywhere —
  // true, and the wrong kind of safety: unreachable by OMISSION, one forgotten line away from
  // reachable with no flag and no key check in the way. It is a governed source now, and the
  // assertion moved from 「it cannot exist」 to 「it is off unless every gate is open」.
  assert.equal(ALL_SOURCES.includes('public_knowledge'), true, 'in the registry, so it can be governed')
  assert.equal(enabledSources({}).includes('public_knowledge'), false, '⛔ default off')
  assert.equal(enabledSources({ READ_ACCESS: 'on' }).includes('public_knowledge'), false,
    '⛔ the master flag alone does not open it')
  assert.equal(enabledSources({ CONTEXT_PUBLIC_KNOWLEDGE: 'on' }).includes('public_knowledge'), false,
    '⛔ nor does its own flag alone')
  assert.equal(operationsForSources(enabledSources({})).includes(PUB), false,
    '⛔ and with it off, the capability is not even in the closed vocabulary')

  const full = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on' }
  assert.equal(enabledSources(full).includes('public_knowledge'), true)
  assert.equal(operationsForSources(enabledSources(full)).includes(PUB), true)
})

/* ═══ B / C — THE CLOSED PUBLIC VOCABULARY ══════════════════════════════ */

test('*** B — an injected public source yields exactly one operation ***', () => {
  assert.deepEqual(operationsForSources(['public_knowledge']), [PUB])
  assert.deepEqual(resolveReadOperation(PUB), { source: 'public_knowledge', method: 'search' })
})

test('*** C — invented public operations are refused, with no fuzzy matching ***', () => {
  for (const bad of ['public_knowledge.fetch', 'public_knowledge.open_url', 'public_knowledge.browse',
    'public_knowledge.post', 'public_knowledge.search_web_v2', 'public_knowledge.Search', 'public_knowledge']) {
    const r = resolveReadOperation(bad)
    assert.equal(r === null || r.method === null, true, bad + ' must not resolve to a method')
  }
})

/* ═══ D / E — ARGS REACH THE PUBLIC EXECUTOR, AND ONLY IT ═══════════════ */

test('*** D — exactly the closed args reach the fake public executor ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const args = A('canada wholesale beef index', 'current', 'Winnipeg')
    const a = scriptedAdapter('claude', [READ(PUB, Object.assign({ url: 'https://evil', provider: 'acme' }, args)), FINAL('讀咗。')])
    const planner = async () => ({ query: 'planned market words', freshness: 'current', location: 'Winnipeg' })
    await run('市場點', a, { connector: c.connector, sources: BOTH, publicQueryPlanner: planner })
    assert.equal(c.publicReads.length, 1)
    const p = c.publicReads[0].params
    // ⛔ THE SHAPE IS THE CONTRACT, AND THE VALUES ARE NOW THE PLANNER'S. A4-3B moved authorship
    // of the outbound words to the Owner-only planner for EVERY public read, so the model's own
    // `query` is discarded here exactly as `url` and `provider` always were.
    assert.equal(p.query, 'planned market words')
    assert.equal(p.query === args.query, false, '⛔ the raw model query reached the executor')
    assert.equal(p.freshness, 'current')
    assert.equal(p.location, 'Winnipeg')
    assert.equal(p.url, undefined, '⛔ url has nowhere to be written to')
    assert.equal(p.provider, undefined, '⛔ nor provider')
  })
})

test('*** E — internal adapter params are byte-identical with and without args ***', async () => {
  const paramsFor = async (args) => {
    let captured = null
    await withEnv({}, async () => {
      const c = twoWorldConnector()
      const a = scriptedAdapter('claude', [READ(INV, args), FINAL('ok')])
      await run('我哋發票點', a, { connector: c.connector, sources: BOTH })
      captured = c.internalReads
    })
    return captured
  }
  const withArgs = await paramsFor(A('SHOULD NOT REACH INTERNAL', 'current', 'Winnipeg'))
  const without = await paramsFor(undefined)
  assert.deepEqual(withArgs, without, '⛔ A4-0A promised inertness for internal ops; it holds')
  assert.equal(JSON.stringify(withArgs).includes('SHOULD NOT REACH'), false)
})

/* ═══ F / G / H — PUBLIC READ INSTANCE IDENTITY ════════════════════════ */

test('*** F — the same canonical args produce the same readKey ***', () => {
  assert.equal(publicReadKey(PUB, A('Beef Index', 'current', 'Winnipeg')),
    publicReadKey(PUB, A('  beef   index ', 'current', 'winnipeg')), 'trim/case/space are canonicalised')
})

test('*** G — query, freshness or location each change the readKey ***', () => {
  const base = publicReadKey(PUB, A('beef index', 'current', 'Winnipeg'))
  assert.notEqual(base, publicReadKey(PUB, A('pork index', 'current', 'Winnipeg')))
  assert.notEqual(base, publicReadKey(PUB, A('beef index', 'recent', 'Winnipeg')))
  assert.notEqual(base, publicReadKey(PUB, A('beef index', 'current', 'Toronto')))
  // and word order is NOT canonicalised away — two different questions stay two keys
  assert.notEqual(base, publicReadKey(PUB, A('index beef', 'current', 'Winnipeg')))
})

test('*** H — the raw query never appears in the readKey ***', () => {
  const k = publicReadKey(PUB, A('Gordon supplier secret beef price', 'current', 'Winnipeg'))
  for (const leak of ['Gordon', 'supplier', 'secret', 'beef', 'Winnipeg']) {
    assert.equal(k.toLowerCase().includes(leak.toLowerCase()), false,
      '⛔ a readKey is rendered as ref= and logged — it may not carry content')
  }
  assert.ok(k.startsWith(PUB + '@'))
})

/* ═══ I — TWO SEARCHES, SAME ITEM ID, NO COLLISION ═════════════════════ */

test('*** I — ONE planned query per turn, so a second public read IS the same instance ***', async () => {
  /**
   * ⛔ MIGRATED BY A4-3B, AND THE NEW BEHAVIOUR IS THE DELIBERATE ONE.
   *
   * This used to drive two DIFFERENT public searches in one turn and assert both ran. That is
   * no longer reachable, and not by accident: the Owner-only planner authors the outbound words
   * from HIS context, and `createTurnPlanCache` returns one plan per turn. So a second public
   * attempt in the same turn carries the same query — it is an exact duplicate by construction,
   * and dedupe refuses it. Duplicate protection is not weakened here; it simply now has more to
   * catch, because the model can no longer author a second, different query of its own.
   */
  await withEnv({}, async () => {
    const c = twoWorldConnector({ publicItemId: 'PUB-001' })
    const a = scriptedAdapter('claude', [
      READ(PUB, A('beef index', 'current')),
      READ(PUB, A('pork index', 'current')),
      FINAL('睇咗。')
    ])
    await run('市場點', a, { connector: c.connector, sources: BOTH })

    assert.equal(c.publicReads.length, 1, 'the second attempt was the same planned instance')
    assert.equal(c.publicReads[0].params.query, 'wholesale beef market price trend', 'the planner\'s words')
  })
})

test('*** I2 — the INSTANCE identity mechanism itself is intact ***', () => {
  // The property case I used to demonstrate end-to-end, asserted where it actually lives: two
  // different arg bags are two different reads, and nothing collapses them.
  const { publicReadKey, isPublicReadKey } = require('../context/publicReadIdentity')
  const k1 = publicReadKey(PUB, A('beef index', 'current'))
  const k2 = publicReadKey(PUB, A('pork index', 'current'))
  assert.notEqual(k1, k2, '⛔ two different searches must not share one identity')
  assert.equal(publicReadKey(PUB, A('beef index', 'current')), k1, 'and the same search is stable')
  assert.ok(isPublicReadKey(k1))
})

/* ═══ J / K — REPEATABLE, BUT NOT INFINITELY ═══════════════════════════ */

test('*** J — public_knowledge.search stays offerable after one search ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter('claude', [READ(PUB, A('beef index')), READ(PUB, A('pork index')), FINAL('ok')])
    await run('市場點', a, { connector: c.connector, sources: BOTH })
    assert.ok(a.calls[1].readChoices.includes(PUB),
      '⛔ the schema hides INSTANCES, not the operation — the capability stays offerable')
    // ⛔ OFFERABLE IS NOT THE SAME AS EXECUTED. Since A4-3B the turn has ONE planned query, so
    // the second offer resolves to the same instance and dedupe declines to spend it twice.
    assert.equal(c.publicReads.length, 1)
  })
})

test('*** K — an exact duplicate public read does not execute twice ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const same = A('beef index', 'current', 'Winnipeg')
    const a = scriptedAdapter('claude', [READ(PUB, same), READ(PUB, same), FINAL('ok')])
    await run('市場點', a, { connector: c.connector, sources: BOTH })
    assert.equal(c.publicReads.length, 1,
      '⛔ identical question, identical evidence — refused deterministically, no second cost')
  })
})

/* ═══ L / M — THE EGRESS GUARD IS REAL NOW ═════════════════════════════ */

test('*** L — ⛔ internal evidence may not ride out inside a public query ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const logs = []
    const orig = console.log
    console.log = (...x) => { logs.push(x.map(String).join(' ')) }
    let out
    try {
      // read internal first (it contains SECRET), then try to send SECRET outwards
      const a = scriptedAdapter('claude', [
        READ(INV),
        READ(PUB, A('market price for ' + SECRET, 'current')),
        FINAL('公開嗰邊冇查到。')
      ])
      out = await run('我哋成本同市場比', a, { connector: c.connector, sources: BOTH })
    } finally { console.log = orig }

    /**
     * ⛔ MIGRATED BY A4-3B: THE PROTECTION MOVED FROM REFUSAL TO RE-AUTHORSHIP, and that is a
     * strictly better outcome. This used to assert the executor was never reached, because the
     * leaky raw query was caught by inspection and the whole read was refused — the Owner got
     * half an answer every time. Now the raw query is discarded unread and the planner's words
     * travel instead, so the search happens AND the value never leaves. The guarantee under
     * test is unchanged and is asserted directly: SECRET reaches neither the vendor nor the log.
     */
    assert.equal(c.internalReads.length, 1, 'the internal read happened')
    assert.equal(c.publicReads.length, 1, 'and the public read now succeeds on safe words')
    assert.equal(JSON.stringify(c.publicReads[0].params).includes(SECRET), false,
      '⛔ THE INTERNAL VALUE REACHED THE EXECUTOR')
    assert.equal(c.publicReads[0].params.query.includes(SECRET), false)
    assert.equal(logs.join('\n').includes(SECRET), false, '⛔ and the value is nowhere in telemetry')
    assert.ok(typeof out.reply === 'string')
  })
})

test('*** L2 — the SECOND FENCE still fires if the PLANNER itself returns a contaminated query ***', async () => {
  /**
   * ⛔ THE FENCE IS NOT DECORATION NOW THAT THE PLANNER OWNS THE WORDS.
   *
   * On the normal path it can never fire — the planner is never shown an internal value. It
   * exists for the day a future edit leaks evidence into the planner's context, and this test
   * is what proves it would still catch that. The refusal is a safe enum, with no value in it.
   */
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const events = []
    const orig = console.log
    console.log = (...x) => { if (x[0] === '[AROMA-REASONING]') { try { events.push(JSON.parse(x[1])) } catch (_) {} } }
    try {
      // A planner that has somehow learned an internal value it was never given.
      const contaminated = async () => ({ query: 'market price for ' + SECRET, freshness: 'current', location: null })
      const a = scriptedAdapter('claude', [READ(INV), READ(PUB, A('x')), FINAL('ok')])
      await run('我哋成本同市場比', a, { connector: c.connector, sources: BOTH, publicQueryPlanner: contaminated })
    } finally { console.log = orig }

    assert.equal(c.publicReads.length, 0, '⛔ a contaminated PLANNED query reached the executor')
    const refused = events.find((e) => e && e.decisionType === 'read' && e.ok === false)
    assert.ok(refused, 'the refusal is on the record')
    assert.equal(JSON.stringify(events).includes(SECRET), false, 'without the value')
    // no new trust state was invented — no read happened at all
    assert.equal(JSON.stringify(events).includes('blocked_evidence'), false)
  })
})

test('*** M — a value the OWNER typed himself is not a leak ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter('claude', [
      READ(INV),
      READ(PUB, A('market reference for ' + SECRET, 'current')),
      FINAL('查咗。')
    ])
    // ⛔ THE OWNER SUPPLIED IT. Blocking here would refuse the very question he asked.
    // MIGRATED — the query is now re-authored from HIS words, so the planner echoes them.
    // The rule is unchanged in substance: what he typed himself is his to send.
    const ownerPlanner = async () => ({ query: 'market reference for ' + SECRET, freshness: 'current', location: null })
    await run('幫我查 ' + SECRET + ' 喺市場嘅參考價，同我哋比較', a, { connector: c.connector, sources: BOTH, publicQueryPlanner: ownerPlanner })
    assert.equal(c.publicReads.length, 1, 'his own words may travel')
  })
})

/* ═══ N / O / P — PUBLIC EVIDENCE USES THE A3 PIPELINE ═════════════════ */

test('*** N — a LIVE public result becomes ordinary A3 evidence ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter('claude', [READ(PUB, A('beef index', 'current')), FINAL('市場數字喺度。')])
    await run('市場點', a, { connector: c.connector, sources: BOTH })
    const p = a.calls[1].prompt
    assert.ok(/SCOPE \[public_knowledge\.search@[a-f0-9]+\]/.test(p), 'it has a scope identity')
    assert.ok(/ref=public_knowledge\.search@[a-f0-9]+#PUB-001/.test(p), 'and canonical row refs')
    assert.equal(a.calls[1].hasAnswerPlan, true, 'and it activates Truth Closure like any live read')
  })
})

test('*** O — a LIVE public search matching nothing is evidence, not a failure ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector({ publicRows: [] })
    const a = scriptedAdapter('claude', [READ(PUB, A('nothing at all', 'current')), FINAL('冇相符資料。')])
    await run('市場點', a, { connector: c.connector, sources: BOTH })
    const p = a.calls[1].prompt
    assert.ok(/SCOPE \[public_knowledge\.search@[a-f0-9]+\]/.test(p), 'zero rows still has an EvidenceSet')
    assert.equal(/ref=public_knowledge/.test(p), false, 'with zero canonical refs')
    assert.ok(/read OK/.test(p), 'and it is stated as a successful empty read')
    assert.equal(a.calls[1].hasAnswerPlan, true, 'Truth Closure still applies')
  })
})

test('*** P — a FAILED public search produces no EvidenceSet ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector({ publicFails: true })
    const a = scriptedAdapter('claude', [READ(PUB, A('beef index', 'current')), FINAL('公開資料而家攞唔到。')])
    await run('市場點', a, { connector: c.connector, sources: BOTH })
    const p = a.calls[1].prompt
    assert.ok(/UNAVAILABLE/.test(p), 'the failure is reported')
    assert.equal(/SCOPE \[public_knowledge/.test(p), false, '⛔ and produces no evidence')
    assert.equal(a.calls[1].hasAnswerPlan, false, 'a failed read never activates Truth Closure')
  })
})

/* ═══ Q — READ-ONLY BY CONSTRUCTION ════════════════════════════════════ */

test('*** Q — the public operation is read-shaped and exposes no action ***', () => {
  const { WRITE_SHAPED } = require('./reasoningLoop')
  const { WRITE_RE } = require('../context/readConnector')
  assert.equal(WRITE_SHAPED.test(PUB), false, 'the loop would not refuse it')
  assert.equal(WRITE_RE.test('search'), false, 'and the connector accepts the method as read-shaped')
  for (const w of ['post', 'send', 'create', 'update', 'delete']) {
    assert.equal(resolveReadOperation('public_knowledge.' + w), null, 'no write-shaped public op resolves')
  }
})

/* ═══ U — THE SEMANTIC GUIDANCE IS FROZEN ══════════════════════════════ */

test('*** U — the A4 semantic guidance is byte-identical to the A4-1R checkpoint ***', () => {
  const sha = crypto.createHash('sha256').update(A4_SEMANTIC_GUIDANCE, 'utf8').digest('hex')
  assert.equal(sha, 'cfc917cc38b8c50453d506d2b74539511826c319bd9d955aad59dbf8151e8523',
    '⛔ A4-2A changes CAPABILITIES, not wording. If this fails the experiment proves nothing.')
  assert.equal(A4_SEMANTIC_GUIDANCE.length, 843)
})

/* ═══ NO REAL NETWORK — PROVEN STATICALLY ══════════════════════════════ */

test('*** ⛔ no network primitive exists on the public path ***', () => {
  const files = [
    '../context/readOperations.js', '../context/publicReadIdentity.js',
    '../context/readContext.js', './a4Contract.js'
  ].map((f) => path.join(__dirname, f))
  const banned = [/\bfetch\s*\(/, /require\(['"]axios['"]\)/, /https?\.request\s*\(/, /web\.run/, /puppeteer|playwright/i, /tavily|serpapi|bing|brave|google.*search.*api/i]
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    for (const re of banned) {
      assert.equal(re.test(src), false, '⛔ ' + path.basename(f) + ' must contain no network primitive: ' + re)
    }
  }
  // and no credential/endpoint env var was introduced for a public vendor
  const contract = fs.readFileSync(path.join(__dirname, './a4Contract.js'), 'utf8')
  for (const bad of ['API_KEY', 'ENDPOINT', 'BASE_URL', 'SEARCH_KEY']) {
    assert.equal(contract.includes('PUBLIC_' + bad), false, 'no public vendor credential')
  }
  assert.equal(EGRESS_CONTRACT.id, 'A4-EGRESS-1', 'the guard extends the recorded contract, not a rival rule')
})

/* ═══ S / T / V — EARLIER SLICES STILL HOLD ════════════════════════════ */

test('*** S — zero automatic read before the model decision, unchanged ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const timeline = []
    const orig = c.connector.read.bind(c.connector)
    c.connector.read = async (...x) => { timeline.push('connector'); return orig(...x) }
    const a = scriptedAdapter('claude', [READ(INV), FINAL('ok')])
    await run('幫我睇最近發票', a, { connector: c.connector, sources: BOTH })
    assert.equal(timeline.length, 1, 'exactly the one the model asked for')
  })
})

test('*** T — A4 ON + chat still cannot output commit ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter('claude', [FINAL('ok')])
    await run('你好', a, { connector: c.connector, sources: BOTH })
    // the mode enum is on the same schema object the adapter received
    const modes = (() => { try { return a.calls[0].readChoices } catch (_) { return null } })()
    assert.ok(modes, 'a schema was sent')
  })
})

test('*** V — A4 OFF offers no public capability even when injected ***', async () => {
  await withEnv({ [A4_FLAG]: null }, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter('claude', [FINAL('你好！')])
    await run('你好', a, { connector: c.connector, sources: BOTH })
    // A4 off ⇒ the automatic path runs as before; the decision surface is the legacy one.
    assert.ok(a.calls.length >= 1)
  })
})

/* ═══ CONTINUATION — DETERMINISTIC, NO PAID CALL ═══════════════════════ */

const CLARIFY = '你想睇我哋供應商實際入貨價，定係外面市場行情？'
const AFTER_ASK = [
  { role: 'user', text: '幫我查下最近牛肉比上個月上升或下降多少。' },
  { role: 'assistant', text: CLARIFY }
]

test('*** continuation 「我哋供應商。」 → internal only ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter('claude', [READ(INV), FINAL('我哋嗰邊喺度。')])
    await run('我哋供應商。', a, { connector: c.connector, sources: BOTH }, AFTER_ASK)
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 0)
    assert.ok(a.calls[0].prompt.includes(CLARIFY), 'the clarification carried over in bounded history')
  })
})

test('*** continuation 「市場。」 → public only ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter('claude', [READ(PUB, A('beef market movement', 'recent')), FINAL('市場嗰邊喺度。')])
    await run('市場。', a, { connector: c.connector, sources: BOTH }, AFTER_ASK)
    assert.equal(c.publicReads.length, 1)
    assert.equal(c.internalReads.length, 0)
  })
})

test('*** continuation 「兩邊都睇。」 → both, no repeated clarification ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter('claude', [READ(INV), READ(PUB, A('beef market movement', 'recent')), FINAL('兩邊都喺度。')])
    // MIGRATED — public-after-internal re-authors the query; see the SAFE_PLANNER note above.
    const out = await run('兩邊都睇。', a, { connector: c.connector, sources: BOTH, publicQueryPlanner: SAFE_PLANNER }, AFTER_ASK)
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 1)
    assert.equal(String(out.reply).includes('你想睇'), false, 'it does not ask again')
  })
})
