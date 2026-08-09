'use strict'

/**
 * a4AmbiguityGate.test.js — A4-AMB1: one narrow binary gate, before any connector.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY A STRUCTURAL GATE INSTEAD OF A FIFTH PROMPT.
 *
 * Four attempts failed to make the MAIN model ask on a genuinely ambiguous question — two
 * prose calibrations, removing the commit/read contract contradiction, and giving it a real
 * second world to choose from. Measured every time: it prefers READ over ASK.
 *
 * This asks a SEPARATE call one binary question with everything else stripped away, at the
 * only moment the answer is still free: after the allowlist and write guard, before the
 * reader. It cannot answer the Owner, pick a capability, name a tool or execute anything.
 *
 * ⛔ AND IT FAILS CLOSED IN EVERY DIRECTION. Throw, timeout, malformed JSON, unknown
 * decision, absent verifier — all mean NO READ. A guard whose failure mode is 「carry on」 is
 * not a guard.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { processIntake } = require('./intakeService')
const { runReasoningLoop, MAX_REASONING_STEPS, STOP } = require('./reasoningLoop')
const {
  A4_AMBIGUITY_FLAG, resolveAmbiguityGate, worldForCapability, availableWorlds,
  validateVerifierDecision, runSourceAmbiguityGate, SAFE_FALLBACK_QUESTION, VERIFIER_SCHEMA, VERIFIER_SYSTEM
} = require('./sourceAmbiguityGate')
const { A4_FLAG, A4_SEMANTIC_GUIDANCE } = require('./a4Contract')

const NOW = '2026-08-09T00:00:00.000Z'
const INV = 'aroma_system.invoices'
const PUB = 'public_knowledge.search'
const GUIDANCE_SHA = 'cfc917cc38b8c50453d506d2b74539511826c319bd9d955aad59dbf8151e8523'

/* ═══ GENERIC LOOP-HOOK TESTS (1–9) ══════════════════════════════════════ */

const loopBase = (over = {}) => Object.assign({
  capabilities: ['gmail'],
  callModel: async ({ step }) => (step === 1 ? { type: 'read', capability: 'gmail' } : { type: 'final', result: { ok: true } }),
  executeRead: async () => ({ capability: 'gmail', ok: true, summary: null })
}, over)

test('*** 1 — no beforeRead hook: behaviour is unchanged ***', async () => {
  let reads = 0
  const out = await runReasoningLoop(loopBase({ executeRead: async () => { reads++; return { ok: true } } }))
  assert.equal(reads, 1)
  assert.equal(out.stopReason, STOP.FINAL)
})

test('*** 2 — beforeRead allow: executeRead runs exactly once ***', async () => {
  let reads = 0
  const out = await runReasoningLoop(loopBase({
    beforeRead: async () => ({ type: 'allow' }),
    executeRead: async () => { reads++; return { ok: true } }
  }))
  assert.equal(reads, 1)
  assert.equal(out.stopReason, STOP.FINAL)
})

test('*** 3 — beforeRead final: zero reads, and the loop returns that result ***', async () => {
  let reads = 0
  const out = await runReasoningLoop(loopBase({
    beforeRead: async () => ({ type: 'final', result: { mode: 'ask', reply: 'q' } }),
    executeRead: async () => { reads++; return { ok: true } }
  }))
  assert.equal(reads, 0, '⛔ the reader is never touched')
  assert.equal(out.stopReason, STOP.BEFORE_READ)
  assert.deepEqual(out.result, { mode: 'ask', reply: 'q' })
})

test('*** 4 — a hook that THROWS stops the read (fail closed) ***', async () => {
  let reads = 0
  const out = await runReasoningLoop(loopBase({
    beforeRead: async () => { throw new Error('verifier exploded') },
    executeRead: async () => { reads++; return { ok: true } }
  }))
  assert.equal(reads, 0)
  assert.equal(out.stopReason, STOP.BEFORE_READ)
})

test('*** 5 — a hook returning nonsense stops the read (fail closed) ***', async () => {
  for (const bad of [{ type: 'proceed' }, 'allow', 42, { result: {} }]) {
    let reads = 0
    const out = await runReasoningLoop(loopBase({
      beforeRead: async () => bad,
      executeRead: async () => { reads++; return { ok: true } }
    }))
    assert.equal(reads, 0, 'unrecognised instruction must not read: ' + JSON.stringify(bad))
    assert.equal(out.stopReason, STOP.BEFORE_READ)
  }
})

test('*** 6 — the allowlist is checked BEFORE the hook ***', async () => {
  let hookCalls = 0
  await runReasoningLoop(loopBase({
    capabilities: ['gmail'],
    callModel: async ({ step }) => (step === 1 ? { type: 'read', capability: 'invented' } : { type: 'final', result: null }),
    beforeRead: async () => { hookCalls++; return { type: 'allow' } }
  }))
  assert.equal(hookCalls, 0, 'a capability that was never permitted is refused without consulting anything')
})

test('*** 7 — WRITE_SHAPED is checked BEFORE the hook ***', async () => {
  let hookCalls = 0
  await runReasoningLoop(loopBase({
    capabilities: ['send_invoice'],
    callModel: async ({ step }) => (step === 1 ? { type: 'read', capability: 'send_invoice' } : { type: 'final', result: null }),
    beforeRead: async () => { hookCalls++; return { type: 'allow' } }
  }))
  assert.equal(hookCalls, 0)
})

test('*** 8 — the step bound is unchanged ***', () => {
  assert.equal(MAX_REASONING_STEPS, 3)
})

test('*** 9 — reasoningLoop remains domain- and provider-neutral ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'reasoningLoop.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  for (const t of ['aroma', 'public_knowledge', 'ambigu', 'world', 'openai', 'claude', 'gpt']) {
    assert.equal(new RegExp(t, 'i').test(src), false, '⛔ the loop must not learn about ' + t)
  }
})

/* ═══ THE GATE MODULE ITSELF ═════════════════════════════════════════════ */

test('*** the flag fails closed on anything but exactly "on" ***', () => {
  for (const v of [undefined, '', ' ', 'ON', 'true', '1', 'yes', 'off']) {
    const env = v === undefined ? {} : { [A4_AMBIGUITY_FLAG]: v }
    assert.equal(resolveAmbiguityGate(env), 'off', JSON.stringify(v))
  }
  assert.equal(resolveAmbiguityGate({ [A4_AMBIGUITY_FLAG]: 'on' }), 'on')
})

test('*** the world vocabulary is exactly two words ***', () => {
  assert.equal(worldForCapability(PUB), 'public')
  assert.equal(worldForCapability('public_knowledge.search@abc123'), 'public', 'instances too')
  for (const c of [INV, 'gmail', 'drive', 'calendar', 'github', 'development_record']) {
    assert.equal(worldForCapability(c), 'internal', c)
  }
  assert.deepEqual(availableWorlds([INV, 'gmail']), ['internal'])
  assert.deepEqual(availableWorlds([INV, PUB]), ['internal', 'public'])
})

test('*** the verifier output contract is closed and carries no reasoning field ***', () => {
  assert.deepEqual(Object.keys(VERIFIER_SCHEMA.properties).sort(), ['decision', 'question'])
  assert.deepEqual(VERIFIER_SCHEMA.required.sort(), ['decision', 'question'])
  assert.equal(VERIFIER_SCHEMA.additionalProperties, false)
  for (const banned of ['reason', 'rationale', 'analysis', 'thought', 'thinking', 'confidence', 'capability', 'tool', 'provider', 'source']) {
    assert.equal(VERIFIER_SCHEMA.properties[banned], undefined, '⛔ ' + banned + ' must not exist')
  }
})

test('*** validation admits only the closed shape, and allow forces question null ***', () => {
  assert.deepEqual(validateVerifierDecision({ decision: 'allow', question: 'x' }), { decision: 'allow', question: null })
  assert.deepEqual(validateVerifierDecision('{"decision":"ask","question":"你想睇邊邊？"}'), { decision: 'ask', question: '你想睇邊邊？' })
  for (const bad of [null, undefined, '', 'not json', { decision: 'maybe' }, { question: 'x' }, 42, []]) {
    assert.equal(validateVerifierDecision(bad), null, 'unusable ⇒ null ⇒ fail closed: ' + JSON.stringify(bad))
  }
})

test('*** S — an ASK question carrying implementation vocabulary is replaced ***', () => {
  for (const leaky of ['要用 public_knowledge 定 aroma_system？', '你想我用邊個 connector？', 'nextRead 揀邊個？', 'x'.repeat(200)]) {
    const out = validateVerifierDecision({ decision: 'ask', question: leaky })
    assert.equal(out.question, SAFE_FALLBACK_QUESTION, '⛔ the Owner is never shown implementation vocabulary')
  }
  assert.equal(/public_knowledge|aroma_system|connector|schema/.test(SAFE_FALLBACK_QUESTION), false)
  assert.equal(/牛肉|市場行情|發票/.test(SAFE_FALLBACK_QUESTION), false, 'and the fallback asserts no domain noun')
})

test('*** R — no injected verifier while enabled ⇒ ASK, never a silent skip ***', async () => {
  const out = await runSourceAmbiguityGate({ verify: null, message: 'x', proposedWorld: 'internal', availableWorlds: ['internal', 'public'] })
  assert.equal(out.decision, 'ask')
  assert.equal(out.outcome, 'unavailable')
  assert.equal(out.question, SAFE_FALLBACK_QUESTION)
})

test('*** P / Q — malformed and throwing verifiers both fail closed ***', async () => {
  for (const verify of [async () => 'garbage', async () => ({ decision: 'perhaps' }), async () => { throw new Error('boom') }]) {
    const out = await runSourceAmbiguityGate({ verify, message: 'x', proposedWorld: 'internal', availableWorlds: ['internal', 'public'] })
    assert.equal(out.decision, 'ask')
    assert.equal(out.outcome, 'unavailable')
  }
})

test('*** the verifier receives MEANING only — never a capability or evidence ***', async () => {
  let seen = null
  await runSourceAmbiguityGate({
    verify: async (input) => { seen = input; return { decision: 'allow', question: null } },
    message: '我哋最近點', history: [{ role: 'user', text: 'x' }], proposedWorld: 'internal', availableWorlds: ['internal', 'public']
  })
  assert.deepEqual(Object.keys(seen).sort(), ['availableWorlds', 'history', 'message', 'proposedWorld', 'schema', 'system'])
  for (const banned of ['capability', 'operation', 'evidence', 'turnItems', 'evidenceSets', 'connector', 'credentials']) {
    assert.equal(seen[banned], undefined, '⛔ ' + banned + ' must never reach the verifier')
  }
  assert.equal(/牛肉|Gordon|加拿大|批發/.test(VERIFIER_SYSTEM), false, '⛔ canary sentences are holdout data')
})

/* ═══ END-TO-END, DETERMINISTIC (A–Y) ════════════════════════════════════ */

function twoWorldConnector () {
  const internalReads = []; const publicReads = []
  return {
    internalReads,
    publicReads,
    connector: {
      async read (source, method) {
        const rows = [{ source, sourceId: source === 'public_knowledge' ? 'PUB-1' : '7', title: source === 'public_knowledge' ? 'Index' : 'Brisket', entityType: source === 'public_knowledge' ? 'public_item' : 'purchase_order', content: 'x=1', fields: { id: '1', x: '1' }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }]
        ;(source === 'public_knowledge' ? publicReads : internalReads).push({ method })
        return {
          asOf: NOW, source, count: 1, results: rows,
          evidence: { source, endpoint: method, entityType: rows[0].entityType, rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'fake' }
        }
      }
    }
  }
}

function scriptedAdapter (envelopes) {
  const calls = []
  return {
    calls,
    async complete (prompt, opts = {}) {
      calls.push({ schemaName: opts.responseFormat ? opts.responseFormat.name : null })
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error('called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'spy', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ = (capability, args) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: args === undefined ? { capability } : { capability, args }, answerPlan: null })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })
const ASKED = (reply) => ({ intent: 'unclear', mode: 'ask', reply, nextRead: null, answerPlan: null })

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
// MIGRATED (SIR2): the Owner Source Intent Resolver is now the ONE source-world authority and
// the old ambiguity gate is no longer consulted at runtime. Each fixture states the ground truth
// for its OWN message — the same thing the benchmark corpus does. A stub for a model, never a
// classifier in production.
const SIR = (intent) => async () => ({ intent })
/** Recording variant, for the tests that assert WHAT the authority was handed. */
const sirSpy = (intent) => { const calls = []; return { calls, fn: async (i) => { calls.push(i); return { intent } } } }

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


function verifierSpy (decision, question) {
  const calls = []
  return {
    calls,
    fn: async (input) => { calls.push(input); return { decision, question: question || null } }
  }
}

const run = (msg, adapter, deps, history, mode) => processIntake(msg, adapter, history || [], {
  demo: true, interactionMode: mode || 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
})

test('*** A / B / C — the gate is silent unless BOTH flags and the chat lane agree ***', async () => {
  for (const [label, env, mode] of [
    ['ambiguity flag off', { [A4_AMBIGUITY_FLAG]: null }, 'chat'],
    ['A4 off', { [A4_FLAG]: null }, 'chat'],
    ['non-chat lane', {}, 'proposal']
  ]) {
    await withEnv(env, async () => {
      const c = twoWorldConnector(); const v = verifierSpy('ask', 'should not be asked')
      const a = scriptedAdapter([READ(INV), FINAL('ok')])
      await run('最近點', a, { connector: c.connector, sources: BOTH, ambiguityVerifier: v.fn, sourceIntentResolver: SIR('ambiguous') }, [], mode)
      assert.equal(v.calls.length, 0, label + ': the verifier must not be called')
    })
  }
})

test('*** D — only ONE world available ⇒ no verifier call, no cost ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector(); const v = verifierSpy('ask', 'x')
    const a = scriptedAdapter([READ(INV), FINAL('ok')])
    await run('最近點', a, { connector: c.connector, sources: ['aroma_system'], ambiguityVerifier: v.fn, sourceIntentResolver: SIR('ambiguous') })
    assert.equal(v.calls.length, 0, 'nothing to be ambiguous between')
    assert.equal(c.internalReads.length, 1, 'and the read proceeds normally')
  })
})

test('*** E / F — a main model that FINALs or ASKs never reaches the gate ***', async () => {
  for (const env of [FINAL('答你。'), ASKED('你想點？')]) {
    await withEnv({}, async () => {
      const c = twoWorldConnector(); const v = verifierSpy('allow')
      const a = scriptedAdapter([env])
      await run('最近點', a, { connector: c.connector, sources: BOTH, ambiguityVerifier: v.fn, sourceIntentResolver: SIR('ambiguous') })
      assert.equal(v.calls.length, 0, 'the gate guards READS, nothing else')
    })
  }
})

test('*** G — ⛔ verifier ASK: zero reads, zero evidence, and it is not a read failure ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // MIGRATED (SIR2): the ASK guarantee is unchanged; the authority that produces it is now
    // the source-intent resolver, and the old gate is no longer consulted at runtime.
    const v = sirSpy('ambiguous')
    const a = scriptedAdapter([READ(INV)])
    const out = await run('幫我查下最近點', a, { connector: c.connector, sources: BOTH, sourceIntentResolver: v.fn })

    assert.equal(v.calls.length, 1)
    assert.equal(c.internalReads.length, 0, '⛔ the internal connector was never touched')
    assert.equal(c.publicReads.length, 0, '⛔ nor the public executor')
    assert.equal(a.calls.length, 1, 'and no second model call was spent')
    // ⛔ THE EXISTING 'ask' MODE, NOT A NEW RESPONSE TYPE. No mode='ambiguity'/'verify'/'gate'
    // was invented — the gate reuses the Distill envelope the chat lane already understands.
    assert.equal(out.mode, 'ask', 'it surfaces through the existing READ / ASK / FINAL contract')
    // , not equality: the pre-existing traditional-Chinese guard appends a note to
    // replies. That guard is out of scope here and its noisiness is already on record.
    // The wording is now the resolver's own clarification — a MEANING question, naming no
    // system, tool or source. Asserted through the module's exported constant so a future
    // rewording cannot silently change what he is asked.
    assert.ok(String(out.reply).includes(require('./ownerSourceIntentResolver').CLARIFY_QUESTION), 'the Owner gets the meaning question')
    // ⛔ AMBIGUITY IS NOT UNAVAILABILITY. No read was attempted, so no trust state exists.
    assert.equal(/讀唔到|目前讀不到|UNAVAILABLE/.test(String(out.reply)), false)
  })
})

test('*** H / I — verifier ALLOW lets the proposed world execute ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector(); const v = verifierSpy('allow')
    const a = scriptedAdapter([READ(INV), FINAL('內部讀咗。')])
    await run('我哋最近點', a, { connector: c.connector, sources: BOTH, ambiguityVerifier: v.fn, sourceIntentResolver: SIR('internal') })
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 0)
  })
  await withEnv({}, async () => {
    const c = twoWorldConnector(); const v = verifierSpy('allow')
    const a = scriptedAdapter([READ(PUB, { query: 'market index', freshness: 'current', location: null }), FINAL('公開讀咗。')])
    await run('市場最近點', a, { connector: c.connector, sources: BOTH, ambiguityVerifier: v.fn, sourceIntentResolver: SIR('public') })
    assert.equal(c.publicReads.length, 1, 'the gate allowed, then the egress guard passed, then the executor ran')
    assert.equal(c.internalReads.length, 0)
  })
})

test('*** J — egress still blocks AFTER the ambiguity gate allows ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // read internal first so its values are in the turn, then try to send one outward.
    // MIGRATED (SIR3): the world authority is the resolver; the egress guard is INDEPENDENT of
    // it, which is the whole point — a settled world is not permission to send anything.
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'market for Brisket', freshness: 'current', location: null }), FINAL('公開嗰邊冇查到。'), FINAL('仍然冇。')])
    await run('我哋同市場比', a, { connector: c.connector, sources: BOTH, sourceIntentResolver: SIR('mixed') })
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 0, '⛔ ambiguity ALLOW is not egress ALLOW — the guards are independent')
  })
})

test('*** K — the verifier is called at most ONCE per turn ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector(); const v = sirSpy('mixed')
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'market', freshness: null, location: null }), FINAL('兩邊都睇咗。')])
    // MIGRATED — Owner-only public query provenance. Public-after-internal now re-authors the
    // query from Owner context, so a planner is a REQUIRED dependency of this path; without one
    // it fails closed and no public read happens. This test is about the AMBIGUITY gate's call
    // count, so the planner is supplied as fixture plumbing. See a4EgressProvenance.test.js.
    await run('我哋同市場比', a, { connector: c.connector, sources: BOTH, sourceIntentResolver: v.fn, publicQueryPlanner: SAFE_PLANNER })
    assert.equal(v.calls.length, 1, '⛔ one paid call per turn — the meaning is settled once')
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 1)
  })
})

test('*** L / O — an explicit mixed need is ALLOWED, and both reads proceed ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector(); const v = sirSpy('mixed')
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'market', freshness: null, location: null }), FINAL('比較完。')])
    const out = await run('我哋成本同市場比正常嗎', a, { connector: c.connector, sources: BOTH, sourceIntentResolver: v.fn, publicQueryPlanner: SAFE_PLANNER })
    // ⛔ INVERTED ON PURPOSE. The old gate was told which worlds existed; the resolver is NOT —
    // availability must not decide meaning. It sees his words and nothing else.
    assert.equal(v.calls[0].availableWorlds, undefined, 'availability may not bias meaning')
    assert.deepEqual(Object.keys(v.calls[0]).sort(), ['ownerMessages', 'schema', 'system'])
    assert.equal(String(out.reply).includes('你想睇'), false, 'mixed is not ambiguity — it does not re-ask')
  })
})

test('*** M / N — the verifier sees the bounded history for a continuation ***', async () => {
  const AFTER = [
    { role: 'user', text: '幫我查下最近點' },
    { role: 'assistant', text: '你想睇我哋自己嘅數，定係出面市場？' }
  ]
  await withEnv({}, async () => {
    const c = twoWorldConnector(); const v = sirSpy('internal')
    const a = scriptedAdapter([READ(INV), FINAL('我哋嗰邊。')])
    await run('我哋供應商。', a, { connector: c.connector, sources: BOTH, sourceIntentResolver: v.fn }, AFTER)
    // ⛔ OWNER-ONLY, AND THAT IS THE POINT: his prior line carries forward, her question does not.
    assert.deepEqual(v.calls[0].ownerMessages, ['幫我查下最近點', '我哋供應商。'])
    assert.equal(c.internalReads.length, 1)
  })
})

test('*** P / Q / R end-to-end — a broken verifier reads NOTHING ***', async () => {
  for (const verifier of [
    async () => { throw new Error('boom') },
    async () => ({ decision: 'nonsense' }),
    null
  ]) {
    await withEnv({}, async () => {
      const c = twoWorldConnector()
      const a = scriptedAdapter([READ(INV)])
      const out = await run('幫我查下最近點', a, { connector: c.connector, sources: BOTH, ambiguityVerifier: verifier })
      assert.equal(c.internalReads.length, 0, '⛔ fail closed: no read')
      assert.equal(c.publicReads.length, 0)
      assert.ok(String(out.reply).length > 0, 'and the Owner still gets a usable clarification')
    })
  }
})

test('*** T — the gate telemetry is content-free ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const lines = []
    const orig = console.log
    console.log = (...a) => { if (a[0] === '[AROMA-SOURCE-INTENT]') { try { lines.push(JSON.parse(a[1])) } catch (_) {} } }
    try {
      const a = scriptedAdapter([READ(INV), FINAL('ok')])
      await run('幫我查下 Gordon 最近牛肉價', a, { connector: c.connector, sources: BOTH, sourceIntentResolver: SIR('internal') })
    } finally { console.log = orig }
    assert.equal(lines.length, 1, 'exactly one line')
    assert.deepEqual(Object.keys(lines[0]).sort(),
      ['durationMs', 'event', 'outcome', 'ownerMessageCount', 'requestId', 'timestamp'])
    const blob = JSON.stringify(lines[0])
    for (const leak of ['Gordon', '牛肉', '你想睇', '幫我查']) {
      assert.equal(blob.includes(leak), false, '⛔ ' + leak + ' must never reach telemetry')
    }
    assert.equal(lines[0].outcome, 'internal')
  })
})

/* ═══ V / W / X / Y — NOTHING ELSE MOVED ═════════════════════════════════ */

test('*** V — the semantic guidance is byte-identical (no fifth calibration) ***', () => {
  assert.equal(crypto.createHash('sha256').update(A4_SEMANTIC_GUIDANCE, 'utf8').digest('hex'), GUIDANCE_SHA)
  assert.equal(A4_SEMANTIC_GUIDANCE.length, 843)
})

test('*** Y — the OLD gate flag no longer governs anything ***', async () => {
  // MIGRATED (SIR3). This asserted that A4_SOURCE_AMBIGUITY=off restored pre-gate behaviour.
  // That flag governed a gate that is no longer consulted at runtime, and meaning must be
  // settled wherever a read can happen — so the resolver runs regardless of it, and the old
  // verifier is never called whatever the flag says.
  await withEnv({ [A4_AMBIGUITY_FLAG]: null }, async () => {
    const c = twoWorldConnector(); const v = verifierSpy('ask', 'x')
    const a = scriptedAdapter([READ(INV), FINAL('ok')])
    await run('幫我查下最近點', a, { connector: c.connector, sources: BOTH, ambiguityVerifier: v.fn, sourceIntentResolver: SIR('internal') })
    assert.equal(v.calls.length, 0, 'the old verifier is dead whatever the flag says')
    assert.equal(c.internalReads.length, 1, 'and the resolver still governs the world')
  })
})
