'use strict'

/**
 * returnReady.test.js — Human Relay Removal Phase 1. The return-ready view is a
 * PURE READ over durable artifacts: it lists finished (terminal) executions as
 * decision-ready summaries, reusing B2-8 buildResultView. These tests prove it
 * lists correctly, excludes non-terminal, links provenance, never dispatches,
 * never mutates, never over-exposes, survives corrupt files — and that the two
 * static routes are matched BEFORE the parametric /proposals/:id.
 * Deterministic; NO paid call, NO real dispatch.
 *
 *   Run: node --test src/api/returnReady.test.js
 */

process.env.LLM_PROVIDER = 'mock'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createApp } = require('../app')
const { createArtifactStore } = require('../store/artifactStore')
const { TEST_SERVICE_TOKEN } = require('./_serviceTokenFixture')

// A finished execution+result pair, plus its confirmed bridge proposal (for
// sourceTaskId + confirmedBy/At provenance). `ok` picks succeeded/failed.
function seedFinished (proposalStore, artifactStore, { n, ok, startedAt, finishedAt }) {
  const p = proposalStore.createBridgeProposal({ task: `brief ${n}`, sourceTaskId: `srctask_${n}` })
  proposalStore.setLinkState(p.id, 'ready')
  const runId = proposalStore.confirmProposal(p.id, 'louie')
  const taskId = `task_${n}`
  artifactStore.write('tasks', {
    id: taskId, createdAt: startedAt, kind: 'execution', proposalId: p.id, runId,
    task: `SENSITIVE PROMPT ${n}`, sandbox: `/tmp/secret-sandbox-${n}`,
    approval: { confirmedBy: 'louie', confirmedAt: startedAt }
  })
  artifactStore.write('results', {
    id: `result_${n}`, createdAt: finishedAt, kind: 'result', taskId, proposalId: p.id,
    ok, exit: ok ? 0 : 1, result: `summary ${n}`, cost: 0.01, relay: { toUser: 0, fromUser: 0, manual: 0 },
    sandbox: `/tmp/secret-sandbox-${n}`
  })
  return { proposalId: p.id, taskId }
}

function setup () {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-rr-'))
  const artifactStore = createArtifactStore({ baseDir: base })
  const dispatcherSpy = { n: 0 }
  const runnerSpy = { n: 0 }
  const built = createApp({
    serviceToken: TEST_SERVICE_TOKEN,
    dispatcher: async () => { dispatcherSpy.n += 1 }, // landmine — must stay 0 on a read
    workerDeps: { artifactStore, runner: { run: async () => { runnerSpy.n += 1 } } },
    proposalPersistence: false,
    runPersistence: false
  })
  const server = built.listen(0)
  const base_url = `http://127.0.0.1:${server.address().port}`
  return { built, server, base, base_url, artifactStore, dispatcherSpy, runnerSpy, proposalStore: built.locals.proposalStore }
}

const getJson = async (base_url, urlPath) => {
  const res = await fetch(`${base_url}${urlPath}`)
  return { status: res.status, body: await res.json() }
}
const cleanup = (ctx) => { ctx.server.close(); fs.rmSync(ctx.base, { recursive: true, force: true }) }

test('1. lists terminal results — succeeded + failed both present with correct summary', async () => {
  const ctx = setup()
  try {
    seedFinished(ctx.proposalStore, ctx.artifactStore, { n: 1, ok: true, startedAt: '2026-07-12T10:00:00.000Z', finishedAt: '2026-07-12T10:01:00.000Z' })
    seedFinished(ctx.proposalStore, ctx.artifactStore, { n: 2, ok: false, startedAt: '2026-07-12T11:00:00.000Z', finishedAt: '2026-07-12T11:02:00.000Z' })
    const { status, body } = await getJson(ctx.base_url, '/return-ready')
    assert.equal(status, 200)
    assert.equal(body.count, 2)
    assert.equal(body.malformed, 0)
    const byStatus = Object.fromEntries(body.items.map(i => [i.status, i]))
    assert.equal(byStatus.succeeded.resultSummary, 'summary 1')
    assert.equal(byStatus.succeeded.ok, true)
    assert.equal(byStatus.failed.resultSummary, 'summary 2')
    assert.equal(byStatus.failed.ok, false)
    // newest-finished-first: item 2 (11:02) before item 1 (10:01)
    assert.equal(body.items[0].status, 'failed')
  } finally { cleanup(ctx) }
})

test('2. provenance per item — proposalId, executionId, confirmedBy/At, sourceTaskId all resolve', async () => {
  const ctx = setup()
  try {
    const { proposalId, taskId } = seedFinished(ctx.proposalStore, ctx.artifactStore, { n: 7, ok: true, startedAt: '2026-07-12T09:00:00.000Z', finishedAt: '2026-07-12T09:00:30.000Z' })
    const { body } = await getJson(ctx.base_url, '/return-ready')
    const item = body.items[0]
    assert.equal(item.proposalId, proposalId)
    assert.equal(item.executionId, taskId)
    assert.equal(item.sourceTaskId, 'srctask_7')
    assert.equal(item.proposal.confirmedBy, 'louie')
    assert.ok(item.proposal.confirmedAt, 'confirmedAt present')
    assert.equal(item.proposal.id, proposalId)
  } finally { cleanup(ctx) }
})

test('3. non-terminal excluded — running (exec, no result) and pending (proposal, no exec) absent', async () => {
  const ctx = setup()
  try {
    // finished (included)
    seedFinished(ctx.proposalStore, ctx.artifactStore, { n: 1, ok: true, startedAt: '2026-07-12T10:00:00.000Z', finishedAt: '2026-07-12T10:01:00.000Z' })
    // running: an execution with NO matching result
    ctx.artifactStore.write('tasks', { id: 'task_running', createdAt: '2026-07-12T12:00:00.000Z', kind: 'execution', proposalId: 'prop_x', runId: 'run_x', task: 'x', sandbox: '/tmp/x' })
    // pending: a proposal with NO execution
    const p = ctx.proposalStore.createBridgeProposal({ task: 'pending brief', sourceTaskId: 'srctask_pending' })
    ctx.proposalStore.setLinkState(p.id, 'ready')
    const { body } = await getJson(ctx.base_url, '/return-ready')
    assert.equal(body.count, 1)
    assert.equal(body.items[0].executionId, 'task_1')
    assert.ok(!body.items.some(i => i.executionId === 'task_running'))
  } finally { cleanup(ctx) }
})

test('4. ROUTE ORDER — /proposals/results (alias) hits the list, NOT the :id handler; /return-ready works', async () => {
  const ctx = setup()
  try {
    seedFinished(ctx.proposalStore, ctx.artifactStore, { n: 1, ok: true, startedAt: '2026-07-12T10:00:00.000Z', finishedAt: '2026-07-12T10:01:00.000Z' })
    const alias = await getJson(ctx.base_url, '/api/v1/proposals/results')
    assert.equal(alias.status, 200)
    assert.ok(Array.isArray(alias.body.items), 'alias returns the list shape (items[]), not a proposal-by-id')
    assert.equal(alias.body.count, 1)
    // a real proposal-by-id lookup for the literal "results" would 404 — prove we did NOT hit it
    assert.ok(!('error' in alias.body), 'must not be the :id 404 handler')
    const canonical = await getJson(ctx.base_url, '/api/v1/return-ready')
    assert.equal(canonical.status, 200)
    assert.ok(Array.isArray(canonical.body.items))
  } finally { cleanup(ctx) }
})

test('5. zero dispatch on read — hitting the endpoint calls dispatcher/runner 0 times', async () => {
  const ctx = setup()
  try {
    seedFinished(ctx.proposalStore, ctx.artifactStore, { n: 1, ok: true, startedAt: '2026-07-12T10:00:00.000Z', finishedAt: '2026-07-12T10:01:00.000Z' })
    const d0 = ctx.dispatcherSpy.n; const r0 = ctx.runnerSpy.n
    await getJson(ctx.base_url, '/return-ready')
    await getJson(ctx.base_url, '/api/v1/proposals/results')
    assert.equal(ctx.dispatcherSpy.n, d0, 'dispatcher never called by the read')
    assert.equal(ctx.runnerSpy.n, r0, 'runner never called by the read')
  } finally { cleanup(ctx) }
})

test('6. read-only / no mutation — artifact files + proposal count unchanged after the call', async () => {
  const ctx = setup()
  try {
    seedFinished(ctx.proposalStore, ctx.artifactStore, { n: 1, ok: true, startedAt: '2026-07-12T10:00:00.000Z', finishedAt: '2026-07-12T10:01:00.000Z' })
    const snap = (kind) => fs.readdirSync(path.join(ctx.base, kind)).sort().join(',')
    const tasksBefore = snap('tasks'); const resultsBefore = snap('results')
    const propsBefore = ctx.proposalStore.listProposals().length
    await getJson(ctx.base_url, '/return-ready')
    assert.equal(snap('tasks'), tasksBefore, 'no task file added/removed')
    assert.equal(snap('results'), resultsBefore, 'no result file added/removed')
    assert.equal(ctx.proposalStore.listProposals().length, propsBefore, 'no proposal created')
  } finally { cleanup(ctx) }
})

test('7. allowlist / no over-exposure — items carry sourceTaskId but never task(prompt) or sandbox', async () => {
  const ctx = setup()
  try {
    seedFinished(ctx.proposalStore, ctx.artifactStore, { n: 1, ok: true, startedAt: '2026-07-12T10:00:00.000Z', finishedAt: '2026-07-12T10:01:00.000Z' })
    const { body } = await getJson(ctx.base_url, '/return-ready')
    const item = body.items[0]
    assert.ok(!('task' in item), 'prompt (task) must never be projected')
    assert.ok(!('sandbox' in item), 'sandbox path must never be projected')
    assert.equal(item.sourceTaskId, 'srctask_1')
    const serialized = JSON.stringify(item)
    assert.ok(!serialized.includes('SENSITIVE PROMPT'), 'no prompt content anywhere in the item')
    assert.ok(!serialized.includes('secret-sandbox'), 'no sandbox path anywhere in the item')
  } finally { cleanup(ctx) }
})

test('8. corrupt-artifact resilience — a malformed result file is skipped + counted, never crashes', async () => {
  const ctx = setup()
  try {
    seedFinished(ctx.proposalStore, ctx.artifactStore, { n: 1, ok: true, startedAt: '2026-07-12T10:00:00.000Z', finishedAt: '2026-07-12T10:01:00.000Z' })
    fs.writeFileSync(path.join(ctx.base, 'results', '2026-07-12T13-00-00-000Z-result_bad.json'), '{ this is not valid json')
    const { status, body } = await getJson(ctx.base_url, '/return-ready')
    assert.equal(status, 200)
    assert.equal(body.count, 1, 'the one good terminal item is still listed')
    assert.ok(body.malformed >= 1, 'the corrupt file is counted in malformed')
  } finally { cleanup(ctx) }
})

test('9. empty state — no artifacts → { items: [], count: 0, malformed: 0 }', async () => {
  const ctx = setup()
  try {
    const { status, body } = await getJson(ctx.base_url, '/return-ready')
    assert.equal(status, 200)
    assert.deepEqual(body, { items: [], count: 0, malformed: 0 })
  } finally { cleanup(ctx) }
})

test('10. filters — ?status= and ?since= narrow the list purely (no state)', async () => {
  const ctx = setup()
  try {
    seedFinished(ctx.proposalStore, ctx.artifactStore, { n: 1, ok: true, startedAt: '2026-07-12T10:00:00.000Z', finishedAt: '2026-07-12T10:01:00.000Z' })
    seedFinished(ctx.proposalStore, ctx.artifactStore, { n: 2, ok: false, startedAt: '2026-07-12T11:00:00.000Z', finishedAt: '2026-07-12T11:02:00.000Z' })
    const succ = await getJson(ctx.base_url, '/return-ready?status=succeeded')
    assert.equal(succ.body.count, 1)
    assert.equal(succ.body.items[0].status, 'succeeded')
    const failed = await getJson(ctx.base_url, '/return-ready?status=failed')
    assert.equal(failed.body.count, 1)
    assert.equal(failed.body.items[0].status, 'failed')
    // since: only the item finished AFTER 10:30 (item 2 @ 11:02) remains
    const since = await getJson(ctx.base_url, '/return-ready?since=2026-07-12T10:30:00.000Z')
    assert.equal(since.body.count, 1)
    assert.equal(since.body.items[0].executionId, 'task_2')
    // idempotent: unfiltered still returns both (no state was recorded by the filters)
    const all = await getJson(ctx.base_url, '/return-ready')
    assert.equal(all.body.count, 2)
  } finally { cleanup(ctx) }
})
