'use strict'

/**
 * a4TerminalObligation.test.js — A4-FINAL2: asking is also a way to stop.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE LAST ESCAPE HATCH.
 *
 * A4-FINAL1 validated the model's initial FINAL and deliberately exempted mode:'ask', because
 * gating clarifications withheld legitimate ones and left the Owner with silence. That was
 * right as far as it went, and it left one hole open. Asked a question naming the country, the
 * commodity and the market — as unambiguous as a public request gets — the model returned an
 * ASK, reproducibly. The gate never ran, no read happened, and the Owner received a pointless
 * clarification instead of an answer.
 *
 * An ASK and a FINAL both END the turn without reading. So both are terminal, both are
 * validated by the SAME verifier on the same Owner-only input, and the guard that refuses an
 * incomplete answer refuses an incomplete question too.
 *
 * ⛔ THE ASYMMETRY IS THE DESIGN, and it is what keeps this from becoming an anti-ASK policy:
 *
 *     FINAL  require_* → refuse    allow_final → release    unusable → withhold
 *     ASK    require_* → SUPPRESS  allow_final → KEEP ASK   unusable → KEEP ASK
 *
 * Only a POSITIVE require_* may override a question. `allow_final` on an ASK means no
 * retrieval is needed — not that the question was pointless: the model may be asking which of
 * two things the OWNER PREFERS, and this is a knowledge gate, not an Owner-intent gate.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { processIntake } = require('./intakeService')
const { runReasoningLoop, MAX_REASONING_STEPS, STOP } = require('./reasoningLoop')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')

const NOW = '2026-08-09T00:00:00.000Z'
const PUB = 'public_knowledge.search'
const INV = 'aroma_system.invoices'
const SECRET = 'AROMA_INTERNAL_ONLY_9842'
const SUPPLIER = 'Gordon'
const TITLE = 'Beef Brisket'
const ASK_SENTINEL = 'MODEL_ASK_SENTINEL_你想睇邊邊'

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
/** THE MODEL'S OWN ASK — the thing that used to end the turn unchallenged. */
const ASK = (reply) => ({ intent: 'question', mode: 'ask', reply: reply || ASK_SENTINEL, nextRead: null, answerPlan: null })

const finalSpy = (decision, question) => {
  const calls = []
  const fn = async (i) => { calls.push(i); return { decision, question: decision === 'clarify' ? (question || '你想睇我哋自己定係出面？') : null } }
  fn.decision = decision // read by DEPS to derive the fixture's source intent
  return { calls, fn }
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
// MIGRATED (SIR2): the Owner Source Intent Resolver is now the ONE source-world authority,
// so a turn that reads must have a resolved intent. These suites test obligation/terminal/worker
// mechanics, not meaning resolution, so the fixture derives the intent from the decision the
// test's own FinalKnowledge stub was built with. A test that cares about intent overrides it.
const INTENT_FOR = { require_public: 'public', require_internal: 'internal', require_mixed: 'mixed' }
const DEPS = (c, extra = {}) => Object.assign({
  connector: c.connector,
  sources: BOTH,
  publicQueryPlanner: SAFE_PLANNER,
  sourceIntentResolver: async () => ({ intent: INTENT_FOR[extra.finalVerifier && extra.finalVerifier.decision] || 'mixed' })
}, extra)

/* ═══ A, B, C — require_* SUPPRESSES AN INITIAL ASK ═════════════════════ */

const SUPPRESSED = [
  ['A clear public  ', 'require_public', PUB, { internal: 0, public: 1 }],
  ['B clear internal', 'require_internal', INV, { internal: 1, public: 0 }]
]
for (const [label, decision, cap, expect] of SUPPRESSED) {
  test(`*** ${label.trim()} + initial ASK → ${decision} → ASK suppressed, world read ***`, async () => {
    await withEnv({}, async () => {
      const c = twoWorldConnector()
      const a = scriptedAdapter([ASK(), READ(cap, cap === PUB ? { query: 'q', freshness: null, location: null } : undefined), FINAL('查咗。')])
      const out = await run('問題', a, DEPS(c, { finalVerifier: finalSpy(decision).fn }))
      assert.equal(c.internalReads.length, expect.internal, label)
      assert.equal(c.publicReads.length, expect.public, label)
      assert.equal(out.reply, '查咗。')
      // ⛔ AND THE SUPPRESSED QUESTION IS NOWHERE.
      assert.equal(String(out.reply).includes(ASK_SENTINEL), false)
      assert.notEqual(out.mode, 'ask')
    })
  })
}

test('*** C — explicit mixed + initial ASK → require_mixed → both worlds ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([ASK(), READ(INV), FINAL('得內部。'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('兩邊都齊。')])
    const out = await run('我哋成本同市場比', a, DEPS(c, { finalVerifier: finalSpy('require_mixed').fn }))
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 1)
    assert.equal(out.reply, '兩邊都齊。')
  })
})

/* ═══ D, E — WHEN THE QUESTION IS RIGHT, IT SURVIVES ═══════════════════ */

test('*** D — ⛔ true ambiguity + initial ASK → clarify → ASK allowed, ZERO reads ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([ASK()])
    const out = await run('最近點', a, DEPS(c, { finalVerifier: finalSpy('clarify', '你想睇我哋自己定係外面市場？').fn }))
    assert.equal(out.mode, 'ask')
    assert.ok(String(out.reply).includes('你想睇我哋自己定係外面市場？'))
    assert.equal(c.internalReads.length, 0, '⛔ ambiguity is not a licence to read and see')
    assert.equal(c.publicReads.length, 0)
    assert.equal(a.calls.length, 1, 'and no recovery loop was entered')
  })
})

test('*** E — ⛔ allow_final + initial ASK → the ASK is PRESERVED, not forced into an answer ***', async () => {
  // The Owner-intent case. `allow_final` says no retrieval is needed; it does NOT say the
  // question was pointless. Turning every no-retrieval ASK into a forced answer would be a
  // new defect wearing this one's clothes.
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([ASK('你想我用邊個格式寫？')])
    const out = await run('幫我寫個總結', a, DEPS(c, { finalVerifier: finalSpy('allow_final').fn }))
    assert.equal(out.mode, 'ask', '⛔ the gate became a universal ASK suppressor')
    assert.ok(String(out.reply).includes('你想我用邊個格式寫？'), 'and it is the MODEL\'s own question')
    assert.equal(c.internalReads.length, 0)
    assert.equal(c.publicReads.length, 0)
    assert.equal(a.calls.length, 1)
  })
})

/* ═══ F, G, H, I — INPUT BOUNDARY, UNCHANGED ═══════════════════════════ */

test('*** F — ⛔ the model ASK text is never sent to the verifier ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const f = finalSpy('require_public')
    const a = scriptedAdapter([ASK(), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('done')])
    await run('市場價點', a, DEPS(c, { finalVerifier: f.fn }))
    assert.equal(f.calls.length, 1)
    assert.equal(JSON.stringify(f.calls[0]).includes(ASK_SENTINEL), false,
      '⛔ the question being judged must not be an input to the judgement')
  })
})

test('*** G/H — assistant history excluded; Owner-only bound preserved ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const f = finalSpy('require_public')
    const a = scriptedAdapter([ASK(), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('done')])
    await run('市場。', a, DEPS(c, { finalVerifier: f.fn }), [
      { role: 'user', text: 'OWNER_ONE' },
      { role: 'assistant', text: `我哋同 ${SUPPLIER} 買 ${TITLE}` },
      { text: 'NO_ROLE' }, { role: 'weird', text: 'ODD' }
    ])
    assert.deepEqual(f.calls[0].ownerMessages, ['OWNER_ONE', '市場。'])
    const handed = JSON.stringify(f.calls[0])
    for (const v of [SUPPLIER, TITLE, 'NO_ROLE', 'ODD']) assert.equal(handed.includes(v), false, `⛔ ${v}`)
  })
})

test('*** I — the verifier runs at most once per turn, ASK path included ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const f = finalSpy('require_mixed')
    const a = scriptedAdapter([ASK(), ASK('again'), READ(INV), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('done')])
    await run('我哋同市場比', a, DEPS(c, { finalVerifier: f.fn }))
    assert.equal(f.calls.length, 1)
  })
})

/* ═══ J, K, L — THE SECOND ASK IS ALSO REFUSED ═════════════════════════ */

test('*** J — ⛔ after require_public, a SECOND ASK cannot end the turn ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const events = []
    const orig = console.log
    console.log = (...x) => { if (x[0] === '[AROMA-REASONING]') { try { events.push(JSON.parse(x[1])) } catch (_) {} } }
    let out
    try {
      // The model asks, is suppressed, and then tries to ask AGAIN instead of reading.
      const a = scriptedAdapter([ASK(), ASK('SECOND_ASK_SENTINEL'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('查咗。')])
      out = await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn }))
    } finally { console.log = orig }
    assert.equal(c.publicReads.length, 1, '⛔ the second ASK became the escape hatch')
    assert.equal(out.reply, '查咗。')
    assert.equal(String(out.reply).includes('SECOND_ASK_SENTINEL'), false)
    assert.ok(events.some((e) => e && e.refusal === 'before_terminal'), 'the refusal is on the record')
  })
})

test('*** K — after require_internal, a second ASK is refused too ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([ASK(), ASK('again'), READ(INV), FINAL('查咗。')])
    const out = await run('我哋自己嘅數', a, DEPS(c, { finalVerifier: finalSpy('require_internal').fn }))
    assert.equal(c.internalReads.length, 1)
    assert.equal(out.reply, '查咗。')
  })
})

test('*** L — ⛔ under require_mixed, an ASK after ONE world is still refused ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([ASK(), READ(INV), ASK('得一半就想問'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('兩邊都齊。')])
    const out = await run('我哋同市場比', a, DEPS(c, { finalVerifier: finalSpy('require_mixed').fn }))
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 1)
    assert.equal(out.reply, '兩邊都齊。')
    assert.equal(String(out.reply).includes('得一半就想問'), false)
  })
})

/* ═══ M, N, O — WHEN THE OBLIGATION IS MET, NORMALITY RETURNS ══════════ */

test('*** M/N — once the required world is live, FINAL and ASK both behave normally ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([ASK(), READ(PUB, { query: 'q', freshness: null, location: null }), ASK('依家先問你想點睇')])
    const out = await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn }))
    // The obligation is satisfied, so a genuine follow-up question is allowed through.
    assert.equal(c.publicReads.length, 1)
    assert.equal(out.mode, 'ask')
    assert.ok(String(out.reply).includes('依家先問你想點睇'))
  })
})

test('*** O — with NO obligation, an ordinary ASK is untouched ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([ASK('普通問題')])
    const out = await run('隨便傾兩句', a, DEPS(c, { finalVerifier: finalSpy('allow_final').fn }))
    assert.equal(out.mode, 'ask')
    assert.ok(String(out.reply).includes('普通問題'))
  })
})

/* ═══ P, Q, R — NEIGHBOURS AND FAILURE ═════════════════════════════════ */

test('*** P — the pre-read ASK still happens, now owned by the source-intent resolver ***', async () => {
  // MIGRATED (SIR2). This asserted the OLD ambiguity gate's pre-read ASK. That gate is no
  // longer consulted at runtime — it could not express 「would reading THIS world preserve his
  // meaning」 and over-asked on clear questions (GPT 2/10, Claude 0/10 on that cell). The
  // guarantee it protected is unchanged and now belongs to the resolver: a genuinely open
  // meaning asks, and reads nothing.
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([READ(INV), FINAL('唔應該到呢度')])
    const out = await run('最近點', a, DEPS(c, {
      sourceIntentResolver: async () => ({ intent: 'ambiguous' }),
      finalVerifier: finalSpy('clarify').fn
    }))
    assert.equal(out.mode, 'ask')
    assert.equal(c.internalReads.length, 0, '⛔ an open meaning must read nothing')
    assert.equal(c.publicReads.length, 0)
  })
})

test('*** Q — ⛔ A4 OFF: an ASK behaves exactly as it always did ***', async () => {
  await withEnv({ [A4_FLAG]: 'off' }, async () => {
    const c = twoWorldConnector()
    const f = finalSpy('require_public')
    const a = scriptedAdapter([ASK('照舊問')])
    const out = await run('市場價點', a, DEPS(c, { finalVerifier: f.fn }))
    assert.equal(f.calls.length, 0, '⛔ the verifier ran with A4 off')
    assert.equal(out.mode, 'ask')
    assert.ok(String(out.reply).includes('照舊問'))
  })
})

test('*** R — ⛔ an unusable verifier on an initial ASK invents nothing and reads nothing ***', async () => {
  for (const [label, verify] of [
    ['missing', null],
    ['throws', async () => { throw new Error('down') }],
    ['malformed', async () => ({ verdict: 'require_public' })]
  ]) {
    await withEnv({}, async () => {
      const c = twoWorldConnector()
      const a = scriptedAdapter([ASK('原本個問題')])
      const out = await run('市場價點', a, DEPS(c, { finalVerifier: verify }))
      // No obligation invented, no read performed. And the QUESTION stands: an ASK asserts
      // nothing, so withholding it would only leave the Owner with silence — the direction is
      // deliberately opposite to an unverified FINAL, which IS withheld (see test T).
      assert.equal(c.internalReads.length, 0, label)
      assert.equal(c.publicReads.length, 0, label)
      assert.equal(out.mode, 'ask', label)
      assert.ok(String(out.reply).includes('原本個問題'), label)
    })
  }
})

/* ═══ S, T — NOTHING REFUSED MAY LEAK ══════════════════════════════════ */

test('*** S — ⛔ a rejected ASK never reaches the Owner through the fallback render ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // The obligation is never satisfied: the model asks at every step.
    const a = scriptedAdapter([ASK('LEAK_ASK_1'), ASK('LEAK_ASK_2'), ASK('LEAK_ASK_3'), ASK('LEAK_ASK_4')])
    const out = await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn }))
    for (const s of ['LEAK_ASK_1', 'LEAK_ASK_2', 'LEAK_ASK_3', 'LEAK_ASK_4']) {
      assert.equal(String(out.reply || '').includes(s), false, `⛔ ${s} leaked`)
    }
  })
})

test('*** T — ⛔ a rejected FINAL never reaches the Owner either ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([FINAL('LEAK_FINAL_1'), FINAL('LEAK_FINAL_2'), FINAL('LEAK_FINAL_3'), FINAL('LEAK_FINAL_4')])
    const out = await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn }))
    for (const s of ['LEAK_FINAL_1', 'LEAK_FINAL_2', 'LEAK_FINAL_3', 'LEAK_FINAL_4']) {
      assert.equal(String(out.reply || '').includes(s), false, `⛔ ${s} leaked`)
    }
  })
})

/* ═══ U, V — THE LOOP CONTRACT ═════════════════════════════════════════ */

test('*** U — ⛔ no hook at all: legacy loop behaviour is identical ***', async () => {
  const base = {
    capabilities: ['gmail'],
    callModel: async ({ step }) => (step === 1 ? { type: 'read', capability: 'gmail' } : { type: 'final', result: { ok: true } }),
    executeRead: async () => ({ capability: 'gmail', ok: true, summary: null })
  }
  const bare = await runReasoningLoop(base)
  assert.equal(bare.stopReason, STOP.FINAL)
  assert.deepEqual(bare.result, { ok: true })
  assert.equal(bare.steps, 2)
})

test('*** V — ⛔ beforeFinal and beforeTerminal are the SAME seam ***', async () => {
  // Backward compatibility, asserted rather than promised: a caller still passing the old name
  // gets byte-identical behaviour, on allow and on refuse.
  const mk = (key, impl) => runReasoningLoop({
    capabilities: ['gmail'],
    [key]: impl,
    callModel: async () => ({ type: 'final', result: { ok: true } }),
    executeRead: async () => ({ ok: true })
  })
  for (const impl of [
    async () => ({ type: 'allow' }),
    async () => null,
    async () => { throw new Error('x') }
  ]) {
    const withOld = await mk('beforeFinal', impl)
    const withNew = await mk('beforeTerminal', impl)
    assert.deepEqual(withOld, withNew, 'the two names must not diverge')
  }
  // And the deprecated STOP alias still compares equal.
  assert.equal(STOP.BEFORE_FINAL, STOP.BEFORE_TERMINAL)
})

test('*** V2 — beforeTerminal takes precedence when BOTH are supplied ***', async () => {
  let usedOld = false
  const out = await runReasoningLoop({
    capabilities: ['gmail'],
    beforeFinal: async () => { usedOld = true; return { type: 'allow' } },
    beforeTerminal: async () => ({ type: 'allow' }),
    callModel: async () => ({ type: 'final', result: { ok: true } }),
    executeRead: async () => ({ ok: true })
  })
  assert.equal(usedOld, false, 'the new name wins; the old is a fallback, not a second hook')
  assert.deepEqual(out.result, { ok: true })
})

/* ═══ W, X, Y — BUDGETS UNCHANGED ══════════════════════════════════════ */

// ⛔ Owner ruling 2026-08-12: the cost guarantee is 4 model calls, the READ bound is still 3.
// Asserted `steps === 3`; now asserts reads === 3 and names the reserved compose call.
test('*** W — the default read bound is still 3 ***', async () => {
  assert.equal(MAX_REASONING_STEPS, 3)
  let steps = 0
  let reads = 0
  const out = await runReasoningLoop({
    capabilities: ['gmail'],
    callModel: async ({ step }) => { steps = step; return { type: 'read', capability: 'gmail' } },
    executeRead: async () => { reads++; return { capability: 'gmail', ok: true, summary: null } }
  })
  assert.equal(reads, 3, '⛔ the READ bound moved')
  assert.equal(steps, 4, 'plus the reserved compose call')
  assert.equal(out.modelCalls, 4)
})

test('*** X — a single-world obligation from a suppressed ASK keeps 3 ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([ASK(), ASK('b'), ASK('c'), ASK('d'), ASK('e')])
    await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn }))
    assert.equal(a.calls.length, 1 + 3, 'suppressing the ASK reuses the initial-terminal position')
  })
})

test('*** Y — a mixed obligation from a suppressed ASK may use 5, and no more ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([ASK(), ASK('b'), ASK('c'), ASK('d'), ASK('e'), ASK('f'), ASK('g')])
    await run('我哋同市場比', a, DEPS(c, { finalVerifier: finalSpy('require_mixed').fn }))
    assert.equal(a.calls.length, 1 + 5)
  })
})

/* ═══ Z — NO PHRASE MATCHER ════════════════════════════════════════════ */

test('*** Z — ⛔ no keyword or phrase matcher decides any of this ***', () => {
  const files = ['finalKnowledgeRequirement.js', 'mixedKnowledgeRequirement.js', 'publicQueryEgressPlanner.js', 'reasoningLoop.js']
  // ⛔ TWO DECLARED EXCEPTIONS, EXCLUDED BY NAME — because they are what the OWNER READS, not
  // what his words are matched against. `SAFE_FALLBACK_QUESTION` is the clarification shown to
  // him and `WORLD_LABEL` names the missing world in the observation; both must use ordinary
  // business words, and 「市場」 is the right one. Excluding them by name keeps the fence sharp:
  // the ban is on CLASSIFYING his language, and a blanket token scan flagged an output string.
  const OUTPUT_CONSTANTS = /^(const SAFE_FALLBACK_QUESTION|const WORLD_LABEL|\s+(internal|public):)/
  for (const f of files) {
    const src = fs.readFileSync(path.resolve(__dirname, f), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      // ⛔ AND THE MODEL-FACING SYSTEM PROMPTS ARE EXCLUDED, on the same principle as above.
      // A gloss telling the judge what 「the outside world」 MEANS is the definition handed to
      // the judge — it is not server routing logic, and the server never matches his words
      // against it. The ban is on the SERVER deciding meaning from words; that is asserted
      // directly below, and it is the part that would actually break on a paraphrase.
      .replace(/const [A-Z_]*SYSTEM = `[\s\S]*?`/g, 'const SYSTEM = ``')
      .split('\n').filter((l) => !OUTPUT_CONSTANTS.test(l)).join('\n')
    for (const tok of ['市場', 'market', 'beef', '牛肉', 'Canada', '未能取得', 'cannot access', 'external']) {
      assert.equal(code.includes(tok), false, `⛔ «${tok}» decides routing in ${f}`)
    }
    // ⛔ AND NOTHING MATCHES THE OWNER'S WORDS. No regex or containment test is ever applied to
    // his message or to the assistant's — that is the substance of the ban, checked directly.
    assert.equal(/(message|ownerMessages|reply)\s*\.\s*(test|match|includes|search)\s*\(/.test(code), false,
      `⛔ ${f} matches against Owner or assistant text`)
  }
  // And the holdout sentence is in none of them.
  for (const f of files) {
    assert.equal(fs.readFileSync(path.resolve(__dirname, f), 'utf8').includes('加拿大牛肉批發市場價點'), false, f)
  }
})
