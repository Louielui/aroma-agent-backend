'use strict'
/**
 * homeSectionsWiring.test.js — the WIRING, not the units.
 *
 * ⛔ Five components this month passed their own tests and were reached by nothing. This file
 * exercises the real assembly: createApp() → the route → the store → the detail.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { createApp } = require('../app')

function serve () {
  const app = createApp({ serviceToken: 'wiring-test-token' })
  return new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve({ s, port: s.address().port }))
  })
}

describe('the section detail endpoint is reachable in the REAL assembly', () => {
  test('GET /api/v1/home/section/recall answers with a detail, not a 404', async () => {
    const { s, port } = await serve()
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/api/v1/home/section/recall')
      assert.notStrictEqual(r.status, 404, 'if this is 404 the route is wired to nothing')
      const b = await r.json()
      assert.strictEqual(b.kind, 'recall')
      assert.ok(Array.isArray(b.ingredients))
      assert.ok(Array.isArray(b.history))
      assert.ok(b.freshness, 'both witnesses live here')
    } finally { s.close() }
  })

  test('⛔ an unknown kind is REFUSED, not answered with an empty detail', async () => {
    // An empty detail for a kind that does not exist would render as 「nothing to report」.
    const { s, port } = await serve()
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/api/v1/home/section/nonesuch')
      assert.strictEqual(r.status, 404)
      const b = await r.json()
      assert.match(b.saying, /唔認得|冇/)
    } finally { s.close() }
  })

  test('the briefing tells the client which sections have a door', async () => {
    const { s, port } = await serve()
    try {
      const b = await (await fetch('http://127.0.0.1:' + port + '/api/v1/home/briefing')).json()
      assert.ok(Array.isArray(b.errands.conclusions))
      for (const c of b.errands.conclusions) {
        assert.strictEqual(typeof c.openable, 'boolean', 'every conclusion must say whether it opens')
      }
      // ⛔ The two that must never be doors.
      assert.notStrictEqual(b.waiting.openable, true, 'a queue is not standing state')
      assert.notStrictEqual(b.backlog.openable, true, 'its door would open onto the same four numbers')
    } finally { s.close() }
  })
})
