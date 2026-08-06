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
 * Measured on the real CLI: `--session-id <uuid>` and `-r/--resume` exist, and the JSON
 * result carries session_id, num_turns and total_cost_usd. **No --max-turns flag exists**, so
 * the cap cannot be delegated to the worker.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { runEnquiry, ENQUIRY } = require('./enquiryRunner')
const { OUTCOME } = require('./investigationReport')

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
      maxRounds: 10
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
      maxRounds: 10
    })
    assert.ok(!String(w.calls[1].goal).includes('a very long round one finding'),
      'the worker keeps its own context; re-pasting recreates the relay inside the system')
  })
})

describe('the dispatcher holds the caps, because the CLI will not', () => {
  test('the round cap stops the enquiry and it reports STOPPED_ON_BUDGET', async () => {
    const w = fakeWorker([{ result: 'r' }])
    const out = await runEnquiry({
      question: 'q',
      worker: w.dispatch,
      next: plan([{ done: false, goal: 'g' }, { done: false, goal: 'g' }, { done: false, goal: 'g' }, { done: false, goal: 'g' }]),
      budgetUsd: 100,
      maxRounds: 2,
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
      maxRounds: 10,
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
      maxRounds: 10
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
      budgetUsd: 1.0, maxRounds: 10, notEstablishedOnStop: ['x']
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
      budgetUsd: 5, maxRounds: 10
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
      budgetUsd: 5, maxRounds: 10
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
      budgetUsd: 5, maxRounds: 10, notEstablishedOnStop: ['x']
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
