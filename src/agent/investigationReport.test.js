'use strict'

/**
 * investigationReport.test.js — the report is the only remaining review.
 *
 * ── WHY THIS FILE IS THE DESIGN CENTRE ───────────────────────────────────────
 * The Owner pasted ~20 times in one investigation; ~3 were approvals and the rest was him
 * carrying text between two systems. Removing him from that relay is the point of the
 * dispatch path — but the relay was ALSO an accidental review at every step, and
 * **three of yesterday's four wrong diagnoses died in his hands** precisely because each one
 * passed through them.
 *
 * > Removing the relay removes a safety property he never chose.
 *
 * So the report is not a summary. **It is the only place those diagnoses would now surface**,
 * and its honesty is enforced here rather than requested in a prompt.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const {
  OUTCOME, buildReport, ReportRefused
} = require('./investigationReport')

const base = {
  question: '訂貨建議少咗 18 樣，查下',
  answer: '唔係缺陷 —— 嗰 18 樣已經落咗單。',
  measurements: ['has_incoming 18', '61 − 18 = 43'],
  notEstablished: [],
  rounds: 4,
  costUsd: 0.42,
  appliedChanges: []
}

describe('the five sections, in order', () => {
  test('a report carries outcome, answer, measurements, not-established and cost', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED })
    assert.strictEqual(r.outcome, OUTCOME.CONCLUDED)
    assert.ok(r.text.includes('唔係缺陷'))
    assert.ok(r.text.includes('has_incoming 18'))
    assert.match(r.text, /0\.42|\$0\.42/)
    assert.match(r.text, /4/)
  })

  test('it is not a transcript — the rounds are referenced, never inlined', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED, transcript: 'ROUND1 blah\nROUND2 blah' })
    assert.ok(!r.text.includes('ROUND1'), 'the transcript is the thing he is trying to stop reading')
  })
})

describe('「fixed」 without an applied change is STRUCTURALLY IMPOSSIBLE', () => {
  // Owner: "should be structurally impossible, not discouraged". The patch that was written
  // and never applied yesterday is the proof this can happen to a careful author.
  for (const claim of ['修好咗', '已修復', 'I fixed it', 'fixed the query', '已經改好', 'applied the fix']) {
    test('refuses: ' + claim, () => {
      assert.throws(
        () => buildReport({ ...base, outcome: OUTCOME.CONCLUDED, answer: claim, appliedChanges: [] }),
        ReportRefused,
        'a fix claim with nothing applied must not be constructible'
      )
    })
  }

  test('the SAME claim is allowed once something was actually applied', () => {
    const r = buildReport({
      ...base,
      outcome: OUTCOME.CONCLUDED,
      answer: '修好咗。',
      appliedChanges: [{ file: 'src/x.js', commit: 'abc1234' }]
    })
    assert.ok(r.text.includes('修好咗'))
  })

  test('「verified」 is refused when nothing was executed — reading a file is not running it', () => {
    assert.throws(
      () => buildReport({ ...base, outcome: OUTCOME.CONCLUDED, answer: '已驗證通過', executed: false }),
      ReportRefused
    )
  })

  test('a report with NO applied changes says so explicitly rather than staying silent', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED })
    assert.match(r.text, /冇改過任何嘢|沒有應用任何變更/)
  })
})

describe('STOPPED_ON_BUDGET is the FIRST line', () => {
  test('it leads, it does not trail', () => {
    // a stopped enquiry must name what is unanswered — the builder refuses otherwise, which
    // is asserted separately below
    const r = buildReport({ ...base, outcome: OUTCOME.STOPPED_ON_BUDGET, costUsd: 2.0, notEstablished: ['邊個來源權威'] })
    const first = r.text.split('\n').find((l) => l.trim())
    assert.match(first, /未查完|STOPPED_ON_BUDGET|停咗/, 'got first line: ' + first)
  })

  test('a halted investigation can never render as a completed one', () => {
    // Same family as the Drive read that timed out and rendered as "nothing waiting".
    const halted = buildReport({ ...base, outcome: OUTCOME.STOPPED_ON_BUDGET, notEstablished: ['邊個來源權威'] })
    const done = buildReport({ ...base, outcome: OUTCOME.CONCLUDED })
    assert.notStrictEqual(halted.text, done.text)
    assert.ok(!/^查完/.test(halted.text.trim()), 'must not open by claiming completion')
  })

  test('a stopped enquiry must carry what it did NOT establish', () => {
    assert.throws(
      () => buildReport({ ...base, outcome: OUTCOME.STOPPED_ON_BUDGET, notEstablished: [] }),
      ReportRefused,
      'stopping without saying what is unanswered is the same as claiming there is nothing left'
    )
  })
})

describe('what the report may never claim', () => {
  test('a cause asserted with no measurement in the same report is refused', () => {
    assert.throws(
      () => buildReport({
        ...base,
        outcome: OUTCOME.CONCLUDED,
        answer: '成因係 INNER JOIN 跌咗啲行。',
        measurements: []
      }),
      ReportRefused,
      'yesterday produced three causes this way'
    )
  })

  test('a number from a source that declared itself a sample must be marked', () => {
    const r = buildReport({
      ...base,
      outcome: OUTCOME.CONCLUDED,
      answer: '有 50 份盤點。',
      measurements: ['count 50'],
      samples: [{ what: 'count 50', why: 'LIMIT 50' }]
    })
    assert.match(r.text, /上限|sample|唔係總數/, 'a capped number must not read as a total')
  })
})
