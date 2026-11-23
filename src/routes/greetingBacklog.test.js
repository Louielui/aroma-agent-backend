'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const express = require('express')
const { createDemoRouter } = require('./demoRouter')

function appWith (deps) {
  const app = express()
  app.use(express.json())
  // The greeting sits behind demoGuard, exactly like every sibling route. Setting this is
  // what the real app does; leaving it out yields 403, not a greeting.
  app.locals.conversationDemo = true
  app.use(createDemoRouter(deps))
  return app
}

/** No supertest in this repo (no new dependencies). Same harness as conversationRoutes.test.js. */
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

test('the chat greeting returns only local time and preserves the backlog field shape', async () => {
  let driveReads = 0
  const app = appWith({ readBacklogFn: () => { driveReads++; throw new Error('drive must not be called') } })
  const res = await get(app, '/api/v1/demo/greeting')
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.body.ok, true)
  assert.ok(res.body.greeting)
  assert.strictEqual(res.body.backlog, null)
  assert.strictEqual(driveReads, 0)
})
