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
 *
 * ⛔ 「resolved」 IS TWO DIFFERENT WORDS, AND TREATING THEM AS ONE COST A REAL RESULT.
 * (Correction, 2026-09-05.) A live read-only enquiry returned a correct, schema-valid answer and
 * lost all of it because it contained the sentence 「the relative path was resolved against the
 * working directory」 — path resolution, not a claim of having repaired anything. Paths resolve,
 * hostnames resolve, imports resolve; any question about a codebase is likely to say so.
 *
 * The guard is still right to be strict, so it is NOT relaxed — it is made to read the words
 * around EACH occurrence of 「resolved」.
 *
 * ⛔ PER OCCURRENCE, NOT PER SENTENCE. (Correction, second pass.) A sentence-wide exemption
 * meant one technical noun anywhere in the sentence excused every 「resolved」 in it, and these
 * three sailed through:
 *     「The bug was fully resolved in the path handler.」
 *     「I resolved a bug in the module.」
 *     「The path was resolved, and the outage is now resolved.」
 * Each pairs a real repair claim with a technical noun, which is exactly what a dishonest — or
 * merely careless — answer looks like. The decision is now made separately for every occurrence,
 * inside a bounded window, so one honest clause cannot launder the clause beside it.
 *
 * ⛔ 「applied」 IS THE SAME WORD TWICE TOO, AND LEAVING IT UNCONDITIONAL COST ANOTHER RESULT.
 * (Correction, 2026-09-06.) The second pass made 「resolved」 contextual and deliberately kept
 * 「applied」 absolute, reasoning that a change verb is never contextual. A live repository audit
 * then returned a schema-valid answer with 12 of 15 citations confirmed — and lost it on the
 * sentence 「Every place it is read and applied to an outbound request」. A timeout value APPLIED
 * TO A REQUEST is not a code change APPLIED TO A REPOSITORY. Timeouts are applied to sockets,
 * headers to responses, styles to elements; any question about how a library works is likely to
 * say so. So 「applied」 now reads its context the same way, with its own two vocabularies.
 *
 * Rules, in this order:
 *   1. a change verb (fixed / patched / repaired, or the CJK forms) anywhere in the clause —
 *      always a claim, whatever else the clause says.
 *   2. for each contextual verb — 「resolved」, 「applied」 — a CLAIM noun in its LOCAL window is a
 *      claim, and beats the technical reading:
 *        resolved → an issue noun   (bug, outage, incident…)   「the bug … resolved … path handler」
 *        applied  → a change noun   (patch, fix, diff, commit…) 「the patch was applied to lib/」
 *   3. otherwise, a TECHNICAL subject in the same window → the computing sense, NOT a claim:
 *        resolved → path, symlink, module, hostname…
 *        applied  → request, socket, config, option, header, timeout…
 *   4. neither → fail closed. 「It was resolved」 and 「Applied.」 say nothing about what, and an
 *      unclear fix claim is still a fix claim.
 *
 * `appliedChanges` remains the only evidence that anything changed. Nothing here reads the
 * model's own word for it, and no answer is ever rewritten to get past the check.
 *
 * ⛔ AND IT IS NOT NATURAL-LANGUAGE UNDERSTANDING. It is a handful of regexes over a naive
 * clause split, and it does not claim to read meaning. Known and accepted gaps, written down
 * rather than implied:
 *   · 「問題已解決」 is NOT caught. 解決 also matches 解決方案 (「the solution」), so adding it
 *     would re-create the very false positive this correction removes. A Chinese
 *     issue-resolution form needs its own rule and its own gate; this pass does not widen into
 *     general language governance.
 *   · irony, quotation and hypotheticals are not understood at all.
 *   · a claim can always be written in words no list contains.
 * The guard narrows what can be claimed silently; it is not a proof of honesty.
 */
// ⛔ 「applied」 IS NO LONGER HERE. It moved to the contextual set below. 「fixed」, 「patched」 and
// 「repaired」 stay absolute: none of them has a routine technical sense in this codebase's
// vocabulary. The CJK forms also stay absolute — see the recorded asymmetry in the gaps above.
const ALWAYS_FIX = /\b(fixed|patched|repaired)\b|修好|修復|已修|改好|已改|套用/i
/** The verbs that mean two different things. Each carries its own pair of vocabularies. */
const CONTEXTUAL_VERB = /\b(resolved|applied)\b/gi
/** Things that get REPAIRED. Their presence beside 「resolved」 makes it a repair claim. */
const ISSUE_NOUN = /\b(issue|issues|problem|problems|bug|bugs|error|errors|failure|failures|defect|defects|ticket|tickets|incident|incidents|fault|faults|regression|regressions|outage|outages|crash|crashes|downtime|breakage|malfunction)\b/i
/**
 * Things that get RESOLVED in the computing sense.
 *
 * ⛔ `config` IS NOT IN THIS LIST, AND THAT IS DELIBERATE. It was added here in an earlier pass and
 * taken back out: a bare noun cannot clear 「resolved」, because 「I resolved the config」 reads just
 * as easily as 「I repaired the configuration」. Membership of this list is a blanket permission —
 * any clause where the noun sits near the verb passes — and `config` is too ambiguous to earn one.
 * The narrow case that genuinely needed it is handled by CONFIG_RESOLUTION below.
 */
const RESOLUTION_SUBJECT = /\b(path|paths|pathname|filename|file|directory|dir|folder|symlink|junction|link|target|hostname|host|dns|domain|url|uri|module|import|imports|require|reference|references|alias|variable|template|placeholder|relative|absolute|workspace|working directory|cwd|sandbox|promise|dependency|dependencies|version|specifier)\b/i
/**
 * The one config shape this rule accepts: 「config… resolved BY/FROM …」 or 「resolved config…
 * BY/FROM …」.
 *
 * ⛔ WHAT `by`/`from` IS, AND WHAT IT IS NOT. It is the SYNTACTIC SHAPE this rule recognises —
 * nothing more. It does not prove that no change was made, and it is not a fact about how repair
 * claims are worded: 「I resolved the config from the console」 has the same shape and would pass.
 * The narrowness is doing the work, not any insight into the sentence's meaning.
 *
 * ⛔ AND IT IS MATCHED AT THE OCCURRENCE, NOT IN THE WINDOW. Testing the window let one legitimate
 * 「config resolved by merge」 lend its frame to a second, unrelated 「resolved」 in the same clause:
 *     「The config resolved by merge and I resolved it.」        ← was accepted, is now refused
 *     「I resolved it and used the config resolved by merge.」   ← the same trick, other way round
 * So the two halves are checked against the text immediately adjacent to THIS 「resolved」: the
 * segment since the previous contextual verb must END with 「config… 」, and the text right after
 * must BEGIN with 「by/from」 — or, for the other order, with 「config… by/from」.
 */
const CONFIG_BEFORE = /\bconfig\w*\s+$/i
const CONFIG_AFTER_BY = /^\s*(?:by|from)\b/i
const CONFIG_AFTER_NOUN = /^\s+config\w*\s+(?:by|from)\b/i
/** Things that get APPLIED to a codebase. Their presence beside 「applied」 makes it a change claim. */
const CHANGE_NOUN = /\b(patch|patches|fix|fixes|change|changes|changeset|diff|diffs|commit|commits|edit|edits|migration|migrations|correction|corrections|workaround|hotfix|revision|refactor)\b/i
/**
 * Things that get APPLIED in the ordinary technical sense — a value to a request, a header to a
 * response, a style to an element. ⛔ Deliberately does NOT include 「file」 or 「repository」: those
 * are what a patch gets applied to, and treating them as innocent would reopen the hole.
 */
const APPLICATION_TARGET = /\b(request|requests|response|responses|socket|sockets|connection|connections|config|configuration|option|options|setting|settings|parameter|parameters|argument|arguments|value|values|header|headers|timeout|timeouts|deadline|signal|adapter|adapters|stream|streams|element|elements|style|styles|transform|transforms|filter|filters|rule|rules|policy|policies|limit|limits|interceptor|interceptors|default|defaults)\b/i

/**
 * ⛔ A TECHNICAL NOUN IS NOT A DEFENCE. (Correction, 2026-09-06, second pass on 「applied」.)
 * The first version accepted 「applied」 whenever an application target sat nearby — and
 * 「I applied the new timeout setting to production」 names `timeout` and `setting`, so it sailed
 * through. The noun says WHAT was applied; it says nothing about WHO applied it or WHEN. The two
 * meanings that must be told apart are:
 *
 *   describing how the code behaves    「the timeout is applied to the socket」        ← ordinary
 *   claiming an action was carried out 「I applied the new timeout setting to prod」   ← a claim
 *
 * ⛔ AND THE PLACE IS IRRELEVANT. Blocking the word 「production」 would be theatre: the same claim
 * is just as false about a local service, a staging box, or a file on this machine. What is
 * detected is the ACTION, not its destination.
 */
/** An action someone carried out: a first-person agent, or a completed passive. */
const AGENTIVE_APPLY = /\b(i|we|you)\b[^.!?;]{0,40}\bapplied\b|\b(has|have|had|was|were)\s+(?:been\s+)?applied\b|\bapplied\s+(?:it|them|this|that|these|those)\b/i
/**
 * 「the NEW configuration」 is something being introduced, not something the code already does.
 * ⛔ This is deliberately conservative and WILL refuse an honest sentence such as 「the new default
 * is applied to every request」 when describing a recent version. Uncertainty resolves to refusal,
 * and the author can rewrite; the opposite default lets an unbacked claim through.
 */
const INTRODUCED = /\b(new|newly|updated|revised|modified|added)\b/i
/**
 * Describing behaviour: a copula or auxiliary governing THIS 「applied」. 「is read and applied to …」
 *
 * ⛔ ANCHORED AT THE END, AND SEARCHED ONLY SINCE THE PREVIOUS OCCURRENCE. A clause-wide test was
 * the defect: 「The timeout is applied to requests and the operator applied the configuration to
 * staging」 contains 「is applied」, and one descriptive frame anywhere in the clause was letting
 * every later 「applied」 in the same clause through — including one with its own human agent.
 * The frame has to belong to the occurrence being judged, so the segment searched starts at the
 * END of the previous occurrence and must finish immediately before this one.
 */
const DESCRIPTIVE_BEFORE = /\b(is|are|being|gets|get)\b[^.!?;]{0,30}$/i
/** Naive on purpose: sentence terminators in both scripts, nothing cleverer. */
const SENTENCE_SPLIT = /(?<=[.!?;])\s+|(?<=[。！？；])/
/** A clause boundary — 「, and」 / 「, so」 and the CJK commas. Keeps one clause from covering another. */
const CLAUSE_SPLIT = /,\s+(?:and|but|so|yet|or|then|while|whereas)\b|[；;，、]/i

/**
 * How much text around one 「resolved」 counts as its context. Bounded on purpose: an unbounded
 * window is what let 「the issue is still open」 at the far end of a sentence condemn an honest
 * 「the path was resolved」 at the near end, and vice versa.
 */
const WINDOW_BEFORE = 60
const WINDOW_AFTER = 40

/**
 * Verdicts per clause, and per 「resolved」 inside it, so a refusal can say WHICH words claimed
 * what rather than only that something somewhere matched.
 * @returns {{claim: boolean, parts: {text: string, claim: boolean, reason: string}[], offending: string[]}}
 */
function classifyFixClaim (answer) {
  const text = String(answer == null ? '' : answer)
  const sentences = text.split(SENTENCE_SPLIT)
  const clauses = []
  for (const s of sentences) {
    for (const c of s.split(CLAUSE_SPLIT)) {
      const trimmed = String(c == null ? '' : c).trim()
      if (trimmed) clauses.push(trimmed)
    }
  }
  const parts = (clauses.length ? clauses : [text]).map((clause) => {
    if (ALWAYS_FIX.test(clause)) {
      return { text: clause, claim: true, reason: 'a change verb (fixed/patched/repaired or a CJK equivalent)' }
    }
    CONTEXTUAL_VERB.lastIndex = 0
    let m
    let sawResolved = false
    let firstTechnical = null
    // Where the previous contextual verb ended: the boundary of what THIS one may claim as context.
    let prevEnd = 0
    while ((m = CONTEXTUAL_VERB.exec(clause)) !== null) {
      sawResolved = true
      const verb = m[0].toLowerCase()
      // Each contextual verb brings its own pair: what makes it a claim, what makes it ordinary.
      const claimNoun = verb === 'applied' ? CHANGE_NOUN : ISSUE_NOUN
      const technicalNoun = verb === 'applied' ? APPLICATION_TARGET : RESOLUTION_SUBJECT
      const window = clause.slice(Math.max(0, m.index - WINDOW_BEFORE), m.index + m[0].length + WINDOW_AFTER)
      // ⛔ THE CLAIM NOUN BEATS THE TECHNICAL ONE. 「The bug was fully resolved in the path handler」
      // and 「the patch was applied to the config」 each name both; the one that decides is the thing
      // being repaired or changed, not the thing beside it.
      if (claimNoun.test(window)) {
        return {
          text: clause,
          claim: true,
          reason: verb === 'applied'
            ? '「applied」 with a change noun in its local context — a change claim'
            : '「resolved」 with an issue noun in its local context — a repair claim'
        }
      }
      if (verb === 'applied') {
        // ⛔ WHO AND WHEN, BEFORE WHAT. An agent or a completed passive means an act was carried
        // out; naming a technical target afterwards does not undo that.
        if (AGENTIVE_APPLY.test(window)) {
          return { text: clause, claim: true, reason: '「applied」 as an act someone carried out (agent or completed passive) — a change claim' }
        }
        if (INTRODUCED.test(window)) {
          return { text: clause, claim: true, reason: '「applied」 to something described as new or updated — read as introducing a change' }
        }
        // Only a descriptive frame governing THIS occurrence, AND a technical target, count as
        // ordinary behaviour. `sinceLast` starts at the end of the previous 「applied」, so a frame
        // belonging to an earlier occurrence cannot be borrowed by a later one.
        const sinceLast = clause.slice(prevEnd, m.index)
        if (DESCRIPTIVE_BEFORE.test(sinceLast) && technicalNoun.test(window)) {
          firstTechnical = firstTechnical || clause
          prevEnd = m.index + m[0].length
          continue
        }
        return { text: clause, claim: true, reason: '「applied」 without a descriptive frame — cannot tell behaviour from action, refused' }
      }
      // ⛔ `config` IS NOT ON THE GENERAL LIST. A bare noun cannot clear 「resolved」, because
      // 「I resolved the config」 is exactly as likely to mean 「I repaired it」. The narrow frame
      // below is checked against the text touching THIS occurrence — never the window, which is
      // wide enough to contain somebody else's frame.
      const before = clause.slice(prevEnd, m.index)
      const after = clause.slice(m.index + m[0].length)
      const configFrame = (CONFIG_BEFORE.test(before) && CONFIG_AFTER_BY.test(after)) || CONFIG_AFTER_NOUN.test(after)
      if (configFrame) { firstTechnical = firstTechnical || clause; prevEnd = m.index + m[0].length; continue }
      if (technicalNoun.test(window)) { firstTechnical = firstTechnical || clause; prevEnd = m.index + m[0].length; continue }
      // ⛔ FAIL CLOSED. Neither vocabulary matched: undecidable, and an undecidable fix claim is
      // treated as a fix claim. 「It was resolved」 and 「Applied.」 both land here.
      return { text: clause, claim: true, reason: '「' + verb + '」 with nothing recognisable named in its local context — undecidable, refused' }
    }
    if (!sawResolved) return { text: clause, claim: false, reason: 'no change verb' }
    return { text: clause, claim: false, reason: 'a contextual verb in its ordinary technical sense' }
  })
  const offending = parts.filter((p) => p.claim).map((p) => p.text)
  return { claim: offending.length > 0, parts, offending }
}
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
 * @param {number|null} input.costUsd  null (or omitted) means UNKNOWN — never rendered as 0.00
 * @param {string} input.transcript     NEVER inlined — see below
 * @param {string} input.enquiryId      how to open the turns if the report surprises him
 * @throws {ReportRefused}
 */
function buildReport (input = {}) {
  const {
    outcome, question = '', answer = '', measurements = [], notEstablished = [],
    aboutTheEnquiry = [], incidental = [], failureLocus = '',
    appliedChanges = [], executed = false, samples = [], rounds = 0, costUsd = null, enquiryId = null
  } = input

  if (!Object.prototype.hasOwnProperty.call(OUTCOME, outcome)) {
    throw new ReportRefused('unknown outcome: ' + outcome)
  }

  // ── 「FIXED」 WITHOUT AN APPLIED CHANGE IS STRUCTURALLY IMPOSSIBLE ─────────
  // Owner: 「should be structurally impossible, not discouraged」. The proof that this happens
  // to a careful author is that a complete, confident patch was written on 2026-08-05 for a
  // cause that was disproven hours later — and never applied.
  const fixClaim = classifyFixClaim(answer)
  if (fixClaim.claim && !nonEmpty(appliedChanges)) {
    throw new ReportRefused(
      'the answer claims something was fixed or applied, but appliedChanges is empty. ' +
      'Nothing was applied — say what was found instead. ' +
      // Naming the sentence is the difference between a rule someone can satisfy and a rule
      // someone works around by deleting words until it stops complaining.
      'The sentence that claims it: ' + JSON.stringify(fixClaim.offending[0])
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
    // ⛔ Number(null).toFixed(2) IS '0.00'. An enquiry whose cost nobody reported would have
    // printed as free — the same "unknown became a confident number" defect the runner just
    // had, one layer further out, and this is the layer the Owner actually reads.
    cost: (typeof costUsd === 'number' && Number.isFinite(costUsd)) ? costUsd.toFixed(2) : 'UNKNOWN',
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

module.exports = { OUTCOME, buildReport, ReportRefused, classifyFixClaim }
