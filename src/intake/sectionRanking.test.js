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

/**
 * ⛔ CANONICAL REFS, BECAUSE A TWO-READ TURN MAKES BARE IDS AMBIGUOUS.
 * With two operations owning id '1', alias resolution fails closed and the items are dropped
 * as inventions BEFORE the ranking gate ever sees them — which is how the first version of the
 * multi-source test passed without exercising the rule it claimed to pin.
 */
const SECTION_PLAN_REF = (heading, titles) => ({
  intent: 'answer',
  mode: 'chat',
  reply: '',
  nextRead: null,
  answerPlan: {
    directAnswer: '',
    sections: [{
      heading,
      items: titles.map((t) => ({ sourceId: 'aroma_system.inventory#' + BY_TITLE.get(t).id, title: t, facts: [] }))
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

/**
 * ⛔ ENTITLEMENT IS PART OF THE INPUT NOW. A section gate that sees only the order can say a
 * sequence is right but not whether the ordering was ever provable — see PROOF_INCOMPLETE.
 */
const PROOF_COMPLETE = [{
  source: 'aroma_system', endpoint: 'inventory', trust: 'live',
  rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingCompleteWithinScope: true
}]
/** `orderPlanning`: server LIMIT 100 applied BEFORE the client sort. */
const PROOF_INCOMPLETE = [{
  source: 'aroma_system', endpoint: 'orderPlanning', trust: 'live',
  rankingMetric: RANKING_METRIC.SUGGESTED_ORDER_QTY, rankingCompleteWithinScope: false
}]

/**
 * ⛔ THE HELPER TAKES **ONE** PROOF AND THE COUNT OF RANKED SOURCES — not the turn's evidence.
 * Entitlement that reads the whole turn lets one source's proof entitle another's ranking.
 */
const bad = (sections, evidence = PROOF_COMPLETE, count = 1) =>
  rankingSectionViolations({
    sections,
    rankedRows: ROWS,
    rankingEvidence: Array.isArray(evidence) ? evidence[0] : evidence,
    rankedSourceCount: count
  })

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

/**
 * ⛔ REVISED, NOT DELETED — OWNER CONTRACT CHANGE, TASK 001.
 *
 * This asserted that a ranking section with NO ranked rows is nothing to worry about. That
 * early exit was the bypass: a superlative section could ship with no ranking proof at all,
 * which is how 「目前最缺的四項」 reached the Owner in requestId a3a51702.
 *
 * > **Owner: the `rankedSourceCount === 0 → return []` early exit must NOT apply to a
 * > recognised ranking claim.**
 *
 * The property worth keeping — a turn that read nothing orderable is not turned into a generic
 * ranking detector — is unchanged and asserted below: an ORDINARY section is still untouched.
 */
test('*** with no ranked rows a ranking CLAIM fails closed, and an ordinary section does not ***', () => {
  assert.deepEqual(rankingSectionViolations({ sections: [SEC('缺貨排序', [JARS, NAPA])], rankedRows: [] }), [0],
    '⛔ a ranking claim shipped with no proof behind it')
  assert.deepEqual(rankingSectionViolations({ sections: [SEC('缺貨狀況', [JARS, NAPA])], rankedRows: [] }), [],
    '⛔ an ordinary section was treated as a ranking')
})

/* ═══ ENTITLEMENT — THE PROOF MUST BE COMPLETE, NOT MERELY CORRECT ═══════ */

test('*** ⛔ AN INCOMPLETE RANKING IS REFUSED EVEN WHEN THE ORDER IS RIGHT ***', () => {
  // ⛔ Identical section, identical (correct) order. Only the entitlement differs, so the
  // entitlement is the only thing that can be doing the work here.
  const section = [SEC('訂貨建議排名', [NAPA, NOLA, SOY])]
  assert.deepEqual(bad(section, PROOF_COMPLETE), [], 'proven ranking, correct order → allowed')
  assert.deepEqual(bad(section, PROOF_INCOMPLETE), [0],
    '⛔ a ranking the server cut before sorting shipped because its order happened to be right')
})

test('*** ⛔ and a SINGLE-ITEM ranking section is refused when unproven ***', () => {
  // Order cannot be wrong with one item, so only entitlement can refuse it — and it must,
  // because 「排名第一」 over an unprovable ordering is still a first-place claim.
  assert.deepEqual(bad([SEC('訂貨建議排名', [NAPA])], PROOF_COMPLETE), [])
  assert.deepEqual(bad([SEC('訂貨建議排名', [NAPA])], PROOF_INCOMPLETE), [0])
})

test('*** an ORDINARY section is untouched by entitlement ***', () => {
  assert.deepEqual(bad([SEC('缺貨狀況', [JARS, NAPA, SOY])], PROOF_INCOMPLETE), [],
    '⛔ entitlement must not turn a non-ranking section into a violation')
})

test('*** absent evidence is not entitlement — fails closed ***', () => {
  assert.deepEqual(rankingSectionViolations({ sections: [SEC('缺貨排序', [NAPA, NOLA])], rankedRows: ROWS, rankedSourceCount: 1 }), [0],
    '⛔ a missing descriptor must not read as a proven ranking')
})

/* ═══ ⛔ THE LIVE-SHAPED ENTITLEMENT REGRESSION ══════════════════════════ */

/** Same rows, same shape — but the descriptor says the sort did NOT see everything. */
function incompleteRankingConnector () {
  const base = rankedConnector()
  return {
    connector: {
      async read (source) {
        const out = await base.connector.read(source)
        out.evidence.endpoint = 'orderPlanning'
        out.evidence.rankingMetric = RANKING_METRIC.SUGGESTED_ORDER_QTY
        // The server cut at LIMIT 100 before the client sorted.
        out.evidence.rankingCompleteWithinScope = false
        out.evidence.limit = 100
        out.evidence.truncated = null
        return out
      }
    }
  }
}

test('*** ⛔ LIVE: AN UNPROVEN RANKING SECTION IN CORRECT ORDER STILL MUST NOT SHIP ***', async () => {
  await withEnv({}, async () => {
    const out = await run(ASK, scriptedAdapter([
      // ⛔ CORRECT relative order. Only the entitlement is missing, so only the entitlement
      // check can refuse it — and it must, or the class we just closed reopens.
      READ, SECTION_PLAN('訂貨建議排名', [NAPA, NOLA, SOY, JARS], '')
    ]), incompleteRankingConnector())
    const reply = String(out && out.reply != null ? out.reply : '')
    assert.deepEqual(shippedOrder(reply), [],
      '⛔ an unprovable ranking shipped because its order happened to be right: ' + JSON.stringify(reply))
    assert.ok(reply.trim().length > 0, '⛔ SILENCE — shipped: ' + JSON.stringify(reply))
  })
})

test('*** ⛔ LIVE: and an ORDINARY section over the same unproven source still ships ***', async () => {
  await withEnv({}, async () => {
    const out = await run(ASK, scriptedAdapter([
      READ, SECTION_PLAN('缺貨狀況', [JARS, NAPA, NOLA, SOY], '')
    ]), incompleteRankingConnector())
    assert.deepEqual(shippedOrder(out && out.reply), [JARS, NAPA, NOLA, SOY],
      '⛔ entitlement leaked onto a non-ranking section')
  })
})

/* ═══ ⛔ ONE PROOF, AND IT MUST BE THE ONE THAT OWNS THE ROWS ════════════ */

test('*** ⛔ M1. SOURCE A\'S COMPLETE PROOF MUST NOT ENTITLE SOURCE B\'S RANKING ***', () => {
  // Two ranked sources in one turn: inventory complete, orderPlanning not. A section carries
  // no source attribution, so nothing can show which ordering it reports.
  assert.deepEqual(bad([SEC('訂貨建議排名', [NAPA, NOLA, SOY])], PROOF_COMPLETE, 2), [0],
    '⛔ a complete proof entitled a ranking that does not belong to it')
})

test('*** ⛔ M2. TWO COMPLETE PROOFS IS STILL AMBIGUOUS — FAIL CLOSED ***', () => {
  // Both proven, order correct against inventory. Still refused: 「which ordering is this?」
  // has no structural answer, and an unattributable claim is not a proven one.
  assert.deepEqual(bad([SEC('缺貨排序', [NAPA, NOLA, SOY, JARS])], PROOF_COMPLETE, 2), [0])
})

test('*** ⛔ M3. AN ORDINARY SECTION IN A TWO-SOURCE TURN IS UNTOUCHED ***', () => {
  assert.deepEqual(bad([SEC('缺貨狀況', [JARS, NAPA, NOLA])], PROOF_COMPLETE, 2), [],
    '⛔ ambiguity leaked onto a non-ranking section')
})

test('*** ⛔ M4. THE SINGLE-SOURCE HAPPY PATH IS UNCHANGED ***', () => {
  assert.deepEqual(bad([SEC('缺貨排序', [NAPA, NOLA, SOY, JARS])], PROOF_COMPLETE, 1), [])
  assert.deepEqual(bad([SEC('缺貨排序', [NAPA, SOY])], PROOF_COMPLETE, 1), [], 'subsequence still fine')
  assert.deepEqual(bad([SEC('缺貨排序', [SOY, NAPA])], PROOF_COMPLETE, 1), [0], 'wrong order still dropped')
  assert.deepEqual(bad([SEC('缺貨排序', [NAPA, NOLA])], PROOF_INCOMPLETE, 1), [0], 'unproven still dropped')
})

/**
 * ⛔ REVISED, NOT DELETED — OWNER CONTRACT CHANGE, TASK 001. See the note above.
 * A ranking CLAIM with zero ranked sources now fails closed; what must stay true is that the
 * gate does not become a generic detector, which is asserted on the ordinary heading.
 */
test('*** ⛔ M5. ZERO RANKED SOURCES — A CLAIM FAILS CLOSED, AN ORDINARY SECTION DOES NOT ***', () => {
  assert.deepEqual(bad([SEC('缺貨排序', [NAPA, NOLA])], null, 0), [0],
    '⛔ a ranking claim shipped with no ranking proof')
  assert.deepEqual(bad([SEC('缺貨狀況', [NAPA, NOLA])], null, 0), [],
    '⛔ the gate fired on a turn that read nothing orderable')
})

/* ═══ ⛔ THE LIVE-SHAPED MULTI-SOURCE ESCAPE ═════════════════════════════ */

/** Two reads in one turn, each carrying its OWN ranking — inventory and orderPlanning. */
function twoRankedSourceConnector () {
  const base = rankedConnector()
  return {
    connector: {
      async read (source, method) {
        const out = await base.connector.read(source)
        if (String(method).toLowerCase().includes('order')) {
          out.evidence.endpoint = 'orderPlanning'
          out.evidence.rankingMetric = RANKING_METRIC.SUGGESTED_ORDER_QTY
          out.evidence.rankingCompleteWithinScope = false
          out.evidence.limit = 100
        }
        return out
      }
    }
  }
}

const READ_ORDER = { intent: 'answer', mode: 'chat', reply: null, nextRead: { capability: 'aroma_system.replenishment' }, answerPlan: null }

test('*** ⛔ M6. LIVE: WITH TWO RANKED SOURCES A RANKING SECTION MUST NOT ESCAPE ***', async () => {
  await withEnv({}, async () => {
    // ⛔ The order is CORRECT against inventory. Before this round the caller passed no rows
    // for a two-source turn and the helper's own empty-rows early return reported no
    // violations — so this section skipped validation entirely and shipped.
    const out = await run(ASK, scriptedAdapter([
      READ, READ_ORDER, SECTION_PLAN_REF('缺貨項目排序', [NAPA, NOLA, SOY, JARS])
    ]), twoRankedSourceConnector())
    const reply = String(out && out.reply != null ? out.reply : '')
    assert.deepEqual(shippedOrder(reply), [],
      '⛔ an unattributable ranking section shipped: ' + JSON.stringify(reply))
    assert.ok(reply.trim().length > 0, '⛔ SILENCE — shipped: ' + JSON.stringify(reply))
  })
})
