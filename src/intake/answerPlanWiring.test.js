'use strict'

/**
 * answerPlanWiring.test.js — does the REAL pipeline take the new path?
 *
 * WHY THIS FILE EXISTS, IN PLAIN TERMS. Three times now a test has passed while the real
 * path did not. A single-source test hid a truncation defect that only appears with
 * several sources. Then a stub that fed a ready-made Answer Plan straight into the
 * renderer hid a sequencing defect in the wiring: `planFormat` was evaluated BEFORE
 * `turnItems` was populated, so `responseFormat` was never sent, no plan ever came back,
 * and every live turn quietly used the old renderer. The stub proved four stages worked
 * and skipped the two that were broken.
 *
 * So these tests refuse the convenient substitute. They run `processIntake` itself — the
 * real function the server calls — with a spy adapter that records exactly what left the
 * process, and they assert on the OUTBOUND REQUEST and on the LOG, which are the two
 * things a stub cannot fake.
 *
 * ── AND THE GUARANTEE IS NOW WIDER ───────────────────────────────────────────
 * The previous promise was "a fallback cannot occur without a log line". That was true
 * and too narrow, and I treated it as total. It said nothing about the path being ENTERED,
 * so the whole layer could be skipped in silence — which is exactly what happened. The
 * assertion below is now: a turn that retrieved items MUST emit an [AROMA-ANSWER-PLAN]
 * line, whatever the outcome. No line means the layer did not run, and that is a failure
 * in its own right, not an absence of news.
 *
 * No network, no paid call: the adapter is a spy and the connector is a fake.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')

const NOW = '2026-08-03T12:00:00.000Z'

/** A row shaped exactly like the live Aroma System inventory rows. */
const ROW = {
  source: 'aroma_system',
  sourceId: '2',
  title: 'Napa Cabbage',
  originalDate: null,
  entityType: 'inventory_item',
  content: 'id=2 · name=Napa Cabbage · unit=ea · currentStock=18.000 · parLevel=75.000',
  fields: { id: 2, name: 'Napa Cabbage', unit: 'ea', currentStock: '18.000', parLevel: '75.000' },
  link: null,
  trust: 'live',
  error: null,
  retrievedAt: NOW
}

/** A connector that describes its read, the way the real adapter now does. */
function fakeConnector (rows = [ROW]) {
  return {
    async read () {
      return {
        asOf: NOW,
        source: 'aroma_system',
        count: rows.length,
        truncatedCount: 0,
        results: rows,
        evidence: {
          source: 'aroma_system',
          entityType: 'inventory_item',
          endpoint: 'inventory',
          scope: { hasLocation: false, hasAsOf: false, note: '每項有一個存量數字,但冇分地點、亦冇記錄係幾時嘅' },
          metrics: {},
          totalCount: 199,
          shownCount: rows.length,
          completeness: 'sample',
          rankedBy: 'parLevel - currentStock desc',
          selectedBy: 'ranked',
          usedFallback: false,
          retrievedAt: NOW,
          trust: 'live',
          provenance: 'Aroma System /api/v1/ai/inventory'
        }
      }
    }
  }
}

/** Records every opts object that reaches the adapter — what LEFT the process. */
function spyAdapter (responseText) {
  const calls = []
  return {
    calls,
    async complete (prompt, opts = {}) {
      calls.push(opts)
      return { text: responseText, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'spy', latencyMs: 1 }
    }
  }
}

/** Capture [AROMA-ANSWER-PLAN] lines from the real default sink. */
async function withLogCapture (fn) {
  const captured = []
  const original = console.log
  console.log = (...args) => {
    if (args[0] === '[AROMA-ANSWER-PLAN]') { try { captured.push(JSON.parse(args[1])) } catch (_) {} }
  }
  try { return { result: await fn(), captured } } finally { console.log = original }
}

const FLAGS = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on' }
async function withEnv (fn) {
  const saved = {}
  for (const k of Object.keys(FLAGS)) { saved[k] = process.env[k]; process.env[k] = FLAGS[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(FLAGS)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const PLAN = {
  directAnswer: '餐廳系統有 199 項存貨記錄。',
  unanswerable: false,
  sections: [{ heading: '缺口最大', items: [{ sourceId: '2', title: 'Napa Cabbage', facts: [{ field: '現有', value: '18.000' }, { field: '單位', value: 'ea' }] }] }],
  limitations: [],
  followUp: null
}
const ENVELOPE_WITH_PLAN = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '睇咗。', answerPlan: PLAN })
const ENVELOPE_NO_PLAN = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '睇咗。' })

const run = (adapter, message = '而家倉存入面有咩？') => processIntake(message, adapter, [], {
  demo: true,
  interactionMode: 'chat',
  providerHint: 'claude',
  readContextDeps: { connector: fakeConnector(), sources: ['aroma_system'] }
})

/* ── 1. THE OUTBOUND REQUEST ──────────────────────────────────────────────── */

test('*** a chat turn that READ items sends responseFormat on the outbound request ***', async () => {
  await withEnv(async () => {
    const spy = spyAdapter(ENVELOPE_WITH_PLAN)
    await run(spy)
    assert.equal(spy.calls.length >= 1, true, 'the adapter must have been called')
    const opts = spy.calls[0]
    // This is what the previous round got wrong: planFormat was computed before the read
    // had happened, so this key was simply absent on every live turn.
    assert.ok(opts.responseFormat, 'responseFormat must be on the request that LEFT the process')
    assert.equal(opts.responseFormat.type, 'json_schema')
    assert.equal(opts.responseFormat.name, 'distill_with_answer_plan')
    assert.ok(opts.responseFormat.schema.required.includes('answerPlan'), 'the plan must be required, not optional')
  })
})

test('a turn that read NOTHING does not ask for a plan', async () => {
  await withEnv(async () => {
    const spy = spyAdapter(ENVELOPE_NO_PLAN)
    await processIntake('你好嗎？', spy, [], {
      demo: true,
      interactionMode: 'chat',
      providerHint: 'claude',
      readContextDeps: { connector: { async read () { return { asOf: NOW, source: 'aroma_system', count: 0, results: [] } } }, sources: ['aroma_system'] }
    })
    assert.equal(spy.calls[0].responseFormat, undefined, 'nothing is requested "just in case"')
  })
})

/* ── 2. THE PATH WAS ENTERED — the widened guarantee ──────────────────────── */

test('*** a turn that retrieved items MUST emit an [AROMA-ANSWER-PLAN] line ***', async () => {
  const { captured } = await withEnv(() => withLogCapture(() => run(spyAdapter(ENVELOPE_WITH_PLAN))))
  // NO LINE MEANS THE LAYER DID NOT RUN. That is a failure, not an absence of news — it
  // is precisely how three live turns used the old renderer without a trace.
  assert.equal(captured.length, 1, 'exactly one line per read turn')
  assert.equal(captured[0].event, 'ANSWER_PLAN')
  assert.equal(captured[0].outcome, 'validated')
  assert.equal(captured[0].reason, null)
})

test('*** the line is emitted for a FALLBACK too, with its reason ***', async () => {
  // Every sentence of the answer states a number the evidence cannot support.
  const bad = JSON.stringify({
    intent: 'chit_chat',
    mode: 'chat',
    reply: 'x',
    answerPlan: Object.assign({}, PLAN, { directAnswer: '有 4 項存貨。仲有 500 項低過安全存量。' })
  })
  const { captured, result } = await withEnv(() => withLogCapture(() => run(spyAdapter(bad))))
  assert.equal(captured.length, 1)
  assert.equal(captured[0].outcome, 'fallback')
  assert.equal(captured[0].reason, 'answer_unsupported')
  assert.equal(result.reply.includes('4 項存貨'), false, 'the unsupported claim never reaches the Owner')
  assert.ok(result.reply.includes('199'), 'the fallback states a measured count instead')
})

/* ── 3. THE RENDERED RESULT, through the real pipeline ────────────────────── */

test('*** the validated plan reaches the Owner — no template wording survives ***', async () => {
  await withEnv(async () => {
    const res = await run(spyAdapter(ENVELOPE_WITH_PLAN))
    assert.ok(res.reply.includes('餐廳系統有 199 項存貨記錄。'))
    assert.ok(res.reply.includes('現有 18.000'), 'currentStock must be shown')
    assert.ok(res.reply.includes('單位 ea'), 'unit must be shown')
    // the old template's wording and telemetry must all be gone
    for (const gone of ['目前確認到', '冇日期', '狀態未確認', '未列出', '長度上限']) {
      assert.equal(res.reply.includes(gone), false, `old renderer wording must not survive: ${gone}`)
    }
  })
})

test('the old path still serves a turn with no plan, and says so in the log', async () => {
  // A provider that ignores the schema is a real possibility. The turn still answers, and
  // the absence of a plan is recorded rather than passing for success.
  const { captured, result } = await withEnv(() => withLogCapture(() => run(spyAdapter(ENVELOPE_NO_PLAN))))
  assert.equal(captured.length, 1, 'even a plan-less read turn must leave a line')
  assert.equal(captured[0].outcome, 'fallback')
  assert.equal(captured[0].reason, 'no_plan_returned')
  assert.ok(result.reply.length > 0, 'the Owner still gets an answer')
})
