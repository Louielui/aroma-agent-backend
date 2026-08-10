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
  SEARCH_STATUS, UNAVAILABLE_REASON, CONTENT_KIND, makeSearchResult
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
 *
 * ⛔ IT NO LONGER ASKS FOR BREVITY, AND THAT IS THE A4-2B REVIEW FIX, NOT A TUNING PASS.
 * The old line ended 「Keep it brief; the sources matter more than the prose」 — written when
 * content was expected to arrive in `action.sources[].snippet`. It does not: the live payload
 * carries `{type, url}` per source and nothing else, so the CITED SENTENCES ARE THE ONLY
 * FACTUAL CONTENT THERE IS. An instruction to minimise them was an instruction to minimise the
 * evidence. It now asks for the facts as separate cited statements, because each citation
 * span becomes one evidence row.
 */
const RETRIEVAL_INSTRUCTION = 'Search the web for the request below and report only what the sources say. ' +
  'Do not answer from prior knowledge. Do not state any fact you did not find a source for. ' +
  'State each key fact as its own short sentence and cite the source it came from.'

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
 * ⛔ THE CITED SPAN, OR NOTHING. Fail-closed index handling.
 *
 * `url_citation` marks the stretch of the answer text a source supports. Slicing exactly that
 * span is what makes the sentence attributable to that URL. If the indices are missing, not
 * integers, inverted, negative or past the end of the text, THIS FUNCTION RETURNS NULL and the
 * citation yields no content at all.
 *
 * ⛔ THERE IS DELIBERATELY NO FALLBACK TO THE WHOLE TEXT. That fallback is the exact shape of
 * the bug being fixed: it would attach every sentence in the answer — including the ones a
 * different source supports, and the ones no source supports — to whichever URL happened to
 * carry a broken index.
 */
function citedSpan (text, a) {
  if (typeof text !== 'string' || !text) return null
  const s = a.start_index
  const e = a.end_index
  if (!Number.isInteger(s) || !Number.isInteger(e)) return null
  if (s < 0 || e <= s || e > text.length) return null
  const span = text.slice(s, e).trim()
  return span || null
}

/** Remove inline markdown links — `([host](https://…))` or `[host](https://…)` — from a string. */
function stripCitationMarkers (s) {
  return String(s == null ? '' : s)
    .replace(/\(?\s*\[[^\]]*\]\(\s*https?:\/\/[^\s)]*\s*\)\s*\)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * ⛔ A MARKER OWNS ITS CLAIM, NOT EVERYTHING BEHIND IT.
 *
 * The claim for a marker-style citation is 「the text since the last marker」 — which is far too
 * much when there WAS no last marker. A paragraph the model wrote from its own memory, sitting
 * above the first cited sentence, was handed to that source as evidence. The retrieval
 * instruction forbids unsourced prose; it does not prevent it, and a parser that trusts an
 * instruction is not a fence.
 *
 * So only the LAST sentence of the region is attributable. The boundary is STRUCTURAL — sentence
 * -ending punctuation followed by whitespace, or a line break. ⛔ NO SEMANTICS AND NO NLP: this
 * cannot read a sentence, it can only see where one ends.
 *
 * ⛔ THE `(?=\s)` IS LOAD-BEARING. Without it 「**$16.00 per hour**」 splits at the decimal point
 * and the claim becomes 「00 per hour**.」 — a number silently rewritten by a parser.
 *
 * A region with no internal boundary is ONE unbroken run of text, so it is the claim entire.
 * That is the honest reading, and it is also why the residual gap is stated rather than hidden:
 * an uncited lead written with no sentence-ending punctuation at all cannot be separated from
 * the claim by structure. Detecting that would require judging meaning, which this layer must
 * not do.
 *
 * The cost is deliberate: a marker supporting several sentences now contributes only its last.
 * Under-reporting a source is recoverable; attributing unsourced prose to one is not.
 */
const SENTENCE_BOUNDARY = /[.!?…](?=\s)|[。！？]|\n/g

function lastClaimIn (region) {
  const r = String(region == null ? '' : region).replace(/\s+$/, '')
  if (!r) return ''
  let cut = -1
  SENTENCE_BOUNDARY.lastIndex = 0
  let m
  while ((m = SENTENCE_BOUNDARY.exec(r)) !== null) {
    const end = m.index + m[0].length
    // ⛔ THE CLAIM'S OWN FULL STOP IS NOT A BOUNDARY. A CJK 「。」 needs no trailing space, so
    // without this the terminator at the very end of the region cuts the whole sentence away
    // and the row silently becomes empty.
    if (end < r.length) cut = end
  }
  return (cut >= 0 ? r.slice(cut) : r).trim()
}

/**
 * ⛔ IS THIS SPAN THE FACT, OR JUST THE FOOTNOTE?
 *
 * Measured against the live provider on 2026-08-09, `url_citation` does NOT delimit the claim —
 * it delimits the MARKDOWN CITATION MARKER printed after it:
 *
 *   「In Manitoba, the current general minimum wage is **$16.00 per hour**. ([gov.mb.ca](https://…))」
 *    ↑ the fact                                                            ↑ start_index … end_index
 *
 * Slicing the span therefore produced a 107-character 「fact」 that was a URL in prose form —
 * the SAME defect the review found in `action.sources`, one layer along, and it would have
 * shipped looking like a pass. So a span that is nothing but markers means the claim is the
 * text BEFORE it; a span with real words is taken as the claim itself.
 */
function isCitationMarker (span) {
  const left = stripCitationMarkers(span)
  return left === '' || /^[\s.,;:·—–()-]*$/.test(left)
}

/**
 * Pull ATTRIBUTABLE FACTUAL CONTENT out of a Responses payload.
 *
 * ── WHY THIS IS NOT THE ORIGINAL DESIGN ─────────────────────────────────────
 * The first build read `web_search_call.action.sources[].snippet` and treated the answer text
 * as prose to be discarded. That inverted the documented guarantees. The contract promises the
 * consulted URLs, the message text, and `url_citation` annotations tying spans of that text to
 * those URLs — it does NOT promise a snippet, and the live provider does not send one. Measured
 * over three real searches: 67 sources, key set `{type, url}`, ZERO snippets, ZERO titles.
 *
 * So the roles swap. ⛔ THE CITED SPANS ARE THE FACTS; the consulted-source list is provenance
 * that ENRICHES a row and can never create one. A URL the search merely read, with no cited
 * sentence attached, contributes no evidence — source identity is not a fact.
 *
 * ⛔ UNCITED PROSE IS DISCARDED ENTIRELY. Only text inside a valid citation span survives, so a
 * confident sentence the model wrote with nothing behind it has no path into an EvidenceSet.
 */
function extractResults (payload) {
  const output = Array.isArray(payload && payload.output) ? payload.output : []
  let webSearchCalls = 0
  let searchPerformed = false

  // url -> what the SEARCH knows about it (identity and, if a vendor ever sends one, a date)
  const consulted = new Map()
  // url -> { url, title, spans:[], publishedAt } built from CITATIONS only
  const cited = new Map()
  /**
   * ⛔ EVERY SOURCE THE SEARCH SURFACED, INCLUDING THE ONES WE REFUSED TO TRUST.
   * This is the only thing separating 「the world has nothing」 from 「the world answered and we
   * could not read it」. A turn whose citations were all fenced off has seen sources; calling
   * that LIVE_ZERO would report an empty public record on the strength of our own parser
   * giving up.
   */
  const seenUrls = new Set()

  for (const item of output) {
    if (!item || typeof item !== 'object') continue

    if (item.type === 'web_search_call') {
      webSearchCalls++
      if (item.status === 'completed') searchPerformed = true
      const action = item.action && typeof item.action === 'object' ? item.action : {}
      const sources = Array.isArray(action.sources) ? action.sources : []
      for (const s of sources) {
        const url = s && (s.url || s.link)
        if (!url || consulted.has(url)) continue
        consulted.set(url, {
          title: s.title || null,
          publishedAt: s.published_at || s.publishedAt || null
        })
        seenUrls.add(url)
      }
      continue
    }

    if (item.type === 'message') {
      const content = Array.isArray(item.content) ? item.content : []
      // ⛔ ONE CURSOR AND ONE FENCE PER CONTENT PART. Offsets are relative to their own text;
      // carrying either across parts would segment one part with another's positions.
      for (const c of content) {
        const text = c && typeof c.text === 'string' ? c.text : ''
        const citations = (Array.isArray(c && c.annotations) ? c.annotations : [])
          .filter((a) => a && a.type === 'url_citation')
        // Counted BEFORE any trust judgement: a citation we then fence off is still a source
        // the search surfaced, and that is what keeps a fenced turn out of LIVE_ZERO.
        for (const a of citations) if (typeof a.url === 'string' && a.url) seenUrls.add(a.url)

        const inRange = (n) => Number.isInteger(n) && n >= 0 && n <= text.length
        const wellFormed = (a) => inRange(a.start_index) && inRange(a.end_index) && a.end_index > a.start_index

        /**
         * ⛔ WHERE DOES TRUST RUN OUT?
         *
         * A claim is 「the text since the last marker」, so skipping a malformed citation without
         * fencing it lets the NEXT valid marker reach backwards and swallow a sentence that
         * belonged to the malformed one — or to nobody. Fail-closed on one citation is worthless
         * if its text simply lands on the next source.
         *
         * So a malformed citation ends trust at the earliest position we can honestly place it:
         *   · its `start_index`, when that alone is a real offset into this text
         *   · position 0 otherwise — an annotation we cannot locate could govern ANY region, so
         *     no part of this content part can be segmented safely.
         *
         * ⛔ NOTHING IS GUESSED. An out-of-range index is not quietly read as 「the end」, and a
         * malformed span's text is never reassigned to another URL. Claims already closed off
         * BEFORE the fence stay — they were segmented across trustworthy ground.
         */
        let fence = Infinity
        for (const a of citations) {
          if (wellFormed(a)) continue
          fence = inRange(a.start_index) ? Math.min(fence, a.start_index) : 0
          if (fence === 0) break
        }

        // In document order, so 「the text before this marker」 means the text since the LAST
        // marker — not the whole answer replayed under every citation.
        const ordered = citations.filter(wellFormed).sort((x, y) => x.start_index - y.start_index)

        let cursor = 0
        for (const a of ordered) {
          // At or past the fence: the path to this citation crosses unreadable ground.
          if (a.end_index > fence) break
          // ⛔ OVERLAPPING CITATIONS CANNOT BE SEGMENTED. One region cannot be two sources'
          // evidence, and 「whichever sorted first wins」 is arbitration, not attribution.
          if (a.start_index < cursor) break

          const span = text.slice(a.start_index, a.end_index).trim()
          // ⛔ THE REGION IS ACCOUNTED FOR EVEN WHEN IT YIELDS NOTHING. Advancing the cursor is
          // what stops the next marker inheriting this citation's text.
          // ⛔ ONLY THE LAST SENTENCE OF THE REGION. Everything earlier in it is text no citation
          // has claimed — the model's own preamble, or an aside between two sources.
          const claim = !span
            ? ''
            : (isCitationMarker(span)
                // ⛔ SEGMENT ON THE RAW REGION, THEN STRIP. stripCitationMarkers collapses all
                // whitespace, so stripping first would erase the line breaks that separate one
                // stated fact from the next.
                ? stripCitationMarkers(lastClaimIn(text.slice(cursor, a.start_index)))
                : stripCitationMarkers(span))
          cursor = Math.max(cursor, a.end_index)

          // ⛔ A MARKER WITH NOTHING IN FRONT OF IT IS STILL NOT A FACT, and a citation with no
          // URL cannot own one — but both have now fenced their region, which is the point.
          if (!claim || typeof a.url !== 'string' || !a.url) continue
          const row = cited.get(a.url) || { url: a.url, title: null, spans: [] }
          if (!row.title && a.title) row.title = a.title
          // Two citations to one page are two claims from that page, not a duplicate row.
          if (!row.spans.includes(claim)) row.spans.push(claim)
          cited.set(a.url, row)
        }
      }
    }
  }

  const results = [...cited.values()].map((row) => {
    const enrich = consulted.get(row.url) || null
    return {
      url: row.url,
      title: row.title || (enrich && enrich.title) || null,
      // ⛔ JOINED WITH AN ELLIPSIS, NOT A SPACE. Two cited spans are separate statements; running
      // them together would read as one continuous sentence the source never wrote.
      content: row.spans.join(' … '),
      contentKind: CONTENT_KIND.WEB_SEARCH_CITED_SUMMARY,
      publishedAt: (enrich && enrich.publishedAt) || null,
      consulted: consulted.has(row.url)
    }
  })

  // Everything the search surfaced, cited or not. Used ONLY to tell 「found nothing」 apart from
  // 「found pages but could not attribute any text to them」.
  const sourcesSeen = seenUrls.size

  return { results, webSearchCalls, searchPerformed, sourcesSeen }
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

    const { results, webSearchCalls, searchPerformed, sourcesSeen } = extractResults(payload)

    // ⛔ A TURN WHERE THE TOOL NEVER RAN IS NOT A LIVE-ZERO. The model may answer from its own
    // memory without searching; that produces prose with no provenance, and calling it 「the
    // outside world contains nothing」 would be a fabrication with a status field attached.
    if (!searchPerformed) {
      return Object.assign(fail(UNAVAILABLE_REASON.NO_SEARCH_PERFORMED), { usage: usageOf(payload), latencyMs, webSearchCalls })
    }

    const out = makeSearchResult({ provider: PROVIDER_ID, query, retrievedAt, results, sourcesSeen })
    return Object.assign(out, { usage: usageOf(payload), latencyMs, webSearchCalls, model, sourcesSeen })
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
  citedSpan,
  isCitationMarker,
  stripCitationMarkers,
  lastClaimIn,
  reasonForStatus
}
