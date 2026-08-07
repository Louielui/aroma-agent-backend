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

/**
 * ⛔ ROUND B: 「附上咗乜要睇得見」 — enforced, not commented.
 *
 * The preview endpoint and the send path call the SAME function. What he sees before typing is
 * what travels, because one function cannot disagree with itself.
 */
describe('the attachment preview is readable BEFORE anything is typed', () => {
  test('GET .../attachment returns exactly what would travel', async () => {
    const { s, port } = await serve()
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/api/v1/home/section/recall/attachment')
      assert.strictEqual(r.status, 200)
      const a = await r.json()
      assert.strictEqual(a.kind, 'recall')
      assert.ok(Array.isArray(a.lines) && a.lines.length > 0, 'an empty preview would look like nothing is carried')
      assert.ok(a.capturedAt)
    } finally { s.close() }
  })

  test('⛔ the preview and the prompt come from ONE function, so they cannot diverge', async () => {
    const { s, port } = await serve()
    try {
      const a = await (await fetch('http://127.0.0.1:' + port + '/api/v1/home/section/recall/attachment')).json()
      const { buildSectionPreamble } = require('./sectionAttachment')
      const { preamble } = buildSectionPreamble(a)
      for (const line of a.lines) {
        // every previewed line, with delimiters stripped, must appear in what is sent
        assert.ok(preamble.includes(line.replace(/[<>]/g, '')),
          'a line he was shown that does not travel is exactly the failure this round exists to prevent')
      }
    } finally { s.close() }
  })

  test('an unknown kind previews nothing, with a 404 rather than an empty attachment', async () => {
    const { s, port } = await serve()
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/api/v1/home/section/nonesuch/attachment')
      assert.strictEqual(r.status, 404)
    } finally { s.close() }
  })
})
