'use strict'

/**
 * sectionClaimFinal.test.js — Commit D, the last three reviewer blockers.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ 5. ABSENCE WAS ENCODING TWO STATES. The caller discarded `not_detected` and only
 *    rejections reached `drops`, so in a real ANSWER_PLAN line 「no claim detected」 and
 *    「claim evaluated and allowed」 were BOTH an empty array — and the Commit C tests asserted
 *    exactly that, pinning the gap as correct. A gap held in place by a passing test is harder
 *    to find than the gap alone.
 *
 * ⛔ 6. THE PROOF WAS BOUND TO A SOURCE, NOT AN OPERATION. `find(g.source === evidence.source)`
 *    can return the INVOICES group on a turn that read invoices then inventory, so an inventory
 *    proof validated a section against invoice rows. Commit C fixed identity WITHIN rows; it did
 *    not fix WHICH GROUP the proof owns.
 *
 * ⛔ 7. THE CJK RUN COULD RESTART AFTER AN UNSUPPORTED CHARACTER. 「最缺一百二項」 matched the
 *    trailing 「二項」 and became N=2 — the same silent count substitution, one character further
 *    along.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { RANKING_METRIC } = require('./rankingProof')
const { validatePlan, logAnswerPlan } = require('./answerPlan')

/* ── shared production-shaped fixtures ────────────────────────────────── */

const invRow = (id, title) => ({ source: 'aroma_system', readKey: 'aroma_system.inventory', sourceId: id, title, entityType: 'inventory_item', content: 'x', fields: { id }, trust: 'live' })
const invRows = [invRow('1', 'A'), invRow('2', 'B'), invRow('3', 'C')]

const invEvidence = (over) => Object.assign({
  // ⛔ readKey IS what production attaches (readContext.js:840) and is the operation identity.
  // Omitting it was the false-green shape blocker 8 exposed — the fixture could not fail.
  source: 'aroma_system', entityType: 'inventory_item', endpoint: 'inventory',
  readKey: 'aroma_system.inventory', trust: 'live',
  shownCount: 3, matchingTotal: 199, sourceTotal: null,
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  rowShape: { hasLocation: false, hasAsOf: false, note: null },
  metrics: {}, derivations: {}, fieldLabels: {}, completeness: 'sample',
  rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL, rankingDirection: 'desc', rankingCompleteWithinScope: true
}, over || {})

const SEC = (heading, ids, rankingClaim, rows = invRows) => ({
  heading,
  rankingClaim: rankingClaim || null,
  items: ids.map((id) => ({ sourceId: id, title: (rows.find((r) => r.sourceId === id) || {}).title, facts: [] }))
})

/** ⛔ TASK 001-H: the claim is DECLARED beside the section; the heading only guards leaks. */
const TOP = (n) => ({ kind: 'top_n', n, metric: RANKING_METRIC.ABSOLUTE_SHORTFALL })

/** Run the REAL validatePlan, then the REAL logAnswerPlan projection. */
function logLine (sections, evidenceSets, itemsBySource) {
  const r = validatePlan({ directAnswer: '', sections, limitations: [], followUp: null, unanswerable: false, citesEvidence: true },
    { evidenceSets, itemsBySource, message: '而家倉存情況點？' })
  const lines = []
  logAnswerPlan({
    requestId: '11111111-2222-4333-8444-555555555555',
    outcome: 'degraded', reason: 'answer_unsupported',
    droppedItems: r.droppedItems, droppedFacts: r.droppedFacts, droppedSentences: r.droppedSentences,
    droppedLimitations: 0, modelItemCount: r.modelItemCount, keptItemCount: r.keptItemCount,
    drops: r.drops, rankingVerdicts: r.rankingVerdicts
  }, (l) => lines.push(l))
  return lines[0]
}

const invOnly = (sections, evOver) => logLine(sections, [invEvidence(evOver)], [{ source: 'aroma_system', readKey: 'aroma_system.inventory', items: invRows }])

/* ═══ BLOCKER 5 — all three statuses reach the real log ═════════════════ */

test('*** D5. ⛔ not_detected AND evaluated_allowed ARE DISTINGUISHABLE IN THE LOG ***', () => {
  const notDetected = invOnly([SEC('缺貨狀況', ['2', '1'])])
  const allowed = invOnly([SEC('最缺的兩項', ['1', '2'], TOP(2))])

  // ⛔ BOTH used to be an empty `dropped` array and nothing else.
  assert.deepEqual(notDetected.dropped.filter((d) => d.field === 'ranking_section'), [], 'still no drop')
  assert.deepEqual(allowed.dropped.filter((d) => d.field === 'ranking_section'), [], 'still no drop')

  assert.deepEqual(notDetected.rankingGate, [{ status: 'not_detected', reason: null, rankedSourceCount: 1 }])
  assert.deepEqual(allowed.rankingGate, [{ status: 'evaluated_allowed', reason: null, rankedSourceCount: 1 }])
  assert.notDeepEqual(notDetected.rankingGate, allowed.rankingGate,
    '⛔ absence is still the encoding for two different states')
})

test('*** D5b. ⛔ AND A REJECTION CARRIES STATUS, REASON AND COUNT ***', () => {
  const line = invOnly([SEC('最缺的兩項', ['2', '1'], TOP(2))])
  assert.deepEqual(line.rankingGate, [{ status: 'evaluated_rejected', reason: 'order_mismatch', rankedSourceCount: 1 }])
})

test('*** D5c. ⛔ THE SUMMARY CARRIES NO CONTENT — enum and count only ***', () => {
  const rows = [invRow('1', 'Napa Cabbage'), invRow('2', 'Jars for Red Chili Oil')]
  const sec = { heading: '目前最缺的兩項', rankingClaim: TOP(2), items: [{ sourceId: '2', title: 'Jars for Red Chili Oil', facts: [{ field: '缺口', value: '75' }] }, { sourceId: '1', title: 'Napa Cabbage', facts: [] }] }
  const line = logLine([sec], [invEvidence()], [{ source: 'aroma_system', readKey: 'aroma_system.inventory', items: rows }])
  const json = JSON.stringify(line.rankingGate)
  for (const banned of ['目前最缺的兩項', 'Napa Cabbage', 'Jars for Red Chili Oil', '75', '缺口', '而家倉存情況點']) {
    assert.ok(!json.includes(banned), '⛔ content reached the summary: ' + json)
  }
  // Closed vocabulary, and every name inside the field budget.
  const STATUS = new Set(['not_detected', 'evaluated_allowed', 'evaluated_rejected'])
  const REASON = new Set(['no_ranking_proof', 'metric_not_proven', 'ranking_incomplete',
    'membership_mismatch', 'order_mismatch', 'cardinality_mismatch',
    'ranking_claim_missing', 'ranking_claim_invalid'])
  for (const v of line.rankingGate) {
    assert.ok(STATUS.has(v.status), '⛔ unenumerated status: ' + v.status)
    if (v.reason) assert.ok(REASON.has(v.reason), '⛔ unenumerated reason: ' + v.reason)
    assert.ok(Number.isFinite(v.rankedSourceCount))
  }
})

/* ═══ BLOCKER 6 — the proof owns an OPERATION, not a source ═════════════ */

/**
 * ⛔ THE COUNTER-EXAMPLE, PRODUCTION-SHAPED. Two groups under ONE source. Only inventory has a
 * ranking proof. The invoice rows are deliberately in an order that WOULD satisfy a top-two
 * claim — so under the old source-only binding the claim passes against invoice rows, which is
 * exactly the wrong value having somewhere to land.
 */
const invcRow = (id, title) => ({ source: 'aroma_system', readKey: 'aroma_system.invoices', sourceId: id, title, entityType: 'invoice', content: 'x', fields: { id }, trust: 'live' })
const invcRows = [invcRow('9', 'INV-9'), invcRow('8', 'INV-8')]
const invoiceEvidence = Object.assign({}, invEvidence(), { endpoint: 'invoices', entityType: 'invoice', rankingMetric: undefined })
delete invoiceEvidence.rankingMetric

/** Invoices FIRST in itemsBySource, so `find(g.source === …)` returns the wrong group. */
const TWO_GROUPS = [
  { source: 'aroma_system', readKey: 'aroma_system.invoices', items: invcRows },
  { source: 'aroma_system', readKey: 'aroma_system.inventory', items: invRows }
]

test('*** D6. ⛔ AN INVENTORY PROOF MAY NOT VALIDATE A SECTION OF INVOICE ROWS ***', () => {
  const sec = { heading: '最缺的兩項', rankingClaim: TOP(2), items: [{ sourceId: '9', title: 'INV-9', facts: [] }, { sourceId: '8', title: 'INV-8', facts: [] }] }
  const line = logLine([sec], [invoiceEvidence, invEvidence()], TWO_GROUPS)
  const v = line.rankingGate[0]
  assert.equal(v.status, 'evaluated_rejected', '⛔ invoice rows were validated by the inventory proof')
  /**
   * ⛔ THE REASON CHANGED, THE REFUSAL DID NOT — section-local proof binding.
   * This used to read `membership_mismatch`: the invoice rows were compared against the
   * inventory proof and were not in it. Now the section names its own operation first, finds
   * that `aroma_system.invoices` has no ranking proof at all, and says so. Both are true; the
   * second is the one a repair can act on.
   */
  assert.equal(v.reason, 'no_ranking_proof', 'reason: ' + v.reason)
})

test('*** D6b. ⛔ AND THE INVENTORY SECTION IN THE SAME TURN STILL PASSES ***', () => {
  // The proof owns the inventory group, so its own correct top-two is allowed.
  const line = logLine([SEC('最缺的兩項', ['1', '2'], TOP(2))], [invoiceEvidence, invEvidence()], TWO_GROUPS)
  assert.deepEqual(line.rankingGate, [{ status: 'evaluated_allowed', reason: null, rankedSourceCount: 1 }])
})

test('*** D6c. ⛔ NO GROUP FOR THE PROOF MEANS NO USABLE PROOF ***', () => {
  // The proof names `inventory`, but only the invoices group was retrieved.
  const sec = { heading: '最缺的兩項', rankingClaim: TOP(2), items: [{ sourceId: '9', title: 'INV-9', facts: [] }] }
  const line = logLine([sec], [invEvidence()], [{ source: 'aroma_system', readKey: 'aroma_system.invoices', items: invcRows }])
  const v = line.rankingGate[0]
  assert.equal(v.status, 'evaluated_rejected')
  assert.equal(v.reason, 'no_ranking_proof', 'reason: ' + v.reason)
  assert.equal(v.rankedSourceCount, 0, 'reported honestly as no usable proof')
})

/* ═══ BLOCKER 7 — the run must never restart after an unsupported char ══ */

/**
 * ⛔ TASK 001-H — BLOCKER 7 WAS A PARSING BLOCKER TOO, and it was the third of five.
 *
 * 「最缺一百二項」 matched the trailing 二項 and became a top-2. The fix widened a character
 * class; Blockers 9, 10, 11 and 12 then found four more characters and one grammar shape it
 * did not cover. No count is read from a heading now, so this whole family has no mechanism —
 * and the property it protected is asserted on the declared count instead.
 */

test('*** D7. ⛔ A HEADING NAMING A COUNT IT DID NOT DECLARE FAILS CLOSED ***', () => {
  // ⛔ '1','2' ARE the proven top two, so anything that quietly became a top-2 would PASS.
  for (const h of ['最缺一百項', '最缺一百二項', '最缺卄項', '目前最缺四項食材']) {
    const line = invOnly([SEC(h, ['1', '2'], null)])
    assert.equal(line.rankingGate[0].status, 'evaluated_rejected', h)
    assert.equal(line.rankingGate[0].reason, 'ranking_claim_missing', h + ': ' + line.rankingGate[0].reason)
  }
})

test('*** D7b. ⛔ AND A DECLARED COUNT LARGER THAN THE SECTION IS REFUSED ***', () => {
  const line = invOnly([SEC('最缺一百二項', ['1', '2'], TOP(102))])
  assert.equal(line.rankingGate[0].status, 'evaluated_rejected')
  assert.equal(line.rankingGate[0].reason, 'cardinality_mismatch', 'reason: ' + line.rankingGate[0].reason)
})

test('*** D7c. and an honest declared count still passes ***', () => {
  const line = invOnly([SEC('最缺兩項', ['1', '2'], TOP(2))])
  assert.equal(line.rankingGate[0].status, 'evaluated_allowed', 'reason: ' + line.rankingGate[0].reason)
})

/* ═══ ⛔ THE SEAM ITSELF — validatePlan -> readResultView -> the log ═════ */

/**
 * ⛔ ADDED BECAUSE A MUTATION STAYED GREEN. Breaking the readResultView seam
 * (`rankingVerdicts: undefined`) left every test above passing, because they call
 * `logAnswerPlan` directly with the verdicts in hand. That is the same shape as the whole
 * blocker: a summary that exists but never travels. This runs the REAL turn.
 */
const { processIntake } = require('./intakeService')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')

const NOW = '2026-08-09T00:00:00.000Z'

async function withEnv (fn) {
  const all = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on', [A4_AMBIGUITY_FLAG]: 'on' }
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

test('*** D5d. LIVE: THE GATE SUMMARY REACHES THE REAL ANSWER_PLAN LINE ***', async () => {
  await withEnv(async () => {
    const rows = [['A', '1', 70], ['B', '2', 39], ['C', '3', 20]]
    const connector = {
      async read (source) {
        return {
          asOf: NOW, source, count: rows.length,
          results: rows.map(([t, id, sf]) => ({ source, sourceId: id, title: t, entityType: 'inventory_item', content: 'x', fields: { id, parLevel: '100', currentStock: String(100 - sf) }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null })),
          evidence: invEvidence({ shownCount: rows.length, returnedRows: 199, limit: null, limitKnown: true, truncated: false, completeWithinScope: true, rankedBy: 'x', dataAsOf: null, retrievedAt: NOW, provenance: 'FAKE' })
        }
      }
    }
    let n = 0
    const envelopes = [
      { intent: 'answer', mode: 'chat', reply: null, nextRead: { capability: 'aroma_system.inventory' }, answerPlan: null },
      { intent: 'answer', mode: 'chat', reply: '', nextRead: null, answerPlan: { directAnswer: '', sections: [{ heading: '最缺的兩項', rankingClaim: { kind: 'top_n', n: 2, metric: 'absolute_shortfall' }, items: [{ sourceId: '2', title: 'B', facts: [] }, { sourceId: '1', title: 'A', facts: [] }] }], limitations: [], followUp: null, unanswerable: false, citesEvidence: true } }
    ]
    const adapter = { label: 'claude', async complete () { const e = envelopes[Math.min(n++, envelopes.length - 1)]; return { text: JSON.stringify(e), usage: { inputTokens: 1, outputTokens: 1 } } } }

    const seen = []
    const realLog = console.log
    console.log = (...a) => { seen.push(a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')) }
    try {
      await processIntake('現在缺貨最嚴重的是什麼？', adapter, [], {
        demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
        readContextDeps: { connector, sources: ['aroma_system', 'public_knowledge'], sourceIntentResolver: async () => ({ intent: 'internal' }) }
      })
    } finally { console.log = realLog }

    const plan = seen.filter((l) => l.includes('ANSWER_PLAN')).join('\n')
    assert.ok(plan.length > 0, 'an ANSWER_PLAN line was emitted at all')
    assert.ok(plan.includes('"rankingGate"'), '⛔ the summary never reached the real line: ' + plan)
    assert.ok(plan.includes('"status":"evaluated_rejected"'), '⛔ the rejection is not in the real line: ' + plan)
    assert.ok(plan.includes('"reason":"order_mismatch"'), '⛔ the reason is not in the real line: ' + plan)
  })
})
