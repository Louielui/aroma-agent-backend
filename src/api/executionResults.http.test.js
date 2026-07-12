'use strict'

/**
 * executionResults.http.test.js — B2-1d Result Read Endpoint (HTTP). Drives the
 * real route over HTTP against seeded artifacts. NO worker invocation, NO paid
 * claude call (the injected runner throws if ever run — reads must never touch
 * it). Proves: success + full chain, real confirmedBy/At, failed result,
 * unknown→404, pending/running, missing-artifact-safe, malformed→controlled 500,
 * traversal→400 with the store never touched, and no prompt/path leak.
 *
 *   Run: node --test src/api/executionResults.http.test.js
 */

process.env.LLM_PROVIDER = 'mock'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const app = require('../app')
const { createApp } = app
const { createArtifactStore } = require('../store/artifactStore')

const PROMPT_SENTINEL = 'PROMPT_should_not_leak'
const PATH_SENTINEL = 'aroma-sandbox-SECRETPATH'

function buildApp () {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-read-'))
  const store = createArtifactStore({ baseDir: base })
  const landmineRunner = { run: async () => { throw new Error('worker must NEVER run in a read test') } }
  const built = createApp({ dispatcher: async () => {}, workerDeps: { artifactStore: store, runner: landmineRunner }, proposalPersistence: false, runPersistence: false })
  return { built, store, base }
}

async function seedConfirmed (built) {
  const develop = async () => ({ intent: 'develop', task: 'do x', targetProject: 'frontend' })
  const { proposal } = await built.locals.proposalStore.propose({ conversationId: 'c', message: 'm', llm: develop })
  const runId = built.locals.proposalStore.confirmProposal(proposal.id, 'louie')
  return { proposal: built.locals.proposalStore.getProposal(proposal.id), runId }
}

function seedExecution (store, { proposalId, runId, confirmedBy, confirmedAt }) {
  const taskId = 'task_' + proposalId.slice(-6)
  store.write('tasks', {
    id: taskId, createdAt: '2026-07-11T12:00:00.000Z', kind: 'execution', proposalId, runId,
    task: PROMPT_SENTINEL, sandbox: 'C:/Temp/' + PATH_SENTINEL, approval: { confirmedBy, confirmedAt }
  })
  return taskId
}
function seedResult (store, { taskId, proposalId, ok, exit, error, result, cost }) {
  store.write('results', {
    id: 'res_' + taskId, createdAt: '2026-07-11T12:00:07.000Z', kind: 'result', taskId, proposalId,
    ok, exit, error, result, cost, relay: { toUser: 0, fromUser: 0, manual: 0 }, sandbox: 'C:/Temp/' + PATH_SENTINEL
  })
}

async function get (server, p) {
  const { port } = server.address()
  const res = await fetch(`http://127.0.0.1:${port}${p}`)
  let json = null
  try { json = await res.json() } catch (_) {}
  return { status: res.status, json, raw: json === null ? '' : JSON.stringify(json) }
}

test('success + full chain resolves + real confirmedBy/At + NO leak', async () => {
  const { built, store, base } = buildApp()
  const server = built.listen(0)
  try {
    const { proposal, runId } = await seedConfirmed(built)
    const taskId = seedExecution(store, { proposalId: proposal.id, runId, confirmedBy: proposal.confirmedBy, confirmedAt: proposal.confirmedAt })
    seedResult(store, { taskId, proposalId: proposal.id, ok: true, exit: 0, result: 'created hello-aroma.txt', cost: 0.1289 })

    const { status, json, raw } = await get(server, `/api/v1/proposals/${proposal.id}/result`)
    assert.equal(status, 200)
    assert.equal(json.status, 'succeeded')
    assert.equal(json.ok, true)
    assert.equal(json.executionId, taskId)
    assert.equal(json.proposalId, proposal.id)
    assert.equal(json.exitCode, 0)
    assert.equal(json.resultSummary, 'created hello-aroma.txt')
    assert.equal(json.cost, 0.1289)
    assert.equal(json.elapsedMs, 7000)
    assert.equal(json.worker, 'claude')
    assert.equal(json.provider, 'anthropic-claude')
    assert.deepEqual(json.relay, { toUser: 0, fromUser: 0, manual: 0 })
    // chain -> proposal confirmation, real values
    assert.equal(json.proposal.id, proposal.id)
    assert.equal(json.proposal.status, 'confirmed')
    assert.equal(json.proposal.confirmedBy, 'louie')
    assert.equal(json.proposal.confirmedAt, proposal.confirmedAt)
    assert.ok(proposal.confirmedAt) // real, non-null
    // no leak
    for (const s of [PROMPT_SENTINEL, PATH_SENTINEL, 'sandbox', 'C:/Temp', '"task"']) {
      assert.ok(!raw.includes(s), `response must not leak "${s}"`)
    }
  } finally { server.close(); fs.rmSync(base, { recursive: true, force: true }) }
})

test('a FAILED execution result is readable', async () => {
  const { built, store, base } = buildApp()
  const server = built.listen(0)
  try {
    const { proposal, runId } = await seedConfirmed(built)
    const taskId = seedExecution(store, { proposalId: proposal.id, runId, confirmedBy: proposal.confirmedBy, confirmedAt: proposal.confirmedAt })
    seedResult(store, { taskId, proposalId: proposal.id, ok: false, error: 'worker exited non-zero' })

    const { status, json } = await get(server, `/api/v1/proposals/${proposal.id}/result`)
    assert.equal(status, 200)
    assert.equal(json.status, 'failed')
    assert.equal(json.ok, false)
    assert.equal(json.error, 'worker exited non-zero')
    assert.equal(json.exitCode, null)
  } finally { server.close(); fs.rmSync(base, { recursive: true, force: true }) }
})

test('unknown proposalId → 404', async () => {
  const { built, base } = buildApp()
  const server = built.listen(0)
  try {
    const { status } = await get(server, '/api/v1/proposals/prop_doesnotexist/result')
    assert.equal(status, 404)
  } finally { server.close(); fs.rmSync(base, { recursive: true, force: true }) }
})

test('proposal confirmed but no execution → 200 pending; execution but no result → 200 running', async () => {
  const { built, store, base } = buildApp()
  const server = built.listen(0)
  try {
    const { proposal, runId } = await seedConfirmed(built)
    // no execution yet
    let r = await get(server, `/api/v1/proposals/${proposal.id}/result`)
    assert.equal(r.status, 200)
    assert.equal(r.json.status, 'pending')
    assert.equal(r.json.executionId, null)

    // execution, no result
    seedExecution(store, { proposalId: proposal.id, runId, confirmedBy: proposal.confirmedBy, confirmedAt: proposal.confirmedAt })
    r = await get(server, `/api/v1/proposals/${proposal.id}/result`)
    assert.equal(r.status, 200)
    assert.equal(r.json.status, 'running')
  } finally { server.close(); fs.rmSync(base, { recursive: true, force: true }) }
})

test('missing result file (deleted) is handled safely — running, not a crash', async () => {
  const { built, store, base } = buildApp()
  const server = built.listen(0)
  try {
    const { proposal, runId } = await seedConfirmed(built)
    const taskId = seedExecution(store, { proposalId: proposal.id, runId, confirmedBy: proposal.confirmedBy, confirmedAt: proposal.confirmedAt })
    seedResult(store, { taskId, proposalId: proposal.id, ok: true, exit: 0, result: 'x', cost: 0 })
    fs.rmSync(store.dirFor('results'), { recursive: true, force: true }) // result vanished

    const { status, json } = await get(server, `/api/v1/proposals/${proposal.id}/result`)
    assert.equal(status, 200)
    assert.equal(json.status, 'running')
  } finally { server.close(); fs.rmSync(base, { recursive: true, force: true }) }
})

test('malformed result artifact → controlled 500, no crash, no path leak', async () => {
  const { built, store, base } = buildApp()
  const server = built.listen(0)
  try {
    const { proposal, runId } = await seedConfirmed(built)
    seedExecution(store, { proposalId: proposal.id, runId, confirmedBy: proposal.confirmedBy, confirmedAt: proposal.confirmedAt })
    fs.mkdirSync(store.dirFor('results'), { recursive: true })
    fs.writeFileSync(path.join(store.dirFor('results'), '2026-07-11T12-00-09-000Z-res_bad.json'), '{ this is not json')

    const { status, json, raw } = await get(server, `/api/v1/proposals/${proposal.id}/result`)
    assert.equal(status, 500)
    assert.match(json.error, /unreadable/)
    assert.ok(!raw.includes(base) && !raw.includes('.aroma') && !raw.includes('Temp'), 'no path leak in error')
  } finally { server.close(); fs.rmSync(base, { recursive: true, force: true }) }
})

test('traversal / malformed id → 400 and the store is NEVER touched', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-read-lm-'))
  const landmine = { dirFor: () => { throw new Error('STORE_TOUCHED') } } // any access explodes
  const built = createApp({ dispatcher: async () => {}, workerDeps: { artifactStore: landmine, runner: { run: async () => {} } }, proposalPersistence: false, runPersistence: false })
  const server = built.listen(0)
  try {
    for (const badId of ['a.b', 'a..b', 'x'.repeat(65), 'has%20space']) {
      const { status } = await get(server, `/api/v1/proposals/${badId}/result`)
      assert.equal(status, 400, `invalid id ${JSON.stringify(badId)} must be 400 (store untouched)`)
    }
    // encoded traversal must never yield 200 or a store error
    const enc = await get(server, '/api/v1/proposals/%2e%2e%2f%2e%2e%2fpasswd/result')
    assert.ok(enc.status === 400 || enc.status === 404, `got ${enc.status}`)
    assert.notEqual(enc.status, 200)
    assert.ok(!enc.raw.includes('STORE_TOUCHED'), 'store must not be reached for a bad id')
  } finally { server.close(); fs.rmSync(base, { recursive: true, force: true }) }
})
