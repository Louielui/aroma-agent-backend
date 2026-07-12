'use strict'

/**
 * workerTrigger.test.js — B2-1 Step 3 (HTTP + chain). Drives the real confirm
 * handler over HTTP with an injected worker (real Step-2 adapter + stub runner,
 * so the sandbox brake runs but no real claude is called). Proves:
 *   - flag OFF  → confirm response is exactly {runId}, NO artifact written;
 *   - flag ON   → the worker fires AFTER the response, and the traceability chain
 *                 Result → taskId → Execution → proposalId → approval fully
 *                 resolves (tightening 2).
 *
 *   Run: node --test src/api/workerTrigger.test.js
 */

process.env.LLM_PROVIDER = 'mock' // keep any legacy path offline; seeding uses a fake llm directly

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const app = require('../app')
const { createApp } = app
const { createArtifactStore } = require('../store/artifactStore')
const { createClaudeWorker } = require('../workers/claudeWorker')
const { createWorkerRunner } = require('../workers/runWorkerInBackground')

const { TEST_SERVICE_TOKEN: TOKEN } = require('./_serviceTokenFixture') // B2-15: explicit test token
const SUCCESS_JSON = JSON.stringify({
  subtype: 'success', is_error: false, result: 'created hello.txt and committed', total_cost_usd: 0.003
})

function buildApp () {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-trig-'))
  const store = createArtifactStore({ baseDir: base })
  const stubRunner = async () => ({ status: 0, stdout: SUCCESS_JSON, stderr: '' })
  // REAL Step-2 adapter (its sandbox brake runs) driven by a stub runner (no real claude).
  const worker = createClaudeWorker({ runner: stubRunner })
  const runner = createWorkerRunner({ worker, artifactStore: store, sandboxRoot: os.tmpdir(), prepareSandbox: () => {} })
  const built = createApp({ serviceToken: TOKEN, dispatcher: async () => {}, workerDeps: { runner }, proposalPersistence: false, runPersistence: false })
  return { built, store, base }
}

async function seedProposal (built) {
  const developLlm = async () => ({ intent: 'develop', task: 'create hello.txt', targetProject: 'frontend' })
  const { proposal } = await built.locals.proposalStore.propose({ conversationId: 'c', message: 'add a field', llm: developLlm })
  return proposal.id
}

async function confirm (server, proposalId) {
  const { port } = server.address()
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/proposals/${proposalId}/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: '{}'
  })
  return { status: res.status, json: await res.json() }
}

async function waitFor (predicate, ms = 3000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (predicate()) return true
    await new Promise(r => setTimeout(r, 20))
  }
  return false
}

test('flag OFF: confirm reports not_authorized and NO worker artifact is written', async () => {
  delete process.env.WORKER_INVOCATION
  delete process.env.DEVELOP_DISPATCH
  const { built, store, base } = buildApp()
  const server = built.listen(0)
  try {
    const pid = await seedProposal(built)
    const { status, json } = await confirm(server, pid)

    assert.equal(status, 201)
    // B2-9 honest contract: confirmed proposal + explicit dispatchStatus.
    assert.deepEqual(Object.keys(json).sort(), ['dispatchStatus', 'proposalStatus', 'runId'])
    assert.equal(json.proposalStatus, 'confirmed')
    assert.equal(json.dispatchStatus, 'not_authorized')
    assert.ok(json.runId)

    await new Promise(r => setTimeout(r, 150)) // give any (wrongly) scheduled worker a chance
    assert.equal(store.list('tasks').length, 0)
    assert.equal(store.list('results').length, 0)
  } finally { server.close(); fs.rmSync(base, { recursive: true, force: true }) }
})

test('flag ON: worker fires after response; chain Result->Execution->proposalId->approval resolves', async () => {
  process.env.WORKER_INVOCATION = 'on'
  delete process.env.DEVELOP_DISPATCH
  const { built, store, base } = buildApp()
  const server = built.listen(0)
  try {
    const pid = await seedProposal(built)
    const { status, json } = await confirm(server, pid)
    assert.equal(status, 201)
    assert.equal(json.dispatchStatus, 'worker_scheduled') // B2-9: sandbox worker authorized
    assert.ok(json.runId)

    const landed = await waitFor(() => store.list('results').length > 0)
    assert.ok(landed, 'the worker Result Artifact must be written asynchronously after the response')

    // --- walk the chain (tightening 2): every hop must RESOLVE, not just be present ---
    const result = store.list('results')[0]
    assert.equal(result.ok, true)
    assert.deepEqual(result.relay, { toUser: 0, fromUser: 0, manual: 0 })

    // Result -> taskId -> Execution
    const execution = store.read('tasks', result.taskId)
    assert.ok(execution, 'result.taskId must resolve to an Execution Artifact')

    // Execution -> proposalId -> the proposal
    assert.equal(execution.proposalId, pid)
    const proposal = built.locals.proposalStore.getProposal(execution.proposalId)
    assert.ok(proposal, 'execution.proposalId must resolve to a proposal')
    assert.equal(proposal.status, 'confirmed')

    // Execution.approval -> the authorising confirm provenance on the proposal
    assert.ok(proposal.confirmedBy, 'authorising approver must be present')
    assert.equal(execution.approval.confirmedBy, proposal.confirmedBy)
    assert.equal(execution.approval.confirmedAt, proposal.confirmedAt)

    fs.rmSync(result.sandbox, { recursive: true, force: true })
  } finally {
    delete process.env.WORKER_INVOCATION
    server.close()
    fs.rmSync(base, { recursive: true, force: true })
  }
})
