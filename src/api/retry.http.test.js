'use strict'

/**
 * retry.http.test.js — B2-11b POST /runs/:id/retry endpoint wiring.
 * Sets up an INTERRUPTED run (authorized Develop dispatch → DISPATCH_CLAIMED →
 * reconcile), then exercises the endpoint. Injected fakes; zero paid, zero worker.
 *
 *   Run: node --test src/api/retry.http.test.js
 */

process.env.LLM_PROVIDER = 'mock'

const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createApp } = require('../app')
const { createArtifactStore } = require('../store/artifactStore')

const TOKEN = 'svc-token-aroma-os'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

afterEach(() => { delete process.env.WORKER_INVOCATION; delete process.env.DEVELOP_DISPATCH })

async function post (server, url, body, token) {
  const { port } = server.address()
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers, body: JSON.stringify(body || {}) })
  let json = null
  try { json = await res.json() } catch (_) {}
  return { status: res.status, json }
}

test('retry endpoint: token required, interrupted → 201 inert attempt, missing reason → 422, duplicate → 409', async () => {
  // Authorized Develop dispatch (WORKER off, DEVELOP on, dispatcher injected) so a
  // DISPATCH_CLAIMED is written; no conflict.
  process.env.WORKER_INVOCATION = 'off'
  process.env.DEVELOP_DISPATCH = 'on'
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-retry-http-'))
  const artifactStore = createArtifactStore({ baseDir: base })
  const spy = []
  const built = createApp({
    dispatcher: async () => { spy.push(1) },
    workerDeps: { runner: { run: async () => { throw new Error('worker must not run') } }, artifactStore },
    proposalPersistence: false,
    runPersistence: false
  })
  const server = built.listen(0)
  try {
    // seed a ready bridge proposal + confirm → creates a Run that reaches DISPATCH_CLAIMED
    const ps = built.locals.proposalStore
    const p = ps.createBridgeProposal({ task: 'Title: retry me', sourceTaskId: 'task_r' })
    ps.setLinkState(p.id, 'ready')
    const conf = await post(server, `/api/v1/proposals/${p.id}/confirm`, {}, TOKEN)
    assert.equal(conf.status, 201)
    assert.equal(conf.json.dispatchStatus, 'develop_dispatched')
    const runId = conf.json.runId
    await sleep(30) // let the (no-op) dispatch settle at DISPATCH_CLAIMED

    // startup reconcile (pure mark) → the run becomes INTERRUPTED
    built.locals.runStore.reconcile({ findExecution: () => null, findResult: () => null })

    // token required
    assert.equal((await post(server, `/api/v1/runs/${runId}/retry`, { reason: 'go' }, null)).status, 401)
    // missing reason → 422
    assert.equal((await post(server, `/api/v1/runs/${runId}/retry`, { reason: '' }, TOKEN)).status, 422)

    // retry → 201, inert new attempt
    const r = await post(server, `/api/v1/runs/${runId}/retry`, { reason: 'Louie: retry the interrupted dispatch' }, TOKEN)
    assert.equal(r.status, 201)
    assert.ok(r.json.attemptId && r.json.attemptId !== runId)
    assert.equal(r.json.priorRunId, runId)
    assert.equal(r.json.status, 'retry_pending')
    assert.equal(r.json.retryApprovedBy, 'louie')

    // duplicate retry → 409
    assert.equal((await post(server, `/api/v1/runs/${runId}/retry`, { reason: 'again' }, TOKEN)).status, 409)
  } finally {
    server.close()
    fs.rmSync(base, { recursive: true, force: true })
  }
})
