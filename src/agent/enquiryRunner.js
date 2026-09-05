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
 * ── THE CAPS: WHICH ONE LIVES WHERE ──────────────────────────────────────────
 * ⛔ CORRECTED 2026-09-05. This block used to state "**There is no --max-turns flag**", and the
 * runner counted rounds because of it. That was measured on an older binary and is now WRONG:
 * the CLI reference documents `--max-turns` ("Limit the number of agentic turns (print mode
 * only). Exits with an error when the limit is reached"), and the installed CLI is 2.1.251.
 * A stale measurement that has hardened into a comment is worse than no comment, because the
 * next reader inherits the conclusion without the date.
 *
 * So the bounds are now split, each where it can actually be enforced:
 *   TURNS   inside one dispatch  → --max-turns, passed to the worker, enforced by the CLI
 *   ROUNDS  across dispatches    → counted here; the CLI cannot see a round
 *   BUDGET  across dispatches    → checked here BEFORE each round rather than after it is
 *                                  already spent. `total_cost_usd` is a receipt, not a cap.
 * The CLI also has `--max-budget-usd`, which the worker passes only when a caller supplies it;
 * whether it binds under subscription authentication is UNKNOWN, so this runner does not rely
 * on it and keeps its own pre-round check.
 *
 * ── AND STOPPING IS NOT FINISHING ────────────────────────────────────────────
 * An enquiry that runs out of budget reports STOPPED_ON_BUDGET, on the first line. A halted
 * investigation rendering as a completed one is the same family as the Drive read that timed
 * out and rendered as 「nothing waiting」.
 */

const crypto = require('node:crypto')
const { t } = require('../i18n/t')
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
 * @param {function} input.worker     ({goal, sessionId, resume, maxTurns}) =>
 *   {sessionId, payload, answer, citations, evidence, notEstablished, costUsd|null, numTurns, termination}
 *   `payload` is the formal result; `result` is accepted as a legacy alias.
 *   costUsd of null means UNKNOWN — never zero.
 * @param {function} input.next       (lastResult) => {done, goal} | {done:true, answer, measurements, ...}
 * @param {number}   input.budgetUsd  the ENQUIRY budget, not a per-call one
 * @param {number}   input.maxRounds
 * @param {number}   [input.maxTurns]   agentic-turn bound handed to the worker per dispatch
 * @param {boolean}  [input.allowResume] default false — see the refusal below
 * @param {string[]} input.notEstablishedOnStop  what remains open if it halts
 * @param {function} [input.now]
 * @param {function} [input.newId]
 */
async function runEnquiry (input = {}) {
  const {
    question = '', worker, next, budgetUsd = 1, maxRounds = 6,
    maxTurns, allowResume = false,
    notEstablishedOnStop = [t('enq.notStated')], now = () => new Date().toISOString(),
    newId = () => crypto.randomUUID()
  } = input

  // ⛔ MULTI-ROUND WITHOUT RESUME IS REFUSED, NOT SILENTLY DEGRADED.
  // Rounds 2+ exist to build on round 1, and they do that by resuming the SAME session. Running
  // them without resume would still "work" — and would quietly hand every round an empty
  // context, which reads as the model forgetting rather than as a configuration mistake. The
  // first controlled task runs with maxRounds 1; anything more is an explicit decision.
  if (!allowResume && maxRounds > 1) {
    throw new Error('refuse: maxRounds > 1 requires allowResume — rounds without session continuity lose the context they exist to carry')
  }

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

  // The expected cost of the NEXT round, from the rounds whose cost we actually KNOW. Before
  // any round has run there is nothing to learn from, so a conservative floor is used — a first
  // round must not be skipped for lack of history.
  let knownCostRounds = 0
  let costUnknown = false
  const expectedNextCost = () => (knownCostRounds ? spent / knownCostRounds : 0)

  while (step && step.done === false) {
    if (turns.length >= maxRounds) { outcome = ENQUIRY.STOPPED_ON_BUDGET; break }
    // ⛔ AN UNKNOWN COST IS NOT A ZERO COST. If a round came back without a cost, the budget
    // arithmetic has a hole in it, and continuing would be approving the next round on the
    // strength of "we have spent nothing so far" — a sentence nobody checked. Stop instead.
    if (costUnknown) { outcome = ENQUIRY.STOPPED_ON_BUDGET; break }
    // CHECKED BEFORE, NOT AFTER. Spending past the cap and reporting it afterwards is not a
    // cap, it is a receipt.
    if (spent + expectedNextCost() > budgetUsd) { outcome = ENQUIRY.STOPPED_ON_BUDGET; break }

    const startedAt = now()
    let r
    try {
      r = await worker({
        goal: step.goal,
        // Round 1 opens the session; every later round resumes the SAME one, so the worker
        // keeps its own context and nothing has to be re-pasted. With allowResume false the
        // guard above has already limited this to a single round, so `resume` is never set.
        sessionId: turns.length === 0 ? sessionId : undefined,
        resume: turns.length === 0 ? undefined : sessionId,
        // The per-dispatch turn bound travels WITH the dispatch, so the CLI enforces it rather
        // than this runner discovering afterwards how many turns were spent.
        maxTurns
      })
    } catch (err) {
      failure = String((err && err.message) || 'dispatch failed')
      // Name the boundary rather than the call stack: which component handed what to which.
      failureLocus = 'enquiryRunner → worker dispatch (round ' + (turns.length + 1) + '): ' + failure
      outcome = ENQUIRY.FAILED
      // ⛔ AND THE TOTAL IS UNKNOWN FROM HERE ON. A dispatch that threw may have spent money
      // before it failed — the CLI reports cost in its result, and there was no result. Without
      // this line the footer printed US$0.00 for a run that may well have cost something, which
      // is the same "unknown became a confident number" defect one layer further out.
      costUnknown = true
      // A failed round did not cost nothing; it cost an amount nobody reported. null says that.
      // ⛔ AND THE EVIDENCE OF THE FAILURE TRAVELS WITH IT. The worker classifies its own
      // failures and records what it observed about stopping; dropping those here would leave
      // the turn saying only "it broke", which is the shape of every unactionable report.
      turns.push({
        goal: step.goal,
        payload: null,
        result: null,
        error: failure,
        failure: (err && err.failure) || null,
        termination: (err && err.termination) || null,
        diagnostics: (err && err.diagnostics) || null,
        costUsd: null,
        sessionId,
        startedAt,
        finishedAt: now()
      })
      break
    }

    // ⛔ THE FORMAL RESULT IS `payload`. `result` is kept as an alias for callers written
    // against the older shape, but nothing downstream reads two different things.
    const has = (k) => r !== null && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, k)
    const payload = has('payload') ? r.payload : r.result

    // ⛔ Number(r.costUsd || 0) IS GONE. It turned "we do not know" into "it cost nothing",
    // which then fed the budget check as if a round had been free.
    const costKnown = typeof r.costUsd === 'number' && Number.isFinite(r.costUsd)
    if (costKnown) { spent += r.costUsd; knownCostRounds += 1 } else { costUnknown = true }

    turns.push({
      goal: step.goal,
      payload,
      result: payload,
      // Everything the worker established travels with the turn; a handoff that drops the
      // evidence leaves the report asserting things nobody can look up.
      answer: has('answer') ? r.answer : undefined,
      citations: has('citations') ? r.citations : undefined,
      evidence: has('evidence') ? r.evidence : undefined,
      notEstablished: has('notEstablished') ? r.notEstablished : undefined,
      termination: has('termination') ? r.termination : undefined,
      costUsd: costKnown ? r.costUsd : null,
      numTurns: r.numTurns ?? null,
      sessionId,
      startedAt,
      finishedAt: now()
    })
    last = payload
    step = await next(last)
  }

  const finished = step && step.done === true && outcome === ENQUIRY.CONCLUDED

  const report = buildReport({
    outcome: finished ? OUTCOME.CONCLUDED : OUTCOME[outcome],
    question,
    answer: finished
      ? (step.answer || '')
      : (outcome === ENQUIRY.FAILED ? t('enq.failedMidway', { failure }) : t('enq.notFinished')),
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
    // ⛔ UNKNOWN ALL THE WAY OUT. If any round's cost was unreported, the TOTAL is not known
    // either — reporting the known part as if it were the whole would understate the spend in
    // the one line the Owner actually reads.
    costUsd: costUnknown ? null : spent,
    enquiryId
  })

  return { enquiryId, sessionId, turns, report, outcome: finished ? ENQUIRY.CONCLUDED : outcome }
}

module.exports = { runEnquiry, ENQUIRY }
