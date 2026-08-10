'use strict'

/**
 * a4EgressProvenance.test.js — OWNER-ONLY PUBLIC QUERY PROVENANCE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE CORE A4-EGRESS-1 PROOF.
 *
 * The scenario is the one that broke the MIXED path and it is reproduced literally: internal
 * evidence carries AROMA_INTERNAL_ONLY_9842, Gordon, 8.72 and Beef Brisket; the Owner asked
 * only a generic question about Aroma beef cost versus the market; and the main model is
 * SCRIPTED to propose a public query containing every one of those values.
 *
 * What must hold is not 「the leaky query was blocked」. A4-2A already did that, and it cost
 * the Owner half his answer. What must hold is:
 *
 *   · the planner NEVER RECEIVES the raw query          — it cannot pass on what it never saw
 *   · the planner NEVER RECEIVES internal evidence      — nor learn it another way
 *   · the executor receives NONE of the four values     — unless the Owner typed it himself
 *   · AND THE PUBLIC READ STILL HAPPENS                 — a refusal is not a pass here
 *
 * The last line is what separates this from the previous answer. A test suite that proved
 * only the first three would be satisfied by blocking everything, which is the behaviour
 * being replaced.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { A4_FLAG } = require('./a4Contract')
const {
  ownerAuthoredContext,
  planPublicQuery,
  createTurnPlanCache,
  logEgressPlan,
  OUTCOME,
  PLANNER_SYSTEM,
  PLANNER_SCHEMA,
  MAX_OWNER_MESSAGES,
  MAX_TOTAL_CHARS
} = require('./publicQueryEgressPlanner')

const NOW = '2026-08-09T00:00:00.000Z'
const PUB = 'public_knowledge.search'
const INV = 'aroma_system.invoices'

/** ⛔ THE FOUR VALUES. Every one is in internal evidence and in the model's proposed query. */
const SECRET = 'AROMA_INTERNAL_ONLY_9842'
const SUPPLIER = 'Gordon'
const PRICE = '8.72'
const TITLE = 'Beef Brisket'
const INTERNAL_VALUES = [SECRET, SUPPLIER, PRICE, TITLE]

/** The Owner's actual question: generic, names none of the four. */
const OWNER_MSG = 'Aroma 實際牛肉成本升幅同市場相比合理嗎？'

/** What the contaminated main model proposes. Every internal value, as it really would. */
const LEAKY_QUERY = `${TITLE} ${SUPPLIER} wholesale price ${PRICE} ${SECRET}`

/* ═══ FIXTURES ══════════════════════════════════════════════════════════════ */

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
          const rows = [{
            sourceId: 'PUB-001', title: 'Wholesale beef index', entityType: 'public_item',
            content: 'index=112.4 · period=2026-07', fields: { id: 'PUB-001', index: '112.4', period: '2026-07' }
          }].map((r) => Object.assign({ source, trust: 'live', retrievedAt: NOW, originalDate: '2026-07-31', link: null, error: null }, r))
          return {
            asOf: NOW, source, count: rows.length, results: rows,
            evidence: { source, endpoint: method, entityType: 'public_item', rowShape: { hasLocation: false, hasAsOf: true, note: null }, metrics: {}, matchingTotal: rows.length, shownCount: rows.length, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE PUBLIC EXECUTOR' }
          }
        }
        internalReads.push({ method, params: JSON.parse(JSON.stringify(params || {})) })
        // ⛔ ALL FOUR VALUES LIVE HERE, and nowhere the planner can reach.
        const rows = [{
          source, sourceId: '7', title: TITLE, entityType: 'purchase_order',
          content: `id=7 · supplier=${SUPPLIER} · unitPrice=${PRICE} · code=${SECRET}`,
          fields: { id: '7', supplier: SUPPLIER, unitPrice: PRICE, code: SECRET },
          trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null
        }]
        if (opts.internalRows) rows.length = 0
        return {
          asOf: NOW, source, count: rows.length, results: rows,
          evidence: { source, endpoint: method, entityType: 'purchase_order', rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: rows.length, shownCount: rows.length, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE INTERNAL' }
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
      calls.push({ prompt: String(prompt) })
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

/**
 * A recording planner. It captures EVERYTHING it was handed, so the test can assert on what
 * it did NOT receive — the only way to prove an absence from outside the pipeline.
 */
function recordingPlanner (result) {
  const seen = []
  const fn = async (input) => {
    seen.push(JSON.parse(JSON.stringify(input === undefined ? null : { ownerMessages: input.ownerMessages, system: input.system, schema: input.schema })))
    if (typeof result === 'function') return result(input)
    return result
  }
  return { fn, seen }
}

const SAFE_PLAN = { query: 'canada wholesale beef market price trend', freshness: 'current', location: null }

const READ = (capability, args) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: args === undefined ? { capability } : { capability, args }, answerPlan: null })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })

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
// MIGRATED (SIR3): the Owner Source Intent Resolver now runs before the FIRST read of every
// A4-ON turn — it is no longer gated on the ambiguity flag, because meaning must be settled
// wherever a read can happen. With none wired a turn correctly fails closed to a question, so
// these suites (which test EGRESS and the public capability, not meaning) supply a default.
// 'mixed' is used because it permits either world as a valid first half, leaving each test's
// own read sequence exactly as it was.
const DEFAULT_SIR = async () => ({ intent: 'mixed' })
const run = (msg, adapter, deps, history) => processIntake(msg, adapter, history || [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: Object.assign({ sourceIntentResolver: DEFAULT_SIR }, deps)
})

/* ═══════════════════════════════════════════════════════════════════════════
 * P1–P4 — THE CORE PROOF
 * ═══════════════════════════════════════════════════════════════════════════ */

test('*** P1 — ⛔ the planner never receives the raw query or any internal evidence ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const p = recordingPlanner(SAFE_PLAN)
    const a = scriptedAdapter('claude', [READ(INV), READ(PUB, { query: LEAKY_QUERY, freshness: 'current', location: null }), FINAL('比較完。')])
    await run(OWNER_MSG, a, { connector: c.connector, sources: BOTH, publicQueryPlanner: p.fn })

    assert.equal(p.seen.length, 1, 'the planner ran exactly once')
    const handed = JSON.stringify(p.seen[0])

    // ⛔ THE RAW QUERY IS NOT IN ITS CONTEXT — not the whole string, not any piece of it.
    assert.equal(handed.includes(LEAKY_QUERY), false, '⛔ the raw main-model query reached the planner')
    for (const v of INTERNAL_VALUES) {
      assert.equal(handed.includes(v), false, `⛔ internal value ${v} reached the planner`)
    }
    // And what it DID see is the Owner's own words, nothing more.
    assert.deepEqual(p.seen[0].ownerMessages, [OWNER_MSG])
  })
})

test('*** P2 — ⛔ the public executor receives none of the four internal values ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const p = recordingPlanner(SAFE_PLAN)
    const a = scriptedAdapter('claude', [READ(INV), READ(PUB, { query: LEAKY_QUERY, freshness: 'current', location: null }), FINAL('比較完。')])
    await run(OWNER_MSG, a, { connector: c.connector, sources: BOTH, publicQueryPlanner: p.fn })

    assert.equal(c.publicReads.length, 1, 'the public read HAPPENED — a refusal is not a pass here')
    const sent = JSON.stringify(c.publicReads[0].params)
    for (const v of INTERNAL_VALUES) {
      assert.equal(sent.includes(v), false, `⛔ ${v} LEFT THE PROCESS inside the public query`)
    }
    assert.equal(c.publicReads[0].params.query, SAFE_PLAN.query, 'the safe, Owner-derived query is what travelled')
  })
})

test('*** P3 — ⛔ the public read still executes: MIXED gets BOTH worlds ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const p = recordingPlanner(SAFE_PLAN)
    const a = scriptedAdapter('claude', [READ(INV), READ(PUB, { query: LEAKY_QUERY, freshness: 'current', location: null }), FINAL('我哋同市場都睇咗。')])
    const out = await run(OWNER_MSG, a, { connector: c.connector, sources: BOTH, publicQueryPlanner: p.fn })

    // THE POINT OF THE WHOLE PACKAGE. Blocking would satisfy P1 and P2 and fail here.
    assert.equal(c.internalReads.length, 1, 'internal world read')
    assert.equal(c.publicReads.length, 1, 'public world read')
    assert.ok(typeof out.reply === 'string' && out.reply.length > 0)
  })
})

test('*** P4 — nothing leaks into telemetry either ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const p = recordingPlanner(SAFE_PLAN)
    const logs = []
    const orig = console.log
    console.log = (...x) => { logs.push(x.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ')) }
    try {
      const a = scriptedAdapter('claude', [READ(INV), READ(PUB, { query: LEAKY_QUERY, freshness: 'current', location: null }), FINAL('ok')])
      await run(OWNER_MSG, a, { connector: c.connector, sources: BOTH, publicQueryPlanner: p.fn })
    } finally { console.log = orig }

    const all = logs.join('\n')
    for (const v of INTERNAL_VALUES) assert.equal(all.includes(v), false, `⛔ ${v} appeared in a log line`)
    // The plan line exists, is content-free, and records that the discard happened.
    const plan = logs.find((l) => l.includes('[AROMA-EGRESS-PLAN]'))
    assert.ok(plan, 'the egress plan is on the record')
    assert.equal(plan.includes(SAFE_PLAN.query), false, 'and not even the SAFE query is logged')
    assert.ok(plan.includes('"rawQueryDiscarded":true'))
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * P5–P8 — FAIL CLOSED. Every one must refuse, and none may fall back.
 * ═══════════════════════════════════════════════════════════════════════════ */

const FAILURE_MODES = [
  ['missing', null],
  ['throws', async () => { throw new Error('planner exploded carrying ' + LEAKY_QUERY) }],
  ['malformed', async () => ({ not: 'the shape' })],
  ['invalid json', async () => 'this is not json at all'],
  ['empty query', async () => ({ query: '   ', freshness: 'current', location: null })],
  ['null bag', async () => null],
  ['query-free bag', async () => ({ query: null, freshness: 'current', location: null })]
]

for (const [name, planner] of FAILURE_MODES) {
  test(`*** P5 — fail closed: a planner that is ${name} produces NO public read ***`, async () => {
    await withEnv({}, async () => {
      const c = twoWorldConnector()
      const a = scriptedAdapter('claude', [READ(INV), READ(PUB, { query: LEAKY_QUERY, freshness: 'current', location: null }), FINAL('市場嗰邊今次睇唔到。')])
      await run(OWNER_MSG, a, { connector: c.connector, sources: BOTH, publicQueryPlanner: planner })

      assert.equal(c.internalReads.length, 1, 'the internal read still happened')
      assert.equal(c.publicReads.length, 0, `⛔ FELL OPEN on «${name}» — the executor was reached`)
    })
  })
}

test('*** P6 — ⛔ a failed plan NEVER falls back to the main model query ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter('claude', [READ(INV), READ(PUB, { query: LEAKY_QUERY, freshness: 'current', location: null }), FINAL('ok')])
    await run(OWNER_MSG, a, { connector: c.connector, sources: BOTH, publicQueryPlanner: async () => { throw new Error('nope') } })
    // The strongest form of the ruling: not just 「no read」, but the leaky string is nowhere
    // in anything the executor was ever handed.
    assert.equal(JSON.stringify(c.publicReads).includes(TITLE), false)
    assert.equal(JSON.stringify(c.publicReads).includes(SUPPLIER), false)
  })
})

test('*** P7 — a failed plan creates NO EvidenceSet and no trust state ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const events = []
    const orig = console.log
    console.log = (...x) => { if (x[0] === '[AROMA-REASONING]') { try { events.push(JSON.parse(x[1])) } catch (_) {} } }
    try {
      const a = scriptedAdapter('claude', [READ(INV), READ(PUB, { query: LEAKY_QUERY }), FINAL('ok')])
      await run(OWNER_MSG, a, { connector: c.connector, sources: BOTH, publicQueryPlanner: null })
    } finally { console.log = orig }
    const refused = events.find((e) => e && e.decisionType === 'read' && e.ok === false)
    assert.ok(refused, 'the refusal is on the record as an ordinary refused observation')
    assert.equal(JSON.stringify(events).includes(SECRET), false)
  })
})

test('*** P7/P8 — with NO internal evidence the planner STILL owns the outbound words ***', async () => {
  // ⛔ THIS ASSERTION IS INVERTED ON PURPOSE, AND THE PRODUCTION CANARY IS WHY.
  //
  // It used to read 「the main model query still travels unchanged」, on the reasoning that a
  // pure-public turn has nothing private to protect. A4-3B showed that made the WRONG fact the
  // trigger: with no internal evidence the planner never ran, so the recovery worker's public
  // read — which carries a CAPABILITY and `args: null`, never args — reached the provider with
  // an empty query and came back MALFORMED without searching. The same gap let the main
  // model's own raw string leave on any turn that had read nothing internal first.
  //
  // The loop decides WHETHER the outside world is needed. It never decides WHAT WORDS GO.
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const p = recordingPlanner(SAFE_PLAN)
    const a = scriptedAdapter('claude', [READ(PUB, { query: 'winnipeg beef market', freshness: 'recent', location: 'Winnipeg' }), FINAL('市場睇咗。')])
    await run('市場牛肉價點', a, { connector: c.connector, sources: BOTH, publicQueryPlanner: p.fn })

    assert.equal(c.publicReads.length, 1)
    assert.equal(c.publicReads[0].params.query, SAFE_PLAN.query, '⛔ the raw main-model query travelled')
    assert.equal(c.publicReads[0].params.query.includes('winnipeg beef market'), false)
    assert.equal(p.seen.length, 1, 'the planner was consulted on a pure-public turn')
  })
})

test('*** P2 — a recovery-shaped public read with args=null still reaches the provider ***', async () => {
  // ⛔ THE EXACT A4-3B REGRESSION. The recovery worker routes `performRead({capability, args:
  // null})` because args are not its business. Under the old rule that produced an empty query;
  // under the new rule the planner supplies them, so the search actually happens.
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const p = recordingPlanner(SAFE_PLAN)
    const a = scriptedAdapter('claude', [READ(PUB, null), FINAL('市場睇咗。')])
    await run('市場牛肉價點', a, { connector: c.connector, sources: BOTH, publicQueryPlanner: p.fn })

    assert.equal(c.publicReads.length, 1, '⛔ the public read never reached the executor')
    assert.equal(c.publicReads[0].params.query, SAFE_PLAN.query)
    assert.equal(String(c.publicReads[0].params.query || '').trim() === '', false, '⛔ an EMPTY query left the process')
  })
})

test('*** P3 — a pure-public turn with NO planner performs NO read, valid raw query or not ***', async () => {
  // The raw query here is perfectly innocuous. It still does not travel: authority over the
  // outbound words is not conditional on them looking safe.
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter('claude', [READ(PUB, { query: 'canada beef wholesale price', freshness: 'current', location: null }), FINAL('讀唔到。')])
    await run('市場牛肉價點', a, { connector: c.connector, sources: BOTH })

    assert.equal(c.publicReads.length, 0, '⛔ FELL OPEN — a raw query travelled with no planner')
    assert.equal(c.internalReads.length, 0, 'and no other world was read in its place')
  })
})

test('*** P8b — one plan per turn, even across two public attempts ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const p = recordingPlanner(SAFE_PLAN)
    // Two public reads in one turn: the second is a different INSTANCE, so dedupe permits it.
    const a = scriptedAdapter('claude', [
      READ(PUB, { query: 'first raw', freshness: 'current', location: null }),
      READ(PUB, null),
      FINAL('睇咗。')
    ])
    await run('市場牛肉價點', a, { connector: c.connector, sources: BOTH, publicQueryPlanner: p.fn })

    assert.equal(p.seen.length, 1, '⛔ the turn cache must bill the planner once per Owner context')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * P9–P11 — THE OWNER'S OWN WORDS, AND THE CACHE
 * ═══════════════════════════════════════════════════════════════════════════ */

test('*** P9 — a value the OWNER typed himself may still travel ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // He named the supplier himself. The planner may use his words — that is the whole
    // definition of Owner-authored — and the second fence must not then refuse them.
    const ownerTyped = `幫我睇下 ${SUPPLIER} 喺市場嘅牛肉價位`
    const p = recordingPlanner({ query: `${SUPPLIER} beef market price`, freshness: 'current', location: null })
    const a = scriptedAdapter('claude', [READ(INV), READ(PUB, { query: LEAKY_QUERY }), FINAL('查咗。')])
    await run(ownerTyped, a, { connector: c.connector, sources: BOTH, publicQueryPlanner: p.fn })

    assert.equal(c.publicReads.length, 1, '⛔ his own word must not be refused as a leak')
    assert.ok(c.publicReads[0].params.query.includes(SUPPLIER))
    // But the values he did NOT type are still absent.
    const sent = JSON.stringify(c.publicReads[0].params)
    for (const v of [SECRET, PRICE, TITLE]) assert.equal(sent.includes(v), false)
  })
})

test('*** P10 — two PUBLIC requests in one turn spend ONE planner call ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const p = recordingPlanner(SAFE_PLAN)
    const a = scriptedAdapter('claude', [
      READ(INV),
      READ(PUB, { query: LEAKY_QUERY }),
      READ(PUB, { query: LEAKY_QUERY + ' again' }),
      FINAL('ok')
    ])
    await run(OWNER_MSG, a, { connector: c.connector, sources: BOTH, publicQueryPlanner: p.fn })
    assert.equal(p.seen.length, 1, '⛔ the safe plan is authored once per Owner context')
    // And the executor sees ONE read: the second request reuses the same plan, so it collides
    // with the existing dedupe key instead of paying for an identical search twice.
    assert.equal(c.publicReads.length, 1, 'the existing duplicate suppression caught the repeat')
  })
})

test('*** P11 — the cache also remembers a REFUSAL, so a broken planner is asked once ***', async () => {
  let calls = 0
  const cache = createTurnPlanCache()
  const plan = async () => { calls++; throw new Error('down') }
  const a = await cache.get({ plan, message: OWNER_MSG, history: [] })
  const b = await cache.get({ plan, message: OWNER_MSG, history: [] })
  assert.equal(calls, 1, 'a planner that failed is not re-asked inside one bounded loop')
  assert.equal(a.ok, false)
  assert.equal(b.ok, false)
})

/* ═══════════════════════════════════════════════════════════════════════════
 * P12–P16 — OWNER CONTEXT: the allowlist, and the inverted default
 * ═══════════════════════════════════════════════════════════════════════════ */

test('*** P12 — ⛔ assistant turns are excluded, and so is every unknown role ***', () => {
  // THE INVERSION THAT MATTERS. distillPrompt attributes an unknown role to the OWNER by
  // design; here that default would feed her own evidence-bearing reply into the one input
  // the planner has. Only an explicit 'user' counts.
  const history = [
    { role: 'user', text: 'OWNER_ONE' },
    { role: 'assistant', text: `我哋同 ${SUPPLIER} 買 ${TITLE}，單價 ${PRICE}` },
    { text: 'NO_ROLE_AT_ALL' },
    { role: 'weird', text: 'ODD_ROLE' },
    { role: 'system', text: 'SYSTEM_TEXT' }
  ]
  const ctx = ownerAuthoredContext('CURRENT', history)
  assert.deepEqual(ctx, ['OWNER_ONE', 'CURRENT'])
  const s = JSON.stringify(ctx)
  for (const v of [SUPPLIER, TITLE, PRICE, 'NO_ROLE_AT_ALL', 'ODD_ROLE', 'SYSTEM_TEXT']) {
    assert.equal(s.includes(v), false, `⛔ ${v} was admitted as Owner-authored`)
  }
})

test('*** P13 — at most 4 preceding Owner messages, oldest dropped first ***', () => {
  const history = []
  for (let i = 1; i <= 9; i++) history.push({ role: 'user', text: 'M' + i })
  const ctx = ownerAuthoredContext('NOW', history)
  assert.equal(ctx.length, MAX_OWNER_MESSAGES + 1)
  assert.deepEqual(ctx, ['M6', 'M7', 'M8', 'M9', 'NOW'])
})

test('*** P14 — the total character bound holds against a pasted document ***', () => {
  const huge = 'x'.repeat(50000)
  const ctx = ownerAuthoredContext(huge, [{ role: 'user', text: huge }, { role: 'user', text: huge }])
  const total = ctx.join('').length
  assert.ok(total <= MAX_TOTAL_CHARS, `context grew to ${total}`)
})

test('*** P15 — no Owner context means no query leaves ***', async () => {
  const r = await planPublicQuery({ plan: async () => SAFE_PLAN, message: '   ', history: [{ role: 'assistant', text: 'HER WORDS' }] })
  assert.equal(r.ok, false)
  assert.equal(r.outcome, OUTCOME.NO_OWNER_CONTEXT)
})

test('*** P16 — the planner output is admitted through the CLOSED arg shape ***', async () => {
  const r = await planPublicQuery({
    plan: async () => ({ query: 'beef market', freshness: 'current', location: null, url: 'https://evil.example', provider: 'acme', headers: { a: 1 } }),
    message: OWNER_MSG,
    history: []
  })
  assert.equal(r.ok, true)
  assert.deepEqual(Object.keys(r.args).sort(), ['freshness', 'location', 'query'])
  assert.equal(r.args.url, undefined, '⛔ url has nowhere to be written to')
  assert.equal(r.args.provider, undefined, '⛔ nor provider')
})

/* ═══════════════════════════════════════════════════════════════════════════
 * P17–P19 — STRUCTURE: neutrality, schema, telemetry
 * ═══════════════════════════════════════════════════════════════════════════ */

test('*** P17 — the module is provider-neutral, proven statically ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.resolve(__dirname, 'publicQueryEgressPlanner.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') // comments may DISCUSS providers
  for (const tok of ['OpenAIAdapter', 'ClaudeAdapter', 'modelRouter', 'openai', 'anthropic', 'claude', 'gpt', 'connector', 'liveClients', 'fetch(', 'https://']) {
    assert.equal(src.toLowerCase().includes(tok.toLowerCase()), false, `⛔ provider/network token «${tok}» in the planner`)
  }
})

test('*** P18 — ⛔ the ROOT is a plain object, and the fields are DERIVED not retyped ***', () => {
  const { READ_ARGS_SCHEMA } = require('./a4Contract')
  // SEEN TO FAIL LIVE. This was `assert.equal(PLANNER_SCHEMA, READ_ARGS_SCHEMA)` and it passed
  // while a real provider call returned HTTP 400: READ_ARGS_SCHEMA's root is ['object','null']
  // because as a NESTED field it must be able to say 「no arguments」, and strict Structured
  // Outputs forbids a nullable ROOT. Every deterministic test injects a fake planner, so the
  // schema never reached a provider — the identity assertion was proving discipline, not
  // correctness.
  assert.equal(PLANNER_SCHEMA.type, 'object', '⛔ a nullable root is rejected at the provider')
  assert.ok(Array.isArray(READ_ARGS_SCHEMA.type) && READ_ARGS_SCHEMA.type.includes('null'),
    'the nested contract is still nullable — the two roles genuinely differ')
  // DERIVED, so a field added to the arg contract arrives here and cannot silently drift.
  assert.equal(PLANNER_SCHEMA.properties, READ_ARGS_SCHEMA.properties)
  assert.equal(PLANNER_SCHEMA.required, READ_ARGS_SCHEMA.required)
  assert.equal(PLANNER_SCHEMA.additionalProperties, false)
  assert.deepEqual(PLANNER_SCHEMA.required.slice().sort(), ['freshness', 'location', 'query'])
  for (const banned of ['reason', 'rationale', 'analysis', 'thought', 'thinking', 'confidence', 'chainOfThought']) {
    assert.equal(Object.prototype.hasOwnProperty.call(PLANNER_SCHEMA.properties, banned), false, `⛔ ${banned} is not an output field`)
  }
})

test('*** P19 — the log line is counts and enums only ***', () => {
  let line = null
  logEgressPlan({ requestId: 'r1', outcome: OUTCOME.PLANNED, rawQueryDiscarded: true, ownerMessageCount: 2, durationMs: 12 }, (l) => { line = l })
  assert.deepEqual(Object.keys(line).sort(),
    ['durationMs', 'event', 'outcome', 'ownerMessageCount', 'rawQueryDiscarded', 'requestId', 'timestamp'])
  // An unrecognised outcome cannot smuggle text through the enum field.
  let bad = null
  logEgressPlan({ outcome: `planned ${SECRET}`, ownerMessageCount: 'many' }, (l) => { bad = l })
  assert.equal(bad.outcome, OUTCOME.FAILED)
  assert.equal(bad.ownerMessageCount, 0)
  assert.equal(JSON.stringify(bad).includes(SECRET), false)
})

test('*** P20 — the planner system text forbids inventing specifics and naming the restaurant ***', () => {
  // A quality control, not a security control — the security is that the values are absent.
  // Asserted so a future edit cannot quietly drop the instruction.
  assert.ok(PLANNER_SYSTEM.includes('Aroma'), 'it must name what not to say')
  assert.ok(/唔准加|唔准提/.test(PLANNER_SYSTEM))
  assert.equal(/public_knowledge|readKey|capability|nextRead/.test(PLANNER_SYSTEM), false,
    '⛔ no implementation vocabulary reaches a model prompt')
})
