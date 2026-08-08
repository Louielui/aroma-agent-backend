'use strict'

const { t } = require('../i18n/t')

/**
 * investigationReport.js — the report, and the claims it cannot make.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE REPORT IS NOT A SUMMARY. IT IS THE ONLY REMAINING REVIEW.
 *
 * Before the dispatch path, the Owner carried every intermediate result by hand — ~20 pastes
 * in one investigation, of which ~3 were approvals. That relay was also, accidentally, a
 * review at every step: **three of the four wrong diagnoses of 2026-08-05 died in his hands
 * because each one passed through them.**
 *
 * Removing the relay removes a safety property he never chose. So the honesty of this file is
 * not a nicety — **it is the only place those diagnoses would now surface**, and it is
 * enforced structurally rather than asked for in a prompt.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const OUTCOME = Object.freeze({
  CONCLUDED: 'CONCLUDED',
  STOPPED_ON_BUDGET: 'STOPPED_ON_BUDGET',
  BLOCKED_NEEDS_YOU: 'BLOCKED_NEEDS_YOU',
  FAILED: 'FAILED'
})

class ReportRefused extends Error {
  constructor (message) { super(message); this.name = 'ReportRefused' }
}

/**
 * Claims of having CHANGED something. Deliberately covers both languages and the passive
 * forms — a rule that only catches 「fixed」 is a rule someone routes around by writing
 * 「已經改好」.
 */
const FIX_CLAIM = /\b(fixed|applied|patched|resolved|repaired)\b|修好|修復|已修|改好|已改|套用/i
const VERIFY_CLAIM = /\bverified\b|\bpassing\b|已驗證|驗證通過|測試通過/i
/** A causal assertion. These are the sentences that need a measurement beside them. */
const CAUSE_CLAIM = /\b(because|caused by|the cause is|root cause)\b|成因|原因係|係因為|由.*引起/i

function nonEmpty (a) { return Array.isArray(a) && a.length > 0 }

/**
 * @param {object} input
 * @param {string} input.outcome        one of OUTCOME
 * @param {string} input.question       what was asked
 * @param {string} input.answer         one or two sentences, with the number in them
 * @param {string[]} input.measurements facts he could re-run
 * @param {string[]} input.notEstablished what was NOT settled — named, never omitted
 * @param {object[]} input.appliedChanges anything actually applied. EMPTY means nothing was.
 * @param {boolean} input.executed      whether anything was actually run
 * @param {object[]} input.samples      numbers that came from a capped or sampled source
 * @param {number} input.rounds
 * @param {number} input.costUsd
 * @param {string} input.transcript     NEVER inlined — see below
 * @param {string} input.enquiryId      how to open the turns if the report surprises him
 * @throws {ReportRefused}
 */
function buildReport (input = {}) {
  const {
    outcome, question = '', answer = '', measurements = [], notEstablished = [],
    aboutTheEnquiry = [], incidental = [], failureLocus = '',
    appliedChanges = [], executed = false, samples = [], rounds = 0, costUsd = 0, enquiryId = null
  } = input

  if (!Object.prototype.hasOwnProperty.call(OUTCOME, outcome)) {
    throw new ReportRefused('unknown outcome: ' + outcome)
  }

  // ── 「FIXED」 WITHOUT AN APPLIED CHANGE IS STRUCTURALLY IMPOSSIBLE ─────────
  // Owner: 「should be structurally impossible, not discouraged」. The proof that this happens
  // to a careful author is that a complete, confident patch was written on 2026-08-05 for a
  // cause that was disproven hours later — and never applied.
  if (FIX_CLAIM.test(answer) && !nonEmpty(appliedChanges)) {
    throw new ReportRefused(
      'the answer claims something was fixed or applied, but appliedChanges is empty. ' +
      'Nothing was applied — say what was found instead.'
    )
  }

  // Reading a file is not running it.
  if (VERIFY_CLAIM.test(answer) && executed !== true) {
    throw new ReportRefused('the answer claims verification, but nothing was executed')
  }

  // A cause with no measurement beside it is exactly what produced three wrong diagnoses.
  if (CAUSE_CLAIM.test(answer) && !nonEmpty(measurements)) {
    throw new ReportRefused('a cause is asserted with no measurement in the same report')
  }

  // Stopping without naming what is unanswered reads as 「there was nothing left」.
  if (outcome === OUTCOME.STOPPED_ON_BUDGET && !nonEmpty(notEstablished)) {
    throw new ReportRefused('a stopped enquiry must say what it did not establish')
  }

  // ── A FAILURE MUST LOCATE THE FAULT ──────────────────────────────────────
  // The first real run failed with 「The "file" argument must be of type string」 — truthful,
  // and useless until someone read the shape of what resolveAgentCliCommand returns.
  //
  // > A truthful error that does not locate the fault is only half of what the report
  // > promises.
  //
  // A LOCUS, not a trace: name the two sides and what was wrong between them. The stack has
  // somewhere else to live — the turns — so this stays one line he will actually read.
  if (outcome === OUTCOME.FAILED && !String(failureLocus || '').trim()) {
    throw new ReportRefused('a failed enquiry must say WHERE it broke — which component handed what to which')
  }

  const lines = []

  // ── THE FIRST LINE CARRIES THE OUTCOME WHEN IT IS NOT A CLEAN CONCLUSION ──
  // A halted investigation rendering as a completed one is the same family as a Drive read
  // that timed out and rendered as 「nothing waiting」.
  if (outcome === OUTCOME.STOPPED_ON_BUDGET) {
    lines.push(t('inv.budgetExhausted'))
  } else if (outcome === OUTCOME.BLOCKED_NEEDS_YOU) {
    lines.push(t('inv.stoppedForYou'))
  } else if (outcome === OUTCOME.FAILED) {
    lines.push(t('inv.failed'))
  }

  if (question) lines.push(t('inv.question', { q: question }))
  if (answer) lines.push(answer)

  if (nonEmpty(measurements)) lines.push(t('inv.measured', { items: measurements.join(t('punct.clauseSep')) }))

  // A capped or sampled number must never read as a total.
  for (const s of samples) {
    lines.push(t('inv.notATotal', { what: s.what, why: s.why }))
  }

  if (String(failureLocus || '').trim()) lines.push(t('inv.failureLocus', { where: String(failureLocus).trim() }))

  // ── TWO KINDS OF CAVEAT, NEVER MERGED ────────────────────────────────────
  // 未確立 is what the WORKER could not establish about the ANSWER.
  // 關於呢次查證 is what the Owner should know about the METHOD.
  //
  // They were one section, and merging them cost exactly the thing that mattered: the
  // section filled up with 「I planned the rounds」 while the worker's own 「I have not
  // measured live row counts, so I cannot say whether this is latent or already firing
  // today」 was dropped. One is about the answer; the other is about how the answer was got.
  // ── COLLAPSE, DO NOT CAP ─────────────────────────────────────────────────
  // Owner ruling: the volume problem is solved by hiding, never by dropping. A section of
  // three or more renders as a COUNT; the entries stay on the object and in expandedText.
  // Expanding is the same habit as opening the turns, one level cheaper.
  //
  // TWO OR FEWER RENDER INLINE — 「collapsing three lines is worse than reading them」, and a
  // 「未確立（2）」 that costs a click to read two sentences is friction pretending to be tidiness.
  const COLLAPSE_ABOVE = 2
  const section = (label, items, collapsed) => {
    if (!nonEmpty(items)) return null
    if (collapsed && items.length > COLLAPSE_ABOVE) return t('inv.collapsed', { label, n: items.length })
    return t('inv.section', { label, items: items.join(t('punct.clauseSep')) })
  }
  /**
   * ⛔ THE PAIR IS RECORDED, NOT RE-PARSED.
   *
   * The expanded twin used to be rebuilt by regex-matching the COLLAPSED line back against the
   * literal labels 未確立｜順帶發現｜關於呢次查證. Those are catalogue entries now, so that
   * regex stops matching the moment the interface renders in English — and the failure is
   * SILENT: every section simply stays collapsed and the expanded form becomes identical to the
   * short one. Nothing throws, nothing is reported; the report is quietly less useful.
   *
   * 意思用欄位 travel，唔用字面. Both forms are now built from the same recorded (label, items)
   * pairs — which is what the comment below always claimed was happening.
   */
  const sections = []
  const pushSection = (label, items) => {
    const l = section(label, items, true)
    if (l) { lines.push(l); sections.push({ index: lines.length - 1, label, items }) }
  }

  pushSection(t('inv.notEstablished'), notEstablished)

  // ── INCIDENTAL FINDINGS ──────────────────────────────────────────────────
  // Without this section a report SILENTLY DISCARDS anything outside the question asked.
  // The run that prompted it found a real defect in passing — the adapter reads body.count,
  // a response-BODY field, while its own comment calls it 「the API's own header」 — and that
  // finding existed only in the turns.
  pushSection(t('inv.incidental'), incidental)

  pushSection(t('inv.aboutTheEnquiry'), aboutTheEnquiry)

  // SILENCE ABOUT CHANGES IS NOT ACCEPTABLE EITHER. A report that simply does not mention
  // applying anything leaves the reader to assume, and the assumption people make is the
  // comfortable one.
  lines.push(nonEmpty(appliedChanges)
    ? t('inv.applied', { changes: appliedChanges.map((c) => c.file + (c.commit ? ' @' + c.commit : '')).join(t('punct.listSep')) })
    : t('inv.nothingChanged'))

  lines.push(t('inv.footer', {
    rounds,
    cost: Number(costUsd).toFixed(2),
    enquiry: enquiryId ? t('inv.enquiryId', { id: enquiryId }) : ''
  }))

  // The expanded twin is rebuilt from the SAME arrays with collapsing off, so the two forms
  // cannot disagree about WHAT the report contains — only about how much of it is shown.
  const expanded = lines.slice()
  for (const sec of sections) expanded[sec.index] = section(sec.label, sec.items, false)

  // THE TRANSCRIPT IS NEVER INLINED. It is the thing he is trying to stop reading, and it is
  // retrievable on request by enquiryId — normally the report, the turns when it surprises.
  return {
    outcome,
    text: lines.join('\n'),
    expandedText: expanded.join('\n'),
    // NOTHING IS DROPPED. Collapsing is a rendering choice; every entry is always here.
    sections: { notEstablished, incidental, aboutTheEnquiry, measurements, samples },
    enquiryId,
    rounds,
    costUsd
  }
}

module.exports = { OUTCOME, buildReport, ReportRefused }
