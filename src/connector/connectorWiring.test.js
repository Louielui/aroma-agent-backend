'use strict'

/**
 * connectorWiring.test.js — Phase 2 Gate 1 slice 5. The app.js flag-gated route
 * registration + index.js fail-fast. Flag off (default) → route absent (404).
 * Flag on (injected connectorDeps, synthetic) → project() over HTTP with the fixed
 * code→status mapping and no identity-value leak. index.js fail-fasts only when the
 * flag is on and BACKEND_READ_IDENTITY is unset.
 *
 *   Run: node --test src/connector/connectorWiring.test.js
 */

process.env.LLM_PROVIDER = 'mock'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { createApp } = require('../app')
const { createProjectionEndpoint } = require('./projectionEndpoint')
const { createAuditSink } = require('./auditSink')
const { createDurableAuditWriter } = require('./durableAuditWriter')
const { createResultIdStore } = require('./resultIdStore')

const READ_ID = 'test-backend-read-identity' // injected test value (not a real secret)
const SAFE = { proposalId: 'prop_1', executionId: 'task_1', status: 'succeeded', finishedAt: '2026-07-13T10:00:00.000Z', sourceTaskId: 'src_1', resultSummary: 'ok' }

function buildConnectorDeps () {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-cw-'))
  const durableWriter = createDurableAuditWriter({ baseDir: base })
  const auditSink = createAuditSink({ writer: durableWriter, clock: () => '2026-07-13T00:00:00.000Z', seqStart: durableWriter.lastDurableSeq(), auditorIdentity: 'auditor_reader' })
  const resultIdStore = createResultIdStore()
  const projectionEndpoint = createProjectionEndpoint({
    buildReturnReadyList: () => ({ items: [SAFE], count: 1, malformed: 0 }),
    auditSink, resultIdStore, readBackendReadIdentity: () => READ_ID,
    egressPolicyVersion: 'egr-1', now: () => 1000
  })
  return { deps: { projectionEndpoint }, base }
}

async function get (server, urlPath, headers = {}) {
  const { port } = server.address()
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers })
  let body = null
  try { body = await res.json() } catch (_) {}
  return { status: res.status, body }
}

test('flag OFF (default): connector route is absent → 404, existing behaviour unchanged', async () => {
  const built = createApp({ dispatcher: async () => {}, proposalPersistence: false, runPersistence: false })
  const server = built.listen(0)
  try {
    assert.equal(built.locals.connectorDeps, null)
    const r = await get(server, '/api/v1/connector/return-ready')
    assert.equal(r.status, 404)
    // an existing read route still works (byte-identical behaviour)
    assert.equal((await get(server, '/health')).status, 200)
  } finally { server.close() }
})

test('flag ON (injected): correct identity → 200 OK with {connectorResultId,summary}', async () => {
  const { deps } = buildConnectorDeps()
  const built = createApp({ connectorDeps: deps, dispatcher: async () => {}, proposalPersistence: false, runPersistence: false })
  const server = built.listen(0)
  try {
    const r = await get(server, '/api/v1/connector/return-ready', {
      'x-backend-read-identity': READ_ID, 'x-aroma-principal': 'aroma_mcp_svc', 'x-aroma-app': 'chatgpt-mcp', 'x-aroma-window': 'w1'
    })
    assert.equal(r.status, 200)
    assert.equal(r.body.code, 'OK')
    assert.equal(r.body.items.length, 1)
    assert.deepEqual(Object.keys(r.body.items[0]).sort(), ['connectorResultId', 'summary'])
  } finally { server.close() }
})

test('flag ON: wrong/absent identity → 403 READ_IDENTITY_DENIED; no identity value leaks', async () => {
  const { deps } = buildConnectorDeps()
  const built = createApp({ connectorDeps: deps, dispatcher: async () => {}, proposalPersistence: false, runPersistence: false })
  const server = built.listen(0)
  try {
    const wrong = await get(server, '/api/v1/connector/return-ready', { 'x-backend-read-identity': 'nope', 'x-aroma-principal': 'p', 'x-aroma-app': 'a', 'x-aroma-window': 'w' })
    assert.equal(wrong.status, 403)
    assert.equal(wrong.body.code, 'READ_IDENTITY_DENIED')
    assert.ok(!JSON.stringify(wrong.body).includes(READ_ID), 'the configured identity value never appears in the response')

    const absent = await get(server, '/api/v1/connector/return-ready', { 'x-aroma-principal': 'p', 'x-aroma-app': 'a', 'x-aroma-window': 'w' })
    assert.equal(absent.status, 403)

    const noCtx = await get(server, '/api/v1/connector/return-ready', { 'x-backend-read-identity': READ_ID }) // missing principal/app/window
    assert.equal(noCtx.status, 403)
  } finally { server.close() }
})

test('index.js fail-fast: CONNECTOR_PROJECTION on + BACKEND_READ_IDENTITY unset → exit 1', () => {
  const env = { ...process.env, HUB_TOKEN: 'x-hub', CONNECTOR_PROJECTION: 'on' }
  delete env.BACKEND_READ_IDENTITY
  const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-cw-noenv-'))
  try {
    const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'index.js')], { cwd: emptyCwd, env, encoding: 'utf8', timeout: 20000 })
    assert.equal(res.status, 1, 'index.js must exit 1 when the connector flag is on but its identity is unset')
    assert.match(String(res.stderr || ''), /BACKEND_READ_IDENTITY/)
  } finally { fs.rmSync(emptyCwd, { recursive: true, force: true }) }
})
