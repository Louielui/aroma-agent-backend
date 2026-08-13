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

/** CJK numerals used as counts in headings. Deliberately small — 一 to 十 covers real headings. */
const CJK_DIGITS = Object.freeze({ 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 })
const CJK_COUNT_IN_HEADING = /([一二兩三四五六七八九十])\s*(項|個|樣|款|種)/
const ARABIC_COUNT_IN_HEADING = /(\d+)\s*(項|個|樣|款|種)|\btop\s*(\d+)/i

/**
 * Classify a section heading as a ranking CLAIM.
 * @returns {{claim:boolean, kind:string|null, n:number|null, metric:string|null}}
 *   `metric` is null when the heading claims an ordering this turn cannot prove.
 */
function classifySectionHeading (heading) {
  const h = String(heading || '')
  const none = { claim: false, kind: null, n: null, metric: null }
  if (!h) return none

  // ⛔ 「缺口最大」 was MISSED by a shortage-word list and would have been refused as an
  // unproven measure — found by running the existing suite, not by reading. A generic 「most」
  // counts as the shortage metric only beside a shortage term, and the least-end words never do.
  const shortage = !LEAST_WORD_RE.test(h) &&
    (SHORTAGE_WORD_RE.test(h) || (MOST_WORD_RE.test(h) && SHORTAGE_TERM_RE.test(h)))
  const superlative = shortage || ANY_SUPERLATIVE_RE.test(h)
  const ordering = presentsAsRanking(h)
  if (!superlative && !ordering) return none

  // ⛔ A shortage superlative claims the metric the adapter actually sorts on; any other
  // superlative claims something unproven, and `metric: null` makes the gate refuse it.
  const metric = shortage ? RANKING_METRIC.ABSOLUTE_SHORTFALL : (ordering && !superlative ? RANKING_METRIC.ABSOLUTE_SHORTFALL : null)

  let n = null
  const cjk = h.match(CJK_COUNT_IN_HEADING)
  if (cjk) n = CJK_DIGITS[cjk[1]] || null
  if (n === null) {
    const ar = h.match(ARABIC_COUNT_IN_HEADING)
    if (ar) n = Number(ar[1] || ar[3]) || null
  }

  if (superlative && n !== null) return { claim: true, kind: CLAIM_KIND.TOP_N, n, metric }
  if (superlative) return { claim: true, kind: CLAIM_KIND.SUPERLATIVE, n: null, metric }
  return { claim: true, kind: CLAIM_KIND.ORDERING, n, metric }
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
  const list = Array.isArray(i.sections) ? i.sections : []
  list.forEach((sec, idx) => {
    const claim = sec ? classifySectionHeading(sec.heading) : { claim: false }
    if (!claim.claim) return // an ordinary set heading — not this gate's business

    // ⛔ GATE ORDER IS PINNED. From the moment a heading is RECOGNISED as a ranking claim
    // this section fails closed, and only then are the reasons considered. Checking any
    // precondition before recognition is how the zero-source exit became a bypass.
    if (rankedSourceCount === 0) { out.push(idx); return } // claimed a ranking, proved none
    if (claim.metric === null) { out.push(idx); return } // an ordering nothing here proves

    /**
     * ⛔ AMBIGUOUS ATTRIBUTION IS DECIDED BEFORE THE ROWS ARE EVEN LOOKED AT.
     * With two ranked sources the caller cannot say which ordering this section reports, so
     * there are no rows to compare against — and checking rows first is exactly how the
     * section escaped validation instead of failing closed.
     */
    if (rankedSourceCount > 1) { out.push(idx); return } // ambiguous attribution

    const titles = (Array.isArray(sec.items) ? sec.items : [])
      .map((it) => (it && typeof it.title === 'string') ? it.title.trim() : '')
      .filter((t) => t && proven.includes(t))
    if (titles.length === 0) return

    // ⛔ NOT ENTITLED — refused whatever the order says. A correct sequence over an
    // unprovable ordering is a coincidence, not a proof.
    if (!entitled) { out.push(idx); return }

    // ⛔ ONE ITEM CANNOT BE OUT OF ORDER. Refusing a single-row section would refuse the
    // clearest honest answer there is — 「排序：第一位 Napa」.
    if (titles.length < 2) return
    const expected = proven.filter((t) => titles.includes(t))
    if (titles.length !== expected.length || titles.some((t, n) => t !== expected[n])) out.push(idx)
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
  classifySectionHeading,
  CLAIM_KIND,
  asksProportionally,
  metricAskedFor,
  proofsFrom,
  provenFor,
  presentedOrder,
  rankingSectionViolations,
  verifyRanking
}
