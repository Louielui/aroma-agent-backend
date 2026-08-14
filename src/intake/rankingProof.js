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
const CJK_DIGITS = Object.freeze({ 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 })
/**
 * ⛔ THE WHOLE NUMERAL RUN, NEVER A SUFFIX OF IT.
 *
 * A single-character match took the TRAILING digit: 「最缺十一項」 matched 「一項」 and became
 * N=1, 「最缺十二項」 became N=2. That is not 「11 and 12 unsupported」 — it silently converts one
 * count claim into a different, smaller one, so a top-12 section showing 2 items would have
 * passed as a correct top-2. The run is now captured whole and parsed exactly; anything that
 * does not parse is still a CLAIM and fails closed rather than becoming a number nobody wrote.
 */
/**
 * ⛔ THE RUN INCLUDES CHARACTERS THIS PARSER CANNOT READ, ON PURPOSE.
 * Without 百/千/萬/零 in the class, matching could RESTART after them: 「最缺一百二項」 matched
 * the trailing 「二項」 and became N=2. Capturing the whole run means such a heading reaches
 * the parser, fails to parse, and is refused as `count_unparsed` — never silently demoted to
 * a smaller, satisfiable count.
 */
/**
 * ⛔ THE COMPLETE CJK NUMERAL REPERTOIRE, AND A LOOKBEHIND THAT FORBIDS STARTING MID-TOKEN.
 *
 * Adding 百/千/萬 closed 「一百二項」, but a fixed list brings the same bug back with the next
 * character outside it: 「最缺一億二項」 failed at 一 and RESTARTED at 二項 -> N=2, and 「廿二項」
 * did the same. Appending one character per bug found is not a rule, it is a queue.
 *
 * So the class is the whole standard repertoire — digits, tens/hundreds/thousands, the
 * financial forms, and 廿/卅 — and the lookbehind means a run may not BEGIN immediately after
 * another numeral character. The invariant is not 「support every numeral」: it is that not
 * knowing the count may fail closed, but one count must never silently become a smaller one.
 *
 * Only 1-99 built from 一-九 and 十 is PARSED; everything else in the class is captured so it
 * reaches the parser, fails, and is refused as `count_unparsed`.
 */
/**
 * ⛔ THE COUNT IS NOT SEARCHED FOR. IT IS THE WHOLE SPAN, OR IT IS NOTHING.
 *
 * Every previous attempt matched a numeral RUN and so could always restart after a character
 * the run did not recognise: 「一百二項」 -> 2, then 「一億二項」 -> 2, then 「一万二項」 -> 2 and
 * 「卄二項」 -> 2 and 「壱十二項」 -> 12. Widening the character class each time is a queue, not a
 * rule, and the next unlisted numeral reopens it.
 *
 * ⛔ AND A PURE 「no restart after any ideograph」 BOUNDARY CANNOT WORK HERE: in 「最缺四項」 the
 * 四 is preceded by 缺, an ideograph, so that rule would refuse every real heading — including
 * the production one this whole task began with. Verified before choosing.
 *
 * So there is no search and no boundary. The claim phrase is already known (最缺 / 排序 / …),
 * and the counter word is already known (項/個/樣/款/種). Everything BETWEEN them is the count,
 * taken whole. It parses completely or the claim is refused as `count_unparsed`. A character
 * nobody has ever heard of cannot cause a restart, because nothing ever restarts.
 *
 * The only vocabulary left is 「does this span even attempt to be a number?」, decided by the
 * basic digits — and getting that wrong can only UNDER-read a count, which downgrades a TOP-N
 * claim to the stricter prefix rule. It can never over-read one.
 */
const COUNTER_RE = /[項個樣款種]/
/**
 * ⛔ PARTICLES, NOT NUMERALS — and the direction of a mistake here is safe.
 * 「最缺嗰項」 is 「that one」, not a count; 嗰/呢 are demonstratives in the same class as 的/嘅.
 * Missing a particle only makes a heading read as an unreadable COUNT and fail closed; the
 * dangerous direction would be listing something that IS a numeral, and none of these are.
 */
const COUNT_PARTICLES_RE = /[的嘅之係個嗰呢啲\s]/g
/**
 * ⛔ A COUNTER WORD IS ONLY A COUNT SITE WHERE A COUNT COULD ACTUALLY BE WRITTEN.
 *
 * 「最緊急缺貨項目」 contains 項 inside the WORD 項目 and claims no quantity; 「最缺四項」 ends
 * on its counter; 「目前最缺的四項排序」 has its counter followed by another claim marker. That
 * is a structural distinction and needs no numeral list — which matters, because deciding
 * presence by a list of numerals is exactly what let 卄 and 壱 read as 「no count at all」.
 */
const COUNT_SITE_SUFFIX_RE = /^(排序|排名|由高到低|由多到少)/
const IDEOGRAPH_RE = /^[\u4e00-\u9fff]/
const LATIN_TOP_N_RE = /\btop\s*(\d+)\b/i

/** The end of the claim phrase — the point after which a count may legitimately appear. */
function claimPhraseEnd (h) {
  let bestIndex = Infinity
  let end = 0
  for (const re of [SHORTAGE_WORD_RE, MOST_WORD_RE, LEAST_WORD_RE, ANY_SUPERLATIVE_RE, RANKING_PRESENTATION_RE]) {
    const m = h.match(re)
    if (!m || m.index == null) continue
    /**
     * ⛔ THE EARLIEST MARKER, NOT THE LATEST. Taking the rightmost moved the anchor PAST
     * 排序 in 「目前最缺的四項排序」, so the 四項 between the two markers was skipped entirely and
     * a four-item claim became a no-N superlative. Ties resolve to the longest match at that
     * position, so 「最緊急」 is not cut short to 「最緊」.
     */
    if (m.index < bestIndex) { bestIndex = m.index; end = m.index + m[0].length } else if (m.index === bestIndex) { end = Math.max(end, m.index + m[0].length) }
  }
  return end
}

/**
 * @returns {{n:number|null, unparsed:boolean}} `unparsed` means a count was attempted and could
 *   not be read exactly — a CLAIM that must fail closed, never a smaller count.
 */
function countClaimIn (h) {
  const rest = h.slice(claimPhraseEnd(h))
  let hit = null
  for (let i = 0; i < rest.length; i++) {
    if (!COUNTER_RE.test(rest[i])) continue
    const after = rest.slice(i + 1)
    if (after === "" || !IDEOGRAPH_RE.test(after) || COUNT_SITE_SUFFIX_RE.test(after)) { hit = { index: i }; break }
  }
  if (!hit) {
    const latin = h.match(LATIN_TOP_N_RE)
    const v = latin ? Number(latin[1]) : null
    return { n: (Number.isFinite(v) && v > 0) ? v : null, unparsed: false }
  }
  const span = rest.slice(0, hit.index).replace(COUNT_PARTICLES_RE, '')
  /**
   * ⛔ 「I COULD NOT READ N」 MUST NEVER BE REWRITTEN AS 「THERE WAS NO N」.
   *
   * Commit F decided presence with a digit list, so 「最缺卄項」 and 「最缺壱項」 yielded no count
   * — and the bare-superlative branch then takes n = however many items the section listed.
   * A heading asserting twenty could pass showing one. Stricter on order, LOOSER on
   * cardinality, which is the part an explicit-N claim exists to pin.
   *
   * So at a count site ANY non-empty span is a count: it parses exactly, or it fails closed.
   * Only an empty span — a genuine absence — may take the prefix superlative path.
   */
  // 「最緊急缺貨項目」 is a superlative with no count, not a broken one.
  if (!span) return { n: null, unparsed: false }
  if (/^[0-9０-９]+$/.test(span)) {
    const v = Number(span.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xFF10)))
    return (Number.isFinite(v) && v > 0) ? { n: v, unparsed: false } : { n: null, unparsed: true }
  }
  const v = parseCjkNumeral(span)
  return v === null ? { n: null, unparsed: true } : { n: v, unparsed: false }
}

// ⛔ CJK_NUMERAL_CHARS, CJK_COUNT_IN_HEADING and ARABIC_COUNT_IN_HEADING are GONE. Each was a
// character list that a numeral outside it could walk around; `countClaimIn` above needs none.

/** Exact 十-based parse for 1–99. Returns null on anything it cannot read precisely. */
function parseCjkNumeral (run) {
  const s = String(run || '')
  if (!s) return null
  // ⛔ PARSE ONLY WHAT IS EXACTLY READABLE. Any character outside 一-九 and 十 — including
  // every one captured purely so the run cannot restart after it — is refused here.
  if (/[^一二兩三四五六七八九十]/.test(s)) return null
  if (!s.includes('十')) return s.length === 1 ? (CJK_DIGITS[s] || null) : null
  const [head, tail, ...rest] = s.split('十')
  if (rest.length > 0) return null // 十…十… is not a number this parser reads
  const tens = head === '' ? 1 : (CJK_DIGITS[head] || null)
  if (tens === null) return null
  if (tail === '') return tens * 10
  if (tail.length !== 1) return null
  const ones = CJK_DIGITS[tail]
  return ones ? tens * 10 + ones : null
}

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

  /**
   * ⛔ A SUPERLATIVE ASSERTS A MEASURE; A BARE ORDERING DOES NOT.
   *
   * 「最缺」 says WHICH ordering it means, so the proof must be that ordering — and a proof of
   * `suggested_order_qty` is a real proof of the WRONG thing. 「缺貨排序」 asserts only that the
   * rows are in order, so it may use whichever single proof is bound to its own rows.
   * `assertsMetric` is what keeps those two apart; `metric: null` alone could not.
   */
  const assertsMetric = superlative
  const metric = shortage ? RANKING_METRIC.ABSOLUTE_SHORTFALL : null

  const count = countClaimIn(h)
  const n = count.n
  const countUnparsed = count.unparsed

  if (superlative && (n !== null || countUnparsed)) return { claim: true, kind: CLAIM_KIND.TOP_N, n, metric, assertsMetric, countUnparsed }
  if (superlative) return { claim: true, kind: CLAIM_KIND.SUPERLATIVE, n: null, metric, assertsMetric, countUnparsed: false }
  return { claim: true, kind: CLAIM_KIND.ORDERING, n, metric, assertsMetric, countUnparsed }
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
  /** A count was written in the heading and could not be parsed exactly. */
  COUNT_UNPARSED: 'count_unparsed'
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
    const claim = sec ? classifySectionHeading(sec.heading) : { claim: false }
    if (!claim.claim) { say(SECTION_STATUS.NOT_DETECTED, null); return } // an ordinary set heading

    // ⛔ GATE ORDER IS PINNED. From the moment a heading is RECOGNISED as a ranking claim
    // this section fails closed, and only then are the reasons considered. Checking any
    // precondition before recognition is how the zero-source exit became a bypass.
    if (rankedSourceCount === 0) { reject(idx, VIOLATION.NO_RANKING_PROOF); return }
    // ⛔ ONLY A CLAIM THAT NAMES A MEASURE CAN NAME AN UNPROVEN ONE. A bare 「排序」 asserts no
    // measure, so `metric: null` there means 「none claimed」, not 「claimed something unprovable」.
    if (claim.assertsMetric && claim.metric === null) { reject(idx, VIOLATION.METRIC_NOT_PROVEN); return }

    /**
     * ⛔ AMBIGUOUS ATTRIBUTION IS DECIDED BEFORE THE ROWS ARE EVEN LOOKED AT.
     * With two ranked sources the caller cannot say which ordering this section reports, so
     * there are no rows to compare against — and checking rows first is exactly how the
     * section escaped validation instead of failing closed.
     */
    if (rankedSourceCount > 1) { reject(idx, VIOLATION.NO_RANKING_PROOF); return } // ambiguous attribution

    /**
     * ⛔ THE PROOF MUST BE THE ORDERING THE CLAIM NAMES. Entitlement checked only that ONE
     * complete proof existed — never that it was the right measure. `inventory` proves
     * absolute_shortfall and `orderPlanning` proves suggested_order_qty; both are real, so a
     * shortage superlative could be validated against a suggested-order ordering whenever the
     * two happened to agree. A bare 「排序」 asserts no measure and is exempt.
     */
    if (claim.assertsMetric && evidence && claim.metric !== evidence.rankingMetric) { reject(idx, VIOLATION.METRIC_NOT_PROVEN); return }

    // ⛔ Blocker 4: a count that could not be read exactly must not become a different count.
    if (claim.countUnparsed) { reject(idx, VIOLATION.COUNT_UNPARSED); return }

    // ⛔ NOT ENTITLED — refused whatever the order says. A correct sequence over an
    // unprovable ordering is a coincidence, not a proof.
    if (!entitled) { reject(idx, VIOLATION.RANKING_INCOMPLETE); return }

    /**
     * ⛔ CANONICAL IDENTITY, NOT TITLE STRINGS. Two retrieved rows may share a title, and
     * comparing display strings would collapse them into one — the same defect closed for the
     * derived-prose path. A title is used only as a fallback, and only when it is UNIQUE among
     * the proven rows; an ambiguous or unresolvable item fails the claim closed.
     */
    const claimedIds = (Array.isArray(sec.items) ? sec.items : []).map((it) => resolveItemId(it, rowIds))

    if (claim.kind !== CLAIM_KIND.ORDERING) {
      /**
       * ⛔ A TOP-N OR SUPERLATIVE HEADING CLAIMS MEMBERSHIP, NOT MERELY ORDER.
       *
       * 「目前最缺的四項」 asserts these are THE four worst, in order. A subsequence is a correct
       * answer to 「排序」 and a FALSE answer to 「最缺的四項」 — `A B C E` is not the top four
       * when `D` outranks `E`, however neatly it is sorted.
       */
      if (claimedIds.length === 0 || claimedIds.some((x) => x === null)) { reject(idx, VIOLATION.MEMBERSHIP_MISMATCH); return }
      /**
       * An explicit N claims exactly N; a bare superlative claims a prefix of its own length.
       *
       * ⛔ THERE IS NO SEPARATE COUNT CHECK, AND THAT IS DELIBERATE. One was written here and
       * a mutation removing it stayed GREEN — the set-equality test below already compares
       * `head.length` with `claimedIds.length`, so a count mismatch cannot survive it. Rather
       * than keep a line no test could kill, it was removed: three items under 「四項」 fail as
       * a membership mismatch, which is what they are.
       */
      const n = claim.kind === CLAIM_KIND.TOP_N ? claim.n : claimedIds.length
      if (n > provenIds.length) { reject(idx, VIOLATION.MEMBERSHIP_MISMATCH); return }
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
