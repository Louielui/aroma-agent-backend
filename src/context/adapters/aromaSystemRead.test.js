'use strict'

/**
 * aromaSystemRead.test.js — read-only is OUR guarantee here, so it has to be proven.
 *
 * The other four sources are read-only because Google and GitHub made them so: the scopes
 * are `*.readonly`. Aroma System is not like that. `/api/v1/ai` has six GET routes and
 * THREE POST draft routes, and `requireAiAuth` reads neither req.method nor req.path —
 * `ai_api_keys` has no scope column. One key opens all nine.
 *
 * So these tests are not about "does it fetch". They are about whether a POST is reachable
 * at all, by any input, through any method on this adapter.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  createAromaSystemReadAdapter, PATHS, READ_STATE, METHOD, KEY_ENV, MAX_ITEMS
} = require('./aromaSystemRead')
const { WRITE_RE, createReadConnector } = require('../readConnector')

const KEY = 'aroma_ai_TESTKEY_MUST_NEVER_APPEAR'
const NOW = '2026-08-03T12:00:00.000Z'

/** Records every request so the test can assert on method and URL. */
function spyFetch (respond) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url: String(url), method: init && init.method, headers: (init && init.headers) || {} })
    return respond(String(url), init)
  }
  fn.calls = calls
  return fn
}

const jsonOk = (body) => async () => ({ ok: true, status: 200, json: async () => body })
const httpErr = (status) => async () => ({ ok: false, status, json: async () => ({}) })

function adapter (fetchFn, over) {
  return createAromaSystemReadAdapter(Object.assign({
    env: { [KEY_ENV]: KEY },
    fetchFn,
    clock: () => NOW
  }, over || {}))
}

/* ── 1. THE HARD WALL — a POST must be unreachable ────────────────────────── */

test('*** every request is a GET, and the method is a constant ***', async () => {
  const f = spyFetch(jsonOk([{ id: 1, name: 'x' }]))
  const a = adapter(f)
  for (const m of Object.keys(a.methods)) await a.methods[m]({})

  assert.equal(f.calls.length, 6, 'all six were exercised')
  for (const c of f.calls) assert.equal(c.method, 'GET', c.url + ' must be GET')
  assert.equal(METHOD, 'GET')
})

test('*** CONTROL — the three POST draft routes are unreachable by ANY input ***', async () => {
  const f = spyFetch(jsonOk([]))
  const a = adapter(f)

  // Every hostile shape the caller controls: the endpoint key, and every query value.
  const attacks = [
    'invoices/draft', '/api/v1/ai/invoices/draft', '../invoices/draft', 'invoicesDraft',
    'purchaseOrders/draft', 'prepTasks/draft', '__proto__', 'constructor'
  ]
  for (const key of attacks) {
    const out = await a.readWithState(key, {})
    assert.match(out.readState, /^READ_FAILED: unknown endpoint$/, key + ' must be refused')
  }

  // …and through the public methods, with the query bag stuffed with paths.
  for (const m of Object.keys(a.methods)) {
    await a.methods[m]({ limit: '../../invoices/draft', q: '/api/v1/ai/prep-tasks/draft', path: '/invoices/draft', url: 'http://evil/x', method: 'POST' })
  }

  // THE PROPERTY IS ABOUT THE PATH, not about the whole URL string. A hostile value in a
  // query parameter is URL-encoded and stays a search term — harmless. What must be true
  // is that the PATHNAME is always one of the six, and the verb is always GET.
  const allowed = new Set(Object.values(PATHS))
  for (const c of f.calls) {
    const p = new URL(c.url).pathname
    assert.equal(allowed.has(p), true, 'pathname escaped the allowlist: ' + p)
    assert.equal(/draft/.test(p), false, 'no draft route is ever the path')
    assert.equal(c.method, 'GET', 'and a method parameter cannot change the verb')
  }
})

test('*** the module contains no non-GET verb and takes no method parameter ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'aromaSystemRead.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(code.includes("'" + verb + "'"), false, verb + ' must not appear as a value')
  }
  assert.equal(/method\s*[:=]\s*(?!'GET')(opts|params|method|input|o)\b/.test(code), false,
    'the method is never taken from an argument')
  assert.equal((code.match(/method: METHOD/g) || []).length, 1, 'exactly one call site sets the method')

  // The draft paths are absent from the CODE — not commented out, absent as values.
  // HR-4: scanned against `code`, not `src`. The first version checked the raw file and
  // tripped on this module's own comment explaining that a draft route is unreachable —
  // the guard reading prose as behaviour, for the fourth time in this codebase.
  assert.equal(code.includes('/invoices/draft'), false)
  assert.equal(code.includes('/purchase-orders/draft'), false)
  assert.equal(code.includes('/prep-tasks/draft'), false)
  assert.ok(src.includes('/invoices/draft'), 'the comment really does mention it — that is fine, and is why we scan code')
})

test('*** the path allowlist is exactly the six GETs ***', () => {
  assert.deepEqual(Object.values(PATHS).sort(), [
    '/api/v1/ai/daily-counts', '/api/v1/ai/inventory', '/api/v1/ai/invoices',
    '/api/v1/ai/order-planning', '/api/v1/ai/purchase-orders', '/api/v1/ai/suppliers'
  ])
  assert.equal(Object.isFrozen(PATHS), true, 'and it cannot be extended at runtime')
})

test('*** WRITE_RE accepts these names, and would refuse a write-shaped one ***', () => {
  const a = adapter(spyFetch(jsonOk([])))
  for (const name of Object.keys(a.methods)) {
    assert.equal(WRITE_RE.test(name), false, name + ' is read-shaped')
  }
  // The registration guard is real, not decorative.
  const c = createReadConnector({ env: { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on' } })
  assert.doesNotThrow(() => c.register(a))
  assert.throws(() => c.register({ source: 'aroma_system', methods: { createInvoiceDraft: async () => ({}) } }),
    /refuses write-shaped method/)
  assert.equal(c.hasWriteMethod(), false)
})

/* ── 2. the three result states, verbatim ─────────────────────────────────── */

test('*** rows -> RESULTS_FOUND ***', async () => {
  const a = adapter(spyFetch(jsonOk([{ id: 7, name: 'Cooking oil', updatedAt: '2026-08-01' }])))
  const out = await a.readWithState('inventory', {})
  assert.equal(out.readState, 'RESULTS_FOUND')
  assert.equal(out.results.length, 1)
  assert.equal(out.results[0].trust, 'live')
})

test('*** empty -> NO_RELEVANT_RESULTS, and that is NOT a failure ***', async () => {
  for (const body of [[], { data: [] }, { items: [] }]) {
    const out = await adapter(spyFetch(jsonOk(body))).readWithState('suppliers', {})
    assert.equal(out.readState, 'NO_RELEVANT_RESULTS', JSON.stringify(body))
    assert.deepEqual(out.results, [], 'no unavailable row is invented for an empty read')
  }
})

test('*** 401 -> READ_FAILED: unauthorized, NEVER "no results" ***', async () => {
  const out = await adapter(spyFetch(httpErr(401))).readWithState('inventory', {})
  assert.equal(out.readState, 'READ_FAILED: unauthorized')
  assert.notEqual(out.readState, READ_STATE.NONE, 'a rejected key must never read as an empty shop')
  assert.equal(out.results[0].trust, 'unavailable')
  assert.equal(out.results[0].error, 'unauthorized')
})

test('*** every other failure is READ_FAILED with a short reason ***', async () => {
  const cases = [[403, 'unauthorized'], [404, 'endpoint not found'], [429, 'rate limited'], [500, 'server error 500'], [418, 'http 418']]
  for (const [status, reason] of cases) {
    const out = await adapter(spyFetch(httpErr(status))).readWithState('invoices', {})
    assert.equal(out.readState, 'READ_FAILED: ' + reason, String(status))
  }
})

test('*** a timeout and a network error are READ_FAILED, never a throw ***', async () => {
  const timeout = async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e }
  assert.equal((await adapter(timeout).readWithState('inventory', {})).readState, 'READ_FAILED: timeout')
  const boom = async () => { throw new Error('ECONNREFUSED') }
  assert.equal((await adapter(boom).readWithState('inventory', {})).readState, 'READ_FAILED: network error')
})

test('*** every request carries a timeout signal ***', async () => {
  const src = fs.readFileSync(path.join(__dirname, 'aromaSystemRead.js'), 'utf8')
  assert.match(src, /signal: AbortSignal\.timeout\(timeoutMs\)/, 'no request may hang forever')
})

/* ── 3. source and date come from the DATA ────────────────────────────────── */

test('*** the date is a field the API returned, or null — never inferred ***', async () => {
  const withDate = await adapter(spyFetch(jsonOk([{ id: 1, name: 'X', invoiceDate: '2026-07-30' }]))).readWithState('invoices', {})
  assert.equal(withDate.results[0].originalDate, '2026-07-30')

  const noDate = await adapter(spyFetch(jsonOk([{ id: 2, name: 'Y' }]))).readWithState('suppliers', {})
  assert.equal(noDate.results[0].originalDate, null, 'absent stays absent — no "today", no guess')
  assert.equal(noDate.results[0].source, 'aroma_system')
  assert.equal(noDate.results[0].retrievedAt, NOW, 'and the read time is recorded separately')
})

test('*** no link is invented ***', async () => {
  const out = await adapter(spyFetch(jsonOk([{ id: 1 }]))).readWithState('inventory', {})
  assert.equal(out.results[0].link, null, 'the API returns no canonical URL; a made-up one is a fake citation')
})

test('*** the row count is bounded ***', async () => {
  const many = Array.from({ length: MAX_ITEMS + 40 }, (_, i) => ({ id: i }))
  const out = await adapter(spyFetch(jsonOk(many))).readWithState('inventory', {})
  assert.equal(out.results.length, MAX_ITEMS)
})

/* ── 4. the key never leaks ───────────────────────────────────────────────── */

test('*** the key appears in the Authorization header and NOWHERE else ***', async () => {
  const f = spyFetch(httpErr(401))
  const a = adapter(f)
  const out = await a.readWithState('inventory', { q: 'x' })

  assert.equal(f.calls[0].headers.Authorization, 'Bearer ' + KEY, 'it is sent, once')
  assert.equal(f.calls[0].url.includes(KEY), false, 'never in the URL')
  assert.equal(JSON.stringify(out).includes(KEY), false, 'never in a result or an error')
  assert.equal(JSON.stringify(a.methods).includes(KEY), false)
  assert.equal(a.apiKey, undefined, 'and it is not exposed as a property')
})

test('*** the module never logs, and never returns a body or a row wholesale ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'aromaSystemRead.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal(/console\./.test(code), false, 'it never logs')
  // A failure reason is a short fixed string; the response body is never in it.
  assert.equal(/reason:\s*(body|text|json|await)/.test(code), false)
})

/* ── 5. no key, no registration, no throw ─────────────────────────────────── */

test('*** with no key the adapter is not ready and refuses cleanly ***', async () => {
  const a = createAromaSystemReadAdapter({ env: {}, fetchFn: spyFetch(jsonOk([])), clock: () => NOW })
  assert.equal(a.ready(), false)
  const out = await a.readWithState('inventory', {})
  assert.equal(out.readState, 'READ_FAILED: no api key configured')
  assert.equal(out.results[0].trust, 'unavailable')
})

test('*** no new dependency was introduced ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'aromaSystemRead.js'), 'utf8')
  const requires = [...src.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
  assert.deepEqual(requires, ['../contextResult'], 'built-in fetch only — nothing added to package.json')
})

/* ── 5. FIELD MAPPING — measured against real captured shapes ──────────────── */
// Every row shape below was captured from the live API on 2026-08-03 (field NAMES only).
// The camelCase-only lists that used to live here mapped EVERY order-planning row to no
// id, no title and no date, so the model was handed "(untitled) (no date)" four times.

const SHAPES = {
  inventory: { id: 1, name: 'x', unit: 'kg', currentStock: 2, parLevel: 3, isPurchasable: 1, lifecycleStatus: 'active', category: 'c', subCategory: 's' },
  suppliers: { id: 2, name: 'y', status: 'active', deliveryDays: 'Mon', orderLeadDays: 1, cutoffTime: '10:00', minimumOrderValue: 0, preferredOrderMethod: 'email', email: 'a@b.c', phone: '1' },
  dailyCounts: { id: 3, submittedAt: '2026-08-01T00:00:00Z', locationCode: 'L1', locationName: 'Kitchen', itemCount: 5, dueDate: '2026-08-09', items: [] },
  orderPlanning: { ingredient_id: 4, ingredient_name: 'z', unit: 'kg', par_level: 1, live_qty: 0, incoming_qty: 0, projected_qty: 0, suggested_order_qty: 1, supplier_id: 7, supplier_name: 'S', delivery_days: 'Tue', order_lead_days: 2, supplier_product_name: 'P', purchase_unit: 'case', pack_size: '6', latest_price: '1.00' },
  purchaseOrders: { id: 5, poNumber: 'PO-1', supplierId: 7, supplierName: 'S', status: 'sent', orderDate: '2026-07-30', itemCount: 2, source: 'app', createdAt: '2026-07-30T00:00:00Z', items: [] },
  invoices: { id: 6, status: 'approved', rawVendorName: 'V', supplierId: 7, invoiceNumber: '', invoiceDate: '2026-07-28', subtotal: '1', tax: '0', total: '1', currency: 'CAD', source: 'drive', createdAt: '2026-07-28T00:00:00Z', lineItems: [] }
}

test('every captured shape maps to a usable id — snake_case included', async () => {
  for (const [key, row] of Object.entries(SHAPES)) {
    const a = adapter(jsonOk({ success: true, count: 1, data: [row] }))
    const [r] = await a.readWithState(key).then((x) => x.results)
    assert.ok(r.sourceId, `${key}: id must not be empty`)
    assert.equal(r.sourceId.includes('#'), false, `${key}: a real id field exists, so no position marker`)
  }
})

test('order planning maps snake_case to id and title — the captured defect', async () => {
  const a = adapter(jsonOk({ success: true, count: 1, data: [SHAPES.orderPlanning] }))
  const [r] = await a.readWithState('orderPlanning').then((x) => x.results)
  assert.equal(r.sourceId, '4') // ingredient_id
  assert.equal(r.title, 'z') // ingredient_name
  assert.equal(r.originalDate, null) // this endpoint carries no date — and none is invented
})

test('titles and dates come from the row, and a missing date stays missing', async () => {
  const expect = {
    inventory: { title: 'x', date: null },
    suppliers: { title: 'y', date: null },
    dailyCounts: { title: 'Kitchen', date: '2026-08-01T00:00:00Z' },
    orderPlanning: { title: 'z', date: null },
    purchaseOrders: { title: 'PO-1', date: '2026-07-30' },
    invoices: { title: 'V', date: '2026-07-28' } // invoiceNumber is empty on real rows
  }
  for (const [key, want] of Object.entries(expect)) {
    const a = adapter(jsonOk({ success: true, count: 1, data: [SHAPES[key]] }))
    const [r] = await a.readWithState(key).then((x) => x.results)
    assert.equal(r.title, want.title, `${key}: title`)
    assert.equal(r.originalDate, want.date, `${key}: date`)
  }
})

test('a due date is never used as the row date', async () => {
  const a = adapter(jsonOk({ success: true, count: 1, data: [{ dueDate: '2027-01-01', due_date: '2027-01-01' }] }))
  const [r] = await a.readWithState('dailyCounts').then((x) => x.results)
  assert.equal(r.originalDate, null) // a future expectation is not when this happened
})

test('*** no two rows may share an id ***', async () => {
  // Rows with no id field at all — the case that used to reuse the endpoint name.
  const rows = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]
  const a = adapter(jsonOk({ success: true, count: rows.length, data: rows }))
  const res = await a.readWithState('orderPlanning').then((x) => x.results)
  const ids = res.map((r) => r.sourceId)
  assert.equal(new Set(ids).size, ids.length, 'ids must be distinct')
  assert.equal(ids.includes('orderPlanning'), false, 'the bare endpoint name is not an id')
  // and real ids are still preferred over positions
  const b = adapter(jsonOk({ success: true, count: 2, data: [{ id: 'A' }, { ingredient_id: 'B' }] }))
  assert.deepEqual(await b.readWithState('inventory').then((x) => x.results.map((r) => r.sourceId)), ['A', 'B'])
})

test('the business date beats the row insert timestamp', async () => {
  const a = adapter(jsonOk({ success: true, count: 1, data: [{ id: 1, invoiceDate: '2026-07-28', createdAt: '2026-08-03T00:00:00Z' }] }))
  const [r] = await a.readWithState('invoices').then((x) => x.results)
  assert.equal(r.originalDate, '2026-07-28') // when the invoice is from, not when we scanned it
})
