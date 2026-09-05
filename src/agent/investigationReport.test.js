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
const { CATALOGUE } = require('../i18n/catalogue')
const assert = require('node:assert')
const {
  OUTCOME, buildReport, ReportRefused, classifyFixClaim
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
    assert.match(r.text, /沒有改過任何東西/)
  })
})

describe('STOPPED_ON_BUDGET is the FIRST line', () => {
  test('it leads, it does not trail', () => {
    // a stopped enquiry must name what is unanswered — the builder refuses otherwise, which
    // is asserted separately below
    const r = buildReport({ ...base, outcome: OUTCOME.STOPPED_ON_BUDGET, costUsd: 2.0, notEstablished: ['邊個來源權威'] })
    const first = r.text.split('\n').find((l) => l.trim())
    assert.match(first, /未查完|STOPPED_ON_BUDGET|停了/, 'got first line: ' + first)
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
    assert.match(r.text, /上限|sample|不是總數/, 'a capped number must not read as a total')
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
    assert.match(r.text, /關於這次查證[^\n]*規劃每一輪/)
  })

  test('the method caveat does NOT appear inside the answer caveats', () => {
    const r = buildReport(withBoth)
    const line = r.text.split('\n').find((l) => l.startsWith('未確立'))
    assert.ok(!/規劃每一輪/.test(line), 'merging them is what lost the worker\'s own uncertainty')
  })

  test('a report with method caveats but no answer caveats still says so, rather than going quiet', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED, notEstablished: [], aboutTheEnquiry: ['x'] })
    assert.match(r.text, /關於這次查證/)
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

/**
 * ── COLLAPSE, DO NOT CAP (Owner ruling 2026-08-06) ───────────────────────────
 * 「Show 未確立 and 順帶發現 fully, but collapsed by default with the count visible. I expand
 * when the answer surprises me, which is the same habit as opening turns, one level cheaper.
 * Nothing is dropped, and the report stays readable when there is nothing surprising.」
 *
 * And the exception that keeps it honest: 「If a section has one or two entries, show them
 * inline — collapsing three lines is worse than reading them.」
 */
describe('long sections collapse; short ones do not', () => {
  const many = (n, p) => Array.from({ length: n }, (_, i) => p + (i + 1))

  test('three or more entries render as a COUNT, not as the entries', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED, notEstablished: many(8, 'u') })
    assert.match(r.text, /未確立（8）/)
    assert.ok(!r.text.includes('u5'), 'a collapsed section must not print its entries')
  })

  test('two entries render INLINE — collapsing three lines is worse than reading them', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED, notEstablished: ['aa', 'bb'] })
    assert.ok(r.text.includes('aa') && r.text.includes('bb'))
    assert.ok(!/未確立（2）/.test(r.text))
  })

  test('one entry renders inline too', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED, incidental: ['only one'] })
    assert.ok(r.text.includes('only one'))
    assert.ok(!/順帶發現（1）/.test(r.text))
  })

  test('NOTHING IS DROPPED — the full entries are always on the object', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED, notEstablished: many(8, 'u'), incidental: many(5, 'i') })
    assert.strictEqual(r.sections.notEstablished.length, 8)
    assert.strictEqual(r.sections.incidental.length, 5)
    assert.strictEqual(r.sections.notEstablished[7], 'u8', 'the eighth entry must survive collapsing')
  })

  test('the expanded form contains everything the collapsed form hid', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED, notEstablished: many(8, 'u') })
    for (const e of r.sections.notEstablished) assert.ok(r.expandedText.includes(e))
    assert.ok(r.expandedText.length > r.text.length)
  })

  test('collapsing never hides the ANSWER or the measurements — only the two long sections', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED, notEstablished: many(9, 'u'), incidental: many(9, 'i') })
    assert.ok(r.text.includes('唔係缺陷'), 'the answer is never collapsed')
    assert.ok(r.text.includes('has_incoming 18'), 'measurements are never collapsed')
    assert.ok(r.text.includes(CATALOGUE['inv.nothingChanged'].zh), 'what was applied is never collapsed')
  })
})

/* ══════════════ 2026-09-05: an unknown cost must never render as 0.00 ══════════════ */

describe('the cost line tells the truth about what it knows', () => {
  test('⛔ a null cost renders UNKNOWN, not 0.00', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED, costUsd: null })
    assert.match(r.text, /UNKNOWN/)
    assert.ok(!/US\$0\.00/.test(r.text), 'Number(null).toFixed(2) would have printed US$0.00: ' + r.text)
  })

  test('⛔ an OMITTED cost is unknown, not free', () => {
    const { costUsd, ...noCost } = { ...base }
    const r = buildReport({ ...noCost, outcome: OUTCOME.CONCLUDED })
    assert.match(r.text, /UNKNOWN/)
    assert.ok(!/US\$0\.00/.test(r.text))
  })

  test('a genuine zero still prints as 0.00 — free and unknown are different facts', () => {
    const r = buildReport({ ...base, outcome: OUTCOME.CONCLUDED, costUsd: 0 })
    assert.match(r.text, /US\$0\.00/)
    assert.ok(!/UNKNOWN/.test(r.text.split('\n').pop()), 'the footer must not say UNKNOWN for a known zero')
  })

  test('a known cost is unchanged', () => {
    assert.match(buildReport({ ...base, outcome: OUTCOME.CONCLUDED, costUsd: 1.5 }).text, /US\$1\.50/)
  })

  test('the returned object keeps null as null', () => {
    assert.strictEqual(buildReport({ ...base, outcome: OUTCOME.CONCLUDED, costUsd: null }).costUsd, null)
  })
})

describe('「resolved」 is two different words, and the guard must know which one it read', () => {
  // ⛔ THE REGRESSION THIS CLOSES IS NOT HYPOTHETICAL. A live read-only enquiry on 2026-09-05
  // returned a correct, schema-valid answer and lost all of it because it said the relative path
  // had been "resolved against the working directory". The dispatch was spent; the formatter
  // threw the result away.
  const path = { ...base, outcome: OUTCOME.CONCLUDED, measurements: [], appliedChanges: [] }

  for (const ok of [
    'The relative path was resolved against the working directory.',
    'The resolved path points outside the workspace.',
    '相對路徑解析後指向工作目錄之外。',
    'The import could not be resolved, so the module reference is dangling.',
    'The symlink target resolved to a directory outside the sandbox.'
  ]) {
    test('ACCEPTED — technical resolution: ' + JSON.stringify(ok), () => {
      const r = buildReport({ ...path, answer: ok })
      assert.ok(r.text.includes(ok), 'the answer must survive intact')
    })
  }

  for (const claim of [
    'The issue was resolved.',
    'I fixed the timeout bug.',
    '問題已修復。',
    'The bug has been resolved.',
    'I resolved the problem in the adapter.',
    'It was resolved.'
  ]) {
    test('REFUSED — a fix claim with nothing applied: ' + JSON.stringify(claim), () => {
      assert.throws(
        () => buildReport({ ...path, answer: claim }),
        ReportRefused,
        'a fix claim with nothing applied must not be constructible'
      )
    })
  }

  // ⛔ THE MIXED CASES ARE THE WHOLE REASON THIS IS PER-SENTENCE. Exempting an answer because
  // the word 「path」 appears somewhere in it would let a real fix claim ride along beside a
  // legitimate description — which is how a guard becomes decoration.
  for (const mixed of [
    'The path was resolved. I fixed the timeout bug.',
    'The resolved path is outside. The issue was resolved.',
    '相對路徑解析後指向工作目錄之外。問題已修復。'
  ]) {
    test('REFUSED — legitimate description does not launder a claim beside it: ' + JSON.stringify(mixed), () => {
      assert.throws(() => buildReport({ ...path, answer: mixed }), ReportRefused)
    })
  }

  test('the refusal names the offending SENTENCE, not just that something matched', () => {
    try {
      buildReport({ ...path, answer: 'The path was resolved. I fixed the timeout bug.' })
      assert.fail('should have refused')
    } catch (e) {
      assert.ok(e instanceof ReportRefused)
      assert.ok(e.message.includes('I fixed the timeout bug.'), 'the message must quote the claim: ' + e.message)
      assert.ok(!e.message.includes('The path was resolved'), 'and must not blame the innocent sentence')
    }
  })

  test('the classifier reports a verdict and a reason per clause', () => {
    const c = classifyFixClaim('The resolved path is outside. The issue was resolved.')
    assert.strictEqual(c.parts.length, 2)
    assert.strictEqual(c.parts[0].claim, false)
    assert.match(c.parts[0].reason, /resolution sense/)
    assert.strictEqual(c.parts[1].claim, true)
    assert.strictEqual(c.claim, true)
    assert.deepStrictEqual(c.offending, ['The issue was resolved.'])
  })

  test('an unclear 「resolved」 fails CLOSED — nothing resolvable named means it counts as a claim', () => {
    const c = classifyFixClaim('It was resolved.')
    assert.strictEqual(c.claim, true)
    assert.match(c.parts[0].reason, /undecidable/)
  })

  // ⛔ THE CORRECTION THAT MADE THIS SUITE NECESSARY A SECOND TIME.
  // A sentence-wide exemption meant one technical noun anywhere excused every 「resolved」 in the
  // sentence, and these three walked straight through it. Each pairs a real repair claim with a
  // technical noun — which is precisely what a careless or dishonest answer looks like.
  for (const laundered of [
    'The bug was fully resolved in the path handler.',
    'I resolved a bug in the module.',
    'The path was resolved, and the outage is now resolved.'
  ]) {
    test('REFUSED — a technical noun does not launder a repair claim: ' + JSON.stringify(laundered), () => {
      assert.throws(() => buildReport({ ...path, answer: laundered }), ReportRefused)
    })
  }

  test('the decision is per OCCURRENCE — an honest clause beside a claim is not blamed, and does not shield it', () => {
    const c = classifyFixClaim('The path was resolved, and the outage is now resolved.')
    assert.strictEqual(c.claim, true)
    assert.strictEqual(c.parts.length, 2)
    assert.strictEqual(c.parts[0].claim, false, 'the path clause is innocent')
    assert.strictEqual(c.parts[1].claim, true, 'the outage clause is not')
    assert.deepStrictEqual(c.offending, ['the outage is now resolved.'])
  })

  test('an issue noun FAR from the 「resolved」 does not condemn it — the window is bounded', () => {
    // 「the issue is still open」 is not a claim that anything was fixed, and it sits in its own
    // clause. An unbounded scan would have refused this.
    const r = buildReport({ ...path, answer: 'The path was resolved, and the issue is still open.' })
    assert.ok(r.text.includes('the issue is still open'))
  })

  // ⛔ CORRECTION TO THE PREVIOUS PACK. It listed 「The bug? Resolved.」 as an uncaught gap.
  // It is not: the second clause names nothing resolvable, so the fail-closed rule refuses it.
  test('「The bug? Resolved.」 IS refused — by the fail-closed rule, not by understanding the question', () => {
    assert.throws(() => buildReport({ ...path, answer: 'The bug? Resolved.' }), ReportRefused)
  })

  test('a change verb still fires even in a sentence full of path talk', () => {
    assert.throws(
      () => buildReport({ ...path, answer: 'I fixed the path resolution in the workspace directory.' }),
      ReportRefused,
      '「fixed」 is never contextual'
    )
  })

  test('the SAME claim is still allowed once something was actually applied', () => {
    const r = buildReport({ ...path, answer: 'The issue was resolved.', appliedChanges: [{ file: 'src/x.js', commit: 'abc1234' }] })
    assert.ok(r.text.includes('The issue was resolved.'))
  })

  // ⛔ A RECORDED GAP, ASSERTED SO IT STAYS VISIBLE. 解決 is not in the rule because it also
  // matches 解決方案 (「the solution」) — adding it would re-create the very false positive this
  // correction removes. This test exists so the hole is documented in the suite rather than
  // discovered later by someone assuming full coverage.
  test('RECORDED GAP — 「問題已解決」 is NOT caught, and that is deliberate', () => {
    const r = buildReport({ ...path, answer: '問題已解決。' })
    assert.ok(r.text.includes('問題已解決'), 'documented limit: a Chinese 解決 claim passes today')
  })

  test('VERIFY_CLAIM and CAUSE_CLAIM are untouched by this change', () => {
    assert.throws(() => buildReport({ ...path, answer: 'verified against production', executed: false }), ReportRefused)
    assert.throws(() => buildReport({ ...path, answer: 'slow because the index is missing', measurements: [] }), ReportRefused)
  })
})
