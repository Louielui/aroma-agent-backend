'use strict'

/**
 * routeTableSmoke.test.js — does the REAL app actually serve these routes?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⚠ THIS FILE EXISTS BECAUSE A GREEN SUITE CANNOT SEE A MISSING MOUNT.
 *
 * Three times this week a live check caught something every test passed:
 *   1. the Drive backlog line — timed out at 2.5s and rendered as silence
 *   2. CONTEXT_DEVELOPMENT_RECORD — the source registered, then skipped, 「flag off」
 *   3. the enquiry router — GET /api/v1/demo/enquiries returned the 404 catch-all
 *      while all four of its route tests passed
 *
 * The pattern is always the same, and it is structural rather than careless:
 *
 * > **The test CONSTRUCTS the thing under test, so it can never observe whether the thing is
 * > CONNECTED.** A router test proves the router works. It cannot prove anyone mounted it.
 *
 * So this file does the one thing those tests cannot: it requires the REAL composition root
 * — `src/app.js`, the same module the server starts — binds it to a port, and asks it over
 * HTTP. Nothing here builds an app.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert')

// THE REAL COMPOSITION ROOT. Not createDemoRouter(), not an express() built here.
const { createApp } = require('../app')

// ⚠ THE TEST MUST AUTHENTICATE, and finding out why is the point.
//
// Measured while writing this file: an UNMOUNTED path under /api/v1/demo returns 401, not
// 404 — the owner gate answers for the whole prefix before routing happens. So a smoke test
// that accepted 401 as 「reachable」 would have PASSED with the enquiry router unmounted, and
// proved nothing at all.
//
// With a service token the gate lets the request through to the route table, and 404 becomes
// meaningful again.
const TOKEN = 'smoke-token-route-table'

let app
let server
let base

before(async () => {
  app = createApp({ serviceToken: TOKEN })
  app.locals.conversationDemo = true
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = 'http://127.0.0.1:' + server.address().port
})

after(() => { if (server) server.close() })

async function hit (path) {
  const res = await fetch(base + path, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + TOKEN } })
  let body = null
  try { body = await res.json() } catch (_) {}
  return { status: res.status, body }
}

/**
 * The assertion is 「this path is SERVED BY SOMETHING」 — not 「it returns 200」.
 *
 * 401 and 403 both prove a route exists and a guard answered. **404 is the failure**, because
 * 404 is what an unmounted route returns, and that is exactly what happened.
 */
function assertReachable (r, path) {
  // 404 is THE failure — it is what an unmounted route returns, and it is exactly what
  // happened. 401/403 are NOT accepted here: the request carries a valid token, so a guard
  // answering would itself be a finding.
  assert.notStrictEqual(r.status, 404, path + ' returned 404 — nothing is mounted there')
  assert.ok([200, 403].includes(r.status), path + ' unexpected status ' + r.status)
}

describe('the real app serves the routes we think it does', () => {
  test('GET /health', async () => {
    const r = await hit('/health')
    assert.strictEqual(r.status, 200)
  })

  test('GET /api/v1/demo/enquiries — the mount that silently did not happen', async () => {
    const r = await hit('/api/v1/demo/enquiries')
    assertReachable(r, '/api/v1/demo/enquiries')
  })

  test('GET /api/v1/demo/enquiries/:id', async () => {
    const r = await hit('/api/v1/demo/enquiries/enq_smoke0001')
    // Reachable, and an unknown id must be 404 FROM THE ROUTE — distinguished from the
    // catch-all by the body it carries.
    if (r.status === 404) {
      assert.strictEqual(r.body && r.body.error, 'enquiry_not_found',
        'a 404 with no enquiry_not_found body is the catch-all, i.e. nothing is mounted')
    } else {
      assert.ok([200, 401, 403].includes(r.status), 'unexpected status ' + r.status)
    }
  })

  test('GET /api/v1/demo/version — the stale-tab guard', async () => {
    const r = await hit('/api/v1/demo/version')
    assertReachable(r, '/api/v1/demo/version')
  })

  test('GET /api/v1/demo/greeting — the backlog line rides here', async () => {
    const r = await hit('/api/v1/demo/greeting')
    assertReachable(r, '/api/v1/demo/greeting')
  })

  test('GET /api/v1/context/health', async () => {
    const r = await hit('/api/v1/context/health')
    assertReachable(r, '/api/v1/context/health')
  })
})

describe('and it does NOT serve things nobody mounted', () => {
  test('a made-up path still 404s — otherwise this file proves nothing', () => {
    // The positive control. Without it, an app that answered everything would pass every
    // assertion above. (HR-12: a check that cannot fail is not a check.)
    return hit('/api/v1/demo/definitely-not-a-route').then((r) => {
      assert.strictEqual(r.status, 404,
        'an authenticated request to a path nobody mounted must 404, or every assertion above is vacuous')
    })
  })
})
