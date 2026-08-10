'use strict'

/**
 * publicKnowledgeRead.js — `public_knowledge.search` as an ordinary read source.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE OUTSIDE WORLD ARRIVES THROUGH THE SAME DOOR AS EVERYTHING ELSE.
 *
 * A4-2A proved the capability with a fake executor precisely so this file could be the only
 * thing that changed when a real one arrived. It registers like every other adapter — one
 * source, one read-shaped method, results built by `makeContextResult` — so the whole existing
 * pipeline applies unchanged: the connector's write refusal, the evidence envelope, trust
 * states, the Answer Plan's grounding checks.
 *
 * ⛔ IT IS STILL OFF BY DEFAULT — but governed rather than absent (A4-3A). liveClients builds
 * it only when master READ_ACCESS, CONTEXT_PUBLIC_KNOWLEDGE, an API key AND A4 itself are all
 * present, and every one of those defaults off.
 *
 * ⛔ AND THE QUERY IS NOT ITS BUSINESS. Whatever string arrives here was authored by the
 * Owner-only Public Query Egress Planner; this file never composes, rewrites or enriches it.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { makeContextResult } = require('../contextResult')
const { SEARCH_STATUS, logPublicSearch } = require('../providers/publicSearchProvider')

/** Enough to answer, few enough that other sources still fit beside it in the block. */
const MAX_RESULTS = 5

/**
 * ⛔ THIS SOURCE'S READ IS A LIVE WEB SEARCH, AND IT SAYS SO OUT LOUD.
 *
 * The connector's shared 10s cap is right for an API answering from a database and wrong here:
 * the A4-3B production canary watched a healthy retrieval killed at 10s while the provider was
 * still well inside its own 30s budget, and the Owner was told the outside world could not be
 * read.
 *
 * ⛔ LONGER THAN THE PROVIDER'S OWN BOUND, DELIBERATELY. At 35s the provider's 30s abort always
 * fires first, so a slow search fails with the reason it actually had — a timeout the provider
 * classified — instead of being cut off by an outer stopwatch that knows nothing about it.
 * The two numbers are ordered on purpose; they are not the same guard twice.
 */
const PUBLIC_READ_TIMEOUT_MS = 35000

/**
 * ⛔ A PUBLIC ITEM IS NOT ONE OF THE RESTAURANT'S ENTITIES.
 * ENTITY_TYPES enumerates Aroma's own record kinds — an invoice, a supplier, a purchase order.
 * A page from the outside world is none of them, and borrowing one would let a downstream
 * renderer treat a web page as a business record. It carries its own kind instead.
 */
const PUBLIC_ENTITY_TYPE = 'public_item'

/**
 * @param {object} options
 * @param {{search:function, provider:string, model?:string}} options.provider  the retrieval executor
 * @param {function} [options.clock]
 * @param {function} [options.logSink]  test seam for the accounting line
 */
function createPublicKnowledgeReadAdapter (options = {}) {
  const provider = options.provider
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()

  const methods = {
    /**
     * ⛔ `search` IS READ-SHAPED AND THE CONNECTOR ENFORCES THAT INDEPENDENTLY. It is not on
     * the write-verb list, and there is no second method here — this source can fetch and
     * nothing else.
     */
    async search ({ query, freshness = null, location = null, limit = MAX_RESULTS, requestId = null } = {}) {
      if (!provider || typeof provider.search !== 'function') {
        // No executor wired. Throwing is correct: the connector turns it into UNAVAILABLE,
        // which is the honest state — nothing was learned. Returning [] here would have
        // claimed the outside world is empty.
        throw new Error('public knowledge provider is not configured')
      }

      const out = await provider.search({ query, freshness, location })

      logPublicSearch({
        requestId,
        provider: out.provider,
        model: out.model || (provider.model || null),
        status: out.status,
        reason: out.reason,
        webSearchCalls: out.webSearchCalls,
        resultCount: Array.isArray(out.results) ? out.results.length : 0,
        inputTokens: out.usage ? out.usage.inputTokens : null,
        outputTokens: out.usage ? out.usage.outputTokens : null,
        totalTokens: out.usage ? out.usage.totalTokens : null,
        latencyMs: out.latencyMs
      }, options.logSink)

      // ⛔ UNAVAILABLE THROWS, IT DOES NOT RETURN ZERO ROWS. The connector's own unavailable
      // envelope is the single place that state is constructed, and 「the provider failed」 must
      // never arrive downstream wearing the same shape as 「the world has nothing」.
      if (out.status === SEARCH_STATUS.UNAVAILABLE) {
        throw new Error('public search unavailable: ' + (out.reason || 'unknown'))
      }

      const retrievedAt = clock()
      return out.results.slice(0, Math.max(0, Math.min(limit, MAX_RESULTS))).map((r, i) => makeContextResult({
        source: 'public_knowledge',
        // Stable within the turn and derived from position, so two rows from one page cannot
        // collide. The URL is the real identity and travels in `link` and `fields`.
        sourceId: 'web-' + (i + 1),
        // A row needs a label to be rendered at all; the URL is the honest one when the source
        // gave no title. ⛔ `fields.sourceTitle` keeps the truth — null means null — so nothing
        // downstream can mistake a link for a publication's name.
        title: r.title || r.url,
        // ⛔ THE PUBLISHER'S DATE OR NOTHING. A retrieval date is not a publication date, and
        // filling this with `retrievedAt` would let a page from 2019 read as today's news.
        originalDate: r.publishedAt,
        // ⛔ THE ATTRIBUTED CLAIM ITSELF — the whole point of the A4-2B review fix. This used to
        // read `r.snippet`, a field the live provider never sends, so every public row arrived
        // at the main model as an empty string beside a URL.
        content: r.content,
        link: r.url,
        retrievedAt,
        entityType: PUBLIC_ENTITY_TYPE,
        // ⛔ PROVENANCE TRAVELS AS DATA, NOT AS PROSE. The final answer layer decides how to
        // present a citation; the retrieval model's own citation formatting is never the
        // Owner-facing mechanism.
        // ⛔ `contentKind` travels WITH the content so no downstream layer can quote a derived
        // summary as though the publisher had printed it.
        fields: {
          url: r.url,
          sourceTitle: r.title,
          provider: out.provider,
          publishedAt: r.publishedAt,
          contentKind: r.contentKind,
          consulted: r.consulted === true
        }
      }))
    }
  }

  return {
    source: 'public_knowledge',
    methods,
    // Declared as adapter metadata, honoured generically by the connector. Nothing in the
    // connector learns what this source is; it only reads a number.
    readTimeoutMs: PUBLIC_READ_TIMEOUT_MS,
    ready: () => !!(provider && typeof provider.search === 'function')
  }
}

module.exports = { createPublicKnowledgeReadAdapter, MAX_RESULTS, PUBLIC_ENTITY_TYPE, PUBLIC_READ_TIMEOUT_MS }
