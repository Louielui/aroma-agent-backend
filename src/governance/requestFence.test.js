'use strict'
/**
 * requestFence.test.js — L3, the guardrail.
 *
 * L1 measured 45% on pages it had never seen. **Nothing in the design survives that except a
 * fence that does not depend on what a site calls its buttons.** A site chooses its button
 * names; it does not choose whether a purchase is a write.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { buildRequestFence, FENCE } = require('./requestFence')

/** A fake playwright route. Records what happened to each request. */
function fakeRoute (method, url, type = 'xhr') {
  const rec = { method, url, type, outcome: null }
  return {
    rec,
    request: () => ({ method: () => method, url: () => url, resourceType: () => type }),
    continue: async () => { rec.outcome = 'CONTINUED' },
    abort: async (reason) => { rec.outcome = 'ABORTED:' + (reason || '') }
  }
}
const run = async (fence, method, url, type) => {
  const r = fakeRoute(method, url, type)
  await fence.handle(r)
  return r.rec.outcome
}

const order = { allowedOrigins: ['https://www.costco.ca'] }

describe('reading is allowed, writing is not — by construction', () => {
  test('GET continues', async () => {
    const f = buildRequestFence({ order })
    assert.strictEqual(await run(f, 'GET', 'https://www.costco.ca/x'), 'CONTINUED')
  })

  test('HEAD and OPTIONS continue — neither changes anything', async () => {
    const f = buildRequestFence({ order })
    assert.strictEqual(await run(f, 'HEAD', 'https://www.costco.ca/x'), 'CONTINUED')
    assert.strictEqual(await run(f, 'OPTIONS', 'https://www.costco.ca/x'), 'CONTINUED')
  })

  test('⛔ POST is ABORTED by default', async () => {
    const f = buildRequestFence({ order })
    assert.match(await run(f, 'POST', 'https://www.costco.ca/order'), /^ABORTED/)
  })

  test('PUT, PATCH and DELETE are aborted too', async () => {
    const f = buildRequestFence({ order })
    for (const m of ['PUT', 'PATCH', 'DELETE']) {
      assert.match(await run(f, m, 'https://www.costco.ca/x'), /^ABORTED/, m)
    }
  })

  test('an unknown method is aborted — the default is stop, not pass', async () => {
    const f = buildRequestFence({ order })
    assert.match(await run(f, 'PROPFIND', 'https://www.costco.ca/x'), /^ABORTED/)
  })
})

describe('the sealed order is the only thing that opens it', () => {
  test('a write the order named is allowed', async () => {
    const f = buildRequestFence({
      order: { ...order, allowedWrites: [{ origin: 'https://www.costco.ca', pathPrefix: '/api/search', method: 'POST' }] }
    })
    assert.strictEqual(await run(f, 'POST', 'https://www.costco.ca/api/search?q=x'), 'CONTINUED')
  })

  test('the SAME path on another origin is not', async () => {
    const f = buildRequestFence({
      order: { ...order, allowedWrites: [{ origin: 'https://www.costco.ca', pathPrefix: '/api/search', method: 'POST' }] }
    })
    assert.match(await run(f, 'POST', 'https://evil.example.com/api/search'), /^ABORTED/)
  })

  test('a DIFFERENT path on the allowed origin is not', async () => {
    const f = buildRequestFence({
      order: { ...order, allowedWrites: [{ origin: 'https://www.costco.ca', pathPrefix: '/api/search', method: 'POST' }] }
    })
    assert.match(await run(f, 'POST', 'https://www.costco.ca/api/placeOrder'), /^ABORTED/)
  })

  test('a different METHOD on the allowed path is not', async () => {
    const f = buildRequestFence({
      order: { ...order, allowedWrites: [{ origin: 'https://www.costco.ca', pathPrefix: '/api/search', method: 'POST' }] }
    })
    assert.match(await run(f, 'DELETE', 'https://www.costco.ca/api/search'), /^ABORTED/)
  })

  test('there is NO wildcard — an allowlist with an escape hatch is a denylist in costume', async () => {
    const f = buildRequestFence({
      order: { ...order, allowedWrites: [{ origin: '*', pathPrefix: '*', method: '*' }] }
    })
    assert.match(await run(f, 'POST', 'https://www.costco.ca/anything'), /^ABORTED/)
  })

  test('an ABSENT allowedWrites blocks every write — an absent fence is not an open one', async () => {
    const f = buildRequestFence({ order: { allowedOrigins: ['https://www.costco.ca'] } })
    assert.match(await run(f, 'POST', 'https://www.costco.ca/x'), /^ABORTED/)
  })
})

describe('every refusal is RECORDED — a fence that stops silently cannot be reported', () => {
  test('aborts are counted and described', async () => {
    const f = buildRequestFence({ order })
    await run(f, 'POST', 'https://www.costco.ca/placeOrder')
    await run(f, 'POST', 'https://analytics.example.com/beacon')
    const r = f.report()
    assert.strictEqual(r.refused.length, 2)
    assert.strictEqual(r.refused[0].method, 'POST')
    assert.match(r.refused[0].url, /placeOrder/)
  })

  test('allowed reads are NOT logged — a record of everything is a record of nothing', async () => {
    const f = buildRequestFence({ order })
    for (let i = 0; i < 50; i++) await run(f, 'GET', 'https://www.costco.ca/img' + i + '.png', 'image')
    assert.strictEqual(f.report().refused.length, 0)
    assert.strictEqual(f.report().allowedWrites, 0)
  })

  test('the report separates writes-the-order-permitted from writes-refused', async () => {
    const f = buildRequestFence({
      order: { ...order, allowedWrites: [{ origin: 'https://www.costco.ca', pathPrefix: '/api/search', method: 'POST' }] }
    })
    await run(f, 'POST', 'https://www.costco.ca/api/search')
    await run(f, 'POST', 'https://www.costco.ca/api/placeOrder')
    const r = f.report()
    assert.strictEqual(r.allowedWrites, 1)
    assert.strictEqual(r.refused.length, 1)
  })

  test('the URL is recorded without its query string — a query can carry a secret', async () => {
    const f = buildRequestFence({ order })
    await run(f, 'POST', 'https://www.costco.ca/x?token=SECRETVALUE&card=4111111111111111')
    const r = f.report()
    assert.ok(!JSON.stringify(r).includes('SECRETVALUE'))
    assert.ok(!JSON.stringify(r).includes('4111'))
  })
})

describe('what it does NOT claim', () => {
  test('it does not inspect bodies — it is a method fence, not a content filter', async () => {
    const f = buildRequestFence({ order })
    assert.strictEqual(typeof f.inspectBody, 'undefined')
  })

  test('a GET that commits is NOT caught, and the fence says so about itself', async () => {
    const f = buildRequestFence({ order })
    assert.match(f.limits(), /GET/)
    assert.match(f.limits(), /cannot/i)
  })
})
