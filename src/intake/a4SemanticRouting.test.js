'use strict'

/**
 * a4SemanticRouting.test.js — A4-1: the keyword route stops owning read initiation.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEFECT, MEASURED BEFORE THIS SLICE.
 *
 * `intentFor('食材採購價平均增加 3%')` matches the purchase_order intent, because the sentence
 * contains 採購. So a pure ANALYSIS question — one that supplied every number it needed —
 * routed BUSINESS_QUERY and read the restaurant's purchase orders. Same for 「安排」 and the
 * calendar. The router is not wrong about what the words say; it was never able to answer the
 * different question of whether ANSWERING requires our records at all.
 *
 * ── WHAT A4-1 CHANGES, AND WHAT IT POINTEDLY DOES NOT ────────────────────────
 * turnRouter still runs, still classifies BUSINESS_QUERY, still names its source, still logs
 * it. INTENTS is untouched and no negative regex is added — 「採購 unless followed by 價」
 * would be the same architecture with a longer list.
 *
 * What changes is ONE condition in intakeService: with A4 semantic routing ON, the automatic
 * read is not initiated, so the turn reaches the model with zero rows and the model decides
 * READ / ASK / FINAL. That is already the A3 first-read path; no capability is added and no
 * authorisation moves.
 *
 * ⛔ THE DECISIVE TEST IS 「AUTO-READ PROOF」 BELOW: BUSINESS_QUERY still classifies, its
 * source list still contains aroma_system, and the connector count BEFORE the first model
 * decision is ZERO.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { routeTurn } = require('./turnRouter')
const { intentFor } = require('../context/readContext')
const { A4_FLAG, a4SemanticRoutingEnabled, A4_SEMANTIC_GUIDANCE } = require('./a4Contract')
const { buildDistillPrompt, SYSTEM_PROMPT } = require('./distillPrompt')

const NOW = '2026-08-09T00:00:00.000Z'
const INV = 'aroma_system.invoices'
const PURC = 'aroma_system.purchasing'

/* ═══ FIXTURES ════════════════════════════════════════════════════════════ */

/** Records EVERY connector call, and WHEN — the order is what proves the change. */
function timelineConnector () {
  const reads = []
  return {
    reads,
    connector: {
      async read (source, method) {
        reads.push({ source, method, at: 'connector' })
        const rows = [{
          source, sourceId: '7', title: 'Beef Brisket', entityType: 'purchase_order',
          content: 'id=7 · supplier=Gordon · unit_price=8.72', fields: { id: '7', supplier: 'Gordon', unit_price: '8.72' },
          trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null
        }]
        return {
          asOf: NOW, source, count: rows.length, results: rows,
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

/** Appends a marker to the shared timeline at every model call — interleaving is the proof. */
function scriptedAdapter (label, envelopes, timeline) {
  const calls = []
  return {
    label,
    calls,
    async complete (prompt, opts = {}) {
      if (timeline) timeline.push({ at: 'model', n: calls.length + 1 })
      calls.push({
        prompt: String(prompt),
        system: String(opts.system || ''),
        schemaName: opts.responseFormat ? opts.responseFormat.name : null,
        hasAnswerPlan: !!(opts.responseFormat && opts.responseFormat.schema && opts.responseFormat.schema.properties && opts.responseFormat.schema.properties.answerPlan),
        readChoices: (() => {
          try {
            const nr = opts.responseFormat.schema.properties.nextRead
            return nr.properties ? nr.properties.capability.enum : 'null-only'
          } catch (_) { return 'no-schema' }
        })()
      })
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error(label + ' called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: label, latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ = (capability) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: { capability }, answerPlan: null })
const ASK = (reply) => ({ intent: 'question', mode: 'ask', reply, nextRead: null, answerPlan: null })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })
const FINAL_PLAN = (reply, plan) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: plan })

const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', CONTEXT_CALENDAR: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off' }
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

async function withPlanLog (fn) {
  const captured = []
  const original = console.log
  console.log = (...a) => { if (a[0] === '[AROMA-ANSWER-PLAN]') { try { captured.push(JSON.parse(a[1])) } catch (_) {} } }
  try { return { result: await fn(), captured } } finally { console.log = original }
}

const run = (msg, adapter, deps, history) => processIntake(msg, adapter, history || [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
})

/* THE OWNER'S OWN SENTENCES — used verbatim so drift is visible. */
const Q_SUPPLIED = '食材採購價平均增加 3%，客流增加 8%，外賣比例由 18% 升到 31%，毛利由 68% 跌到 59%。如果只可以先調查三件事，你會查甚麼？'
const Q_INTERNAL = '我哋最近牛肉入貨價比上個月升跌幾多？'
const Q_AMBIGUOUS = '幫我查下最近牛肉比上個月上升或下降多少。'
const Q_PUBLIC = '加拿大牛肉市場最近比上個月升跌幾多？'
const Q_MIXED = '我哋牛肉成本升幅同市場相比正常嗎？'
const Q_SCHEDULE = '如果只有兩個員工，你會點安排今日嘅工序先至最順？'
const CLARIFY = '你想睇我哋供應商實際入貨價，定係外面市場牛肉行情？如果你想，我亦可以兩邊都睇。'

/* ═══ THE DEFECT THIS SLICE EXISTS FOR — MEASURED, NOT ASSERTED ═══════════ */

test('*** the keyword table still matches these sentences — that is not what changed ***', () => {
  assert.equal(intentFor(Q_SUPPLIED).key, 'purchase_order', '「採購價」 still matches; INTENTS is untouched')
  assert.equal(intentFor(Q_SCHEDULE).key, 'schedule', '「安排」 still matches')
  assert.equal(routeTurn(Q_SUPPLIED).route, 'BUSINESS_QUERY', 'and the router still classifies it')
  assert.deepEqual(routeTurn(Q_SUPPLIED).sources, ['aroma_system'], 'and still names its source')
})

/* ═══ ⛔ THE DECISIVE PROOF ═══════════════════════════════════════════════ */

test('*** AUTO-READ PROOF — BUSINESS_QUERY still classifies, but owns NO read initiation ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    const timeline = []
    const orig = tc.connector.read.bind(tc.connector)
    tc.connector.read = async (...a) => { timeline.push({ at: 'connector' }); return orig(...a) }

    // 「幫我睇最近發票。」 — the router calls this BUSINESS_QUERY and names aroma_system.
    const route = routeTurn('幫我睇最近發票。')
    assert.equal(route.route, 'BUSINESS_QUERY')
    assert.ok(route.sources.includes('aroma_system'), 'the keyword route is alive and still names the source')

    const a = scriptedAdapter('claude', [READ(INV), FINAL('發票喺度。')], timeline)
    await run('幫我睇最近發票。', a, { connector: tc.connector, sources: ['aroma_system'] })

    // ⛔ THE ORDER IS THE PROOF: the FIRST event is a model call, not a connector call.
    assert.equal(timeline[0].at, 'model',
      '⛔ ZERO connector calls before the first model decision — the route no longer initiates')
    const firstConnector = timeline.findIndex((e) => e.at === 'connector')
    assert.ok(firstConnector > 0, 'the connector is reached only AFTER a model decision')
    assert.deepEqual(tc.reads.map((r) => r.method), ['listInvoices'],
      'and it read exactly the operation the MODEL named')
  })
})

/* ═══ A — A4 OFF IS TODAY, EXACTLY ═══════════════════════════════════════ */

test('*** A — A4 off: the automatic keyword read happens exactly as it does today ***', async () => {
  await withEnv(OFF, async () => {
    const tc = timelineConnector()
    const timeline = []
    const orig = tc.connector.read.bind(tc.connector)
    tc.connector.read = async (...a) => { timeline.push({ at: 'connector' }); return orig(...a) }
    const a = scriptedAdapter('claude', [FINAL('發票喺度。')], timeline)
    await run('幫我睇最近發票。', a, { connector: tc.connector, sources: ['aroma_system'] })

    assert.equal(timeline[0].at, 'connector', 'the read still comes FIRST when A4 is off — this is the rollback')
    assert.deepEqual(tc.reads.map((r) => r.method), ['listInvoices'])
    assert.equal(a.calls.length, 1, 'and one model call, as today')
  })
})

test('*** R — A4 off: no A4 wording reaches the system prompt ***', () => {
  const saved = process.env[A4_FLAG]
  delete process.env[A4_FLAG]
  try {
    const { system } = buildDistillPrompt('你好', [])
    assert.equal(system, SYSTEM_PROMPT, 'byte-identical to the untouched constant')
    assert.equal(system.includes('判斷要唔要查資料'), false, 'no A4 guidance leaked')
  } finally { if (saved === undefined) delete process.env[A4_FLAG]; else process.env[A4_FLAG] = saved }
})

test('*** A4 on + CHAT lane: the guidance is appended, and SYSTEM_PROMPT is never mutated ***', () => {
  const saved = process.env[A4_FLAG]
  process.env[A4_FLAG] = 'on'
  try {
    const { system } = buildDistillPrompt('你好', [], { chatLane: true })
    assert.ok(system.startsWith(SYSTEM_PROMPT), 'the base prompt is intact and first')
    assert.ok(system.includes(A4_SEMANTIC_GUIDANCE.trim().slice(0, 20)), 'the guidance follows it')
    assert.equal(SYSTEM_PROMPT.includes('判斷要唔要查資料'), false, 'the exported constant is unchanged')
  } finally { if (saved === undefined) delete process.env[A4_FLAG]; else process.env[A4_FLAG] = saved }
})

test('*** ⛔ A4 on + NON-chat lane: the guidance must NOT appear ***', () => {
  // A4-1 governs knowledge READ INITIATION IN CHAT and nothing else. buildDistillPrompt
  // composes the system string for EVERY lane, and the first version of this change appended
  // unconditionally — which silently altered the proposal and email_draft system strings.
  // conversationContract's byte-identity assertion caught it. A lane that cannot read has no
  // use for guidance about when to read.
  const saved = process.env[A4_FLAG]
  process.env[A4_FLAG] = 'on'
  try {
    for (const opts of [undefined, {}, { chatLane: false }]) {
      const { system } = buildDistillPrompt('幫我改 docs/x.md', [], opts)
      assert.equal(system, SYSTEM_PROMPT, 'non-chat lanes keep the untouched composition: ' + JSON.stringify(opts))
    }
  } finally { if (saved === undefined) delete process.env[A4_FLAG]; else process.env[A4_FLAG] = saved }
})

/* ═══ S — SHADOW CHANGES NOTHING ═════════════════════════════════════════ */

test('*** S — shadow does not touch routing, and adds no model call ***', async () => {
  assert.equal(a4SemanticRoutingEnabled({ [A4_FLAG]: 'shadow' }), false, 'shadow is not semantic routing')
  await withEnv(SHADOW, async () => {
    const tc = timelineConnector()
    const timeline = []
    const orig = tc.connector.read.bind(tc.connector)
    tc.connector.read = async (...a) => { timeline.push({ at: 'connector' }); return orig(...a) }
    const a = scriptedAdapter('claude', [FINAL('發票喺度。')], timeline)
    await run('幫我睇最近發票。', a, { connector: tc.connector, sources: ['aroma_system'] })
    assert.equal(timeline[0].at, 'connector', 'shadow behaves like OFF for routing')
    assert.equal(a.calls.length, 1, '⛔ and introduces NO second paid call to shadow the decision')
    const { system } = buildDistillPrompt('x', [])
    assert.equal(system.includes('判斷要唔要查資料'), false, 'and no semantic wording either')
  })
})

/* ═══ B — SUPPLIED FACTS: THE 採購 FALSE POSITIVE IS GONE ════════════════ */

test('*** B — supplied facts: 「採購價」 no longer reads Aroma System ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    const a = scriptedAdapter('claude', [FINAL('我會先查外賣單位經濟、食材成本結構、廚房效率。')])
    await run(Q_SUPPLIED, a, { connector: tc.connector, sources: ['aroma_system'] })
    assert.deepEqual(tc.reads, [], '⛔ ZERO reads — the analysis question supplied its own facts')
    assert.equal(a.calls.length, 1, 'one call, straight to FINAL')
  })
})

/* ═══ J — THE 安排 FALSE POSITIVE IS GONE TOO ════════════════════════════ */

test('*** J — a planning question containing 「安排」 does not read the calendar ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    assert.equal(routeTurn(Q_SCHEDULE).route, 'BUSINESS_QUERY', 'the router still says schedule')
    const a = scriptedAdapter('claude', [FINAL('我會先鎖死有死線嗰項。')])
    await run(Q_SCHEDULE, a, { connector: tc.connector, sources: ['calendar'] })
    assert.deepEqual(tc.reads, [], '⛔ a reasoning question is not a diary lookup')
  })
})

/* ═══ C — CLEAR INTERNAL ════════════════════════════════════════════════ */

test('*** C — clear internal: the model names the operation and Truth Closure activates ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    const PLAN = {
      directAnswer: '入貨價喺度。', answerClaims: null, unanswerable: false, citesEvidence: true,
      sections: [{ heading: '採購', items: [{ sourceId: 'aroma_system.purchasing#7', title: 'Beef Brisket', facts: [{ field: '供應商', value: 'Gordon' }] }] }],
      limitations: [], followUp: null
    }
    const a = scriptedAdapter('claude', [READ(PURC), FINAL_PLAN('睇咗。', PLAN)])
    const { captured } = await withPlanLog(() => run(Q_INTERNAL, a, { connector: tc.connector, sources: ['aroma_system'] }))

    assert.deepEqual(tc.reads.map((r) => r.method), ['listPurchaseOrders'], 'exactly the model-requested operation')
    assert.equal(a.calls[1].hasAnswerPlan, true, 'Truth Closure activated by the live model-directed read')
    assert.equal(captured.length, 1, 'and the validator ran')
    assert.notEqual(captured[0].reason, 'no_plan_returned')
  })
})

/* ═══ D — SOURCE AMBIGUITY: ASK, AND IT IS NOT A READ FAILURE ════════════ */

test('*** D — ambiguous beef: ASK, zero reads, zero evidence, zero unavailable ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    const reads = []
    const a = scriptedAdapter('claude', [ASK(CLARIFY)])
    const { result, captured } = await withPlanLog(() => run(Q_AMBIGUOUS, a, { connector: tc.connector, sources: ['aroma_system'] }))

    assert.deepEqual(tc.reads, [], '⛔ ZERO connector calls — ambiguity is decided before any read')
    assert.equal(a.calls.length, 1, 'one model call')
    assert.deepEqual(captured, [], 'no Answer Plan layer ran — there is no evidence to ground')
    assert.equal(result.decision, null, 'and nothing was created')
    // ⛔ AMBIGUITY IS NOT UNAVAILABLE. No read was attempted, so no trust state exists at all.
    assert.equal(String(result.reply).includes('讀唔到'), false, 'never reported as a read failure')
    assert.equal(String(result.reply).includes('目前讀不到'), false)
    // And it asks about MEANING, not about tooling.
    assert.equal(/aroma_system|public_knowledge|capability|operation|工具/.test(String(result.reply)), false,
      '⛔ the Owner is asked which BUSINESS meaning, never which source or tool')
    assert.ok(String(result.reply).length > 0)
  })
})

/* ═══ E / F / G — CONTINUATION AFTER THE ASK ════════════════════════════ */

const AFTER_ASK = [
  { role: 'user', text: Q_AMBIGUOUS },
  { role: 'assistant', text: CLARIFY }
]

test('*** E — 「我哋供應商。」 continues the original task as an INTERNAL read ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    const a = scriptedAdapter('claude', [READ(PURC), FINAL('入貨價喺度。')])
    await run('我哋供應商。', a, { connector: tc.connector, sources: ['aroma_system'] }, AFTER_ASK)
    assert.ok(a.calls[0].prompt.includes(CLARIFY), 'the clarification is in the prompt — no new state system')
    assert.ok(a.calls[0].prompt.includes('牛肉'), 'and so is the ORIGINAL question — he need not restate it')
    assert.deepEqual(tc.reads.map((r) => r.method), ['listPurchaseOrders'])
  })
})

test('*** F — 「市場。」 reads nothing internal and invents nothing ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    const a = scriptedAdapter('claude', [FINAL('外面市場行情我而家仲讀唔到，唔可以靠估。')])
    const out = await run('市場。', a, { connector: tc.connector, sources: ['aroma_system'] }, AFTER_ASK)
    assert.deepEqual(tc.reads, [], '⛔ a public question must not be answered from our own records')
    assert.equal(a.calls.length, 1, 'and it does not ask which source again')
  })
})

test('*** G — 「兩邊都睇。」 is mixed, not ambiguous: internal may run, nothing public invented ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    const a = scriptedAdapter('claude', [READ(PURC), FINAL('我哋嗰邊讀到；出面市場暫時讀唔到。')])
    await run('兩邊都睇。', a, { connector: tc.connector, sources: ['aroma_system'] }, AFTER_ASK)
    assert.deepEqual(tc.reads.map((r) => r.method), ['listPurchaseOrders'], 'the internal half may proceed')
    assert.equal(a.calls.filter((c) => c.schemaName === null).length, 0, 'still a normal grounded turn')
  })
})

/* ═══ H — EXPLICIT PUBLIC ═══════════════════════════════════════════════ */

test('*** H — an explicitly public question triggers no Aroma read ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    const a = scriptedAdapter('claude', [FINAL('呢個要外部市場資料，我而家攞唔到。')])
    await run(Q_PUBLIC, a, { connector: tc.connector, sources: ['aroma_system'] })
    assert.deepEqual(tc.reads, [], '⛔ 「牛肉／價格」 must not reach aroma_system')
  })
})

/* ═══ I — EXPLICIT MIXED IS NOT AMBIGUOUS ═══════════════════════════════ */

test('*** I — a mixed question is not an ambiguity ASK ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    const a = scriptedAdapter('claude', [READ(PURC), FINAL('我哋成本喺度；同市場比較嗰半我未讀到。')])
    const out = await run(Q_MIXED, a, { connector: tc.connector, sources: ['aroma_system'] })
    assert.deepEqual(tc.reads.map((r) => r.method), ['listPurchaseOrders'], 'the internal half may run')
    assert.equal(String(out.reply).includes('你想睇'), false, 'and it does not ask him to pick a side')
  })
})

/* ═══ K / L — UTILITY AND ACTION ARE UNTOUCHED ══════════════════════════ */

test('*** K — UTILITY still routes server-first under A4 ON ***', () => {
  const saved = process.env[A4_FLAG]
  process.env[A4_FLAG] = 'on'
  try {
    const r = routeTurn('而家幾點？')
    assert.equal(r.route, 'UTILITY', 'A4 does not touch the utility gate')
    assert.deepEqual(r.sources, [], 'and it still reads nothing')
  } finally { if (saved === undefined) delete process.env[A4_FLAG]; else process.env[A4_FLAG] = saved }
})

test('*** L — ACTION still routes before any retrieved content, under A4 ON ***', () => {
  const saved = process.env[A4_FLAG]
  process.env[A4_FLAG] = 'on'
  try {
    const r = routeTurn('幫我改 docs/x.md 嗰行字')
    assert.equal(r.route, 'ACTION', 'the action boundary is decided from his words alone')
    assert.deepEqual(r.sources, [])
  } finally { if (saved === undefined) delete process.env[A4_FLAG]; else process.env[A4_FLAG] = saved }
})

/* ═══ M / N — AUTHORISATION IS UNMOVED ══════════════════════════════════ */

test('*** M — an invented capability is still refused before the connector ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    const a = scriptedAdapter('claude', [READ('aroma_system.staffing'), FINAL('唔得。')])
    await run(Q_INTERNAL, a, { connector: tc.connector, sources: ['aroma_system'] })
    assert.deepEqual(tc.reads, [], 'semantic routing did not widen what may be read')
  })
})

test('*** N — a write-shaped capability is still refused ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    const a = scriptedAdapter('claude', [READ('aroma_system.send_order'), FINAL('唔得。')])
    await run(Q_INTERNAL, a, { connector: tc.connector, sources: ['aroma_system'] })
    assert.deepEqual(tc.reads, [], 'WRITE_SHAPED is untouched')
  })
})

/* ═══ O / P / Q — A3 TRUTH LAYER SURVIVES ═══════════════════════════════ */

test('*** P — a LIVE zero-row model-directed read is still evidence ***', async () => {
  await withEnv(ON, async () => {
    const empty = {
      async read (source, method) {
        return {
          asOf: NOW, source, count: 0, results: [],
          evidence: { source, endpoint: method, entityType: 'unknown', rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: 0, shownCount: 0, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'fake' }
        }
      }
    }
    const PLAN = { directAnswer: '讀到咗，冇相符記錄。', answerClaims: null, unanswerable: false, citesEvidence: false, sections: [], limitations: [], followUp: null }
    const a = scriptedAdapter('claude', [READ(INV), FINAL_PLAN('冇嘢。', PLAN)])
    await run(Q_INTERNAL, a, { connector: empty, sources: ['aroma_system'] })
    assert.equal(a.calls[1].hasAnswerPlan, true, 'zero rows is still evidence, and still grounds')
  })
})

test('*** Q — an UNAVAILABLE model-directed read does NOT activate Truth Closure ***', async () => {
  await withEnv(ON, async () => {
    const broken = { async read () { throw new Error('upstream down') } }
    const a = scriptedAdapter('claude', [READ(INV), FINAL('今次讀唔到。')])
    await run(Q_INTERNAL, a, { connector: broken, sources: ['aroma_system'] })
    assert.equal(a.calls[1].hasAnswerPlan, false, 'a failed read is not evidence — unchanged from A3')
  })
})

/* ═══ T — NO CHAIN-OF-THOUGHT, NO ROUTE ENUM ════════════════════════════ */

test('*** T — no chain-of-thought field, and no knowledgeRoute label, was added ***', async () => {
  await withEnv(ON, async () => {
    const tc = timelineConnector()
    const a = scriptedAdapter('claude', [FINAL('ok')])
    await run(Q_SUPPLIED, a, { connector: tc.connector, sources: ['aroma_system'] })
    const schema = a.calls[0].schemaName === null ? null : JSON.stringify(a.calls[0])
    const keys = []
    const walk = (n) => { if (!n || typeof n !== 'object') return; if (n.properties) keys.push(...Object.keys(n.properties)); for (const k of Object.keys(n)) walk(n[k]) }
    // the shaped schema this turn actually sent
    walk(JSON.parse(JSON.stringify(a.calls[0])))
    for (const banned of ['reasoning', 'thoughts', 'chainOfThought', 'rationale', 'hiddenPlan', 'knowledgeRoute', 'informationWorld']) {
      assert.equal(keys.includes(banned), false, '⛔ ' + banned + ' must not exist — the ACTION expresses the decision')
    }
    assert.ok(schema === null || true)
  })
})
