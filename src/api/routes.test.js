'use strict'

/**
 * routes.test.js — end-to-end tests for Aroma OS routing + service-token auth.
 *
 * Uses the built-in Node test runner (node:test) and the global fetch, no extra
 * dependencies. The server is started on an ephemeral port with an INERT
 * dispatcher injected, so no worker ever runs and the real Claude Code adapter
 * is never touched.
 *
 *   Run: node --test src/api/
 */

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')

const app = require('../app')
const { createApp } = app
const { readExpectedToken } = require('./auth')

// The token an incoming request must present. Read from the same helper the
// server uses, so the test is correct whether or not HUB_TOKEN is configured.
const TOKEN = readExpectedToken()
const AUTH = { Authorization: `Bearer ${TOKEN}` }
const JSON_HEADERS = { 'Content-Type': 'application/json' }

let server
let base

before(async () => {
  // Inject an inert dispatcher: it resolves immediately and does nothing, so a
  // created Run never reaches a worker and the real Claude Code is never invoked.
  const testApp = createApp({ dispatcher: async () => {} })
  await new Promise(resolve => {
    server = testApp.listen(0, resolve)
  })
  const { port } = server.address()
  base = `http://127.0.0.1:${port}`
})

after(async () => {
  await new Promise(resolve => server.close(resolve))
})

/** Fetch the current list of Runs (read-only route, no token required). */
async function listRuns () {
  const res = await fetch(`${base}/api/v1/runs`)
  assert.equal(res.status, 200)
  return res.json()
}

test('GET /health responds 200 with no Authorization header', async () => {
  const res = await fetch(`${base}/health`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.status, 'ok')
})

test('POST /api/v1/runs without an Authorization header responds 401 and creates no Run', async () => {
  const before = (await listRuns()).length
  const res = await fetch(`${base}/api/v1/runs`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ task: 'noop', targetProject: 'frontend' })
  })
  assert.equal(res.status, 401)
  const after = (await listRuns()).length
  assert.equal(after, before, 'no Run should have been created')
})

test('POST /api/v1/runs with a wrong token responds 401 and creates no Run', async () => {
  const before = (await listRuns()).length
  const res = await fetch(`${base}/api/v1/runs`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, Authorization: 'Bearer not-the-real-token' },
    body: JSON.stringify({ task: 'noop', targetProject: 'frontend' })
  })
  assert.equal(res.status, 401)
  const after = (await listRuns()).length
  assert.equal(after, before, 'no Run should have been created')
})

test('POST /api/v1/runs with the correct Bearer token is accepted and returns a run id', async () => {
  const res = await fetch(`${base}/api/v1/runs`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...AUTH },
    body: JSON.stringify({ task: 'noop', targetProject: 'frontend' })
  })
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.ok(typeof body.id === 'string' && body.id.length > 0, 'expected a run id')
})

test('POST /runs on the unprefixed path with the correct token is also accepted', async () => {
  const res = await fetch(`${base}/runs`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...AUTH },
    body: JSON.stringify({ task: 'noop', targetProject: 'frontend' })
  })
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.ok(typeof body.id === 'string' && body.id.length > 0, 'both mounts must work')
})

test('POST /api/v1/runs/:id/approve without a token responds 401 and leaves the Run unchanged', async () => {
  // Create a Run through the trusted path first.
  const created = await fetch(`${base}/api/v1/runs`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...AUTH },
    body: JSON.stringify({ task: 'noop', targetProject: 'frontend' })
  })
  const { id } = await created.json()

  // Observe its current state.
  const beforeRes = await fetch(`${base}/api/v1/runs/${id}`)
  const beforeStatus = (await beforeRes.json()).status

  // Approve with no Authorization header — rejected before any state change.
  const res = await fetch(`${base}/api/v1/runs/${id}/approve`, { method: 'POST' })
  assert.equal(res.status, 401)

  const afterRes = await fetch(`${base}/api/v1/runs/${id}`)
  const afterStatus = (await afterRes.json()).status
  assert.equal(afterStatus, beforeStatus, 'the Run must remain in its previous state')
})

test('GET /api/v1/runs/:id responds without a token', async () => {
  const created = await fetch(`${base}/api/v1/runs`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...AUTH },
    body: JSON.stringify({ task: 'noop', targetProject: 'frontend' })
  })
  const { id } = await created.json()

  const res = await fetch(`${base}/api/v1/runs/${id}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.id, id)
})

test('a present-but-malformed Authorization header (missing Bearer prefix) responds 401', async () => {
  const res = await fetch(`${base}/api/v1/runs`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, Authorization: TOKEN },
    body: JSON.stringify({ task: 'noop', targetProject: 'frontend' })
  })
  assert.equal(res.status, 401)
})

test('the token value never appears in any response body', async () => {
  // Collect the bodies of a representative set of responses and assert none of
  // them leaks the expected token.
  const bodies = []

  const health = await fetch(`${base}/health`)
  bodies.push(await health.text())

  const ok = await fetch(`${base}/api/v1/runs`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...AUTH },
    body: JSON.stringify({ task: 'noop', targetProject: 'frontend' })
  })
  const okBody = await ok.text()
  bodies.push(okBody)

  const missing = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: JSON_HEADERS })
  bodies.push(await missing.text())

  const wrong = await fetch(`${base}/api/v1/runs`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, Authorization: 'Bearer wrong' },
    body: JSON.stringify({ task: 'noop', targetProject: 'frontend' })
  })
  bodies.push(await wrong.text())

  const { id } = JSON.parse(okBody)
  const read = await fetch(`${base}/api/v1/runs/${id}`)
  bodies.push(await read.text())

  for (const body of bodies) {
    assert.equal(body.includes(TOKEN), false, 'the service token must never be echoed')
  }
})
