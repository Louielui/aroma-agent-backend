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
  NO_SEARCH_PERFORMED: 'no_search_performed'
})

/**
 * ⛔ A RESULT WITHOUT AN ATTRIBUTABLE SOURCE IS NOT EVIDENCE.
 *
 * A retrieval model can write a confident sentence with nothing behind it. Promoting that to
 * live public evidence would manufacture exactly the unsourced claim this whole project
 * removes elsewhere — so a row survives only if it carries a URL. Everything else is dropped,
 * and if nothing survives the read is LIVE_ZERO rather than a set of pretty sentences.
 */
function isAttributable (r) {
  return !!(r && typeof r.url === 'string' && /^https?:\/\//i.test(r.url.trim()))
}

/**
 * Normalise one provider row into the shape A4 consumes.
 * ⛔ `publishedAt` is passed through ONLY when the provider actually supplied one. A date this
 * layer invented would be indistinguishable downstream from one the publisher printed.
 */
function normaliseResult (r) {
  const url = String(r.url).trim()
  return {
    title: (r.title == null || String(r.title).trim() === '') ? url : String(r.title).trim(),
    url,
    snippet: r.snippet == null ? null : String(r.snippet),
    publishedAt: r.publishedAt == null ? null : String(r.publishedAt)
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
 */
function makeSearchResult ({ provider, query, retrievedAt, results, reason = null, unavailable = false }) {
  if (unavailable) {
    return { status: SEARCH_STATUS.UNAVAILABLE, provider, query, retrievedAt, reason: reason || UNAVAILABLE_REASON.MALFORMED, results: [] }
  }
  const usable = (Array.isArray(results) ? results : []).filter(isAttributable).map(normaliseResult)
  return {
    // ⛔ ZERO USABLE ROWS IS A TRUE ANSWER, NOT A FAILURE — but only because the provider
    // genuinely answered. The caller reaches this branch solely on a completed request.
    status: usable.length ? SEARCH_STATUS.LIVE : SEARCH_STATUS.LIVE_ZERO,
    provider,
    query,
    retrievedAt,
    reason: null,
    results: usable
  }
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
  isAttributable,
  normaliseResult,
  makeSearchResult,
  logPublicSearch
}
