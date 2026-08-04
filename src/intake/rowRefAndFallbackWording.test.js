'use strict'

/**
 * rowRefAndFallbackWording.test.js — the row reference, and the fallback that contradicted
 * its own correction.
 *
 * ── DEFECT 1: THE MODEL FILLED IN A FIELD IT WAS NEVER GIVEN A CONTRACT FOR ───
 * Live turn 6319e1da: the model supplied two items and put "aroma_system" — the SOURCE
 * NAME — in sourceId. Neither matched a row, both were dropped, and the answer fell back:
 *   droppedItems:2 modelItemCount:2 keptItemCount:0
 *   dropped:[{"kind":"item","sourceId":"aroma_system"},{"kind":"item","sourceId":"aroma_system"}]
 *
 * A per-row id WAS in the prompt — every rendered line carried `id=2`. So this is NOT the
 * totalCount gap, where the number was genuinely absent. It is an under-specified contract:
 * the line leads with `[aroma_system]`, `id=` appears twice on it (once as the row's
 * reference, once inside the row's own content), the field's description said only "an id
 * that really exists in the evidence" — and "aroma_system" satisfies that on a plain
 * reading. The model picked the most identifier-looking token in front of it.
 *
 * THE FIX IS NOT TO RELAX THE CHECK, and not to fall back to matching on title. It is to
 * emit ONE unmistakable per-row token and to make echoing it structural rather than
 * requested: `ref=<source>#<id>` on every line, and a per-turn enum in the strict schema
 * containing exactly this turn's refs, so the provider itself refuses anything else.
 *
 * ── DEFECT 2: TWO SUBSYSTEMS ASSERTING OPPOSITE THINGS ───────────────────────
 * On screen: 「今次組唔到一個可靠嘅答案」 above, and beneath it the A′ correction
 * 「上面講『讀唔到』係唔啱嘅。餐廳系統：讀到咗（4 項）」.
 *
 * The READ SUCCEEDED — both subsystems actually agree on that. What was false was the
 * correction's premise: nothing above said 讀唔到. The guard had run against the model's
 * `reply` prose, and in the plan path that prose is NEVER rendered — the answer is built
 * from the plan. So the correction was always about text the Owner cannot see, and on a
 * fallback it read as a flat contradiction.
 *
 * A read that succeeded and a composition that failed are different events and must read
 * as different events. The guard now runs against the text that WILL BE SHOWN, which
 * removes the stale correction and closes the matching hole: a false read claim inside
 * directAnswer used to reach the screen unchallenged, because only `reply` was checked.
 *
 * No network, no paid call.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { validatePlan, minimalAnswer } = require('./answerPlan')
const { UNREADABLE_CLAIM, enforceReadState } = require('./readStateGuard')

const NOW = '2026-08-03T12:00:00.000Z'

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

const ROWS = [row(2, 'Napa Cabbage', '18.000', '75.000'), row(7, 'Peanut Butter', '2.000', '48.000')]

const EVIDENCE = {
  source: 'aroma_system',
  entityType: 'inventory_item',
  endpoint: 'inventory',
  scope: { hasLocation: false, hasAsOf: false, note: '每項有一個存量數字,但冇分地點' },
  metrics: {},
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

const ctx = () => ({ evidenceSets: [EVIDENCE], itemsBySource: [{ source: 'aroma_system', items: ROWS }] })

function fakeConnector () {
  return {
    async read () {
      return { asOf: NOW, source: 'aroma_system', count: ROWS.length, results: ROWS, evidence: EVIDENCE }
    }
  }
}

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

const envelope = (plan, reply = '睇咗。') => JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply, answerPlan: plan })

const run = (adapter) => processIntake('而家倉存入面有咩？', adapter, [], {
  demo: true,
  interactionMode: 'chat',
  providerHint: 'claude',
  readContextDeps: { connector: fakeConnector(), sources: ['aroma_system'] }
})

const planWith = (sourceId) => ({
  directAnswer: '餐廳系統有 199 項存貨記錄。',
  unanswerable: false,
  sections: [{ heading: '缺口最大', items: [{ sourceId, title: 'Napa Cabbage', facts: [{ field: '現有', value: '18.000' }] }] }],
  limitations: [],
  followUp: null
})

/* ═══ 1. ONE UNMISTAKABLE PER-ROW REFERENCE ══════════════════════════════════ */

test('*** every rendered row carries ref=<source>#<id> in the outbound prompt ***', async () => {
  await withEnv(async () => {
    const spy = spyAdapter(envelope(planWith('aroma_system#2')))
    await run(spy)
    const prompt = spy.calls[0].prompt
    assert.ok(prompt.includes('ref=aroma_system#2'), 'the row reference must be IN the prompt, self-labelling')
    assert.ok(prompt.includes('ref=aroma_system#7'))
  })
})

test('*** the schema restricts sourceId to THIS turn\'s refs — echoing is enforced, not asked ***', async () => {
  await withEnv(async () => {
    const spy = spyAdapter(envelope(planWith('aroma_system#2')))
    await run(spy)
    const schema = spy.calls[0].opts.responseFormat.schema
    const sourceId = schema.properties.answerPlan.properties.sections.items.properties.items.items.properties.sourceId
    assert.deepEqual(sourceId.enum, ['aroma_system#2', 'aroma_system#7'], 'exactly the rows that were read')
    assert.equal(sourceId.enum.includes('aroma_system'), false, 'THE LIVE FAILURE: the source name is not a row')
  })
})

test('*** THE LIVE FAILURE: a source name as sourceId is still dropped — the check is NOT relaxed ***', () => {
  const v = validatePlan({
    directAnswer: '餐廳系統有 199 項存貨記錄。',
    unanswerable: false,
    sections: [{ heading: 'x', items: [{ sourceId: 'aroma_system', title: 'a', facts: [] }, { sourceId: 'aroma_system', title: 'b', facts: [] }] }],
    limitations: [],
    followUp: null
  }, ctx())
  assert.equal(v.droppedItems, 2)
  assert.equal(v.keptItemCount, 0)
})

test('*** a plan echoing the ref validates ***', () => {
  const v = validatePlan(planWith('aroma_system#2'), ctx())
  assert.equal(v.droppedItems, 0)
  assert.equal(v.keptItemCount, 1)
  assert.equal(v.plan.sections[0].items[0].title, 'Napa Cabbage', 'the title is still the server\'s')
})

test('the bare row id keeps working — the ref is an addition, not a replacement', () => {
  const v = validatePlan(planWith('2'), ctx())
  assert.equal(v.droppedItems, 0)
  assert.equal(v.keptItemCount, 1)
})

test('*** a TITLE is never an identifier ***', () => {
  // Explicitly forbidden: matching on title would make an invented row indistinguishable
  // from a retrieved one whenever the model happened to name a real product.
  assert.equal(validatePlan(planWith('Napa Cabbage'), ctx()).droppedItems, 1)
})

test('a ref from another source does not validate an aroma_system claim', () => {
  assert.equal(validatePlan(planWith('gmail#2'), ctx()).droppedItems, 1)
})

/* ═══ 2. THE FALLBACK SAYS WHAT ACTUALLY HAPPENED ════════════════════════════ */

test('*** the fallback distinguishes a successful READ from a failed COMPOSITION ***', () => {
  const text = minimalAnswer([EVIDENCE])
  assert.ok(text.includes('讀取成功'), 'the read succeeded and must say so')
  assert.ok(text.includes('砌唔出'), 'and the failure was to compose, which is a different event')
  assert.ok(text.includes('199'), 'with the measured count')
})

test('*** the fallback text cannot itself trip the read-state guard ***', () => {
  // The contradiction the Owner saw was a correction firing over text that no longer
  // claimed anything of the kind. The fallback must not contain a read-failure phrase at
  // all, or the guard and the answer will keep arguing.
  const text = minimalAnswer([EVIDENCE])
  assert.equal(UNREADABLE_CLAIM.test(text), false)
  const guarded = enforceReadState(text, [{ source: 'aroma_system', trust: 'live', count: 2, usedFallback: false }])
  assert.equal(guarded.corrected, false, 'there is nothing here to correct')
})

test('a genuine total read failure still says so plainly', () => {
  assert.ok(minimalAnswer([]).includes('讀唔到'), 'when nothing was read, 讀唔到 is the true word')
})

test('*** no stale correction: the guard judges what is SHOWN, not discarded prose ***', async () => {
  // Live shape: the model's `reply` prose claims a read failure, the plan's items are all
  // unprovable, so the answer falls back. The prose is never rendered — a correction about
  // it is about nothing.
  const { result, captured } = await withEnv(() => withLogCapture(() => run(
    spyAdapter(envelope(planWith('aroma_system'), '我讀唔到餐廳系統嘅資料。'))
  )))
  assert.equal(captured[0].outcome, 'fallback')
  assert.equal(captured[0].reason, 'items_unsupported')
  assert.equal(result.reply.includes('系統更正'), false, 'THE CONTRADICTION: a correction about text nobody can see')
  assert.equal(result.reply.includes('讀唔到'), false)
  assert.ok(result.reply.includes('讀取成功'))
})

test('*** a false read claim in the SHOWN answer is still corrected ***', async () => {
  // The other half of judging what is shown: directAnswer was never checked by the guard,
  // so a false claim there reached the Owner unchallenged.
  const plan = Object.assign(planWith('aroma_system#2'), { directAnswer: '我讀唔到餐廳系統嘅資料。' })
  const { result } = await withEnv(() => withLogCapture(() => run(spyAdapter(envelope(plan, '好。')))))
  assert.ok(result.reply.includes('系統更正'), 'a false claim that IS on screen must still be corrected')
  assert.ok(result.reply.includes('讀到咗'))
})

test('a clean validated turn carries no correction at all', async () => {
  const { result } = await withEnv(() => withLogCapture(() => run(spyAdapter(envelope(planWith('aroma_system#2'), '好。')))))
  assert.equal(result.reply.includes('系統更正'), false)
})
