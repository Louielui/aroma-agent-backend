'use strict'

/**
 * clarifyAuthority.test.js — a stochastic verdict may not terminal-veto a deterministic route.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE OWNER MEASURED THIS IN PRODUCTION, 2026-08-12, bootCommit 4f8780b, real UI path.
 * One turn per fresh conversation, same sentence, same build, same route
 * (BUSINESS_QUERY / intent_inventory / routerSources ["aroma_system"]), minutes apart:
 *
 *   read and answered      19:26 · 20:14 · 20:23 · 20:23
 *   terminal ASK, 0 reads  19:28 · 20:22 · 20:22 · 20:24
 *     requestIds 068bd217, 7e0532e2, 007c2e26, 2027951c, 4333b38f
 *
 * And where the gate ran at all, `clarify` was UNANIMOUS — five of five. So the verifier was
 * not flapping between verdicts; it was consistently overruling a classification that had
 * already been made deterministically before it ever saw the turn.
 *
 * > **Owner ruling: a stochastic `clarify` verdict must not terminal-veto an already-established
 * > deterministic internal business route when the routed internal source is reachable.**
 *
 * ⛔ THIS IS AN AUTHORITY-HIERARCHY REPAIR, NOT PROMPT CALIBRATION. Nothing here tunes the
 * verifier, forces a verdict, retries it, or adds a keyword. `finalKnowledgeRequirement` is
 * documented as NOT a router; a restrained `clarify` is handed to the SAME downstream authority
 * (`ownerSourceIntentResolver` → `decideWorldAsk`) that the require_* path already uses, and
 * that authority may still decide to ask.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { MAX_REASONING_STEPS, MAX_REASONING_STEPS_CEILING } = require('./reasoningLoop')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')

const NOW = '2026-08-09T00:00:00.000Z'
const INV = 'aroma_system.invoices'

/** The sentence the Owner actually ran. Routes BUSINESS_QUERY / intent_inventory / aroma_system. */
const ESTABLISHED = '現在缺貨最嚴重的是什麼？'
/** ⛔ Genuinely open: no entity the router can positively classify. The clarification's real job. */
const CONTEXT_FREE = '最近牛肉係咪升咗？'

const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on', [A4_AMBIGUITY_FLAG]: 'on' }

async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

function twoWorldConnector () {
  const internalReads = []; const publicReads = []
  return {
    internalReads,
    publicReads,
    connector: {
      async read (source, method) {
        const pub = source === 'public_knowledge'
        ;(pub ? publicReads : internalReads).push({ method })
        const rows = [{ source, sourceId: '7', title: 'Beef Brisket', entityType: pub ? 'public_item' : 'purchase_order', content: 'x', fields: { id: '7' }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }]
        return { asOf: NOW, source, count: 1, results: rows, evidence: { source, endpoint: method, entityType: pub ? 'public_item' : 'purchase_order', rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE' } }
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
      const e = envelopes[Math.min(calls.length - 1, envelopes.length - 1)]
      return { text: JSON.stringify(e), usage: { inputTokens: 1, outputTokens: 1 } }
    }
  }
}

const FINAL = (reply) => ({ intent: 'answer', mode: 'chat', reply, nextRead: null, answerPlan: null })
const READ = (capability) => ({ intent: 'answer', mode: 'chat', reply: null, nextRead: { capability }, answerPlan: null })

const CLARIFY_Q = '你想睇我哋自己定係外面市場？'

const run = (msg, adapter, deps) => processIntake(msg, adapter, [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
})

const DEPS = (c, extra = {}) => Object.assign({
  connector: c.connector,
  sources: ['aroma_system', 'public_knowledge'],
  publicQueryPlanner: async () => ({ query: 'q', freshness: null, location: null })
}, extra)

const CLARIFY_VERIFIER = async () => ({ decision: 'clarify', question: CLARIFY_Q })

function captureForkLines (fn) {
  const captured = []
  const realLog = console.log
  console.log = (...args) => { captured.push(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')) }
  return Promise.resolve()
    .then(fn)
    .then((r) => ({ result: r, fork: captured.filter((l) => l.includes('[AROMA-ASK-FORK]')).join('\n') }))
    .finally(() => { console.log = realLog })
}

/* ═══ 1 — ESTABLISHED + REACHABLE: THE VERDICT DOES NOT END THE TURN ═════ */

test('*** ⛔ 1. ESTABLISHED INTERNAL + REACHABLE + clarify → NOT a terminal verifier ASK ***', async () => {
  await withEnv({}, async () => {
    for (const resolverIntent of ['internal', 'ambiguous']) {
      const c = twoWorldConnector()
      const a = scriptedAdapter([FINAL('我估係牛肉。'), READ(INV), FINAL('讀完再答。')])
      const out = await run(ESTABLISHED, a, DEPS(c, {
        finalVerifier: CLARIFY_VERIFIER,
        sourceIntentResolver: async () => ({ intent: resolverIntent })
      }))
      const where = ' (resolver=' + resolverIntent + ')'
      // ⛔ THE SUBJECT MUST EXIST BEFORE IT CAN BE ASSERTED ABOUT. A `!includes` over an absent
      // reply passes for the wrong reason — an empty turn is not a fixed turn.
      assert.ok(out.reply && String(out.reply).length > 0, '⛔ no reply at all' + where)
      // ⛔ THE DEFECT ITSELF: the verifier's question must not be what the Owner receives.
      assert.ok(!String(out.reply).includes(CLARIFY_Q),
        '⛔ the verifier\'s question still terminal-vetoed the route' + where + ': ' + out.reply)
      assert.notEqual(out.mode, 'ask', '⛔ the turn still ended as an ASK' + where)
      assert.ok(c.internalReads.length >= 1,
        '⛔ zero reads on an established, reachable internal route' + where)
    }
  })
})

test('*** ⛔ 1b. AND THE TRAFFIC WENT THROUGH THE SHARED AUTHORITY, not a private branch ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const seen = []
    const a = scriptedAdapter([FINAL('x'), READ(INV), FINAL('done')])
    await run(ESTABLISHED, a, DEPS(c, {
      finalVerifier: CLARIFY_VERIFIER,
      // Reaching this resolver at all IS the proof: the clarify branch used to return before it.
      sourceIntentResolver: async () => { seen.push('resolver'); return { intent: 'internal' } }
    }))
    assert.deepEqual(seen, ['resolver'],
      '⛔ a restrained clarify must be decided by the resolver + decideWorldAsk, not in place')
  })
})

/* ═══ 2 — ESTABLISHED BUT UNREACHABLE ════════════════════════════════════ */

test('*** ⛔ 2. ESTABLISHED INTERNAL + UNREACHABLE → no invented obligation, no read ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // `aroma_system` is NOT among the authorised sources this turn.
    const a = scriptedAdapter([FINAL('我估係牛肉。'), READ(INV), FINAL('唔應該去到呢步。')])
    await run(ESTABLISHED, a, DEPS(c, {
      sources: ['public_knowledge'],
      finalVerifier: CLARIFY_VERIFIER,
      sourceIntentResolver: async () => ({ intent: 'internal' })
    }))
    assert.equal(c.internalReads.length, 0, '⛔ read an unreachable source')
    // ⛔ The restraint is scoped to REACHABLE by the Owner's wording, so an unreachable route is
    // untouched by this change and behaves exactly as it did before it.
  })
})

/* ═══ 3 — PUBLIC AND MIXED SEMANTICS ARE NOT THIS RULING'S BUSINESS ══════ */

test('*** ⛔ 3. EXPLICIT public / mixed verdicts are unchanged ***', async () => {
  await withEnv({}, async () => {
    for (const decision of ['require_public', 'require_mixed', 'require_internal']) {
      const c = twoWorldConnector()
      const a = scriptedAdapter([FINAL('x'), READ(INV), FINAL('done')])
      let resolverCalls = 0
      const out = await run(ESTABLISHED, a, DEPS(c, {
        finalVerifier: async () => ({ decision, question: null }),
        sourceIntentResolver: async () => { resolverCalls++; return { intent: 'internal' } }
      }))
      // The restraint only ever inspects a `clarify` verdict; these must reach the resolver
      // exactly as they always did, and never be relabelled as restrained.
      assert.equal(resolverCalls, 1, decision + ': the resolver is still the authority')
      assert.ok(out.reply && String(out.reply).length > 0, decision + ': ⛔ no reply at all')
      assert.ok(!String(out.reply).includes(CLARIFY_Q), decision + ': no clarify question')
    }
  })
})

/* ═══ 4 — GENUINE AMBIGUITY STILL ASKS ═══════════════════════════════════ */

test('*** ⛔ 4. CONTEXT-FREE AMBIGUITY STILL CLARIFIES — the path is narrowed, not deleted ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const out = await run(CONTEXT_FREE, scriptedAdapter([FINAL('我估係升。')]), DEPS(c, {
      finalVerifier: CLARIFY_VERIFIER
    }))
    assert.equal(out.mode, 'ask', '⛔ the clarification path was deleted, not narrowed')
    assert.ok(String(out.reply).includes(CLARIFY_Q), 'and it is the verifier\'s own question')
    assert.equal(c.internalReads.length, 0)
    assert.equal(c.publicReads.length, 0)
  })
})

test('*** ⛔ 4b. AND A TURN THE ROUTER NEVER ESTABLISHED IS NOT RESTRAINED ***', async () => {
  await withEnv({}, async () => {
    // The restraint requires a POSITIVE classification. Absence of a route is not evidence.
    const c = twoWorldConnector()
    const out = await run('你好嗎？', scriptedAdapter([FINAL('幾好。')]), DEPS(c, {
      finalVerifier: CLARIFY_VERIFIER
    }))
    assert.equal(c.internalReads.length, 0, '⛔ an unclassified turn read business data')
    assert.ok(String(out.reply || '').includes(CLARIFY_Q) || out.mode === 'ask',
      'an unestablished turn keeps the verifier\'s question')
  })
})

/* ═══ 6 — THE NEW PATH IS DISTINCT IN THE TRACE ══════════════════════════ */

test('*** ⛔ 6. [AROMA-ASK-FORK] SHOWS THE RESTRAINT AS ITS OWN BRANCH ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const { fork } = await captureForkLines(() => run(ESTABLISHED,
      scriptedAdapter([FINAL('x'), READ(INV), FINAL('done')]),
      DEPS(c, { finalVerifier: CLARIFY_VERIFIER, sourceIntentResolver: async () => ({ intent: 'internal' }) })))
    assert.ok(fork.includes('"branch":"clarify_restrained_to_route"'),
      '⛔ the restraint is invisible in the log: ' + fork)
    assert.ok(fork.includes('"branch":"loop_entered"'), 'and the turn reached the reasoning loop')
    assert.ok(!fork.includes('"branch":"verdict_clarify"'),
      '⛔ a restrained turn must not also report the terminal clarify exit')
  })
})

test('*** and an UNRESTRAINED clarify still reports verdict_clarify ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const { fork } = await captureForkLines(() => run(CONTEXT_FREE,
      scriptedAdapter([FINAL('我估係升。')]), DEPS(c, { finalVerifier: CLARIFY_VERIFIER })))
    assert.ok(fork.includes('"branch":"verdict_clarify"'), '⛔ the terminal exit lost its label: ' + fork)
    assert.ok(fork.includes('"branch":"loop_skipped"'))
  })
})

/* ═══ 7 — THE BUDGET ARCHITECTURE IS UNTOUCHED ═══════════════════════════ */

test('*** ⛔ 7. THE 3-READ + RESERVED-COMPOSE ARCHITECTURE IS UNCHANGED ***', async () => {
  assert.equal(MAX_REASONING_STEPS, 3, '⛔ this ruling did not widen the read bound')
  assert.equal(MAX_REASONING_STEPS_CEILING, 5, '⛔ this ruling did not widen the ceiling')
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const { fork } = await captureForkLines(() => run(ESTABLISHED,
      scriptedAdapter([FINAL('x'), READ(INV), FINAL('done')]),
      DEPS(c, { finalVerifier: CLARIFY_VERIFIER, sourceIntentResolver: async () => ({ intent: 'internal' }) })))
    assert.ok(fork.includes('"branch":"loop_entered"'), 'the restrained turn used the ordinary loop')
    assert.ok(c.internalReads.length <= MAX_REASONING_STEPS,
      '⛔ a restrained turn read more than the bound: ' + c.internalReads.length)
  })
})
