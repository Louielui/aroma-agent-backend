'use strict'

/**
 * a4FinalObligation.test.js — A4-FINAL1: an answer nobody checked is not an answer.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE FAILURE. Three live turns failed identically: asked for outside-world information,
 * the main model at LOW proposed NO read and replied that it could not obtain external data —
 * while `public_knowledge.search` sat in the authorised enum it had just been handed. The
 * capability was verified present. It declined, then reported the decline as an inability.
 *
 * Every guard before this one hangs off the model PROPOSING a read. A model that proposes
 * nothing sails past all of them — worst of all on 「兩邊都睇。」, where no read was proposed
 * and the entire MIX1 chain never engaged.
 *
 * ⛔ AND THE SECOND HALF OF THE DEFECT, WHICH THESE TESTS ALSO PIN: a refused observation
 * reached the LOOP but never the MODEL. Only successful read blocks are added to the prompt,
 * so `required_world_missing` was invisible to the very model expected to act on it. A guard
 * the model cannot see cannot be honoured — and calling that 「the model refuses to recover」
 * would have blamed it for something it was never shown.
 *
 * ⛔ NO TEXT DETECTOR ANYWHERE. Nothing here — and nothing in production — looks for
 * 「cannot access」 or any other phrase. Acceptance is structural: if a world is required, the
 * turn may not FINAL until that world has live evidence.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { processIntake } = require('./intakeService')
const { runReasoningLoop, MAX_REASONING_STEPS, MAX_REASONING_STEPS_CEILING, STOP } = require('./reasoningLoop')
const {
  FINAL_SCHEMA, FINAL_SYSTEM, DECISION, WORLDS_FOR, OUTCOME, SAFE_FALLBACK_QUESTION,
  validateFinalDecision, runFinalKnowledgeRequirement, createTurnFinalCache,
  renderRequiredWorldObservation, logFinalRequirement
} = require('./finalKnowledgeRequirement')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')

const NOW = '2026-08-09T00:00:00.000Z'
const PUB = 'public_knowledge.search'
const INV = 'aroma_system.invoices'
const SECRET = 'AROMA_INTERNAL_ONLY_9842'
const SUPPLIER = 'Gordon'
const TITLE = 'Beef Brisket'
const BOTH_W = { internal: true, public: true }

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

const finalSpy = (decision, question) => {
  const calls = []
  const fn = async (i) => { calls.push(i); return { decision, question: decision === 'clarify' ? (question || '你想睇邊邊？') : null } }
  fn.decision = decision // read by DEPS to derive the fixture's source intent
  return { calls, fn }
}
const ambiSpy = (decision) => { const calls = []; return { calls, fn: async (i) => { calls.push(i); return { decision, question: decision === 'ask' ? '含糊問題' : null } } } }
const mixedSpy = (decision) => { const calls = []; return { calls, fn: async (i) => { calls.push(i); return { decision } } } }
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
const AW = { internal: true, public: true }

/* ═══ A–H — THE VERIFIER'S CLASSIFICATION ═══════════════════════════════ */

const CLASSES = [
  ['A supplied facts   ', DECISION.ALLOW, null],
  ['B stable knowledge ', DECISION.ALLOW, null],
  ['C clear internal   ', DECISION.INTERNAL, { internal: true, public: false }],
  ['D clear public     ', DECISION.PUBLIC, { internal: false, public: true }],
  ['E explicit mixed   ', DECISION.MIXED, BOTH_W]
]
for (const [label, decision, worlds] of CLASSES) {
  test(`*** ${label.trim()} → ${decision} ***`, async () => {
    const r = await runFinalKnowledgeRequirement({ verify: async () => ({ decision, question: null }), message: 'x', history: [], availableWorlds: AW })
    assert.equal(r.ok, true)
    assert.equal(r.decision, decision)
    assert.deepEqual(r.requiredWorlds, worlds)
    assert.equal(r.question, null, 'only clarify carries a question')
  })
}

test('*** F — ambiguous → clarify, with a MEANING question and zero obligation ***', async () => {
  const r = await runFinalKnowledgeRequirement({ verify: async () => ({ decision: 'clarify', question: '你想睇我哋自己定係出面？' }), message: 'x', history: [], availableWorlds: AW })
  assert.equal(r.decision, DECISION.CLARIFY)
  assert.equal(r.requiredWorlds, null, 'clarify reads nothing and owes nothing')
  assert.equal(r.question, '你想睇我哋自己定係出面？')
})

test('*** F2 — a clarify question carrying implementation vocabulary is replaced ***', async () => {
  for (const bad of ['用 public_knowledge.search 定 aroma_system？', '', '   ', 'x'.repeat(300)]) {
    const r = await runFinalKnowledgeRequirement({ verify: async () => ({ decision: 'clarify', question: bad }), message: 'x', history: [], availableWorlds: AW })
    assert.equal(r.question, SAFE_FALLBACK_QUESTION, JSON.stringify(bad.slice(0, 20)))
  }
})

test('*** G/H — continuation carries prior OWNER messages, oldest first ***', async () => {
  const seen = []
  await runFinalKnowledgeRequirement({
    verify: async (i) => { seen.push(i); return { decision: 'require_public', question: null } },
    message: '市場。',
    history: [{ role: 'user', text: '最近牛肉係咪升咗？' }, { role: 'assistant', text: '你想睇邊邊？' }],
    availableWorlds: AW
  })
  assert.deepEqual(seen[0].ownerMessages, ['最近牛肉係咪升咗？', '市場。'])
})

/* ═══ I, J — INPUT PRIVACY ══════════════════════════════════════════════ */

test('*** I/J — ⛔ assistant turns and unknown roles never reach the verifier ***', async () => {
  const seen = []
  await runFinalKnowledgeRequirement({
    verify: async (i) => { seen.push(i); return { decision: 'allow_final', question: null } },
    message: '得啦',
    history: [
      { role: 'assistant', text: `我哋同 ${SUPPLIER} 買 ${TITLE}` },
      { text: 'NO_ROLE' }, { role: 'weird', text: 'ODD' }, { role: 'system', text: 'SYS' }
    ],
    availableWorlds: AW
  })
  assert.deepEqual(seen[0].ownerMessages, ['得啦'])
  const handed = JSON.stringify(seen[0])
  for (const v of [SUPPLIER, TITLE, 'NO_ROLE', 'ODD', 'SYS']) assert.equal(handed.includes(v), false, `⛔ ${v} reached the verifier`)
  // And the ONLY other input is two booleans.
  assert.deepEqual(Object.keys(seen[0]).sort(), ['availableWorlds', 'ownerMessages', 'schema', 'system'])
  assert.deepEqual(seen[0].availableWorlds, { internal: true, public: true })
})

test('*** the verifier never receives the FINAL text the model wrote ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const f = finalSpy('allow_final')
    const a = scriptedAdapter([FINAL('SENTINEL_MODEL_ANSWER_TEXT')])
    await run('8.00 升到 8.72 係幾多 %', a, DEPS(c, { finalVerifier: f.fn }))
    assert.equal(f.calls.length, 1)
    assert.equal(JSON.stringify(f.calls[0]).includes('SENTINEL_MODEL_ANSWER_TEXT'), false,
      '⛔ the rejected answer must not be an input to the gate that judges it')
  })
})

/* ═══ K — ONCE PER TURN ═════════════════════════════════════════════════ */

test('*** K — the verifier runs at most once per turn ***', async () => {
  const cache = createTurnFinalCache()
  let calls = 0
  const verify = async () => { calls++; return { decision: 'require_public', question: null } }
  const a = await cache.get({ verify, message: 'x', history: [], availableWorlds: AW })
  const b = await cache.get({ verify, message: 'x', history: [], availableWorlds: AW })
  assert.equal(calls, 1)
  assert.deepEqual(a, b)
})

test('*** K2 — end to end, one turn spends exactly one final-verifier call ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const f = finalSpy('require_public')
    const a = scriptedAdapter([FINAL('唔使查。'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('查咗。')])
    await run('市場價點', a, DEPS(c, { finalVerifier: f.fn }))
    assert.equal(f.calls.length, 1)
  })
})

/* ═══ L, M — FAIL CLOSED ════════════════════════════════════════════════ */

test('*** L/M — ⛔ every unusable verifier result WITHHOLDS the final ***', async () => {
  for (const [label, verify] of [
    ['missing', null],
    ['throws', async () => { throw new Error('boom') }],
    ['malformed', async () => ({ verdict: 'allow_final' })],
    ['unknown decision', async () => ({ decision: 'sure', question: null })],
    ['not json', async () => 'allow it'],
    ['null', async () => null],
    ['array', async () => []]
  ]) {
    const r = await runFinalKnowledgeRequirement({ verify, message: 'x', history: [], availableWorlds: AW })
    assert.equal(r.ok, false, label)
    assert.equal(r.outcome, OUTCOME.UNAVAILABLE, label)
  }
})

test('*** L2 — end to end, an unusable verdict does not publish the model answer ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([FINAL('SENTINEL_UNVERIFIED_ANSWER')])
    const out = await run('市場價點', a, DEPS(c, { finalVerifier: async () => { throw new Error('down') } }))
    assert.equal(String(out.reply || '').includes('SENTINEL_UNVERIFIED_ANSWER'), false,
      '⛔ an unverified answer reached the Owner')
    assert.equal(c.internalReads.length, 0, 'and no connector ran')
    assert.equal(c.publicReads.length, 0)
  })
})

test('*** a non-clarify decision may not smuggle a question ***', () => {
  const r = validateFinalDecision({ decision: 'require_public', question: '你想點？' })
  assert.deepEqual(r, { decision: 'require_public', question: null }, 'the obligation survives, the question is dropped')
})

/* ═══ N, O, P, Q — SINGLE-WORLD RECOVERY ════════════════════════════════ */

test('*** N — ⛔ CLEAR PUBLIC: the initial FINAL is refused ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([FINAL('我攞唔到出面資料。'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('市場睇咗。')])
    const out = await run('加拿大牛肉批發市場價點？', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn }))
    assert.equal(a.calls.length, 3, 'the first answer was refused and the model was called again')
    assert.equal(c.publicReads.length, 1, '⛔ the required world was never read')
    assert.equal(out.reply, '市場睇咗。', 'the Owner gets the COMPLETE answer, not the refusal')
  })
})

test('*** N2 — ⛔ the refusal is VISIBLE TO THE MODEL, not only to the loop ***', async () => {
  // The half of the defect that made everything else untestable: the observation reached the
  // loop and never the prompt, so the model was blamed for ignoring something it never saw.
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([FINAL('x'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('done')])
    await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn }))
    const recovery = a.calls[1]
    assert.ok(recovery.includes('本回合仲未齊料'), '⛔ the obligation never reached the prompt')
    assert.ok(recovery.includes('出面公開世界嘅資料'), 'and it names the missing WORLD')
    // ⛔ AND IT NAMES NO TOOL. The model still chooses.
    assert.equal(recovery.includes('public_knowledge.search') && recovery.indexOf('public_knowledge.search') > recovery.indexOf('本回合仲未齊料') &&
      recovery.slice(recovery.indexOf('本回合仲未齊料'), recovery.indexOf('本回合仲未齊料') + 200).includes('public_knowledge.search'), false,
    '⛔ the observation block named a capability')
  })
})

test('*** O/Q — a live read in the required world releases the FINAL ***', async () => {
  for (const [label, decision, cap] of [['public', 'require_public', PUB], ['internal', 'require_internal', INV]]) {
    await withEnv({}, async () => {
      const c = twoWorldConnector()
      const a = scriptedAdapter([FINAL('未查。'), READ(cap, cap === PUB ? { query: 'q', freshness: null, location: null } : undefined), FINAL('齊料。')])
      const out = await run('問題', a, DEPS(c, { finalVerifier: finalSpy(decision).fn }))
      assert.equal(out.reply, '齊料。', label)
    })
  }
})

test('*** P — ⛔ an UNAVAILABLE read does not satisfy the required world ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector({ publicFails: true })
    // 1 distill + 3 loop decisions; the last is scripted so the bound, not the script, ends it.
    const a = scriptedAdapter([FINAL('未查。'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('試過唔得。'), FINAL('再試都唔得。')])
    const out = await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn }))
    assert.equal(c.publicReads.length, 1, 'it was attempted')
    // The bound is 3 for a single-world obligation, so the turn ends at the step limit rather
    // than looping forever, and the deterministic renderer speaks from what was read.
    assert.equal(a.calls.length, 1 + 3)
    assert.equal(String(out.reply || '').includes('試過唔得。'), false,
      '⛔ an answer was released although the required world never produced evidence')
  })
})

/* ═══ R, S, T — MIXED FROM AN INITIAL FINAL ═════════════════════════════ */

test('*** R/S/T — require_mixed: refused until BOTH worlds are live ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([
      FINAL('唔使查。'), // 1 refused: both missing
      READ(INV), // 2
      FINAL('得內部。'), // 3 refused: public missing
      READ(PUB, { query: 'q', freshness: null, location: null }), // 4
      FINAL('兩邊都齊。') // 5
    ])
    const out = await run('我哋成本同市場比', a, DEPS(c, { finalVerifier: finalSpy('require_mixed').fn }))
    assert.equal(c.internalReads.length, 1)
    assert.equal(c.publicReads.length, 1)
    assert.equal(a.calls.length, 5, 'the full bounded recovery path was used')
    assert.equal(out.reply, '兩邊都齊。')
  })
})

test('*** S2 — one world alone never releases a mixed obligation ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([FINAL('a'), READ(INV), FINAL('得內部。'), FINAL('仍然得內部。'), FINAL('三次都係。'), FINAL('四次。')])
    const out = await run('我哋成本同市場比', a, DEPS(c, { finalVerifier: finalSpy('require_mixed').fn }))
    assert.equal(c.publicReads.length, 0)
    assert.equal(String(out.reply || '').includes('得內部'), false, '⛔ a half answer was released')
  })
})

/* ═══ U, V, W, X — STEP BUDGETS ═════════════════════════════════════════ */

test('*** U — ⛔ the DEFAULT bound is still 3, and the ceiling is explicit ***', async () => {
  assert.equal(MAX_REASONING_STEPS, 3)
  assert.equal(MAX_REASONING_STEPS_CEILING, 5)
  let steps = 0
  const out = await runReasoningLoop({
    capabilities: ['gmail'],
    callModel: async ({ step }) => { steps = step; return { type: 'read', capability: 'gmail' } },
    executeRead: async () => ({ capability: 'gmail', ok: true, summary: null })
  })
  assert.equal(steps, 3)
  assert.equal(out.steps, 3)
  assert.equal(out.stopReason, STOP.STEP_LIMIT)
})

test('*** U2 — an ordinary A4 turn with no obligation still gets 3 ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([FINAL('答完。')])
    const out = await run('8.00 升到 8.72 係幾多 %', a, DEPS(c, { finalVerifier: finalSpy('allow_final').fn }))
    assert.equal(a.calls.length, 1, 'allow_final does not enter the loop at all')
    assert.equal(out.reply, '答完。')
    assert.equal(c.internalReads.length, 0)
    assert.equal(c.publicReads.length, 0)
  })
})

test('*** V — a SINGLE-world obligation keeps the bound at 3 ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // Four envelopes scripted; only three may be consumed.
    const a = scriptedAdapter([FINAL('a'), FINAL('b'), FINAL('c'), FINAL('d'), FINAL('e')])
    await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn }))
    // 1 initial distill + 3 loop decisions. The distill call is the one whose answer was
    // refused, so it is part of the turn's cost and is counted here deliberately.
    assert.equal(a.calls.length, 1 + 3, 'a single-world obligation must not buy extra decisions')
  })
})

test('*** W — a MIXED obligation from an initial FINAL may use 5, and no more ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const a = scriptedAdapter([FINAL('a'), FINAL('b'), FINAL('c'), FINAL('d'), FINAL('e'), FINAL('f'), FINAL('g')])
    await run('我哋成本同市場比', a, DEPS(c, { finalVerifier: finalSpy('require_mixed').fn }))
    assert.equal(a.calls.length, 1 + 5, 'exactly five loop decisions after the refused one, never six')
  })
})

test('*** X — MIX1 first-READ turns keep their existing max-4 behaviour ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    // A turn that PROPOSES a read never reaches the final gate; the mixed verifier owns it.
    const f = finalSpy('require_mixed')
    const a = scriptedAdapter([READ(INV), FINAL('b'), FINAL('c'), FINAL('d'), FINAL('e')])
    await run('我哋成本同市場比', a, DEPS(c, { finalVerifier: f.fn, mixedVerifier: mixedSpy('mixed').fn, ambiguityVerifier: ambiSpy('allow').fn }))
    assert.equal(f.calls.length, 0, '⛔ the final gate must not run when a read was proposed')
    assert.equal(a.calls.length, 4, 'MIX1 keeps 4')
  })
})

/* ═══ CLARIFY, AND THE AMBIGUITY PRODUCT RULE ═══════════════════════════ */

test('*** clarify returns mode=ask with zero reads and no tool talk ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const out = await run('最近牛肉係咪升咗？', scriptedAdapter([FINAL('我估係升。')]), DEPS(c, { finalVerifier: finalSpy('clarify', '你想睇我哋自己定係外面市場？').fn }))
    assert.equal(out.mode, 'ask')
    // , not equality: the traditional-Chinese guard appends its own notice to the
    // reply. That is pre-existing behaviour on every lane and not this gate's business.
    assert.ok(String(out.reply).includes('你想睇我哋自己定係外面市場？'))
    assert.equal(c.internalReads.length, 0)
    assert.equal(c.publicReads.length, 0)
  })
})

test('*** an obligation settles the meaning: neither other gate is re-asked ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector()
    const amb = ambiSpy('ask'); const mx = mixedSpy('not_mixed')
    const a = scriptedAdapter([FINAL('a'), READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('done')])
    await run('市場價點', a, DEPS(c, { finalVerifier: finalSpy('require_public').fn, ambiguityVerifier: amb.fn, mixedVerifier: mx.fn }))
    assert.equal(amb.calls.length, 0, '⛔ the ambiguity gate re-litigated a settled meaning')
    assert.equal(mx.calls.length, 0, '⛔ and the mixed gate spent a call on a closed question')
    assert.equal(c.publicReads.length, 1)
  })
})

test('*** an obligation is not claimed for a world that cannot be reached ***', async () => {
  // Obliging a public read on a turn with no public capability would refuse the final forever.
  const r = await runFinalKnowledgeRequirement({
    verify: async () => ({ decision: 'require_mixed', question: null }),
    message: 'x', history: [], availableWorlds: { internal: true, public: false }
  })
  assert.deepEqual(r.requiredWorlds, { internal: true, public: false })
  const none = await runFinalKnowledgeRequirement({
    verify: async () => ({ decision: 'require_public', question: null }),
    message: 'x', history: [], availableWorlds: { internal: true, public: false }
  })
  assert.equal(none.requiredWorlds, null, 'nothing reachable ⇒ no impossible obligation')
})

/* ═══ Y, Z — A4 OFF, AND THE FENCES ═════════════════════════════════════ */

test('*** Y — ⛔ A4 OFF: the gate does not exist, byte for byte ***', async () => {
  await withEnv({ [A4_FLAG]: 'off' }, async () => {
    const c = twoWorldConnector()
    const f = finalSpy('require_public')
    const a = scriptedAdapter([FINAL('照舊答。')])
    const out = await run('市場價點', a, DEPS(c, { finalVerifier: f.fn }))
    assert.equal(f.calls.length, 0, '⛔ the verifier ran with A4 off')
    assert.equal(out.reply, '照舊答。')
    assert.equal(a.calls.length, 1)
  })
})

const SRC = fs.readFileSync(path.resolve(__dirname, 'finalKnowledgeRequirement.js'), 'utf8')
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('*** Z — semantic guidance SHA is unchanged ***', () => {
  const crypto = require('node:crypto')
  const { A4_SEMANTIC_GUIDANCE } = require('./a4Contract')
  assert.equal(crypto.createHash('sha256').update(A4_SEMANTIC_GUIDANCE).digest('hex'),
    'cfc917cc38b8c50453d506d2b74539511826c319bd9d955aad59dbf8151e8523')
})

test('*** ⛔ NO TEXT DETECTOR: production never inspects her prose for a capability denial ***', () => {
  // The fragile alternative this replaces. If one of these ever appears as a matcher, the gate
  // has quietly become a phrase list and will break on the first paraphrase.
  for (const phrase of ['cannot access', 'cannot obtain', 'no external', '未能取得', '無法取得', '讀唔到', 'unable to']) {
    // CODE, not SRC: the fence is about MATCHERS, and a comment naming the phrase is how the
    // decision is documented. (This test's own first draft failed on that comment.)
    assert.equal(CODE.includes(phrase), false, `⛔ prose detector «${phrase}»`)
  }
  assert.equal(/\breply\b|\banswerText\b|finalText/.test(CODE), false, '⛔ the gate reads the model\'s answer')
})

test('*** ⛔ no keyword classifier, no domain rule, no holdout string ***', () => {
  for (const domain of ['牛肉', 'beef', 'brisket', 'Gordon', '8.72', 'market', '市場價']) {
    assert.equal(CODE.includes(domain), false, `⛔ domain token «${domain}»`)
  }
  assert.equal(SRC.includes('Aroma 實際牛肉成本升幅同市場相比合理嗎'), false, '⛔ holdout sentence in production')
  // No regex over the Owner's words. The only regex here guards the OUTPUT question.
  assert.equal(/message\.(test|match)|\.test\(\s*(message|ownerMessages)/.test(CODE), false)
})

test('*** ⛔ no capability, tool, provider or network vocabulary ***', () => {
  // ⛔ ONE DELIBERATE EXCEPTION, EXCLUDED BY NAME RATHER THAN BY WEAKENING THE FENCE.
  // `IMPLEMENTATION_TERMS` is the guard that stops a clarify question showing the Owner an
  // internal term, so it must SPELL those terms — it is the opposite of a capability
  // reference, and blanket-scanning for them flagged the very line that prevents the leak.
  const scanned = CODE.split('\n').filter((l) => !l.includes('IMPLEMENTATION_TERMS =')).join('\n')
  for (const tok of ['public_knowledge', 'aroma_system', 'gmail', 'drive', 'calendar', 'connector',
    'OpenAIAdapter', 'ClaudeAdapter', 'modelRouter', 'openai', 'anthropic', 'gpt', 'fetch(', 'https://']) {
    assert.equal(scanned.toLowerCase().includes(tok.toLowerCase()), false, `⛔ «${tok}»`)
  }
  // And the exception really is only that one line.
  assert.ok(/IMPLEMENTATION_TERMS = \/public_knowledge/.test(CODE))
  for (const tok of ['send', 'create', 'update', 'delete', 'post', 'execute', 'approve']) {
    assert.equal(new RegExp('\\b' + tok + '\\b', 'i').test(CODE), false, `⛔ write verb «${tok}»`)
  }
})

test('*** ⛔ the schema is strict, closed, and carries no reasoning field ***', () => {
  assert.equal(FINAL_SCHEMA.type, 'object', 'a nullable root is rejected at the provider')
  assert.equal(FINAL_SCHEMA.additionalProperties, false)
  assert.deepEqual(FINAL_SCHEMA.required.slice().sort(), ['decision', 'question'])
  assert.deepEqual(Object.keys(FINAL_SCHEMA.properties).sort(), ['decision', 'question'])
  assert.deepEqual(FINAL_SCHEMA.properties.decision.enum.slice().sort(),
    ['allow_final', 'clarify', 'require_internal', 'require_mixed', 'require_public'])
  for (const banned of ['reason', 'rationale', 'confidence', 'analysis', 'thinking', 'tool',
    'capability', 'provider', 'query', 'source', 'readKey']) {
    assert.equal(Object.prototype.hasOwnProperty.call(FINAL_SCHEMA.properties, banned), false, `⛔ ${banned}`)
  }
})

test('*** the observation block names a world and never a capability ***', () => {
  for (const w of ['internal', 'public']) {
    const b = renderRequiredWorldObservation(w)
    assert.ok(b && b.length > 0)
    assert.equal(/public_knowledge|aroma_system|readKey|nextRead|capability/i.test(b), false, `⛔ ${w} block names mechanism`)
  }
  assert.equal(renderRequiredWorldObservation('nonsense'), null)
})

test('*** the system text names no product and tells her nothing about her powers ***', () => {
  assert.equal(/public_knowledge|aroma_system|readKey|nextRead|API|endpoint/i.test(FINAL_SYSTEM), false)
  assert.equal(/你有.*搜尋|你可以上網|internet/i.test(FINAL_SYSTEM), false, '⛔ a capability claim in the prompt')
})

test('*** the log line is enums and numbers only ***', () => {
  let line = null
  logFinalRequirement({ requestId: 'r1', outcome: 'require_public', requiredWorlds: { internal: false, public: true }, ownerMessageCount: 2, durationMs: 5 }, (l) => { line = l })
  assert.deepEqual(Object.keys(line).sort(),
    ['durationMs', 'event', 'outcome', 'ownerMessageCount', 'requestId', 'requiredInternal', 'requiredPublic', 'timestamp'])
  let bad = null
  logFinalRequirement({ outcome: 'require_public ' + SECRET, ownerMessageCount: 'many' }, (l) => { bad = l })
  assert.equal(bad.outcome, OUTCOME.UNAVAILABLE)
  assert.equal(JSON.stringify(bad).includes(SECRET), false)
})

test('*** WORLDS_FOR is total over the enum and frozen ***', () => {
  for (const d of FINAL_SCHEMA.properties.decision.enum) {
    assert.ok(Object.prototype.hasOwnProperty.call(WORLDS_FOR, d), `${d} has no world mapping`)
  }
  assert.equal(WORLDS_FOR[DECISION.ALLOW], null)
  assert.equal(WORLDS_FOR[DECISION.CLARIFY], null)
})
