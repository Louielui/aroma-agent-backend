'use strict'

/**
 * C1's SALVAGE DECISION MUST REACH THE LOG. IT IS SERVER-OWNED AND IT WAS INVISIBLE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED ON THE LIVE TURN, requestId d61b779e-cb02-4040-86b4-5f4593b76202.
 *
 * The C1 production acceptance ran one real turn. It came back `validated`, both sections
 * `not_detected`, so C1 was never exercised — a legitimate outcome. But checking WHY meant
 * discovering that `rankingSalvage` is absent from ANSWER_PLAN entirely. Had the turn
 * salvaged rows, the log would have looked exactly the same. The feature would have worked
 * in silence, and「it did not fire」and「it fired and nobody recorded it」are the same line.
 *
 * ⛔ AND THE GAP IS TWO GAPS, WHICH IS WHY A LOGGER-ONLY TEST WOULD PASS AND PROVE NOTHING.
 *
 *   validatePlan()            answerPlan.js       returns rankingSalvage   ✔ exists
 *   readResultView `common`   readResultView.js   omits it                 ⛔ gap 1
 *   logAnswerPlan `line`      answerPlan.js       omits it                 ⛔ gap 2
 *
 * So these tests drive `buildReadResultReply` — the real entry the server calls — and read
 * the emitted line. A test that hands a ready-made `rankingSalvage` to the logger would go
 * green over gap 1 still wide open. That substitution is precisely the failure
 * `answerPlanWiring.test.js` was written about.
 *
 * ⛔ THIS OBJECT HAS SWALLOWED A FIELD THREE TIMES BEFORE. `readResultView.js` says so in its
 * own comments: `droppedLimitations` shipped reading 0 for as long as it existed,
 * `rankingVerdicts` was caught just before shipping, and `rankingClaims` carries a warning
 * that it would be the third. `rankingSalvage` is the fourth. Recorded as
 * ANSWER_PLAN_DUAL_HANDOFF_OBSERVABILITY_DEBT — a loggable field needs wiring at two manual
 * boundaries and can be dropped at either. NOT solved here: the explicit whitelist in
 * `logAnswerPlan` is a safety boundary, and replacing it with reflection over the validator's
 * keys would make every future internal field loggable by default.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildReadResultReply } = require('./readResultView')
const { logAnswerPlan } = require('./answerPlan')
const { VIOLATION } = require('./rankingProof')

/* ── the live-shaped fixture, one operation, server-resolved rows ────────── */

const PO = 'aroma_system.purchasing'

const row = (id, title) => ({
  source: 'aroma_system',
  readKey: PO,
  sourceId: id,
  title,
  entityType: 'purchase_order',
  content: 'status=confirmed',
  fields: { id, status: 'confirmed' },
  trust: 'live'
})

const EVIDENCE = {
  source: 'aroma_system',
  readKey: PO,
  endpoint: 'x',
  trust: 'live',
  entityType: 'purchase_order',
  shownCount: 2,
  matchingTotal: 2,
  sourceTotal: null,
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  rowShape: { hasLocation: false, hasAsOf: false, note: null },
  metrics: {},
  derivations: {},
  fieldLabels: {},
  completeness: 'complete'
}

const item = (id, title) => ({ sourceId: PO + '#' + id, title, facts: [] })
const plan = (sections) => ({ directAnswer: '', citesEvidence: true, unanswerable: false, limitations: [], followUp: null, sections })

/** Measured clear of BOTH salvage floors — see rankingNeutralSalvage.test.js. */
const NON_RANKING_Q = '有冇貨已經有 incoming，所以唔應該再訂咁多？'
/** Measured ranking-LOOKING heading that actually means「recent」. */
const LOOKS_RANKING = '最近採購單'
/** The same rows under a heading that presents as nothing. */
const PLAIN_HEADING = '採購單'

const TITLES = ['PO-20260816-001', 'PO-20260814-001']
const ITEMS = [item('101', TITLES[0]), item('102', TITLES[1])]
const GROUPS = [{ source: 'aroma_system', readKey: PO, operation: PO, items: [row('101', TITLES[0]), row('102', TITLES[1])] }]

/** Runs the REAL renderer and returns both what the Owner sees and what was logged. */
function turn (heading, requestId) {
  const lines = []
  const real = console.log
  console.log = (...a) => {
    if (typeof a[0] === 'string' && a[0].includes('AROMA-ANSWER-PLAN')) { lines.push(JSON.parse(a[1])); return }
    real.apply(console, a)
  }
  let out
  try {
    out = buildReadResultReply({
      reply: '',
      message: NON_RANKING_Q,
      provider: 'openai',
      requestId,
      answerPlan: plan([{ heading, rankingClaim: null, items: ITEMS }]),
      evidenceSets: [EVIDENCE],
      itemsBySource: GROUPS
    })
  } finally {
    console.log = real
  }
  assert.equal(lines.length, 1, 'exactly one ANSWER_PLAN line must be emitted per turn')
  return { reply: out.reply, line: lines[0] }
}

/* ═══ THE HANDOFF — BOTH BOUNDARIES, THROUGH THE REAL RENDERER ════════════ */

test('*** ⛔ A NEUTRAL SALVAGE REACHES THE LOG WITH ITS OWN NUMBERS ***', () => {
  const { line } = turn(LOOKS_RANKING, 'obs-salvage')

  // The premise: this fixture really does salvage. Asserted, not assumed — a telemetry test
  // over a turn that never salvaged would pass while measuring nothing.
  assert.deepEqual(line.rankingGate, [{ status: 'evaluated_rejected', reason: VIOLATION.RANKING_CLAIM_MISSING, rankedSourceCount: 0 }],
    'the ranking must still be rejected — this feature does not make an unproven ranking allowed')
  assert.equal(line.keptItemCount, 2, 'and the rows must have survived')

  assert.ok(line.rankingSalvage, '⛔ rankingSalvage never reached the emitted line')
  assert.deepEqual(line.rankingSalvage, { status: 'neutral_salvaged', sections: 1, items: 2 },
    '⛔ the salvage numbers did not survive the handoff: ' + JSON.stringify(line.rankingSalvage))
})

test('*** ⛔ AN ORDINARY TURN SAYS none/0/0 — ABSENT AND ZERO MUST NOT LOOK ALIKE ***', () => {
  const { line } = turn(PLAIN_HEADING, 'obs-plain')
  assert.deepEqual(line.rankingGate, [{ status: 'not_detected', reason: null, rankedSourceCount: 0 }], 'nothing looked like a ranking here')
  assert.deepEqual(line.rankingSalvage, { status: 'none', sections: 0, items: 0 },
    '⛔ a non-salvage turn must still carry the field: ' + JSON.stringify(line.rankingSalvage))
})

test('*** ⛔ THE FIELD IS NOT OPTIONAL — a turn with no plan still projects it ***', () => {
  /**
   * The second call site (`no_plan_returned`, readResultView.js) passes no validator result
   * at all. If the projection were conditional, that line would be the one place the field
   * silently disappears — and it is the line emitted when the layer did not run, which is
   * exactly when a reader needs the shape to be uniform.
   */
  let captured = null
  logAnswerPlan({ outcome: 'fallback', reason: 'no_plan_returned', provider: null, requestId: 'obs-noplan' }, (l) => { captured = l })
  assert.deepEqual(captured.rankingSalvage, { status: 'none', sections: 0, items: 0 })
})

/* ═══ THE WHITELIST — nothing but the three keys may travel ═══════════════ */

test('*** ⛔ ARBITRARY AND SENSITIVE KEYS CANNOT RIDE IN ON rankingSalvage ***', () => {
  /**
   * ⛔ THIS ONE DELIBERATELY CALLS THE LOGGER DIRECTLY, and it is NOT the handoff proof —
   * the tests above are. Its job is the opposite: to pollute the object in a way the real
   * validator never would, and prove the projection is a whitelist rather than a spread.
   * `logAnswerPlan`'s own comment says an explicit projection exists so a new key「cannot
   * ride into the log unnoticed」; this is that promise, measured.
   */
  let captured = null
  logAnswerPlan({
    outcome: 'validated',
    requestId: 'obs-pollute',
    rankingSalvage: {
      status: 'neutral_salvaged',
      sections: 1,
      items: 2,
      heading: LOOKS_RANKING,
      title: TITLES[0],
      value: 'currentStock=18.000',
      message: NON_RANKING_Q,
      evidence: 'id=2 · name=Napa Cabbage',
      supplierName: 'Costco',
      credentials: 'sk-should-never-appear',
      future: { nested: 'anything' }
    }
  }, (l) => { captured = l })

  assert.deepEqual(Object.keys(captured.rankingSalvage).sort(), ['items', 'sections', 'status'],
    '⛔ a key rode into the log: ' + JSON.stringify(Object.keys(captured.rankingSalvage)))

  const serialized = JSON.stringify(captured)
  for (const forbidden of [LOOKS_RANKING, TITLES[0], 'currentStock', NON_RANKING_Q, 'Napa Cabbage', 'Costco', 'sk-should-never-appear', 'nested']) {
    assert.equal(serialized.includes(forbidden), false, '⛔ content reached the log line: ' + forbidden)
  }
})

test('*** ⛔ FAIL-SAFE NUMBERS — a malformed value becomes 0/none, never NaN or a string ***', () => {
  let captured = null
  logAnswerPlan({
    outcome: 'validated',
    requestId: 'obs-malformed',
    rankingSalvage: { status: 'wide_open', sections: 'two', items: null }
  }, (l) => { captured = l })
  assert.deepEqual(captured.rankingSalvage, { status: 'none', sections: 0, items: 0 },
    '⛔ an unrecognised status or non-numeric count leaked through: ' + JSON.stringify(captured.rankingSalvage))
})

/* ═══ AND NOTHING THE OWNER SEES MAY MOVE ════════════════════════════════ */

test('*** ⛔ THE RENDERED ANSWER IS BYTE-IDENTICAL — telemetry may not touch the reply ***', () => {
  /**
   * ⛔ THE TWO LITERALS BELOW WERE MEASURED FROM THE UNCHANGED CODE BEFORE THIS TRANCHE'S
   * IMPLEMENTATION EXISTED. That is the whole point: they pin what the Owner saw, so adding
   * a log field cannot quietly move a heading, a row or a blank line.
   */
  assert.equal(turn(LOOKS_RANKING, 'obs-bytes-salvage').reply,
    '**PO-20260816-001**\n\n**PO-20260814-001**',
    '⛔ the salvaged answer changed — note it carries NO heading, which is C1 working')
  assert.equal(turn(PLAIN_HEADING, 'obs-bytes-plain').reply,
    '### 採購單\n\n**PO-20260816-001**\n\n**PO-20260814-001**',
    '⛔ the ordinary answer changed')
})

test('*** ⛔ EVERY OTHER MEASUREMENT ON THE LINE IS UNMOVED ***', () => {
  const { line } = turn(LOOKS_RANKING, 'obs-counters')
  // Counters stay truthful: the ranking SECTION was dropped, the ROWS were not.
  assert.equal(line.droppedItems, 0, '⛔ salvaged rows were counted as dropped')
  assert.equal(line.modelItemCount, 2)
  assert.equal(line.keptItemCount, 2)
  assert.deepEqual(line.rankingClaims, { looksRanking: 1, declared: 0, missing: 1 })
  assert.equal(line.outcome, 'degraded')
  assert.equal(line.reason, 'answer_unsupported')
  // The ranking drop is still recorded — C1 never rewrote the verdict to「allowed」.
  assert.deepEqual(line.dropped.map((d) => d.why), [VIOLATION.RANKING_CLAIM_MISSING])
})
