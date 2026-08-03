'use strict'

/**
 * aromaSystemRead.js — READ-ONLY adapter for the restaurant's own system.
 *
 * ── WHY THIS FILE IS SHAPED THE WAY IT IS ─────────────────────────────────
 * The other four sources are read-only because GOOGLE and GITHUB made them so: the OAuth
 * scopes are `*.readonly` and the PAT has no write permission, so even a bug cannot write.
 *
 * Aroma System is NOT like that, and the difference is the reason this file exists.
 * `/api/v1/ai` holds six GET routes and THREE POST draft routes, and `requireAiAuth`
 * (verified 2026-08-03) reads neither `req.method` nor `req.path` — `ai_api_keys` has no
 * scope column at all. One key opens all nine. **Read-only here is OUR guarantee, not
 * theirs**, so it has to be structural rather than a promise:
 *
 *   1. THE METHOD IS A CONSTANT. `method: 'GET'` is written once, at the single call site,
 *      and no function in this module takes a method parameter. There is no expression
 *      anywhere that could evaluate to 'POST'.
 *   2. THE PATHS ARE A FROZEN LITERAL LIST. A caller names an ENDPOINT KEY; the key is
 *      looked up in PATHS. Caller input is never concatenated into a path, so no argument
 *      can reach `/invoices/draft` however it is spelled.
 *   3. THE METHOD NAMES ARE READ-SHAPED. readConnector's WRITE_RE refuses a write-shaped
 *      name at registration AND again at call time, exactly as it does for the other four.
 *
 * Belt, braces, and a third thing: even if one layer were edited away, the other two still
 * make a POST unreachable.
 *
 * NOTHING SENSITIVE IS LOGGED. The key is read from the environment at construction, held
 * in a closure, and never returned, printed, or put in an error. Failures report a status
 * code and a short reason — never a response body, never a row.
 */

const { makeContextResult, makeUnavailable } = require('../contextResult')

const DEFAULT_BASE_URL = 'https://system.aromabistro741.com'
const KEY_ENV = 'AROMA_SYSTEM_KEY'
const DEFAULT_TIMEOUT_MS = 10000
const MAX_ITEMS = 25

/** THE HTTP METHOD. One constant, used once. Nothing here takes a method argument. */
const METHOD = 'GET'

/**
 * THE ONLY REACHABLE PATHS. Frozen, literal, complete.
 *
 * The three POST draft routes are deliberately absent — not commented out, not disabled by
 * a flag, ABSENT. A path that is not a value in this object cannot be requested by this
 * module, because the only thing that ever becomes a URL is `PATHS[key]`.
 */
const PATHS = Object.freeze({
  inventory: '/api/v1/ai/inventory',
  suppliers: '/api/v1/ai/suppliers',
  dailyCounts: '/api/v1/ai/daily-counts',
  orderPlanning: '/api/v1/ai/order-planning',
  purchaseOrders: '/api/v1/ai/purchase-orders',
  invoices: '/api/v1/ai/invoices'
})

/** The three states the Owner asked to see, verbatim. */
const READ_STATE = Object.freeze({
  FOUND: 'RESULTS_FOUND',
  NONE: 'NO_RELEVANT_RESULTS',
  failed: (reason) => 'READ_FAILED: ' + reason
})

/** Query keys a caller may set. Anything else is dropped rather than forwarded. */
const ALLOWED_QUERY = Object.freeze(['limit', 'q', 'from', 'to', 'status', 'supplierId'])

function isPlainObject (v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

/** A short, safe failure reason. Never a body, never a row, never the key. */
function reasonFor (status) {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'endpoint not found'
  if (status === 429) return 'rate limited'
  if (status >= 500) return 'server error ' + status
  return 'http ' + status
}

/** The first present value among several candidate field names, else null. */
function pick (row, names) {
  for (const n of names) {
    const v = row[n]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

/**
 * THE CANDIDATE FIELD NAMES, camelCase AND snake_case.
 *
 * The API is not consistent, and assuming it was cost a whole round: order planning
 * returns ingredient_id / ingredient_name while every other endpoint returns id / name,
 * so against the camelCase-only lists that used to live here EVERY order-planning row
 * mapped to no id, no title and no date. The model was handed four rows reading
 * "(untitled) (no date)" and reasonably reported that it could not read anything.
 *
 * Both spellings are listed explicitly rather than derived by transforming the key,
 * because a name is either a field this API returns or it is not — and a list can be
 * checked against a captured response, which a transformation cannot.
 */
const ID_FIELDS = Object.freeze([
  'id', 'ingredientId', 'ingredient_id', 'supplierId', 'supplier_id',
  'poId', 'po_id', 'invoiceId', 'invoice_id', 'submissionId', 'submission_id'
])
// ORDER IS MEANING. What NAMES the record comes first: a purchase order is known by its
// PO number, not by its supplier — that field is on the row too, and putting it earlier
// would title every PO with the counterparty instead. An identifier that is present but
// EMPTY (real invoice rows carry invoiceNumber: '') is skipped by pick(), so the next
// candidate answers and the row is still recognisable.
const TITLE_FIELDS = Object.freeze([
  'name', 'title', 'ingredientName', 'ingredient_name',
  'poNumber', 'po_number', 'invoiceNumber', 'invoice_number',
  'rawVendorName', 'raw_vendor_name', 'supplierName', 'supplier_name',
  'locationName', 'location_name'
])
// DATES ONLY — no dueDate/due_date. A due date is when something is EXPECTED, not when the
// record happened; citing it as the row's date would date the row to the future.
// ORDER IS MEANING here too. The BUSINESS date wins over the row's insert timestamp: an
// invoice dated the 28th that was scanned into the system on the 3rd is an invoice from
// the 28th, and citing the 3rd would date the Owner's own record to when we happened to
// read it. createdAt/updatedAt are the last resort, for rows that carry nothing better.
const DATE_FIELDS = Object.freeze([
  'date', 'invoiceDate', 'invoice_date', 'orderDate', 'order_date', 'orderedAt', 'ordered_at',
  'submittedAt', 'submitted_at', 'countedAt', 'counted_at',
  'createdAt', 'created_at', 'updatedAt', 'updated_at'
])

/**
 * One API row → one context result.
 *
 * SOURCE AND DATE COME FROM THE DATA. `originalDate` is only ever a field the API returned;
 * when the row carries no date the value is null and the citation says so. Nothing here
 * infers, defaults to "today", or lets a model supply a date.
 *
 * `index` exists only to keep ids DISTINCT. When a row carries no id field the sourceId
 * used to be the endpoint name — so all four rendered rows cited the same id, which reads
 * as one row repeated. The position is appended so two rows can never collide, and the
 * '#' marks it as a position within this response, not an identifier the API issued.
 */
function toResult (endpointKey, row, retrievedAt, index = 0) {
  const r = isPlainObject(row) ? row : {}
  const id = pick(r, ID_FIELDS)
  const title = pick(r, TITLE_FIELDS)
  const date = pick(r, DATE_FIELDS)

  // A compact, human-readable line — the row's own fields, never a re-description of them.
  const bits = []
  for (const [k, v] of Object.entries(r)) {
    if (v === null || v === undefined || v === '') continue
    if (typeof v === 'object') continue
    if (bits.length >= 8) break
    bits.push(k + '=' + String(v))
  }

  return makeContextResult({
    source: 'aroma_system',
    sourceId: id === null ? endpointKey + '#' + index : String(id),
    title: title === null ? null : String(title),
    originalDate: date === null ? null : String(date),
    content: bits.join(' · '),
    link: null, // the API returns no canonical URL; inventing one would be a fabricated citation
    retrievedAt
  })
}

/**
 * @param {{ env?, baseUrl?, apiKey?, fetchFn?, timeoutMs?, clock? }} options
 *   fetchFn is injected in tests so no test ever reaches the network.
 */
function createAromaSystemReadAdapter (options = {}) {
  const env = options.env || process.env
  const now = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  const baseUrl = String(options.baseUrl || env.AROMA_SYSTEM_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS

  // Held in the closure. Never returned by any method, never logged, never in an error.
  const apiKey = typeof options.apiKey === 'string' && options.apiKey
    ? options.apiKey
    : (typeof env[KEY_ENV] === 'string' ? env[KEY_ENV].trim() : '')

  const doFetch = typeof options.fetchFn === 'function' ? options.fetchFn : globalThis.fetch

  /**
   * THE SINGLE CALL SITE. Every read in this module goes through here, and here the method
   * is the constant METHOD. There is no parameter, no default and no branch that could
   * make it anything else.
   */
  async function request (endpointKey, params) {
    const retrievedAt = now()
    const path = PATHS[endpointKey]
    // Closed: an unknown key never becomes a URL.
    if (typeof path !== 'string') {
      return { readState: READ_STATE.failed('unknown endpoint'), results: [makeUnavailable({ source: 'aroma_system', reason: 'unknown endpoint', retrievedAt })] }
    }
    if (!apiKey) {
      return { readState: READ_STATE.failed('no api key configured'), results: [makeUnavailable({ source: 'aroma_system', reason: 'no api key configured', retrievedAt })] }
    }
    if (typeof doFetch !== 'function') {
      return { readState: READ_STATE.failed('no http client'), results: [makeUnavailable({ source: 'aroma_system', reason: 'no http client', retrievedAt })] }
    }

    // Query values are attached with URLSearchParams, which encodes them — so a value can
    // never break out and become part of the path.
    const url = new URL(baseUrl + path)
    if (isPlainObject(params)) {
      for (const k of ALLOWED_QUERY) {
        const v = params[k]
        if (v === undefined || v === null || v === '') continue
        if (typeof v === 'object') continue
        url.searchParams.set(k, String(v))
      }
    }

    let res
    try {
      res = await doFetch(url.toString(), {
        method: METHOD,
        headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (err) {
      // A timeout or a network error. The message may name the host but never the key.
      const reason = (err && err.name === 'TimeoutError') ? 'timeout' : 'network error'
      return { readState: READ_STATE.failed(reason), results: [makeUnavailable({ source: 'aroma_system', reason, retrievedAt })] }
    }

    if (!res || res.ok !== true) {
      const reason = reasonFor(res ? res.status : 0)
      return { readState: READ_STATE.failed(reason), results: [makeUnavailable({ source: 'aroma_system', reason, retrievedAt })] }
    }

    let body
    try { body = await res.json() } catch (_) {
      return { readState: READ_STATE.failed('bad json'), results: [makeUnavailable({ source: 'aroma_system', reason: 'bad json', retrievedAt })] }
    }

    const rows = Array.isArray(body) ? body
      : (Array.isArray(body && body.data) ? body.data
          : (Array.isArray(body && body.items) ? body.items : []))

    // READ OK WITH NOTHING IN IT IS NOT A FAILURE. The two are different answers and are
    // never merged — the same distinction the whole read layer is built around.
    if (rows.length === 0) return { readState: READ_STATE.NONE, results: [] }

    return {
      readState: READ_STATE.FOUND,
      results: rows.slice(0, MAX_ITEMS).map((row, i) => toResult(endpointKey, row, retrievedAt, i))
    }
  }

  /**
   * The public methods. Every name is read-shaped, so readConnector's WRITE_RE accepts them
   * at registration and re-checks them at call time. Each takes only query options — none
   * takes a path, a URL or a method.
   */
  const methods = {
    async listInventory (opts = {}) { return (await request('inventory', opts)).results },
    async listSuppliers (opts = {}) { return (await request('suppliers', opts)).results },
    async listDailyCounts (opts = {}) { return (await request('dailyCounts', opts)).results },
    async listOrderPlanning (opts = {}) { return (await request('orderPlanning', opts)).results },
    async listPurchaseOrders (opts = {}) { return (await request('purchaseOrders', opts)).results },
    async listInvoices (opts = {}) { return (await request('invoices', opts)).results }
  }

  return {
    source: 'aroma_system',
    methods,
    ready: () => apiKey !== '',
    // Exposed for the three-state contract and for tests. It performs a read; it cannot
    // perform anything else, because it is the same closed `request`.
    readWithState: (endpointKey, opts) => request(endpointKey, opts)
  }
}

module.exports = {
  createAromaSystemReadAdapter,
  PATHS,
  READ_STATE,
  ALLOWED_QUERY,
  METHOD,
  KEY_ENV,
  DEFAULT_BASE_URL,
  MAX_ITEMS,
  ID_FIELDS,
  TITLE_FIELDS,
  DATE_FIELDS
}
