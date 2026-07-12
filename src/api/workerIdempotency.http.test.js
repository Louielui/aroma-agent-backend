'use strict'

/**
 * workerIdempotency.http.test.js — B2-14 sandbox-worker idempotency, over the
 * REAL confirm handler + scheduleWorker wiring. Injected SPY runner (records
 * every run.run call); ZERO paid, ZERO real worker. Proves:
 *   - flag ON  → the worker fires ONCE, an IMMUTABLE WORKER_CLAIMED is written to
 *                the run, and a second claim on the same run is REFUSED
 *                (already_dispatched) — so a re-schedule can never double-spawn;
 *   - flag OFF → the B2-9 auth gate stays FIRST: 0 claim, 0 worker.
 *
 *   Run: node --test src/api/workerIdempotency.http.test.js
 */

process.env.LLM_PROVIDER = 'mock'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../app')

const TOKEN = 'svc-token-aroma-os'

function buildApp () {
  const spy = [] // every runner.run({runId,...}) call
  const runner = { run: async (ctx) => { spy.push(ctx); return { ok: true } } }
  const built = createApp({ dispatcher: async () => {}, workerDeps: { runner }, proposalPersistence: false, runPersistence: false })
  return { built, spy }
}

async function seedProposal (built) {
  const developLlm = async () => ({ intent: 'develop', task: 'create hello.txt', targetProject: 'frontend' })
  const { proposal } = await built.locals.proposalStore.propose({ conversationId: 'c', message: 'add a field', llm: developLlm })
  return proposal.id
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

const workerClaims = (run) => run.timeline.filter(e => e.stage === 'WORKER_CLAIMED').length

test('flag ON: worker fires ONCE, WORKER_CLAIMED is immutable, a re-claim is refused', async () => {
  process.env.WORKER_INVOCATION = 'on'
  delete process.env.DEVELOP_DISPATCH
  const { built, spy } = buildApp()
  const server = built.listen(0)
  try {
    const pid = await seedProposal(built)
    const { status, json } = await confirm(server, pid)
    assert.equal(status, 201)
    assert.equal(json.dispatchStatus, 'worker_scheduled')

    const fired = await waitFor(() => spy.length > 0)
    assert.ok(fired, 'the worker must fire after the response')
    assert.equal(spy.length, 1, 'exactly one sandbox execution')
    assert.equal(spy[0].runId, json.runId)

    const run = built.locals.runStore.getRun(json.runId)
    assert.equal(workerClaims(run), 1, 'WORKER_CLAIMED written exactly once')

    // a second claim on the same run is refused → a re-schedule can never double-spawn.
    const again = built.locals.runStore.claimWorker(json.runId)
    assert.equal(again.status, 'already_dispatched')
    assert.equal(workerClaims(built.locals.runStore.getRun(json.runId)), 1, 'claim stays immutable')
    assert.equal(spy.length, 1, 'still exactly one execution')
  } finally { delete process.env.WORKER_INVOCATION; server.close() }
})

test('flag OFF: B2-9 auth gate first → 0 claim, 0 worker', async () => {
  delete process.env.WORKER_INVOCATION
  delete process.env.DEVELOP_DISPATCH
  const { built, spy } = buildApp()
  const server = built.listen(0)
  try {
    const pid = await seedProposal(built)
    const { status, json } = await confirm(server, pid)
    assert.equal(status, 201)
    assert.equal(json.dispatchStatus, 'not_authorized')

    await new Promise(r => setTimeout(r, 150)) // give any wrongly-scheduled worker a chance
    assert.equal(spy.length, 0, 'flag-off → 0 worker')
    assert.equal(workerClaims(built.locals.runStore.getRun(json.runId)), 0, 'flag-off → 0 claim')
  } finally { server.close() }
})
