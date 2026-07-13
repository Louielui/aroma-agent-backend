'use strict'

/**
 * connectorGenericAuth.test.js — Phase 2 Gate 1 slice 6 part A (IR-01). The generic
 * /return-ready + /proposals/results read routes are token-free by default; when
 * CONNECTOR_GENERIC_AUTH is on they require the service token. This closes T-01 (the
 * MCP account, even reaching a loopback generic route, gets 401 without the token).
 *
 *   Run: node --test src/connector/connectorGenericAuth.test.js
 */

process.env.LLM_PROVIDER = 'mock'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')

const { createApp } = require('../app')
const { TEST_SERVICE_TOKEN } = require('../api/_serviceTokenFixture')

// stub artifact store → scanKind finds no dir → empty return-ready (no real .aroma touch)
const stubWorkerDeps = { artifactStore: { dirFor: () => path.join(os.tmpdir(), 'aroma-nonexistent-connector-auth-test') } }

async function get (server, urlPath, token) {
  const { port } = server.address()
  const headers = token ? { authorization: `Bearer ${token}` } : {}
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers })
  return res.status
}

test('flag OFF (default): /return-ready + /proposals/results are token-free (200) — byte-identical', async () => {
  const built = createApp({ dispatcher: async () => {}, workerDeps: stubWorkerDeps, proposalPersistence: false, runPersistence: false })
  const server = built.listen(0)
  try {
    assert.equal(await get(server, '/api/v1/return-ready'), 200)
    assert.equal(await get(server, '/api/v1/proposals/results'), 200)
  } finally { server.close() }
})

test('flag ON: both generic routes require the token → 401 without, 200 with', async () => {
  const built = createApp({ connectorGenericAuth: true, serviceToken: TEST_SERVICE_TOKEN, dispatcher: async () => {}, workerDeps: stubWorkerDeps, proposalPersistence: false, runPersistence: false })
  const server = built.listen(0)
  try {
    assert.equal(await get(server, '/api/v1/return-ready'), 401)
    assert.equal(await get(server, '/api/v1/proposals/results'), 401)
    assert.equal(await get(server, '/api/v1/return-ready', TEST_SERVICE_TOKEN), 200)
    assert.equal(await get(server, '/api/v1/proposals/results', TEST_SERVICE_TOKEN), 200)
  } finally { server.close() }
})

test('flag ON does NOT gate other read routes (e.g. /proposals) — scope is the two generic routes only', async () => {
  const built = createApp({ connectorGenericAuth: true, serviceToken: TEST_SERVICE_TOKEN, dispatcher: async () => {}, workerDeps: stubWorkerDeps, proposalPersistence: false, runPersistence: false })
  const server = built.listen(0)
  try {
    assert.equal(await get(server, '/api/v1/proposals'), 200) // still token-free
    assert.equal(await get(server, '/health'), 200)
  } finally { server.close() }
})
