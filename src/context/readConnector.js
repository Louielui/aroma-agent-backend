'use strict'

/**
 * readConnector.js — the shared, vendor-neutral READ registry for Unified Read
 * Access v1. It is read-only BY CONSTRUCTION (Wall 1): it refuses to register any
 * write-shaped method, exposes no write/send/modify/delete path, and has no
 * generic shell or arbitrary-HTTP client. Adding a source = one register() call.
 *
 * Content returned from any source is UNTRUSTED DATA, never instructions — and
 * because there is no write/dispatch surface reachable from here, a document that
 * says "心燈 do X" cannot cause any action; the connector can only return it as
 * `content` for citation.
 *
 * Guardrails (basic, honest): per-call timeout, result-count cap, per-item size
 * cap (truncate + flag). Any failure → a single trust:'unavailable' result with a
 * plain reason, so 心燈 says "目前讀不到" rather than guessing.
 */

const { makeUnavailable } = require('./contextResult')
const { readAccessEnabled } = require('./flags')

const DEFAULT_CAPS = Object.freeze({ timeoutMs: 10000, maxResults: 25, maxItemBytes: 20000 })

/**
 * ⛔ ONE SOURCE MAY NEED LONGER, AND SAYS SO ITSELF.
 *
 * 10 seconds is right for an API that answers from a database. It is WRONG for a source whose
 * read is a live web search: the A4-3B production canary watched a perfectly good public
 * retrieval get killed at 10s by this connector while the provider was still inside its own
 * 30s budget, and the turn reported 「讀唔到」 about a world that was answering fine.
 *
 * Raising the shared cap would have bought that one source a longer rope by lengthening
 * everyone's. So an adapter declares its own bound instead, and the connector honours it —
 * ⛔ WITHOUT LEARNING WHY. Nothing here knows what a web search is; it knows that a source may
 * publish a number, and that a bad number is ignored.
 */
function timeoutForAdapter (adapter, caps) {
  const declared = adapter && adapter.readTimeoutMs
  // ⛔ A BAD DECLARATION FALLS BACK, IT NEVER DISABLES. 0, negative, NaN, Infinity and
  // non-numbers all land on the shared cap — there is no value an adapter can publish that
  // removes its own timeout.
  return (typeof declared === 'number' && Number.isFinite(declared) && declared > 0)
    ? declared
    : caps.timeoutMs
}

// Wall 1: any method whose NAME looks like a mutation is refused at registration
// and at call time. Read methods are named list*/get*/search*/read* only.
const WRITE_RE = /^(create|update|delete|remove|send|post|put|patch|write|modify|move|share|insert|trash|batch|append|revoke|set|add|upload|import|export|copy|rename|drop|purge|clear|archive|label|unlabel|reply|forward|compose)/i

function createReadConnector (options = {}) {
  const env = options.env || process.env
  const caps = Object.assign({}, DEFAULT_CAPS, options.caps || {})
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  const adapters = new Map()

  function register (adapter) {
    if (!adapter || typeof adapter.source !== 'string' || !adapter.methods || typeof adapter.methods !== 'object') {
      throw new TypeError('read adapter must be { source: string, methods: object }')
    }
    for (const name of Object.keys(adapter.methods)) {
      if (typeof adapter.methods[name] !== 'function') throw new TypeError(`method ${name} must be a function`)
      if (WRITE_RE.test(name)) throw new Error(`read connector refuses write-shaped method '${name}' on '${adapter.source}'`)
    }
    adapters.set(adapter.source, adapter)
    return adapter
  }

  function sources () { return [...adapters.keys()] }

  /** Wall-1 assertion helper: true if ANY registered method is write-shaped. */
  function hasWriteMethod () {
    for (const a of adapters.values()) for (const n of Object.keys(a.methods)) if (WRITE_RE.test(n)) return true
    return false
  }

  function capItem (r, maxBytes) {
    if (!r || typeof r !== 'object' || typeof r.content !== 'string') return r
    if (Buffer.byteLength(r.content, 'utf8') <= maxBytes) return r
    return Object.assign({}, r, { content: r.content.slice(0, maxBytes) + '…', truncated: true })
  }

  /**
   * Read from a source. Returns { asOf, source, count, truncatedCount, results[] }
   * on success, or a single trust:'unavailable' object on any gate/failure.
   */
  async function read (source, method, params = {}) {
    const asOf = clock()
    if (!readAccessEnabled(env, source)) return makeUnavailable({ source, reason: 'read access disabled (flag off)', retrievedAt: asOf })
    const adapter = adapters.get(source)
    if (!adapter) return makeUnavailable({ source, reason: 'no adapter registered', retrievedAt: asOf })
    const fn = adapter.methods[method]
    if (typeof fn !== 'function' || WRITE_RE.test(method)) return makeUnavailable({ source, reason: `unknown or forbidden read method '${method}'`, retrievedAt: asOf })

    let out
    const timeoutMs = timeoutForAdapter(adapter, caps)
    // ⛔ THE LOSING TIMER IS ALWAYS CLEARED. `Promise.race` settles, but the timer it lost to
    // does not stop existing — and a 35-second public timeout left pending on every fast read
    // keeps the event loop alive and delays process exit. The handle is held so `finally` can
    // cancel it whichever branch wins.
    let timer = null
    try {
      out = await Promise.race([
        Promise.resolve().then(() => fn(params)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs) })
      ])
    } catch (e) {
      return makeUnavailable({ source, reason: `read failed: ${(e && e.message) || String(e)}`, retrievedAt: asOf })
    } finally {
      if (timer) clearTimeout(timer)
    }

    // AN ADAPTER MAY DESCRIBE ITS OWN READ. Returning `{ results, evidence }` instead of a
    // bare array lets a source say how many rows exist in total, what its numbers mean and
    // how they were ordered — facts the composer needs in order not to present four rows
    // out of two hundred as the answer. Bare arrays remain valid and simply carry no
    // description; nothing about the read path or the caps changes either way.
    const enveloped = out && !Array.isArray(out) && Array.isArray(out.results)
    const arr = enveloped ? out.results : (Array.isArray(out) ? out : [out])
    /**
     * ⛔ THE ADAPTER DECLARES ITS OWN ROW POLICY; THIS LAYER ONLY VALIDATES IT.
     *
     * The shared default of 25 stays the default. An adapter may declare, per method, that
     * its rows must not be cut — `null` meaning 「no client cap」 — because only the adapter
     * knows which of its endpoints is a ranked sample and which is a whole small table. This
     * layer must NOT learn business semantics: it has no business knowing what a supplier is.
     *
     * ⛔ AND IT IS NOT A CHANNEL. The declaration comes from the adapter MODULE, never from a
     * caller, a user or a model, and anything this layer cannot validate — a string, a
     * negative, a float — falls back to the default rather than being honoured.
     */
    const declared = adapter && adapter.rowLimits && Object.prototype.hasOwnProperty.call(adapter.rowLimits, method)
      ? adapter.rowLimits[method]
      : undefined
    const rowLimit = declared === null
      ? null
      : (Number.isInteger(declared) && declared > 0 ? declared : caps.maxResults)
    const capped = (rowLimit === null ? arr : arr.slice(0, rowLimit)).map((r) => capItem(r, caps.maxItemBytes))
    return {
      asOf,
      source,
      count: capped.length,
      truncatedCount: rowLimit === null ? 0 : Math.max(0, arr.length - rowLimit),
      results: capped,
      evidence: enveloped && out.evidence ? out.evidence : null
    }
  }

  return { register, read, sources, hasWriteMethod, caps }
}

module.exports = { createReadConnector, DEFAULT_CAPS, WRITE_RE, timeoutForAdapter }
