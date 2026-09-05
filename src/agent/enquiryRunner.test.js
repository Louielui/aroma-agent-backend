'use strict'

/**
 * enquiryRunner.test.js — a line of enquiry across dispatches, bounded by the dispatcher.
 *
 * ── WHY MULTI-TURN IS THE FEATURE ────────────────────────────────────────────
 * ~20 pastes in one investigation, ~3 of them approvals. The other ~17 were carrying a result
 * into the next round. Yesterday's investigation was FOUR rounds, each shaped by the previous
 * result — a single dispatch that returns once replaces one paste out of four.
 *
 * ── AND WHY CONTINUITY IS PART OF THE DESIGN, NOT AN OPTIMISATION ────────────
 * Without a resumed session, round 2 must be handed round 1's findings as text — and then
 * SHE becomes the transport layer instead of him. The same defect, one level down, and
 * harder to see because nobody is watching the pastes.
 *
 * Measured on the real CLI (2.1.251, 2026-09-05): `--session-id <uuid>`, `-r/--resume` and
 * `--max-turns` all exist, and the JSON result carries session_id, num_turns and total_cost_usd.
 * ⛔ CORRECTED: this header used to state "No --max-turns flag exists" — measured on an older
 * binary, wrong since, and inherited by every later reader as if it were current.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { runEnquiry, ENQUIRY } = require('./enquiryRunner')
const { OUTCOME, buildReport: realBuildReport } = require('./investigationReport')

/**
 * ⛔ THE RENDERER IS REPLACED IN AN ISOLATED MODULE LOAD, NEVER THROUGH AN INPUT.
 *
 * An earlier pass gave `runEnquiry` a `buildReportFn` option so these failures could be induced.
 * That is a test seam in a production signature, and it is a way for a caller to hand the runner
 * a validator that approves everything — the honesty checks live in exactly that validator. So it
 * is gone, and the failure is induced where it belongs: a fresh copy of the runner loaded against
 * a stubbed `./investigationReport`. The require cache is restored immediately; only the returned
 * copy holds the stub.
 */
function loadRunnerWithRenderer (fakeBuildReport) {
  const reportPath = require.resolve('./investigationReport')
  const runnerPath = require.resolve('./enquiryRunner')
  const realExports = require('./investigationReport')
  const savedReport = require.cache[reportPath]
  const savedRunner = require.cache[runnerPath]
  delete require.cache[runnerPath]
  require.cache[reportPath] = {
    id: reportPath,
    filename: reportPath,
    loaded: true,
    exports: Object.assign({}, realExports, { buildReport: fakeBuildReport })
  }
  let fresh
  try {
    fresh = require('./enquiryRunner')
  } finally {
    if (savedReport) require.cache[reportPath] = savedReport; else delete require.cache[reportPath]
    delete require.cache[runnerPath]
    if (savedRunner) require.cache[runnerPath] = savedRunner
  }
  return fresh.runEnquiry
}

/** A fake dispatcher recording the args it was given. */
function fakeWorker (replies) {
  const calls = []
  let i = 0
  return {
    calls,
    dispatch: async (args) => {
      calls.push(args)
      const r = replies[Math.min(i, replies.length - 1)]
      i++
      return { sessionId: r.sessionId ?? 'sess-1', result: r.result, costUsd: r.costUsd ?? 0.1, numTurns: r.numTurns ?? 1 }
    }
  }
}

const plan = (results) => {
  let i = 0
  // The "brain": decides whether the enquiry continues, given the last result.
  return async (last) => {
    const step = results[i++]
    return step || { done: true, answer: 'done', measurements: ['m'] }
  }
}

describe('session continuity', () => {
  test('round 1 opens a session id; later rounds RESUME it rather than starting fresh', async () => {
    const w = fakeWorker([{ result: 'r1' }, { result: 'r2' }, { result: 'r3' }])
    await runEnquiry({
      question: 'q',
      worker: w.dispatch,
      next: plan([{ done: false, goal: 'g1' }, { done: false, goal: 'g2' }, { done: false, goal: 'g3' }, { done: true, answer: 'a', measurements: ['m'] }]),
      budgetUsd: 5,
      maxRounds: 10, allowResume: true
    })
    assert.strictEqual(w.calls.length, 3)
    assert.ok(w.calls[0].sessionId, 'round 1 must mint a session id')
    assert.strictEqual(w.calls[1].resume, w.calls[0].sessionId, 'round 2 must RESUME, not restart')
    assert.strictEqual(w.calls[2].resume, w.calls[0].sessionId)
  })

  test('the prior result is NOT re-pasted into the next goal — that is the relay moving down a level', async () => {
    const w = fakeWorker([{ result: 'a very long round one finding' }, { result: 'r2' }])
    await runEnquiry({
      question: 'q',
      worker: w.dispatch,
      next: plan([{ done: false, goal: '第一輪' }, { done: false, goal: '跟住查條 view' }, { done: true, answer: 'a', measurements: ['m'] }]),
      budgetUsd: 5,
      maxRounds: 10, allowResume: true
    })
    assert.ok(!String(w.calls[1].goal).includes('a very long round one finding'),
      'the worker keeps its own context; re-pasting recreates the relay inside the system')
  })
})

describe('the dispatcher holds the ROUND and BUDGET caps (the CLI holds the turn cap)', () => {
  test('the round cap stops the enquiry and it reports STOPPED_ON_BUDGET', async () => {
    const w = fakeWorker([{ result: 'r' }])
    const out = await runEnquiry({
      question: 'q',
      worker: w.dispatch,
      next: plan([{ done: false, goal: 'g' }, { done: false, goal: 'g' }, { done: false, goal: 'g' }, { done: false, goal: 'g' }]),
      budgetUsd: 100,
      maxRounds: 2, allowResume: true,
      notEstablishedOnStop: ['未查完嘅嘢']
    })
    assert.strictEqual(w.calls.length, 2, 'must not exceed the round cap')
    assert.strictEqual(out.report.outcome, OUTCOME.STOPPED_ON_BUDGET)
  })

  test('the cost cap is checked BEFORE a round, not after it is already spent', async () => {
    const w = fakeWorker([{ result: 'r', costUsd: 0.6 }])
    const out = await runEnquiry({
      question: 'q',
      worker: w.dispatch,
      next: plan([{ done: false, goal: 'g' }, { done: false, goal: 'g' }, { done: false, goal: 'g' }]),
      budgetUsd: 1.0,
      maxRounds: 10, allowResume: true,
      notEstablishedOnStop: ['x']
    })
    // 0.6 spent; a second round would risk exceeding 1.0, so it must not be dispatched.
    assert.strictEqual(w.calls.length, 1, 'a round must not be dispatched with insufficient remaining budget')
    assert.strictEqual(out.report.outcome, OUTCOME.STOPPED_ON_BUDGET)
  })

  test('a completed enquiry reports CONCLUDED and the real cost', async () => {
    const w = fakeWorker([{ result: 'r', costUsd: 0.11 }, { result: 'r', costUsd: 0.13 }])
    const out = await runEnquiry({
      question: 'q',
      worker: w.dispatch,
      next: plan([{ done: false, goal: 'g' }, { done: false, goal: 'g' }, { done: true, answer: '唔係缺陷。', measurements: ['has_incoming 18'] }]),
      budgetUsd: 5,
      maxRounds: 10, allowResume: true
    })
    assert.strictEqual(out.report.outcome, OUTCOME.CONCLUDED)
    assert.ok(Math.abs(out.report.costUsd - 0.24) < 1e-9, 'cost is summed across rounds, got ' + out.report.costUsd)
    assert.strictEqual(out.report.rounds, 2)
  })

  test('stopping on budget can never render as finishing', async () => {
    const w = fakeWorker([{ result: 'r', costUsd: 0.9 }])
    const out = await runEnquiry({
      question: 'q', worker: w.dispatch,
      next: plan([{ done: false, goal: 'g' }, { done: false, goal: 'g' }]),
      budgetUsd: 1.0, maxRounds: 10, allowResume: true, notEstablishedOnStop: ['x']
    })
    const first = out.report.text.split('\n').find((l) => l.trim())
    assert.match(first, /未查完/, 'the halt must lead')
  })
})

describe('the turns are kept, and are not the report', () => {
  test('every round is recorded with its goal, result, cost and session', async () => {
    const w = fakeWorker([{ result: 'r1', costUsd: 0.1 }, { result: 'r2', costUsd: 0.2 }])
    const out = await runEnquiry({
      question: 'q', worker: w.dispatch,
      next: plan([{ done: false, goal: 'g1' }, { done: false, goal: 'g2' }, { done: true, answer: 'a', measurements: ['m'] }]),
      budgetUsd: 5, maxRounds: 10, allowResume: true
    })
    assert.strictEqual(out.turns.length, 2)
    for (const t of out.turns) {
      assert.ok(t.goal && t.result !== undefined && typeof t.costUsd === 'number' && t.sessionId)
      assert.ok(t.startedAt && t.finishedAt, 'a turn without times cannot be reviewed later')
    }
  })

  test('the report references the enquiry by id and does NOT inline the turns', async () => {
    const w = fakeWorker([{ result: 'a long transcript of round one' }])
    const out = await runEnquiry({
      question: 'q', worker: w.dispatch,
      next: plan([{ done: true, answer: 'a', measurements: ['m'] }]),
      budgetUsd: 5, maxRounds: 10, allowResume: true
    })
    assert.ok(out.enquiryId, 'an enquiry must be openable later')
    assert.ok(out.report.text.includes(out.enquiryId), 'the report must say how to open the turns')
    assert.ok(!out.report.text.includes('a long transcript of round one'),
      'the turns are what he checks when the report surprises him — not what he reads normally')
  })
})

describe('a worker failure is an outcome, not a silence', () => {
  test('a throwing dispatch reports FAILED rather than an empty conclusion', async () => {
    const out = await runEnquiry({
      question: 'q',
      worker: async () => { throw new Error('spawn refused') },
      next: plan([{ done: false, goal: 'g' }]),
      budgetUsd: 5, maxRounds: 10, allowResume: true, notEstablishedOnStop: ['x']
    })
    assert.strictEqual(out.report.outcome, OUTCOME.FAILED)
    assert.match(out.report.text, /spawn refused|失敗/)
  })
})

describe('ENQUIRY states are distinct', () => {
  test('the four outcomes are not collapsible into ok/not-ok', () => {
    assert.strictEqual(Object.keys(ENQUIRY).length >= 4, true)
  })
})

/* ══════════════ 2026-09-05 hardening ══════════════ */

describe('the turn bound travels with the dispatch', () => {
  test('maxTurns is handed to the worker on every round', async () => {
    const seen = []
    await runEnquiry({
      question: 'q',
      worker: async (a) => { seen.push(a.maxTurns); return { sessionId: 's', result: 'r', costUsd: 0, numTurns: 1 } },
      next: plan([{ done: false, goal: 'g1' }, { done: false, goal: 'g2' }, { done: true, answer: 'a', measurements: ['m'] }]),
      budgetUsd: 5, maxRounds: 10, allowResume: true, maxTurns: 3
    })
    assert.deepStrictEqual(seen, [3, 3], 'the CLI enforces the turn bound, so it must reach it')
  })

  test('an absent maxTurns is passed as undefined rather than invented here', async () => {
    let seen = 'unset'
    await runEnquiry({
      question: 'q',
      worker: async (a) => { seen = a.maxTurns; return { sessionId: 's', result: 'r', costUsd: 0 } },
      next: plan([{ done: false, goal: 'g' }, { done: true, answer: 'a', measurements: ['m'] }]),
      budgetUsd: 5, maxRounds: 1
    })
    assert.strictEqual(seen, undefined, 'the worker owns its own default; the runner must not fabricate one')
  })
})

describe('multi-round without session continuity is refused, not degraded', () => {
  test('maxRounds > 1 without allowResume refuses BEFORE any dispatch', async () => {
    let dispatched = 0
    await assert.rejects(
      () => runEnquiry({
        question: 'q',
        worker: async () => { dispatched += 1; return { sessionId: 's', result: 'r', costUsd: 0 } },
        next: plan([{ done: false, goal: 'g' }]),
        budgetUsd: 5, maxRounds: 4
      }),
      /requires allowResume/
    )
    assert.strictEqual(dispatched, 0, 'refusing after spending a round would not be a refusal')
  })

  test('a single round needs no resume and is allowed', async () => {
    const out = await runEnquiry({
      question: 'q',
      worker: async (a) => {
        assert.strictEqual(a.resume, undefined, 'round 1 never resumes')
        return { sessionId: 's', result: 'r', costUsd: 0.01 }
      },
      next: plan([{ done: false, goal: 'g' }, { done: true, answer: 'a', measurements: ['m'] }]),
      budgetUsd: 5, maxRounds: 1
    })
    assert.strictEqual(out.turns.length, 1)
  })
})

/* ══════════════ v5: unknown cost survives all the way into the report text ══════════════ */

describe('an unknown cost is UNKNOWN in the report the Owner reads', () => {
  test('⛔ a round with no reported cost makes the report say UNKNOWN, not US$0.00', async () => {
    const out = await runEnquiry({
      question: 'q',
      worker: async () => ({ payload: { answer: 'a', citations: [], notEstablished: [] }, costUsd: null }),
      next: plan([{ done: false, goal: 'g' }, { done: true, answer: 'a', measurements: ['m'] }]),
      budgetUsd: 5, maxRounds: 1
    })
    assert.strictEqual(out.turns[0].costUsd, null, 'the turn keeps it null')
    assert.strictEqual(out.report.costUsd, null, 'the report object keeps it null')
    assert.match(out.report.text, /UNKNOWN/, 'and the TEXT says so: ' + out.report.text)
    assert.ok(!/US\$0\.00/.test(out.report.text), 'US$0.00 would be a claim nobody checked')
  })

  test('a fully known enquiry still prints its real total', async () => {
    const out = await runEnquiry({
      question: 'q',
      worker: async () => ({ payload: { answer: 'a', citations: [], notEstablished: [] }, costUsd: 0.25 }),
      next: plan([{ done: false, goal: 'g' }, { done: true, answer: 'a', measurements: ['m'] }]),
      budgetUsd: 5, maxRounds: 1
    })
    assert.strictEqual(out.report.costUsd, 0.25)
    assert.match(out.report.text, /US\$0\.25/)
  })

  test('⛔ a FAILED round keeps the failure code, termination and diagnostics on the turn', async () => {
    const err = new Error('agent CLI stopped: timeout')
    err.failure = 'STOPPED'
    err.termination = { terminationRequested: true, killIssued: 'ISSUED', observedPidsGone: 'UNKNOWN' }
    err.diagnostics = { exitCode: null, stdoutBytes: 0, stderrBytes: 12 }
    const out = await runEnquiry({
      question: 'q',
      worker: async () => { throw err },
      next: plan([{ done: false, goal: 'g' }]),
      budgetUsd: 5, maxRounds: 1, notEstablishedOnStop: ['x']
    })
    const t = out.turns[0]
    assert.strictEqual(t.failure, 'STOPPED', 'a turn saying only "it broke" is unactionable')
    assert.strictEqual(t.termination.killIssued, 'ISSUED')
    assert.strictEqual(t.diagnostics.stderrBytes, 12)
    assert.strictEqual(t.costUsd, null, 'a failed round did not cost nothing; it cost an unreported amount')
    assert.match(out.report.text, /UNKNOWN/)
  })
})

describe('a report that will not render must NOT undo the round that already happened', () => {
  // ⛔ THE FAULT THIS CLOSES, EXACTLY. On 2026-09-05 a live dispatch returned a correct,
  // schema-valid payload. buildReport then refused the report because the answer mentioned a
  // path being resolved, the refusal propagated straight out of runEnquiry, and the caller lost
  // the payload, the confirmed citations, the evidence, the termination record, the session
  // identity and a cost the CLI had already reported. The money was spent either way; only the
  // evidence was destroyed, and it was destroyed by the formatter.

  /** A worker that genuinely succeeded, whose answer the report validator will reject. */
  const succeedingWorker = (overrides = {}) => {
    let calls = 0
    const dispatch = async () => {
      calls++
      return Object.assign({
        sessionId: 'sess-live-1',
        payload: { answer: 'I fixed the timeout bug.', citations: [{ path: 'a.js', startLine: 1, endLine: 1, quote: 'x' }], notEstablished: [] },
        answer: 'I fixed the timeout bug.',
        citations: [{ path: 'a.js', status: 'CONFIRMED', startLine: 1, endLine: 1 }],
        evidence: [{ source: 'disposable-copy:a.js', readState: 'OK' }],
        notEstablished: [],
        termination: { terminationRequested: false, killIssued: 'NOT_REQUESTED', directChildExited: true },
        costUsd: 0.07,
        numTurns: 3
      }, overrides)
    }
    return { dispatch, count: () => calls }
  }

  const runWith = async (worker, extra = {}, runner = runEnquiry) => runner(Object.assign({
    question: 'where is the timeout set?',
    worker: worker.dispatch,
    next: async (last) => (last
      ? { done: true, answer: last.answer, measurements: [], notEstablished: [] }
      : { done: false, goal: 'g' }),
    budgetUsd: 5,
    maxRounds: 1,
    notEstablishedOnStop: ['the report could not be rendered']
  }, extra))

  test('the enquiry says FAILED — never CONCLUDED — and does not re-dispatch', async () => {
    const w = succeedingWorker()
    const out = await runWith(w)
    assert.strictEqual(out.outcome, ENQUIRY.FAILED, 'a report that would not render is not a conclusion')
    assert.strictEqual(out.report.outcome, OUTCOME.FAILED)
    assert.strictEqual(w.count(), 1, 'exactly one dispatch — a reporting fault must never re-run the task')
  })

  test('everything the worker established is still there', async () => {
    const out = await runWith(succeedingWorker())
    const turn = out.turns[0]
    assert.strictEqual(out.turns.length, 1)
    assert.ok(turn.payload, 'the payload survives')
    assert.strictEqual(turn.payload.answer, 'I fixed the timeout bug.')
    assert.strictEqual(turn.citations[0].status, 'CONFIRMED', 'confirmed citations survive')
    assert.strictEqual(turn.evidence.length, 1, 'evidence rows survive')
    assert.strictEqual(turn.termination.directChildExited, true, 'the termination record survives')
    assert.strictEqual(turn.sessionId, out.sessionId, 'session identity survives')
    assert.strictEqual(turn.numTurns, 3)
    assert.ok(turn.startedAt && turn.finishedAt, 'the timings survive')
  })

  test('the failure is located at the REPORT, and is not disguised as a worker failure', async () => {
    const out = await runWith(succeedingWorker())
    assert.ok(out.reportFailure, 'a reporting fault must be reported as one')
    assert.strictEqual(out.reportFailure.locus, 'report validation/rendering')
    assert.strictEqual(out.reportFailure.errorName, 'ReportRefused')
    // ⛔ NOT a bare turns.length check — see the dedicated suite below. Here the candidate DID
    // come from the worker's own answer, and the field says so because the strings match.
    assert.strictEqual(out.reportFailure.rejectedCandidate.matchesAWorkerTurn, true)
    assert.strictEqual(out.reportFailure.rejectedCandidate.validated, false)
    assert.match(out.report.text, /buildReport/, 'the report says where it broke: ' + out.report.text)
    assert.strictEqual(out.turns[0].failure, undefined, 'the WORKER did not fail; nothing may claim it did')
    assert.strictEqual(out.turns[0].error, undefined)
  })

  test('the refused answer stays evidence — it is never displayed as the result', async () => {
    const out = await runWith(succeedingWorker())
    assert.ok(!out.report.text.includes('I fixed the timeout bug'), 'the rejected answer must not be rendered: ' + out.report.text)
    assert.ok(!out.report.expandedText.includes('I fixed the timeout bug'))
    assert.strictEqual(out.turns[0].payload.answer, 'I fixed the timeout bug.', 'but it is still retrievable from the turn')
  })

  test('the rendered locus carries the component and error class, NOT the exception text', async () => {
    const out = await runWith(succeedingWorker())
    // Feeding an arbitrary message back into the thing that just refused is how a second
    // refusal hides the first; the message lives in reportFailure, which nothing validates.
    assert.ok(!out.report.text.includes('appliedChanges is empty'), 'the exception text is not re-rendered')
    assert.match(out.reportFailure.message, /appliedChanges is empty/, 'but it is fully available as a diagnostic')
  })

  describe('cost survives the reporting fault, in all three states', () => {
    test('a KNOWN cost stays known', async () => {
      const out = await runWith(succeedingWorker({ costUsd: 0.07 }))
      assert.strictEqual(out.report.costUsd, 0.07, 'the money was spent before the formatter ran')
      assert.strictEqual(out.turns[0].costUsd, 0.07)
      assert.match(out.report.text, /US\$0\.07/)
      assert.ok(!/UNKNOWN/.test(out.report.text.split('\n').pop()), 'a known cost must not become UNKNOWN because a later step failed')
    })

    test('a genuine ZERO cost stays 0.00 and does not become UNKNOWN', async () => {
      const out = await runWith(succeedingWorker({ costUsd: 0 }))
      assert.strictEqual(out.report.costUsd, 0)
      assert.match(out.report.text, /US\$0\.00/)
      assert.ok(!/UNKNOWN/.test(out.report.text.split('\n').pop()))
    })

    test('an UNKNOWN cost stays null and renders UNKNOWN — never 0.00', async () => {
      const out = await runWith(succeedingWorker({ costUsd: undefined }))
      assert.strictEqual(out.report.costUsd, null)
      assert.strictEqual(out.turns[0].costUsd, null)
      assert.match(out.report.text, /UNKNOWN/)
      assert.ok(!/US\$0\.00/.test(out.report.text))
    })
  })

  test('an ORDINARY exception in report construction preserves the round just the same', async () => {
    // Not a ReportRefused — a plain programming error. The round is still real.
    let calls = 0
    const runner = loadRunnerWithRenderer((arg) => {
      calls++
      if (calls === 1) throw new TypeError('cannot read properties of undefined')
      return realBuildReport(arg)
    })
    const out = await runWith(succeedingWorker({ answer: 'The resolved path is outside the workspace.' }), {}, runner)
    assert.strictEqual(out.outcome, ENQUIRY.FAILED)
    assert.strictEqual(out.reportFailure.errorName, 'TypeError')
    assert.strictEqual(out.turns.length, 1)
    assert.ok(out.turns[0].payload, 'the payload survives an ordinary exception too')
    assert.strictEqual(out.turns[0].failure, undefined, 'a formatter bug is not a worker failure')
  })

  test('if the fallback ALSO fails there is no third attempt, and the report says so plainly', async () => {
    let calls = 0
    const runner = loadRunnerWithRenderer(() => { calls++; throw new Error('builder is broken: ' + calls) })
    const out = await runWith(succeedingWorker(), {}, runner)
    assert.strictEqual(calls, 2, 'exactly two attempts — a loop of refusals would bury the original fault')
    assert.strictEqual(out.outcome, ENQUIRY.FAILED)
    assert.strictEqual(out.report.outcome, OUTCOME.FAILED)
    assert.match(out.report.text, /REPORT UNAVAILABLE/)
    assert.strictEqual(out.report.costUsd, 0.07, 'even the last resort keeps a known cost')
    assert.match(out.reportFailure.fallbackAlsoFailed, /builder is broken: 2/)
    assert.strictEqual(out.turns.length, 1, 'and the round is still preserved')
  })

  test('a legitimate answer still concludes normally — the guard did not become permissive', async () => {
    const w = succeedingWorker({
      answer: 'The relative path was resolved against the working directory.',
      payload: { answer: 'The relative path was resolved against the working directory.', citations: [], notEstablished: [] }
    })
    const out = await runWith(w)
    assert.strictEqual(out.outcome, ENQUIRY.CONCLUDED)
    assert.strictEqual(out.reportFailure, null)
    assert.ok(out.report.text.includes('resolved against the working directory'))
  })
})

describe('describing the failure must never BE the failure', () => {
  // ⛔ THE HANDLER OF LAST RESORT RUNS ON WHATEVER WAS THROWN, AND THAT IS NOT ALWAYS AN ERROR.
  // If reading `.name`, `.message` or `String(value)` can throw, then the code written to
  // preserve a completed round becomes the code that destroys it — the same defect one layer in.
  // Every one of these is thrown at the FIRST builder and then, separately, at the FALLBACK.

  const revokedProxy = () => {
    const r = Proxy.revocable({}, {})
    r.revoke()
    return r.proxy
  }
  const throwingName = () => ({ get name () { throw new Error('name getter explodes') }, message: 'm' })
  const throwingMessage = () => ({ name: 'Weird', get message () { throw new Error('message getter explodes') } })
  // no readable name or message, and every conversion throws — the value cannot be described at all
  const throwingConversion = () => ({ toString () { throw new Error('toString explodes') }, [Symbol.toPrimitive] () { throw new Error('toPrimitive explodes') } })

  const HOSTILE = [
    ['null', () => null],
    ['undefined', () => undefined],
    ['a bare string', () => 'just a string, not an Error'],
    ['a throwing name getter', throwingName],
    ['a throwing message getter', throwingMessage],
    ['a throwing conversion', throwingConversion],
    ['a revoked Proxy', revokedProxy]
  ]

  const worker = () => {
    let calls = 0
    return {
      count: () => calls,
      dispatch: async () => {
        calls++
        return {
          sessionId: 'sess-hostile',
          payload: { answer: 'a normal answer', citations: [], notEstablished: [] },
          answer: 'a normal answer',
          citations: [],
          evidence: [{ source: 'x' }],
          termination: { terminationRequested: false },
          costUsd: 0.05,
          numTurns: 2
        }
      }
    }
  }

  const run = async (runner, w) => runner({
    question: 'q',
    worker: w.dispatch,
    next: async (last) => (last ? { done: true, answer: last.answer, measurements: [], notEstablished: [] } : { done: false, goal: 'g' }),
    budgetUsd: 5,
    maxRounds: 1,
    notEstablishedOnStop: ['nothing']
  })

  for (const [label, make] of HOSTILE) {
    test('thrown by the FIRST builder — ' + label + ' — still yields a clean FAILED', async () => {
      const w = worker()
      const runner = loadRunnerWithRenderer((arg) => {
        // first call throws the hostile value; the fallback is allowed to succeed
        if (!runner.__called) { runner.__called = true; throw make() }
        return realBuildReport(arg)
      })
      const out = await run(runner, w)
      assert.strictEqual(out.outcome, ENQUIRY.FAILED)
      assert.strictEqual(out.report.outcome, OUTCOME.FAILED)
      assert.strictEqual(w.count(), 1, 'no re-dispatch')
      assert.strictEqual(out.turns.length, 1, 'the round is preserved')
      assert.ok(out.turns[0].payload, 'the payload is preserved')
      assert.strictEqual(out.report.costUsd, 0.05, 'the known cost is preserved')
      assert.strictEqual(typeof out.reportFailure.errorName, 'string')
      assert.strictEqual(typeof out.reportFailure.message, 'string')
      assert.ok(out.reportFailure.errorName.length <= 60)
      assert.ok(out.reportFailure.message.length <= 500)
    })

    test('thrown by BOTH builder and fallback — ' + label + ' — still yields a clean FAILED', async () => {
      const w = worker()
      let calls = 0
      const runner = loadRunnerWithRenderer(() => { calls++; throw make() })
      const out = await run(runner, w)
      assert.strictEqual(calls, 2, 'exactly two attempts, never a third')
      assert.strictEqual(out.outcome, ENQUIRY.FAILED)
      assert.strictEqual(out.report.outcome, OUTCOME.FAILED)
      assert.match(out.report.text, /REPORT UNAVAILABLE/)
      assert.strictEqual(out.report.costUsd, 0.05, 'even here the known cost survives')
      assert.strictEqual(out.turns.length, 1)
      assert.strictEqual(typeof out.reportFailure.fallbackAlsoFailed, 'string')
    })
  }

  test('an unreadable error yields the FIXED text, not a crash and not an empty string', async () => {
    const runner = loadRunnerWithRenderer(() => { throw revokedProxy() })
    const out = await run(runner, worker())
    assert.match(out.reportFailure.errorName, /unavailable/)
    assert.match(out.reportFailure.message, /unavailable/)
  })

  test('the rendered report carries NO error-derived text — the locus is fixed', async () => {
    const runner = loadRunnerWithRenderer((arg) => {
      if (!runner.__once) { runner.__once = true; const e = new Error('boom'); e.name = 'SNEAKY_NAME_ÐÐÐ'; throw e }
      return realBuildReport(arg)
    })
    const out = await run(runner, worker())
    assert.ok(!out.report.text.includes('SNEAKY_NAME_ÐÐÐ'), 'an arbitrary errorName must never reach the report: ' + out.report.text)
    assert.ok(!out.report.text.includes('boom'))
    assert.strictEqual(out.reportFailure.errorName, 'SNEAKY_NAME_ÐÐÐ', 'but it is fully available as a diagnostic')
    assert.match(out.report.text, /buildReport/, 'the fixed locus still says where it broke')
  })

  test('cost states survive a hostile throw: known, genuine zero, and unknown', async () => {
    for (const [costUsd, expect] of [[0.05, 0.05], [0, 0], [undefined, null]]) {
      const w = {
        dispatch: async () => ({
          sessionId: 's', payload: { answer: 'a', citations: [], notEstablished: [] }, answer: 'a',
          citations: [], evidence: [], termination: {}, costUsd, numTurns: 1
        })
      }
      const runner = loadRunnerWithRenderer((arg) => {
        if (!runner.__c) { runner.__c = true; throw revokedProxy() }
        return realBuildReport(arg)
      })
      const out = await run(runner, w)
      assert.strictEqual(out.report.costUsd, expect, 'costUsd ' + costUsd + ' must render as ' + expect)
      assert.strictEqual(out.outcome, ENQUIRY.FAILED)
    }
  })
})

describe('the answer that was actually validated is preserved as what it is', () => {
  // ⛔ step.answer IS NOT ALWAYS THE WORKER'S ANSWER. `next()` composes the closing step, and it
  // may write something the worker never said. Claiming 「the rejected answer is in turns[]」
  // would then be false — and 「turns.length > 0」 does not make it true.

  const honestWorker = {
    dispatch: async () => ({
      sessionId: 'sess-honest',
      payload: { answer: 'The timeout is set in src/http.js line 12 and defaults to 30 seconds.', citations: [], notEstablished: [] },
      answer: 'The timeout is set in src/http.js line 12 and defaults to 30 seconds.',
      citations: [{ path: 'src/http.js', status: 'CONFIRMED' }],
      evidence: [{ source: 'disposable-copy:src/http.js' }],
      termination: { terminationRequested: false },
      costUsd: 0.09,
      numTurns: 2
    })
  }

  const FABRICATED = 'I fixed the timeout bug.'

  // Real runner, REAL builder. next() invents a fix claim the worker never made.
  const runFabricating = async () => runEnquiry({
    question: 'where is the timeout set?',
    worker: honestWorker.dispatch,
    next: async (last) => (last
      ? { done: true, answer: FABRICATED, measurements: [], notEstablished: [] }
      : { done: false, goal: 'g' }),
    budgetUsd: 5,
    maxRounds: 1,
    notEstablishedOnStop: ['nothing']
  })

  test('the enquiry fails, and the worker turn is untouched', async () => {
    const out = await runFabricating()
    assert.strictEqual(out.outcome, ENQUIRY.FAILED)
    assert.strictEqual(out.turns.length, 1)
    assert.match(out.turns[0].payload.answer, /timeout is set in src\/http\.js/, 'the turn still holds what the WORKER said')
    assert.ok(!out.turns[0].payload.answer.includes(FABRICATED), 'the turn is never rewritten to pretend the worker claimed a fix')
    assert.ok(!String(out.turns[0].answer).includes(FABRICATED))
  })

  test('the rejected candidate is kept separately, and marked as not validated', async () => {
    const out = await runFabricating()
    const c = out.reportFailure.rejectedCandidate
    assert.strictEqual(c.answer, FABRICATED, 'the exact string handed to the validator is kept')
    assert.strictEqual(c.validated, false)
    assert.match(c.source, /next\(\)/, 'and where it came from is named: ' + c.source)
    assert.match(c.note, /NOT an accepted conclusion/)
  })

  test('⛔ it does NOT claim the rejected answer is in turns when it never was', async () => {
    const out = await runFabricating()
    assert.strictEqual(out.reportFailure.rejectedCandidate.matchesAWorkerTurn, false,
      'turns.length > 0 is not evidence that THIS text is in them')
  })

  test('and when the candidate DID come from the worker, that is stated truthfully too', async () => {
    const claimingWorker = {
      dispatch: async () => ({
        sessionId: 's', payload: { answer: FABRICATED, citations: [], notEstablished: [] }, answer: FABRICATED,
        citations: [], evidence: [], termination: {}, costUsd: 0.02, numTurns: 1
      })
    }
    const out = await runEnquiry({
      question: 'q',
      worker: claimingWorker.dispatch,
      next: async (last) => (last ? { done: true, answer: last.answer, measurements: [], notEstablished: [] } : { done: false, goal: 'g' }),
      budgetUsd: 5, maxRounds: 1, notEstablishedOnStop: ['nothing']
    })
    assert.strictEqual(out.reportFailure.rejectedCandidate.matchesAWorkerTurn, true)
  })

  test('the failure report never displays the rejected candidate as a conclusion', async () => {
    const out = await runFabricating()
    assert.ok(!out.report.text.includes(FABRICATED), 'the report must not show it: ' + out.report.text)
    assert.ok(!out.report.expandedText.includes(FABRICATED))
    assert.strictEqual(out.report.outcome, OUTCOME.FAILED)
  })
})

describe('there is no caller-supplied way past the report validator', () => {
  // ⛔ THE COUNTER-EXAMPLE. While `buildReportFn` was an input, a caller could hand in a
  // validator that approves anything — and the honesty rules live entirely in that validator.
  // The option is gone; passing it must change nothing.
  test('a caller-supplied buildReportFn cannot turn an unbacked fix claim into CONCLUDED', async () => {
    const permissive = (arg) => ({
      outcome: arg.outcome, text: 'RUBBER STAMP', expandedText: 'RUBBER STAMP',
      sections: { notEstablished: [], incidental: [], aboutTheEnquiry: [], measurements: [], samples: [] },
      enquiryId: arg.enquiryId, rounds: arg.rounds, costUsd: arg.costUsd
    })
    const out = await runEnquiry({
      question: 'q',
      worker: async () => ({
        sessionId: 's', payload: { answer: 'I fixed the timeout bug.', citations: [], notEstablished: [] },
        answer: 'I fixed the timeout bug.', citations: [], evidence: [], termination: {}, costUsd: 0.03, numTurns: 1
      }),
      next: async (last) => (last ? { done: true, answer: last.answer, measurements: [], notEstablished: [] } : { done: false, goal: 'g' }),
      budgetUsd: 5,
      maxRounds: 1,
      notEstablishedOnStop: ['nothing'],
      // the option no longer exists; supplying it must be inert
      buildReportFn: permissive
    })
    assert.notStrictEqual(out.outcome, ENQUIRY.CONCLUDED, 'an unbacked fix claim must never conclude')
    assert.strictEqual(out.outcome, ENQUIRY.FAILED)
    assert.ok(!out.report.text.includes('RUBBER STAMP'), 'the supplied renderer must not have been used')
    assert.strictEqual(out.reportFailure.errorName, 'ReportRefused', 'the REAL validator ran')
  })
})

describe('the candidate answer is EVIDENCE, and evidence is not truncated', () => {
  // ⛔ THE DEFECT THIS CLOSES. The candidate used to be stored through the same bounded formatter
  // as an error message, capped at 4000 characters. An answer of 4,994 characters whose offending
  // sentence sat in the tail was therefore recorded with THE SENTENCE THAT CAUSED THE REFUSAL CUT
  // OFF — a record that cannot explain the refusal it exists to explain. Formatting a message and
  // preserving evidence are different jobs.

  const FILLER = 'The resolved path points inside the workspace and nothing was changed. '
  const TAIL = 'I fixed the timeout bug.'
  const LONG = FILLER.repeat(70) + TAIL   // ~4900 chars: over the old 4000 cap, under the schema's 20000

  const honestWorker = async () => ({
    sessionId: 'sess-long',
    payload: { answer: 'The timeout is set in src/http.js line 12.', citations: [], notEstablished: [] },
    answer: 'The timeout is set in src/http.js line 12.',
    citations: [{ path: 'src/http.js', status: 'CONFIRMED' }],
    evidence: [{ source: 'disposable-copy:src/http.js' }],
    termination: { terminationRequested: false },
    costUsd: 0.06,
    numTurns: 2
  })

  const runLong = async () => runEnquiry({
    question: 'where is the timeout set?',
    worker: honestWorker,
    next: async (last) => (last ? { done: true, answer: LONG, measurements: [], notEstablished: [] } : { done: false, goal: 'g' }),
    budgetUsd: 5,
    maxRounds: 1,
    notEstablishedOnStop: ['nothing']
  })

  test('the stored candidate is the full string, character for character', async () => {
    const out = await runLong()
    const c = out.reportFailure.rejectedCandidate
    assert.strictEqual(c.answer.length, LONG.length, 'length must match exactly: ' + c.answer.length + ' vs ' + LONG.length)
    assert.strictEqual(c.answer, LONG, 'the candidate must be preserved verbatim, not formatted')
    assert.strictEqual(c.verbatim, true)
    assert.strictEqual(c.available, true)
  })

  test('⛔ the sentence that CAUSED the refusal is still in the record', async () => {
    const out = await runLong()
    const c = out.reportFailure.rejectedCandidate
    assert.ok(c.answer.includes(TAIL), 'the offending tail is the whole reason the record exists')
    assert.ok(c.answer.indexOf(TAIL) > 4000, 'and it sits past the old cap, which is what made this a defect')
  })

  test('a preview exists for reading, and never replaces the evidence', async () => {
    const out = await runLong()
    const c = out.reportFailure.rejectedCandidate
    assert.strictEqual(c.preview.length, 500, 'the preview is bounded')
    assert.strictEqual(c.previewTruncated, true, 'and says that it is')
    assert.ok(!c.preview.includes(TAIL), 'the preview alone would have hidden the claim')
    assert.ok(c.answer.includes(TAIL), 'which is exactly why it is not the evidence')
  })

  test('the worker turn is untouched, and the report shows none of it', async () => {
    const out = await runLong()
    assert.strictEqual(out.outcome, ENQUIRY.FAILED)
    assert.strictEqual(out.turns.length, 1)
    assert.strictEqual(out.turns[0].payload.answer, 'The timeout is set in src/http.js line 12.')
    assert.ok(!String(out.turns[0].payload.answer).includes(TAIL), 'the turn is never rewritten')
    assert.strictEqual(out.reportFailure.rejectedCandidate.matchesAWorkerTurn, false)
    assert.ok(!out.report.text.includes(TAIL), 'the refused answer is not displayed as a conclusion')
    assert.ok(!out.report.expandedText.includes(TAIL))
    assert.ok(!out.report.text.includes(FILLER.trim()))
  })
})

describe('reading the closing step is inside the guard, not outside it', () => {
  // ⛔ `step` is caller code. `step.answer` can be a getter, and a getter can throw. Reading it
  // ABOVE the try — as the previous pass did — let that throw escape runEnquiry and destroy the
  // completed round: the exact fault the guard exists to prevent, re-introduced two lines outside
  // its reach.

  const revoked = () => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy }

  const hostileStep = (thrown) => {
    let reads = 0
    return {
      step: {
        done: true,
        measurements: [],
        notEstablished: [],
        get answer () { reads++; throw thrown() }
      },
      reads: () => reads
    }
  }

  const runHostile = async (thrown, costUsd) => {
    let dispatches = 0
    const h = hostileStep(thrown)
    const out = await runEnquiry({
      question: 'q',
      worker: async () => {
        dispatches++
        return {
          sessionId: 'sess-hostile-step',
          payload: { answer: 'a normal answer', citations: [], notEstablished: [] },
          answer: 'a normal answer',
          citations: [],
          evidence: [{ source: 'x' }],
          termination: { terminationRequested: false },
          costUsd,
          numTurns: 1
        }
      },
      next: async (last) => (last ? h.step : { done: false, goal: 'g' }),
      budgetUsd: 5,
      maxRounds: 1,
      notEstablishedOnStop: ['nothing']
    })
    return { out, dispatches, reads: h.reads() }
  }

  for (const [label, thrown] of [
    ['a plain throwing getter', () => new Error('answer getter explodes')],
    ['a getter that throws a revoked Proxy', revoked]
  ]) {
    test('step.answer is ' + label + ' — the enquiry still returns FAILED', async () => {
      const { out, dispatches, reads } = await runHostile(thrown, 0.06)
      assert.strictEqual(out.outcome, ENQUIRY.FAILED)
      assert.strictEqual(out.report.outcome, OUTCOME.FAILED)
      assert.strictEqual(dispatches, 1, 'a reporting fault must never re-run the task')
      assert.strictEqual(reads, 1, 'step.answer is read exactly once')
      assert.strictEqual(out.turns.length, 1, 'the completed round survives')
      assert.ok(out.turns[0].payload, 'and so does its payload')
    })

    test('step.answer is ' + label + ' — the failure is attributed to input preparation', async () => {
      const { out } = await runHostile(thrown, 0.06)
      assert.strictEqual(out.reportFailure.locus, 'report input preparation')
      assert.match(out.report.text, /before the validator saw anything/,
        'the report must not imply the validator refused something: ' + out.report.text)
      assert.ok(!out.report.text.includes('buildReport'), 'the validator is not blamed for a fault it never saw')
    })

    test('step.answer is ' + label + ' — the candidate is marked unavailable, and nothing is invented', async () => {
      const { out } = await runHostile(thrown, 0.06)
      const c = out.reportFailure.rejectedCandidate
      assert.strictEqual(c.available, false)
      assert.strictEqual(c.answer, null, 'no text may be fabricated for an answer that was never read')
      assert.strictEqual(c.preview, null)
      assert.strictEqual(c.validated, false)
      assert.strictEqual(c.matchesAWorkerTurn, false)
      assert.match(c.note, /never given one/, 'it must not claim the validator refused it')
      assert.strictEqual(typeof out.reportFailure.errorName, 'string')
      assert.strictEqual(typeof out.reportFailure.message, 'string')
    })

    for (const [costUsd, expect, label2] of [[0.06, 0.06, 'a known cost'], [0, 0, 'a genuine zero'], [undefined, null, 'an unknown cost']]) {
      test('step.answer is ' + label + ' — ' + label2 + ' survives', async () => {
        const { out } = await runHostile(thrown, costUsd)
        assert.strictEqual(out.report.costUsd, expect)
        assert.strictEqual(out.turns[0].costUsd, costUsd === undefined ? null : costUsd)
        assert.strictEqual(out.outcome, ENQUIRY.FAILED)
      })
    }
  }

  test('nothing is thrown out of runEnquiry in any of these cases', async () => {
    for (const thrown of [() => new Error('x'), revoked, () => null, () => undefined, () => 'a string']) {
      let threw = null
      try { await runHostile(thrown, 0.06) } catch (e) { threw = e }
      assert.strictEqual(threw, null, 'runEnquiry must absorb it, not re-raise it')
    }
  })
})

describe('a candidate that was read but never submitted says exactly that', () => {
  // ⛔ AVAILABILITY IS NOT SUBMISSION. `step.answer` can be read successfully and the assembly of
  // the REST of the report input can still throw — a `measurements` getter is enough. The
  // candidate is then available and fully preserved, but the validator never saw it. Describing
  // it as 「refused by the report validator」 would be a statement about a check that never ran,
  // which is the same family as every other claim this chapter exists to prevent.

  const CANDIDATE = 'The resolved path is inside the workspace and nothing was changed.'

  const stepThatBreaksAfterTheAnswer = () => {
    let answerReads = 0
    const step = { done: true, notEstablished: [] }
    Object.defineProperty(step, 'answer', {
      get () { answerReads++; return CANDIDATE },
      enumerable: true
    })
    Object.defineProperty(step, 'measurements', {
      get () { throw new Error('measurements getter explodes') },
      enumerable: true
    })
    return { step, answerReads: () => answerReads }
  }

  // ⛔ A DEFAULT PARAMETER CANNOT EXPRESS "unknown": run(undefined) would silently become
  // 0.08 and the unknown-cost case would test the known-cost path instead.
  const UNKNOWN_COST = Symbol("unknown cost")
  const run = async (costArg = 0.08) => {
    const costUsd = costArg === UNKNOWN_COST ? undefined : costArg
    let dispatches = 0
    const h = stepThatBreaksAfterTheAnswer()
    const out = await runEnquiry({
      question: 'where is the timeout set?',
      worker: async () => {
        dispatches++
        return {
          sessionId: 'sess-assembly',
          payload: { answer: 'The timeout is set in src/http.js line 12.', citations: [], notEstablished: [] },
          answer: 'The timeout is set in src/http.js line 12.',
          citations: [{ path: 'src/http.js', status: 'CONFIRMED' }],
          evidence: [{ source: 'disposable-copy:src/http.js' }],
          termination: { terminationRequested: false },
          costUsd,
          numTurns: 2
        }
      },
      next: async (last) => (last ? h.step : { done: false, goal: 'g' }),
      budgetUsd: 5,
      maxRounds: 1,
      notEstablishedOnStop: ['nothing']
    })
    return { out, dispatches, answerReads: h.answerReads() }
  }

  test('the enquiry FAILS, the round survives, and nothing is re-dispatched', async () => {
    const { out, dispatches, answerReads } = await run()
    assert.strictEqual(out.outcome, ENQUIRY.FAILED)
    assert.strictEqual(out.report.outcome, OUTCOME.FAILED)
    assert.strictEqual(dispatches, 1)
    assert.strictEqual(answerReads, 1, 'step.answer is still read exactly once')
    assert.strictEqual(out.turns.length, 1)
    assert.strictEqual(out.turns[0].payload.answer, 'The timeout is set in src/http.js line 12.')
    assert.strictEqual(out.report.costUsd, 0.08, 'the cost was spent before any of this')
  })

  test('the candidate is available and preserved in full', async () => {
    const { out } = await run()
    const c = out.reportFailure.rejectedCandidate
    assert.strictEqual(c.available, true, 'it WAS read; marking it unavailable would be false too')
    assert.strictEqual(c.answer, CANDIDATE)
    assert.strictEqual(c.verbatim, true)
    assert.strictEqual(c.matchesAWorkerTurn, false)
  })

  test('⛔ the note says it was never submitted — not that the validator refused it', async () => {
    const { out } = await run()
    const c = out.reportFailure.rejectedCandidate
    assert.match(c.note, /never submitted to the report validator/)
    assert.ok(!/refused by the report validator/.test(c.note),
      'the validator never ran; claiming a refusal would describe a check that did not happen: ' + c.note)
    assert.strictEqual(c.validated, false)
  })

  test('the note and the locus agree, and the report line agrees with both', async () => {
    const { out } = await run()
    assert.strictEqual(out.reportFailure.locus, 'report input preparation')
    assert.match(out.reportFailure.rejectedCandidate.note, /assembling the report input failed/)
    assert.match(out.report.text, /before the validator saw anything/)
    assert.ok(!out.report.text.includes('buildReport'), 'the validator is not named for a fault it never saw')
    assert.ok(!out.report.text.includes(CANDIDATE), 'and the candidate is still not displayed as a conclusion')
  })

  test('a validator refusal still says refused — the two phases keep their own wording', async () => {
    const out = await runEnquiry({
      question: 'q',
      worker: async () => ({
        sessionId: 's', payload: { answer: 'I fixed the timeout bug.', citations: [], notEstablished: [] },
        answer: 'I fixed the timeout bug.', citations: [], evidence: [], termination: {}, costUsd: 0.02, numTurns: 1
      }),
      next: async (last) => (last ? { done: true, answer: last.answer, measurements: [], notEstablished: [] } : { done: false, goal: 'g' }),
      budgetUsd: 5, maxRounds: 1, notEstablishedOnStop: ['nothing']
    })
    assert.strictEqual(out.reportFailure.locus, 'report validation/rendering')
    assert.match(out.reportFailure.rejectedCandidate.note, /refused by the report validator/)
  })

  for (const [costUsd, expect, label] of [[0.08, 0.08, 'a known cost'], [0, 0, 'a genuine zero'], [UNKNOWN_COST, null, 'an unknown cost']]) {
    test(label + ' survives an assembly failure', async () => {
      const { out } = await run(costUsd)
      assert.strictEqual(out.report.costUsd, expect)
      assert.strictEqual(out.outcome, ENQUIRY.FAILED)
      assert.strictEqual(out.reportFailure.rejectedCandidate.answer, CANDIDATE, 'and the answer is still kept')
    })
  }
})
