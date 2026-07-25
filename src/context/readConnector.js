'use strict'

/**
 * readConnector.js — the shared, vendor-neutral READ registry for Unified Read
 * Access v1. It is read-only BY CONSTRUCTION (Wall 1): it refuses to register any
 * write-shaped method, exposes no write/send/modify/delete path, and has no
 * generic shell or arbitrary-HTTP client. Adding a source = one register() call.
 *
 * Content returned from any source is UNTRUSTED DATA, never instructions — and
 * because there is no write/dispatch surface reachable from here, a document that
 * says "香香 do X" cannot cause any action; the connector can only return it as
 * `content` for citation.
 *
 * Guardrails (basic, honest): per-call timeout, result-count cap, per-item size
 * cap (truncate + flag). Any failure → a single trust:'unavailable' result with a
 * plain reason, so 香香 says "目前讀不到" rather than guessing.
 */

const { makeUnavailable } = require('./contextResult')
const { readAccessEnabled } = require('./flags')

const DEFAULT_CAPS = Object.freeze({ timeoutMs: 10000, maxResults: 25, maxItemBytes: 20000 })

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
    try {
      out = await Promise.race([
        Promise.resolve().then(() => fn(params)),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${caps.timeoutMs}ms`)), caps.timeoutMs))
      ])
    } catch (e) {
      return makeUnavailable({ source, reason: `read failed: ${(e && e.message) || String(e)}`, retrievedAt: asOf })
    }

    const arr = Array.isArray(out) ? out : [out]
    const capped = arr.slice(0, caps.maxResults).map((r) => capItem(r, caps.maxItemBytes))
    return { asOf, source, count: capped.length, truncatedCount: Math.max(0, arr.length - caps.maxResults), results: capped }
  }

  return { register, read, sources, hasWriteMethod, caps }
}

module.exports = { createReadConnector, DEFAULT_CAPS, WRITE_RE }
