'use strict'

/**
 * openaiWebSearchProvider.js — the ONE file that knows a search vendor's name.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ CONTRACT VERIFIED AGAINST THE CURRENT OFFICIAL DOCS, NOT ASSUMED.
 *
 * developers.openai.com/api/docs/guides/tools-web-search, read 2026-08-09:
 *   · tool type is `"web_search"`
 *   · consulted sources come back when `include: ["web_search_call.action.sources"]` is sent
 *   · the answer message carries `content[0].annotations[]` of `url_citation` with `url`,
 *     `title`, `start_index`, `end_index`
 *   · `user_location` is `{ type:'approximate', country, city, region, timezone }`
 *   · `search_context_size` is low | medium | high
 * developers.openai.com/api/docs/models, same date: `gpt-5.6-luna` exists, is the
 * cost-optimised high-volume variant, and lists Web search among its tools.
 *
 * ⛔ LUNA, NOT THE MAIN BRAIN'S MODEL. This is a bounded, high-volume retrieval worker whose
 * output is raw material. Terra/Sol are not used here, and this model never composes the
 * Owner's answer.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT THIS REQUEST IS ALLOWED TO CONTAIN, AND WHY THE LIST IS SO SHORT ────
 * The Owner-only Public Query Egress Planner already decided the only words permitted to
 * leave. So this carries the planner's query, an admitted location, and a minimal retrieval
 * instruction — and nothing else. No conversation history, no persona, no Conversation
 * Contract, no Decision Recall, no internal evidence, no supplier or price learned this turn,
 * no earlier assistant text. Those are not filtered out here; they are never parameters, so
 * there is nothing to strip and nothing to forget to strip.
 *
 * `store: false` on every request: this must not create retrievable Application State.
 */

const {
  SEARCH_STATUS, UNAVAILABLE_REASON, makeSearchResult
} = require('./publicSearchProvider')

const PROVIDER_ID = 'openai_web_search'
const RESPONSES_URL = 'https://api.openai.com/v1/responses'

/** The dated build this provider was measured against. Pinned in wiring, not inherited. */
const DEFAULT_MODEL = 'gpt-5.6-luna'

/**
 * ⛔ THE LOWEST SETTING THAT STILL SEARCHES. Reasoning tokens bill as output tokens, and this
 * worker is meant to fetch rather than think. `low` is the floor that reliably performs the
 * tool call; the docs list `none`, but a model that does not reason may not decide to invoke
 * the tool at all, which is the one behaviour this file exists for.
 */
const DEFAULT_EFFORT = 'low'
const DEFAULT_TIMEOUT_MS = 30000
const MAX_OUTPUT_TOKENS = 1500

/**
 * ⛔ MINIMAL RETRIEVAL INSTRUCTION — MODEL TEXT, and deliberately not a persona.
 * It asks for retrieval and forbids the two failure modes that would corrupt evidence:
 * answering from memory, and asserting anything it did not find a source for.
 */
const RETRIEVAL_INSTRUCTION = 'Search the web for the request below and report only what the sources say. ' +
  'Do not answer from prior knowledge. Do not state any fact you did not find a source for. ' +
  'Keep it brief; the sources matter more than the prose.'

/** freshness is MEANING, not a vendor parameter — rendered as a hint the search can honour. */
const FRESHNESS_HINT = Object.freeze({
  current: ' Prefer the most recent information available.',
  recent: ' Prefer information from the past few months.',
  any: ''
})

/**
 * ⛔ LOCATION IS ADMITTED, NEVER INFERRED. Only a value already in the closed READ_ARGS bag
 * reaches the vendor. Nothing is pulled from memory, profile, IP or Aroma records — if the
 * Owner did not put a place in scope, the request carries none.
 *
 * The closed contract carries a free-text `location`, while the vendor wants a structured
 * approximate object. Mapping it to `city` is the honest narrowing: it is what the Owner
 * named, and guessing a country or timezone from it would be inference wearing a field name.
 */
function toUserLocation (location) {
  const s = typeof location === 'string' ? location.trim() : ''
  if (!s) return null
  return { type: 'approximate', city: s }
}

/** Map a transport/HTTP failure to a reason enum. The provider's message is DISCARDED. */
function reasonForStatus (status) {
  if (status === 401 || status === 403) return UNAVAILABLE_REASON.AUTH
  if (status === 429) return UNAVAILABLE_REASON.RATE_LIMIT
  if (status >= 500) return UNAVAILABLE_REASON.SERVER
  return UNAVAILABLE_REASON.MALFORMED
}

/**
 * Pull attributable sources out of a Responses payload.
 *
 * ⛔ THE CONSULTED-SOURCE METADATA IS PREFERRED OVER THE PROSE. `web_search_call.action.sources`
 * is what the search actually consulted; annotations are what the model chose to cite. Both are
 * real, but the first is the better provenance, so it is read first and annotations only fill
 * in titles. Nothing is taken from the answer text itself.
 */
function extractResults (payload) {
  const out = new Map() // url -> row, first writer wins
  const output = Array.isArray(payload && payload.output) ? payload.output : []
  let webSearchCalls = 0
  let searchPerformed = false

  for (const item of output) {
    if (!item || typeof item !== 'object') continue

    if (item.type === 'web_search_call') {
      webSearchCalls++
      if (item.status === 'completed') searchPerformed = true
      const action = item.action && typeof item.action === 'object' ? item.action : {}
      const sources = Array.isArray(action.sources) ? action.sources : []
      for (const s of sources) {
        const url = s && (s.url || s.link)
        if (!url || out.has(url)) continue
        out.set(url, { url, title: s.title || null, snippet: s.snippet || null, publishedAt: s.published_at || s.publishedAt || null })
      }
      continue
    }

    if (item.type === 'message') {
      const content = Array.isArray(item.content) ? item.content : []
      for (const c of content) {
        const anns = Array.isArray(c && c.annotations) ? c.annotations : []
        for (const a of anns) {
          if (!a || a.type !== 'url_citation' || !a.url) continue
          const existing = out.get(a.url)
          if (existing) { if (!existing.title && a.title) existing.title = a.title; continue }
          out.set(a.url, { url: a.url, title: a.title || null, snippet: null, publishedAt: null })
        }
      }
    }
  }
  return { results: [...out.values()], webSearchCalls, searchPerformed }
}

/**
 * Create the provider.
 *
 * @param {object} [options]
 * @param {string} [options.apiKey]     defaults to process.env.OPENAI_API_KEY
 * @param {string} [options.model]      defaults to the pinned Luna build
 * @param {function} [options.transport] injected fetch, for tests. Production uses global fetch.
 * @returns {{ provider:string, model:string, search:function }}
 */
function createOpenAIWebSearchProvider (options = {}) {
  const model = options.model || DEFAULT_MODEL
  const effort = options.reasoningEffort || DEFAULT_EFFORT
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const transport = typeof options.transport === 'function' ? options.transport : null
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()

  /**
   * @param {{query:string, freshness?:string, location?:string}} args — the PLANNER's args
   * @returns {Promise<object>} the normalised envelope from publicSearchProvider
   */
  async function search (args = {}) {
    const retrievedAt = clock()
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    const fail = (reason) => makeSearchResult({ provider: PROVIDER_ID, query, retrievedAt, unavailable: true, reason })

    // ⛔ NO QUERY, NO REQUEST. Reaching the vendor with an empty string would spend a paid
    // call to ask nothing, and the planner already refuses to produce one.
    if (!query) return Object.assign(fail(UNAVAILABLE_REASON.MALFORMED), { usage: null })

    const apiKey = options.apiKey || process.env.OPENAI_API_KEY
    if (!apiKey) return Object.assign(fail(UNAVAILABLE_REASON.NOT_CONFIGURED), { usage: null })

    const tool = { type: 'web_search' }
    const userLocation = toUserLocation(args.location)
    if (userLocation) tool.user_location = userLocation

    const hint = FRESHNESS_HINT[args.freshness] || ''
    const body = {
      model,
      instructions: RETRIEVAL_INSTRUCTION + hint,
      input: query,
      tools: [tool],
      // ⛔ THE CONSULTED SOURCES, ASKED FOR EXPLICITLY. Without this the payload carries only
      // what the model chose to cite in prose, which is a weaker provenance than what the
      // search actually read.
      include: ['web_search_call.action.sources'],
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: false, // ⛔ never create retrievable Application State
      reasoning: { effort }
      // ⛔ NO temperature / top_p: the GPT-5 family rejects them outright (HTTP 400).
    }

    const started = Date.now()
    let res, payload
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      const doFetch = transport || fetch
      res = await doFetch(RESPONSES_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      })
    } catch (e) {
      // ⛔ THE THROWN MESSAGE IS DISCARDED. It can carry the request back with it, and the
      // request contains the one string that left the building.
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')))
      return Object.assign(fail(aborted ? UNAVAILABLE_REASON.TIMEOUT : UNAVAILABLE_REASON.NETWORK), { usage: null, latencyMs: Date.now() - started })
    } finally { if (timer) clearTimeout(timer) }

    const latencyMs = Date.now() - started
    if (!res || typeof res.status !== 'number' || res.status < 200 || res.status >= 300) {
      return Object.assign(fail(reasonForStatus(res ? res.status : 0)), { usage: null, latencyMs })
    }
    try { payload = await res.json() } catch (_) {
      return Object.assign(fail(UNAVAILABLE_REASON.MALFORMED), { usage: null, latencyMs })
    }
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.output)) {
      return Object.assign(fail(UNAVAILABLE_REASON.MALFORMED), { usage: null, latencyMs })
    }

    const { results, webSearchCalls, searchPerformed } = extractResults(payload)

    // ⛔ A TURN WHERE THE TOOL NEVER RAN IS NOT A LIVE-ZERO. The model may answer from its own
    // memory without searching; that produces prose with no provenance, and calling it 「the
    // outside world contains nothing」 would be a fabrication with a status field attached.
    if (!searchPerformed) {
      return Object.assign(fail(UNAVAILABLE_REASON.NO_SEARCH_PERFORMED), { usage: usageOf(payload), latencyMs, webSearchCalls })
    }

    const out = makeSearchResult({ provider: PROVIDER_ID, query, retrievedAt, results })
    return Object.assign(out, { usage: usageOf(payload), latencyMs, webSearchCalls, model })
  }

  function usageOf (payload) {
    const u = payload && payload.usage
    if (!u || typeof u !== 'object') return null
    return {
      inputTokens: Number.isFinite(u.input_tokens) ? u.input_tokens : null,
      outputTokens: Number.isFinite(u.output_tokens) ? u.output_tokens : null,
      totalTokens: Number.isFinite(u.total_tokens) ? u.total_tokens : null
    }
  }

  return { provider: PROVIDER_ID, model, search }
}

module.exports = {
  createOpenAIWebSearchProvider,
  PROVIDER_ID,
  DEFAULT_MODEL,
  DEFAULT_EFFORT,
  RETRIEVAL_INSTRUCTION,
  RESPONSES_URL,
  toUserLocation,
  extractResults,
  reasonForStatus
}
