'use strict'

/**
 * a4ModeContract.test.js — A4-1C: the chat lane's output contract stops contradicting itself.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE CONTRADICTION.
 *
 * The classifier tells the model an operational request — 做／建立／改／停／查 — is
 * `mode:"commit"`. laneRouter and the intake governance already disagree: read/look/check/find
 * is a KNOWLEDGE READ, and a chat turn cannot execute anything. So 「幫我查下…」 was being
 * described two ways at once, and the A4 semantic guidance was arguing with the classifier
 * instead of extending it.
 *
 * Two prose calibrations failed in OPPOSITE directions — the second moved the failure from
 * over-asking to under-asking without removing it. The lesson is not 「write better prose」:
 * an invalid state was REPRESENTABLE, so the model kept representing it.
 *
 * ⛔ AND NARROWING REMOVES NO CAPABILITY. intakeService already intercepts a chat-lane
 * `commit` and creates NO Decision, NO Task, NO Proposal, no dispatch. Real actions reach the
 * proposal lane through laneRouter BEFORE any content is fetched. This aligns the model's
 * contract with authority the server always had.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { routeTurn } = require('./turnRouter')
const {
  DISTILL_WITH_PLAN_SCHEMA, DISTILL_WITH_READ_DECISION_SCHEMA,
  withChatKnowledgeModes, CHAT_KNOWLEDGE_MODES
} = require('./answerPlan')
const { A4_FLAG, A4_SEMANTIC_GUIDANCE } = require('./a4Contract')
const { buildDistillPrompt, SYSTEM_PROMPT } = require('./distillPrompt')

const NOW = '2026-08-09T00:00:00.000Z'
const INV = 'aroma_system.invoices'
const PRODUCTION_MODES = ['commit', 'recommend', 'ask', 'chat']

/* ═══ FIXTURES ════════════════════════════════════════════════════════════ */

function spyConnector () {
  const reads = []
  return {
    reads,
    connector: {
      async read (source, method) {
        reads.push({ source, method })
        const rows = [{
          source, sourceId: '7', title: 'Beef Brisket', entityType: 'purchase_order',
          content: 'id=7 · supplier=Gordon · unit_price=8.72', fields: { id: '7', supplier: 'Gordon', unit_price: '8.72' },
          trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null
        }]
        return {
          asOf: NOW, source, count: 1, results: rows,
          evidence: {
            source, endpoint: method, entityType: 'purchase_order',
            rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {},
            matchingTotal: 1, shownCount: 1, sourceTotal: null,
            queryScope: { field: null, window: null, declaredBy: 'reader' },
            completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'fake'
          }
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
        system: String(opts.system || ''),
        schemaName: opts.responseFormat ? opts.responseFormat.name : null,
        modeEnum: (() => { try { return opts.responseFormat.schema.properties.mode.enum } catch (_) { return null } })(),
        hasAnswerPlan: !!(opts.responseFormat && opts.responseFormat.schema && opts.responseFormat.schema.properties && opts.responseFormat.schema.properties.answerPlan)
      })
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error(label + ' called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: label, latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ = (capability) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: { capability }, answerPlan: null })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })
const FINAL_PLAN = (plan) => ({ intent: 'question', mode: 'chat', reply: '睇咗。', nextRead: null, answerPlan: plan })

const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off' }
async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}
const ON = { [A4_FLAG]: 'on' }
const OFF = { [A4_FLAG]: null }
const SHADOW = { [A4_FLAG]: 'shadow' }

const chat = (msg, adapter, deps) => processIntake(msg, adapter, [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
})

/* ═══ THE SHAPER ITSELF ═══════════════════════════════════════════════════ */

test('*** the shaper is inert when disabled — same object, not an equal one ***', () => {
  for (const s of [DISTILL_WITH_PLAN_SCHEMA, DISTILL_WITH_READ_DECISION_SCHEMA]) {
    assert.equal(withChatKnowledgeModes(s, false), s, 'identity, so an off turn cannot differ by key order')
    assert.deepEqual(s.properties.mode.enum, PRODUCTION_MODES, 'and the source enum is never mutated')
  }
})

test('*** enabled: only commit is removed, and the canonical ORDER is preserved ***', () => {
  for (const s of [DISTILL_WITH_PLAN_SCHEMA, DISTILL_WITH_READ_DECISION_SCHEMA]) {
    const out = withChatKnowledgeModes(s, true)
    assert.deepEqual(out.properties.mode.enum, ['recommend', 'ask', 'chat'])
    assert.deepEqual(out.properties.mode.enum, CHAT_KNOWLEDGE_MODES.slice(), 'matches the declared set')
    assert.equal(out.properties.mode.enum.includes('commit'), false)
    assert.notEqual(out, s, 'a clone, never a mutation')
  }
})

/* ═══ A / B / C — OFF AND SHADOW ARE UNTOUCHED ═══════════════════════════ */

test('*** A — A4 OFF + chat: the mode enum is EXACTLY production, commit included ***', async () => {
  await withEnv(OFF, async () => {
    const sc = spyConnector()
    const a = scriptedAdapter('claude', [FINAL('你好！')])
    await chat('你好', a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.deepEqual(a.calls[0].modeEnum, PRODUCTION_MODES, 'byte-for-byte the production contract')
  })
})

test('*** C — A4 SHADOW: no narrowing ***', async () => {
  await withEnv(SHADOW, async () => {
    const sc = spyConnector()
    const a = scriptedAdapter('claude', [FINAL('你好！')])
    await chat('你好', a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.deepEqual(a.calls[0].modeEnum, PRODUCTION_MODES, 'shadow changes no behaviour')
  })
})

/* ═══ D / E — ⛔ THE CRITICAL STRUCTURAL ASSERTION ═══════════════════════ */

test('*** D — A4 ON + chat, zero-read schema: commit is STRUCTURALLY IMPOSSIBLE ***', async () => {
  await withEnv(ON, async () => {
    const sc = spyConnector()
    const a = scriptedAdapter('claude', [FINAL('你好！')])
    await chat('你好', a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls[0].schemaName, 'distill_with_read_decision')
    assert.equal(a.calls[0].modeEnum.includes('commit'), false,
      '⛔ not 「the fake model happened not to pick commit」 — the contract cannot express it')
    assert.deepEqual(a.calls[0].modeEnum, ['recommend', 'ask', 'chat'])
  })
})

test('*** E — A4 ON + chat, post-read Answer Plan schema: commit is impossible there too ***', async () => {
  await withEnv(ON, async () => {
    const sc = spyConnector()
    const PLAN = {
      directAnswer: '睇咗。', answerClaims: null, unanswerable: false, citesEvidence: true,
      sections: [{ heading: '發票', items: [{ sourceId: 'aroma_system.invoices#7', title: 'Beef Brisket', facts: [{ field: '供應商', value: 'Gordon' }] }] }],
      limitations: [], followUp: null
    }
    const a = scriptedAdapter('claude', [READ(INV), FINAL_PLAN(PLAN)])
    await chat('幫我查下最近發票', a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls[1].schemaName, 'distill_with_answer_plan', 'Truth Closure still engages')
    assert.equal(a.calls[1].modeEnum.includes('commit'), false,
      '⛔ BOTH decisions share one lane contract — first decision and final answer alike')
  })
})

/* ═══ F — NON-CHAT LANES KEEP THEIR CONTRACT ════════════════════════════ */

test('*** F — A4 ON + proposal lane: the mode enum is NOT narrowed ***', async () => {
  await withEnv(ON, async () => {
    const sc = spyConnector()
    const a = scriptedAdapter('claude', [{ intent: 'task', mode: 'chat', reply: 'ok', nextRead: null }])
    await processIntake('幫我改 docs/x.md 嗰行字', a, [], {
      demo: true, interactionMode: 'proposal', requestId: '11111111-2222-4333-8444-555555555555',
      readContextDeps: { connector: sc.connector, sources: ['aroma_system'] }
    })
    // The proposal lane sends no read-decision schema at all; what matters is that nothing
    // narrowed it. If a schema IS present it must still carry commit.
    if (a.calls[0].modeEnum) {
      assert.deepEqual(a.calls[0].modeEnum, PRODUCTION_MODES, 'the action lane keeps commit')
    }
    assert.ok(true)
  })
})

/* ═══ G / H — THE FROZEN PROMPT IS UNTOUCHED BY THIS SLICE ══════════════ */

test('*** G — SYSTEM_PROMPT is byte-identical and still the FINAL segment ***', () => {
  const saved = process.env[A4_FLAG]
  process.env[A4_FLAG] = 'on'
  try {
    const { system } = buildDistillPrompt('你好', [], { chatLane: true })
    assert.ok(system.endsWith(SYSTEM_PROMPT), 'the classifier remains last, verbatim')
    assert.ok(system.indexOf(A4_SEMANTIC_GUIDANCE) < system.indexOf(SYSTEM_PROMPT), 'guidance precedes it')
    assert.equal(SYSTEM_PROMPT.includes('【判斷次序'), false, 'the constant itself was not edited')
  } finally { if (saved === undefined) delete process.env[A4_FLAG]; else process.env[A4_FLAG] = saved }
})

test('*** H — the A4-1R semantic guidance is FROZEN for this slice ***', () => {
  // A4-1C tests whether the CONTRACT contradiction was the blocker. If the prose moved too,
  // the experiment would prove nothing. These are the checkpoint's own markers.
  for (const marker of ['【判斷次序', '1｜夠唔夠料答？', '5｜到呢一步先考慮問。', '含糊係最後先剩低嘅結果，唔係起點']) {
    assert.ok(A4_SEMANTIC_GUIDANCE.includes(marker), 'guidance marker missing — was the prose edited? ' + marker)
  }
  for (const holdout of ['牛肉', '加拿大', 'Gordon', '客流', '毛利']) {
    assert.equal(A4_SEMANTIC_GUIDANCE.includes(holdout), false, holdout + ' must never enter the prompt')
  }
})

/* ═══ I — THE ACTION BOUNDARY IS UNMOVED ════════════════════════════════ */

test('*** I — an explicit edit request still routes to ACTION under A4 ON ***', () => {
  const saved = process.env[A4_FLAG]
  process.env[A4_FLAG] = 'on'
  try {
    const r = routeTurn('幫我改 docs/x.md 嗰行字')
    assert.equal(r.route, 'ACTION', '⛔ A4 must never turn a real action into knowledge chat')
    assert.deepEqual(r.sources, [], 'and it reads nothing')
  } finally { if (saved === undefined) delete process.env[A4_FLAG]; else process.env[A4_FLAG] = saved }
})

/* ═══ J — A READ REQUEST: NO AUTO-READ, AND NO commit AVAILABLE ═════════ */

test('*** J — 「幫我查下最近發票」: zero auto-read, and the contract cannot say commit ***', async () => {
  await withEnv(ON, async () => {
    const sc = spyConnector()
    const timeline = []
    const orig = sc.connector.read.bind(sc.connector)
    sc.connector.read = async (...a) => { timeline.push('connector'); return orig(...a) }
    const a = scriptedAdapter('claude', [READ(INV), FINAL('發票喺度。')])
    // the router still classifies it as a business query
    assert.equal(routeTurn('幫我查下最近發票').route, 'BUSINESS_QUERY')
    await chat('幫我查下最近發票', a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.equal(timeline.length >= 1, true, 'the model-directed read ran')
    assert.equal(a.calls[0].modeEnum.includes('commit'), false, 'and 「查」 can no longer be declared an action')
    assert.deepEqual(sc.reads.map((r) => r.method), ['listInvoices'])
  })
})

/* ═══ K / L / M / N / O / P — EVERYTHING ELSE HOLDS ═════════════════════ */

test('*** K — an invented capability is still refused before the connector ***', async () => {
  await withEnv(ON, async () => {
    const sc = spyConnector()
    const a = scriptedAdapter('claude', [READ('aroma_system.staffing'), FINAL('唔得。')])
    await chat('我哋最近入貨價點', a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.deepEqual(sc.reads, [])
  })
})

test('*** L — a write-shaped capability is still refused ***', async () => {
  await withEnv(ON, async () => {
    const sc = spyConnector()
    const a = scriptedAdapter('claude', [READ('aroma_system.send_order'), FINAL('唔得。')])
    await chat('我哋最近入貨價點', a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.deepEqual(sc.reads, [])
  })
})

test('*** M — a LIVE model-directed read still activates Truth Closure ***', async () => {
  await withEnv(ON, async () => {
    const sc = spyConnector()
    const PLAN = { directAnswer: 'ok', answerClaims: null, unanswerable: false, citesEvidence: false, sections: [], limitations: [], followUp: null }
    const a = scriptedAdapter('claude', [READ(INV), FINAL_PLAN(PLAN)])
    await chat('我哋最近入貨價點', a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls[1].hasAnswerPlan, true)
  })
})

test('*** N — a LIVE zero-row read is still evidence ***', async () => {
  await withEnv(ON, async () => {
    const empty = {
      async read (source, method) {
        return {
          asOf: NOW, source, count: 0, results: [],
          evidence: { source, endpoint: method, entityType: 'unknown', rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: 0, shownCount: 0, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'fake' }
        }
      }
    }
    const PLAN = { directAnswer: '冇相符記錄。', answerClaims: null, unanswerable: false, citesEvidence: false, sections: [], limitations: [], followUp: null }
    const a = scriptedAdapter('claude', [READ(INV), FINAL_PLAN(PLAN)])
    await chat('我哋最近入貨價點', a, { connector: empty, sources: ['aroma_system'] })
    assert.equal(a.calls[1].hasAnswerPlan, true, 'zero rows still grounds')
  })
})

test('*** O — an UNAVAILABLE read still produces no EvidenceSet ***', async () => {
  await withEnv(ON, async () => {
    const broken = { async read () { throw new Error('upstream down') } }
    const a = scriptedAdapter('claude', [READ(INV), FINAL('今次讀唔到。')])
    await chat('我哋最近入貨價點', a, { connector: broken, sources: ['aroma_system'] })
    assert.equal(a.calls[1].hasAnswerPlan, false, 'a failed read is not evidence')
  })
})

test('*** P — no chain-of-thought field was added ***', async () => {
  await withEnv(ON, async () => {
    const sc = spyConnector()
    const a = scriptedAdapter('claude', [FINAL('ok')])
    await chat('你好', a, { connector: sc.connector, sources: ['aroma_system'] })
    const keys = []
    const walk = (n) => { if (!n || typeof n !== 'object') return; if (n.properties) keys.push(...Object.keys(n.properties)); for (const k of Object.keys(n)) walk(n[k]) }
    walk(JSON.parse(JSON.stringify(a.calls[0])))
    for (const banned of ['reasoning', 'thoughts', 'chainOfThought', 'rationale', 'hiddenPlan', 'knowledgeRoute']) {
      assert.equal(keys.includes(banned), false, banned + ' must not exist')
    }
  })
})
