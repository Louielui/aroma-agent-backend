'use strict'

/**
 * a4RecoveryWorker.test.js — A4-RR1: a bounded fallback for one decision the main brain misses.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED BEFORE BUILT. On one faithful, byte-identical recovery input — obligation
 * established, structural observation in the prompt, required capability in the authorised
 * enum — the main model chose the correct read 3/7 at LOW and 2/7 at MEDIUM. Raising effort
 * made it worse. A narrow worker asked only 「which authorised operation satisfies the world
 * we already know is missing」 scored 40/40 on the same four classes.
 *
 * ⛔ SO THE SCOPE IS DELIBERATELY TINY, and most of this file is about what it CANNOT do:
 * it never answers Louie, never sees evidence, never picks a world, never builds a query,
 * never writes, and never runs before the main brain has been given its own chance.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { processIntake } = require('./intakeService')
const {
  runRecoveryWorker, buildSchema, buildWorkerPrompt, worldForCapability,
  WORKER_SYSTEM, NO_CAPABILITY, OUTCOME, logRecoveryWorker
} = require('./recoveryDecisionWorker')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')
const { operationsForSources } = require('../context/readOperations')

const NOW = '2026-08-09T00:00:00.000Z'
const PUB = 'public_knowledge.search'
const INV = 'aroma_system.invoices'
const SECRET = 'AROMA_INTERNAL_ONLY_9842'
const SUPPLIER = 'Gordon'
const PRICE = '8.72'
const TITLE = 'Beef Brisket'
const INTERNAL_VALUES = [SECRET, SUPPLIER, PRICE, TITLE]
const CAPS = operationsForSources(['aroma_system', 'public_knowledge'])

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
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'scripted-gpt-stand-in', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ = (capability, args) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: args === undefined ? { capability } : { capability, args }, answerPlan: null })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })
const ASK = (reply) => ({ intent: 'question', mode: 'ask', reply, nextRead: null, answerPlan: null })

const finalSpy = (decision) => { const calls = []; return { calls, fn: async (i) => { calls.push(i); return { decision, question: null } } } }
/** A worker that always picks the given capability, and records everything it was handed. */
const workerSpy = (capability) => {
  const calls = []
  return { calls, fn: async (i) => { calls.push(i); return { decision: capability === NO_CAPABILITY ? 'cannot_route' : 'read', capability } } }
}
const SAFE_PLANNER = async () => ({ query: 'wholesale market price trend', freshness: 'current', location: null })

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
const run = (msg, adapter, deps, history) => processIntake(msg, adapter, history || [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
})
const DEPS = (c, extra = {}) => Object.assign({ connector: c.connector, sources: BOTH, publicQueryPlanner: SAFE_PLANNER }, extra)

/* ═══ INVOCATION POLICY — THE MAIN BRAIN GOES FIRST ═════════════════════ */

test('*** A — an ordinary turn never touches the worker ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const w = workerSpy(PUB)
    await run('8.00 升到 8.72 係幾多 %', scriptedAdapter([FINAL('9%')]), DEPS(c, { finalVerifier: finalSpy('allow_final').fn, recoveryWorker: w.fn }))
    assert.equal(w.calls.length, 0)
  })
})

test('*** B — ⛔ obligation exists but the MAIN model reads: worker = 0 ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const w = workerSpy(PUB)
    const a = scriptedAdapter([FINAL('未查。'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('查咗。')])
    const out = await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn, recoveryWorker: w.fn }))
    assert.equal(w.calls.length, 0, '⛔ the fallback must not pre-empt the main brain')
    assert.equal(c.publicReads.length, 1)
    assert.equal(out.reply, '查咗。')
  })
})

test('*** C — a SECOND terminal invokes the worker exactly once ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const w = workerSpy(PUB)
    // FINAL(initial, refused) → FINAL again (refused → worker fires) → FINAL with evidence.
    // FOUR calls, and the shape is the policy: distill(refused) → GPT's OWN recovery attempt
    // → a second terminal, which is what invokes the worker → the answer, with evidence.
    const a = scriptedAdapter([FINAL('未查。'), FINAL('仲係唔查。'), FINAL('第二次拒絕。'), FINAL('依家有料。')])
    const out = await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn, recoveryWorker: w.fn }))
    assert.equal(w.calls.length, 1, 'exactly once')
    assert.equal(c.publicReads.length, 1, 'and the read actually happened')
    assert.equal(out.reply, '依家有料。')
  })
})

test('*** S — one invocation per obligation, never a loop ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // The worker cannot route, so the world stays missing; it must NOT be asked again.
    const w = workerSpy(NO_CAPABILITY)
    const a = scriptedAdapter([FINAL('a'), FINAL('b'), FINAL('c'), FINAL('d'), FINAL('e')])
    await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn, recoveryWorker: w.fn }))
    assert.equal(w.calls.length, 1, '⛔ asked more than once for one missing world')
    assert.equal(c.publicReads.length, 0, 'cannot_route touches no connector')
  })
})

test('*** mixed: each missing world gets its OWN single invocation ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const calls = []
    const worker = async (i) => {
      calls.push(i.requiredWorld)
      return { decision: 'read', capability: i.requiredWorld === 'public' ? PUB : INV }
    }
    const a = scriptedAdapter([FINAL('a'), FINAL('b'), FINAL('c'), FINAL('d'), FINAL('e'), FINAL('f')])
    await run('我哋成本同市場比', a, DEPS(c, { finalVerifier: finalSpy('require_mixed').fn, recoveryWorker: worker }))
    assert.deepEqual(calls, ['internal', 'public'], 'internal first by reporting order, then public')
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 1)
  })
})

/* ═══ D, E — CORRECT-WORLD EXECUTION ════════════════════════════════════ */

test('*** D/E — the worker\'s choice is executed in the required world ***', async () => {
  for (const [world, decision, cap, expect] of [
    ['public', 'require_public', PUB, { internal: 0, public: 1 }],
    ['internal', 'require_internal', INV, { internal: 1, public: 0 }]
  ]) {
    await withEnv({}, async () => {
      const c = twoWorldConnector()
      const a = scriptedAdapter([FINAL('a'), FINAL('b'), FINAL('c'), FINAL('done')])
      await run('問題', a, DEPS(c, { finalVerifier: finalSpy(decision).fn, recoveryWorker: workerSpy(cap).fn }))
      assert.equal(c.internalReads.length, expect.internal, world)
      assert.equal(c.publicReads.length, expect.public, world)
    })
  }
})

/* ═══ F, G, H, I, J, K — THE SERVER DISPOSES ════════════════════════════ */

test('*** F — ⛔ a WRONG-WORLD choice is refused and nothing is read ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // public is required; the worker names an internal operation.
    const a = scriptedAdapter([FINAL('a'), FINAL('b'), FINAL('c'), FINAL('d')])
    await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn, recoveryWorker: workerSpy(INV).fn }))
    assert.equal(c.internalReads.length, 0, '⛔ the worker overrode the world')
    assert.equal(c.publicReads.length, 0)
  })
})

test('*** G/H — unknown and write-shaped capabilities are refused ***', async () => {
  for (const bad of ['aroma_system.invented', 'public_knowledge.browse', 'aroma_system.send_invoice', 'send_email', '']) {
    const r = await runRecoveryWorker({
      decide: async () => ({ decision: 'read', capability: bad }),
      message: '市場價點', history: [], requiredWorld: 'public', completedWorlds: {}, capabilities: CAPS
    })
    assert.equal(r.ok, false, bad)
    assert.equal(r.capability, null, bad)
  }
})

test('*** I/J — malformed output and a throwing worker both fail closed ***', async () => {
  for (const [label, decide] of [
    ['missing', null],
    ['throws', async () => { throw new Error('boom') }],
    ['malformed', async () => ({ verdict: 'read' })],
    ['not json', async () => 'just read the public one'],
    ['null', async () => null],
    ['array', async () => []],
    ['unknown decision', async () => ({ decision: 'maybe', capability: PUB })]
  ]) {
    const r = await runRecoveryWorker({ decide, message: 'x', history: [], requiredWorld: 'public', completedWorlds: {}, capabilities: CAPS })
    assert.equal(r.ok, false, label)
    assert.equal(r.capability, null, label)
  }
})

test('*** K — cannot_route touches no connector ***', async () => {
  const r = await runRecoveryWorker({
    decide: async () => ({ decision: 'cannot_route', capability: NO_CAPABILITY }),
    message: 'x', history: [], requiredWorld: 'public', completedWorlds: {}, capabilities: CAPS
  })
  assert.equal(r.ok, false)
  assert.equal(r.outcome, OUTCOME.CANNOT_ROUTE)
})

test('*** no authorised capabilities at all → cannot route, no call spent ***', async () => {
  let calls = 0
  const r = await runRecoveryWorker({ decide: async () => { calls++; return { decision: 'read', capability: PUB } }, message: 'x', history: [], requiredWorld: 'public', completedWorlds: {}, capabilities: [] })
  assert.equal(r.ok, false)
  assert.equal(calls, 0)
})

/* ═══ L, M, N, O, P — WHAT THE WORKER MAY SEE ═══════════════════════════ */

test('*** L/M — Owner-only input: assistant turns and unknown roles excluded ***', async () => {
  const seen = []
  await runRecoveryWorker({
    decide: async (i) => { seen.push(i); return { decision: 'read', capability: PUB } },
    message: '市場。',
    history: [
      { role: 'user', text: 'OWNER_ONE' },
      { role: 'assistant', text: `我哋同 ${SUPPLIER} 買 ${TITLE}，單價 ${PRICE}` },
      { text: 'NO_ROLE' }, { role: 'weird', text: 'ODD' }, { role: 'system', text: 'SYS' }
    ],
    requiredWorld: 'public', completedWorlds: { internal: true }, capabilities: CAPS
  })
  assert.deepEqual(seen[0].ownerMessages, ['OWNER_ONE', '市場。'])
  const handed = JSON.stringify(seen[0]) + buildWorkerPrompt(seen[0])
  for (const v of INTERNAL_VALUES.concat(['NO_ROLE', 'ODD', 'SYS'])) {
    assert.equal(handed.includes(v), false, `⛔ ${v} reached the worker`)
  }
  // The complete input surface, asserted as a closed list.
  assert.deepEqual(Object.keys(seen[0]).sort(), ['capabilities', 'completedWorlds', 'ownerMessages', 'requiredWorld', 'schema', 'system'])
})

test('*** N/O/P — ⛔ end to end, a mixed turn sends the worker NO internal evidence ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const seen = []
    const worker = async (i) => { seen.push(i); return { decision: 'read', capability: PUB } }
    // Internal is read FIRST and really does produce the four values; then the model refuses
    // twice on the public side and the worker is asked.
    const a = scriptedAdapter([READ(INV), FINAL('REJECTED_GPT_ANSWER_SENTINEL'), FINAL('仲係唔查。'), FINAL('齊料。')])
    await run('我哋成本同市場比', a, DEPS(c, { finalVerifier: finalSpy('require_mixed').fn, mixedVerifier: async () => ({ decision: 'mixed' }), recoveryWorker: worker }))
    assert.equal(c.internalReads.length, 1, 'internal evidence really existed')
    assert.ok(seen.length >= 1, 'and the worker ran')
    const handed = JSON.stringify(seen) + seen.map(buildWorkerPrompt).join('\n')
    for (const v of INTERNAL_VALUES) assert.equal(handed.includes(v), false, `⛔ ${v} reached the worker`)
    assert.equal(handed.includes('REJECTED_GPT_ANSWER_SENTINEL'), false, '⛔ the rejected answer reached the worker')
  })
})

/* ═══ Q, R — EGRESS REMAINS SERVER-OWNED ════════════════════════════════ */

test('*** Q/R — ⛔ a worker-selected public read still goes through the Owner-only planner ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const plannerSeen = []
    const planner = async (i) => { plannerSeen.push(i); return { query: 'safe generic market query', freshness: 'current', location: null } }
    const a = scriptedAdapter([READ(INV), FINAL('a'), FINAL('b'), FINAL('齊料。')])
    await run('我哋成本同市場比', a, DEPS(c, {
      publicQueryPlanner: planner,
      finalVerifier: finalSpy('require_mixed').fn,
      mixedVerifier: async () => ({ decision: 'mixed' }),
      recoveryWorker: workerSpy(PUB).fn
    }))
    assert.equal(c.publicReads.length, 1)
    assert.equal(plannerSeen.length, 1, '⛔ the worker bypassed the egress planner')
    assert.equal(c.publicReads[0].params.query, 'safe generic market query')
    const sent = JSON.stringify(c.publicReads[0].params)
    for (const v of INTERNAL_VALUES) assert.equal(sent.includes(v), false, `⛔ ${v} left the process`)
  })
})

/* ═══ T, U — THE MAIN BRAIN STILL ANSWERS ═══════════════════════════════ */

test('*** T/U — after the worker\'s read, the ANSWER is produced by the main model ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([FINAL('a'), FINAL('b'), FINAL('c'), FINAL('MAIN_MODEL_ANSWER')])
    const out = await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn, recoveryWorker: workerSpy(PUB).fn }))
    assert.equal(out.reply, 'MAIN_MODEL_ANSWER', '⛔ the worker must never author the reply')
    // Three main-model calls; the worker is not one of them.
    assert.equal(a.calls.length, 4)
  })
})

test('*** the worker cannot author an ASK either ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([ASK('WORKER_MUST_NOT_SPEAK'), ASK('still'), ASK('again'), FINAL('齊料。')])
    const out = await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn, recoveryWorker: workerSpy(PUB).fn }))
    assert.equal(String(out.reply).includes('WORKER_MUST_NOT_SPEAK'), false)
    assert.equal(out.reply, '齊料。')
  })
})

/* ═══ V — A4 OFF ════════════════════════════════════════════════════════ */

test('*** V — ⛔ with A4 OFF the worker never runs ***', async () => {
  await withEnv({ [A4_FLAG]: 'off' }, async () => {
    const c = twoWorldConnector()
    const w = workerSpy(PUB)
    const out = await run('市場價點', scriptedAdapter([FINAL('照舊答。')]), DEPS(c, { finalVerifier: finalSpy('require_public').fn, recoveryWorker: w.fn }))
    assert.equal(w.calls.length, 0)
    assert.equal(out.reply, '照舊答。')
  })
})

/* ═══ W, X, Y — STRUCTURE AND FENCES ════════════════════════════════════ */

const SRC = fs.readFileSync(path.resolve(__dirname, 'recoveryDecisionWorker.js'), 'utf8')
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('*** W — ⛔ no write path, and no provider anywhere in the module ***', () => {
  for (const tok of ['send', 'create', 'update', 'delete', 'post', 'execute', 'approve', 'dispatch']) {
    assert.equal(new RegExp('\\b' + tok + '\\b', 'i').test(CODE), false, `⛔ write verb «${tok}»`)
  }
  for (const tok of ['ClaudeAdapter', 'OpenAIAdapter', 'anthropic', 'openai', 'claude', 'gpt', 'haiku', 'fetch(', 'https://']) {
    assert.equal(CODE.toLowerCase().includes(tok.toLowerCase()), false, `⛔ provider token «${tok}» — the module must stay neutral`)
  }
})

test('*** X — ⛔ the schema is closed, portable, and carries no reasoning or query field ***', () => {
  const s = buildSchema(CAPS)
  assert.equal(s.type, 'object')
  assert.equal(s.additionalProperties, false)
  assert.deepEqual(s.required.slice().sort(), ['capability', 'decision'])
  assert.deepEqual(Object.keys(s.properties).sort(), ['capability', 'decision'])
  for (const banned of ['reason', 'rationale', 'analysis', 'confidence', 'answer', 'message', 'query', 'freshness', 'location', 'params', 'args']) {
    assert.equal(Object.prototype.hasOwnProperty.call(s.properties, banned), false, `⛔ ${banned}`)
  }
  // ⛔ PORTABLE BY CONSTRUCTION. OpenAI strict mode requires nullable unions for optionality;
  // Anthropic rejects a nullable union carrying an enum (verified live). So nothing here is
  // nullable — `none` is the sentinel — and that is why this contract works on both.
  const json = JSON.stringify(s)
  assert.equal(json.includes('null'), false, '⛔ a nullable field is not portable to both dialects')
  assert.ok(s.properties.capability.enum.includes(NO_CAPABILITY))
  assert.ok(s.properties.capability.enum.includes(PUB))
})

test('*** Y — no keyword routing, no domain noun, no holdout sentence ***', () => {
  for (const tok of ['市場', 'market', 'beef', '牛肉', 'Canada', '未能取得', 'cannot access']) {
    assert.equal(CODE.includes(tok), false, `⛔ «${tok}» decides routing`)
  }
  assert.equal(SRC.includes('加拿大牛肉批發市場價點'), false)
  assert.equal(/(message|ownerMessages)\s*\.\s*(test|match|includes|search)\s*\(/.test(CODE), false, '⛔ matches Owner text')
  assert.equal(/public_knowledge|aroma_system|readKey|nextRead/i.test(WORKER_SYSTEM), false, '⛔ implementation vocabulary in the prompt')
})

test('*** the world rule is the same one A4 uses everywhere ***', () => {
  assert.equal(worldForCapability(PUB), 'public')
  assert.equal(worldForCapability('public_knowledge.search@abc'), 'public')
  for (const c of [INV, 'aroma_system.inventory', 'gmail', 'drive']) assert.equal(worldForCapability(c), 'internal', c)
})

test('*** the log line is enums and identifiers only ***', () => {
  let line = null
  logRecoveryWorker({ requestId: 'r1', outcome: OUTCOME.ROUTED, requiredWorld: 'public', capability: PUB, durationMs: 12 }, (l) => { line = l })
  assert.deepEqual(Object.keys(line).sort(), ['capability', 'durationMs', 'event', 'outcome', 'requestId', 'requiredWorld', 'timestamp'])
  let bad = null
  logRecoveryWorker({ outcome: 'routed ' + SECRET, requiredWorld: 'x' }, (l) => { bad = l })
  assert.equal(bad.outcome, OUTCOME.FAILED)
  assert.equal(bad.requiredWorld, 'internal')
  assert.equal(JSON.stringify(bad).includes(SECRET), false)
})

test('*** Z — the wiring pins the exact measured model, and does not touch the global default ***', () => {
  const wiring = fs.readFileSync(path.resolve(__dirname, 'intakeService.js'), 'utf8')
  assert.ok(wiring.includes("RECOVERY_WORKER_MODEL = 'claude-haiku-4-5-20251001'"),
    'the dated build that scored 40/40 is pinned in wiring')
  const adapter = fs.readFileSync(path.resolve(__dirname, '../adapters/ClaudeAdapter.js'), 'utf8')
  assert.ok(adapter.includes('claude-3-5-haiku-20241022'),
    'the global adapter default is deliberately UNCHANGED here — retired-default repair is a separate follow-up')
})

test('*** semantic guidance is unchanged ***', () => {
  const crypto = require('node:crypto')
  const { A4_SEMANTIC_GUIDANCE } = require('./a4Contract')
  assert.equal(crypto.createHash('sha256').update(A4_SEMANTIC_GUIDANCE).digest('hex'),
    'cfc917cc38b8c50453d506d2b74539511826c319bd9d955aad59dbf8151e8523')
})
