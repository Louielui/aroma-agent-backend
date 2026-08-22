'use strict'

/**
 * calendarCompleteness.test.js — X4.3.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ PRODUCTION ad10ec74. The reply opened with 「日曆讀得到，但讀到的項目沒有一項落在下星期，所以你
 * 下星期目前沒有任何已排定的安排」 and closed with 「無法確認清單是否涵蓋全部內容」. Both came from one
 * SCOPE line that said 「TOTAL IN THE WIDER SOURCE IS UNKNOWN」 and 「2 shown (complete)」 together.
 *
 * That 「complete」 meant 「every row we kept is in the prompt」. Whether the READ was complete —
 * the only thing that could support an absence claim — was `unknown`, and was never rendered.
 *
 * ⛔ ON THE PERIOD: 2026-08-22 is a SATURDAY (verified, not assumed), so a Monday–Sunday
 * 「下星期」 is 2026-08-24 .. 2026-08-30. Phase 0 searched for an existing period representation
 * and found none: `src/utils/localTime.js` has resolveTimeZone / startOfLocalDay / localParts —
 * the building blocks — and no phrase-to-range mapping anywhere in the repo. This tranche was
 * told not to invent one, so the dates below appear ONLY as fixture inputs and nothing in
 * production supplies them.
 *
 * Pure: no model, no connector, no data root.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/context/calendarCompleteness.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const { createCalendarReadAdapter, completenessOf } = require('./adapters/calendarRead')
const { describeRead, renderScopeLine } = require('./readContext')
const ne = require('../intake/negativeExistence')
const { judgeNegativeExistence, looksLikeNegativeExistence, windowCoversPeriod, REFUSAL,
  calendarJurisdiction, mentionsCalendarSubject, JURISDICTION } = ne
const { validatePlan } = require('../intake/answerPlan')

/** Monday–Sunday next week from Saturday 2026-08-22, as an explicit fixture input only. */
const NEXT_WEEK = Object.freeze({ start: '2026-08-24T05:00:00.000Z', end: '2026-08-31T05:00:00.000Z' })
/** The window the planner actually issues: start of today local, +14 days. */
const WINDOW = Object.freeze({ start: '2026-08-22T05:00:00.000Z', end: '2026-09-05T05:00:00.000Z' })

const EV = (over) => Object.assign({
  source: 'calendar', readKey: 'calendar', trust: 'live',
  returnedRows: 2, shownCount: 2, sourceTotal: null,
  queryScope: { field: 'start', window: `${WINDOW.start}..${WINDOW.end}`, range: WINDOW, calendarId: 'primary', declaredBy: 'adapter' },
  limit: 10, limitKnown: true, truncated: false,
  completeWithinScope: true, retrievalCompleteness: 'complete', contextCompleteness: 'complete',
  usedFallback: false
}, over)

const B = '你下星期沒有任何已排定的安排。'
const A = '這次讀到的項目全部都喺下星期之外。'

const gate = (read, requestedPeriod) => judgeNegativeExistence({ sentence: B, read, requestedPeriod })

async function adapterRead ({ items = [], nextPageToken = null, omitToken = false, maxResults = 10, timeMax = WINDOW.end } = {}) {
  const data = { items }
  if (!omitToken) data.nextPageToken = nextPageToken
  const client = { events: { list: async () => ({ data }) } }
  const a = createCalendarReadAdapter({ client, clock: () => '2026-08-22T20:20:34.976Z' })
  return a.methods.listEvents({ timeMin: WINDOW.start, timeMax, maxResults })
}

const EVENT = (id, start) => ({ id, summary: id, start: { dateTime: start } })

/* ═══ 1. THE nextPageToken CONTRACT ════════════════════════════════════════ */

describe('the pagination contract', () => {
  test('*** ⛔ TOKEN PRESENT ⇒ MORE ROWS EXIST ⇒ NOT COMPLETE ***', () => {
    const c = completenessOf({ nextPageToken: 'more' }, 10, 10)
    assert.equal(c.truncated, true)
    assert.equal(c.completeWithinScope, false)
    assert.equal(c.retrievalCompleteness, 'incomplete')
  })

  test('token absent AND page not full ⇒ complete for this window', () => {
    const c = completenessOf({ nextPageToken: null }, 2, 10)
    assert.equal(c.truncated, false)
    assert.equal(c.completeWithinScope, true)
    assert.equal(c.retrievalCompleteness, 'complete')
  })

  test('*** ⛔ TOKEN ABSENT BUT PAGE FULL ⇒ UNKNOWN, NOT COMPLETE ***', () => {
    // A full page with no token is the shape a silently dropped field produces. Calling it
    // complete would be inferring completeness from returnedRows < maxResults — arithmetic
    // dressed as evidence.
    const c = completenessOf({ nextPageToken: null }, 10, 10)
    assert.equal(c.completeWithinScope, null)
    assert.equal(c.retrievalCompleteness, 'unknown')
  })

  test('*** ⛔ THE FIELD MUST BE OBSERVABLE — its absence proves nothing ***', () => {
    const c = completenessOf({ items: [] }, 2, 10)
    assert.equal(c.completeWithinScope, null)
    assert.equal(c.retrievalCompleteness, 'unknown')
  })

  test('the adapter self-describes through the {results, evidence} envelope', async () => {
    const out = await adapterRead({ items: [EVENT('a', '2026-08-22T12:00:00-05:00')] })
    assert.ok(Array.isArray(out.results) && out.evidence, 'the envelope readConnector already accepts')
    assert.equal(out.evidence.limit, 10)
    assert.equal(out.evidence.limitKnown, true)
    assert.deepEqual(out.evidence.queryScope.range, WINDOW)
    assert.equal(out.evidence.queryScope.calendarId, 'primary')
    assert.equal(out.evidence.completeWithinScope, true)
    assert.equal(out.evidence.sourceTotal, null, '⛔ bounded completeness must not imply a lifetime total')
  })
})

/* ═══ 2. THREE COMPLETENESS QUESTIONS ══════════════════════════════════════ */

describe('retrieval, context and Owner-visible completeness stay distinct', () => {
  test('*** ⛔ THE SCOPE LINE NAMES BOTH — no bare "complete" ***', async () => {
    const out = await adapterRead({ items: [EVENT('a', '2026-08-22T12:00:00-05:00')] })
    const ev = describeRead('calendar', out.evidence, out.results, false, '2026-08-22T20:20:34.976Z')
    const line = renderScopeLine(Object.assign({}, ev, { readKey: 'calendar' }))
    assert.match(line, /retrieval complete/)
    assert.equal(/context complete/.test(line), false, 'no budget spent restating agreement')
    assert.equal(/ \(complete\)/.test(line), false, '⛔ the bare word that shipped the defect')
  })

  test('*** ⛔ F — CONTEXT MAY TRUNCATE WHILE RETRIEVAL IS COMPLETE ***', async () => {
    const out = await adapterRead({ items: [EVENT('a', '2026-08-22T12:00:00-05:00'), EVENT('b', '2026-08-23T12:00:00-05:00')] })
    // Only one row reached context.
    const ev = describeRead('calendar', out.evidence, [out.results[0]], false, '2026-08-22T20:20:34.976Z')
    assert.equal(ev.retrievalCompleteness, 'complete', 'the READ got everything')
    assert.equal(ev.contextCompleteness, 'sample', 'the PROMPT did not')
    const line = renderScopeLine(Object.assign({}, ev, { readKey: 'calendar' }))
    assert.match(line, /retrieval complete/)
    assert.match(line, /context sample/)
  })

  test('*** ⛔ E — CONTEXT "complete" MUST NOT AUTHORISE AN ABSENCE CLAIM ***', () => {
    // Every retrieved row is in context, but the read itself is unproven — the exact production shape.
    const read = EV({ retrievalCompleteness: 'unknown', completeWithinScope: null, contextCompleteness: 'complete' })
    assert.equal(gate(read, NEXT_WEEK).blocked, true)
    assert.equal(gate(read, NEXT_WEEK).reason, REFUSAL.RETRIEVAL_NOT_PROVEN)
  })

  test('the query window is always visible; the cap appears when completeness is unproven', async () => {
    const out = await adapterRead({ items: [] })
    const ev = describeRead('calendar', out.evidence, [], false, '2026-08-22T20:20:34.976Z')
    const line = renderScopeLine(Object.assign({}, ev, { readKey: 'calendar' }))
    assert.match(line, /2026-08-22T05:00:00\.000Z\.\.2026-09-05T05:00:00\.000Z/)
    assert.equal(/API cap/.test(line), false, 'a provably complete read need not spend budget on its ceiling')
    // A read whose completeness is unproven MUST show the ceiling, because that is the number
    // a reader needs in order to judge what 「N returned」 is worth.
    const un = describeRead('calendar', Object.assign({}, out.evidence, { completeness: 'unknown', truncated: null, completeWithinScope: null }), [], false, '2026-08-22T20:20:34.976Z')
    assert.match(renderScopeLine(Object.assign({}, un, { readKey: 'calendar' })), /API cap 10/)
  })
})

/* ═══ 3. THE NEGATIVE-EXISTENCE CONTRACT — fixtures A–L ════════════════════ */

describe('negative existence', () => {
  test('*** ⛔ A — 0 rows, no token, complete, period covered ⇒ ALLOWED ***', async () => {
    const out = await adapterRead({ items: [] })
    assert.equal(out.evidence.completeWithinScope, true)
    const read = Object.assign({}, out.evidence, { usedFallback: false })
    assert.equal(gate(read, NEXT_WEEK).blocked, false, '⛔ a provable absence must survive')
  })

  test('*** ⛔ B — rows outside the sub-period, retrieval complete, window covers ⇒ ALLOWED ***', () => {
    assert.equal(gate(EV(), NEXT_WEEK).blocked, false)
  })

  test('*** ⛔ C — retrieval unknown ⇒ only the retrieved-set claim survives ***', () => {
    const read = EV({ retrievalCompleteness: 'unknown', completeWithinScope: null })
    assert.equal(gate(read, NEXT_WEEK).blocked, true)
    assert.equal(looksLikeNegativeExistence(A), false, 'claim A is not even a candidate')
  })

  test('*** ⛔ D — nextPageToken present ⇒ BLOCKED ***', async () => {
    const out = await adapterRead({ items: [EVENT('a', '2026-08-22T12:00:00-05:00')], nextPageToken: 'more' })
    assert.equal(out.evidence.completeWithinScope, false)
    assert.equal(gate(Object.assign({}, out.evidence, { usedFallback: false }), NEXT_WEEK).blocked, true)
  })

  test('*** ⛔ G — sourceTotal unknown but completeWithinScope true ⇒ STILL ALLOWED ***', () => {
    const read = EV({ sourceTotal: null })
    assert.equal(read.sourceTotal, null)
    assert.equal(gate(read, NEXT_WEEK).blocked, false,
      '⛔ requiring a lifetime total would make every bounded absence claim unprovable')
  })

  test('*** ⛔ H — window only partially covers the period ⇒ BLOCKED ***', () => {
    const short = EV({ queryScope: { field: 'start', range: { start: WINDOW.start, end: '2026-08-27T05:00:00.000Z' } } })
    assert.equal(gate(short, NEXT_WEEK).blocked, true)
    assert.equal(gate(short, NEXT_WEEK).reason, REFUSAL.WINDOW_DOES_NOT_COVER)
    assert.equal(windowCoversPeriod({ start: WINDOW.start, end: '2026-08-27T05:00:00.000Z' }, NEXT_WEEK), false)
  })

  test('*** ⛔ I — a FALLBACK read can never prove the bounded window empty ***', () => {
    const fb = EV({ usedFallback: true })
    assert.equal(gate(fb, NEXT_WEEK).blocked, true)
    assert.equal(gate(fb, NEXT_WEEK).reason, REFUSAL.FALLBACK_USED)
  })

  test('*** ⛔ J — Saturday 2026-08-22 ⇒ Mon–Sun next week is 08-24 .. 08-30 ***', () => {
    // Verified, not assumed: the weekday is computed here rather than trusted.
    assert.equal(new Date(Date.UTC(2026, 7, 22)).getUTCDay(), 6, '2026-08-22 is a Saturday')
    assert.equal(NEXT_WEEK.start.slice(0, 10), '2026-08-24')
    assert.equal(NEXT_WEEK.end.slice(0, 10), '2026-08-31', 'exclusive end = through Sunday 08-30')
    assert.equal(windowCoversPeriod(WINDOW, NEXT_WEEK), true, 'the 14-day window does cover it')
    // ⛔ AND NO PERIOD PARSER WAS BUILT. These dates are fixture inputs; production passes null.
    const code = require('fs').readFileSync(require.resolve('../intake/negativeExistence'), 'utf8')
      .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), '').replace(new RegExp('^[ \\t]*//.*$', 'gm'), '')
    assert.equal(/2026-|getUTCDay|startOfLocalDay|Date\.UTC/.test(code), false, '⛔ a date parser crept in')
  })

  test('*** ⛔ FAIL CLOSED — no requested period means no absence claim ***', () => {
    assert.equal(gate(EV(), null).blocked, true)
    assert.equal(gate(EV(), null).reason, REFUSAL.NO_REQUESTED_PERIOD)
    /**
     * ⛔ THIS ASSERTION IS REVERSED, AND THE REVERSAL IS THE CORRECTION.
     *
     * It read 「no calendar read at all is the weakest case of all」 and asserted BLOCKED. That
     * sentence is true about the EVIDENCE and false about the JURISDICTION: a missing Calendar
     * read is not evidence that a Gmail, Drive or Aroma statement is unsafe under Calendar rules.
     * Believing otherwise is what let a Calendar gate drop an aroma_system replenishment claim.
     */
    const noRead = judgeNegativeExistence({ sentence: B, read: null, requestedPeriod: NEXT_WEEK })
    assert.equal(noRead.blocked, false, 'no Calendar read means no jurisdiction, not a verdict')
    assert.equal(noRead.jurisdiction, JURISDICTION.NOT_APPLICABLE)
  })

  test('a sentence needs BOTH an absence word and a period word', () => {
    assert.equal(looksLikeNegativeExistence('我沒有任何意見。'), false, 'absence, no period')
    assert.equal(looksLikeNegativeExistence('下星期幾忙？'), false, 'period, no absence')
    assert.equal(looksLikeNegativeExistence(B), true)
    assert.equal(looksLikeNegativeExistence('You have nothing scheduled next week.'), true)
  })
})

/* ═══ 4. END TO END THROUGH validatePlan ═══════════════════════════════════ */

describe('through the real validator', () => {
  const ev = [EV()]
  const run = (t) => {
    const r = validatePlan(
      { directAnswer: t, answerClaims: [], sections: [], limitations: [], followUp: '', unanswerable: false, citesEvidence: false },
      { evidenceSets: ev, itemsBySource: [], message: '' })
    return { kept: r.plan.directAnswer, why: (r.drops || []).map((d) => d.why).join(',') }
  }

  test('*** ⛔ THE PRODUCTION SENTENCE IS REMOVED, WITH A NAMED REASON ***', () => {
    const r = run(B)
    assert.equal(r.kept, '')
    assert.equal(r.why, 'negative_existence_unproven')
  })

  test('*** ⛔ K — AN ORDINARY POSITIVE SENTENCE IS UNTOUCHED ***', () => {
    assert.equal(run('我建議先做中央工場。').kept, '我建議先做中央工場。')
    assert.equal(run(A).kept, A, 'the retrieved-set claim survives')
  })

  test('an absence claim with no period word is not this rule\'s business', () => {
    assert.equal(run('我沒有任何意見。').kept, '我沒有任何意見。')
  })

  test('*** ⛔ L — X4 AND X4.2 ARE UNCHANGED ***', () => {
    const inv = require('../intake/investigationState')
    assert.deepEqual(Object.values(inv.READ_STATE).sort(),
      ['failed', 'no_system_operation', 'not_attempted', 'not_authorised', 'succeeded'])
    const sa = require('../intake/sectionAttribution')
    assert.equal(sa.sourceClaimOf('日曆'), 'calendar')
    assert.equal(sa.sourceOfReadKey('drive'), 'drive')
    const rl = require('../intake/reasoningLoop')
    assert.equal(rl.MAX_REASONING_STEPS, 3)
    assert.equal(rl.MAX_REASONING_STEPS_CEILING, 5)
  })

  test('*** ⛔ THE GATE ADDS NO AUTHORITY AND NO CALL ***', () => {
    const code = require('fs').readFileSync(require.resolve('../intake/negativeExistence'), 'utf8')
      .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), '').replace(new RegExp('^[ \\t]*//.*$', 'gm'), '')
    for (const banned of ['require(', 'process.env', 'READ_ACCESS', 'connector', 'complete(', 'adapter', 'proposal', 'dispatch']) {
      assert.equal(code.includes(banned), false, '⛔ reached for: ' + banned)
    }
  })
})

/* ═══ 5. JURISDICTION — THE CORRECTION THAT REJECTED THE FIRST BUILD ═══════ */

/**
 * ⛔ THE FIRST BUILD ASKED 「is this claim proven?」 BEFORE 「is this claim mine to judge?」.
 *
 * With no Calendar read in the turn it returned `retrieval_completeness_not_proven` — a verdict
 * — and so dropped 「下星期沒有任何需要補貨的項目」, an aroma_system sentence, under a Calendar
 * rule. A completeness failure had manufactured jurisdiction over every other source.
 *
 * The release scope matrix caught it. This file did not: it contained ZERO cases pairing a
 * non-Calendar source with a period word, which is exactly why 24/24 and 14/14 went green over
 * a gate that broad. These fixtures are the permanent version of that matrix.
 *
 * ⛔ AND THEY CALL THE REAL GATE AND THE REAL VALIDATOR — no reproduction of either.
 */
describe('jurisdiction: a Calendar rule judges only Calendar claims', () => {
  const OTHER = (source) => ({ source, readKey: source, trust: 'live', shownCount: 0, returnedRows: 0, items: [] })
  const CALREAD = EV()

  const validate = (sentence, evidenceSets) => validatePlan(
    { directAnswer: sentence, answerClaims: [], sections: [], limitations: [], followUp: '', unanswerable: false, citesEvidence: false },
    { evidenceSets, itemsBySource: [], message: '' })

  const gateBlocks = (sentence, evidenceSets) => judgeNegativeExistence({
    sentence,
    read: evidenceSets.find((e) => e.source === 'calendar') || null,
    requestedPeriod: null
  }).blocked

  /**
   * ⛔ CAUGHT means the gate blocks it AND it does not reach the Owner. It deliberately does NOT
   * require X4.3 to be the rule that removes it: an English sentence is dropped one check earlier
   * as `name_not_in_evidence`, because proseIsGrounded finds Latin tokens absent from the evidence
   * index. Which rule fires first is drop ORDER, not a safety property, and asserting it would
   * pin behaviour this tranche has no business pinning.
   */
  const caught = (label, sentence, evidenceSets) => {
    const r = validate(sentence, evidenceSets)
    assert.equal(gateBlocks(sentence, evidenceSets), true, '⛔ the gate did not claim jurisdiction: ' + label)
    assert.equal(r.plan.directAnswer, '', '⛔ an unproven absence claim reached the Owner: ' + label)
  }

  /** UNTOUCHED means the gate allows it, X4.3 dropped nothing, and it reaches the Owner. */
  const untouched = (label, sentence, evidenceSets) => {
    const r = validate(sentence, evidenceSets)
    assert.equal(gateBlocks(sentence, evidenceSets), false, '⛔ the gate claimed jurisdiction it lacks: ' + label)
    assert.equal((r.drops || []).some((d) => d.why === 'negative_existence_unproven'), false,
      '⛔ X4.3 intercepted an unrelated sentence: ' + label)
    assert.ok(r.plan.directAnswer.length > 0, '⛔ the sentence did not survive: ' + label)
  }

  /* — Calendar jurisdiction present: still caught — */

  test('*** ⛔ 1/12 — the production sentence, with a Calendar read ***', () => {
    caught('production', '你下星期目前沒有任何已排定的安排。', [CALREAD])
  })

  test('*** ⛔ 10/12 — an explicit 日曆 absence claim ***', () => {
    caught('日曆', '下星期日曆沒有任何活動。', [CALREAD])
  })

  test('*** ⛔ 11/12 — the same claim in English ***', () => {
    caught('english', 'Calendar has no events next week.', [CALREAD])
  })

  test('*** ⛔ 12/12 — 已排定 is what catches it, and it is caught ***', () => {
    caught('已排定', '你下星期沒有任何已排定的安排。', [CALREAD])
  })

  /* — no Calendar read: NO JURISDICTION AT ALL — */

  test('*** ⛔ 3/12 — an Aroma period-negative, no Calendar read ***', () => {
    untouched('aroma/no-cal', '下星期沒有任何需要補貨的項目。', [OTHER('aroma_system')])
  })

  test('*** ⛔ 4/12 — a Gmail period-negative, no Calendar read ***', () => {
    untouched('gmail/no-cal', '今日沒有任何新郵件。', [OTHER('gmail')])
  })

  test('*** ⛔ 5/12 — a Drive period-negative, no Calendar read ***', () => {
    untouched('drive/no-cal', '下星期沒有任何要交的文件。', [OTHER('drive')])
  })

  test('*** ⛔ A MISSING CALENDAR READ IS NOT_APPLICABLE, NEVER "unproven" ***', () => {
    assert.equal(calendarJurisdiction({ sentence: '下星期沒有任何需要補貨的項目。', read: null }), JURISDICTION.NOT_APPLICABLE)
    const v = judgeNegativeExistence({ sentence: '下星期沒有任何需要補貨的項目。', read: null, requestedPeriod: null })
    assert.equal(v.blocked, false)
    assert.equal(v.jurisdiction, JURISDICTION.NOT_APPLICABLE)
    assert.equal(v.reason, null, '⛔ a jurisdiction answer must not carry a completeness verdict')
  })

  /* — THE HARDER CASE: Calendar WAS read, the sentence is about something else — */

  test('*** ⛔ 6/12 — an Aroma period-negative on a turn that ALSO read Calendar ***', () => {
    untouched('aroma/co-read', '下星期沒有任何需要補貨的項目。', [CALREAD, OTHER('aroma_system')])
  })

  test('*** ⛔ 7/12 — a Gmail period-negative on a turn that ALSO read Calendar ***', () => {
    untouched('gmail/co-read', '今日沒有任何新郵件。', [CALREAD, OTHER('gmail')])
  })

  test('*** ⛔ 8/12 — a Drive period-negative on a turn that ALSO read Calendar ***', () => {
    untouched('drive/co-read', '下星期沒有任何要交的文件。', [CALREAD, OTHER('drive')])
  })

  /* — the vocabulary line — */

  test('*** ⛔ 9/12 — GENERIC 安排 IS NOT A CALENDAR SUBJECT ***', () => {
    // Production, staffing, purchasing, delivery and Tea House all have 安排. Admitting it would
    // rebuild the over-reach one word smaller.
    untouched('generic 安排', '下星期沒有任何生產安排。', [CALREAD, OTHER('aroma_system')])
    assert.equal(mentionsCalendarSubject('下星期沒有任何生產安排。'), false)
    assert.equal(mentionsCalendarSubject('下星期沒有任何已排定的安排。'), true, '已排定 is what carries it')
  })

  test('*** ⛔ 2/12 — the retrieved-set claim is never jurisdiction ***', () => {
    untouched('retrieved-set', '這次讀到嘅日曆項目全部都喺下星期之外。', [CALREAD])
  })

  test('the subject vocabulary is closed and small', () => {
    assert.ok(ne.CALENDAR_SUBJECT_MARKERS.length <= 12, 'markers: ' + ne.CALENDAR_SUBJECT_MARKERS.length)
    assert.equal(ne.CALENDAR_SUBJECT_MARKERS.includes('安排'), false, '⛔ generic business language')
    for (const w of ['日曆', '已排定', 'calendar', 'event']) {
      assert.ok(ne.CALENDAR_SUBJECT_MARKERS.includes(w), 'missing marker: ' + w)
    }
  })
})
