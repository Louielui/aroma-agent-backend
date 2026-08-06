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

/**
 * ── THE SHAPE CHANGE, 2026-08-06 ─────────────────────────────────────────────
 * The Owner read the turns and found three things the report had lost. The truncation was
 * not the cause — the SHAPE was:
 *
 *   1. the worker's own uncertainty 「I have not measured live row counts, so I cannot say
 *      whether this is latent or already firing today」
 *   2. a scoping caveat 「a scoping caveat rather than an error」
 *   3. an INCIDENTAL defect found in passing — the adapter reads body.count, a response-body
 *      field, while its own comment calls it 「the API's own header」
 *
 * 未確立 carried MY caveats about the method (「I planned the rounds」) and not the WORKER's
 * caveats about its findings. **Those are different things and both belong.** And an
 * incidental finding had nowhere to go at all, so it was discarded silently.
 */
describe('the two kinds of caveat never merge', () => {
  const withBoth = {
    ...base,
    outcome: OUTCOME.CONCLUDED,
    notEstablished: ['未量過 live row counts，所以講唔到而家有冇 firing'],
    aboutTheEnquiry: ['規劃每一輪嘅係 Claude Code，唔係佢']
  }

  test('a caveat about the ANSWER and a caveat about the METHOD render in separate sections', () => {
    const r = buildReport(withBoth)
    assert.match(r.text, /未確立[^\n]*live row counts/)
    assert.match(r.text, /關於呢次查證[^\n]*規劃每一輪/)
  })

  test('the method caveat does NOT appear inside the answer caveats', () => {
    const r = buildReport(withBoth)
    const line = r.text.split('\n').find((l) => l.startsWith('未確立'))
    assert.ok(!/規劃每一輪/.test(line), 'merging them is what lost the worker\'s own uncertainty')
  })

  test('a report with method caveats but no answer caveats still says so, rather than going quiet', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED, notEstablished: [], aboutTheEnquiry: ['x'] })
    assert.match(r.text, /關於呢次查證/)
  })
})

describe('incidental findings have somewhere to go', () => {
  test('a defect found in passing survives into the report', () => {
    const r = buildReport({
      ...base,
      outcome: OUTCOME.CONCLUDED,
      incidental: ['adapter 讀 body.count（response body），但佢自己個註解叫佢做 the API\'s own header —— 個註解講錯咗機制']
    })
    assert.match(r.text, /順帶發現/)
    assert.match(r.text, /the API's own header/)
  })

  test('without the section, anything outside the question asked is discarded silently', () => {
    // The assertion is about the CONTRACT: incidental must be renderable, so a worker that
    // finds something real while looking for something else does not lose it.
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED, incidental: ['A', 'B'] })
    assert.match(r.text, /A/)
    assert.match(r.text, /B/)
  })
})

describe('a FAILED report must LOCATE the fault, not trace it', () => {
  test('FAILED without a locus is refused', () => {
    assert.throws(
      () => buildReport({ ...base, outcome: OUTCOME.FAILED, answer: '中途失敗', failureLocus: '' }),
      ReportRefused,
      'a truthful error that does not locate the fault is only half of what the report promises'
    )
  })

  test('the locus names the two sides and what was wrong between them', () => {
    const r = buildReport({
      ...base,
      outcome: OUTCOME.FAILED,
      answer: '中途失敗',
      notEstablished: ['未行到第二輪'],
      failureLocus: 'claudeCodeWorker 把 resolveAgentCliCommand 嘅 {ok, command, reason} 當字串用'
    })
    assert.match(r.text, /claudeCodeWorker.*resolveAgentCliCommand/)
  })

  test('the locus is ONE line — the stack lives in the turns, not here', () => {
    const r = buildReport({
      ...base,
      outcome: OUTCOME.FAILED,
      answer: 'x',
      notEstablished: ['y'],
      failureLocus: 'A handed B the wrong shape',
      stack: 'at foo\n at bar\n at baz'
    })
    assert.ok(!r.text.includes('at foo'), 'a stack trace in the report is a report he will not read')
  })
})
