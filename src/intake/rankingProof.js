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
    const provenFirst = rows.find((r) => r && typeof r.title === 'string' && r.title.trim())
    const provenTitle = provenFirst ? provenFirst.title.trim() : null
    if (provenTitle && order[0] !== provenTitle) return out(VERDICT.ORDER_CONTRADICTS_PROOF, metric)
  }

  return out(VERDICT.ALLOW, metric)
}

module.exports = {
  RANKING_METRIC,
  DEFAULT_SHORTAGE_METRIC,
  VERDICT,
  asksForRanking,
  asksProportionally,
  metricAskedFor,
  proofsFrom,
  provenFor,
  presentedOrder,
  verifyRanking
}
