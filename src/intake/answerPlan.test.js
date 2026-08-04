'use strict'

/**
 * answerPlan.test.js — the model says what the answer is; these prove the server checks it.
 *
 * The six behaviours the Owner named, plus the one he added as a condition: a fallback
 * cannot happen without a log line. Silent degradation is the thing being eliminated, so
 * its absence has to be provable rather than intended.
 *
 * Pure module: no adapter, no network, no paid call.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  ANSWER_PLAN_SCHEMA, validatePlan, parsePlan, minimalAnswer, logAnswerPlan,
  evidenceIndex, translate, sentenceIsSupported, STATUS_LABELS, LIMITS
} = require('./answerPlan')

const NOW = '2026-08-03T12:00:00.000Z'

/* ── fixtures: the Owner's three real questions ───────────────────────────── */

const INVENTORY_EVIDENCE = {
  source: 'aroma_system',
  entityType: 'inventory_item',
  endpoint: 'inventory',
  scope: { hasLocation: false, hasAsOf: false, note: '每項有一個存量數字,但冇分地點、亦冇記錄係幾時嘅' },
  metrics: { currentStock: { label: '現有存量' }, parLevel: { label: '安全存量' } },
  totalCount: 199,
  shownCount: 2,
  completeness: 'sample',
  rankedBy: 'parLevel - currentStock desc',
  selectedBy: 'ranked',
  usedFallback: false,
  retrievedAt: NOW,
  trust: 'live',
  provenance: 'Aroma System /api/v1/ai/inventory'
}
const INVENTORY_ITEMS = {
  source: 'aroma_system',
  items: [
    { source: 'aroma_system', sourceId: '2', title: 'Onion', originalDate: null, entityType: 'inventory_item', fields: { name: 'Onion', unit: 'kg', currentStock: 2, parLevel: 20 } },
    { source: 'aroma_system', sourceId: '1', title: 'Aioli Base', originalDate: null, entityType: 'inventory_item', fields: { name: 'Aioli Base', unit: 'L', currentStock: 0, parLevel: 5 } }
  ]
}

const SUPPLIER_EVIDENCE = Object.assign({}, INVENTORY_EVIDENCE, {
  entityType: 'supplier', endpoint: 'suppliers', totalCount: 36, shownCount: 1,
  rankedBy: null, selectedBy: 'api_order', metrics: {},
  scope: { hasLocation: false, hasAsOf: false, note: null }
})
const SUPPLIER_ITEMS = {
  source: 'aroma_system',
  items: [{ source: 'aroma_system', sourceId: 's1', title: 'A&B Foods', originalDate: null, entityType: 'supplier', fields: { name: 'A&B Foods', status: 'active', deliveryDays: 'Mon' } }]
}

const ctx = (evidence, items) => ({ evidenceSets: [evidence], itemsBySource: [items] })

/* ── 1. item-master vs real inventory ─────────────────────────────────────── */

test('*** a stock claim the evidence cannot support is removed ***', () => {
  // 199 and 2 are measured. 500 is not — and 「4 項存貨」 was exactly this defect.
  const r = validatePlan({
    directAnswer: '餐廳系統有 199 項存貨記錄。其中 500 項低過安全存量。',
    sections: [], limitations: [], followUp: null, unanswerable: false
  }, ctx(INVENTORY_EVIDENCE, INVENTORY_ITEMS))
  assert.equal(r.plan.directAnswer, '餐廳系統有 199 項存貨記錄。')
  assert.equal(r.droppedSentences, 1)
})

test('the scope note travels with the evidence, so an answer can state it', () => {
  assert.equal(INVENTORY_EVIDENCE.scope.hasLocation, false)
  assert.equal(INVENTORY_EVIDENCE.scope.hasAsOf, false)
  assert.ok(INVENTORY_EVIDENCE.scope.note.includes('冇分地點'))
  // and a plan that says so passes untouched — it carries no unmeasured number
  const r = validatePlan({
    directAnswer: '每項有一個存量數字,但冇分地點、亦冇記錄係幾時嘅。',
    sections: [], limitations: [], followUp: null, unanswerable: false
  }, ctx(INVENTORY_EVIDENCE, INVENTORY_ITEMS))
  assert.equal(r.droppedSentences, 0)
  assert.ok(r.plan.directAnswer.includes('冇分地點'))
})

/* ── 2. sample vs total ───────────────────────────────────────────────────── */

test('*** shownCount may never be presented as totalCount ***', () => {
  const i = evidenceIndex([INVENTORY_EVIDENCE], [INVENTORY_ITEMS])
  assert.ok(i.numbers.has('199'), 'the real total is stateable')
  assert.ok(i.numbers.has('2'), 'so is the shown count')

  // THE CASE THAT ACTUALLY SHIPPED. This test used to assert the ASCII form ONLY, so it
  // passed while the live failure walked straight through: 「系統讀到三項倉存記錄」 reached
  // the Owner against a real total of 199, and droppedSentences was 0. A count written in
  // Chinese numerals is the NORMAL way this assistant writes one — the digit form is the
  // exception, and pinning only the exception is what gave three rounds of false confidence.
  assert.equal(sentenceIsSupported('系統讀到三項倉存記錄。', i), false, 'THE LIVE FAILURE')
  assert.equal(sentenceIsSupported('有四項存貨。', i), false)
  assert.equal(sentenceIsSupported('有兩張發票。', i), true, 'shownCount is 2 — that one is measured')

  // and the ASCII form stays pinned, because both spellings must be checked
  assert.equal(sentenceIsSupported('有 4 項存貨。', i), false)
  assert.equal(sentenceIsSupported('有 199 項存貨記錄。', i), true)
  assert.equal(sentenceIsSupported('有一百九十九項存貨記錄。', i), true, 'the same number, the other spelling')
})

/* ── 3. supplier status translation ───────────────────────────────────────── */

test('*** active → 啟用中, and a raw enum never reaches the screen ***', () => {
  assert.equal(translate('active'), '啟用中')
  assert.equal(translate('inactive'), '已停用')
  assert.equal(translate('needs_review'), '需要審批')
  const r = validatePlan({
    directAnswer: '餐廳系統有 36 個供應商。',
    sections: [{ heading: '供應商', items: [{ sourceId: 's1', title: 'A&B Foods', facts: [{ field: '狀態', value: 'active' }] }] }],
    limitations: [], followUp: null, unanswerable: false
  }, ctx(SUPPLIER_EVIDENCE, SUPPLIER_ITEMS))
  const fact = r.plan.sections[0].items[0].facts[0]
  assert.equal(fact.value, '啟用中')
  assert.equal(JSON.stringify(r.plan).includes('active'), false, 'no raw enum survives anywhere')
})

/* ── 4. diagnostics never reach the Owner ─────────────────────────────────── */

test('*** internal telemetry is stripped from every field it can appear in ***', () => {
  const r = validatePlan({
    directAnswer: '搵到嘢。另有 13 項未列出。',
    sections: [],
    limitations: ['部分項目因長度上限未顯示', '另有 7 項未列出（判斷為與此問題無關）', 'Gmail 讀唔到'],
    followUp: null, unanswerable: false
  }, ctx(INVENTORY_EVIDENCE, INVENTORY_ITEMS))
  assert.equal(r.plan.directAnswer.includes('未列出'), false)
  assert.equal(r.plan.limitations.some((l) => /未列出|長度上限/.test(l)), false)
  assert.deepEqual(r.plan.limitations, ['Gmail 讀唔到'], 'a REAL limitation survives')
})

/* ── 5. clarification instead of a false answer ───────────────────────────── */

test('*** unanswerable is carried through, with no fabricated sections ***', () => {
  const r = validatePlan({
    directAnswer: '每項有一個存量數字,但冇分地點、亦冇記錄係幾時嘅。',
    sections: [], limitations: [], followUp: '要唔要改為睇最近盤點?', unanswerable: true
  }, ctx(INVENTORY_EVIDENCE, INVENTORY_ITEMS))
  assert.equal(r.plan.unanswerable, true)
  assert.deepEqual(r.plan.sections, [])
  assert.equal(r.plan.followUp, '要唔要改為睇最近盤點?')
})

test('an item that was never retrieved is an invention and is dropped', () => {
  const r = validatePlan({
    directAnswer: '睇到。',
    sections: [{ heading: 'x', items: [{ sourceId: 'ghost', title: '唔存在嘅嘢', facts: [] }] }],
    limitations: [], followUp: null, unanswerable: false
  }, ctx(INVENTORY_EVIDENCE, INVENTORY_ITEMS))
  assert.deepEqual(r.plan.sections, [], 'a section with no real items is not a section')
  // COUNTED AS AN ITEM, NOT AS A FACT. This assertion used to read `droppedFacts, 1`, and
  // that conflation is what sent the live diagnosis after the wrong defect: the screen was
  // empty because whole ITEMS were inventions, not because their values failed a check.
  assert.equal(r.droppedItems, 1)
  assert.equal(r.droppedFacts, 0, 'no fact was even reached — the row did not exist')
  assert.deepEqual(r.drops, [{ kind: 'item', sourceId: 'ghost' }], 'and WHICH item is on the record')
  assert.equal(r.keptItemCount, 0)
  assert.equal(r.modelItemCount, 1, 'the model offered content; none of it was real')
})

test('the title comes from the row, not from the model', () => {
  const r = validatePlan({
    directAnswer: '睇到。',
    sections: [{ heading: 'x', items: [{ sourceId: '2', title: '改咗個名', facts: [] }] }],
    limitations: [], followUp: null, unanswerable: false
  }, ctx(INVENTORY_EVIDENCE, INVENTORY_ITEMS))
  assert.equal(r.plan.sections[0].items[0].title, 'Onion')
})

test('a fact value that is not a real value is dropped', () => {
  const r = validatePlan({
    directAnswer: '睇到。',
    sections: [{ heading: 'x', items: [{ sourceId: '2', title: 'Onion', facts: [{ field: '現有', value: '2' }, { field: '假嘢', value: '999' }] }] }],
    limitations: [], followUp: null, unanswerable: false
  }, ctx(INVENTORY_EVIDENCE, INVENTORY_ITEMS))
  assert.deepEqual(r.plan.sections[0].items[0].facts, [{ field: '現有', value: '2' }])
  assert.equal(r.droppedFacts, 1)
})

/* ── 6. the follow-up is optional, and never two options ──────────────────── */

test('*** no followUp means the answer ends without a question ***', () => {
  const r = validatePlan({ directAnswer: '睇到。', sections: [], limitations: [], followUp: null, unanswerable: false },
    ctx(INVENTORY_EVIDENCE, INVENTORY_ITEMS))
  assert.equal(r.plan.followUp, null)
})

test('two options collapse to the first question; prose with none becomes null', () => {
  const r = validatePlan({ directAnswer: '睇到。', sections: [], limitations: [], followUp: '要列全部? 定係只列缺貨?', unanswerable: false },
    ctx(INVENTORY_EVIDENCE, INVENTORY_ITEMS))
  assert.equal(r.plan.followUp, '要列全部?')
  const r2 = validatePlan({ directAnswer: '睇到。', sections: [], limitations: [], followUp: '好喇。', unanswerable: false },
    ctx(INVENTORY_EVIDENCE, INVENTORY_ITEMS))
  assert.equal(r2.plan.followUp, null, 'a statement is not a question')
})

/* ── 7. THE FALLBACK LADDER, AND ITS LOG ──────────────────────────────────── */

test('parsePlan names why it failed, for every way a model can miss', () => {
  assert.equal(parsePlan('').reason, 'empty_response')
  assert.equal(parsePlan('我覺得倉存好緊張').reason, 'not_json')
  assert.equal(parsePlan('[1,2]').reason, 'not_an_object')
  assert.equal(parsePlan('{"sections":[]}').reason, 'missing_direct_answer')
  assert.equal(parsePlan('{"directAnswer":"ok"}').ok, true)
  // a fenced object still parses — a provider that ignores the schema may still fence
  assert.equal(parsePlan('```json\n{"directAnswer":"ok"}\n```').ok, true)
})

test('*** the minimal answer is a count and provenance — NEVER arbitrary rows ***', () => {
  const m = minimalAnswer([INVENTORY_EVIDENCE])
  assert.ok(m.includes('199'))
  assert.ok(m.includes('餐廳系統'))
  assert.equal(m.includes('Onion'), false, 'no rows may leak into a fallback')
  assert.equal(m.includes('Aioli'), false)
  assert.ok(/組唔到|讀唔到/.test(m), 'it says plainly that it could not answer')
  assert.equal(minimalAnswer([]), '我今次讀唔到可以用嚟答呢條問題嘅資料。')
})

test('*** a fallback CANNOT occur without a log line ***', () => {
  // The Owner's condition: silent degradation must be provably impossible, not merely
  // intended. Every failure reason routes through logAnswerPlan, and the line carries the
  // reason as an enum — enough to count and to diagnose, never the plan or a row.
  const lines = []
  const sink = (l) => lines.push(l)
  const REASONS = ['empty_response', 'not_json', 'not_an_object', 'missing_direct_answer', 'answer_unsupported', 'schema_rejected', 'adapter_error']
  for (const reason of REASONS) logAnswerPlan({ outcome: 'fallback', reason, provider: 'openai', requestId: 'r1' }, sink)
  assert.equal(lines.length, REASONS.length)
  for (const l of lines) {
    assert.equal(l.event, 'ANSWER_PLAN')
    assert.equal(l.outcome, 'fallback')
    assert.ok(l.reason, 'a fallback with no reason is not diagnosable')
    assert.ok(l.timestamp)
  }
  assert.deepEqual(lines.map((l) => l.reason), REASONS)
})

test('the log carries counts, enums and drop IDENTITY — never a value', () => {
  const lines = []
  logAnswerPlan({
    outcome: 'degraded',
    reason: 'partial_drop',
    provider: 'claude',
    droppedItems: 1,
    droppedFacts: 2,
    droppedSentences: 1,
    modelItemCount: 3,
    keptItemCount: 2,
    // A drop record as the validator emits it, plus a value-shaped key that must NOT ride
    // through: the projection is explicit, not a spread.
    drops: [{ kind: 'item', sourceId: 'ghost' }, { kind: 'fact', sourceId: '2', field: '現有', value: '18.000' }],
    requestId: 'r2'
  }, (l) => lines.push(l))
  const l = lines[0]
  assert.deepEqual(Object.keys(l).sort(),
    ['dropped', 'droppedFacts', 'droppedItems', 'droppedSentences', 'event', 'keptItemCount', 'modelItemCount', 'outcome', 'provider', 'reason', 'requestId', 'timestamp'])
  assert.equal(l.modelItemCount, 3)
  assert.equal(l.keptItemCount, 2)
  assert.equal(l.droppedItems, 1)
  assert.equal(l.droppedFacts, 2)
  assert.equal(l.droppedSentences, 1)
  assert.deepEqual(l.dropped, [{ kind: 'item', sourceId: 'ghost' }, { kind: 'fact', sourceId: '2', field: '現有' }])
  // THE WIDENING IS BOUNDED. Identity travels; row content still does not.
  assert.equal(JSON.stringify(l).includes('18.000'), false, 'a VALUE must never reach the log')
})

test('the drop record cannot be turned into a payload by a long or repetitive plan', () => {
  const lines = []
  const many = Array.from({ length: 40 }, (_, i) => ({ kind: 'fact', sourceId: 'x'.repeat(200), field: 'f'.repeat(200) + i }))
  logAnswerPlan({ outcome: 'degraded', droppedFacts: 40, drops: many }, (l) => lines.push(l))
  const l = lines[0]
  assert.equal(l.dropped.length, LIMITS.maxDropsLogged, 'the array is bounded')
  assert.equal(l.dropped[0].sourceId.length, LIMITS.maxDropIdChars, 'and so is each identifier')
  assert.equal(l.dropped[0].field.length, LIMITS.maxDropIdChars)
})

test('a directAnswer that loses every sentence does not stand as an answer', () => {
  const r = validatePlan({ directAnswer: '有 4 項存貨。仲有 500 項。', sections: [], limitations: [], followUp: null, unanswerable: false },
    ctx(INVENTORY_EVIDENCE, INVENTORY_ITEMS))
  assert.equal(r.answerSurvived, false)
  assert.equal(r.plan.directAnswer, '')
})

/* ── 8. the schema is enforceable, not advisory ───────────────────────────── */

test('the schema closes every object so nothing can be smuggled past the validator', () => {
  const closed = (node) => {
    if (!node || typeof node !== 'object') return true
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, 'every object must close')
      for (const v of Object.values(node.properties || {})) closed(v)
    }
    if (node.type === 'array') closed(node.items)
    return true
  }
  closed(ANSWER_PLAN_SCHEMA)
  assert.deepEqual(ANSWER_PLAN_SCHEMA.required.sort(), ['directAnswer', 'followUp', 'limitations', 'sections', 'unanswerable'])
})

test('length rules are bounded by the server, not by the model behaving', () => {
  const many = Array.from({ length: 12 }, () => ({ sourceId: '2', title: 'Onion', facts: [] }))
  const r = validatePlan({
    directAnswer: '睇到。',
    sections: [{ heading: 'x', items: many }, { heading: 'y', items: many }, { heading: 'z', items: many }, { heading: 'w', items: many }, { heading: 'v', items: many }],
    limitations: ['a', 'b', 'c', 'd', 'e'], followUp: null, unanswerable: false
  }, ctx(INVENTORY_EVIDENCE, INVENTORY_ITEMS))
  assert.equal(r.plan.sections.length, LIMITS.maxSections)
  for (const s of r.plan.sections) assert.equal(s.items.length, LIMITS.maxItemsPerSection)
  assert.ok(r.plan.limitations.length <= LIMITS.maxLimitations)
})

/* ── 9. MULTI-SOURCE — mandatory ──────────────────────────────────────────── */

test('*** validation holds with several sources present at once ***', () => {
  const gmailEvidence = { source: 'gmail', entityType: 'mail', totalCount: null, shownCount: 1, trust: 'live', completeness: 'unknown', usedFallback: true, selectedBy: 'recency', retrievedAt: NOW }
  const gmailItems = { source: 'gmail', items: [{ source: 'gmail', sourceId: 'm1', title: 'Invoice Report', originalDate: 'Sun, 3 Aug 2026 09:14:02 -0500', entityType: 'mail', fields: { subject: 'Invoice Report' } }] }
  const r = validatePlan({
    directAnswer: '餐廳系統有 199 項存貨記錄。',
    sections: [
      { heading: '餐廳系統', items: [{ sourceId: '2', title: 'Onion', facts: [{ field: '現有', value: '2' }] }] },
      { heading: 'Gmail', items: [{ sourceId: 'm1', title: 'Invoice Report', facts: [{ field: '主旨', value: 'Invoice Report' }] }] },
      { heading: '捏造', items: [{ sourceId: 'nope', title: 'x', facts: [] }] }
    ],
    limitations: [], followUp: null, unanswerable: false
  }, { evidenceSets: [INVENTORY_EVIDENCE, gmailEvidence], itemsBySource: [INVENTORY_ITEMS, gmailItems] })
  assert.equal(r.plan.sections.length, 2, 'the fabricated section is gone, the two real ones stay')
  assert.deepEqual(r.plan.sections.map((s) => s.heading), ['餐廳系統', 'Gmail'])
  assert.equal(r.plan.sections[1].items[0].facts[0].value, 'Invoice Report')
})
