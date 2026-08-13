'use strict'

/**
 * answerPlanEvidence.test.js — the four defects found in the 2026-08-03 diagnosis.
 *
 * WHAT WENT WRONG, IN ONE PARAGRAPH. A live turn logged
 * `outcome:"validated" droppedFacts:3 droppedSentences:0` and put ZERO rows on screen while
 * claiming 「系統讀到三項倉存記錄」 against a real total of 199, and then listed a limitation
 * (「無法確認呢啲係唯一嘅倉存項目」) that was not true — the count WAS known. Four separate
 * defects produced that one screen:
 *
 *   1. The EvidenceSet was computed, and validated against, but NEVER SERIALIZED into the
 *      prompt. The model could not state 199 because it was never shown 199; the only count
 *      available to it was the number of lines it could see. The scope note that says this
 *      data has no location and no as-of timestamp sat in SCOPE_OF and never left the process.
 *   2. A fact value was compared by STRICT STRING EQUALITY, so a correct 「18」 or 「18 ea」
 *      was deleted because the evidence holds 「18.000」.
 *   3. sentenceIsSupported matched only /\d+/, so 「三項」 carried no digit, had nothing to
 *      check, and passed vacuously. The test that claimed to pin this used ASCII 「4 項」.
 *   4. droppedFacts was ONE counter for TWO different failures (an unproven fact, and a whole
 *      item whose sourceId does not exist), it recorded no identity for either, and a section
 *      that lost all its items vanished — heading included — while the outcome still read
 *      "validated".
 *
 * These tests assert at the two boundaries a stub cannot fake: WHAT LEAVES THE PROCESS (the
 * prompt string handed to the adapter) and WHAT REACHES THE LOG.
 *
 * No network, no paid call: the adapter is a spy and the connector is a fake.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { validatePlan, sentenceIsSupported, evidenceIndex, logAnswerPlan } = require('./answerPlan')

const NOW = '2026-08-03T12:00:00.000Z'

/* ── fixtures shaped like the live rows ───────────────────────────────────── */

const row = (id, name, stock, par) => ({
  source: 'aroma_system',
  sourceId: String(id),
  title: name,
  originalDate: null,
  entityType: 'inventory_item',
  content: `id=${id} · name=${name} · unit=ea · currentStock=${stock} · parLevel=${par}`,
  fields: { id, name, unit: 'ea', currentStock: stock, parLevel: par },
  link: null,
  trust: 'live',
  error: null,
  retrievedAt: NOW
})

const ROWS = [row(2, 'Napa Cabbage', '18.000', '75.000')]

const INVENTORY_EVIDENCE = {
  source: 'aroma_system',
  entityType: 'inventory_item',
  endpoint: 'inventory',
  // MIGRATED FOR A1: `scope` split into rowShape (what a row carries) and queryScope (which
  // rows were selected); `totalCount` replaced by matchingTotal + sourceTotal, because the one
  // field could not say which of the two numbers it held.
  rowShape: { hasLocation: false, hasAsOf: false, note: '每項有一個存量數字,但冇分地點、亦冇記錄係幾時嘅' },
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  filtersApplied: [],
  limit: null,
  truncated: null,
  completeWithinScope: null,
  dataAsOf: null,
  metrics: {
    currentStock: { label: '現有存量', meaning: '記錄存量,無地點、無時間戳' },
    parLevel: { label: '安全存量', meaning: '應該保持嘅水平' }
  },
  matchingTotal: 199,
  sourceTotal: null,
  returnedRows: 199,
  shownCount: 1,
  completeness: 'sample',
  rankedBy: 'parLevel - currentStock desc',
  selectedBy: 'ranked',
  usedFallback: false,
  retrievedAt: NOW,
  trust: 'live',
  provenance: 'Aroma System /api/v1/ai/inventory'
}

function fakeConnector (rows = ROWS, evidence = INVENTORY_EVIDENCE) {
  return {
    async read () {
      return {
        asOf: NOW,
        source: 'aroma_system',
        count: rows.length,
        results: rows,
        evidence: Object.assign({}, evidence, { shownCount: rows.length })
      }
    }
  }
}

/** Records the PROMPT and the opts of every adapter call — what LEFT the process. */
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

// ⛔ A4_KNOWLEDGE_ROUTING:'off' ADDED — these tests assert the AUTOMATIC-READ contract.
// A4-1 deliberately takes read initiation away from the keyword route: with A4 on, the turn
// reaches the model with zero rows and the model must ASK for the read. These suites script
// adapters that answer directly, so under A4 on they correctly read nothing — the contract
// they pin is the A4-off one, which remains a supported rollback and must stay provable.
// Same reasoning, and same recorded cost, as the TURN_ROUTER:'off' pins already here.
const FLAGS = { A4_KNOWLEDGE_ROUTING: 'off', READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on' }
async function withEnv (fn) {
  const saved = {}
  for (const k of Object.keys(FLAGS)) { saved[k] = process.env[k]; process.env[k] = FLAGS[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(FLAGS)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const envelope = (plan) => JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '睇咗。', answerPlan: plan })

const run = (adapter, connector = fakeConnector()) => processIntake('而家倉存入面有咩？', adapter, [], {
  demo: true,
  interactionMode: 'chat',
  providerHint: 'claude',
  readContextDeps: { connector, sources: ['aroma_system'] }
})

const PLAN = {
  directAnswer: '餐廳系統有 199 項存貨記錄。',
  unanswerable: false,
  sections: [{ heading: '缺貨狀況' /* not 缺口最大 — that is a ranking claim now (task 001) */, items: [{ sourceId: '2', title: 'Napa Cabbage', facts: [{ field: '現有', value: '18.000' }] }] }],
  limitations: [],
  followUp: null
}

const ctx = (evidence = INVENTORY_EVIDENCE, items = ROWS) => ({
  evidenceSets: [evidence],
  itemsBySource: [{ source: 'aroma_system', items }]
})

/* ═══ 1. THE EVIDENCESET MUST LEAVE THE PROCESS ═══════════════════════════════
 * The root cause of BOTH the wrong count and the false limitation. Asserted on the
 * prompt string the adapter actually received — the only place that proves the model
 * was shown the number, rather than that the number existed somewhere in the server.
 */

test('*** the matching total reaches the model — and is NOT stated as a source total (A1) ***', async () => {
  await withEnv(async () => {
    const spy = spyAdapter(envelope(PLAN))
    await run(spy)
    const prompt = spy.calls[0].prompt
    // MIGRATED FOR A1. This test used to require 「199 records exist」, and that exact sentence
    // is the defect: on /invoices it printed 「1 records exist」 for a table holding ~471,
    // because `count` is a filtered page on three of six endpoints (DEFECT-009).
    //
    // The GUARANTEE IT WAS PROTECTING IS UNCHANGED and still asserted: the model must SEE the
    // number rather than be judged against one it was never shown. What changed is what the
    // number is called.
    assert.ok(prompt.includes('199'), 'the model must SEE the count, not be judged against it')
    assert.ok(/199 matched/.test(prompt), 'stated as rows MATCHING the query')
    assert.equal(/\d+\s*(records?\s*)?exists?\b/i.test(prompt), false,
      'and never as a count of what exists')
    assert.ok(/TOTAL IN THE WIDER SOURCE IS UNKNOWN/.test(prompt),
      'the unknown must be stated, not omitted')
    assert.ok(/1 shown/.test(prompt), 'and the shown count stays separate from both')
  })
})

test('*** the scope meanings reach the model — no location, no as-of ***', async () => {
  await withEnv(async () => {
    const spy = spyAdapter(envelope(PLAN))
    await run(spy)
    const prompt = spy.calls[0].prompt
    // This sentence already existed in SCOPE_OF.inventory and never left the process,
    // which is why the model invented a limitation instead of stating the real one.
    assert.ok(prompt.includes('冇分地點'), 'the scope note must be in the prompt')
    assert.ok(/NO location/i.test(prompt), 'and stated in a form the model cannot miss')
    assert.ok(/NO as-of/i.test(prompt), 'the missing timestamp is the other real limitation')
    assert.ok(prompt.includes('現有存量'), 'what the numeric fields MEAN must travel with them')
  })
})

test('*** completeness travels, and the model is told which number is the total ***', async () => {
  await withEnv(async () => {
    const spy = spyAdapter(envelope(PLAN))
    await run(spy)
    const prompt = spy.calls[0].prompt
    assert.ok(prompt.includes('sample'), 'a sample must be declared a sample')
    // Without this the model counts the lines it can see, which is exactly what produced
    // 「三項」 against a real 199.
    assert.ok(/never.*count.*lines|NEVER from the number of lines/i.test(prompt),
      'the model must be told not to count the lines it can see')
  })
})

test('*** an unknown total is stated as unknown — never as the shown count ***', async () => {
  await withEnv(async () => {
    const unknown = Object.assign({}, INVENTORY_EVIDENCE, { matchingTotal: null, completeness: 'unknown' })
    const spy = spyAdapter(envelope(PLAN))
    await run(spy, fakeConnector(ROWS, unknown))
    const prompt = spy.calls[0].prompt
    assert.ok(/match count unknown/i.test(prompt), 'unknown is unknown')
    assert.ok(/TOTAL IN THE WIDER SOURCE IS UNKNOWN/.test(prompt), 'and so is the source total')
    assert.equal(/\d+\s*(records?\s*)?exists?\b/i.test(prompt), false,
      'the shown count must never wear a total\'s clothes')
  })
})

test('the truncation note stays, and is consistent with the counts rather than a substitute', async () => {
  await withEnv(async () => {
    // Six rows retrieved, four kept (CAPS.maxItemsPerSource) — the real truncation path.
    const many = [row(1, 'A', '1.000', '9.000'), row(2, 'B', '2.000', '9.000'), row(3, 'C', '3.000', '9.000'),
      row(4, 'D', '4.000', '9.000'), row(5, 'E', '5.000', '9.000'), row(6, 'F', '6.000', '9.000')]
    const spy = spyAdapter(envelope(PLAN))
    await run(spy, fakeConnector(many))
    const prompt = spy.calls[0].prompt
    assert.ok(prompt.includes('capped'), 'the existing truncation note must survive')
    assert.ok(/4 shown/.test(prompt), 'and the exact shown count must be there too')
    // MIGRATED FOR A1 — same guarantee, honest wording. The number still travels and is still
    // distinct from the shown count; it is no longer called a count of what exists.
    assert.ok(prompt.includes('199 matched'), 'the matching total is still stated, and still distinct')
    assert.equal(/\d+\s*(records?\s*)?exists?\b/i.test(prompt), false, 'and never as an existence claim')
  })
})

/* ═══ 2. NUMERIC COMPARISON, NOT STRICT STRINGS ═══════════════════════════════
 * 18 and 18 ea must match 18.000. Substring matching must NOT be how that happens:
 * '8.0' is a substring of '18.000' and is a different number.
 */

const factPlan = (value) => ({
  directAnswer: '睇咗。',
  unanswerable: false,
  sections: [{ heading: '缺貨狀況' /* not 缺口最大 — that is a ranking claim now (task 001) */, items: [{ sourceId: '2', title: 'Napa Cabbage', facts: [{ field: '現有', value }] }] }],
  limitations: [],
  followUp: null
})
const factsOf = (value) => {
  const v = validatePlan(factPlan(value), ctx())
  return (v.plan.sections[0] && v.plan.sections[0].items[0].facts) || []
}

test('*** 18 matches 18.000 — a correct value is not deleted by a string comparison ***', () => {
  const facts = factsOf('18')
  assert.equal(facts.length, 1, '「18」 is the same quantity as 「18.000」 and must survive')
  assert.equal(validatePlan(factPlan('18'), ctx()).droppedFacts, 0)
})

test('*** 18 ea matches 18.000 — a unit the evidence carries does not invalidate the number ***', () => {
  assert.equal(factsOf('18 ea').length, 1)
})

test('*** substring matching is NOT the mechanism — 8.0 must be rejected ***', () => {
  // '8.0' is a substring of '18.000'. It is a different number and must not survive.
  assert.equal(factsOf('8.0').length, 0)
  assert.equal(factsOf('1').length, 0, '「1」 is a substring of 「18.000」 and is not it')
})

test('*** a real number with an invented unit is still an invention ***', () => {
  assert.equal(factsOf('18 apples').length, 0, 'the evidence carries no 「apples」')
})

test('a money value matches the bare number the row carries', () => {
  const items = [Object.assign({}, row(9, 'A-1 Environmental', '1.000', '2.000'), { fields: { name: 'A-1 Environmental', total: '191.10' } })]
  const v = validatePlan({
    directAnswer: '睇咗。',
    unanswerable: false,
    sections: [{ heading: '發票', items: [{ sourceId: '9', title: 'A-1 Environmental', facts: [{ field: '總額', value: '$191.10' }] }] }],
    limitations: [],
    followUp: null
  }, ctx(INVENTORY_EVIDENCE, items))
  assert.equal(v.plan.sections[0].items[0].facts.length, 1)
})

test('a status enum still translates, and a raw enum never survives', () => {
  const items = [Object.assign({}, row(7, 'A&B Foods', '1.000', '2.000'), { fields: { name: 'A&B Foods', status: 'active' } })]
  const v = validatePlan({
    directAnswer: '睇咗。',
    unanswerable: false,
    sections: [{ heading: '供應商', items: [{ sourceId: '7', title: 'A&B Foods', facts: [{ field: '狀態', value: 'active' }] }] }],
    limitations: [],
    followUp: null
  }, ctx(INVENTORY_EVIDENCE, items))
  assert.equal(v.plan.sections[0].items[0].facts[0].value, '啟用中')
  assert.equal(JSON.stringify(v.plan).includes('active'), false)
})

/* ═══ 3. CHINESE NUMERALS ═════════════════════════════════════════════════════
 * 「三項」 is how the Owner's assistant actually writes a count. The digit-only check
 * had nothing to test and passed it, which is how a 3 stood in for 199.
 */

test('*** 三項 is a count claim and is checked — the ASCII case was never the only one ***', () => {
  const i = evidenceIndex([INVENTORY_EVIDENCE], [{ source: 'aroma_system', items: ROWS }])
  assert.ok(i.numbers.has('199'), 'the real total is stateable')
  // shownCount is 1 here, so 「三項」 is neither the total nor the shown count.
  assert.equal(sentenceIsSupported('系統讀到三項倉存記錄。', i), false,
    'THE LIVE FAILURE: this sentence reached the Owner while the real count was 199')
  assert.equal(sentenceIsSupported('有 3 項存貨。', i), false, 'the ASCII form must stay rejected too')
})

test('*** the measured counts ARE stateable in Chinese numerals ***', () => {
  const i = evidenceIndex([INVENTORY_EVIDENCE], [{ source: 'aroma_system', items: ROWS }])
  assert.equal(sentenceIsSupported('餐廳系統有一百九十九項存貨記錄。', i), true, '199 written in Chinese is still 199')
  assert.equal(sentenceIsSupported('今次淨係顯示咗一項。', i), true, 'shownCount is 1')
})

test('*** ordinary prose containing a numeral character is NOT a count claim ***', () => {
  const i = evidenceIndex([INVENTORY_EVIDENCE], [{ source: 'aroma_system', items: ROWS }])
  // 一 appears in 一齊 / 一定 / 一啲 constantly. Dropping honest prose would be a worse
  // failure than the one being fixed, so only numeral+measure-word is treated as a count.
  assert.equal(sentenceIsSupported('我一齊睇埋佢哋。', i), true)
  assert.equal(sentenceIsSupported('呢個一定要跟進。', i), true)
  assert.equal(sentenceIsSupported('有一啲嘢要留意。', i), true)
})

test('a Chinese-numeral count that IS wrong is dropped through the real validator', () => {
  const v = validatePlan(Object.assign({}, PLAN, { directAnswer: '系統讀到三項倉存記錄。' }), ctx())
  assert.equal(v.droppedSentences, 1, 'THE LIVE FAILURE: droppedSentences was 0')
  assert.equal(v.answerSurvived, false, 'nothing of that answer was provable')
})

/* ═══ 4. DROP ACCOUNTING, AND NO SILENT VANISHING ═════════════════════════════ */

test('*** droppedItems is counted separately from droppedFacts ***', () => {
  // THE LIVE FAILURE: three items with unknown sourceIds were reported as droppedFacts:3,
  // which sent the diagnosis after the wrong defect.
  const v = validatePlan({
    directAnswer: '睇咗。',
    unanswerable: false,
    sections: [{
      heading: '缺貨狀況' /* not 缺口最大 — that is a ranking claim now (task 001) */,
      items: [
        { sourceId: 'napa-cabbage', title: 'X', facts: [{ field: '現有', value: '18.000' }] },
        { sourceId: '2', title: 'Napa Cabbage', facts: [{ field: '現有', value: '一萬' }] }
      ]
    }],
    limitations: [],
    followUp: null
  }, ctx())
  assert.equal(v.droppedItems, 1, 'one item did not exist')
  assert.equal(v.droppedFacts, 1, 'and one fact was unprovable — a different failure')
})

test('*** the log records WHAT was dropped — identity, never values ***', () => {
  const lines = []
  logAnswerPlan({
    outcome: 'degraded',
    reason: 'items_unsupported',
    droppedItems: 1,
    droppedFacts: 1,
    drops: [{ kind: 'item', sourceId: 'napa-cabbage' }, { kind: 'fact', sourceId: '2', field: '現有' }]
  }, (l) => lines.push(l))
  const line = lines[0]
  assert.equal(line.droppedItems, 1)
  assert.equal(line.droppedFacts, 1)
  assert.ok(Array.isArray(line.dropped), 'a validator that deletes without a record is how this took three rounds')
  assert.deepEqual(line.dropped[0], { kind: 'item', sourceId: 'napa-cabbage' })
  assert.deepEqual(line.dropped[1], { kind: 'fact', sourceId: '2', field: '現有' })
  assert.equal(JSON.stringify(line).includes('18.000'), false, 'a VALUE must never reach the log')
})

test('*** a plan whose every item is unprovable does NOT report success ***', async () => {
  const bad = Object.assign({}, PLAN, {
    sections: [{ heading: '缺貨狀況' /* not 缺口最大 — that is a ranking claim now (task 001) */, items: [{ sourceId: 'napa-cabbage', title: 'X', facts: [] }] }]
  })
  const { captured, result } = await withEnv(() => withLogCapture(() => run(spyAdapter(envelope(bad)))))
  assert.equal(captured.length, 1)
  // THE LIVE FAILURE: outcome read "validated" while the screen showed nothing at all.
  assert.equal(captured[0].outcome, 'fallback')
  assert.equal(captured[0].reason, 'items_unsupported')
  assert.equal(captured[0].droppedItems, 1)
  assert.ok(result.reply.includes('199'), 'the deterministic minimum states a measured count')
  assert.equal(result.reply.includes('缺口最大'), false, 'an empty section must not render as a bare heading')
})

test('*** a section that loses SOME items states the omission rather than shrinking silently ***', async () => {
  const partial = Object.assign({}, PLAN, {
    sections: [{
      heading: '缺貨狀況' /* not 缺口最大 — that is a ranking claim now (task 001) */,
      items: [
        { sourceId: '2', title: 'Napa Cabbage', facts: [{ field: '現有', value: '18.000' }] },
        { sourceId: 'ghost', title: 'Nothing', facts: [] }
      ]
    }]
  })
  const { captured, result } = await withEnv(() => withLogCapture(() => run(spyAdapter(envelope(partial)))))
  assert.equal(captured[0].outcome, 'degraded', 'a turn that lost content is not a clean turn')
  assert.equal(captured[0].droppedItems, 1)
  assert.ok(result.reply.includes('Napa Cabbage'), 'what survived is still shown')
  assert.ok(/核對唔到|未顯示|1 項/.test(result.reply), 'and the omission is stated on screen')
})

test('a clean turn still reads validated, with both counters at zero', async () => {
  const { captured } = await withEnv(() => withLogCapture(() => run(spyAdapter(envelope(PLAN)))))
  assert.equal(captured[0].outcome, 'validated')
  assert.equal(captured[0].droppedItems, 0)
  assert.equal(captured[0].droppedFacts, 0)
  assert.deepEqual(captured[0].dropped, [])
})
