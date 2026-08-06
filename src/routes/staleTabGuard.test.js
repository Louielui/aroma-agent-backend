'use strict'

/**
 * staleTabGuard.test.js — the endpoint the page asks 「am I still the current build?」
 *
 * Owner ruling 2026-08-06, after the third round lost to a stale tab:
 * 「a lesson recorded three times without a mechanism is not a lesson, it is a note.」
 *
 * The page carries the stamp of the assets it was built from. This route reports the stamp
 * the process is serving NOW. A page comparing the two can tell the Owner it is out of date,
 * instead of silently running old code against a new server.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const express = require('express')
const { createDemoRouter } = require('./demoRouter')
const { BUILD_STAMP } = require('../demo/demoHtml')

function appWith (deps) {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use(createDemoRouter(deps || {}))
  return app
}

async function get (app, p) {
  const server = app.listen(0)
  try {
    const port = server.address().port
    const res = await fetch('http://127.0.0.1:' + port + p, { headers: { Accept: 'application/json' } })
    let json = null
    try { json = await res.json() } catch (_) {}
    return { status: res.status, body: json }
  } finally { server.close() }
}

describe('stale-tab guard', () => {
  test('the version route reports the stamp this process is serving', async () => {
    const res = await get(appWith(), '/api/v1/demo/version')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.build, BUILD_STAMP)
  })

  test('it sits under /api/v1/demo so it inherits the owner gate', async () => {
    // A route on a new prefix is unauthenticated until someone remembers to add it to the
    // enumerated gate list in app.js — that already happened once with /api/v1/greeting.
    const src = require('fs').readFileSync(require.resolve('./demoRouter'), 'utf8')
    assert.ok(src.includes("'/api/v1/demo/version'"), 'must be mounted under the demo prefix')
    assert.ok(/\/api\/v1\/demo\/version', demoGuard/.test(src), 'must sit behind demoGuard like its siblings')
  })

  test('it is cheap — no Drive read, no store read, just the stamp', async () => {
    let called = false
    const res = await get(appWith({ readBacklogFn: async () => { called = true; return null } }), '/api/v1/demo/version')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(called, false, 'the page polls this; it must not do work')
  })
})

describe('the page compares the two itself', () => {
  test('the client fetches the version and warns when it differs', () => {
    const app = require('fs').readFileSync(require.resolve('../demo/assets/app.js'), 'utf8')
    assert.ok(/\/api\/v1\/demo\/version/.test(app), 'the client must ask the server for the current build')
    assert.ok(/stale/i.test(app), 'the client must have a stale path at all')
  })

  test('the warning names the fix, because the fix is not obvious', () => {
    const app = require('fs').readFileSync(require.resolve('../demo/assets/app.js'), 'utf8')
    // A banner saying "out of date" and nothing else sends him looking. Ctrl+Shift+R is the
    // remedy and it is not something a normal reload achieves.
    assert.ok(/Ctrl\+Shift\+R/.test(app), 'the banner must name the hard reload')
  })
})
