'use strict'

/**
 * superlativeSection.test.js — a superlative HEADING is a ranking claim.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED IN PRODUCTION, requestId a3a51702-b136-430d-8994-7a20e890f0f9, bootCommit
 * ebd6071. The Owner asked 「現在缺貨最嚴重的是什麼？」 and the reply carried
 *
 *     「目前最缺的四項」   Jars 20 → Napa 75 → New Orleans 39 → Dark Soy 37
 *
 * a top-N claim contradicting the proven absolute-shortfall order. It shipped because the
 * detector wanted an ordering WORD or an enumerator, and 「最缺」 is neither.
 *
 * ⛔ AND THE ZERO-SOURCE EARLY EXIT WAS A SECOND BYPASS: a turn that read nothing orderable
 * returned before any heading was examined, so a superlative section could ship with no
 * ranking proof at all.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { classifySectionHeading, CLAIM_KIND, rankingSectionViolations, RANKING_METRIC } = require('./rankingProof')

/* ═══ COMMIT A — DETECTION ══════════════════════════════════════════════ */

const CLAIMS = [
  ['目前最缺的四項', CLAIM_KIND.TOP_N, 4, RANKING_METRIC.ABSOLUTE_SHORTFALL],
  ['最嚴重的三項', CLAIM_KIND.TOP_N, 3, RANKING_METRIC.ABSOLUTE_SHORTFALL],
  ['最緊急缺貨項目', CLAIM_KIND.SUPERLATIVE, null, RANKING_METRIC.ABSOLUTE_SHORTFALL],
  ['缺貨排序', CLAIM_KIND.ORDERING, null, RANKING_METRIC.ABSOLUTE_SHORTFALL],
  ['缺貨排名', CLAIM_KIND.ORDERING, null, RANKING_METRIC.ABSOLUTE_SHORTFALL]
]

for (const [heading, kind, n, metric] of CLAIMS) {
  test(`*** ⛔ 「${heading}」 IS A RANKING CLAIM (${kind}) ***`, () => {
    const c = classifySectionHeading(heading)
    assert.equal(c.claim, true, '⛔ not recognised as a claim')
    assert.equal(c.kind, kind)
    assert.equal(c.n, n, 'claimed N')
    assert.equal(c.metric, metric)
  })
}

test('*** ⛔ ORDINARY SET HEADINGS ARE NOT RANKINGS ***', () => {
  // ⛔ The whole gate must stay off ordinary factual sections. A superlative QUESTION does not
  // make 「缺貨狀況」 into a ranking, and neither does this classifier.
  for (const h of ['缺貨狀況', '缺貨項目', '目前庫存', '存貨清單', '']) {
    assert.equal(classifySectionHeading(h).claim, false, '⛔ false positive on ' + JSON.stringify(h))
  }
})

test('*** ⛔ A SUPERLATIVE OVER AN UNPROVEN MEASURE CARRIES metric: null ***', () => {
  // 最新/最近 are dates; 最少 is the opposite end; 最平/最貴 are prices. None is ordered here.
  for (const h of ['最新入貨', '最近入貨', '最少要補', '最平嗰幾項', '最貴三項']) {
    const c = classifySectionHeading(h)
    assert.equal(c.claim, true, h + ' is still a claim')
    assert.equal(c.metric, null, '⛔ an unproven measure borrowed the shortfall proof: ' + h)
  }
})

/* ═══ COMMIT A — GATE ORDER AND THE ZERO-SOURCE BYPASS ══════════════════ */

const NAPA = 'Napa Cabbage'
const JARS = 'Jars for Red Chili Oil'
const NOLA = 'New Orleans Style Sauce'
const SOY = 'Dark Soy Sauce'

const SEC = (heading, titles) => ({ heading, items: titles.map((t) => ({ title: t })) })
/** The proven order, 75 > 39 > 37 > 20. */
const ROWS = [NAPA, NOLA, SOY, JARS].map((t, i) => ({ title: t, canonical: 'aroma_system.inventory#' + (i + 1) }))
const PROOF = { rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingCompleteWithinScope: true }

const gate = (sections, over = {}) => rankingSectionViolations(Object.assign({
  sections, rankedRows: ROWS, rankingEvidence: PROOF, rankedSourceCount: 1
}, over))

test('*** ⛔ THE PRODUCTION DEFECT: 「目前最缺的四項」 IN THE WRONG ORDER IS REFUSED ***', () => {
  // The exact order the Owner received.
  assert.deepEqual(gate([SEC('目前最缺的四項', [JARS, NAPA, NOLA, SOY])]), [0])
})

test('*** ⛔ THE ZERO-SOURCE BYPASS IS CLOSED — a claim with NO proof is refused ***', () => {
  // ⛔ This is the case that used to return before any heading was read.
  assert.deepEqual(gate([SEC('目前最缺的四項', [NAPA, NOLA, SOY, JARS])], { rankedSourceCount: 0, rankedRows: [], rankingEvidence: null }), [0],
    '⛔ a ranking claim shipped with no ranking proof at all')
})

test('*** ⛔ AND A NON-CLAIM SECTION IS STILL UNTOUCHED WITH ZERO SOURCES ***', () => {
  assert.deepEqual(gate([SEC('缺貨狀況', [JARS, NAPA])], { rankedSourceCount: 0, rankedRows: [], rankingEvidence: null }), [],
    '⛔ the gate fired on an ordinary section')
})

test('*** ⛔ AN UNPROVEN METRIC IS REFUSED BEFORE ANY ORDER CHECK ***', () => {
  // Order is irrelevant: nothing proves a 「最新」 ordering, so it cannot ship either way.
  assert.deepEqual(gate([SEC('最新入貨三項', [NAPA, NOLA, SOY])]), [0])
  assert.deepEqual(gate([SEC('最少要補三項', [JARS, SOY, NOLA])]), [0])
})

test('*** ⛔ MULTIPLE RANKED SOURCES STAY FAIL CLOSED ***', () => {
  assert.deepEqual(gate([SEC('目前最缺的四項', [NAPA, NOLA, SOY, JARS])], { rankedSourceCount: 2 }), [0])
})

test('*** ⛔ AN INCOMPLETE PROOF IS REFUSED EVEN IN THE RIGHT ORDER ***', () => {
  assert.deepEqual(gate([SEC('目前最缺的四項', [NAPA, NOLA, SOY, JARS])], {
    rankingEvidence: { rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingCompleteWithinScope: false }
  }), [0])
})

test('*** and the correct top-four in the proven order is ALLOWED ***', () => {
  assert.deepEqual(gate([SEC('目前最缺的四項', [NAPA, NOLA, SOY, JARS])]), [])
})

/* ═══ COMMIT B — MEMBERSHIP, N, PREFIX, IDENTITY, METRIC ════════════════ */

const { VIOLATION, SECTION_STATUS } = require('./rankingProof')

/** Proven order A B C D E, by canonical identity. */
const ABCDE = ['A', 'B', 'C', 'D', 'E'].map((t, i) => ({ title: t, canonical: 'aroma_system.inventory#' + i }))
const S = (heading, titles) => ({ heading, items: titles.map((t) => ({ title: t })) })
const g5 = (sections) => rankingSectionViolations({
  sections, rankedRows: ABCDE, rankingEvidence: PROOF, rankedSourceCount: 1
})

test('*** ⛔ EXPLICIT TOP-N: exact membership, exact count, correct order ***', () => {
  assert.deepEqual(g5([S('最缺的四項', ['A', 'B', 'C', 'D'])]), [], 'A B C D passes')
  assert.deepEqual(g5([S('最缺的四項', ['A', 'B', 'C', 'Z'])]), [0], '⛔ A B C Z — Z is not in the top four')
  assert.deepEqual(g5([S('最缺的四項', ['A', 'B', 'C'])]), [0], '⛔ three items under 「四項」')
  assert.deepEqual(g5([S('最缺的四項', ['B', 'C', 'D', 'E'])]), [0], '⛔ B C D E — a sorted subsequence is not the top four')
  assert.deepEqual(g5([S('最缺的四項', ['A', 'C', 'B', 'D'])]), [0], '⛔ right set, wrong order')
})

test('*** ⛔ SUPERLATIVE WITH NO N: the items must be a proven PREFIX ***', () => {
  assert.deepEqual(g5([S('最緊急缺貨項目', ['A'])]), [], 'A')
  assert.deepEqual(g5([S('最緊急缺貨項目', ['A', 'B'])]), [], 'A B')
  assert.deepEqual(g5([S('最緊急缺貨項目', ['A', 'B', 'C'])]), [], 'A B C')
  assert.deepEqual(g5([S('最緊急缺貨項目', ['B'])]), [0], '⛔ B is not the worst')
  assert.deepEqual(g5([S('最緊急缺貨項目', ['A', 'C'])]), [0], '⛔ A C skips B')
})

test('*** ⛔ ONE-ITEM SUPERLATIVE: only the proven first qualifies ***', () => {
  // ⛔ Membership is NOT skipped just because there is a single row — that shortcut is exactly
  // how a wrong first place would ship.
  assert.deepEqual(g5([S('最缺嗰項', ['A'])]), [])
  for (const t of ['B', 'C', 'D', 'E']) {
    assert.deepEqual(g5([S('最缺嗰項', [t])]), [0], '⛔ ' + t + ' shipped as the worst')
  }
})

test('*** ⛔ ORDERING HEADINGS KEEP THE LEGITIMATE SUBSEQUENCE BEHAVIOUR ***', () => {
  assert.deepEqual(g5([S('缺貨排序', ['A', 'C', 'E'])]), [], 'a subsequence is a valid ordering')
  assert.deepEqual(g5([S('缺貨排序', ['C', 'A'])]), [0], '⛔ but not out of order')
})

test('*** ⛔ CANONICAL IDENTITY — DUPLICATE TITLES DO NOT COLLAPSE ***', () => {
  // Two distinct rows share the title 'A'. A title alone can no longer identify a row.
  const dup = [
    { title: 'A', canonical: 'aroma_system.inventory#1' },
    { title: 'A', canonical: 'aroma_system.inventory#2' },
    { title: 'C', canonical: 'aroma_system.inventory#3' }
  ]
  const r = rankingSectionViolations({ sections: [S('最缺的兩項', ['A', 'C'])], rankedRows: dup, rankingEvidence: PROOF, rankedSourceCount: 1 })
  assert.deepEqual(r, [0], '⛔ an ambiguous title resolved to a row')

  // With an explicit canonical ref it resolves and passes.
  const byRef = { heading: '最缺的兩項', items: [{ sourceId: 'aroma_system.inventory#1', title: 'A' }, { sourceId: 'aroma_system.inventory#2', title: 'A' }] }
  assert.deepEqual(rankingSectionViolations({ sections: [byRef], rankedRows: dup, rankingEvidence: PROOF, rankedSourceCount: 1 }), [],
    'canonical refs identify the two rows exactly')
})

test('*** ⛔ METRIC MISMATCH FAILS CLOSED, WHATEVER THE ORDER ***', () => {
  for (const h of ['最新三項', '最少要補三項', '最平三項']) {
    assert.deepEqual(g5([S(h, ['A', 'B', 'C'])]), [0], '⛔ ' + h + ' borrowed the shortfall proof')
  }
})

/* ═══ COMMIT B — OBSERVABILITY (enum + count only) ══════════════════════ */

const verdicts = (sections, over = {}) => {
  const seen = []
  rankingSectionViolations(Object.assign({ sections, rankedRows: ABCDE, rankingEvidence: PROOF, rankedSourceCount: 1, onVerdict: (v) => seen.push(v) }, over))
  return seen
}

test('*** ⛔ EACH OUTCOME IS REPORTED AS AN ENUM PLUS A COUNT ***', () => {
  assert.deepEqual(verdicts([S('缺貨狀況', ['A'])]), [{ status: SECTION_STATUS.NOT_DETECTED, reason: null, rankedSourceCount: 1 }])
  assert.deepEqual(verdicts([S('最缺的四項', ['A', 'B', 'C', 'D'])]), [{ status: SECTION_STATUS.ALLOWED, reason: null, rankedSourceCount: 1 }])
  assert.deepEqual(verdicts([S('最缺的四項', ['A', 'C', 'B', 'D'])]), [{ status: SECTION_STATUS.REJECTED, reason: VIOLATION.ORDER_MISMATCH, rankedSourceCount: 1 }])
  assert.deepEqual(verdicts([S('最缺的四項', ['B', 'C', 'D', 'E'])]), [{ status: SECTION_STATUS.REJECTED, reason: VIOLATION.MEMBERSHIP_MISMATCH, rankedSourceCount: 1 }])
  assert.deepEqual(verdicts([S('最新三項', ['A'])]), [{ status: SECTION_STATUS.REJECTED, reason: VIOLATION.METRIC_NOT_PROVEN, rankedSourceCount: 1 }])
  assert.deepEqual(verdicts([S('最缺的四項', ['A'])], { rankedSourceCount: 0, rankedRows: [], rankingEvidence: null }),
    [{ status: SECTION_STATUS.REJECTED, reason: VIOLATION.NO_RANKING_PROOF, rankedSourceCount: 0 }])
  assert.deepEqual(verdicts([S('最缺的四項', ['A'])], { rankingEvidence: { rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingCompleteWithinScope: false } }),
    [{ status: SECTION_STATUS.REJECTED, reason: VIOLATION.RANKING_INCOMPLETE, rankedSourceCount: 1 }])
})

test('*** ⛔ NO HEADING, TITLE, VALUE OR MESSAGE REACHES THE VERDICT ***', () => {
  const heading = '最缺的四項 SECRET-HEADING'
  const seen = verdicts([{ heading, items: [{ title: 'Napa Cabbage', facts: [{ field: '缺口', value: '75' }] }] }])
  const json = JSON.stringify(seen)
  for (const banned of [heading, 'SECRET-HEADING', 'Napa Cabbage', '75', '缺口']) {
    assert.ok(!json.includes(banned), '⛔ content reached the verdict: ' + json)
  }
  // Every emitted name is closed and fits the 20-char log field.
  for (const v of seen) {
    if (v.reason) assert.ok(Object.values(VIOLATION).includes(v.reason) && v.reason.length <= 20, v.reason)
    assert.ok(Object.values(SECTION_STATUS).includes(v.status) && v.status.length <= 20, v.status)
  }
})

/* ═══ ⛔ MANDATORY INTEGRATION — THE OWNER MUST STILL RECEIVE WORDS ═════ */

/**
 * ⛔ MEASURED, NOT INFERRED. Earlier this week it was established that `ensureNonEmptyReply`
 * at intakeService.js:2380 is NOT reached on the answer-plan path — that branch returns at
 * :2305 — and that `minimalAnswer` is what actually protects it. So when the only section is
 * a refused ranking and `directAnswer` does not survive, the reply has to be executed and
 * looked at, not reasoned about from `renderValidatedPlan`.
 */
const { processIntake } = require('./intakeService')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')

const NOW = '2026-08-09T00:00:00.000Z'
const LIVE_ROWS = [
  { title: NAPA, id: '1', shortfall: 75 },
  { title: NOLA, id: '2', shortfall: 39 },
  { title: SOY, id: '3', shortfall: 37 },
  { title: JARS, id: '4', shortfall: 20 }
]

async function withEnv (fn) {
  const all = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on', [A4_AMBIGUITY_FLAG]: 'on' }
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const liveConnector = () => ({
  async read (source) {
    return {
      asOf: NOW,
      source,
      count: LIVE_ROWS.length,
      results: LIVE_ROWS.map((r) => ({ source, sourceId: r.id, title: r.title, entityType: 'inventory_item', content: 'x', fields: { id: r.id, parLevel: '100', currentStock: String(100 - r.shortfall) }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null })),
      evidence: {
        source: 'aroma_system', entityType: 'inventory_item', endpoint: 'inventory',
        returnedRows: 199, shownCount: 4, matchingTotal: 199, sourceTotal: null,
        queryScope: { field: null, window: null, declaredBy: 'reader' }, filtersApplied: null,
        limit: null, limitKnown: true, truncated: false, completeWithinScope: true,
        rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, derivations: {}, fieldLabels: {},
        completeness: 'sample', rankedBy: 'parLevel - currentStock desc',
        rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingDirection: 'desc', rankingCompleteWithinScope: true,
        dataAsOf: null, retrievedAt: NOW, trust: 'live', provenance: 'FAKE'
      }
    }
  }
})

const scripted = (envelopes) => {
  let n = 0
  return { label: 'claude', async complete () { const e = envelopes[Math.min(n++, envelopes.length - 1)]; return { text: JSON.stringify(e), usage: { inputTokens: 1, outputTokens: 1 } } } }
}

test('*** ⛔ INTEGRATION: THE PRODUCTION SECTION IS REFUSED AND THE REPLY IS NOT EMPTY ***', async () => {
  await withEnv(async () => {
    // The exact shape of requestId a3a51702: a top-N heading in the wrong order, and a
    // directAnswer that cannot survive on its own.
    const out = await processIntake('現在缺貨最嚴重的是什麼？', scripted([
      { intent: 'answer', mode: 'chat', reply: null, nextRead: { capability: 'aroma_system.inventory' }, answerPlan: null },
      {
        intent: 'answer',
        mode: 'chat',
        reply: '',
        nextRead: null,
        answerPlan: {
          directAnswer: '',
          sections: [{ heading: '目前最缺的四項', items: [JARS, NAPA, NOLA, SOY].map((t) => ({ sourceId: LIVE_ROWS.find((r) => r.title === t).id, title: t, facts: [] })) }],
          limitations: [], followUp: null, unanswerable: false, citesEvidence: true
        }
      }
    ]), [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
      readContextDeps: { connector: liveConnector(), sources: ['aroma_system', 'public_knowledge'], sourceIntentResolver: async () => ({ intent: 'internal' }) }
    })

    const reply = String(out && out.reply != null ? out.reply : '')
    // ⛔ The contradicting order must not reach the Owner…
    const jars = reply.indexOf(JARS)
    const napa = reply.indexOf(NAPA)
    assert.ok(!(jars >= 0 && napa >= 0 && jars < napa), '⛔ the refused ranking shipped: ' + reply)
    // …and silence must not either. EXECUTED, not inferred.
    assert.ok(reply.trim().length > 0, '⛔ SILENCE — shipped: ' + JSON.stringify(reply))
  })
})
