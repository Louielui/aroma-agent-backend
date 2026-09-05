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
 * ⛔ READING AN ERROR CAN ITSELF THROW, AND THIS ONE RUNS IN THE HANDLER OF LAST RESORT.
 *
 * Whatever reaches the report guard is not guaranteed to be an Error. It can be `null`,
 * `undefined`, a bare string, an object whose `name` or `message` is a getter that throws, an
 * object whose `toString` throws, or a revoked Proxy where EVERY operation throws. If describing
 * the failure can throw, the code that exists to preserve a completed round becomes the code that
 * destroys it — which is the same defect one layer further in.
 *
 * So nothing here touches the value without a guard, and every path has a fixed answer.
 */
const UNREADABLE = 'unavailable (the error value could not be read safely)'
const NAME_CAP = 60
const MESSAGE_CAP = 500
/**
 * ⛔ A PREVIEW IS NOT THE EVIDENCE. (Correction, final pass.)
 * The candidate answer used to be stored through the same bounded formatter as an error message,
 * capped at 4000 characters. A 4,994-character answer whose offending sentence sat in the tail
 * was therefore recorded with **the sentence that caused the refusal cut off** — a record that
 * cannot explain the refusal it exists to explain. The two jobs are now separate: an error
 * message is formatted and bounded, a candidate answer is PRESERVED. The cap below applies only
 * to the human-sized preview, never to the stored evidence.
 */
const PREVIEW_CAP = 500

/** A bounded string for any value, or the fixed text. Never throws. */
function safeErrorText (value, cap = MESSAGE_CAP) {
  try {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'string') return value.slice(0, cap)
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    const s = String(value)
    return typeof s === 'string' ? s.slice(0, cap) : UNREADABLE
  } catch (_) { return UNREADABLE }
}

/** One string property, or null. A throwing getter and a revoked Proxy both land in the catch. */
function safeProperty (value, key, cap) {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return null
    const v = value[key]
    return typeof v === 'string' ? v.slice(0, cap) : null
  } catch (_) { return null }
}

/**
 * ⛔ THE RENDERED REPORT NEVER CARRIES ERROR-DERIVED TEXT. A fixed locus is the whole point:
 * feeding an arbitrary message back into the validator that just refused is how a second refusal
 * hides the first, and an attacker-or-accident-supplied `name` has no business being interpolated
 * into the Owner's report. Everything variable lives in `reportFailure`, which nothing validates
 * and nothing renders.
 */
const PHASE = Object.freeze({
  PREPARING: 'report input preparation',
  VALIDATING: 'report validation/rendering'
})
const LOCUS = Object.freeze({
  [PHASE.PREPARING]: 'enquiryRunner → assembling the report input failed before the validator saw anything; the completed round is preserved in turns[]',
  [PHASE.VALIDATING]: 'enquiryRunner → investigationReport.buildReport did not produce a report; the completed round is preserved in turns[]'
})

/**
 * The candidate answer, kept as EVIDENCE rather than as a formatted message.
 *
 * ⛔ A STRING IS STORED VERBATIM — not sliced, not converted, not normalised. Whatever the
 * validator was given is exactly what is recorded, because the point of the record is to show
 * why the refusal happened, and the reason can be anywhere in the text.
 * A non-string cannot be stored as a string without inventing one, so it is not: `answer` stays
 * null, `answerType` says what it was, and only the PREVIEW is derived.
 */
function describeCandidate (available, phase, candidateAnswer, candidateSource, turns) {
  if (!available) {
    return {
      available: false,
      answer: null,
      answerType: null,
      verbatim: false,
      preview: null,
      source: candidateSource,
      validated: false,
      matchesAWorkerTurn: false,
      // ⛔ NOT 「the validator refused it」. It never reached the validator.
      note: 'the candidate answer could not be read; the validator was never given one'
    }
  }
  const isString = typeof candidateAnswer === 'string'
  // ⛔ NOT `turns.length > 0`. That says a round happened, not that THIS text is in it — and
  // `next()` may have composed something no turn ever contained. Compare the actual strings.
  const matchesAWorkerTurn = turns.some((turn) => {
    try {
      const fromPayload = turn && turn.payload && turn.payload.answer
      return (isString && typeof turn.answer === 'string' && turn.answer === candidateAnswer) ||
             (isString && typeof fromPayload === 'string' && fromPayload === candidateAnswer)
    } catch (_) { return false }
  })
  const preview = isString
    ? candidateAnswer.slice(0, PREVIEW_CAP)
    : safeErrorText(candidateAnswer, PREVIEW_CAP)
  return {
    available: true,
    // the exact value the validator received, untouched when it is a string
    answer: isString ? candidateAnswer : null,
    answerType: typeof candidateAnswer,
    verbatim: isString,
    // display only; never a substitute for `answer`
    preview,
    previewTruncated: isString && candidateAnswer.length > PREVIEW_CAP,
    source: candidateSource,
    validated: false,
    matchesAWorkerTurn,
    // ⛔ THE NOTE FOLLOWS THE PHASE, NOT MERELY WHETHER AN ANSWER EXISTS.
    // A candidate can be read successfully and the assembly of the REST of the report input can
    // still throw — a `measurements` getter is enough. The candidate is then available and fully
    // preserved, but it never reached the validator, and saying 「refused by the report
    // validator」 would be a statement about a check that never ran.
    note: phase === PHASE.VALIDATING
      ? 'refused by the report validator — diagnostic evidence, NOT an accepted conclusion'
      : 'the candidate answer was obtained, but assembling the report input failed; it was never submitted to the report validator'
  }
}

function describeReportFailure (err, phase, candidate) {
  return {
    locus: phase,
    errorName: safeProperty(err, 'name', NAME_CAP) || UNREADABLE,
    message: safeProperty(err, 'message', MESSAGE_CAP) || safeErrorText(err),
    // The answer that was ACTUALLY handed to the validator, kept as what it is: a candidate that
    // did not pass. It is never promoted into the report, and the turn it came from is never
    // edited to pretend the worker said it.
    rejectedCandidate: candidate
  }
}

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
  let finalOutcome = finished ? ENQUIRY.CONCLUDED : outcome

  // ⛔ THE ROUND ALREADY HAPPENED. A REPORT THAT WILL NOT RENDER MUST NOT UNDO IT.
  // (Correction, 2026-09-05.) buildReport was called bare, so any refusal — including the one
  // that fires when an answer merely says a PATH was resolved — propagated straight out of
  // runEnquiry. The caller got an exception and lost the whole turn with it: the payload, the
  // confirmed citations, the evidence, the termination record, the session identity, and a cost
  // the CLI had already reported. A live dispatch was spent and its result destroyed by the
  // formatter, which is a strictly worse failure than an ugly report.
  //
  // So the report is built inside a guard, and a failure here is a REPORTING failure: it is
  // named as one, the enquiry says FAILED rather than CONCLUDED, and everything the worker
  // established stays exactly where it was — in `turns`.
  const knownCostUsd = costUnknown ? null : spent
  let report = null
  let reportFailure = null

  // ⛔ READING THE CLOSING STEP IS INSIDE THE GUARD, NOT BEFORE IT.
  // `step` comes from `next()`, which is caller code: `step.answer` can be a getter, and a getter
  // can throw. Reading it above the try — as an earlier pass did — let that throw escape
  // `runEnquiry` and destroy the completed round, which is precisely the fault the guard exists
  // to prevent, re-introduced two lines outside its reach. Assembly happens inside now, and the
  // phase is tracked so the failure can say whether the validator ever saw anything.
  //
  // ⛔ AND step.answer IS READ EXACTLY ONCE. The same snapshot is validated and preserved; a
  // second read could return something different, and then the record would describe an answer
  // the validator never received.
  let phase = PHASE.PREPARING
  let candidateAnswer = null
  let candidateSource = 'unavailable — reading the closing step threw'
  let candidateAvailable = false

  try {
    // ⛔ THE ANSWER THAT GOES TO VALIDATION IS NOT ALWAYS THE WORKER'S ANSWER.
    // `next()` composes the closing step, and it may summarise, join rounds, or write something
    // of its own. If the validator then refuses, saying 「the rejected answer is in turns[]」
    // would be false — turns hold what the WORKER said.
    candidateAnswer = finished
      ? (step.answer || '')
      : (outcome === ENQUIRY.FAILED ? t('enq.failedMidway', { failure }) : t('enq.notFinished'))
    candidateSource = finished ? 'next() closing step (step.answer)' : 'runner-composed status text'
    candidateAvailable = true

    const reportInput = {
      outcome: finished ? OUTCOME.CONCLUDED : OUTCOME[outcome],
      question,
      answer: candidateAnswer,
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
      costUsd: knownCostUsd,
      enquiryId
    }

    // Everything the caller could make throw has now been read. From here the only thing that
    // can fail is the validator itself, and the phase says so.
    phase = PHASE.VALIDATING
    report = buildReport(reportInput)
  } catch (err) {
    // ⛔ THIS IS A REPORTING FAULT, AND IT SAYS SO. Nothing here re-dispatches, re-runs the task
    // or edits the worker's answer to get past the validator — any of those would be the system
    // rewriting evidence to make its own check pass.
    reportFailure = describeReportFailure(err, phase, describeCandidate(candidateAvailable, phase, candidateAnswer, candidateSource, turns))
    finalOutcome = ENQUIRY.FAILED
    try {
      report = buildReport({
        outcome: OUTCOME.FAILED,
        question,
        // Fixed, trusted, claim-free text from the catalogue — never the refused answer, and
        // never the exception string.
        answer: t('enq.notFinished'),
        measurements: [],
        notEstablished: notEstablishedOnStop,
        aboutTheEnquiry: [],
        incidental: [],
        failureLocus: LOCUS[phase],
        appliedChanges: [],
        executed: false,
        samples: [],
        rounds: turns.length,
        // ⛔ A KNOWN COST STAYS KNOWN. The money was spent before the formatter ran; turning it
        // into UNKNOWN because a later step failed would understate the spend, and an already
        // unknown cost stays null rather than becoming a number.
        costUsd: knownCostUsd,
        enquiryId
      })
    } catch (second) {
      // No third attempt: another call to the same builder is another chance to be refused, and
      // a loop of refusals would bury the original fault. This is the SAME object shape the
      // builder returns — not a second report system — with the failure stated in the first line.
      // ⛔ THE SECOND ERROR IS READ AS UNSAFELY AS THE FIRST — which is to say, not at all
      // directly. A fallback whose own diagnostics throw would lose the result it exists to save.
      reportFailure.fallbackAlsoFailed = safeErrorText(second)
      const line = 'REPORT UNAVAILABLE — ' + LOCUS[phase]
      report = Object.freeze({
        outcome: OUTCOME.FAILED,
        text: line,
        expandedText: line,
        sections: { notEstablished: notEstablishedOnStop, incidental: [], aboutTheEnquiry: [], measurements: [], samples: [] },
        enquiryId,
        rounds: turns.length,
        costUsd: knownCostUsd
      })
    }
  }

  return { enquiryId, sessionId, turns, report, reportFailure, outcome: finalOutcome }
}

module.exports = { runEnquiry, ENQUIRY }
