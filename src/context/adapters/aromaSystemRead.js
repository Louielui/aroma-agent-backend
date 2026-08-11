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

const { makeContextResult, makeUnavailable, ENTITY_TYPES } = require('../contextResult')

/**
 * WHAT EACH ENDPOINT ACTUALLY RETURNS, and what its numbers MEAN.
 *
 * Measured against the live API on 2026-08-03, because the difference decides whether an
 * answer is true. `/ai/inventory` returns 199 rows carrying `currentStock` and `parLevel`
 * — real quantities — but NO location field and NO as-of timestamp of any kind. So it is
 * neither a bare item list nor a stock count: it is a per-item recorded quantity with no
 * place and no time attached. Rendering four of those rows as 「確認到 4 項存貨」 was two
 * false claims at once (a sample presented as the whole, and an untimed unplaced number
 * presented as stock on hand).
 *
 * These descriptors travel WITH the rows so the layer that composes the answer cannot
 * mistake one kind of record for another, and cannot quietly acquire a dimension the
 * data does not have. Location and as-of DO exist — on /ai/daily-counts, 11 locations
 * with submittedAt — which is why the honest answer offers that view instead.
 */
const ENTITY_OF = Object.freeze({
  inventory: ENTITY_TYPES.INVENTORY_ITEM,
  suppliers: ENTITY_TYPES.SUPPLIER,
  dailyCounts: ENTITY_TYPES.DAILY_COUNT,
  orderPlanning: ENTITY_TYPES.ORDER_SUGGESTION,
  purchaseOrders: ENTITY_TYPES.PURCHASE_ORDER,
  invoices: ENTITY_TYPES.INVOICE
})

/**
 * ── rowShape — THE SHAPE OF ONE ROW. Renamed from SCOPE_OF, A1. ──────────────
 *
 * > **Owner: 「rowShape = dimensions/shape of each row. queryScope = which rows were selected.
 * > Never reuse the word `scope` for both meanings.」**
 *
 * These are two different facts and they had one word. This table says what a row DOES NOT
 * carry; `QUERY_SCOPE` below says which rows came back. The word 「scope」 no longer appears
 * on the descriptor at all, so neither can be read as the other.
 */
const ROW_SHAPE = Object.freeze({
  inventory: { hasLocation: false, hasAsOf: false, note: '每項有一個存量數字,但冇分地點、亦冇記錄係幾時嘅' },
  suppliers: { hasLocation: false, hasAsOf: false, note: null },
  dailyCounts: { hasLocation: true, hasAsOf: true, note: null },
  orderPlanning: { hasLocation: false, hasAsOf: false, note: null },
  purchaseOrders: { hasLocation: false, hasAsOf: true, note: null },
  invoices: { hasLocation: false, hasAsOf: true, note: null }
})

/**
 * ── queryScope — WHICH ROWS THE SERVER SELECTED. ⛔ THIS IS TECHNICAL DEBT. ───
 *
 * > **Owner: 「Query scope that is currently inferred from audited server source must carry
 * > declaredBy: 'reader'. It is technical debt, not server truth.」**
 *
 * Every window here was read out of `aroma-system/server/routes/aiIntegration.ts` on
 * 2026-08-08. The server does not declare any of it in its responses, so this table is the
 * READER asserting a property of a system it does not control — the M-8 shape, on record as
 * such. It is silently wrong the day the server changes, which is why `declaredBy` is carried
 * on every descriptor rather than assumed by the consumer.
 *
 * `declaredBy: 'server'` is the target state (REPORT-A §4 item 2). `'reader'` is the debt.
 *
 * ⚠ NOTE WHICH DATE. invoices and purchase-orders filter on `createdAt` — the row's INSERT
 * timestamp — not the business date. See DEFECT-009.
 */
const QUERY_SCOPE = Object.freeze({
  inventory: { field: null, window: null, declaredBy: 'reader' },
  suppliers: { field: null, window: null, declaredBy: 'reader' },
  dailyCounts: { field: 'submittedAt', window: 'last_7_days', declaredBy: 'reader' },
  orderPlanning: { field: null, window: null, declaredBy: 'reader' },
  purchaseOrders: { field: 'createdAt', window: 'last_30_days', declaredBy: 'reader' },
  invoices: { field: 'createdAt', window: 'last_30_days', declaredBy: 'reader' }
})

/**
 * ⛔ `null` HERE MEANS 「AUDITED: NO CAP EXISTS」, NOT 「we do not know」. The two are different
 * facts and the difference decides whether truncation is establishable at all, so the state
 * is carried explicitly in `limitKnown` on every descriptor. (Owner review, correction 4.)
 *
 * ⛔ AND orderPlanning IS 100, NOT UNBOUNDED. The first A1 cut declared it uncapped because
 * the audit grepped for drizzle's `.limit(` — and order-planning uses RAW SQL, `LIMIT 100`
 * inside a template literal, twice. Searching for one spelling of a thing, which is the same
 * defect as 「訂貨」 not matching 「訂什麼貨」 (HR-56). Re-audited with both spellings.
 */
const SERVER_LIMITS = Object.freeze({
  inventory: null, //        audited unbounded
  suppliers: null, //        audited unbounded
  dailyCounts: 50, //        .limit(50)
  orderPlanning: 100, //     raw SQL `LIMIT 100` ×2
  purchaseOrders: 100, //    .limit(100)
  invoices: 100 //           .limit(100)
})

/** Every endpoint here was audited, so the cap state is KNOWN even when the cap is absent. */
const LIMIT_KNOWN = Object.freeze(Object.keys(SERVER_LIMITS).reduce((a, k) => { a[k] = true; return a }, {}))

/**
 * ── TRUNCATION, AND THE ONE CASE THAT MUST STAY UNKNOWN ──────────────────────
 *
 * > **Owner: 「If returnedRows === limit: truncated = null. Do not claim false when truncation
 * > cannot be established.」**
 *
 * A result sitting exactly on its cap is indistinguishable from one the cap cut off. That is
 * not a theoretical case: `/daily-counts` has `.limit(50)` and returned exactly 50 rows on
 * 2026-08-08.
 */
function truncationOf (returnedRows, limit, limitKnown) {
  if (limitKnown !== true) return null //          the cap state itself is unknown
  if (!Number.isFinite(limit)) return false //     AUDITED UNBOUNDED — nothing could cut it
  if (returnedRows < limit) return false //        came in under the cap
  return null //                                   === limit: unknowable from the response alone
}

/**
 * ⛔ A CAPPED COUNT IS NOT A POPULATION. (Owner review, correction 1.)
 *
 * `body.count` is `data.length` AFTER the server's LIMIT, so on a capped response it is the
 * size of the PAGE. The first A1 cut set `matchingTotal = body.count` universally, which
 * rebuilt the original defect one level in: a page count wearing a population's clothes.
 *
 * It is the matching total ONLY when truncation was positively ruled out.
 */
function matchingTotalOf (bodyCount, truncated) {
  if (truncated !== false) return null
  return Number.isFinite(bodyCount) ? bodyCount : null
}

/**
 * ⛔ FAILS CLOSED. Complete-within-scope is TRUE only when truncation was positively ruled
 * out. Unknown truncation yields unknown completeness — never `true`, and never `false`,
 * because 「we could not tell」 is a third state and flattening it is the defect this whole
 * change exists to remove.
 */
function completeWithinScopeOf (truncated) {
  if (truncated === false) return true
  if (truncated === true) return false
  return null
}

/**
 * ── DECLARED DERIVATIONS (Owner ruling, 2026-08-05) ─────────────────────────
 *
 * 缺口 = 安全存量 − 現有存量 was being DROPPED, correctly by the old rule and wrongly by
 * intent: refusing it made her list rows instead of reading them. The ruling allows
 * derivations on the same terms metric values already work — SHE NAMES IT, THE SERVER
 * COMPUTES IT — so a wrong subtraction is impossible rather than merely detectable.
 *
 * ONLY WHAT IS DECLARED HERE. Two declared metrics, same row, subtraction. A derivation
 * that is not in this table stays dropped, so she cannot invent arithmetic and have it
 * rendered as fact.
 */
/**
 * ── OWNER-FACING NAMES FOR COLUMNS THAT ARE NOT METRICS ────────────────────
 *
 * The invoice record carries `source`, and for the one live invoice it reads "drive" —
 * meaning the DOCUMENT arrived via Drive. She rendered it faithfully as 「來源 drive」, which
 * on a page where every section heading is a connector name reads as though the Drive
 * connector had been queried. It had not: the route read aroma_system alone. The collision
 * was between the row's own column name and my display vocabulary, not her doing.
 *
 * `values` is a label table on the same terms as UNIT_LABELS and STATUS_LABELS: measured
 * from live data, and a code with no entry renders as ITSELF rather than being guessed.
 * Only "drive" has been observed — there is one invoice in the system — so the table
 * declares what was measured and nothing more.
 */
const FIELD_LABELS_OF = Object.freeze({
  // ALIASES are declared, not inferred. She writes 來源 — the natural Chinese for the
  // column name — which is neither the raw column nor the Owner-facing label, so without
  // this the normalisation never fires and the collision stays.
  invoices: { source: { label: '文件來源', aliases: ['來源', 'source'], values: Object.freeze({ drive: 'Drive 上載' }) } }
})

const DERIVATIONS_OF = Object.freeze({
  inventory: { '缺口': { minus: ['parLevel', 'currentStock'] } },
  orderPlanning: { '缺口': { minus: ['par_level', 'live_qty'] } }
})

/** What a numeric field MEANS, in the Owner's words. Only fields that carry meaning. */
const METRICS_OF = Object.freeze({
  inventory: {
    currentStock: { label: '現有存量', meaning: '記錄存量,無地點、無時間戳' },
    parLevel: { label: '安全存量', meaning: '應該保持嘅水平' }
  },
  orderPlanning: {
    live_qty: { label: '現有', meaning: '記錄存量' },
    par_level: { label: '安全存量', meaning: '應該保持嘅水平' },
    suggested_order_qty: { label: '建議訂量', meaning: '系統計出嘅補貨量' }
  },
  invoices: { total: { label: '總額', meaning: '發票總額' } },
  purchaseOrders: { itemCount: { label: '項目數', meaning: '單內項目數量' } },
  dailyCounts: { itemCount: { label: '點咗幾多項', meaning: '該次盤點嘅項目數' } },
  suppliers: {}
})

/**
 * RANKING SIGNAL, or none. Inventory can be ranked by how far below par a thing is —
 * that is what makes a row worth showing. Suppliers and invoices have no such signal, and
 * saying so is better than presenting whichever four rows the API happened to return
 * first, which is exactly what used to happen.
 */
const RANKING_OF = Object.freeze({
  inventory: { by: 'parLevel - currentStock desc', fn: (r) => Number(r.parLevel || 0) - Number(r.currentStock || 0) },
  orderPlanning: { by: 'suggested_order_qty desc', fn: (r) => Number(r.suggested_order_qty || 0) },
  suppliers: null,
  invoices: null,
  purchaseOrders: null,
  dailyCounts: null
})

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

  // THE ROW'S OWN SCALAR VALUES, unflattened. `content` stays for the prompt block and
  // for citations; `fields` is what a renderer reads when it needs a quantity rather than
  // a sentence about one.
  const fields = {}
  for (const [k, v] of Object.entries(r)) {
    if (v === null || v === undefined || v === '') continue
    if (typeof v === 'object') continue
    fields[k] = v
  }

  return makeContextResult({
    source: 'aroma_system',
    sourceId: id === null ? endpointKey + '#' + index : String(id),
    title: title === null ? null : String(title),
    originalDate: date === null ? null : String(date),
    content: bits.join(' · '),
    link: null, // the API returns no canonical URL; inventing one would be a fabricated citation
    retrievedAt,
    entityType: ENTITY_OF[endpointKey] || null,
    fields
  })
}

/**
 * @param {{ env?, baseUrl?, apiKey?, fetchFn?, timeoutMs?, clock? }} options
 *   fetchFn is injected in tests so no test ever reaches the network.
 */
/**
 * The EvidenceSet descriptor for one read: what kind of thing, how many exist, how many
 * are here, whether that is a sample, what the numbers mean, and how they were ordered.
 * Everything a composer needs in order NOT to over-claim.
 */
function describe (endpointKey, retrievedAt, bodyCount, shownCount, isSample, opts = {}) {
  const rank = RANKING_OF[endpointKey]
  const known = LIMIT_KNOWN[endpointKey] === true
  const limit = known ? SERVER_LIMITS[endpointKey] : null
  const returnedRows = Number.isFinite(opts.returnedRows) ? opts.returnedRows : shownCount
  const truncated = truncationOf(returnedRows, limit, known)
  const matchingTotal = matchingTotalOf(bodyCount, truncated)
  return {
    source: 'aroma_system',
    entityType: ENTITY_OF[endpointKey] || null,
    endpoint: endpointKey,

    // ── HOW MANY, AND OF WHAT ────────────────────────────────────────────────
    returnedRows, //   what the SERVER sent
    shownCount, //     what survived the client MAX_ITEMS cap
    // Promoted from the raw response count ONLY when truncation was ruled out — see
    // matchingTotalOf(). null means 「we cannot say how many matched」.
    matchingTotal,
    // ⛔ NULL UNLESS THE SERVER SAYS SO. It never has. Substituting matchingTotal here is the
    // defect that printed 「1 records exist」 for a table holding ~471 (DEFECT-009).
    sourceTotal: Number.isFinite(opts.sourceTotal) ? opts.sourceTotal : null,

    // ── WHICH ROWS, AND WHETHER WE GOT THEM ALL ──────────────────────────────
    queryScope: QUERY_SCOPE[endpointKey] || { field: null, window: null, declaredBy: 'reader' },
    // ⛔ NULL, NOT []. (Owner review, correction 3.) An empty array asserts 「known to have
    // NO filters」 — but the server applies predicates the reader cannot authoritatively
    // enumerate: the 30-day windows, and order-planning's own WHERE clauses. Unknown.
    filtersApplied: null,
    limit,
    limitKnown: known,
    truncated,
    completeWithinScope: completeWithinScopeOf(truncated),

    // ── THE SHAPE OF A ROW (renamed from `scope`) ────────────────────────────
    rowShape: ROW_SHAPE[endpointKey] || { hasLocation: false, hasAsOf: false, note: null },
    metrics: METRICS_OF[endpointKey] || {},
    derivations: DERIVATIONS_OF[endpointKey] || {},
    fieldLabels: FIELD_LABELS_OF[endpointKey] || {},

    // `completeness` keeps its ORIGINAL meaning and is about the CLIENT cap only. It is not
    // a synonym for completeWithinScope and the two answer different questions.
    completeness: isSample ? 'sample' : 'complete',
    rankedBy: rank ? rank.by : null,

    // ⛔ NOT retrievedAt. When we read is not how current the data is, and nothing in the
    // response says the latter.
    dataAsOf: typeof opts.dataAsOf === 'string' && opts.dataAsOf ? opts.dataAsOf : null,
    retrievedAt,
    trust: 'live',
    provenance: 'Aroma System ' + PATHS[endpointKey]
  }
}

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

    // ⛔ A RESPONSE COUNT. NOTHING MORE, AND THE NAME MUST NOT SAY MORE.
    //
    // The comment here first read 「THE REAL TOTAL, from the API's own header」 — false, because
    // on the capped endpoints `count` is `data.length` AFTER the LIMIT. It was then renamed
    // `matchingTotal` and called 「correctly named」 — ALSO false, for the same reason one layer
    // up: it is only a matching total once truncation has been ruled out.
    //
    // It stays semantically neutral here. `matchingTotalOf()` is the only thing allowed to
    // promote it, and only when `truncated === false`. A local carrying the wrong name is how
    // the wrong meaning reaches the next reader.
    const responseCount = Number.isFinite(body && body.count) ? body.count : rows.length
    // The server has never sent either of these. Read them anyway, so the day it does the
    // reader is already honest — and they stay null rather than being inferred (A1 rule 3).
    const extra = {
      returnedRows: rows.length,
      sourceTotal: Number.isFinite(body && body.sourceTotal) ? body.sourceTotal : null,
      dataAsOf: (body && typeof body.dataAsOf === 'string' && body.dataAsOf) ? body.dataAsOf : null
    }

    // READ OK WITH NOTHING IN IT IS NOT A FAILURE. The two are different answers and are
    // never merged — the same distinction the whole read layer is built around.
    if (rows.length === 0) {
      return { readState: READ_STATE.NONE, results: [], evidence: describe(endpointKey, retrievedAt, 0, 0, false, extra) }
    }

    // RANKED WHERE A SIGNAL EXISTS. The API ignores `limit`, so the whole table arrives
    // and something must choose. Sorting by the largest shortfall puts the rows worth
    // acting on first; where no signal exists the order is left alone AND declared, so
    // the answer can say it is an arbitrary sample rather than implying it is a top-N.
    const rank = RANKING_OF[endpointKey]
    const ordered = rank ? [...rows].sort((a, b) => rank.fn(b) - rank.fn(a)) : rows
    const kept = ordered.slice(0, MAX_ITEMS)

    return {
      readState: READ_STATE.FOUND,
      results: kept.map((row, i) => toResult(endpointKey, row, retrievedAt, i)),
      evidence: describe(endpointKey, retrievedAt, responseCount, kept.length, responseCount > kept.length, extra)
    }
  }

  /**
   * The public methods. Every name is read-shaped, so readConnector's WRITE_RE accepts them
   * at registration and re-checks them at call time. Each takes only query options — none
   * takes a path, a URL or a method.
   */
  // Each returns `{ results, evidence }` — the rows plus what they are, how many exist and
  // how they were ordered. readConnector understands both this and a bare array.
  const enveloped = async (key, opts) => {
    const r = await request(key, opts)
    return { results: r.results, evidence: r.evidence || null }
  }
  const methods = {
    async listInventory (opts = {}) { return enveloped('inventory', opts) },
    async listSuppliers (opts = {}) { return enveloped('suppliers', opts) },
    async listDailyCounts (opts = {}) { return enveloped('dailyCounts', opts) },
    async listOrderPlanning (opts = {}) { return enveloped('orderPlanning', opts) },
    async listPurchaseOrders (opts = {}) { return enveloped('purchaseOrders', opts) },
    async listInvoices (opts = {}) { return enveloped('invoices', opts) }
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
  DERIVATIONS_OF,
  // ⛔ Exported for the goal decomposer's catalogue, READ-ONLY. These tables stay the single
  // declaration of what each endpoint carries and what its numbers mean; a consumer that
  // re-describes them would be a second vocabulary (HR-58).
  METRICS_OF,
  ENTITY_OF,
  FIELD_LABELS_OF,
  ROW_SHAPE,
  QUERY_SCOPE,
  SERVER_LIMITS,
  truncationOf,
  matchingTotalOf,
  completeWithinScopeOf,
  LIMIT_KNOWN,
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
