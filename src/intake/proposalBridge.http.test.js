'use strict'

/**
 * proposalBridge.http.test.js — B2-7 wired promote endpoint + the bridge confirm
 * flag matrix over real HTTP.
 *
 * Uses an ISOLATED truth store (AROMA_DATA_DIR → temp dir, set before requiring
 * the app) and an in-memory Proposal store (proposalPersistence:false), so it
 * never touches the repo's data/. Proves:
 *   - POST /api/v1/intake/tasks/:taskId/proposal promotes (ready) + binds, is
 *     token-guarded, idempotent, 404 on unknown task;
 *   - a READY bridge proposal confirms; with WORKER_INVOCATION OFF it schedules
 *     NOTHING (no Result artifact); with it ON the worker fires after the response.
 *
 *   Run: node --test src/intake/proposalBridge.http.test.js
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Isolate the truth store BEFORE anything requires store.js (its data dir is
// resolved at module load). This process is dedicated to this test file.
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-bridge-truth-'))
process.env.LLM_PROVIDER = 'mock'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../app')
const store = require('../store/store')
const { createArtifactStore } = require('../store/artifactStore')
const { createClaudeWorker } = require('../workers/claudeWorker')
const { createWorkerRunner } = require('../workers/runWorkerInBackground')

const TOKEN = 'svc-token-aroma-os'
const SUCCESS_JSON = JSON.stringify({ subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.001 })

function buildApp () {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-bridge-art-'))
  const artifactStore = createArtifactStore({ baseDir: base })
  const worker = createClaudeWorker({ runner: async () => ({ status: 0, stdout: SUCCESS_JSON, stderr: '' }) })
  const runner = createWorkerRunner({ worker, artifactStore, sandboxRoot: os.tmpdir(), prepareSandbox: () => {} })
  const built = createApp({ dispatcher: async () => {}, workerDeps: { runner }, proposalPersistence: false })
  return { built, artifactStore, base }
}

function seedTask (title = 'Add supplier table', note = 'columns id, name') {
  const { task_ids: [taskId] } = store.persistIntake({ decision: { statement: 'd', rationale: 'r' }, tasks: [{ title, note }] })
  return taskId
}

async function promote (server, taskId, token = TOKEN) {
  const { port } = server.address()
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/intake/tasks/${taskId}/proposal`, { method: 'POST', headers, body: '{}' })
  return { status: res.status, json: await res.json() }
}

async function confirm (server, proposalId) {
  const { port } = server.address()
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/proposals/${proposalId}/confirm`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: '{}'
  })
  return { status: res.status, json: await res.json() }
}

async function waitFor (predicate, ms = 3000) {
  const start = Date.now()
  while (Date.now() - start < ms) { if (predicate()) return true; await new Promise(r => setTimeout(r, 20)) }
  return false
}

test('promote endpoint: token required, 404 unknown task, promotes+binds, idempotent', async () => {
  const { built } = buildApp()
  const server = built.listen(0)
  try {
    const taskId = seedTask()
    // token required
    assert.equal((await promote(server, taskId, null)).status, 401)
    // unknown task
    assert.equal((await promote(server, 'task_nope')).status, 404)
    // promote
    const first = await promote(server, taskId)
    assert.equal(first.status, 200)
    assert.equal(first.json.linkState, 'ready')
    assert.ok(first.json.proposalId)
    assert.equal(store.getTask(taskId).proposalId, first.json.proposalId) // bound in the truth store
    // idempotent
    const second = await promote(server, taskId)
    assert.equal(second.json.proposalId, first.json.proposalId)
    assert.equal(built.locals.proposalStore.listProposals().length, 1)
  } finally { server.close() }
})

test('flag OFF: a READY bridge proposal confirms → {runId} only, NO worker artifact', async () => {
  delete process.env.WORKER_INVOCATION
  delete process.env.DEVELOP_DISPATCH
  const { built, artifactStore } = buildApp()
  const server = built.listen(0)
  try {
    const taskId = seedTask('Task A', 'note A')
    const { json: { proposalId } } = await promote(server, taskId)
    const { status, json } = await confirm(server, proposalId)
    assert.equal(status, 201)
    // B2-9 honest contract: confirmed + not_authorized (flag off), runId is the created Run.
    assert.deepEqual(Object.keys(json).sort(), ['dispatchStatus', 'proposalStatus', 'runId'])
    assert.equal(json.dispatchStatus, 'not_authorized')
    await new Promise(r => setTimeout(r, 150))
    assert.equal(artifactStore.list('tasks').length, 0)
    assert.equal(artifactStore.list('results').length, 0)
  } finally { server.close() }
})

test('flag ON: a READY bridge proposal confirms → worker fires; chain resolves; proposal is the bridge one', async () => {
  process.env.WORKER_INVOCATION = 'on'
  const { built, artifactStore } = buildApp()
  const server = built.listen(0)
  try {
    const taskId = seedTask('Task B', 'note B')
    const { json: { proposalId } } = await promote(server, taskId)
    const { status } = await confirm(server, proposalId)
    assert.equal(status, 201)

    const landed = await waitFor(() => artifactStore.list('results').length > 0)
    assert.ok(landed, 'Result artifact must be written after the response when the flag is ON')
    const result = artifactStore.list('results')[0]
    const execution = artifactStore.read('tasks', result.taskId)
    assert.equal(execution.proposalId, proposalId)
    const proposal = built.locals.proposalStore.getProposal(proposalId)
    assert.equal(proposal.status, 'confirmed')
    assert.equal(proposal.sourceTaskId, taskId)         // it IS the bridge proposal
    assert.equal(proposal.linkState, 'ready')
    assert.equal(execution.approval.confirmedBy, proposal.confirmedBy)
    fs.rmSync(result.sandbox, { recursive: true, force: true })
  } finally { delete process.env.WORKER_INVOCATION; server.close() }
})
