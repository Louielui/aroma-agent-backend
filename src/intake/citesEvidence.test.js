'use strict'

/**
 * citesEvidence.test.js — a turn must be able to say IT NEEDS NO SECTIONS.
 *
 * ── THE LIVE FAILURE ─────────────────────────────────────────────────────────
 * The Owner asked 「你好, 你可以幫我做什麼?」 — a capability question, nothing to do with
 * inventory. READ_ACCESS reads regardless of what was asked, so rows came back, so the
 * Answer Plan schema was sent, and `sections.minItems:1` + `items.minItems:1` demanded at
 * least one item. The model had exactly one kind of row to offer and used it to describe
 * ITSELF:
 *
 *   outcome:"degraded" droppedFacts:3 modelItemCount:1 keptItemCount:1
 *   dropped: 角色 / 核心職責 / 工作風格  — all why:"not_a_value"
 *
 * On screen: 「### 我的職責」 followed by 「**Napa Cabbage**」, then
 * 「有 3 個數值核對唔到,冇顯示。」 on a turn that showed him nothing.
 *
 * Every layer did what it was told. The validator correctly refused three values that are
 * nowhere in the Napa Cabbage row. The renderer correctly used the SERVER's title, so the
 * model could not paper over it. THE SCHEMA WAS THE DEFECT: it required evidence from a
 * question that needed none.
 *
 * ── THE SHAPE ────────────────────────────────────────────────────────────────
 * `citesEvidence` makes "no sections" a DECLARATION rather than a silent empty array:
 *   true  → this answer cites retrieved rows; sections carry at least one item each
 *   false → this question needs no rows; sections must be empty
 *
 * minItems on `sections` is gone; minItems on a section's `items` stays, because an empty
 * section is a heading over nothing and that was its own earlier bug.
 *
 * ── AND THE COST, STATED ─────────────────────────────────────────────────────
 * `sections.minItems` was added when prose was checked for NOTHING but digits, and it was
 * the only thing stopping item detail from hiding there. That is no longer true:
 * proseIsGrounded and sentenceIsSupported now check names and numbers in prose. Removing
 * minItems shifts the guarantee onto them. Rule 7 below closes the remaining gap.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { validatePlan, ANSWER_PLAN_SCHEMA } = require('./answerPlan')

const NOW = '2026-08-03T12:00:00.000Z'

const ROW = {
  source: 'aroma_system',
  sourceId: '2786ce6e-4630-11f1-9220-42010a8a0002',
  title: 'Napa Cabbage',
  originalDate: null,
  entityType: 'inventory_item',
  content: 'id=2786ce6e · name=Napa Cabbage · unit=ea · currentStock=18.000 · parLevel=75.000',
  fields: { name: 'Napa Cabbage', unit: 'ea', currentStock: '18.000', parLevel: '75.000' },
  link: null,
  trust: 'live',
  error: null,
  retrievedAt: NOW
}
const REF = 'aroma_system#2786ce6e-4630-11f1-9220-42010a8a0002'

const EVIDENCE = {
  source: 'aroma_system',
  entityType: 'inventory_item',
  endpoint: 'inventory',
  scope: { hasLocation: false, hasAsOf: false, note: '每項有一個存量數字,但冇分地點' },
  metrics: { currentStock: { label: '現有存量' }, parLevel: { label: '安全存量' } },
  totalCount: 199,
  shownCount: 1,
  completeness: 'sample',
  rankedBy: 'parLevel - currentStock desc',
  selectedBy: 'ranked',
  usedFallback: false,
  retrievedAt: NOW,
  trust: 'live',
  provenance: 'Aroma System /api/v1/ai/inventory'
}

const ctx = (message) => ({ evidenceSets: [EVIDENCE], itemsBySource: [{ source: 'aroma_system', items: [ROW] }], message })

function spyAdapter (responseText) {
  const calls = []
  return {
    calls,
    async complete (prompt, opts = {}) {
      calls.push({ prompt: String(prompt), opts })
      return { text: responseText, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'spy', latencyMs: 1 }
    }
  }
}
async function withLogCapture (fn) {
  const captured = []
  const original = console.log
  console.log = (...a) => { if (a[0] === '[AROMA-ANSWER-PLAN]') { try { captured.push(JSON.parse(a[1])) } catch (_) {} } }
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
const envelope = (plan) => JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '好。', answerPlan: plan })
const run = (adapter, message) => processIntake(message, adapter, [], {
  demo: true,
  interactionMode: 'chat',
  providerHint: 'claude',
  readContextDeps: {
    connector: { async read () { return { asOf: NOW, source: 'aroma_system', count: 1, results: [ROW], evidence: EVIDENCE } } },
    sources: ['aroma_system']
  }
})

/* ═══ 1. THE OUTBOUND SCHEMA ══════════════════════════════════════════════════ */

test('*** the schema no longer demands a section, and declares the choice instead ***', async () => {
  await withEnv(async () => {
    const spy = spyAdapter(envelope({ directAnswer: '我係你嘅 AI 營運長。', citesEvidence: false, sections: [], limitations: [], followUp: null, unanswerable: false }))
    await run(spy, '你好, 你可以幫我做什麼?')
    const sections = spy.calls[0].opts.responseFormat.schema.properties.answerPlan.properties.sections
    assert.equal(sections.minItems, undefined, 'THE DEFECT: a section was mandatory even when the question needed none')
    assert.equal(sections.items.properties.items.minItems, 1, 'but a section that EXISTS still may not be an empty heading')
    const req = spy.calls[0].opts.responseFormat.schema.properties.answerPlan.required
    assert.ok(req.includes('citesEvidence'), 'the declaration is required, not optional')
  })
})

test('the static schema agrees with what goes out', () => {
  assert.equal(ANSWER_PLAN_SCHEMA.properties.sections.minItems, undefined)
  assert.equal(ANSWER_PLAN_SCHEMA.properties.sections.items.properties.items.minItems, 1)
  assert.ok(ANSWER_PLAN_SCHEMA.required.includes('citesEvidence'))
  assert.equal(ANSWER_PLAN_SCHEMA.properties.citesEvidence.type, 'boolean')
})

/* ═══ 2. THE LIVE TURN, AS IT SHOULD NOW BEHAVE ═══════════════════════════════ */

test('*** THE LIVE FAILURE: a capability question renders no rows and no omission note ***', async () => {
  const plan = {
    directAnswer: '我係你嘅 AI 營運長,負責理解、判斷、建議同協調。',
    citesEvidence: false,
    sections: [],
    limitations: [],
    followUp: null,
    unanswerable: false
  }
  const { result, captured } = await withEnv(() => withLogCapture(() => run(spyAdapter(envelope(plan)), '你好, 你可以幫我做什麼?')))
  assert.equal(result.reply.includes('Napa Cabbage'), false, 'no inventory row may be conscripted to describe her')
  assert.equal(result.reply.includes('核對唔到'), false, 'and nothing was withheld, so nothing is announced')
  assert.equal(captured[0].outcome, 'validated', 'a clean turn, not a degraded one')
  assert.equal(captured[0].droppedFacts, 0)
  assert.equal(captured[0].modelItemCount, 0)
})

/* ═══ 3. THE DECLARATION IS ENFORCED BOTH WAYS ════════════════════════════════ */

test('*** citesEvidence:false with sections supplied — the sections are dropped and logged ***', async () => {
  const plan = {
    directAnswer: '我係你嘅 AI 營運長。',
    citesEvidence: false,
    sections: [{ heading: '我的職責', items: [{ sourceId: REF, title: 'x', facts: [{ field: '角色', value: 'AI 營運長' }] }] }],
    limitations: [],
    followUp: null,
    unanswerable: false
  }
  const { result, captured } = await withEnv(() => withLogCapture(() => run(spyAdapter(envelope(plan)), '你好, 你可以幫我做什麼?')))
  assert.equal(result.reply.includes('Napa Cabbage'), false)
  assert.equal(captured[0].outcome, 'degraded')
  assert.equal(captured[0].reason, 'sections_not_declared')
})

test('citesEvidence:true with nothing provable still falls back exactly as before', async () => {
  const plan = {
    directAnswer: '餐廳系統有 199 項存貨記錄。',
    citesEvidence: true,
    sections: [{ heading: '缺口', items: [{ sourceId: 'aroma_system', title: 'x', facts: [] }] }],
    limitations: [],
    followUp: null,
    unanswerable: false
  }
  const { captured, result } = await withEnv(() => withLogCapture(() => run(spyAdapter(envelope(plan)), '倉存有咩？')))
  assert.equal(captured[0].outcome, 'fallback')
  assert.equal(captured[0].reason, 'items_unsupported')
  assert.ok(result.reply.includes('199'))
})

/* ═══ 4. THE OMISSION NOTE ════════════════════════════════════════════════════ */

test('*** the omission note appears ONLY when something was actually shown ***', () => {
  // Nothing rendered => the line is noise. It reached the Owner on a turn that displayed
  // no data at all, which is what made it meaningless to him.
  const none = validatePlan({
    directAnswer: '我係你嘅 AI 營運長。',
    citesEvidence: false,
    sections: [{ heading: 'x', items: [{ sourceId: 'ghost', title: 'y', facts: [] }] }],
    limitations: [], followUp: null, unanswerable: false
  }, ctx('你好'))
  assert.equal(none.keptItemCount, 0, 'nothing survived')

  const some = validatePlan({
    directAnswer: '餐廳系統有 199 項存貨記錄。',
    citesEvidence: true,
    sections: [{ heading: '缺口', items: [{ sourceId: REF, title: 'x', facts: [{ field: '單位', value: 'ea' }, { field: '亂噏', value: '唔存在嘅值' }] }] }],
    limitations: [], followUp: null, unanswerable: false
  }, ctx('倉存有咩？'))
  assert.equal(some.keptItemCount, 1, 'something IS shown here, so an omission beside it is worth saying')
  assert.equal(some.droppedFacts, 1)
})

/* ═══ 5. RULE 7 AND THE OWNER'S CARVE-OUT ═════════════════════════════════════ */

test('*** citesEvidence:false may not name a retrieved row in prose ***', () => {
  const v = validatePlan({
    directAnswer: '我幫到你睇 Napa Cabbage 嘅存量。',
    citesEvidence: false,
    sections: [], limitations: [], followUp: null, unanswerable: false
  }, ctx('你好, 你可以幫我做什麼?'))
  assert.equal(v.plan.directAnswer.includes('Napa Cabbage'), false, 'not citing evidence means not naming rows')
  assert.equal(v.droppedSentences, 1)
})

test('*** THE CARVE-OUT: a title the Owner himself typed is not laundering ***', () => {
  // He already knows the name — he wrote it. Deleting her sentence for echoing his own
  // words would be absurd, and would make 「Napa Cabbage 點解咁少?」 unanswerable.
  const v = validatePlan({
    directAnswer: 'Napa Cabbage 而家爭得好遠。',
    citesEvidence: false,
    sections: [], limitations: [], followUp: null, unanswerable: false
  }, ctx('Napa Cabbage 點解咁少?'))
  assert.ok(v.plan.directAnswer.includes('Napa Cabbage'), 'echoing the Owner is not laundering')
  assert.equal(v.droppedSentences, 0)
})

test('the carve-out is not a blanket pass — an UNMENTIONED row is still barred', () => {
  const v = validatePlan({
    directAnswer: 'Napa Cabbage 而家爭得好遠。',
    citesEvidence: false,
    sections: [], limitations: [], followUp: null, unanswerable: false
  }, ctx('Peanut Butter 點呀?'))
  assert.equal(v.plan.directAnswer.includes('Napa Cabbage'), false)
})

test('citesEvidence:true is unaffected by rule 7 — naming a row it cites is the point', () => {
  const v = validatePlan({
    directAnswer: 'Napa Cabbage 爭得最遠。',
    citesEvidence: true,
    sections: [{ heading: '缺口', items: [{ sourceId: REF, title: 'x', facts: [{ field: '單位', value: 'ea' }] }] }],
    limitations: [], followUp: null, unanswerable: false
  }, ctx('倉存有咩？'))
  assert.ok(v.plan.directAnswer.includes('Napa Cabbage'))
  assert.equal(v.droppedSentences, 0)
})

/* ═══ 6. REGRESSION: a real inventory question still works ════════════════════ */

test('*** an inventory question still renders real data ***', async () => {
  const plan = {
    directAnswer: '餐廳系統有 199 項存貨記錄。',
    citesEvidence: true,
    sections: [{ heading: '缺口最大', items: [{ sourceId: REF, title: 'x', facts: [{ field: '現有存量', value: '18.000' }, { field: '安全存量', value: '75.000' }] }] }],
    limitations: [], followUp: null, unanswerable: false
  }
  const { result, captured } = await withEnv(() => withLogCapture(() => run(spyAdapter(envelope(plan)), '而家倉存入面有咩？')))
  assert.ok(result.reply.includes('Napa Cabbage'), 'as DATA this time, not as a personality description')
  assert.ok(result.reply.includes('現有存量 18.000'))
  assert.equal(captured[0].outcome, 'validated')
  assert.equal(captured[0].keptItemCount, 1)
})
