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

const { looksLikeRankingHeading, rankingSectionViolations, RANKING_METRIC } = require('./rankingProof')

/* ═══ COMMIT A — DETECTION ══════════════════════════════════════════════ */

/**
 * ⛔ TASK 001-H — THESE HEADINGS ARE NO LONGER READ, THEY ARE ONLY RECOGNISED.
 *
 * This block used to assert what each heading MEANT: its kind, its N, its metric. Four rounds
 * of blockers established that a heading cannot be asked how many — 「最缺一億二項」 answered 2,
 * 「最缺卄項」 answered nothing at all, and 「最缺四項食材」 answered nothing because a noun
 * followed the counter. The count is now DECLARED and the heading is a leak-guard.
 *
 * ⛔ SO THE PROPERTY WORTH PINNING FLIPPED. It is no longer 「this heading means top-4」; it is
 * 「this heading cannot ship without a declaration」 — a strictly stronger statement, because it
 * holds for every one of the shapes the parser got wrong.
 */
const PRESENTS_AS_RANKING = ['目前最缺的四項', '最嚴重的三項', '最緊急缺貨項目', '缺貨排序', '缺貨排名',
  '最新入貨', '最少要補', '最平嗰幾項', '最貴三項',
  // the four blockers, each of which once produced a wrong count or none
  '最缺一億二項', '最缺壱十二項', '最缺卄項', '目前最缺四項食材']

for (const heading of PRESENTS_AS_RANKING) {
  test(`*** ⛔ 「${heading}」 PRESENTS AS A RANKING AND CANNOT SHIP UNDECLARED ***`, () => {
    assert.equal(looksLikeRankingHeading(heading), true, '⛔ the leak-guard missed it')
  })
}


test('*** ⛔ ORDINARY SET HEADINGS ARE NOT RANKINGS ***', () => {
  // ⛔ The whole gate must stay off ordinary factual sections. A superlative QUESTION does not
  // make 「缺貨狀況」 into a ranking, and neither does this classifier.
  for (const h of ['缺貨狀況', '缺貨項目', '目前庫存', '存貨清單', '']) {
    assert.equal(looksLikeRankingHeading(h), false, '⛔ false positive on ' + JSON.stringify(h))
  }
})

test('*** ⛔ A MEASURE NOTHING ORDERED IS STILL RECOGNISED — and cannot ship undeclared ***', () => {
  /**
   * 最新/最近 are dates, 最少 is the opposite end, 最平/最貴 are prices. None is ordered here.
   * The classifier used to answer 「metric: null」 for these and the gate refused them on that.
   * ⛔ NOW THERE ARE TWO GUARDS INSTEAD OF ONE, and both are stronger than the word test:
   *   · undeclared, the leak-guard refuses the section outright (asserted here);
   *   · declared, the metric must equal the proof's (asserted in the metric tests below).
   * And a heading naming a measure the turn cannot prove never reaches the Owner either way,
   * because an allowed ranking section is retitled by the server.
   */
  for (const h of ['最新入貨', '最近入貨', '最少要補', '最平嗰幾項', '最貴三項']) {
    assert.equal(looksLikeRankingHeading(h), true, '⛔ an unproven measure could ship undeclared: ' + h)
  }
})

/* ═══ COMMIT A — GATE ORDER AND THE ZERO-SOURCE BYPASS ══════════════════ */

const NAPA = 'Napa Cabbage'
const JARS = 'Jars for Red Chili Oil'
const NOLA = 'New Orleans Style Sauce'
const SOY = 'Dark Soy Sauce'

const SEC = (heading, titles, rankingClaim) => ({ heading, rankingClaim: rankingClaim || null, items: titles.map((t) => ({ title: t })) })

/** The declarations these fixtures make. A declaration is a statement, never an entitlement. */
const TOP = (n) => ({ kind: 'top_n', n, metric: RANKING_METRIC.ABSOLUTE_SHORTFALL })
const SUP = { kind: 'superlative', n: null, metric: RANKING_METRIC.ABSOLUTE_SHORTFALL }
const ORD = { kind: 'ordering', n: null, metric: null }
/** ⛔ A REAL ORDERING, AND THE WRONG ONE. `orderPlanning` proves this; `inventory` does not. */
const OTHER_METRIC = (n) => ({ kind: 'top_n', n, metric: RANKING_METRIC.SUGGESTED_ORDER_QTY })
/** The proven order, 75 > 39 > 37 > 20. */
const ROWS = [NAPA, NOLA, SOY, JARS].map((t, i) => ({ title: t, canonical: 'aroma_system.inventory#' + (i + 1) }))
const PROOF = { rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingCompleteWithinScope: true }

const gate = (sections, over = {}) => rankingSectionViolations(Object.assign({
  sections, rankedRows: ROWS, rankingEvidence: PROOF, rankedSourceCount: 1
}, over))

test('*** ⛔ THE PRODUCTION DEFECT: 「目前最缺的四項」 IN THE WRONG ORDER IS REFUSED ***', () => {
  // The exact order the Owner received.
  assert.deepEqual(gate([SEC('目前最缺的四項', [JARS, NAPA, NOLA, SOY], TOP(4))]), [0])
})

test('*** ⛔ THE ZERO-SOURCE BYPASS IS CLOSED — a claim with NO proof is refused ***', () => {
  // ⛔ This is the case that used to return before any heading was read.
  assert.deepEqual(gate([SEC('目前最缺的四項', [NAPA, NOLA, SOY, JARS], TOP(4))], { rankedSourceCount: 0, rankedRows: [], rankingEvidence: null }), [0],
    '⛔ a ranking claim shipped with no ranking proof at all')
})

test('*** ⛔ AND A NON-CLAIM SECTION IS STILL UNTOUCHED WITH ZERO SOURCES ***', () => {
  assert.deepEqual(gate([SEC('缺貨狀況', [JARS, NAPA])], { rankedSourceCount: 0, rankedRows: [], rankingEvidence: null }), [],
    '⛔ the gate fired on an ordinary section')
})

test('*** ⛔ AN UNPROVEN METRIC IS REFUSED BEFORE ANY ORDER CHECK ***', () => {
  // Order is irrelevant: nothing proves a 「最新」 ordering, so it cannot ship either way.
  assert.deepEqual(gate([SEC('最新入貨三項', [NAPA, NOLA, SOY], OTHER_METRIC(3))]), [0])
  assert.deepEqual(gate([SEC('最少要補三項', [JARS, SOY, NOLA], OTHER_METRIC(3))]), [0])
})

test('*** ⛔ MULTIPLE RANKED SOURCES STAY FAIL CLOSED ***', () => {
  assert.deepEqual(gate([SEC('目前最缺的四項', [NAPA, NOLA, SOY, JARS], TOP(4))], { rankedSourceCount: 2 }), [0])
})

test('*** ⛔ AN INCOMPLETE PROOF IS REFUSED EVEN IN THE RIGHT ORDER ***', () => {
  assert.deepEqual(gate([SEC('目前最缺的四項', [NAPA, NOLA, SOY, JARS], TOP(4))], {
    rankingEvidence: { rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingCompleteWithinScope: false }
  }), [0])
})

test('*** and the correct top-four in the proven order is ALLOWED ***', () => {
  assert.deepEqual(gate([SEC('目前最缺的四項', [NAPA, NOLA, SOY, JARS], TOP(4))]), [])
})

/* ═══ COMMIT B — MEMBERSHIP, N, PREFIX, IDENTITY, METRIC ════════════════ */

const { VIOLATION, SECTION_STATUS } = require('./rankingProof')

/** Proven order A B C D E, by canonical identity. */
const ABCDE = ['A', 'B', 'C', 'D', 'E'].map((t, i) => ({ title: t, canonical: 'aroma_system.inventory#' + i }))
const S = (heading, titles, rankingClaim) => ({ heading, rankingClaim: rankingClaim || null, items: titles.map((t) => ({ title: t })) })
const g5 = (sections) => rankingSectionViolations({
  sections, rankedRows: ABCDE, rankingEvidence: PROOF, rankedSourceCount: 1
})

test('*** ⛔ EXPLICIT TOP-N: exact membership, exact count, correct order ***', () => {
  assert.deepEqual(g5([S('最缺的四項', ['A', 'B', 'C', 'D'], TOP(4))]), [], 'A B C D passes')
  assert.deepEqual(g5([S('最缺的四項', ['A', 'B', 'C', 'Z'], TOP(4))]), [0], '⛔ A B C Z — Z is not in the top four')
  assert.deepEqual(g5([S('最缺的四項', ['A', 'B', 'C'], TOP(4))]), [0], '⛔ three items under 「四項」')
  assert.deepEqual(g5([S('最缺的四項', ['B', 'C', 'D', 'E'], TOP(4))]), [0], '⛔ B C D E — a sorted subsequence is not the top four')
  assert.deepEqual(g5([S('最缺的四項', ['A', 'C', 'B', 'D'], TOP(4))]), [0], '⛔ right set, wrong order')
})

test('*** ⛔ SUPERLATIVE WITH NO N: the items must be a proven PREFIX ***', () => {
  assert.deepEqual(g5([S('最緊急缺貨項目', ['A'], SUP)]), [], 'A')
  assert.deepEqual(g5([S('最緊急缺貨項目', ['A', 'B'], SUP)]), [], 'A B')
  assert.deepEqual(g5([S('最緊急缺貨項目', ['A', 'B', 'C'], SUP)]), [], 'A B C')
  assert.deepEqual(g5([S('最緊急缺貨項目', ['B'], SUP)]), [0], '⛔ B is not the worst')
  assert.deepEqual(g5([S('最緊急缺貨項目', ['A', 'C'], SUP)]), [0], '⛔ A C skips B')
})

test('*** ⛔ ONE-ITEM SUPERLATIVE: only the proven first qualifies ***', () => {
  // ⛔ Membership is NOT skipped just because there is a single row — that shortcut is exactly
  // how a wrong first place would ship.
  assert.deepEqual(g5([S('最缺嗰項', ['A'], SUP)]), [])
  for (const t of ['B', 'C', 'D', 'E']) {
    assert.deepEqual(g5([S('最缺嗰項', [t], SUP)]), [0], '⛔ ' + t + ' shipped as the worst')
  }
})

test('*** ⛔ ORDERING HEADINGS KEEP THE LEGITIMATE SUBSEQUENCE BEHAVIOUR ***', () => {
  assert.deepEqual(g5([S('缺貨排序', ['A', 'C', 'E'], ORD)]), [], 'a subsequence is a valid ordering')
  assert.deepEqual(g5([S('缺貨排序', ['C', 'A'], ORD)]), [0], '⛔ but not out of order')
})

test('*** ⛔ CANONICAL IDENTITY — DUPLICATE TITLES DO NOT COLLAPSE ***', () => {
  // Two distinct rows share the title 'A'. A title alone can no longer identify a row.
  const dup = [
    { title: 'A', canonical: 'aroma_system.inventory#1' },
    { title: 'A', canonical: 'aroma_system.inventory#2' },
    { title: 'C', canonical: 'aroma_system.inventory#3' }
  ]
  const r = rankingSectionViolations({ sections: [S('最缺的兩項', ['A', 'C'], TOP(2))], rankedRows: dup, rankingEvidence: PROOF, rankedSourceCount: 1 })
  assert.deepEqual(r, [0], '⛔ an ambiguous title resolved to a row')

  // With an explicit canonical ref it resolves and passes.
  const byRef = { heading: '最缺的兩項', rankingClaim: TOP(2), items: [{ sourceId: 'aroma_system.inventory#1', title: 'A' }, { sourceId: 'aroma_system.inventory#2', title: 'A' }] }
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
  assert.deepEqual(verdicts([S('最缺的四項', ['A', 'B', 'C', 'D'], TOP(4))]), [{ status: SECTION_STATUS.ALLOWED, reason: null, rankedSourceCount: 1 }])
  assert.deepEqual(verdicts([S('最缺的四項', ['A', 'C', 'B', 'D'], TOP(4))]), [{ status: SECTION_STATUS.REJECTED, reason: VIOLATION.ORDER_MISMATCH, rankedSourceCount: 1 }])
  assert.deepEqual(verdicts([S('最缺的四項', ['B', 'C', 'D', 'E'], TOP(4))]), [{ status: SECTION_STATUS.REJECTED, reason: VIOLATION.MEMBERSHIP_MISMATCH, rankedSourceCount: 1 }])
  assert.deepEqual(verdicts([S('最新三項', ['A'], OTHER_METRIC(3))]), [{ status: SECTION_STATUS.REJECTED, reason: VIOLATION.METRIC_NOT_PROVEN, rankedSourceCount: 1 }])
  assert.deepEqual(verdicts([S('最缺的四項', ['A'], TOP(4))], { rankedSourceCount: 0, rankedRows: [], rankingEvidence: null }),
    [{ status: SECTION_STATUS.REJECTED, reason: VIOLATION.NO_RANKING_PROOF, rankedSourceCount: 0 }])
  assert.deepEqual(verdicts([S('最缺的四項', ['A'], TOP(4))], { rankingEvidence: { rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingCompleteWithinScope: false } }),
    [{ status: SECTION_STATUS.REJECTED, reason: VIOLATION.RANKING_INCOMPLETE, rankedSourceCount: 1 }])
})

test('*** ⛔ NO HEADING, TITLE, VALUE OR MESSAGE REACHES THE VERDICT ***', () => {
  const heading = '最缺的四項 SECRET-HEADING'
  const seen = verdicts([{ heading, rankingClaim: TOP(4), items: [{ title: 'Napa Cabbage', facts: [{ field: '缺口', value: '75' }] }] }])
  const json = JSON.stringify(seen)
  for (const banned of [heading, 'SECRET-HEADING', 'Napa Cabbage', '75', '缺口']) {
    assert.ok(!json.includes(banned), '⛔ content reached the verdict: ' + json)
  }
  // Every emitted name is closed and fits the 20-char log field.
  for (const v of seen) {
    if (v.reason) assert.ok(Object.values(VIOLATION).includes(v.reason), v.reason)
    assert.ok(Object.values(SECTION_STATUS).includes(v.status) && v.status.length <= 20, v.status)
  }
  /**
   * ⛔ THE REAL CONSTRAINT, MEASURED RATHER THAN GUESSED AT. The earlier rule was 「<= 20 chars」
   * because two names truncated to the same string would be indistinguishable in the log. The
   * `why` field is truncated at `maxDropIdChars` (40), not 20 — `shape` is the 20-char field —
   * so what has to hold is that the names stay DISTINCT after truncation, which is the property
   * the length rule was standing in for. `ranking_claim_missing` is 21 characters.
   */
  const names = Object.values(VIOLATION)
  assert.equal(new Set(names.map((x) => x.slice(0, 40))).size, names.length, '⛔ two verdicts collide in the log')
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
          sections: [{ heading: '目前最缺的四項', rankingClaim: { kind: 'top_n', n: 4, metric: 'absolute_shortfall' }, items: [JARS, NAPA, NOLA, SOY].map((t) => ({ sourceId: LIVE_ROWS.find((r) => r.title === t).id, title: t, facts: [] })) }],
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
