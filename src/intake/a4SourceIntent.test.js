'use strict'

/**
 * a4SourceIntent.test.js — A4-SIR2: ONE authority for which world the Owner meant.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THE OLD GATE WAS REPLACED RATHER THAN TUNED.
 *
 * It asked 「has he clearly said internal or public?」 — a property of his message alone — and
 * the `proposedWorld` it was handed never reached its prompt, because no committed body
 * builder existed and every seam dropped the field. So it could not express 「would reading
 * THIS world preserve his meaning」, and it returned `allow` even when his clear meaning
 * pointed at the OTHER world. Measured, it also over-asked on the one cell that mattered:
 * clear-public/proposed-public ALLOW — GPT 2/10, Claude 0/10. Rewording moved the error
 * instead of removing it: ask-heavy caught ambiguity and blocked clear questions, allow-heavy
 * did the reverse.
 *
 * This resolves what he MEANT, independently, and the server routes afterwards.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const { processIntake } = require('./intakeService')
const {
  INTENT, INTENT_SCHEMA, INTENT_SYSTEM, WORLDS_FOR_INTENT, CLARIFY_QUESTION, OUTCOME,
  buildIntentPrompt, validateIntent, runOwnerSourceIntent, createTurnIntentCache,
  worldForCapability, readMatchesIntent, logOwnerSourceIntent
} = require('./ownerSourceIntentResolver')
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

/* ═══ FIXTURES ═══════════════════════════════════════════════════════════ */

function twoWorldConnector () {
  const internalReads = []; const publicReads = []
  return {
    internalReads,
    publicReads,
    connector: {
      async read (source, method, params) {
        if (source === 'public_knowledge') {
          publicReads.push({ method, params: JSON.parse(JSON.stringify(params || {})) })
          const rows = [{ source, sourceId: 'PUB-001', title: 'Wholesale index', entityType: 'public_item', content: 'index=112.4', fields: { id: 'PUB-001', index: '112.4' }, trust: 'live', retrievedAt: NOW, originalDate: '2026-07-31', link: null, error: null }]
          return { asOf: NOW, source, count: 1, results: rows, evidence: { source, endpoint: method, entityType: 'public_item', rowShape: { hasLocation: false, hasAsOf: true, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE' } }
        }
        internalReads.push({ method, params: JSON.parse(JSON.stringify(params || {})) })
        const rows = [{ source, sourceId: '7', title: TITLE, entityType: 'purchase_order', content: `supplier=${SUPPLIER} · unitPrice=${PRICE} · code=${SECRET}`, fields: { id: '7', supplier: SUPPLIER, unitPrice: PRICE, code: SECRET }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }]
        return { asOf: NOW, source, count: 1, results: rows, evidence: { source, endpoint: method, entityType: 'purchase_order', rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE' } }
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

const SIR = (intent) => async () => ({ intent })
const sirSpy = (intent) => { const calls = []; return { calls, fn: async (i) => { calls.push(i); return { intent } } } }
const SAFE_PLANNER = async () => ({ query: 'market price trend', freshness: 'current', location: null })

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

/* ═══ THE FOUR MEANINGS, END TO END ═════════════════════════════════════ */

test('*** ambiguous → ASK, and ZERO reads ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([READ(INV), FINAL('唔應該到呢度')])
    const out = await run('最近點', a, DEPS(c, { sourceIntentResolver: SIR('ambiguous') }))
    assert.equal(out.mode, 'ask')
    assert.ok(String(out.reply).includes(CLARIFY_QUESTION))
    assert.equal(c.internalReads.length, 0, '⛔ an open meaning must read nothing')
    assert.equal(c.publicReads.length, 0)
  })
})

test('*** internal → internal only ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([READ(INV), FINAL('我哋嗰邊。')])
    await run('我哋自己嘅成本點', a, DEPS(c, { sourceIntentResolver: SIR('internal') }))
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 0)
  })
})

test('*** public → public only ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('出面嗰邊。')])
    await run('出面行情點', a, DEPS(c, { sourceIntentResolver: SIR('public') }))
    assert.equal(c.publicReads.length, 1)
    assert.equal(c.internalReads.length, 0)
  })
})

test('*** mixed → both worlds, and either may be read first ***', async () => {
  for (const envelopes of [
    [READ(INV), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('齊。')],
    [READ(PUB, { query: 'q', freshness: null, location: null }), READ(INV), FINAL('齊。')]
  ]) {
    await withEnv({}, async () => {
      const c = twoWorldConnector()
      await run('我哋同出面比', scriptedAdapter(envelopes), DEPS(c, { sourceIntentResolver: SIR('mixed') }))
      assert.equal(c.internalReads.length, 1)
      assert.equal(c.publicReads.length, 1)
    })
  }
})

/* ═══ ⛔ THE WRONG WORLD IS NEVER EXECUTED ══════════════════════════════ */

test('*** ⛔ a READ in the world he did NOT mean is refused before the connector ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // He meant public; the model proposes internal. The OLD gate returned `allow` here — his
    // meaning WAS clear — and the wrong world was read.
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('改返啱。')])
    const out = await run('出面行情點', a, DEPS(c, { sourceIntentResolver: SIR('public') }))
    assert.equal(c.internalReads.length, 0, '⛔ THE WRONG WORLD WAS EXECUTED')
    assert.equal(c.publicReads.length, 1, 'and the model recovered into the right one')
    assert.equal(out.reply, '改返啱。')
  })
})

test('*** the wrong-world refusal establishes the CORRECT obligation ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // Every proposal is the wrong world, so nothing is ever read and no answer is released.
    const a = scriptedAdapter([READ(INV), READ(INV), FINAL('唔應該出街'), FINAL('都唔應該')])
    const out = await run('出面行情點', a, DEPS(c, { sourceIntentResolver: SIR('public') }))
    assert.equal(c.internalReads.length, 0)
    assert.equal(c.publicReads.length, 0)
    assert.equal(String(out.reply || '').includes('唔應該'), false, '⛔ an answer with no required evidence was released')
  })
})

/* ═══ INPUT: OWNER-ONLY, AND NO AVAILABILITY BIAS ══════════════════════ */

test('*** ⛔ the resolver sees Owner words only — and is told nothing about the system ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const v = sirSpy('internal')
    const a = scriptedAdapter([READ(INV), FINAL('ok')])
    await run('我哋自己嘅成本點', a, DEPS(c, { sourceIntentResolver: v.fn }), [
      { role: 'user', text: 'OWNER_PRIOR' },
      { role: 'assistant', text: `我哋同 ${SUPPLIER} 買 ${TITLE}，單價 ${PRICE}` },
      { text: 'NO_ROLE' }, { role: 'weird', text: 'ODD' }
    ])
    assert.deepEqual(v.calls[0].ownerMessages, ['OWNER_PRIOR', '我哋自己嘅成本點'])
    // ⛔ THE COMPLETE INPUT SURFACE. No proposedWorld — that is what biased the old gate into
    // answering 「may I proceed?」. No availableWorlds — availability must not decide meaning.
    assert.deepEqual(Object.keys(v.calls[0]).sort(), ['ownerMessages', 'schema', 'system'])
    const handed = JSON.stringify(v.calls[0]) + buildIntentPrompt(v.calls[0].ownerMessages)
    for (const x of INTERNAL_VALUES.concat(['NO_ROLE', 'ODD'])) {
      assert.equal(handed.includes(x), false, `⛔ ${x} reached the resolver`)
    }
  })
})

test('*** ⛔ live internal evidence never reaches the resolver ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const v = sirSpy('mixed')
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('齊。')])
    await run('我哋同出面比', a, DEPS(c, { sourceIntentResolver: v.fn }))
    assert.equal(c.internalReads.length, 1, 'the four values really existed in the turn')
    const handed = JSON.stringify(v.calls)
    for (const x of INTERNAL_VALUES) assert.equal(handed.includes(x), false, `⛔ ${x} reached the resolver`)
  })
})

/* ═══ CACHE ════════════════════════════════════════════════════════════ */

test('*** resolved at most once per stable Owner context ***', async () => {
  const cache = createTurnIntentCache()
  let calls = 0
  const resolve = async () => { calls++; return { intent: 'public' } }
  const a = await cache.get({ resolve, message: 'x', history: [] })
  const b = await cache.get({ resolve, message: 'x', history: [] })
  assert.equal(calls, 1)
  assert.deepEqual(a, b)
  // A different Owner context is a different question and resolves again.
  await cache.get({ resolve, message: 'y', history: [] })
  assert.equal(calls, 2)
})

test('*** one turn spends exactly one resolver call ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const v = sirSpy('mixed')
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('齊。')])
    await run('我哋同出面比', a, DEPS(c, { sourceIntentResolver: v.fn }))
    assert.equal(v.calls.length, 1)
  })
})

/* ═══ FAIL CLOSED ══════════════════════════════════════════════════════ */

test('*** ⛔ every unusable resolver result fails closed to a QUESTION, never a read ***', async () => {
  for (const [label, resolve] of [
    ['missing', null],
    ['throws', async () => { throw new Error('boom') }],
    ['malformed', async () => ({ verdict: 'public' })],
    ['unknown value', async () => ({ intent: 'somewhere' })],
    ['not json', async () => 'public please'],
    ['null', async () => null],
    ['array', async () => []]
  ]) {
    const r = await runOwnerSourceIntent({ resolve, message: 'x', history: [] })
    assert.equal(r.intent, INTENT.AMBIGUOUS, label)
    assert.equal(r.requiredWorlds, null, label)
    assert.equal(r.question, CLARIFY_QUESTION, label)
  }
})

test('*** end to end, a broken resolver reads nothing and asks ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([READ(INV), FINAL('x')])
    const out = await run('最近點', a, DEPS(c, { sourceIntentResolver: async () => { throw new Error('down') } }))
    assert.equal(out.mode, 'ask')
    assert.equal(c.internalReads.length, 0)
    assert.equal(c.publicReads.length, 0)
  })
})

test('*** no Owner text at all → ask, and no call is spent ***', async () => {
  let calls = 0
  const r = await runOwnerSourceIntent({ resolve: async () => { calls++; return { intent: 'public' } }, message: '   ', history: [{ role: 'assistant', text: 'hers' }] })
  assert.equal(r.intent, INTENT.AMBIGUOUS)
  assert.equal(calls, 0)
})

/* ═══ A4 OFF ═══════════════════════════════════════════════════════════ */

test('*** ⛔ A4 OFF: the resolver never runs ***', async () => {
  await withEnv({ [A4_FLAG]: 'off' }, async () => {
    const c = twoWorldConnector()
    const v = sirSpy('ambiguous')
    const a = scriptedAdapter([READ(INV), FINAL('照舊。')])
    const out = await run('最近點', a, DEPS(c, { sourceIntentResolver: v.fn }))
    assert.equal(v.calls.length, 0)
    assert.equal(out.reply, '照舊。')
  })
})

/* ═══ PURE CONTRACT ════════════════════════════════════════════════════ */

test('*** the four intents map to the worlds they oblige ***', () => {
  assert.deepEqual(WORLDS_FOR_INTENT[INTENT.INTERNAL], { internal: true, public: false })
  assert.deepEqual(WORLDS_FOR_INTENT[INTENT.PUBLIC], { internal: false, public: true })
  assert.deepEqual(WORLDS_FOR_INTENT[INTENT.MIXED], { internal: true, public: true })
  assert.equal(WORLDS_FOR_INTENT[INTENT.AMBIGUOUS], null)
})

test('*** readMatchesIntent: mixed accepts either side, single worlds do not ***', () => {
  assert.equal(readMatchesIntent(PUB, 'mixed'), true)
  assert.equal(readMatchesIntent(INV, 'mixed'), true)
  assert.equal(readMatchesIntent(PUB, 'public'), true)
  assert.equal(readMatchesIntent(INV, 'public'), false)
  assert.equal(readMatchesIntent(INV, 'internal'), true)
  assert.equal(readMatchesIntent(PUB, 'internal'), false)
  assert.equal(worldForCapability('public_knowledge.search@abc'), 'public')
})

test('*** the admission filter accepts only the four words ***', () => {
  for (const g of ['internal', 'public', 'mixed', 'ambiguous']) assert.equal(validateIntent({ intent: g }), g)
  assert.equal(validateIntent('{"intent":"public"}'), 'public')
  for (const bad of [null, undefined, '', 'nope', { intent: 'PUBLIC' }, { intent: true }, 42, []]) {
    assert.equal(validateIntent(bad), null, JSON.stringify(bad))
  }
})

test('*** ⛔ the schema is closed, portable, and carries no reasoning field ***', () => {
  assert.equal(INTENT_SCHEMA.type, 'object')
  assert.equal(INTENT_SCHEMA.additionalProperties, false)
  assert.deepEqual(INTENT_SCHEMA.required, ['intent'])
  assert.deepEqual(Object.keys(INTENT_SCHEMA.properties), ['intent'])
  // Portable to both provider dialects: OpenAI requires nullable unions for optionality,
  // Anthropic rejects a nullable union carrying an enum. Nothing here is nullable.
  assert.equal(JSON.stringify(INTENT_SCHEMA).includes('null'), false)
  for (const banned of ['reason', 'rationale', 'confidence', 'analysis', 'capability', 'query', 'tool', 'provider']) {
    assert.equal(Object.prototype.hasOwnProperty.call(INTENT_SCHEMA.properties, banned), false, banned)
  }
})

test('*** the log line is an enum and a count ***', () => {
  let line = null
  logOwnerSourceIntent({ requestId: 'r1', outcome: 'public', ownerMessageCount: 2, durationMs: 7 }, (l) => { line = l })
  assert.deepEqual(Object.keys(line).sort(), ['durationMs', 'event', 'outcome', 'ownerMessageCount', 'requestId', 'timestamp'])
  let bad = null
  logOwnerSourceIntent({ outcome: 'public ' + SECRET, ownerMessageCount: 'lots' }, (l) => { bad = l })
  assert.equal(bad.outcome, OUTCOME.UNAVAILABLE)
  assert.equal(JSON.stringify(bad).includes(SECRET), false)
})

/* ═══ STATIC FENCES ════════════════════════════════════════════════════ */

const SRC = fs.readFileSync(path.resolve(__dirname, 'ownerSourceIntentResolver.js'), 'utf8')
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('*** ⛔ provider-neutral, network-free, write-free ***', () => {
  for (const tok of ['OpenAIAdapter', 'ClaudeAdapter', 'anthropic', 'openai', 'claude', 'gpt', 'haiku', 'sonnet', 'opus', 'fetch(', 'https://']) {
    assert.equal(CODE.toLowerCase().includes(tok.toLowerCase()), false, `⛔ «${tok}»`)
  }
  for (const tok of ['send', 'create', 'update', 'delete', 'post', 'execute', 'approve']) {
    assert.equal(new RegExp('\\b' + tok + '\\b', 'i').test(CODE), false, `⛔ write verb «${tok}»`)
  }
})

test('*** ⛔ no keyword router, and no holdout literal in the production prompt ***', () => {
  // The one place a keyword list would be invisible is the prompt itself. The corpus that
  // proved this contract is holdout data; memorising it would make the benchmark a rehearsal.
  for (const banned of ['人手成本', '牛肉', '市場', '供應商', 'Gordon', 'Beef Brisket', '8.72', SECRET]) {
    assert.equal(INTENT_SYSTEM.includes(banned), false, `⛔ holdout literal «${banned}» in the prompt`)
  }
  assert.equal(/(message|ownerMessages)\s*\.\s*(test|match|includes|search)\s*\(/.test(CODE), false, '⛔ matches Owner text')
  assert.equal(/new RegExp/.test(CODE), false)
  // And it must not name implementation vocabulary to a model.
  assert.equal(/public_knowledge|aroma_system|readKey|nextRead|capability/i.test(INTENT_SYSTEM), false)
})

test('*** ⛔ the resolver is NOT told the proposed world or what is available ***', () => {
  // The two inputs that broke the old gate. Their absence is the design, so it is asserted
  // against the module source, not merely against one call.
  assert.equal(/proposedWorld/.test(CODE), false, '⛔ proposedWorld reintroduced')
  assert.equal(/availableWorlds/.test(CODE), false, '⛔ availability may not bias meaning')
})

test('*** every other A4 semantic prompt is unchanged ***', () => {
  const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
  assert.equal(h(require('./sourceAmbiguityGate').VERIFIER_SYSTEM), '3417149904e7d898')
  assert.equal(h(require('./finalKnowledgeRequirement').FINAL_SYSTEM), '94e1582a004db4f3')
  assert.equal(h(require('./mixedKnowledgeRequirement').MIXED_SYSTEM), 'b7602decbe0dc59a')
  assert.equal(h(require('./publicQueryEgressPlanner').PLANNER_SYSTEM), '20c2e930db2262f4')
  assert.equal(h(require('./recoveryDecisionWorker').WORKER_SYSTEM), '01a5979a04a87343')
  assert.equal(h(require('./a4Contract').A4_SEMANTIC_GUIDANCE), 'cfc917cc38b8c504')
})

test('*** the clarification asks about MEANING, never about a tool ***', () => {
  assert.equal(/public_knowledge|aroma_system|connector|API|search|工具|系統/i.test(CLARIFY_QUESTION), false)
  assert.ok(CLARIFY_QUESTION.length > 0 && CLARIFY_QUESTION.length <= 60)
})

/* ═══════════════════════════════════════════════════════════════════════════
 * SIR3 — THE LAST DUAL AUTHORITY IS GONE
 *
 * The mixed VERIFIER used to run before the resolver on the first-READ path and could
 * establish 「both worlds」 by itself. Two components able to classify the same request is a
 * coincidence waiting to diverge, so it is unwired. What survives of MIX1 is its COMPLETENESS
 * guard — plain code, no model call — answering only 「given both are required, are both read?」
 * ═══════════════════════════════════════════════════════════════════════════ */

test('*** SIR3 — the mixed verifier can no longer establish a world, even when wired ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // It is injected AND told 'mixed'. It must be ignored, and the resolver must decide.
    const m = { calls: [], fn: async (i) => { m.calls.push(i); return { decision: 'mixed' } } }
    const a = scriptedAdapter([READ(INV), FINAL('內部就夠。')])
    const out = await run('我哋自己嘅成本點', a, DEPS(c, { mixedVerifier: m.fn, sourceIntentResolver: SIR('internal') }))
    assert.equal(m.calls.length, 0, '⛔ the second authority is still being consulted')
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 0, '⛔ a public obligation appeared from somewhere other than his meaning')
    assert.equal(out.reply, '內部就夠。', 'and the single-world turn finishes normally')
  })
})

test('*** SIR3 — every first-READ path resolves source intent first ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const v = sirSpy('internal')
    const a = scriptedAdapter([READ(INV), FINAL('ok')])
    await run('我哋自己嘅成本點', a, DEPS(c, { sourceIntentResolver: v.fn }))
    assert.equal(v.calls.length, 1, 'the resolver ran before the first read')
    assert.equal(c.internalReads.length, 1)
  })
})

test('*** SIR3 — mixed + first INTERNAL read: internal executes, public stays outstanding ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // A valid first half must NOT be rejected merely because the other half is not done.
    const a = scriptedAdapter([READ(INV), FINAL('得一半'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('兩邊齊。')])
    const out = await run('我哋同出面比', a, DEPS(c, { sourceIntentResolver: SIR('mixed') }))
    assert.equal(c.internalReads.length, 1, 'the first half executed')
    assert.equal(c.publicReads.length, 1, 'and the outstanding half was still required')
    assert.equal(out.reply, '兩邊齊。')
    assert.equal(String(out.reply).includes('得一半'), false, '⛔ a half answer was released')
  })
})

test('*** SIR3 — mixed + first PUBLIC read: public executes, internal stays outstanding ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('得一半'), READ(INV), FINAL('兩邊齊。')])
    const out = await run('出面同我哋比', a, DEPS(c, { sourceIntentResolver: SIR('mixed') }))
    assert.equal(c.publicReads.length, 1)
    assert.equal(c.internalReads.length, 1)
    assert.equal(out.reply, '兩邊齊。')
  })
})

test('*** SIR3 — the resolver is not re-asked when FinalKnowledge later demands more ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const v = sirSpy('public')
    // Initial terminal → FinalKnowledge require_* → resolver decides the world → read → answer.
    const a = scriptedAdapter([FINAL('未查。'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('查咗。')])
    const out = await run('出面行情點', a, DEPS(c, { finalVerifier: async () => ({ decision: 'require_internal', question: null }), sourceIntentResolver: v.fn }))
    assert.equal(v.calls.length, 1, 'one resolution per stable Owner context')
    // ⛔ AND THE FinalKnowledge SUFFIX IS NOT AUTHORITATIVE: it said require_INTERNAL, his
    // meaning said public, and the public world is what was read.
    assert.equal(c.publicReads.length, 1)
    assert.equal(c.internalReads.length, 0)
    assert.equal(out.reply, '查咗。')
  })
})
