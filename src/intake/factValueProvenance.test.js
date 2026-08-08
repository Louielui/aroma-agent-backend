'use strict'

/**
 * factValueProvenance.test.js — the quantity is the server's, not the model's.
 *
 * ── THE FAILURE ──────────────────────────────────────────────────────────────
 * Live turn 0f8e7035. The answer was finally a judgement rather than a list, the items
 * rendered, and then:
 *
 *   outcome:"degraded" droppedFacts:6 modelItemCount:3 keptItemCount:3
 *   dropped: 3 items x {現有存量, 安全存量}
 *
 * Every NUMERIC fact was dropped and every non-numeric one survived, so the Owner saw
 * 分類 Produce / Dry Goods / Other and not one quantity — the single most useful thing on
 * the screen.
 *
 * WHAT THE EVIDENCE SHOWED. valueMatches IS on this path (answerPlan.js, in the fact loop),
 * and against the real row — currentStock '18.000', unit 'ea' — every plain form the model
 * might write passes: '18.000', '18', '18 ea', '18.0', '18.000 ea'. The rule was working.
 * The class that fails is a value carrying text that is not itself a row value, e.g.
 * 「現有 18.000」 or a unit the row does not hold. WHICH of those the model wrote is NOT
 * recoverable: the plan is not persisted, and the drop record carries no values by design.
 *
 * ── THE FIX, AND WHY IT IS NOT A RELAXATION ──────────────────────────────────
 * The matching rule is UNCHANGED — still normalized numeric equality, still no substring,
 * still no fuzzy match. What changes is who supplies the value at all.
 *
 * The title already works this way: "The title is the server's, not the model's: it cannot
 * be edited into something else." A quantity deserves the same treatment and for a stronger
 * reason — it is the fact most likely to be re-typed, and re-typing is what this whole
 * pipeline exists to stop. The EvidenceSet already carries the metric labels
 * (currentStock=現有存量, parLevel=安全存量), so when the model names a metric, the server
 * looks the value up in the ROW and renders that. The model chooses WHICH fact to show; it
 * no longer transcribes it.
 *
 * A wrong number is therefore CORRECTED rather than deleted, which is both safer than
 * trusting it and more useful than dropping it. Anything that is not a known metric still
 * goes through valueMatches exactly as before.
 *
 * Plus: the drop record now carries a value-free REASON, so the next value-level failure is
 * one log line instead of an investigation.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { validatePlan, logAnswerPlan } = require('./answerPlan')

const NOW = '2026-08-03T12:00:00.000Z'

/** The live row, exactly as the adapter builds it — UUID id, decimal strings, unit 'ea'. */
const ROW = {
  source: 'aroma_system',
  sourceId: '2786ce6e-4630-11f1-9220-42010a8a0002',
  title: 'Napa Cabbage',
  originalDate: null,
  entityType: 'inventory_item',
  content: 'id=2786ce6e-4630-11f1-9220-42010a8a0002 · name=Napa Cabbage · unit=ea · currentStock=18.000 · parLevel=75.000 · isPurchasable=1 · lifecycleStatus=active · subCategory=Produce',
  fields: {
    id: '2786ce6e-4630-11f1-9220-42010a8a0002',
    name: 'Napa Cabbage',
    unit: 'ea',
    currentStock: '18.000',
    parLevel: '75.000',
    isPurchasable: 1,
    lifecycleStatus: 'active',
    subCategory: 'Produce'
  },
  link: null,
  trust: 'live',
  error: null,
  retrievedAt: NOW
}

const EVIDENCE = {
  source: 'aroma_system',
  entityType: 'inventory_item',
  endpoint: 'inventory',
  rowShape: { hasLocation: false, hasAsOf: false, note: '每項有一個存量數字,但冇分地點' },
  // The same labels the SCOPE block puts in the prompt — which is where the model got
  // 「現有存量」 and 「安全存量」 as field names in the live turn.
  metrics: {
    currentStock: { label: '現有存量', meaning: '記錄存量,無地點、無時間戳' },
    parLevel: { label: '安全存量', meaning: '應該保持嘅水平' }
  },
  matchingTotal: 199,
  shownCount: 1,
  completeness: 'sample',
  rankedBy: 'parLevel - currentStock desc',
  selectedBy: 'ranked',
  usedFallback: false,
  retrievedAt: NOW,
  trust: 'live',
  provenance: 'Aroma System /api/v1/ai/inventory'
}

const ctx = () => ({ evidenceSets: [EVIDENCE], itemsBySource: [{ source: 'aroma_system', items: [ROW] }] })

const planWithFacts = (facts) => ({
  directAnswer: '餐廳系統有 199 項存貨記錄。',
  unanswerable: false,
  sections: [{ heading: '低於安全存量嘅物料', items: [{ sourceId: 'aroma_system#2786ce6e-4630-11f1-9220-42010a8a0002', title: 'Napa Cabbage', facts }] }],
  limitations: [],
  followUp: null
})
const factsOf = (facts) => {
  const v = validatePlan(planWithFacts(facts), ctx())
  const item = v.plan.sections[0] && v.plan.sections[0].items[0]
  return { facts: (item && item.facts) || [], dropped: v.droppedFacts, drops: v.drops }
}

/* ═══ THE QUANTITY COMES FROM THE ROW ═════════════════════════════════════════ */

test('*** THE LIVE FAILURE: a metric value the model mistyped is corrected, not deleted ***', () => {
  // 「18 個」 — a real number with a unit this row does not carry. Under the old behaviour
  // this was dropped and the Owner lost the quantity entirely.
  const r = factsOf([{ field: '現有存量', value: '18 個' }])
  assert.equal(r.dropped, 0, 'the quantity must not disappear')
  assert.equal(r.facts.length, 1)
  assert.equal(r.facts[0].value, '18.000', 'and it is the ROW\'s value, not the model\'s')
})

test('*** a metric value the model got WRONG is replaced by the row\'s ***', () => {
  // The strongest form of the rule: the model is not the source of a quantity at all, so a
  // wrong one cannot reach the Owner and cannot cost him the fact either.
  const r = factsOf([{ field: '現有存量', value: '999' }])
  assert.equal(r.facts[0].value, '18.000')
  assert.equal(r.dropped, 0)
})

test('*** both metrics survive — this is the six-drop turn ***', () => {
  const r = factsOf([
    { field: '現有存量', value: '現有 18.000' },
    { field: '安全存量', value: '安全 75.000' }
  ])
  assert.equal(r.dropped, 0)
  assert.deepEqual(r.facts, [{ field: '現有存量', value: '18.000' }, { field: '安全存量', value: '75.000' }])
})

test('a correctly transcribed metric is unchanged', () => {
  assert.equal(factsOf([{ field: '現有存量', value: '18.000' }]).facts[0].value, '18.000')
})

test('a metric the ROW does not carry is still dropped — nothing is invented', () => {
  // `content` IS STRIPPED TOO, and that is the point. This fixture used to replace `fields`
  // and leave `content` behind still reading currentStock=18.000 — a state the adapter
  // cannot produce, because toResult() builds `bits` and `fields` from the same
  // Object.entries(row). Once content became indexed evidence (2026-08-05, so a calendar
  // description could be cited at all) the stale content made the value verifiable and the
  // test failed. The rule is unchanged; the fixture was describing an impossible row.
  const bare = Object.assign({}, ROW, { fields: { name: 'Napa Cabbage', unit: 'ea' }, content: 'name=Napa Cabbage · unit=ea' })
  const v = validatePlan(planWithFacts([{ field: '現有存量', value: '18.000' }]),
    { evidenceSets: [EVIDENCE], itemsBySource: [{ source: 'aroma_system', items: [bare] }] })
  assert.equal(v.droppedFacts, 1, 'a label is not permission to produce a number')
})

/* ═══ EVERYTHING ELSE IS UNCHANGED — THE RULE IS NOT RELAXED ═════════════════ */

test('*** a non-metric fact still goes through valueMatches, unrelaxed ***', () => {
  assert.equal(factsOf([{ field: '分類', value: 'Produce' }]).facts.length, 1, 'a real row value passes')
  assert.equal(factsOf([{ field: '分類', value: 'Frozen' }]).dropped, 1, 'an invented one does not')
})

test('*** substring matching is still not the mechanism ***', () => {
  assert.equal(factsOf([{ field: '分類', value: 'Produ' }]).dropped, 1)
  assert.equal(factsOf([{ field: '單位', value: 'e' }]).dropped, 1)
})

test('a status enum still translates on the unchanged path', () => {
  assert.equal(factsOf([{ field: '狀態', value: 'active' }]).facts[0].value, '啟用中')
})

/* ═══ THE DROP RECORD SAYS WHY, WITHOUT SAYING WHAT ══════════════════════════ */

test('*** a dropped fact records a REASON, and now the value too ***', () => {
  // NARROWED, NOT REVERSED — Owner ruling 2026-08-05. The reason alone was not enough:
  // twice the honest answer to "did she invent it or write a variant?" was "I cannot tell
  // you", because the record described the rejection without describing what was rejected.
  // A SHORT, SPACELESS TOKEN now travels; anything longer or address/URL/path-shaped is
  // still described by shape and length only, so content cannot reach this record.
  const r = factsOf([{ field: '分類', value: 'Frozen' }])
  assert.equal(r.drops.length, 1)
  assert.equal(r.drops[0].kind, 'fact')
  assert.equal(r.drops[0].field, '分類')
  assert.ok(typeof r.drops[0].why === 'string' && r.drops[0].why.length > 0, 'why the match failed')
  assert.equal(r.drops[0].value, 'Frozen', 'the short token is what makes this diagnosable')
  assert.equal(r.drops[0].shape, 'short_token')
})

test('*** a long or spaced value is still shaped, never reproduced ***', () => {
  const r = factsOf([{ field: '備註', value: 'Frozen goods held at the back door' }])
  assert.equal(r.drops[0].value, undefined, 'no content in the record')
  assert.equal(r.drops[0].shape, 'text')
  assert.ok(Number.isFinite(r.drops[0].length))
})

test('the reason distinguishes the failure modes', () => {
  const why = (value) => factsOf([{ field: '分類', value }]).drops[0].why
  assert.equal(why('Frozen'), 'not_a_value', 'no number, and not a value the row holds')
  assert.equal(why('42'), 'number_not_in_row', 'a number this row never carried')
  assert.equal(why('18 個'), 'residue_not_a_value', 'right number, text the row does not hold')
  assert.equal(why('18 到 75'), 'multiple_numbers', 'a sentence, not a value')
})

test('*** the log line carries the reason, the shape, and a short value only ***', () => {
  const lines = []
  logAnswerPlan({
    outcome: 'degraded',
    droppedFacts: 1,
    drops: [{ kind: 'fact', sourceId: 'aroma_system#2786', field: '現有存量', why: 'residue_not_a_value', shape: 'short_token', length: 4, value: '18個' }]
  }, (l) => lines.push(l))
  const d = lines[0].dropped[0]
  assert.equal(d.why, 'residue_not_a_value')
  assert.equal(d.shape, 'short_token')
  assert.equal(d.value, '18個')
})

test('*** a value the describer refused never appears in the log either ***', () => {
  const lines = []
  logAnswerPlan({
    outcome: 'degraded',
    droppedFacts: 1,
    // No `value` key: describeValue withheld it. The projection must not invent one.
    drops: [{ kind: 'fact', sourceId: 'x', field: '備註', why: 'not_a_value', shape: 'text', length: 40 }]
  }, (l) => lines.push(l))
  assert.equal('value' in lines[0].dropped[0], false)
  assert.equal(lines[0].dropped[0].shape, 'text')
})

/* ═══ THROUGH THE REAL PIPELINE ══════════════════════════════════════════════ */

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

test('*** the quantities reach the Owner, and the turn is clean ***', async () => {
  const envelope = JSON.stringify({
    intent: 'chit_chat',
    mode: 'chat',
    reply: '睇咗。',
    answerPlan: planWithFacts([
      { field: '現有存量', value: '18 個' },
      { field: '安全存量', value: '75 個' }
    ])
  })
  const { result, captured } = await withEnv(() => withLogCapture(() => processIntake('而家倉存入面有咩？', spyAdapter(envelope), [], {
    demo: true,
    interactionMode: 'chat',
    providerHint: 'claude',
    readContextDeps: {
      connector: { async read () { return { asOf: NOW, source: 'aroma_system', count: 1, results: [ROW], evidence: EVIDENCE } } },
      sources: ['aroma_system']
    }
  })))
  assert.ok(result.reply.includes('現有存量 18.000'), 'THE DEFECT: the quantity must be on screen')
  assert.ok(result.reply.includes('安全存量 75.000'))
  assert.equal(result.reply.includes('核對唔到'), false, 'and there is nothing to apologise for')
  assert.equal(captured[0].outcome, 'validated')
  assert.equal(captured[0].droppedFacts, 0)
})
