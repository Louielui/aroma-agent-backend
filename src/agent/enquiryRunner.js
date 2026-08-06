'use strict'

/**
 * enquiryRunner.js — one line of enquiry, across several dispatches, bounded here.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * MULTI-TURN IS THE FEATURE. Dispatch-by-capability is not.
 *
 * ~20 pastes in one investigation, ~3 of them approvals. The other ~17 were the Owner
 * carrying a result into the next round. Yesterday's investigation was FOUR rounds, each
 * shaped by the previous result — so a single dispatch that returns once replaces one paste
 * out of four and leaves him in the loop.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── CONTINUITY IS PART OF THE DESIGN, NOT AN OPTIMISATION ────────────────────
 * Round 1 mints a session id; every later round RESUMES it. Without that, round 2 has to be
 * handed round 1's findings as text — and then SHE is the transport layer instead of him.
 * The same defect one level down, and harder to see because nobody is watching the pastes.
 *
 * ── THE CAPS LIVE HERE BECAUSE THE CLI HAS NONE ──────────────────────────────
 * Measured on the real binary: `--session-id` and `-r/--resume` exist; `num_turns` and
 * `total_cost_usd` are REPORTED. **There is no --max-turns flag.** So the bound cannot be
 * delegated to the worker — the dispatcher counts, and checks the budget BEFORE each round
 * rather than after it is already spent.
 *
 * ── AND STOPPING IS NOT FINISHING ────────────────────────────────────────────
 * An enquiry that runs out of budget reports STOPPED_ON_BUDGET, on the first line. A halted
 * investigation rendering as a completed one is the same family as the Drive read that timed
 * out and rendered as 「nothing waiting」.
 */

const crypto = require('node:crypto')
const { OUTCOME, buildReport } = require('./investigationReport')

const ENQUIRY = Object.freeze({
  CONCLUDED: 'CONCLUDED',
  STOPPED_ON_BUDGET: 'STOPPED_ON_BUDGET',
  BLOCKED_NEEDS_YOU: 'BLOCKED_NEEDS_YOU',
  FAILED: 'FAILED'
})

/**
 * @param {object} input
 * @param {string}   input.question   the Owner's words
 * @param {function} input.worker     ({goal, sessionId, resume}) => {sessionId, result, costUsd, numTurns}
 * @param {function} input.next       (lastResult) => {done, goal} | {done:true, answer, measurements, ...}
 * @param {number}   input.budgetUsd  the ENQUIRY budget, not a per-call one
 * @param {number}   input.maxRounds
 * @param {string[]} input.notEstablishedOnStop  what remains open if it halts
 * @param {function} [input.now]
 * @param {function} [input.newId]
 */
async function runEnquiry (input = {}) {
  const {
    question = '', worker, next, budgetUsd = 1, maxRounds = 6,
    notEstablishedOnStop = ['未講明'], now = () => new Date().toISOString(),
    newId = () => crypto.randomUUID()
  } = input

  const enquiryId = 'enq_' + newId().slice(0, 8)
  const sessionId = newId()
  const turns = []
  let spent = 0
  let last = null
  let step = await next(null)
  let outcome = ENQUIRY.CONCLUDED
  let failure = null
  // WHERE it broke, not the stack. The stack stays in the turn record.
  let failureLocus = ''

  // The expected cost of the NEXT round, from what rounds have actually cost. Before any
  // round has run there is nothing to learn from, so a conservative floor is used — a first
  // round must not be skipped for lack of history.
  const expectedNextCost = () => (turns.length ? spent / turns.length : 0)

  while (step && step.done === false) {
    if (turns.length >= maxRounds) { outcome = ENQUIRY.STOPPED_ON_BUDGET; break }
    // CHECKED BEFORE, NOT AFTER. Spending past the cap and reporting it afterwards is not a
    // cap, it is a receipt.
    if (spent + expectedNextCost() > budgetUsd) { outcome = ENQUIRY.STOPPED_ON_BUDGET; break }

    const startedAt = now()
    let r
    try {
      r = await worker({
        goal: step.goal,
        // Round 1 opens the session; every later round resumes the SAME one, so the worker
        // keeps its own context and nothing has to be re-pasted.
        sessionId: turns.length === 0 ? sessionId : undefined,
        resume: turns.length === 0 ? undefined : sessionId
      })
    } catch (err) {
      failure = String((err && err.message) || 'dispatch failed')
      // Name the boundary rather than the call stack: which component handed what to which.
      failureLocus = 'enquiryRunner → worker dispatch (round ' + (turns.length + 1) + '): ' + failure
      outcome = ENQUIRY.FAILED
      turns.push({ goal: step.goal, result: null, error: failure, costUsd: 0, sessionId, startedAt, finishedAt: now() })
      break
    }

    spent += Number(r.costUsd || 0)
    turns.push({
      goal: step.goal,
      result: r.result,
      costUsd: Number(r.costUsd || 0),
      numTurns: r.numTurns ?? null,
      sessionId,
      startedAt,
      finishedAt: now()
    })
    last = r.result
    step = await next(last)
  }

  const finished = step && step.done === true && outcome === ENQUIRY.CONCLUDED

  const report = buildReport({
    outcome: finished ? OUTCOME.CONCLUDED : OUTCOME[outcome],
    question,
    answer: finished
      ? (step.answer || '')
      : (outcome === ENQUIRY.FAILED ? '中途失敗：' + failure : '未查完。'),
    measurements: finished ? (step.measurements || []) : (step && step.measurements) || [],
    notEstablished: finished ? (step.notEstablished || []) : notEstablishedOnStop,
    // TWO KINDS OF CAVEAT, kept apart on the way through as well. Merging them here would
    // undo the split one layer below the place it was made.
    aboutTheEnquiry: (step && step.aboutTheEnquiry) || input.aboutTheEnquiry || [],
    // A finding outside the question asked. Without somewhere to put it, the report discards
    // it silently — which is how a real defect lived only in the turns.
    incidental: (step && step.incidental) || [],
    failureLocus: outcome === ENQUIRY.FAILED ? (failureLocus || failure || 'dispatch failed') : '',
    appliedChanges: (finished && step.appliedChanges) || [],
    executed: Boolean(finished && step.executed),
    samples: (finished && step.samples) || [],
    rounds: turns.length,
    costUsd: spent,
    enquiryId
  })

  return { enquiryId, sessionId, turns, report, outcome: finished ? ENQUIRY.CONCLUDED : outcome }
}

module.exports = { runEnquiry, ENQUIRY }
