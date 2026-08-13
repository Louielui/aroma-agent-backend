'use strict'

/**
 * a4MixedCompletion.test.js — A4-MIX1: explicit MIXED is a requirement, not an ambiguity.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE TWO LIVE FAILURES THIS CLOSES.
 *
 * 「Aroma 實際牛肉成本升幅同市場相比合理嗎？」 failed on the real model twice:
 *
 *   1. The AMBIGUITY verifier answered `ask` — although its own frozen rules say
 *      「要兩邊 ≠ 含糊」. Asked whether his meaning was unclear about a sentence naming both
 *      sides, it read the two sides AS the ambiguity.
 *
 *   2. With that gate off, the model read internal evidence and went straight to FINAL,
 *      honestly reporting it had no market data instead of going to get some.
 *
 * One missing concept behind both: a turn could be 「clear」 or 「ambiguous」, and an explicit
 * request for BOTH worlds is neither. It is the clearest kind of request there is, and it
 * takes two reads to answer.
 *
 * ⛔ THE COMPLETION GUARD IS THE POINT. A verifier alone would fix (1) and leave (2): the
 * model would be allowed to read, and still stop after one world. The requirement is
 * therefore STRUCTURAL — checked before the answer is released, not asked of the model.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { processIntake } = require('./intakeService')
const { runReasoningLoop, MAX_REASONING_STEPS, MAX_REASONING_STEPS_CEILING, STOP } = require('./reasoningLoop')
const {
  MIXED_SCHEMA, MIXED_SYSTEM, DECISION, REQUIRED_BOTH,
  validateMixedDecision, runMixedRequirement, createTurnMixedCache, missingWorld, logMixedRequirement
} = require('./mixedKnowledgeRequirement')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')

const NOW = '2026-08-09T00:00:00.000Z'
const PUB = 'public_knowledge.search'
const INV = 'aroma_system.invoices'
const SECRET = 'AROMA_INTERNAL_ONLY_9842'
const SUPPLIER = 'Gordon'
const TITLE = 'Beef Brisket'

/* ═══ FIXTURES ═══════════════════════════════════════════════════════════ */

function twoWorldConnector (opts = {}) {
  const internalReads = []; const publicReads = []
  return {
    internalReads,
    publicReads,
    connector: {
      async read (source, method, params) {
        if (source === 'public_knowledge') {
          publicReads.push({ method, params: JSON.parse(JSON.stringify(params || {})) })
          if (opts.publicFails) throw new Error('fake public unavailable')
          const rows = [{ source, sourceId: 'PUB-001', title: 'Wholesale index', entityType: 'public_item', content: 'index=112.4', fields: { id: 'PUB-001', index: '112.4' }, trust: 'live', retrievedAt: NOW, originalDate: '2026-07-31', link: null, error: null }]
          return { asOf: NOW, source, count: 1, results: rows, evidence: { source, endpoint: method, entityType: 'public_item', rowShape: { hasLocation: false, hasAsOf: true, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE PUBLIC' } }
        }
        internalReads.push({ method, params: JSON.parse(JSON.stringify(params || {})) })
        if (opts.internalFails) throw new Error('fake internal unavailable')
        const rows = [{ source, sourceId: '7', title: TITLE, entityType: 'purchase_order', content: `supplier=${SUPPLIER} · code=${SECRET}`, fields: { id: '7', supplier: SUPPLIER, code: SECRET }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }]
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
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'scripted', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ = (capability, args) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: args === undefined ? { capability } : { capability, args }, answerPlan: null })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })

const spy = (decision) => { const calls = []; return { calls, fn: async (i) => { calls.push(i); return { decision } } } }
const ambiSpy = (decision) => { const calls = []; return { calls, fn: async (i) => { calls.push(i); return { decision, question: decision === 'ask' ? '你想睇邊邊？' : null } } } }
const SAFE_PLANNER = async () => ({ query: 'wholesale beef market price trend', freshness: 'current', location: null })

const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on', [A4_AMBIGUITY_FLAG]: 'on' }
async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const BOTH = ['aroma_system', 'public_knowledge']
// MIGRATED (SIR2): the Owner Source Intent Resolver is the ONE source-world authority; the old
// ambiguity gate is no longer consulted at runtime. Each fixture states the ground truth for its
// OWN message, exactly as the benchmark corpus does — a stub for a model, not a production rule.
const SIR = (intent) => async () => ({ intent })

const run = (msg, adapter, deps, history) => processIntake(msg, adapter, history || [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
})
const MIXED_DEPS = (c, extra = {}) => Object.assign({ connector: c.connector, sources: BOTH, publicQueryPlanner: SAFE_PLANNER }, extra)

/* ═══ A–D, G — THE VERIFIER'S OWN DECISION ══════════════════════════════ */

test('*** A — explicit mixed → mixed, and it declares BOTH worlds required ***', async () => {
  const r = await runMixedRequirement({ verify: async () => ({ decision: 'mixed' }), message: 'x', history: [] })
  assert.equal(r.decision, DECISION.MIXED)
  assert.deepEqual(r.requiredWorlds, REQUIRED_BOTH)
})

for (const [name, decision] of [['ambiguous', 'not_mixed'], ['clear internal', 'not_mixed'], ['clear public', 'not_mixed']]) {
  test(`*** B/C/D — ${name} → not_mixed, and NO worlds are required ***`, async () => {
    const r = await runMixedRequirement({ verify: async () => ({ decision }), message: 'x', history: [] })
    assert.equal(r.decision, DECISION.NOT_MIXED)
    assert.equal(r.requiredWorlds, null)
  })
}

test('*** G — ⛔ every unusable verifier result fails to NOT_MIXED, never to mixed ***', async () => {
  // THE DIRECTION MATTERS. Failing 「closed」 here means claiming NOTHING: a wrongly-claimed
  // requirement would SKIP the ambiguity ASK and licence a second read world on the strength
  // of a gate that did not work.
  const cases = [
    ['missing', null],
    ['throws', async () => { throw new Error('boom') }],
    ['malformed', async () => ({ verdict: 'mixed' })],
    ['unknown value', async () => ({ decision: 'maybe' })],
    ['not json', async () => 'mixed please'],
    ['null', async () => null],
    ['array', async () => []]
  ]
  for (const [label, verify] of cases) {
    const r = await runMixedRequirement({ verify, message: 'x', history: [] })
    assert.equal(r.decision, DECISION.NOT_MIXED, label)
    assert.equal(r.requiredWorlds, null, label)
  }
})

test('*** the admission filter accepts only the two words ***', () => {
  assert.equal(validateMixedDecision({ decision: 'mixed' }), 'mixed')
  assert.equal(validateMixedDecision('{"decision":"not_mixed"}'), 'not_mixed')
  assert.equal(validateMixedDecision('noise {"decision":"mixed"} tail'), 'mixed')
  for (const bad of [null, undefined, '', 'nope', { decision: 'MIXED' }, { decision: true }, 42, []]) {
    assert.equal(validateMixedDecision(bad), null, JSON.stringify(bad))
  }
})

/* ═══ E, F — OWNER CONTEXT ══════════════════════════════════════════════ */

test('*** E — continuation 「兩邊都睇」 carries prior OWNER context to the verifier ***', async () => {
  const seen = []
  await runMixedRequirement({
    verify: async (i) => { seen.push(i); return { decision: 'mixed' } },
    message: '兩邊都睇。',
    history: [{ role: 'user', text: '最近牛肉點' }, { role: 'assistant', text: '你想睇邊邊？' }]
  })
  assert.deepEqual(seen[0].ownerMessages, ['最近牛肉點', '兩邊都睇。'])
})

test('*** F — ⛔ assistant history cannot cause mixed, and never reaches the verifier ***', async () => {
  const seen = []
  await runMixedRequirement({
    verify: async (i) => { seen.push(i); return { decision: 'not_mixed' } },
    message: '得啦',
    // Her turn names both worlds AND carries internal values. Neither may be admitted.
    history: [{ role: 'assistant', text: `我哋同 ${SUPPLIER} 買 ${TITLE}，要唔要同市場比？` }, { text: 'NO_ROLE' }, { role: 'weird', text: 'ODD' }]
  })
  assert.deepEqual(seen[0].ownerMessages, ['得啦'])
  const handed = JSON.stringify(seen[0])
  for (const v of [SUPPLIER, TITLE, 'NO_ROLE', 'ODD']) assert.equal(handed.includes(v), false, `⛔ ${v} reached the verifier`)
})

test('*** no Owner context → not_mixed without a call ***', async () => {
  let calls = 0
  const r = await runMixedRequirement({ verify: async () => { calls++; return { decision: 'mixed' } }, message: '  ', history: [{ role: 'assistant', text: 'hers' }] })
  assert.equal(r.decision, DECISION.NOT_MIXED)
  assert.equal(calls, 0)
})

/* ═══ H — ONCE PER TURN ═════════════════════════════════════════════════ */

test('*** H — the mixed verifier runs at most ONCE per turn ***', async () => {
  const cache = createTurnMixedCache()
  let calls = 0
  const verify = async () => { calls++; return { decision: 'mixed' } }
  const a = await cache.get({ verify, message: 'x', history: [] })
  const b = await cache.get({ verify, message: 'x', history: [] })
  assert.equal(calls, 1)
  assert.deepEqual(a, b)
  assert.equal(cache.calls, 1)
})

test('*** H2 — end to end, ONE authority call per turn, and it is the resolver ***', async () => {
  // MIGRATED (SIR3): the mixed VERIFIER no longer runs — it could establish 「both worlds」 on
  // its own, which made two components able to classify the same request. What survives of
  // MIX1 is its completeness guard, which is plain code and spends no call.
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const m = spy('mixed')
    const sir = { calls: [], fn: async (i) => { sir.calls.push(i); return { intent: 'mixed' } } }
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('兩邊都睇咗。')])
    await run('我哋成本同市場比', a, MIXED_DEPS(c, { mixedVerifier: m.fn, sourceIntentResolver: sir.fn }))
    assert.equal(m.calls.length, 0, '⛔ the second authority must be gone, not merely unused')
    assert.equal(sir.calls.length, 1)
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 1)
  })
})

/* ═══ I, J — INTERACTION WITH THE AMBIGUITY GATE ════════════════════════ */

test('*** I — ⛔ mixed SKIPS the ambiguity verifier entirely ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const m = spy('mixed'); const amb = ambiSpy('ask')
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('兩邊都睇咗。')])
    await run('我哋成本同市場比', a, MIXED_DEPS(c, { mixedVerifier: m.fn, ambiguityVerifier: amb.fn, sourceIntentResolver: SIR('mixed') }))
    // The ambiguity verifier is scripted to ASK — the exact live failure. It is never asked.
    assert.equal(amb.calls.length, 0, '⛔ the ambiguity gate ran on an explicitly mixed turn')
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 1)
  })
})

test('*** J — not_mixed hands the meaning to the source-intent resolver ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // MIGRATED (SIR2): the old gate no longer runs; the resolver owns the meaning, and an open
    // meaning still asks and still reads nothing. The guarantee is unchanged, the authority is not.
    const m = spy('not_mixed'); const sir = { calls: [], fn: async (i) => { sir.calls.push(i); return { intent: 'ambiguous' } } }
    const a = scriptedAdapter([READ(INV), FINAL('唔應該到呢度。')])
    const out = await run('最近點', a, MIXED_DEPS(c, { mixedVerifier: m.fn, sourceIntentResolver: sir.fn }))
    assert.equal(sir.calls.length, 1, 'the resolver is the authority now')
    assert.equal(out.mode, 'ask')
    assert.equal(c.internalReads.length, 0)
    assert.equal(c.publicReads.length, 0)
  })
})

/* ═══ K, L — EITHER WORLD MAY BE READ FIRST ═════════════════════════════ */

test('*** K — explicit mixed, INTERNAL first → allowed ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('ok')])
    await run('我哋成本同市場比', a, MIXED_DEPS(c, { mixedVerifier: spy('mixed').fn, ambiguityVerifier: ambiSpy('ask').fn, sourceIntentResolver: SIR('mixed') }))
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 1)
  })
})

test('*** L — explicit mixed, PUBLIC first → allowed, no forced ordering ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([READ(PUB, { query: 'market', freshness: null, location: null }), READ(INV), FINAL('ok')])
    await run('市場同我哋比', a, MIXED_DEPS(c, { mixedVerifier: spy('mixed').fn, ambiguityVerifier: ambiSpy('ask').fn, sourceIntentResolver: SIR('mixed') }))
    assert.equal(c.publicReads.length, 1)
    assert.equal(c.internalReads.length, 1)
  })
})

/* ═══ M, N, O — THE COMPLETION GUARD ════════════════════════════════════ */

test('*** M — ⛔ premature FINAL with PUBLIC missing is REFUSED, and the model recovers ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const events = []
    const orig = console.log
    console.log = (...x) => { if (x[0] === '[AROMA-REASONING]') { try { events.push(JSON.parse(x[1])) } catch (_) {} } }
    let out
    try {
      // THE EXACT LIVE FAILURE: read internal, then try to answer.
      const a = scriptedAdapter([READ(INV), FINAL('冇市場數據，唔答得。'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('兩邊都睇咗。')])
      out = await run('我哋成本同市場比', a, MIXED_DEPS(c, { mixedVerifier: spy('mixed').fn, ambiguityVerifier: ambiSpy('allow').fn, sourceIntentResolver: SIR('mixed') }))
    } finally { console.log = orig }
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 1, '⛔ the premature final was released')
    // RENAMED to 'before_terminal' by A4-FINAL2: an ANSWER and a QUESTION BACK both end the
    // turn, so the guard covers both and the telemetry says so.
    assert.ok(events.some((e) => e && e.refusal === 'before_terminal'), 'the interception is on the record')
    assert.equal(out.reply, '兩邊都睇咗。', 'the ANSWER is the complete one, not the apology')
  })
})

test('*** N — premature FINAL with INTERNAL missing is REFUSED ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([READ(PUB, { query: 'market', freshness: null, location: null }), FINAL('得市場嗰邊。'), READ(INV), FINAL('兩邊都齊。')])
    const out = await run('市場同我哋比', a, MIXED_DEPS(c, { mixedVerifier: spy('mixed').fn, ambiguityVerifier: ambiSpy('allow').fn, sourceIntentResolver: SIR('mixed') }))
    assert.equal(c.publicReads.length, 1)
    assert.equal(c.internalReads.length, 1)
    assert.equal(out.reply, '兩邊都齊。')
  })
})

test('*** O — both worlds live → FINAL is allowed immediately ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('兩邊都睇咗。')])
    const out = await run('我哋成本同市場比', a, MIXED_DEPS(c, { mixedVerifier: spy('mixed').fn, ambiguityVerifier: ambiSpy('allow').fn, sourceIntentResolver: SIR('mixed') }))
    assert.equal(out.reply, '兩邊都睇咗。')
  })
})

test('*** the guard is pure and names a WORLD, never a capability ***', () => {
  assert.equal(missingWorld(null, {}), null, 'no requirement, nothing missing')
  assert.equal(missingWorld(REQUIRED_BOTH, {}), 'internal')
  assert.equal(missingWorld(REQUIRED_BOTH, { internal: true }), 'public')
  assert.equal(missingWorld(REQUIRED_BOTH, { internal: true, public: true }), null)
  // Truthy-but-not-true must not satisfy a world: only a real live read sets these.
  assert.equal(missingWorld(REQUIRED_BOTH, { internal: 'yes', public: 1 }), 'internal')
})

/* ═══ P, Q — AN ATTEMPT IS NOT A COMPLETION ═════════════════════════════ */

test('*** P — ⛔ an UNAVAILABLE public read does not satisfy the public world ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector({ publicFails: true })
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('試過，唔得。'), FINAL('再試都唔得。'), FINAL('第五次都係唔得。')])
    await run('我哋成本同市場比', a, MIXED_DEPS(c, { mixedVerifier: spy('mixed').fn, ambiguityVerifier: ambiSpy('allow').fn, sourceIntentResolver: SIR('mixed') }))
    // The public read was ATTEMPTED and failed. The requirement is still unmet, so the first
    // FINAL is refused — attempted is not read, applied to completion.
    assert.equal(c.publicReads.length, 1, 'it was attempted')
    /**
     * ⛔ OWNER RULING 2026-08-12: 4 → 5 here because a reserved compose call now follows the
     * exhausted budget (this is a mixed turn, so its read bound is 4, plus one compose).
     *
     * ⛔ AND THE PROPERTY THIS TEST EXISTS FOR IS UNCHANGED: the requirement is still unmet,
     * so the completion guard refuses the reserved final TOO. An answer the guard would refuse
     * must not become shippable by arriving one call later.
     */
    assert.equal(a.calls.length, 5, 'the final was intercepted, and the reserved compose was too')
  })
})

test('*** Q — ⛔ a REFUSED internal read does not satisfy the internal world ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // An invented capability is refused before the connector: no read, no world.
    const a = scriptedAdapter([READ('aroma_system.invented'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('唔齊。'), FINAL('仍然唔齊。'), FINAL('第五次都唔齊。')])
    await run('我哋成本同市場比', a, MIXED_DEPS(c, { mixedVerifier: spy('mixed').fn, ambiguityVerifier: ambiSpy('allow').fn, sourceIntentResolver: SIR('mixed') }))
    assert.equal(c.internalReads.length, 0, 'nothing internal was ever read')
    // ⛔ 4 → 5 for the reserved compose call (Owner ruling 2026-08-12). The property is
    // unchanged: the internal world was never satisfied, so the guard refuses that call too.
    assert.equal(a.calls.length, 5, 'the final was intercepted, and so was the reserved compose')
  })
})

/* ═══ R, S — THE STEP BOUND ═════════════════════════════════════════════ */

/**
 * ⛔ OWNER RULING, 2026-08-12: THE COST GUARANTEE CHANGED FROM 3 MODEL CALLS TO 4.
 *
 * R and S asserted a DEFAULT of 3 and a ceiling clamp on the total number of model calls. The
 * bound was a cost and latency ceiling, not a correctness boundary, and a real business turn
 * spent all three calls on necessary reads with none left to compose (requestId a389dd4d-…).
 *
 * ⛔ THE PROPERTY THEY PROTECT IS UNCHANGED AND IS NOW ASSERTED MORE PRECISELY: a caller
 * cannot widen the READ bound. What is new is exactly one reserved compose call on top, which
 * cannot read — so the reads stay clamped and the total is reads + 1.
 */
test('*** R — ⛔ the default READ bound is still exactly 3, plus one reserved compose ***', async () => {
  assert.equal(MAX_REASONING_STEPS, 3)
  let steps = 0
  let reads = 0
  const out = await runReasoningLoop({
    capabilities: ['gmail'],
    callModel: async ({ step }) => { steps = step; return { type: 'read', capability: 'gmail' } },
    executeRead: async () => { reads++; return { capability: 'gmail', ok: true, summary: null } }
  })
  assert.equal(reads, 3, '⛔ unset maxSteps must not change the READ bound')
  assert.equal(steps, 4, 'and the reserved compose call is the fourth, never a fifth')
  // This model answers READ even on the reserved call, so nothing is composed.
  assert.equal(out.stopReason, STOP.STEP_LIMIT_NO_COMPOSE)
  assert.equal(out.steps, 4)
})

test('*** S — the caller may widen READS to 4, and no caller may exceed the ceiling ***', async () => {
  let steps = 0
  let reads = 0
  const loop = (maxSteps) => {
    reads = 0
    return runReasoningLoop({
      capabilities: ['gmail'],
      maxSteps,
      callModel: async ({ step }) => { steps = step; return { type: 'read', capability: 'gmail' } },
      executeRead: async () => { reads++; return { capability: 'gmail', ok: true, summary: null } }
    })
  }
  await loop(4); assert.equal(reads, 4, 'four reads'); assert.equal(steps, 5, 'plus the reserved compose')
  // ⛔ A bound the caller picks freely is not a bound. The READ clamp is what matters.
  await loop(99); assert.equal(reads, MAX_REASONING_STEPS_CEILING, '⛔ reads clamped to the ceiling')
  await loop(0); assert.equal(reads, 1, 'and never below one')
  await loop(undefined); assert.equal(reads, 3, 'unset is still 3 reads')
})

test('*** S2 — end to end: ONLY a mixed turn gets the fourth decision ***', async () => {
  await withEnv({}, async () => {
    // not_mixed + ambiguity allow: the turn keeps the bound of three, so a fourth envelope is
    // never requested. Scripting only three proves it — a fourth call would throw.
    const c = twoWorldConnector()
    const a = scriptedAdapter([READ(INV), READ(INV), FINAL('三步。')])
    await run('我哋自己嘅數', a, MIXED_DEPS(c, { mixedVerifier: spy('not_mixed').fn, ambiguityVerifier: ambiSpy('allow').fn, sourceIntentResolver: SIR('internal') }))
    assert.equal(a.calls.length, 3)
  })
})

/* ═══ T, U — THE HOOK IS OPTIONAL AND FAILS CLOSED ══════════════════════ */

test('*** T — no beforeFinal: behaviour is identical ***', async () => {
  const base = {
    capabilities: ['gmail'],
    callModel: async ({ step }) => (step === 1 ? { type: 'read', capability: 'gmail' } : { type: 'final', result: { ok: true } }),
    executeRead: async () => ({ capability: 'gmail', ok: true, summary: null })
  }
  const without = await runReasoningLoop(base)
  const allowed = await runReasoningLoop(Object.assign({}, base, { beforeFinal: async () => ({ type: 'allow' }) }))
  assert.deepEqual(without, allowed, 'an allowing hook changes nothing')
  assert.equal(without.stopReason, STOP.FINAL)
  assert.deepEqual(without.result, { ok: true })
})

test('*** U — ⛔ a hook that throws or returns nonsense does NOT release the answer ***', async () => {
  for (const bad of [
    async () => { throw new Error('exploded') },
    async () => null,
    async () => ({ type: 'proceed' }),
    async () => 'allow',
    async () => 42,
    async () => undefined
  ]) {
    const out = await runReasoningLoop({
      capabilities: ['gmail'],
      beforeFinal: bad,
      callModel: async () => ({ type: 'final', result: { leaked: 'INCOMPLETE ANSWER' } }),
      executeRead: async () => ({ ok: true })
    })
    assert.equal(out.result, null, '⛔ an incomplete answer was released')
    assert.equal(out.stopReason, STOP.BEFORE_FINAL)
  }
})

test('*** U2 — a refusal becomes an ordinary observation the model can act on ***', async () => {
  const seen = []
  let refusals = 0 // counted in beforeFinal itself; incrementing it in callModel meant the
  // hook saw n===1 on its first run and allowed the very final it was meant to refuse.
  const out = await runReasoningLoop({
    capabilities: ['gmail'],
    beforeFinal: async () => (refusals++ === 0 ? { type: 'refuse', observation: { ok: false, error: 'required_world_missing', requiredWorld: 'public' } } : { type: 'allow' }),
    callModel: async ({ observations }) => { seen.push(observations.slice()); return { type: 'final', result: { ok: true } } },
    executeRead: async () => ({ ok: true })
  })
  assert.equal(seen[1].length, 1, 'the second call sees the refusal')
  assert.deepEqual(seen[1][0], { ok: false, error: 'required_world_missing', requiredWorld: 'public' })
  assert.deepEqual(out.result, { ok: true })
})

/* ═══ V, W, X — STRUCTURE AND FENCES ════════════════════════════════════ */

const MIX_SRC = fs.readFileSync(path.resolve(__dirname, 'mixedKnowledgeRequirement.js'), 'utf8')
const MIX_CODE = MIX_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('*** V — ⛔ no write path, and no capability vocabulary at all ***', () => {
  // ⛔ WORD BOUNDARIES, NOT SUBSTRINGS — and the first draft of this test proved why by
  // failing on `createTurnMixedCache`. An unanchored `create` flags a factory name, which is
  // the same false-positive shape that made WRITE_SHAPED reject `order_planning`. A test that
  // cries wolf gets weakened later, so it is anchored now.
  for (const tok of ['send', 'create', 'update', 'delete', 'post', 'execute', 'approve', 'dispatch',
    'aroma_system', 'public_knowledge', 'gmail', 'drive', 'calendar', 'capability', 'connector']) {
    assert.equal(new RegExp('\\b' + tok + '\\b', 'i').test(MIX_CODE), false, `⛔ «${tok}» in the mixed verifier`)
  }
})

test('*** W — ⛔ no chain-of-thought field, in the schema or anywhere near it ***', () => {
  assert.deepEqual(Object.keys(MIXED_SCHEMA.properties), ['decision'])
  assert.deepEqual(MIXED_SCHEMA.required, ['decision'])
  assert.equal(MIXED_SCHEMA.additionalProperties, false)
  assert.equal(MIXED_SCHEMA.type, 'object', 'a nullable root is rejected at the provider — see A4 canary')
  for (const banned of ['reason', 'rationale', 'analysis', 'confidence', 'thought', 'thinking',
    'chainOfThought', 'tool', 'capability', 'provider', 'query', 'source']) {
    assert.equal(Object.prototype.hasOwnProperty.call(MIXED_SCHEMA.properties, banned), false, `⛔ ${banned}`)
  }
})

test('*** X — ⛔ no keyword classifier, no domain rule, no holdout string ***', () => {
  // The whole point is that this is a MODEL judgement about the shape of the request. A noun
  // list here would be the keyword router this slice was told not to build, wearing prose.
  for (const domain of ['牛肉', 'beef', '成本價', 'brisket', 'Gordon', '8.72', '供應商名']) {
    assert.equal(MIX_SRC.includes(domain), false, `⛔ domain token «${domain}» in the module`)
  }
  // And the live holdout sentence must not appear — putting it here makes the test a rehearsal.
  assert.equal(MIX_SRC.includes('Aroma 實際牛肉成本升幅同市場相比合理嗎'), false)
  // No regex over the Owner's words.
  assert.equal(/new RegExp|\.test\(|\.match\(/.test(MIX_CODE), false, '⛔ a regex over his message')
})

test('*** provider-neutral and network-free, proven statically ***', () => {
  for (const tok of ['OpenAIAdapter', 'ClaudeAdapter', 'modelRouter', 'openai', 'anthropic', 'claude', 'gpt', 'fetch(', 'https://', 'axios']) {
    assert.equal(MIX_CODE.toLowerCase().includes(tok.toLowerCase()), false, `⛔ «${tok}»`)
  }
})

test('*** the log line is an enum and two numbers ***', () => {
  let line = null
  logMixedRequirement({ requestId: 'r1', outcome: 'mixed', ownerMessageCount: 2, durationMs: 9 }, (l) => { line = l })
  assert.deepEqual(Object.keys(line).sort(), ['durationMs', 'event', 'outcome', 'ownerMessageCount', 'requestId', 'timestamp'])
  let bad = null
  logMixedRequirement({ outcome: 'mixed ' + SECRET, ownerMessageCount: 'lots' }, (l) => { bad = l })
  assert.equal(bad.outcome, 'unavailable')
  assert.equal(bad.ownerMessageCount, 0)
  assert.equal(JSON.stringify(bad).includes(SECRET), false)
})

test('*** the system text names no business noun and no implementation term ***', () => {
  assert.equal(/public_knowledge|aroma_system|readKey|nextRead|schema|API|endpoint/i.test(MIXED_SYSTEM), false)
  assert.ok(MIXED_SYSTEM.includes('兩邊'), 'it must state the one distinction it judges')
})

/* ═══ Y, Z — THE NEIGHBOURS STAY GREEN ══════════════════════════════════ */

test('*** Y — Owner-only egress provenance is untouched by mixed turns ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const seen = []
    const planner = async (i) => { seen.push(i); return { query: 'safe market query', freshness: 'current', location: null } }
    const leaky = `${TITLE} ${SUPPLIER} ${SECRET}`
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: leaky, freshness: 'current', location: null }), FINAL('ok')])
    await run('我哋成本同市場比', a, MIXED_DEPS(c, { publicQueryPlanner: planner, mixedVerifier: spy('mixed').fn, ambiguityVerifier: ambiSpy('allow').fn, sourceIntentResolver: SIR('mixed') }))
    // Still re-authored, still from his words only, still nothing internal leaving.
    assert.equal(seen.length, 1)
    assert.equal(JSON.stringify(seen[0]).includes(leaky), false, '⛔ the raw query reached the planner')
    const sent = JSON.stringify(c.publicReads[0].params)
    for (const v of [SECRET, SUPPLIER, TITLE]) assert.equal(sent.includes(v), false, `⛔ ${v} left`)
    assert.equal(c.publicReads[0].params.query, 'safe market query')
  })
})

test('*** Z — with no mixed verifier wired, the resolver still governs the world ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const sir = { calls: [], fn: async (i) => { sir.calls.push(i); return { intent: 'internal' } } }
    const a = scriptedAdapter([READ(INV), FINAL('照舊。')])
    // MIGRATED (SIR2): no mixedVerifier means no MIX1 requirement, and the resolver supplies the
    // single world. The internal read satisfies it, so the FINAL is released normally.
    const out = await run('我哋自己嘅數', a, MIXED_DEPS(c, { sourceIntentResolver: sir.fn }))
    assert.equal(sir.calls.length, 1)
    assert.equal(out.reply, '照舊。', 'a single-world FINAL is released, unguarded')
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 0)
  })
})
