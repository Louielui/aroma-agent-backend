'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { randomUUID } = require('node:crypto')
const { createGrant, parseRequest, publicQuery, createReader, answer } = require('./publicSearch')
const profile = require('./deploymentProfile.json')
const request = '幫我查 Winnipeg Costco 有冇 8 吋深嘅 bus tub'
const warehouseRequest = '根據我哋倉存，幫我查 Winnipeg Costco 有冇 8 吋深嘅 bus tub'
const at = '2026-11-22T17:00:00.000Z'
const now = Date.parse(at)
const commit = 'a'.repeat(40)
const item = { id: 'bus-tub', product: 'bus tub', depthInches: 8, retailer: 'Costco', city: 'Winnipeg', inventoryRef: 'private-42' }
const page = { id: 'p1', kind: 'publisher_page', url: 'https://www.costco.ca/example.html',
  title: 'Product listing', text: 'This gray bus tub is 8 inches deep and is listed in the online catalogue.',
  retrievedAt: at, hash: 'b'.repeat(64) }

test('Cantonese search is explicit; same-thread recall and mixed commands do not use the tool', () => {
  assert.deepEqual(parseRequest(request, [item]), { item, warehouse: false })
  assert.deepEqual(parseRequest(warehouseRequest, [item]), { item, warehouse: true })
  for (const message of ['我頭先問咗咩？', '我上一句說了什麼？', request + '。順便買兩個', request + ' and order two', '幫我查我哋倉存有冇貨']) {
    assert.equal(parseRequest(message, [item]), null, message)
  }
})

test('warehouse projection exports an approved product ID only, and requires exactly one verified inventory row', async () => {
  const calls = []
  const grant = { id: randomUUID(), items: [item] }
  let rows = [{ source: 'aroma_system', sourceId: 'private-42', entityType: 'inventory_item',
    fields: { name: 'Private storage label', currentStock: 999, cost: 456, SKU: 'INTERNAL-SKU' } }]
  const reader = createReader({ grant: () => grant, readInventory: async () => ({
    evidence: { endpoint: 'inventory', completeWithinScope: true }, results: rows
  }), search: async input => { calls.push(input); return { searchedAt: at, pages: [page] } } })
  const id = randomUUID()
  assert.equal((await reader(warehouseRequest, id)).pages.length, 1)
  assert.deepEqual(calls, [{ grantId: grant.id, itemId: 'bus-tub', requestId: id }])
  assert.deepEqual(publicQuery(item), { query: 'Costco Winnipeg bus tub 8 inches deep', location: 'Winnipeg', freshness: 'current' })
  rows = [...rows, ...rows]
  assert.deepEqual((await reader(warehouseRequest, randomUUID())).pages, [])
  assert.equal(calls.length, 1)
})

test('local Qwen may select a matched publisher quotation but cannot turn a product page into store stock', async () => {
  const adapter = { providerName: 'local', model: profile.model, expectedDigest: profile.digest,
    async complete (prompt, options) {
      assert.equal(options.invocationPhase, 'answer')
      assert.match(prompt, /online catalogue/)
      return { model: 'local:' + profile.model, text: JSON.stringify({ sourceId: 'p1', quote: page.text }) }
    } }
  const result = await answer(request, adapter, randomUUID(), async () => ({ item, searchedAt: at, pages: [page] }))
  assert.match(result.reply, /未能確認 Winnipeg Costco 門店今日有冇貨/)
  assert.match(result.reply, /https:\/\/www\.costco\.ca\/example\.html/)
  assert.match(result.reply, /2026-11-22T17:00:00.000Z/)
  assert.equal(result.sourceBound, true)
  adapter.complete = async () => ({ model: 'local:' + profile.model, text: '{"sourceId":"p1","quote":"Winnipeg Costco has it in stock."}' })
  assert.doesNotMatch((await answer(request, adapter, randomUUID(), async () => ({ item, searchedAt: at, pages: [page] }))).reply, /has it in stock/)
  for (const text of ['The bus tub is 5 inches deep.', 'The bus tub is 3.8 inches deep.', 'The bus tub comes in several sizes.']) {
    adapter.complete = async () => ({ model: 'local:' + profile.model, text: JSON.stringify({ sourceId: 'p1', quote: text }) })
    const value = await answer(request, adapter, randomUUID(), async () => ({ item, searchedAt: at, pages: [{ ...page, text }] }))
    assert.equal(value.publicSearchEvidence.source, null)
    assert.match(value.reply, /未能確認/)
  }
  assert.match((await answer(request, adapter, randomUUID(), async () => ({ item, searchedAt: at, pages: [] }))).reply, /未能確認/)
})

test('independent egress ledger persists a reserved attempt and stops on failure, replay, drift, or expiry', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'local-public-search-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const grant = { id: randomUUID(), commit, startsAt: now, expiresAt: now + 120000, limit: 2, items: [item] }
  let instant = now
  const make = () => createGrant({ dir, grant: () => instant < grant.expiresAt ? grant : null, now: () => instant })
  const id = { grantId: grant.id, itemId: item.id, requestId: randomUUID() }
  const slot = make().admit(id)
  assert.throws(() => make().admit(id))
  assert.throws(() => make().admit({ ...id, requestId: randomUUID() }))
  slot.claim()
  assert.throws(() => slot.claim())
  slot.dispatch(randomUUID())
  slot.finish({ webSearchCalls: 1, pages: [page] })
  assert.throws(() => make().admit(id))
  const second = make().admit({ ...id, requestId: randomUUID() })
  second.finish(null)
  assert.throws(() => make().admit({ ...id, requestId: randomUUID() }))
  instant = grant.expiresAt
  assert.throws(() => make().admit({ ...id, requestId: randomUUID() }))
})



test('grant admission requires the exact bytes, commit and active time window', t => {
  const { writeFileSync } = require('node:fs')
  const { createHash } = require('node:crypto')
  const { GRANT_HASH, readGrant } = require('./publicSearch')
  const dir = mkdtempSync(join(tmpdir(), 'public-search-approval-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const g = { id: randomUUID(), commit, startsAt: now, expiresAt: now + 120000, limit: 1, items: [item] }
  const contents = JSON.stringify(g)
  const file = join(dir, 'approval.json')
  writeFileSync(file, contents)
  const env = { [GRANT_HASH]: createHash('sha256').update(contents).digest('hex') }
  const options = { dir, env, now: () => now, commit }
  assert.deepEqual(readGrant(options), g)
  assert.equal(readGrant({ ...options, env: {} }), null)
  assert.equal(readGrant({ ...options, commit: 'b'.repeat(40) }), null)
  assert.equal(readGrant({ ...options, now: () => now - 1 }), null)
  assert.equal(readGrant({ ...options, now: () => g.expiresAt }), null)
  writeFileSync(file, contents + '\n')
  assert.equal(readGrant(options), null)
})

test('Owner Bridge requires authentication and identifier-only input, logs the exact search and refuses replay', async t => {
  const { createInvocationLedger } = require('../investigation/invocations')
  const { createBridge } = require('../subscription/bridge')
  const { RPC } = require('./publicSearch')
  const dir = mkdtempSync(join(tmpdir(), 'public-search-bridge-'))
  const grant = { id: randomUUID(), commit, startsAt: now, expiresAt: Date.now() + 30000, limit: 1, items: [item] }
  const ledger = createInvocationLedger({ file: join(dir, 'invocations.json') })
  const token = '1'.repeat(64)
  const runs = []
  const make = localPublicGrant => createBridge({
    token, localPublicGrant, invocationLedger: ledger,
    usageBudget: { setActivationWitness () {}, withHeader (_header, _token, run) { return run() } },
    publicSearchFn: async ({ admission, onDispatch }, input) => {
      admission.claim()
      onDispatch()
      runs.push(input)
      return { actualModel: 'claude-opus-5-5', webSearchCalls: 1, searchedAt: at, pages: [page] }
    }
  })
  const off = make(null)
  const on = make(createGrant({ dir, grant: () => grant }))
  t.after(async () => {
    await Promise.all([off, on].map(server => new Promise(resolve => {
      server.closeAllConnections()
      server.close(resolve)
    })))
    rmSync(dir, { recursive: true, force: true })
  })
  for (const server of [off, on]) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const input = { grantId: grant.id, itemId: item.id, requestId: randomUUID() }
  const send = (server, body, headers = {}) => fetch('http://127.0.0.1:' + server.address().port + RPC, {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  assert.equal((await send(off, input)).status, 403)
  assert.equal((await send(on, input, { authorization: 'Bearer wrong' })).status, 401)
  assert.equal((await send(on, input, { origin: 'https://example.com' })).status, 401)
  assert.equal((await send(on, { ...input, query: 'UNAPPROVED DATA' })).status, 403)
  assert.equal((await send(on, { ...input, itemId: 'unapproved' })).status, 503)
  assert.equal(runs.length, 0)
  assert.deepEqual(await (await send(on, input)).json(), { searchedAt: at, pages: [page] })
  assert.deepEqual(runs, [publicQuery(item)])
  assert.equal((await send(on, input)).status, 503)
  assert.equal((await send(on, { ...input, requestId: randomUUID() })).status, 503)
  assert.equal(runs.length, 1)
  const record = ledger.read().records[0]
  assert.equal(record.requestId, input.requestId)
  assert.equal(record.state, 'succeeded')
  assert.ok(record.dispatchedAt)
})


test('production permits the existing inventory adapter GET only inside the scoped, enabled warehouse read', () => {
  const { GRANT_HASH } = require('./publicSearch')
  const { allowedUrl, withPublicInventoryRead } = require('./productionFence')
  const endpoint = 'https://system.aromabistro741.com/api/v1/ai/inventory'
  const previous = process.env[GRANT_HASH]
  try {
    delete process.env[GRANT_HASH]
    assert.equal(withPublicInventoryRead(() => allowedUrl(endpoint)), false)
    process.env[GRANT_HASH] = 'a'.repeat(64)
    assert.equal(allowedUrl(endpoint), false)
    withPublicInventoryRead(() => {
      assert.equal(allowedUrl(endpoint), true)
      assert.equal(allowedUrl(endpoint, 'POST'), false)
      assert.equal(allowedUrl(endpoint + '?sku=private'), false)
      assert.equal(allowedUrl(endpoint.replace('inventory', 'invoices')), false)
      assert.equal(allowedUrl(endpoint.replace('system.aromabistro741.com', 'example.com')), false)
    })
    assert.equal(allowedUrl(endpoint), false)
  } finally {
    if (previous === undefined) delete process.env[GRANT_HASH]
    else process.env[GRANT_HASH] = previous
  }
})
