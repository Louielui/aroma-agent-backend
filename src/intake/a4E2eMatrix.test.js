'use strict'

/**
 * a4E2eMatrix.test.js — the five A4 outcomes, end to end, in one place.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY A MATRIX AND NOT FIVE MORE SCATTERED TESTS.
 *
 * Each A4 slice proved its own mechanism: the ambiguity gate asks, the public capability
 * executes, the egress planner re-authors. Every one passed while the SYSTEM still got the
 * Owner's real question half-answered, because the failure was in the composition — internal
 * evidence existing is exactly what made the public read impossible.
 *
 * So this file asserts the five outcomes the Owner actually cares about, through the whole
 * pipeline, with every A4 gate ON at once. It is the acceptance shape, not a unit test:
 *
 *   1  AMBIGUOUS       → ASK, and ZERO reads of either world
 *   2  CLEAR INTERNAL  → internal only, public untouched
 *   3  CLEAR PUBLIC    → public only, internal untouched
 *   4  MIXED           → BOTH worlds, with the public query re-authored
 *   5  SUPPLIED FACTS  → ZERO reads; he already told her
 *
 * ⛔ CASE 4 IS THE ONE THAT WAS BROKEN. Under block-on-inspection it produced internal-only
 * and an apology. It is asserted here twice over: both worlds read, AND nothing internal in
 * what left.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')

const NOW = '2026-08-09T00:00:00.000Z'
const PUB = 'public_knowledge.search'
const INV = 'aroma_system.invoices'

const SECRET = 'AROMA_INTERNAL_ONLY_9842'
const SUPPLIER = 'Gordon'
const PRICE = '8.72'
const TITLE = 'Beef Brisket'
const INTERNAL_VALUES = [SECRET, SUPPLIER, PRICE, TITLE]

function twoWorldConnector () {
  const internalReads = []
  const publicReads = []
  return {
    internalReads,
    publicReads,
    connector: {
      async read (source, method, params) {
        if (source === 'public_knowledge') {
          publicReads.push({ method, params: JSON.parse(JSON.stringify(params || {})) })
          const rows = [{ source, sourceId: 'PUB-001', title: 'Wholesale beef index', entityType: 'public_item', content: 'index=112.4', fields: { id: 'PUB-001', index: '112.4' }, trust: 'live', retrievedAt: NOW, originalDate: '2026-07-31', link: null, error: null }]
          return { asOf: NOW, source, count: 1, results: rows, evidence: { source, endpoint: method, entityType: 'public_item', rowShape: { hasLocation: false, hasAsOf: true, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE PUBLIC EXECUTOR' } }
        }
        internalReads.push({ method, params: JSON.parse(JSON.stringify(params || {})) })
        const rows = [{ source, sourceId: '7', title: TITLE, entityType: 'purchase_order', content: `supplier=${SUPPLIER} · unitPrice=${PRICE} · code=${SECRET}`, fields: { id: '7', supplier: SUPPLIER, unitPrice: PRICE, code: SECRET }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }]
        return { asOf: NOW, source, count: 1, results: rows, evidence: { source, endpoint: method, entityType: 'purchase_order', rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE INTERNAL' } }
      }
    }
  }
}

function scriptedAdapter (envelopes) {
  const calls = []
  return {
    label: 'claude',
    calls,
    async complete (prompt) {
      calls.push(String(prompt))
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error('adapter called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'claude', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ = (capability, args) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: args === undefined ? { capability } : { capability, args }, answerPlan: null })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })

const verifier = (decision, question) => {
  const calls = []
  return { calls, fn: async (i) => { calls.push(i); return { decision, question: decision === 'ask' ? (question || '你想睇我哋自己，定係市場？') : null } } }
}
const SAFE_QUERY = 'canada wholesale beef market price trend'
const planner = () => {
  const calls = []
  return { calls, fn: async (i) => { calls.push(i); return { query: SAFE_QUERY, freshness: 'current', location: null } } }
}

const BASE = {
  READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off',
  [A4_FLAG]: 'on', [A4_AMBIGUITY_FLAG]: 'on'
}
async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const BOTH = ['aroma_system', 'public_knowledge']
const run = (msg, adapter, deps, history) => processIntake(msg, adapter, history || [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
})

/* ═══ 1 — AMBIGUOUS ═════════════════════════════════════════════════════ */

test('*** E2E 1 — AMBIGUOUS → ASK, and ZERO reads of either world ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const v = verifier('ask')
    const p = planner()
    const a = scriptedAdapter([READ(INV), FINAL('唔應該去到呢度。')])
    const out = await run('最近點', a, { connector: c.connector, sources: BOTH, ambiguityVerifier: v.fn, publicQueryPlanner: p.fn })

    assert.equal(c.internalReads.length, 0, '⛔ ambiguity is not a reason to read one side and see')
    assert.equal(c.publicReads.length, 0)
    assert.equal(p.calls.length, 0, 'and no planner call is spent on a question that was never asked')
    assert.equal(out.mode, 'ask')
    assert.ok(typeof out.reply === 'string' && out.reply.length > 0)
  })
})

/* ═══ 2 — CLEAR INTERNAL ════════════════════════════════════════════════ */

test('*** E2E 2 — CLEAR INTERNAL → internal only, public untouched ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const v = verifier('allow')
    const p = planner()
    const a = scriptedAdapter([READ(INV), FINAL('我哋自己嘅數喺度。')])
    await run('我哋自己嘅牛肉成本點', a, { connector: c.connector, sources: BOTH, ambiguityVerifier: v.fn, publicQueryPlanner: p.fn })

    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 0, '⛔ nothing left the building')
    assert.equal(p.calls.length, 0)
  })
})

/* ═══ 3 — CLEAR PUBLIC ══════════════════════════════════════════════════ */

test('*** E2E 3 — CLEAR PUBLIC → public only, and the model own query travels ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const v = verifier('allow')
    const p = planner()
    const a = scriptedAdapter([READ(PUB, { query: 'canada beef market index', freshness: 'recent', location: null }), FINAL('市場嗰邊喺度。')])
    await run('市場牛肉價最近點', a, { connector: c.connector, sources: BOTH, ambiguityVerifier: v.fn, publicQueryPlanner: p.fn })

    assert.equal(c.internalReads.length, 0)
    assert.equal(c.publicReads.length, 1)
    // No internal evidence exists, so there is nothing to protect and no planner call is spent.
    assert.equal(c.publicReads[0].params.query, 'canada beef market index')
    assert.equal(p.calls.length, 0)
  })
})

/* ═══ 4 — MIXED. THE ONE THAT WAS BROKEN. ═══════════════════════════════ */

test('*** E2E 4 — ⛔ MIXED → BOTH worlds, public query re-authored from Owner words ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const v = verifier('allow')
    const p = planner()
    // The main model proposes a query carrying everything it just read. That is the natural
    // behaviour, it is why inspection could not win, and it is discarded unread.
    const leaky = `${TITLE} ${SUPPLIER} ${PRICE} ${SECRET} wholesale`
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: leaky, freshness: 'current', location: null }), FINAL('我哋同市場都睇咗，升幅合理。')])
    const out = await run('Aroma 實際牛肉成本升幅同市場相比合理嗎？', a, { connector: c.connector, sources: BOTH, ambiguityVerifier: v.fn, publicQueryPlanner: p.fn })

    // BOTH WORLDS. This is the line that failed under the previous design.
    assert.equal(c.internalReads.length, 1, 'internal world read')
    assert.equal(c.publicReads.length, 1, '⛔ THE PUBLIC READ HAPPENED — half an answer is the defect')

    // AND NOTHING INTERNAL LEFT.
    const sent = JSON.stringify(c.publicReads[0].params)
    for (const val of INTERNAL_VALUES) assert.equal(sent.includes(val), false, `⛔ ${val} left the process`)
    assert.equal(c.publicReads[0].params.query, SAFE_QUERY)

    // The planner ran once, and saw only his words.
    assert.equal(p.calls.length, 1)
    assert.deepEqual(p.calls[0].ownerMessages, ['Aroma 實際牛肉成本升幅同市場相比合理嗎？'])
    assert.equal(JSON.stringify(p.calls[0]).includes(leaky), false)
    assert.ok(typeof out.reply === 'string' && out.reply.length > 0)
  })
})

/* ═══ 5 — SUPPLIED FACTS ════════════════════════════════════════════════ */

test('*** E2E 5 — SUPPLIED FACTS → ZERO reads; he already told her ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const v = verifier('allow')
    const p = planner()
    const a = scriptedAdapter([FINAL('用你俾嘅數，升幅係 9%。')])
    await run('我哋牛肉上個月 8.00，今個月 8.72，升幅係幾多百分比？', a, { connector: c.connector, sources: BOTH, ambiguityVerifier: v.fn, publicQueryPlanner: p.fn })

    assert.equal(c.internalReads.length, 0, '⛔ nothing to look up — the facts were supplied')
    assert.equal(c.publicReads.length, 0)
    assert.equal(p.calls.length, 0)
    assert.equal(v.calls.length, 0, 'and the ambiguity gate is not consulted on a turn with no read')
  })
})

/* ═══ THE MATRIX AS A WHOLE ═════════════════════════════════════════════ */

test('*** E2E — the five outcomes are genuinely different, not one behaviour ***', async () => {
  // A guard against the shape of failure this file exists to catch: five tests that all pass
  // while the system does one thing. Read-count signatures must be five distinct pairs.
  const seen = new Set()
  const cases = [
    ['ambiguous', 'ask', [READ(INV), FINAL('x')], '最近點'],
    ['internal', 'allow', [READ(INV), FINAL('x')], '我哋自己嘅牛肉成本點'],
    ['public', 'allow', [READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('x')], '市場牛肉價最近點'],
    ['mixed', 'allow', [READ(INV), READ(PUB, { query: 'leak ' + SECRET, freshness: null, location: null }), FINAL('x')], 'Aroma 成本同市場比'],
    ['supplied', 'allow', [FINAL('x')], '8.00 升到 8.72 係幾多 %']
  ]
  for (const [name, decision, envelopes, msg] of cases) {
    await withEnv({}, async () => {
      const c = twoWorldConnector()
      await run(msg, scriptedAdapter(envelopes), { connector: c.connector, sources: BOTH, ambiguityVerifier: verifier(decision).fn, publicQueryPlanner: planner().fn })
      seen.add(`${name}:${c.internalReads.length}/${c.publicReads.length}`)
    })
  }
  assert.deepEqual([...seen].sort(), ['ambiguous:0/0', 'internal:1/0', 'mixed:1/1', 'public:0/1', 'supplied:0/0'])
})
