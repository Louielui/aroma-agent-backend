'use strict'

/**
 * sectionRanking.test.js — a SECTION asserts an order too, and nothing used to look.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED LIVE on `main@befaed0`, 5 fresh conversations, 「現在缺貨最嚴重的是什麼？」.
 * One turn shipped a section headed 「缺貨項目排序」 whose items ran
 *     Jars 20 → Napa 70 → New Orleans 39 → Dark Soy 37
 * against a proven absolute-shortfall order of
 *     Napa 70 → New Orleans 39 → Dark Soy 37 → Jars 20
 *
 * The sentence gate HAD fired on that turn — the log records `field:"ranking"` in `dropped`
 * for all five turns — and `directAnswer` was emptied. The section shipped anyway, because
 * `answerPlan.js:1274` handed `rankingProof` the sentence and nothing else, so
 * `sections.length = 0` could never trigger for a ranking that lived in a section.
 *
 * ⛔ THESE RUN THROUGH FULL `processIntake`. A module-only test would have passed on the
 * broken build — the module was never the thing that was wrong.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { RANKING_METRIC, rankingSectionViolations } = require('./rankingProof')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')

const NOW = '2026-08-09T00:00:00.000Z'
const ASK = '現在缺貨最嚴重的是什麼？'

const NAPA = 'Napa Cabbage'
const NOLA = 'New Orleans Style Sauce'
const SOY = 'Dark Soy Sauce'
const JARS = 'Jars for Red Chili Oil'
/** The proven order: 70 > 39 > 37 > 20. */
const RANKED = [
  { title: NAPA, id: '1', shortfall: 70 },
  { title: NOLA, id: '2', shortfall: 39 },
  { title: SOY, id: '3', shortfall: 37 },
  { title: JARS, id: '4', shortfall: 20 }
]
const BY_TITLE = new Map(RANKED.map((r) => [r.title, r]))

const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on', [A4_AMBIGUITY_FLAG]: 'on' }
async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

function rankedConnector () {
  return {
    connector: {
      async read (source) {
        return {
          asOf: NOW,
          source,
          count: RANKED.length,
          results: RANKED.map((r) => ({
            source,
            sourceId: r.id,
            title: r.title,
            entityType: 'inventory_item',
            content: `par 100 · on hand ${100 - r.shortfall}`,
            fields: { id: r.id, parLevel: '100', currentStock: String(100 - r.shortfall) },
            trust: 'live',
            retrievedAt: NOW,
            originalDate: null,
            link: null,
            error: null
          })),
          evidence: {
            source: 'aroma_system',
            entityType: 'inventory_item',
            endpoint: 'inventory',
            returnedRows: 199,
            shownCount: RANKED.length,
            matchingTotal: 199,
            sourceTotal: null,
            queryScope: { field: null, window: null, declaredBy: 'reader' },
            filtersApplied: null,
            limit: null,
            limitKnown: true,
            truncated: false,
            completeWithinScope: true,
            rowShape: { hasLocation: false, hasAsOf: false, note: null },
            metrics: {},
            derivations: {},
            fieldLabels: {},
            completeness: 'sample',
            rankedBy: 'parLevel - currentStock desc',
            rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL,
            rankingDirection: 'desc',
            rankingCompleteWithinScope: true,
            dataAsOf: null,
            retrievedAt: NOW,
            trust: 'live',
            provenance: 'FAKE INVENTORY'
          }
        }
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
      const e = envelopes[Math.min(calls.length - 1, envelopes.length - 1)]
      return { text: JSON.stringify(e), usage: { inputTokens: 1, outputTokens: 1 } }
    }
  }
}

const READ = { intent: 'answer', mode: 'chat', reply: null, nextRead: { capability: 'aroma_system.inventory' }, answerPlan: null }

/** A terminal envelope whose ANSWER lives in a section, with a neutral sentence. */
const SECTION_PLAN = (heading, titles, directAnswer) => ({
  intent: 'answer',
  mode: 'chat',
  reply: directAnswer || '',
  nextRead: null,
  answerPlan: {
    directAnswer: directAnswer || '',
    sections: [{
      heading,
      items: titles.map((t) => ({ sourceId: BY_TITLE.get(t).id, title: t, facts: [] }))
    }],
    limitations: [],
    followUp: null,
    unanswerable: false,
    citesEvidence: true
  }
})

const run = (msg, adapter, c) => processIntake(msg, adapter, [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: {
    connector: c.connector,
    sources: ['aroma_system', 'public_knowledge'],
    sourceIntentResolver: async () => ({ intent: 'internal' })
  }
})

/** Which of the four titles the shipped reply names, in the order it names them. */
function shippedOrder (reply) {
  const s = String(reply || '')
  return RANKED
    .map((r) => ({ title: r.title, at: s.indexOf(r.title) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.title)
}

/* ═══ THE THREE MANDATORY LIVE-SHAPED REGRESSIONS ════════════════════════ */

test('*** ⛔ 1. A 「缺貨項目排序」 SECTION IN THE WRONG ORDER MUST NOT SHIP ***', async () => {
  await withEnv({}, async () => {
    const out = await run(ASK, scriptedAdapter([
      READ, SECTION_PLAN('缺貨項目排序', [JARS, NAPA, NOLA, SOY], '')
    ]), rankedConnector())
    const reply = String(out && out.reply != null ? out.reply : '')
    const order = shippedOrder(reply)
    // ⛔ THE LIVE DEFECT, EXACTLY: Jars must not reach the Owner above Napa.
    const jars = order.indexOf(JARS)
    const napa = order.indexOf(NAPA)
    assert.ok(!(jars >= 0 && napa >= 0 && jars < napa),
      '⛔ the contradicting ranking section shipped: ' + JSON.stringify(order))
    // And the reply must not be silence — `minimalAnswer` is what protects this path.
    assert.ok(reply.trim().length > 0, '⛔ SILENCE — shipped: ' + JSON.stringify(reply))
  })
})

test('*** ⛔ 2. THE SAME SECTION IN THE PROVEN ORDER IS ALLOWED ***', async () => {
  await withEnv({}, async () => {
    const out = await run(ASK, scriptedAdapter([
      READ, SECTION_PLAN('缺貨項目排序', [NAPA, NOLA, SOY, JARS], '')
    ]), rankedConnector())
    const order = shippedOrder(out && out.reply)
    assert.deepEqual(order, [NAPA, NOLA, SOY, JARS],
      '⛔ a CORRECT ranking was refused — shipped: ' + JSON.stringify(order))
  })
})

test('*** ⛔ 3. A 「缺貨狀況」 SECTION IS NOT A RANKING, WHATEVER ITS ORDER ***', async () => {
  await withEnv({}, async () => {
    // A superlative QUESTION must not turn an ordinary section into a ranking claim.
    const out = await run(ASK, scriptedAdapter([
      READ, SECTION_PLAN('缺貨狀況', [JARS, NAPA, NOLA, SOY], '')
    ]), rankedConnector())
    const order = shippedOrder(out && out.reply)
    assert.deepEqual(order, [JARS, NAPA, NOLA, SOY],
      '⛔ an ordinary section was treated as a ranking — shipped: ' + JSON.stringify(order))
  })
})

/* ═══ THE BOUNDARY, AT MODULE LEVEL ══════════════════════════════════════ */

const SEC = (heading, titles) => ({ heading, items: titles.map((t) => ({ title: t })) })
const ROWS = RANKED.map((r) => ({ title: r.title }))
const bad = (sections) => rankingSectionViolations({ sections, rankedRows: ROWS })

test('*** a correct SUBSEQUENCE is a legitimate ranking — a top-2 need not carry the tail ***', () => {
  assert.deepEqual(bad([SEC('缺貨排序', [NAPA, NOLA])]), [], 'top-2')
  assert.deepEqual(bad([SEC('缺貨排序', [NAPA, SOY])]), [], 'skipping New Orleans is fine')
  assert.deepEqual(bad([SEC('缺貨排序', [NOLA, JARS])]), [], 'a tail slice is still in order')
})

test('*** ⛔ but a REORDERED subsequence is not ***', () => {
  assert.deepEqual(bad([SEC('缺貨排序', [SOY, NAPA])]), [0])
  assert.deepEqual(bad([SEC('排名', [NAPA, JARS, NOLA])]), [0])
})

test('*** a single-item ranking section cannot be out of order ***', () => {
  assert.deepEqual(bad([SEC('缺貨排序', [JARS])]), [], 'one item asserts no sequence')
})

test('*** only the OFFENDING section is dropped, not its neighbour ***', () => {
  const v = bad([SEC('缺貨狀況', [JARS, NAPA]), SEC('缺貨排序', [JARS, NAPA])])
  assert.deepEqual(v, [1], 'the ordinary section at index 0 survives')
})

test('*** with no ranked rows there is nothing to contradict ***', () => {
  assert.deepEqual(rankingSectionViolations({ sections: [SEC('缺貨排序', [JARS, NAPA])], rankedRows: [] }), [])
})
