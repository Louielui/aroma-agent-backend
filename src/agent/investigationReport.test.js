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
    // the reason wording generalised when 「applied」 joined 「resolved」 as a contextual verb
    assert.match(c.parts[0].reason, /ordinary technical sense/)
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

describe('「applied」 is two different words as well', () => {
  // ⛔ THE RUN THAT FORCED THIS. Dispatch 10 of 10 returned a schema-valid repository audit with 12
  // of 15 citations confirmed, and lost the whole report on one sentence:
  //     「Every place it is read and applied to an outbound request」
  // A timeout value APPLIED TO A REQUEST is not a code change APPLIED TO A REPOSITORY. The previous
  // pass made 「resolved」 contextual and deliberately left 「applied」 absolute; this is the
  // counter-example to that reasoning.
  const base = {
    question: 'q', measurements: [], notEstablished: [], rounds: 1, costUsd: 0.4,
    appliedChanges: [], outcome: OUTCOME.CONCLUDED
  }

  test('THE SENTENCE THAT COST DISPATCH 10 is accepted', () => {
    const answer = 'Every place it is read and applied to an outbound request: there are three adapters.'
    const r = buildReport({ ...base, answer })
    assert.ok(r.text.includes('applied to an outbound request'), 'the answer must survive intact')
  })

  for (const ok of [
    'The timeout is applied to the socket by req.setTimeout.',
    'The header is applied to the response.',
    'The default is applied to every request unless overridden.',
    'The style is applied to the element.',
    'The same limit is applied to each adapter.',
    'The value is applied to the config, and the path was resolved.'
  ]) {
    test('ACCEPTED — ordinary technical use: ' + JSON.stringify(ok), () => {
      assert.ok(buildReport({ ...base, answer: ok }).text.includes(ok))
    })
  }

  for (const claim of [
    'I applied the patch to lib/adapters/http.js.',
    'The fix was applied.',
    'I applied the change to the config.',
    'The migration was applied.',
    'The commit was applied to the repository.',
    'I applied a hotfix to the adapter.',
    'Applied.'
  ]) {
    test('REFUSED — a change claim with nothing applied: ' + JSON.stringify(claim), () => {
      assert.throws(() => buildReport({ ...base, answer: claim }), ReportRefused,
        'an unbacked change claim must still be impossible to construct')
    })
  }

  test('the change noun beats the technical one — 「applied the change to the config」 is a claim', () => {
    const c = classifyFixClaim('I applied the change to the config.')
    assert.strictEqual(c.claim, true)
    assert.match(c.parts.find((p) => p.claim).reason, /change noun/)
  })

  test('「Applied.」 alone fails CLOSED, exactly like 「It was resolved.」', () => {
    // Both are refused; the reasons differ because 「applied」 now tests for a descriptive frame
    // as well as a noun, so it can say WHICH check failed.
    for (const [bare, why] of [['Applied.', /without a descriptive frame/], ['It was resolved.', /undecidable/]]) {
      const c = classifyFixClaim(bare)
      assert.strictEqual(c.claim, true, bare)
      assert.match(c.parts.find((p) => p.claim).reason, why)
    }
  })

  test('the same claim is still allowed once something really was applied', () => {
    const r = buildReport({ ...base, answer: 'The fix was applied.', appliedChanges: [{ file: 'src/x.js', commit: 'abc1234' }] })
    assert.ok(r.text.includes('The fix was applied.'))
  })

  test('fixed / patched / repaired stay ABSOLUTE — only 「applied」 became contextual', () => {
    for (const word of [
      'I fixed the request handler.',
      'The socket was patched.',
      'The adapter was repaired.'
    ]) {
      assert.throws(() => buildReport({ ...base, answer: word }), ReportRefused,
        word + ' must still be refused even though it names a technical thing')
    }
  })

  test('a technical clause cannot launder a change claim beside it', () => {
    assert.throws(
      () => buildReport({ ...base, answer: 'The timeout is applied to the socket. I applied the patch.' }),
      ReportRefused
    )
  })

  // ⛔ FOUND BY THE REPLAY, NOT BY THE BRIEF — see the comment on RESOLUTION_SUBJECT.
  test('「the config resolved by resolveConfig.js」 is technical, not a claim', () => {
    const answer = 'Both read the value from the config resolved by lib/helpers/resolveConfig.js.'
    assert.ok(buildReport({ ...base, answer }).text.includes('config resolved by'))
  })

  test('…but 「I resolved the config issue」 is still a claim — the claim noun is tested first', () => {
    assert.throws(() => buildReport({ ...base, answer: 'I resolved the config issue.' }), ReportRefused)
  })

  // ⛔ RECORDED ASYMMETRY. The CJK 套用 stays absolute. It carries the same ambiguity as 「applied」
  // (「套用預設值」 = apply the default value), but widening the Chinese branch was not in this
  // correction's scope and would need its own rule and gate. Pinned here so the gap stays visible.
  test('RECORDED ASYMMETRY — CJK 套用 remains unconditional', () => {
    assert.throws(() => buildReport({ ...base, answer: '套用到每個 request。' }), ReportRefused,
      'documented limit: the Chinese form is still absolute')
  })
})

describe('a technical noun is not a defence — behaviour vs an act carried out', () => {
  // ⛔ THE HOLE THE FIRST PASS LEFT. Making 「applied」 contextual by NOUN alone meant
  // 「I applied the new timeout setting to production」 walked through: it names `timeout` and
  // `setting`, which were on the innocent list. The noun says WHAT was applied. It says nothing
  // about WHO applied it or WHEN, and those are the words that turn a description into a claim.
  //
  // ⛔ AND THE DESTINATION IS IRRELEVANT. Blocking 「production」 would be theatre — the same claim
  // is just as unbacked about a local service or a file on this machine. What is detected is the
  // act, not where it landed.
  const base = {
    question: 'q', measurements: [], notEstablished: [], rounds: 1, costUsd: 0.4,
    appliedChanges: [], outcome: OUTCOME.CONCLUDED
  }

  // Every one of these goes through the REAL buildReport, not the classifier alone.
  for (const claim of [
    'I applied the new timeout setting to production.',
    'The new configuration has been applied to production.',
    'I applied the new configuration to the local service.',
    'The timeout is applied to the socket. I applied the new configuration to production.',
    'We applied the new request limit to staging.',
    'The updated timeout has been applied.',
    'I applied it to the adapter.',
    'The new default was applied to every request.'
  ]) {
    test('REFUSED via buildReport — an act, not a behaviour: ' + JSON.stringify(claim), () => {
      assert.throws(() => buildReport({ ...base, answer: claim }), ReportRefused,
        'a technical noun must not clear a claim that something was carried out')
    })
  }

  test('the destination is not what decides it — local and production fail alike', () => {
    for (const where of ['production', 'the local service', 'staging', 'my machine']) {
      assert.throws(
        () => buildReport({ ...base, answer: 'I applied the new configuration to ' + where + '.' }),
        ReportRefused,
        where + ' must be refused too'
      )
    }
  })

  for (const ok of [
    'Every place it is read and applied to an outbound request',
    'The timeout is applied to the socket by req.setTimeout.',
    'The header is applied to the response.',
    'The default is applied to every request unless overridden.',
    'The style is applied to the element.',
    'The same limit is applied to each adapter.',
    'mergeConfig applies the default when the request omits one.'
  ]) {
    test('ACCEPTED via buildReport — describing how the code behaves: ' + JSON.stringify(ok), () => {
      assert.ok(buildReport({ ...base, answer: ok }).text.includes(ok))
    })
  }

  test('the reason distinguishes the two, so a refusal can be argued with', () => {
    const act = classifyFixClaim('I applied the new timeout setting to production.')
    assert.strictEqual(act.claim, true)
    assert.match(act.parts.find((p) => p.claim).reason, /act someone carried out|new or updated/)

    const behaviour = classifyFixClaim('The timeout is applied to the socket.')
    assert.strictEqual(behaviour.claim, false)
    assert.match(behaviour.parts[0].reason, /ordinary technical sense/)
  })

  test('a bare 「applied to X」 with no descriptive frame is refused, not guessed at', () => {
    const c = classifyFixClaim('Applied to the socket')
    assert.strictEqual(c.claim, true)
    assert.match(c.parts.find((p) => p.claim).reason, /without a descriptive frame/)
  })

  // ⛔ THE COST OF BEING CONSERVATIVE, WRITTEN DOWN. 「new」 makes a clause refusable even when the
  // author meant 「the newly-added default that the code now applies」. That is a real false
  // positive and it is accepted on purpose: uncertainty resolves to refusal, and the author can
  // rewrite. The opposite default lets an unbacked claim through.
  test('RECORDED COST — an honest sentence about a NEW default is refused too', () => {
    assert.throws(
      () => buildReport({ ...base, answer: 'The new default is applied to every request.' }),
      ReportRefused,
      'documented: 「new」 is treated as introducing a change, even when it describes behaviour'
    )
    // and the author can say the same thing without the trigger word
    assert.ok(buildReport({ ...base, answer: 'The default is applied to every request.' }).text.includes('every request'))
  })

  test('an evidenced change is unaffected — the same sentences pass with appliedChanges', () => {
    for (const claim of [
      'I applied the new timeout setting to production.',
      'The new configuration has been applied to production.'
    ]) {
      const r = buildReport({ ...base, answer: claim, appliedChanges: [{ file: 'src/x.js', commit: 'abc1234' }] })
      assert.ok(r.text.includes(claim))
      assert.match(r.text, /已套用|Applied:/)
    }
  })

  test('the earlier corrections still hold', () => {
    assert.ok(buildReport({ ...base, answer: 'Both read the value from the config resolved by lib/helpers/resolveConfig.js.' }).text.includes('config resolved'))
    for (const still of ['I applied the patch to lib/adapters/http.js.', 'The fix was applied.', 'I resolved the config issue.', 'The bug was fully resolved in the path handler.']) {
      assert.throws(() => buildReport({ ...base, answer: still }), ReportRefused, still)
    }
  })
})

describe('a descriptive frame belongs to ONE occurrence, not to the whole clause', () => {
  // ⛔ THE HOLE THE PREVIOUS PASS LEFT. The frame test ran over the entire clause, so one honest
  // 「is applied」 anywhere in it cleared every later 「applied」 in the same clause — including one
  // with its own human agent. The frame now has to sit immediately before the occurrence being
  // judged, searched only from the end of the previous occurrence.
  const base = {
    question: 'q', measurements: [], notEstablished: [], rounds: 1, costUsd: 0.4,
    appliedChanges: [], outcome: OUTCOME.CONCLUDED
  }

  test('REFUSED — an agent with no frame of its own', () => {
    assert.throws(() => buildReport({ ...base, answer: 'The operator applied the configuration to staging.' }), ReportRefused)
  })

  test('⛔ REFUSED — an honest 「is applied」 earlier in the clause does not cover a later act', () => {
    assert.throws(
      () => buildReport({ ...base, answer: 'The timeout is applied to requests and the operator applied the configuration to staging.' }),
      ReportRefused,
      'the second 「applied」 has its own agent and no frame; it must not borrow the first one\'s'
    )
  })

  test('…and the same shape without a comma, which no clause split would catch', () => {
    assert.throws(
      () => buildReport({ ...base, answer: 'The header is applied to the response and the engineer applied the migration to the database.' }),
      ReportRefused
    )
  })

  test('ACCEPTED — two ordinary descriptions side by side, each with its own frame', () => {
    const answer = 'The timeout is applied to the socket and the header is applied to the response.'
    assert.ok(buildReport({ ...base, answer }).text.includes(answer))
  })

  test('ACCEPTED — three of them, so the binding is not an accident of two', () => {
    const answer = 'The timeout is applied to the socket, the header is applied to the response and the limit is applied to each adapter.'
    assert.ok(buildReport({ ...base, answer }).text.includes('each adapter'))
  })

  test('ACCEPTED — the sentence that started all of this still passes', () => {
    const answer = 'Every place it is read and applied to an outbound request'
    assert.ok(buildReport({ ...base, answer }).text.includes(answer))
  })

  test('the destination is still not what decides it', () => {
    for (const where of ['staging', 'production', 'the local service', 'my laptop']) {
      assert.throws(
        () => buildReport({ ...base, answer: 'The operator applied the configuration to ' + where + '.' }),
        ReportRefused, where
      )
    }
  })
})

describe('「config」 earns its exception by frame, not by being named', () => {
  // ⛔ AN EARLIER PASS PUT `config` ON THE GENERAL RESOLUTION LIST. That is a blanket permission —
  // any clause with the noun near the verb passes — and it let 「I resolved the config」 through,
  // which reads just as easily as 「I repaired the configuration」. The noun is back off the list;
  // only the passive frame that NAMES A RESOLVER is recognised.
  const base = {
    question: 'q', measurements: [], notEstablished: [], rounds: 1, costUsd: 0.4,
    appliedChanges: [], outcome: OUTCOME.CONCLUDED
  }

  test('ACCEPTED — a passive naming what did the resolving', () => {
    const answer = 'Both read the value from the config resolved by resolveConfig.js.'
    assert.ok(buildReport({ ...base, answer }).text.includes('config resolved by'))
  })

  test('ACCEPTED — the same frame with a different resolver and no filename at all', () => {
    const answer = 'Each adapter uses the configuration resolved by the merge step.'
    assert.ok(buildReport({ ...base, answer }).text.includes('resolved by the merge step'))
  })

  test('⛔ REFUSED — the bare noun no longer clears it', () => {
    assert.throws(() => buildReport({ ...base, answer: 'I resolved the config.' }), ReportRefused,
      'naming a config is not describing a resolution')
  })

  test('REFUSED — and an issue noun still decides first', () => {
    assert.throws(() => buildReport({ ...base, answer: 'I resolved the config issue.' }), ReportRefused)
  })

  test('the rest of the resolution vocabulary is untouched', () => {
    for (const ok of [
      'The relative path was resolved against the working directory.',
      'The import could not be resolved, so the module reference is dangling.',
      'The symlink target resolved to a directory outside the sandbox.'
    ]) {
      assert.ok(buildReport({ ...base, answer: ok }).text.includes(ok), ok)
    }
    for (const claim of ['The issue was resolved.', 'The bug was fully resolved in the path handler.', 'It was resolved.']) {
      assert.throws(() => buildReport({ ...base, answer: claim }), ReportRefused, claim)
    }
  })
})
