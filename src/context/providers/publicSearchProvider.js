'use strict'

/**
 * publicSearchProvider.js — the PROVIDER-NEUTRAL contract for reading the outside world.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ A4-2B GIVES `public_knowledge.search` A REAL EXECUTOR — AND NOTHING ELSE.
 *
 * Every A4 semantic decision is already closed and must stay closed: what the Owner meant,
 * whether retrieval is required, which world, and what words may leave the building are
 * decided upstream. This layer only goes and fetches. It is a RETRIEVAL EXECUTOR, never a
 * brain: it cannot answer Louie, cannot choose a world, cannot write, and its prose never
 * becomes the reply.
 *
 * ⛔ AND THE SEMANTIC LAYER MUST NOT LEARN A VENDOR'S NAME. This module defines the shape;
 * one adapter behind it speaks a specific API. A4 code depends on this file, never on the
 * vendor — a static test greps the semantic modules for provider tokens.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ⛔ THE THREE TRUST STATES, UNCHANGED FROM A3. They are repeated here rather than invented,
 * because a real network makes the distinction expensive to get wrong:
 *
 *   LIVE          the provider answered AND returned attributable results.
 *   LIVE_ZERO     the provider answered and honestly found nothing usable. That is a TRUE
 *                 answer about the outside world, exactly as an empty table is about ours.
 *   UNAVAILABLE   nothing was learned: auth, rate limit, 5xx, timeout, malformed, refusal.
 *
 * ⛔ AN UNAVAILABLE READ IS NEVER RE-LABELLED LIVE_ZERO. 「the provider failed」 and 「the world
 * contains nothing」 are different facts, and collapsing them is how a broken key becomes an
 * evidence-backed claim that a market has no data.
 */
const SEARCH_STATUS = Object.freeze({
  LIVE: 'live',
  LIVE_ZERO: 'live_zero',
  UNAVAILABLE: 'unavailable'
})

/** Why nothing was learned. Enums only — never a provider message, which can echo the query. */
const UNAVAILABLE_REASON = Object.freeze({
  NOT_CONFIGURED: 'not_configured',
  AUTH: 'auth',
  RATE_LIMIT: 'rate_limit',
  SERVER: 'server',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  MALFORMED: 'malformed',
  REFUSED: 'refused',
  NO_SEARCH_PERFORMED: 'no_search_performed',
  /**
   * ⛔ THE SEARCH RAN, SOURCES EXIST, AND STILL NOTHING TRUSTWORTHY COULD BE BUILT.
   * That is 「we could not construct evidence」, which is OUR failure — not 「the web has
   * nothing」, which is a claim about the world. See the LIVE_ZERO ruling below.
   */
  NO_ATTRIBUTABLE_CONTENT: 'no_attributable_content'
})

/**
 * ⛔ WHAT KIND OF TEXT THIS ROW'S CONTENT ACTUALLY IS.
 *
 * A sentence a retrieval model wrote while reading a page is NOT the page. It is a derived,
 * cited summary — usually accurate, occasionally a paraphrase that shifts a number's scope —
 * and labelling it as though the publisher had printed it would launder a summary into a
 * quotation. So the kind travels with the content, and no layer downstream has to guess.
 *
 * PUBLISHER_TEXT is declared because the distinction is the point, not because anything
 * produces it today: no current provider returns publisher-direct body text.
 */
const CONTENT_KIND = Object.freeze({
  WEB_SEARCH_CITED_SUMMARY: 'web_search_cited_summary',
  PUBLISHER_TEXT: 'publisher_direct_text'
})
const CONTENT_KINDS = new Set(Object.values(CONTENT_KIND))

/**
 * ⛔ A RESULT WITHOUT AN ATTRIBUTABLE SOURCE IS NOT EVIDENCE.
 *
 * A retrieval model can write a confident sentence with nothing behind it. Promoting that to
 * live public evidence would manufacture exactly the unsourced claim this whole project
 * removes elsewhere — so a row survives only if it carries a URL.
 */
function isAttributable (r) {
  return !!(r && typeof r.url === 'string' && /^https?:\/\//i.test(r.url.trim()))
}

/**
 * ⛔ AND A SOURCE WITHOUT CONTENT IS NOT EVIDENCE EITHER — THIS IS THE A4-2B REVIEW FIX.
 *
 * The first build treated a URL as a row and took its text from `snippet`. Against the real
 * provider that field does not exist: 67 consulted sources across three live searches carried
 * `{type, url}` and nothing else. Every public row therefore reached the main model as a bare
 * link with `content: ''` — source identity dressed as evidence, with no fact inside it.
 *
 * So content is now REQUIRED, and it must be LABELLED: a provider that cannot say what kind
 * of text it is handing over cannot have it promoted to evidence.
 */
function hasAttributableContent (r) {
  return !!(isAttributable(r) &&
    typeof r.content === 'string' && r.content.trim() !== '' &&
    CONTENT_KINDS.has(r.contentKind))
}

/**
 * Normalise one provider row into the shape A4 consumes.
 * ⛔ `publishedAt` is passed through ONLY when the provider actually supplied one. A date this
 * layer invented would be indistinguishable downstream from one the publisher printed.
 * ⛔ `title` stays NULL when absent. It used to fall back to the URL, which put a link in the
 * field an answer reads as a publication's name.
 */
function normaliseResult (r) {
  const url = String(r.url).trim()
  const title = (r.title == null || String(r.title).trim() === '') ? null : String(r.title).trim()
  return {
    title,
    url,
    content: String(r.content).trim(),
    contentKind: r.contentKind,
    publishedAt: r.publishedAt == null ? null : String(r.publishedAt),
    // Enrichment only: was this URL among those the search actually consulted, or is it known
    // solely because the retrieval model cited it? Never a substitute for content.
    consulted: r.consulted === true
  }
}

/**
 * Build the normalised envelope every provider must return.
 *
 * @param {object} input
 * @param {string} input.provider   stable identifier, e.g. 'openai_web_search'
 * @param {string} input.query      the query that ACTUALLY left — the planner's, never the model's
 * @param {string} input.retrievedAt server clock, never the provider's
 * @param {object[]} [input.results]
 * @param {string} [input.reason]   UNAVAILABLE_REASON when nothing was learned
 * @param {number} [input.sourcesSeen]  how many distinct sources the search actually surfaced,
 *   whether or not any of them yielded content. This is what separates 「the world is empty」
 *   from 「we could not read what the world gave us」.
 */
function makeSearchResult ({ provider, query, retrievedAt, results, reason = null, unavailable = false, sourcesSeen = 0 }) {
  if (unavailable) {
    return { status: SEARCH_STATUS.UNAVAILABLE, provider, query, retrievedAt, reason: reason || UNAVAILABLE_REASON.MALFORMED, results: [] }
  }
  const usable = (Array.isArray(results) ? results : []).filter(hasAttributableContent).map(normaliseResult)
  if (usable.length) {
    return { status: SEARCH_STATUS.LIVE, provider, query, retrievedAt, reason: null, results: usable }
  }

  /**
   * ⛔ NOTHING USABLE SPLITS INTO TWO DIFFERENT FACTS, AND THEY MUST NOT SHARE A STATUS.
   *
   * The search surfaced sources but none of them produced safely attributable text → we
   * failed to build evidence. Reporting that as LIVE_ZERO would put 「there is no public
   * information about this」 in front of the Owner on the strength of an extraction problem.
   * Only a search that genuinely surfaced nothing is LIVE_ZERO, and that remains a true and
   * useful answer about the world.
   */
  const seen = Number.isFinite(sourcesSeen) ? sourcesSeen : 0
  if (seen > 0) {
    return {
      status: SEARCH_STATUS.UNAVAILABLE, provider, query, retrievedAt,
      reason: UNAVAILABLE_REASON.NO_ATTRIBUTABLE_CONTENT, results: []
    }
  }
  return { status: SEARCH_STATUS.LIVE_ZERO, provider, query, retrievedAt, reason: null, results: [] }
}

/**
 * ⛔ ONE CONTENT-FREE ACCOUNTING LINE PER OUTBOUND RETRIEVAL.
 *
 * The Owner has raised cost explicitly, and a web search bills differently from a token: it
 * is a tool call. So the count is reported, not inferred. ⛔ THE QUERY IS NOT LOGGED — it is
 * the one string that left the building, and an accounting line is not the place to keep a
 * second copy of it. Nor are URLs, which are retrieval content.
 */
function logPublicSearch (entry, sink) {
  const line = {
    event: 'A4_PUBLIC_SEARCH',
    timestamp: new Date().toISOString(),
    requestId: entry && entry.requestId != null ? String(entry.requestId) : null,
    provider: entry && entry.provider ? String(entry.provider) : null,
    model: entry && entry.model ? String(entry.model) : null,
    status: entry && Object.values(SEARCH_STATUS).includes(entry.status) ? entry.status : SEARCH_STATUS.UNAVAILABLE,
    reason: entry && Object.values(UNAVAILABLE_REASON).includes(entry.reason) ? entry.reason : null,
    webSearchCalls: Number.isFinite(entry && entry.webSearchCalls) ? entry.webSearchCalls : 0,
    resultCount: Number.isFinite(entry && entry.resultCount) ? entry.resultCount : 0,
    inputTokens: Number.isFinite(entry && entry.inputTokens) ? entry.inputTokens : null,
    outputTokens: Number.isFinite(entry && entry.outputTokens) ? entry.outputTokens : null,
    totalTokens: Number.isFinite(entry && entry.totalTokens) ? entry.totalTokens : null,
    latencyMs: Number.isFinite(entry && entry.latencyMs) ? entry.latencyMs : null
  }
  try { (sink || ((l) => console.log('[AROMA-PUBLIC-SEARCH]', JSON.stringify(l))))(line) } catch (_) {}
  return line
}

module.exports = {
  SEARCH_STATUS,
  UNAVAILABLE_REASON,
  CONTENT_KIND,
  CONTENT_KINDS,
  isAttributable,
  hasAttributableContent,
  normaliseResult,
  makeSearchResult,
  logPublicSearch
}
