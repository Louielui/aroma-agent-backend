'use strict'

/**
 * rankingProof.js — a superlative is a CLAIM ABOUT ROWS NOBODY SAW unless the ordering is proven.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ OBSERVED ON THE UI, 2026-08-12, bootCommit 0bcdc2f. Eight turns asking
 * 「現在缺貨最嚴重的是什麼？」. Some replies said honestly that the most severe shortage could
 * not be determined. Others printed 「缺貨排序」 and 「最緊急缺貨項目」, and one put Jars for
 * Red Chili Oil (shortfall 20) AHEAD of Napa Cabbage (shortfall 70).
 *
 * Both kinds came from the SAME code path. Claim binding was already computed and, in its own
 * words at `answerPlan.js:1251`, 「COMPUTED, RETURNED, AND ACTED ON BY NOTHING」. Nothing
 * distinguished the honest reply from the invented one except what the model chose to write.
 *
 * > **Owner ruling: 「缺貨最嚴重」 defaults to the largest ABSOLUTE shortfall,
 * > `parLevel - currentStock`. A percentage question must be asked explicitly before a
 * > proportional metric is used. She must not silently switch metric, and must not ask the
 * > Owner what 「severe」 means for the default case.**
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ WHAT THIS IS NOT ──────────────────────────────────────────────────────
 * Not a ranker. It computes no ordering and reorders nothing. The adapter already sorted;
 * this only decides whether what the model WROTE is entitled to the word 「最」.
 *
 * ── ⛔ AND IT IS NOT `sourceTotal` ───────────────────────────────────────────
 * `sourceTotal` is null on every endpoint by design. The question here is narrower and
 * answerable: did the ordering see everything the server sent?
 */

/** The metrics that exist. A claim naming anything else is refused, not translated. */
const RANKING_METRIC = Object.freeze({
  ABSOLUTE_SHORTFALL: 'absolute_shortfall',
  SUGGESTED_ORDER_QTY: 'suggested_order_qty',
  /** ⛔ Nothing sorts by this. It is named ONLY so a claim asking for it can be refused by name. */
  PROPORTIONAL_SHORTFALL: 'proportional_shortfall'
})

/**
 * ⛔ THE OWNER'S DEFAULT, RECORDED AS A CONVENTION RATHER THAN INFERRED PER TURN.
 * 「缺貨最嚴重」 means absolute shortfall. She does not ask him what he meant, and she does not
 * quietly answer a percentage question with an absolute ordering or the reverse.
 */
const DEFAULT_SHORTAGE_METRIC = RANKING_METRIC.ABSOLUTE_SHORTFALL

/**
 * Does the Owner's question ask for a ranking or an extremum?
 * ⛔ Superlative MORPHOLOGY, not a topic vocabulary. This asks 「is he asking for a first
 * place?」 — it never tries to guess which business thing he means. A keyword list of
 * inventory words is the layer this whole file exists to avoid.
 */
const SUPERLATIVE_RE = /最[高低多少大小長短貴平新舊嚴重緊急急]|最嚴重|最緊急|排名|排序|邊個最|邊樣最|頭幾(個|項|樣)|\btop\s*\d*\b|\b(highest|lowest|most|least|worst|biggest|largest|smallest|rank(ing|ed)?)\b/i

/** ⛔ A PROPORTIONAL question is a DIFFERENT question, and must be recognised as such. */
const PROPORTIONAL_RE = /百分|％|%|比例|佔比|成數|proportion|percentage|percent|ratio/i

function asksForRanking (text) {
  return SUPERLATIVE_RE.test(String(text || ''))
}

/**
 * ⛔ THE STRENGTH OF THE CLAIM DECIDES THE STRENGTH OF THE PROOF.
 *
 * > **Owner: a reply that only states 「Napa Cabbage 最嚴重」 needs first-place proof only and
 * > must NOT be required to enumerate or validate the tail. A reply that presents itself as an
 * > ordered ranking or numbered list must have the ENTIRE presented sequence respect the
 * > proven ranking.**
 *
 * Detected from the ANSWER's own presentation, never from the question: an enumeration
 * (「1. … 2. …」) or an explicit ordering word. Naming several items in a sentence is NOT a
 * ranking — an ordinary factual list must not be forced to become one.
 */
const RANKING_PRESENTATION_RE = /(^|[\n\s])\d+\s*[.、)）：:]|排序|排名|由高到低|由多到少|\brank(ing|ed)\b|\btop\s*\d/i

function presentsAsRanking (text) {
  return RANKING_PRESENTATION_RE.test(String(text || ''))
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED IN PRODUCTION, requestId a3a51702-b136-430d-8994-7a20e890f0f9 on bootCommit
 * ebd6071. The Owner asked 「現在缺貨最嚴重的是什麼？」 and the reply carried a section headed
 *
 *     「目前最缺的四項」   Jars 20 → Napa 75 → New Orleans 39 → Dark Soy 37
 *
 * — a TOP-N claim whose order contradicts the proven absolute-shortfall ranking. It shipped
 * because `RANKING_PRESENTATION_RE` looks for an ordering WORD (排序/排名) or an enumerator,
 * and 「最缺」 is superlative wording with neither.
 *
 * ⛔ A BOOLEAN IS NOT ENOUGH. 「the heading is a ranking」 cannot say how many items were
 * claimed, or which measure. 「目前最缺的四項」 claims exactly four; 「最緊急缺貨項目」 claims a
 * prefix of unstated length; 「最新入貨」 claims an ordering by a date nothing here proves. Those
 * are three different verdicts, so the classifier returns a shape rather than a flag.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const CLAIM_KIND = Object.freeze({
  /** 「目前最缺的四項」 — an explicit N. Membership, count and order are all claimed. */
  TOP_N: 'top_n',
  /** 「最緊急缺貨項目」 — a superlative with no N. The items must be a proven PREFIX. */
  SUPERLATIVE: 'superlative',
  /** 「缺貨排序」 — an ordering word. Legitimate subsequences are allowed, as before. */
  ORDERING: 'ordering'
})

/**
 * ⛔ ONLY SHORTAGE SUPERLATIVES MAP TO THE PROVEN METRIC. Everything else is a claim about a
 * measure nothing in this turn ordered — 「最新」 and 「最近」 are dates, 「最少要補」 is the
 * OPPOSITE end, 「最平」/「最貴」 are prices. Reusing the absolute-shortfall proof for any of
 * them would be the metric-switch defect wearing a heading.
 */
/** Superlatives that name the shortage end outright. 「最缺」/「最嚴重」/「最緊急」. */
const SHORTAGE_WORD_RE = /最(缺|嚴重|緊急)|缺得最|最需要補/
/** Generic 「most」 superlatives — shortage ONLY beside a shortage term, e.g. 「缺口最大」. */
const MOST_WORD_RE = /最(大|多|高)/
const SHORTAGE_TERM_RE = /缺口|缺貨|短缺/
/**
 * ⛔ THE OPPOSITE END IS NOT THE SAME CLAIM. 「最少要補」/「缺口最小」 rank ascending, and the
 * adapter sorts descending — reusing that proof would invert the answer while looking verified.
 */
const LEAST_WORD_RE = /最(少|小|低)/
const ANY_SUPERLATIVE_RE = /最[一-鿿]|\bmost\b|\bworst\b|\btop\b/i

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE COUNT PARSER IS GONE, AND IT IS NOT COMING BACK.
 *
 * Four rounds of reviewer blockers, four characters, one shape — each time a heading was
 * asked HOW MANY and answered with a number nobody wrote:
 *
 *   Blocker  9  「最缺一億二項」 → N=2      the numeral run restarted after an unlisted 億
 *   Blocker 10  「最缺壱十二項」 → N=12     the boundary was still a hand-written list
 *   Blocker 11  「最缺卄項」    → no count  and no count means 「as many as you listed」
 *   Blocker 12  「最缺四項食材」 → no count  because an ordinary NOUN follows the counter
 *
 * Measured on `superlative-section@b8c3719`: the only variant that satisfied Blocker 12
 * re-adopted the character list, and reopened Blockers 10 and 11 inside one test run. Two
 * attempts at a 「complete」 numeral repertoire were both incomplete. Deciding cardinality from
 * prose needs a vocabulary; every vocabulary was incomplete; every incompleteness shipped.
 *
 * > **Owner ruling: cardinality is DECLARED in a closed structure and VERIFIED by the server.
 * > Heading parsing is demoted to a leak-guard.**
 *
 * So this file no longer contains a numeral, a counter word, a particle or a noun pattern.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ⛔ THE LEAK-GUARD. It answers ONE question — 「is this section presenting a ranking?」 — and
 * returns a boolean. It never reads N, a numeral, a noun, a metric or an intent.
 *
 * HIGH RECALL AND FAIL-CLOSED, deliberately in that direction: a heading it wrongly flags is
 * refused for want of a declaration, which the model can supply. A heading it MISSES would
 * ship an unproven ranking, which nothing downstream can repair.
 *
 * ⛔ AND THE ORDINARY HEADINGS MUST STAY ORDINARY. 「缺貨狀況」, 「缺貨項目」 and 「目前庫存」 are
 * factual section titles; a guard that fired on them would refuse the everyday content of the
 * system, which is a defect and not a safety margin.
 */
/**
 * ⛔ THE SELECTION WORDS, AND WHY THEY ARE ANCHORED TO THE START OF THE HEADING.
 *
 * 「頭四項缺貨」 was NOT detected — and the schema itself teaches that wording: its own `top_n`
 * description reads 「指定數量的頭 N 項」. We were telling the model to write a shape the guard
 * could not see, which is the worst possible combination.
 *
 * ⛔ AND THIS IS NOT A NUMERAL TABLE. The guard never asks what 四 means — it only sees that
 * the heading OPENS with a selection word. A numeral list would fail exactly the way it failed
 * four times before: the first unlisted character becomes a false NEGATIVE, and a false
 * negative here ships an unproven ranking.
 *
 * ⛔ ANCHORED, BECAUSE 「目前」 CONTAINS 「前」. An unanchored 前 fires on 「目前庫存」, one of the
 * three ordinary headings this guard must never touch. At index 0 it cannot.
 */
const SELECTION_WORD_RE = /^[頭前第]/

function looksLikeRankingHeading (heading) {
  /**
   * ⛔ TRIMMED, BECAUSE THE SELECTION GUARD IS ANCHORED AND THE HEADING IS NOT CLEAN.
   * SELECTION_WORD_RE matches the FIRST character, so 「 頭四項缺貨」 — one leading space — was
   * not a ranking, fell through to the ordinary path, and shipped unproven. Padding is not an
   * exotic input; it is what a model emits while formatting.
   *
   * ⛔ AND IT IS THE ONLY ANCHORED PATTERN IN THIS FILE. Audited: every other guard here is
   * unanchored, and RANKING_PRESENTATION_RE writes its enumerator branch as (^|[\n\s]), so a
   * padded 「 1. …」 matches through the whitespace alternative rather than the anchor. Pinned in
   * structuredSectionRanking.test.js J2b rather than left as a claim about code.
   */
  const h = String(heading || '').trimStart()
  if (!h) return false
  return ANY_SUPERLATIVE_RE.test(h) || SHORTAGE_WORD_RE.test(h) ||
    RANKING_PRESENTATION_RE.test(h) || SELECTION_WORD_RE.test(h)
}

/** The two orderings that actually exist. A claim naming anything else is refused by name. */
const DECLARABLE_METRICS = Object.freeze([RANKING_METRIC.ABSOLUTE_SHORTFALL, RANKING_METRIC.SUGGESTED_ORDER_QTY])

const NO_CLAIM = Object.freeze({ present: false, valid: false, kind: null, n: null, metric: null })

/**
 * Validate the DECLARED claim as a shape. Nothing here is entitlement — it decides only
 * whether the declaration says one coherent thing, so the gate below knows what to prove.
 *
 * ⛔ PRESENCE AND VALIDITY ARE REPORTED SEPARATELY. 「no declaration」 and 「a declaration that
 * contradicts itself」 are different failures with different repairs, and collapsing them is how
 * a missing field would quietly read as a shape error — or worse, as nothing at all.
 *
 * ⛔ A DECLARATION IS NEVER REPAIRED. `top_n` with no `n` is not read as a superlative, and a
 * superlative carrying an `n` is not stripped of it: either would let the server answer a
 * question the model did not ask, which is the whole class of defect this replaced.
 */
function normaliseRankingClaim (raw) {
  if (raw === null || raw === undefined) return NO_CLAIM
  const bad = { present: true, valid: false, kind: null, n: null, metric: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) return bad
  const kind = raw.kind
  if (kind !== CLAIM_KIND.TOP_N && kind !== CLAIM_KIND.SUPERLATIVE && kind !== CLAIM_KIND.ORDERING) return bad
  const n = (raw.n === undefined) ? null : raw.n
  // ⛔ A POSITIVE INTEGER, checked as one. 「2」, 2.5 and 0 are three different ways of not
  // being a count, and Number() would have turned two of them into one.
  if (kind === CLAIM_KIND.TOP_N) { if (!Number.isInteger(n) || n <= 0) return bad } else if (n !== null) return bad
  const metric = (raw.metric === undefined) ? null : raw.metric
  if (metric !== null && !DECLARABLE_METRICS.includes(metric)) return bad
  return { present: true, valid: true, kind, n: kind === CLAIM_KIND.TOP_N ? n : null, metric }
}

function asksProportionally (text) {
  return PROPORTIONAL_RE.test(String(text || ''))
}

/**
 * The metric the Owner's question is entitled to, by the recorded convention.
 * Proportional only when he says so; otherwise the absolute default, never a question back.
 */
function metricAskedFor (text) {
  return asksProportionally(text) ? RANKING_METRIC.PROPORTIONAL_SHORTFALL : DEFAULT_SHORTAGE_METRIC
}

/**
 * Collect the ranking proofs an evidence set carries. Reads the descriptor; asserts nothing.
 * @returns {Array<{source:string, endpoint:string, metric:string|null, complete:boolean}>}
 */
function proofsFrom (evidenceSets) {
  const list = Array.isArray(evidenceSets) ? evidenceSets : []
  return list
    .filter((e) => e && e.trust === 'live')
    .map((e) => ({
      source: e.source || null,
      endpoint: e.endpoint || null,
      metric: typeof e.rankingMetric === 'string' ? e.rankingMetric : null,
      complete: e.rankingCompleteWithinScope === true
    }))
}

/** Is there a proof for this metric that is complete within its scope? */
function provenFor (proofs, metric) {
  return (Array.isArray(proofs) ? proofs : [])
    .find((p) => p && p.metric === metric && p.complete === true) || null
}

/** Is the metric ordered at all, even if the ordering is not provably complete? */
function orderedFor (proofs, metric) {
  return (Array.isArray(proofs) ? proofs : [])
    .find((p) => p && p.metric === metric) || null
}

const VERDICT = Object.freeze({
  /** No ranking was asked for. This module has no opinion — the commonest case by far. */
  NOT_ASKED: 'not_asked',
  ALLOW: 'allow',
  /** A superlative in prose with no declared claim behind it. */
  NO_DECLARED_CLAIM: 'no_declared_claim',
  /** e.g. a proportional first place over an absolute ordering. */
  METRIC_NOT_PROVEN: 'metric_not_proven',
  /** Ordered, but the server may have cut before the sort — scoped statements only. */
  RANKING_INCOMPLETE: 'ranking_incomplete',
  /** ⛔ The answer's own order disagrees with the ordering it claims to be reporting. */
  ORDER_CONTRADICTS_PROOF: 'order_contradicts_proof'
})

/**
 * ⛔ THE ORDER THE ANSWER ACTUALLY PRESENTS, by first mention of a row we retrieved.
 *
 * Not prose comprehension: each row's own title is looked for as a substring, and rows are
 * ordered by where they first appear. A row the answer never names is not in the order at all.
 * That is enough to catch the observed defect — Jars printed above Napa Cabbage — without this
 * module needing to understand a sentence.
 */
function presentedOrder (text, rows) {
  const s = String(text || '')
  const found = []
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const title = r && typeof r.title === 'string' ? r.title.trim() : ''
    if (!title) continue
    const at = s.indexOf(title)
    if (at >= 0) found.push({ title, at })
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.title)
}

/**
 * ⛔ A SECTION CAN ASSERT AN ORDERING, AND NOTHING USED TO LOOK AT ONE.
 *
 * MEASURED LIVE on `main@befaed0`, 5 fresh conversations: one turn shipped a section headed
 * 「缺貨項目排序」 whose items ran Jars 20 → Napa 70 → New Orleans 39 → Dark Soy 37, against a
 * proven order of Napa → New Orleans → Dark Soy → Jars. The sentence gate had already fired on
 * that turn and emptied `directAnswer` — and the section sailed past it, because
 * `answerPlan.js:1274` handed this module `directAnswer` and nothing else.
 *
 * ⛔ THE HEADING IS THE CLAIM. A section called 「缺貨項目排序」 asserts an order; one called
 * 「缺貨狀況」 or 「現有庫存」 asserts a set. The SAME detector as the prose path decides which,
 * so the two can never drift apart — and a superlative QUESTION does not make an ordinary
 * section into a ranking.
 *
 * ⛔ A CORRECT SUBSEQUENCE IS NOT A VIOLATION. A top-2 or top-3 is a legitimate ranking; only
 * items out of their proven relative order are refused.
 *
 * @returns {number[]} indices of sections whose declared ordering contradicts the proof
 */

/**
 * ⛔ WHY A RANKING SECTION WAS REFUSED. Closed, identifier-only, and every name <= 20 chars —
 * the drop serializer truncates at 20 and two truncated names could collide.
 * ("membership_contradicts_proof" and "order_contradicts_proof" are 28 and 23; shortened here.)
 */
const VIOLATION = Object.freeze({
  NO_RANKING_PROOF: 'no_ranking_proof',
  METRIC_NOT_PROVEN: 'metric_not_proven',
  RANKING_INCOMPLETE: 'ranking_incomplete',
  MEMBERSHIP_MISMATCH: 'membership_mismatch',
  ORDER_MISMATCH: 'order_mismatch',
  /** A section presents a ranking and declared no claim. Nothing to prove, so nothing ships. */
  RANKING_CLAIM_MISSING: 'ranking_claim_missing',
  /** A declaration that contradicts itself — `top_n` with no `n`, a metric nothing sorts by. */
  RANKING_CLAIM_INVALID: 'ranking_claim_invalid',
  /** The declared count is not the number of rows shown, or is more than the proof holds. */
  CARDINALITY_MISMATCH: 'cardinality_mismatch'
})

/** What happened to a section, for the record. Counts and enums only. */
const SECTION_STATUS = Object.freeze({
  NOT_DETECTED: 'not_detected',
  ALLOWED: 'evaluated_allowed',
  REJECTED: 'evaluated_rejected'
})

/** The canonical identity of a retrieved row: readKey#sourceId, as everywhere else here. */
function canonicalOf (row) {
  if (!row) return null
  if (typeof row.canonical === 'string' && row.canonical) return row.canonical
  const key = row.readKey || row.source
  return (key && row.sourceId != null) ? key + '#' + row.sourceId : null
}

/**
 * Resolve a section item to a proven row's identity.
 * ⛔ Canonical ref first. A title resolves ONLY when exactly one proven row carries it —
 * two rows sharing a title must not collapse into one.
 */
function resolveItemId (item, rowIds) {
  if (!item) return null
  /**
   * ⛔ A SERVER-RESOLVED IDENTITY IS AUTHORITATIVE, AND IT HAS NO FALLBACK.
   *
   * `validatePlan` already knew which row each item resolved to — `resolveRowRef()` returned it —
   * and then kept only the model's raw ref and the row's title. So this function had to guess the
   * identity back, and its last resort is a TITLE, which binds to whichever proven row carries
   * that title uniquely:
   *
   *     proof         aroma_system.inventory#1     「Napa Cabbage」  rank #1
   *     another read  aroma_system.daily_count#77  「Napa Cabbage」
   *     the model cites daily_count#77 — a legitimate ref, since the per-turn schema puts every
   *     retrieved row into sourceId.enum — and the title fallback re-read it as inventory#1.
   *
   * A one-item superlative then became a valid first place over a row the proof does not own.
   * Inventory, daily count and replenishment share ingredient names constantly, so this is an
   * ordinary Tuesday, not an exotic collision.
   *
   * When the server resolved the row, that answer is the answer: it is either among the proven
   * ranking rows or the claim fails closed. No downgrade to the raw id, no downgrade to the title.
   */
  const resolved = (typeof item.canonical === 'string' && item.canonical) ? item.canonical : null
  if (resolved) return rowIds.some((r) => r.id === resolved) ? resolved : null
  const ref = item.sourceId != null ? String(item.sourceId) : null
  if (ref && rowIds.some((r) => r.id === ref)) return ref
  // ⛔ PRODUCTION PUSHES THE RAW sourceId, not a canonical ref — validatePlan stores the
  // model's own string. Resolving it WITHIN the single ranked source is what makes this
  // work at runtime; a canonical-only test proved something production never supplies.
  if (ref) {
    const byRaw = rowIds.filter((r) => r.raw === ref)
    if (byRaw.length === 1) return byRaw[0].id
    if (byRaw.length > 1) return null
  }
  if (ref && rowIds.some((r) => r.id === ref)) return ref
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  if (!title) return null
  const hits = rowIds.filter((r) => r.title === title)
  return hits.length === 1 ? hits[0].id : null
}

function rankingSectionViolations (input = {}) {
  const i = input || {}
  const rows = Array.isArray(i.rankedRows) ? i.rankedRows : []
  const proven = rows
    .filter((r) => r && typeof r.title === 'string' && r.title.trim())
    .map((r) => r.title.trim())

  /**
   * ⛔ ENTITLEMENT COMES FROM **ONE** PROOF — THE ONE THAT OWNS THESE ROWS.
   *
   * Two earlier cuts of this function were wrong in the same direction, and both were caught
   * by the Owner on review rather than by a test:
   *
   *   1. It judged only whether the sequence was RIGHT, never whether the ranking was entitled
   *      to be claimed. `orderPlanning` is cut at LIMIT 100 by the server BEFORE the client
   *      sorts, so a section headed 「訂貨建議排名」 whose items happened to fall in correct
   *      relative order would have shipped.
   *   2. Entitlement was then made TURN-WIDE — `proofs.some(complete)` — so one source's
   *      complete proof could entitle a different source's ranking.
   *
   * ⛔ AND THE ESCAPE THAT MATTERED MOST. With two ranked sources the caller could not say
   * which ordering a section reported, so it passed no rows — and this function's own
   * `proven.length === 0` early return then reported NO violations. A ranking section did not
   * fail closed; it skipped validation altogether and shipped. That is the opposite of what I
   * claimed when I closed the previous round.
   *
   * > **Owner ruling: a ranking section may rely only on the same single ranking proof that
   * > owns the ranked rows. One source's complete proof must never entitle another's ranking.**
   *
   * A section carries no structural source attribution, so with more than one ranked source
   * there is no honest way to tell which ordering it claims — and the safe direction for an
   * unattributable claim is to refuse it.
   */
  const rankedSourceCount = Number.isFinite(i.rankedSourceCount) ? i.rankedSourceCount : 0
  const evidence = (i.rankingEvidence && typeof i.rankingEvidence === 'object') ? i.rankingEvidence : null
  const entitled = rankedSourceCount === 1 && !!evidence && evidence.rankingCompleteWithinScope === true

  /**
   * ⛔ ZERO RANKED SOURCES IS NOT THIS GATE'S BUSINESS. Firing here would turn a proof checker
   * into a generic ranking detector, refusing headings on turns that read nothing orderable.
   */
  // ⛔ THE ZERO-SOURCE EARLY EXIT IS THE BYPASS, so it no longer runs ahead of detection.
  // A superlative section could ship today with NO ranking proof at all simply because the
  // turn read nothing orderable. Detection now happens per section, below, and a recognised
  // claim fails closed from that moment. Turns with no ranking claim are untouched.

  const out = []
  const rowIds = rows.map((r) => ({ id: canonicalOf(r), raw: (r && r.sourceId != null) ? String(r.sourceId) : null, title: (r && typeof r.title === "string") ? r.title.trim() : "" })).filter((x) => x.id)
  const provenIds = rowIds.map((x) => x.id)
  // ⛔ Observability only: enum + count, never a heading, title, value or message.
  const note = typeof i.onVerdict === "function" ? i.onVerdict : null
  const say = (status, reason) => { if (note) { try { note({ status, reason: reason || null, rankedSourceCount }) } catch (_) {} } }
  const reject = (n, reason) => { out.push(n); say(SECTION_STATUS.REJECTED, reason) }
  const allow = () => say(SECTION_STATUS.ALLOWED, null)
  const list = Array.isArray(i.sections) ? i.sections : []
  list.forEach((sec, idx) => {
    /**
     * ⛔ GATE ORDER IS PINNED, AND IT STARTS AT THE DECLARATION.
     * claim present → shape valid → ranked source count → operation ownership → metric →
     * completeness → cardinality → membership → order → ALLOW. Every fixture in
     * structuredSectionRanking.test.js H27 fails several of these at once, so the ORDER is
     * what decides the reason — and a reason that depends on evaluation order is not a reason.
     */
    const declared = normaliseRankingClaim(sec ? sec.rankingClaim : null)
    if (!declared.present) {
      /**
       * ⛔ NO DECLARATION IS NOT AUTOMATICALLY INNOCENT. A section that PRESENTS a ranking
       * and declares none is the exact escape this contract exists to close: under the old
       * rule it needed only a heading the parser could not read.
       */
      /**
       * ⛔ THE GUARD RUNS ON THE HEADING THE MODEL SENT, WHICH IS NOT THE ONE HERE.
       * `validatePlan` blanks a ranking heading before the validated plan is built, so by
       * this point there is deliberately nothing left to read. It evaluates the guard first
       * and passes the ANSWER — a boolean, no content — so the two facts stay together
       * without the heading itself ever travelling. A caller that supplies neither gets the
       * heading read directly, which is what the direct-call tests exercise.
       */
      const presents = (sec && typeof sec.looksLikeRanking === 'boolean')
        ? sec.looksLikeRanking
        : looksLikeRankingHeading(sec ? sec.heading : '')
      if (presents) { reject(idx, VIOLATION.RANKING_CLAIM_MISSING); return }
      say(SECTION_STATUS.NOT_DETECTED, null)
      return // an ordinary set heading, undeclared and not presenting as a ranking
    }
    if (!declared.valid) { reject(idx, VIOLATION.RANKING_CLAIM_INVALID); return }

    if (rankedSourceCount === 0) { reject(idx, VIOLATION.NO_RANKING_PROOF); return }

    /**
     * ⛔ AMBIGUOUS ATTRIBUTION IS DECIDED BEFORE THE ROWS ARE EVEN LOOKED AT.
     * With two ranked sources the caller cannot say which ordering this section reports, so
     * there are no rows to compare against — and checking rows first is exactly how the
     * section escaped validation instead of failing closed.
     */
    if (rankedSourceCount > 1) { reject(idx, VIOLATION.NO_RANKING_PROOF); return } // ambiguous attribution

    /**
     * ⛔ THE PROOF MUST BE THE ORDERING THE CLAIM NAMES. `inventory` proves absolute_shortfall
     * and `orderPlanning` proves suggested_order_qty; both are real, so a shortage claim could
     * otherwise be validated against a suggested-order ordering whenever the two agreed.
     * A claim declaring `metric: null` asserts no measure and is exempt — that is `ordering`.
     */
    if (declared.metric !== null && (!evidence || declared.metric !== evidence.rankingMetric)) { reject(idx, VIOLATION.METRIC_NOT_PROVEN); return }

    // ⛔ NOT ENTITLED — refused whatever the order says. A correct sequence over an
    // unprovable ordering is a coincidence, not a proof.
    if (!entitled) { reject(idx, VIOLATION.RANKING_INCOMPLETE); return }

    /**
     * ⛔ THE CLAIM IS JUDGED AS DECLARED, NOT AS IT SURVIVED VALIDATION.
     *
     * `validatePlan` resolves items first and drops any whose `sourceId` names no retrieved
     * row. So the gate used to receive a section ALREADY PRUNED — and pruning turns a claim
     * into a smaller one that passes:
     *
     *     proven A B C D · declared `ordering`, items A and a foreign Z
     *     Z is dropped before the gate → one item → a single item cannot be out of order → ALLOW
     *     declared `superlative` → prefix of length 1 → A is the proven first → ALLOW
     *
     * Both are the v1.2 ruling broken twice over: a member the proof does not own must fail
     * closed, and a declaration must never be silently narrowed into a different claim.
     *
     * ⛔ CHECKED BEFORE CARDINALITY, DELIBERATELY. Once an item has been pruned, `claimedIds`
     * is no longer what the model declared, so counting it would be measuring a claim nobody
     * made. The failure is a MEMBERSHIP one — a row that is not in the proof — and it is
     * reported as one.
     *
     * Ordinary non-ranking sections are untouched: they never reach this line, and their
     * per-item drop behaviour is exactly what it was.
     */
    const lostBeforeGate = Number.isFinite(sec.itemsDroppedBeforeGate) ? sec.itemsDroppedBeforeGate : 0
    if (lostBeforeGate > 0) { reject(idx, VIOLATION.MEMBERSHIP_MISMATCH); return }

    /**
     * ⛔ CANONICAL IDENTITY, NOT TITLE STRINGS. Two retrieved rows may share a title, and
     * comparing display strings would collapse them into one — the same defect closed for the
     * derived-prose path. A title is used only as a fallback, and only when it is UNIQUE among
     * the proven rows; an ambiguous or unresolvable item fails the claim closed.
     */
    const claimedIds = (Array.isArray(sec.items) ? sec.items : []).map((it) => resolveItemId(it, rowIds))

    if (declared.kind !== CLAIM_KIND.ORDERING) {
      /**
       * ⛔ A TOP-N OR SUPERLATIVE HEADING CLAIMS MEMBERSHIP, NOT MERELY ORDER.
       *
       * 「目前最缺的四項」 asserts these are THE four worst, in order. A subsequence is a correct
       * answer to 「排序」 and a FALSE answer to 「最缺的四項」 — `A B C E` is not the top four
       * when `D` outranks `E`, however neatly it is sorted.
       */
      if (claimedIds.length === 0 || claimedIds.some((x) => x === null)) { reject(idx, VIOLATION.MEMBERSHIP_MISMATCH); return }
      /**
       * ⛔ CARDINALITY IS ITS OWN VERDICT, and it is checked BEFORE membership.
       *
       * Under the parser this was deliberately folded into set-equality, because a heading-read
       * count could not be trusted enough to report on its own. A DECLARED count can: 「you said
       * four and showed three」 is a different repair from 「you showed the wrong three」, and the
       * Owner reads the reason, not the code.
       */
      const n = declared.kind === CLAIM_KIND.TOP_N ? declared.n : claimedIds.length
      if (declared.kind === CLAIM_KIND.TOP_N && claimedIds.length !== n) { reject(idx, VIOLATION.CARDINALITY_MISMATCH); return }
      if (n > provenIds.length) { reject(idx, VIOLATION.CARDINALITY_MISMATCH); return }
      const head = provenIds.slice(0, n)
      // ⛔ Membership first, then order — they fail for different reasons and a repair needs to
      // know which. Same set in the wrong order is an ORDER failure, not a membership one.
      const sameSet = head.length === claimedIds.length && head.every((id) => claimedIds.includes(id))
      if (!sameSet) { reject(idx, VIOLATION.MEMBERSHIP_MISMATCH); return }
      if (claimedIds.some((id, k) => id !== head[k])) { reject(idx, VIOLATION.ORDER_MISMATCH); return }
      allow(idx)
      return
    }

    /**
     * ── ORDERING keeps legitimate subsequences, on the SAME identity ────────────
     * ⛔ It used to match on TITLES and ALLOW when none matched — so a section headed
     * 「採購單排序」 listing only purchase orders matched zero proven titles and shipped on the
     * inventory proof. One source's proof entitling another source's ranking, already ruled
     * out for the other kinds.
     */
    if (claimedIds.length === 0) { allow(idx); return } // an empty section asserts nothing
    if (claimedIds.some((x) => x === null)) { reject(idx, VIOLATION.MEMBERSHIP_MISMATCH); return }

    // ⛔ ONE ITEM CANNOT BE OUT OF ORDER. Refusing a single-row section would refuse the
    // clearest honest answer there is — 「排序：第一位 Napa」.
    if (claimedIds.length < 2) { allow(idx); return }
    const expected = provenIds.filter((id) => claimedIds.includes(id))
    if (claimedIds.length !== expected.length || claimedIds.some((id, n) => id !== expected[n])) reject(idx, VIOLATION.ORDER_MISMATCH)
    else allow(idx)
  })
  return out
}

/**
 * Verify a superlative before it ships.
 *
 * @param {object} input
 * @param {string} input.message        the Owner's question
 * @param {string} input.directAnswer   the answer as the model wrote it
 * @param {object[]} input.evidenceSets descriptors for this turn
 * @param {object[]} input.rankedRows   retrieved rows IN THE PROVEN ORDER (already sorted)
 * @param {object[]} input.claims       declared answerClaims, or null/absent
 * @returns {{verdict:string, metric:string|null, ok:boolean}}
 */
function verifyRanking (input = {}) {
  const i = input || {}
  const message = String(i.message || '')
  const out = (verdict, metric) => ({ verdict, metric: metric || null, ok: verdict === VERDICT.ALLOW || verdict === VERDICT.NOT_ASKED })

  if (!asksForRanking(message)) return out(VERDICT.NOT_ASKED, null)

  const metric = metricAskedFor(message)
  const proofs = proofsFrom(i.evidenceSets)

  /**
   * ⛔ NOTHING ORDERED AT ALL MEANS THIS GATE HAS NO SUBJECT.
   * A superlative over a source that carries no ranking (suppliers, invoices) is not this
   * contract's business — the grounding rules already govern it, and firing here would refuse
   * ordinary turns on a question that merely contained 「最」.
   */
  if (!orderedFor(proofs, RANKING_METRIC.ABSOLUTE_SHORTFALL) && !orderedFor(proofs, RANKING_METRIC.SUGGESTED_ORDER_QTY)) {
    return out(VERDICT.NOT_ASKED, metric)
  }

  // ⛔ PROSE ALONE MAY NOT ASSERT A FIRST PLACE. An absent declaration is UNBOUND, and this
  // is the point at which UNBOUND stops being metadata and starts meaning 「no」.
  const claims = Array.isArray(i.claims) ? i.claims : []
  const ranking = claims.find((c) => c && (c.claimKind === 'extremum' || c.claimKind === 'ranking'))
  if (!ranking) return out(VERDICT.NO_DECLARED_CLAIM, metric)

  /**
   * ⛔ THE DECLARED METRIC MUST BE THE ONE ACTUALLY SORTED ON, AND MUST NOT SWITCH SIDES.
   *
   * The check is on the PROPORTIONAL/ABSOLUTE axis rather than on one hard-coded default,
   * because the same turn can legitimately rank by shortfall (inventory) or by suggested
   * order quantity (order planning) — those are two subjects, not a wrong answer. What may
   * never happen is the silent swap in either direction: a percentage question answered from
   * an absolute ordering, or a plain question quietly answered as a percentage.
   */
  const declaredMetric = typeof ranking.metric === 'string' ? ranking.metric : null
  const declaredIsProportional = declaredMetric === RANKING_METRIC.PROPORTIONAL_SHORTFALL
  if (declaredIsProportional !== asksProportionally(message)) return out(VERDICT.METRIC_NOT_PROVEN, metric)
  // And it must be an ordering that exists. Nothing sorts proportionally, so a proportional
  // claim is refused here every time — by absence of evidence, not by a special case.
  if (!orderedFor(proofs, declaredMetric)) return out(VERDICT.METRIC_NOT_PROVEN, metric)

  // Ordered, but a server cut may precede the sort — a scoped statement is allowed, an
  // unqualified global first is not.
  if (!provenFor(proofs, declaredMetric)) return out(VERDICT.RANKING_INCOMPLETE, metric)

  /**
   * ⛔ THE ACCEPTANCE CASE. The answer may not contradict the ordering it reports.
   * `rankedRows` arrive already sorted, so the proven first place is simply the first row.
   */
  const rows = Array.isArray(i.rankedRows) ? i.rankedRows : []
  const order = presentedOrder(i.directAnswer, rows)
  if (order.length > 0) {
    const provenTitles = rows
      .filter((r) => r && typeof r.title === 'string' && r.title.trim())
      .map((r) => r.title.trim())

    if (presentsAsRanking(i.directAnswer)) {
      /**
       * ⛔ AN ENUMERATED LIST ASSERTS EVERY POSITION IN IT, so every position is checked.
       * The proven order is restricted to the items actually named — a ranking may legitimately
       * show the top three — and the presented sequence must equal it. Skipping an item is
       * fine; putting one out of order is not.
       */
      const expected = provenTitles.filter((t) => order.includes(t))
      if (order.length !== expected.length || order.some((t, n) => t !== expected[n])) {
        return out(VERDICT.ORDER_CONTRADICTS_PROOF, metric)
      }
    } else if (provenTitles.length > 0 && order[0] !== provenTitles[0]) {
      // ⛔ A BARE SUPERLATIVE CLAIMS ONE THING: first place. The tail is not asserted, so it
      // is not validated — requiring otherwise would refuse honest answers for mentioning a
      // second item.
      return out(VERDICT.ORDER_CONTRADICTS_PROOF, metric)
    }
  }

  return out(VERDICT.ALLOW, metric)
}

module.exports = {
  RANKING_METRIC,
  DEFAULT_SHORTAGE_METRIC,
  VERDICT,
  asksForRanking,
  presentsAsRanking,
  VIOLATION,
  SECTION_STATUS,
  looksLikeRankingHeading,
  normaliseRankingClaim,
  // ⛔ EXPORTED SO THERE IS ONE FORMAT, NOT TWO. `validatePlan` stamps the resolved identity onto
  // each validated item and this file compares it; two implementations of readKey#sourceId would
  // agree today and drift the first time either side changed.
  canonicalOf,
  CLAIM_KIND,
  asksProportionally,
  metricAskedFor,
  proofsFrom,
  provenFor,
  presentedOrder,
  rankingSectionViolations,
  verifyRanking
}
