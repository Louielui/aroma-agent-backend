'use strict'

/**
 * recallIsNotEvidence.test.js — RECALL IS NOT EVIDENCE, and three smaller repairs.
 *
 * ── THE FAILURE THIS FILE EXISTS FOR ──────────────────────────────────────────
 * On 2026-08-04 the Owner asked 「而家倉存入面有咩？」. The read layer worked perfectly:
 * it retrieved the four largest par-level gaps — Napa Cabbage (57), Peanut Butter (46),
 * New Orleans Roast Marinade (39), Dark Soy Sauce (37) — and told the model the real total
 * was 199. The answer on screen named Napa Cabbage, Peanut Butter, AND
 * 「2lb portioning bag」 and 「8oz Spice Jar With Lids」.
 *
 * Those last two were not in the read at all. They are positions 0 and 1 of the raw
 * inventory table — its ALPHABETICAL head, the exact ordering the gap ranking exists to
 * replace — and they rank 9th and 62nd of 199 by gap. They came, verbatim, from an
 * archived reply of HER OWN in a previous conversation (e5582d46, 2026-08-03 13:39): the
 * original broken turn, the one that said 「三項」 against a real 199. Conversation recall
 * fed that refuted answer back into the prompt, and she restated it as today's inventory.
 *
 * The validator logged outcome:"validated", droppedItems:0, droppedFacts:0, dropped:[].
 * It was telling the truth: it had deleted nothing, because there was nothing in the
 * checked channel to delete. Every claim was in PROSE, and prose names were never checked —
 * only numbers were. So a wrong answer made itself permanent by being repeated.
 *
 * THE RULE, from the Owner: entity names, quantities, amounts, dates and statuses in an
 * Owner-facing answer must originate from THIS TURN'S EvidenceSet. Recall may inform tone,
 * context and continuity. It may never supply a business fact.
 *
 * WHAT IS STRUCTURAL AND WHAT IS NOT, stated here rather than implied. The OUTPUT boundary
 * is structural: a sentence carrying a Latin-script name this turn's evidence does not hold
 * is removed by the server, whatever the model intended. The INPUT boundary is prompt-level:
 * the recall block is labelled as memory rather than evidence, and labels are a request. The
 * tests below assert the structural half at the boundary; the prompt half is asserted only
 * as "the words left the process", which is all a prompt rule can ever be worth here.
 *
 * No network, no paid call.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { validatePlan, DISTILL_WITH_PLAN_SCHEMA, SOURCE_LABELS } = require('./answerPlan')
const { SAFETY_HEADER: RECALL_HEADER } = require('../lab/conversationRecall')

const NOW = '2026-08-03T12:00:00.000Z'

/* ── this turn's evidence: the REAL gap-ranked rows ───────────────────────── */

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
  rowShape: { hasLocation: false, hasAsOf: false, note: '每項有一個存量數字,但冇分地點、亦冇記錄係幾時嘅' },
  metrics: { currentStock: { label: '現有存量' }, parLevel: { label: '安全存量' } },
  matchingTotal: 199,
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

/** THE ARCHIVED TURN THAT ACTUALLY LEAKED — her own words, verbatim from the archive. */
const LEAKED = '剛才讀到嘅 Aroma System 倉存資料有三項:2lb portioning bag(紙箱裝,現存 20 盒,安全庫存 30 盒)、8oz Spice Jar With Lids(現存 0,安全庫存 0.5 cs)同埋 Aioli Base(現存 0 份,安全庫存 0)。'

const ARCHIVE_RECORDS = [
  { schemaVersion: 1, id: 'a1', conversationId: 'e5582d46', turnIndex: 3, role: 'user', at: '2026-08-03T13:39:00.000Z', text: '倉存有咩？', omitted: false },
  { schemaVersion: 1, id: 'a2', conversationId: 'e5582d46', turnIndex: 4, role: 'assistant', at: '2026-08-03T13:39:09.641Z', text: LEAKED, omitted: false }
]

function fakeConnector (rows = ROWS) {
  return {
    async read () {
      return { asOf: NOW, source: 'aroma_system', count: rows.length, results: rows, evidence: Object.assign({}, EVIDENCE, { shownCount: rows.length }) }
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

const FLAGS = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', CONVERSATION_RECALL: 'on' }
async function withEnv (fn) {
  const saved = {}
  for (const k of Object.keys(FLAGS)) { saved[k] = process.env[k]; process.env[k] = FLAGS[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(FLAGS)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const envelope = (plan) => JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '睇咗。', answerPlan: plan })

const run = (adapter) => processIntake('而家倉存入面有咩？', adapter, [], {
  demo: true,
  interactionMode: 'chat',
  providerHint: 'claude',
  conversationId: 'fdab4e6b',
  readContextDeps: { connector: fakeConnector(), sources: ['aroma_system'] },
  conversationRecallDeps: { readRecordsFn: () => ARCHIVE_RECORDS }
})

const plan = (over = {}) => Object.assign({
  directAnswer: '餐廳系統有 199 項存貨記錄。',
  unanswerable: false,
  sections: [{ heading: '缺口最大', items: [{ sourceId: '2', title: 'Napa Cabbage', facts: [{ field: '現有', value: '18.000' }] }] }],
  limitations: [],
  followUp: null
}, over)

/* ═══ 4. RECALL IS NOT EVIDENCE — the structural half ═════════════════════════ */

test('*** THE LIVE FAILURE: a recalled item name never reaches the Owner ***', () => {
  // Exactly what shipped: names from her own archived reply, in prose, in a turn whose
  // evidence holds none of them. Nothing in the checked channel, so nothing was dropped.
  //
  // 「Aioli Base」 IS THE TEST, and 「2lb portioning bag」 deliberately is NOT. The 2 and the
  // 8 in the other two names are digits, so the number check already removes those
  // sentences — a test built on them would pass without the name rule existing at all, and
  // report a guarantee this file does not have. 「Aioli Base」 carries no digit: it is
  // caught only if names themselves are checked against THIS turn's evidence.
  const v = validatePlan(plan({ directAnswer: '而家倉存仲有 Aioli Base。' }), ctx())
  assert.equal(v.droppedSentences, 1, 'the laundered sentence must be removed')
  assert.equal(v.plan.directAnswer.includes('Aioli'), false)

  // and the digit-bearing pair, which must also go (belt to the braces above)
  const v2 = validatePlan(plan({ directAnswer: '而家倉存有 2lb portioning bag 同埋 8oz Spice Jar With Lids。' }), ctx())
  assert.equal(v2.plan.directAnswer.includes('portioning'), false)
  assert.equal(v2.plan.directAnswer.includes('Spice Jar'), false)
})

test('*** naming an item THIS turn actually retrieved is still allowed ***', () => {
  // The rule is about provenance, not about silence. A row that was read may be named.
  const v = validatePlan(plan({ directAnswer: 'Napa Cabbage 同 Peanut Butter 爭得最多。' }), ctx())
  assert.equal(v.droppedSentences, 0)
  assert.ok(v.plan.directAnswer.includes('Napa Cabbage'))
})

test('*** the rule holds through the REAL pipeline, with the recall block present ***', async () => {
  // Digit-free again: this asserts the NAME rule end to end, with the leaking archive
  // record actually in the prompt.
  const { result } = await withEnv(() => withLogCapture(() => run(spyAdapter(envelope(plan({
    directAnswer: '而家倉存仲有 Aioli Base。'
  }))))))
  assert.equal(result.reply.includes('Aioli'), false, 'a refuted answer must not be made permanent by repetition')
})

test('an ungrounded limitation and follow-up are removed on the same rule', () => {
  const v = validatePlan(plan({
    limitations: ['Aioli Base 嘅資料未確認。'],
    followUp: '要唔要我睇埋 8oz Spice Jar With Lids？'
  }), ctx())
  assert.deepEqual(v.plan.limitations, [], 'a limitation is Owner-facing text too')
  assert.equal(v.plan.followUp, null)
})

test('ordinary Cantonese prose is untouched — the check is about names, not language', () => {
  const v = validatePlan(plan({ directAnswer: '呢批貨爭得幾遠,建議今日落單。' }), ctx())
  assert.equal(v.droppedSentences, 0)
})

/* ── the prompt half, asserted only as "the words left the process" ───────── */

test('*** memory and evidence are marked distinctly in the outbound prompt ***', async () => {
  await withEnv(async () => {
    const spy = spyAdapter(envelope(plan()))
    await run(spy)
    const prompt = spy.calls[0].prompt
    assert.ok(prompt.includes('<conversation_recall>'), 'memory is in the prompt')
    assert.ok(prompt.includes('<external_read_context>'), 'and so is this turn\'s evidence')
    // The two must not read as the same kind of thing.
    assert.ok(/NOT EVIDENCE/i.test(prompt), 'memory must be named as not-evidence')
    assert.ok(/business fact/i.test(prompt), 'and the rule must name what may not come from it')
  })
})

test('the recall header itself carries the rule, so it cannot drift out of the block', () => {
  assert.ok(/NOT EVIDENCE/i.test(RECALL_HEADER))
  assert.ok(/business fact/i.test(RECALL_HEADER))
  assert.ok(/name/i.test(RECALL_HEADER), 'names are the vector this failure used')
})

/* ═══ 1. STRUCTURE IS MANDATORY WHEN ROWS WERE READ ═══════════════════════════ */

test('*** a section that EXISTS must carry an item, and the choice is declared ***', async () => {
  await withEnv(async () => {
    const spy = spyAdapter(envelope(plan()))
    await run(spy)
    const schema = spy.calls[0].opts.responseFormat.schema
    const sections = schema.properties.answerPlan.properties.sections

    // THIS TEST USED TO ASSERT `sections.minItems === 1`, and that assertion shipped a bug.
    // The read layer reads on every chat turn regardless of the question, so a mandatory
    // section meant 「你好, 你可以幫我做什麼?」 forced the model to describe itself in the
    // fields of a cabbage. The guarantee it was protecting — item detail cannot hide in
    // prose — now rests on proseIsGrounded, sentenceIsSupported and rule 7 instead.
    assert.equal(sections.minItems, undefined, 'evidence is no longer mandatory for every question')
    assert.equal(sections.items.properties.items.minItems, 1, 'but a section that exists is never an empty heading')
    assert.ok(schema.properties.answerPlan.required.includes('citesEvidence'),
      'and "no sections" must be declared rather than silently empty')
  })
})

test('a turn that read NOTHING is still not asked for a plan at all', async () => {
  await withEnv(async () => {
    const spy = spyAdapter(JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '你好。' }))
    await processIntake('你好嗎？', spy, [], {
      demo: true,
      interactionMode: 'chat',
      providerHint: 'claude',
      conversationId: 'fdab4e6b',
      readContextDeps: { connector: { async read () { return { asOf: NOW, source: 'aroma_system', count: 0, results: [] } } }, sources: ['aroma_system'] },
      conversationRecallDeps: { readRecordsFn: () => ARCHIVE_RECORDS }
    })
    // ⛔ NOT A PLAN — and a read DECISION is not a plan. Asserting `responseFormat === undefined`
    // also withdrew `nextRead`, which is how a zero-read turn lost the ability to ask for a read
    // at all (A3 first-read initiation). The rule this protects is unchanged: nothing
    // evidence-shaped may be demanded of an ordinary chat turn.
    const fmt = spy.calls[0].opts.responseFormat
    assert.equal(fmt.name, 'distill_with_read_decision')
    assert.equal(fmt.schema.properties.answerPlan, undefined, 'the minItems rule must not leak into ordinary chat')
  })
})

/* ═══ 2. THE LOG SAYS WHAT THE MODEL OFFERED ═════════════════════════════════ */

test('*** the log records how many items the model offered and how many were real ***', async () => {
  // Without this, "the model sent no sections" and "the model sent items with no facts"
  // look identical in the log — which is exactly the investigation this round had to run
  // by hand.
  const { captured } = await withEnv(() => withLogCapture(() => run(spyAdapter(envelope(plan({ sections: [] }))))))
  assert.equal(captured.length, 1)
  assert.equal(captured[0].modelItemCount, 0, 'the model offered nothing — visible in one line')
  assert.equal(captured[0].keptItemCount, 0)
})

test('a normal turn reports the counts it actually had', async () => {
  const { captured } = await withEnv(() => withLogCapture(() => run(spyAdapter(envelope(plan())))))
  assert.equal(captured[0].modelItemCount, 1)
  assert.equal(captured[0].keptItemCount, 1)
  assert.equal(captured[0].outcome, 'validated')
})

/* ═══ 3a. ONE QUESTION, NEVER TWO OPTIONS ════════════════════════════════════ */

test('*** 「A 定 B」 is not one question — it becomes no question, not an invented one ***', () => {
  const v = validatePlan(plan({ followUp: '想睇完整倉存報告,定係查特定物料？' }), ctx())
  assert.equal(v.plan.followUp, null, 'THE LIVE FAILURE: this shipped as the follow-up')
})

test('the other two-option spellings fire the same rule', () => {
  for (const q of ['要今日落單定聽日？', '睇報告或者查物料？', 'report or item？']) {
    assert.equal(validatePlan(plan({ followUp: q }), ctx()).plan.followUp, null, q)
  }
})

test('a single genuine question survives untouched', () => {
  const v = validatePlan(plan({ followUp: '要我列出低過安全存量嗰啲嗎？' }), ctx())
  assert.equal(v.plan.followUp, '要我列出低過安全存量嗰啲嗎？')
})

test('no question is invented when the model offered none', () => {
  assert.equal(validatePlan(plan({ followUp: null }), ctx()).plan.followUp, null)
})

/* ═══ 3b. OWNER-FACING SOURCE NAMES ══════════════════════════════════════════ */

/**
 * INVERTED 2026-08-04 by Owner decision, with the Language Policy.
 *
 * This test used to require the opposite: that 「Aroma System」 was rewritten to 「餐廳系統」
 * in prose, headings, limitations and the follow-up. That was itself an Owner instruction,
 * from the round that also asked for the 「A 定 B」 follow-up fix.
 *
 * The Language Policy lists Aroma System among the proper nouns to PRESERVE, and the Owner
 * chose the policy over the exception: "one rule holds better than two exceptions." So
 * SOURCE_NAME_REWRITES is now empty and `relabel` is an identity function.
 *
 * The test is kept rather than deleted, pointing the other way, because the behaviour is
 * still worth pinning — and because a reader who finds only a deleted test has no way to
 * learn that the old behaviour was deliberate before it was deliberately withdrawn.
 *
 * NOT YET CHANGED, and visible on screen: SOURCE_LABELS (answerPlan.js) and VOCABULARY /
 * LABELS (readStateGuard.js) still render this source as 餐廳系統, so one reply can show
 * 'Aroma System' in prose beside 餐廳系統 as a label. Round 2/3 decides those.
 */
test('*** 「Aroma System」 now reaches the Owner AS 「Aroma System」 ***', () => {
  const v = validatePlan(plan({
    directAnswer: 'Aroma System 有 199 項存貨記錄。',
    sections: [{ heading: 'Aroma System 缺口', items: [{ sourceId: '2', title: 'Napa Cabbage', facts: [{ field: '現有', value: '18.000' }] }] }],
    limitations: ['Aroma System 冇記錄地點。'],
    followUp: 'Aroma System 要唔要再查？'
  }), ctx())
  assert.ok(v.plan.directAnswer.includes('Aroma System'), 'the proper noun survives in prose')
  assert.equal(v.plan.directAnswer.includes('餐廳系統'), false, 'and is NOT rewritten')
  assert.ok(v.plan.sections[0].heading.includes('Aroma System'), 'headings too')
  assert.ok(v.plan.limitations[0].includes('Aroma System'))
  assert.ok(v.plan.followUp.includes('Aroma System'))
})

test('the substitution is the label map, not a guess', () => {
  assert.equal(SOURCE_LABELS.aroma_system(), '餐廳系統')
  // A source whose Owner-facing label IS its Latin name stays as it is.
  const v = validatePlan(plan({ directAnswer: 'Gmail 嗰邊冇新嘢。' }), ctx())
  assert.ok(v.plan.directAnswer.includes('Gmail'), 'Gmail is already the Owner-facing name')
})

test('the schema still closes every object after the minItems change', () => {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'object') assert.equal(node.additionalProperties, false, 'every object must close')
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v)
  }
  walk(DISTILL_WITH_PLAN_SCHEMA)
})
