'use strict'

/**
 * flagScopeContainment.test.js — B2-9. Proves a confirm triggers NO real
 * execution unless explicitly authorized, and that WORKER_INVOCATION and
 * DEVELOP_DISPATCH are independent, fail-closed flags.
 *
 * Everything is driven by SPY / LANDMINE injectables — NO real Claude Develop,
 * NO real repo, NO paid call, NO worker spawn, NO patch. The productionDispatcher
 * is never built (no dispatcher is injected/configured in any case).
 *
 *   Run: node --test src/api/flagScopeContainment.test.js
 */

const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const app = require('../app')
const { createApp, resolveDevelopDispatch, resolveExecutionAuthorization } = app

const { TEST_SERVICE_TOKEN: TOKEN } = require('./_serviceTokenFixture') // B2-15: explicit test token
const inertArtifactStore = {
  write () { throw new Error('no artifact write in containment test') },
  list () { return [] },
  read () { return null },
  dirFor (k) { return k }
}

afterEach(() => {
  delete process.env.WORKER_INVOCATION
  delete process.env.DEVELOP_DISPATCH
})

// ── STEP 2: resolver + authorization-gate unit tests (pure) ──────────────────

test('resolveDevelopDispatch: strict on only — unset/empty/wrong-case/misspelled → off', () => {
  delete process.env.DEVELOP_DISPATCH
  assert.equal(resolveDevelopDispatch(), 'off')
  for (const bad of ['', 'ON', 'On', 'true', '1', 'yes', 'enabled', 'onn', ' on', 'off ', 'develop']) {
    process.env.DEVELOP_DISPATCH = bad
    assert.equal(resolveDevelopDispatch(), 'off', `"${bad}" must resolve off`)
  }
  process.env.DEVELOP_DISPATCH = 'off'
  assert.equal(resolveDevelopDispatch(), 'off')
  process.env.DEVELOP_DISPATCH = 'on'
  assert.equal(resolveDevelopDispatch(), 'on')
})

test('resolveExecutionAuthorization: fail-closed matrix, no implicit priority', () => {
  const set = (w, d) => { if (w == null) delete process.env.WORKER_INVOCATION; else process.env.WORKER_INVOCATION = w; if (d == null) delete process.env.DEVELOP_DISPATCH; else process.env.DEVELOP_DISPATCH = d }

  // both on → conflict, nothing authorized (regardless of dispatcherConfigured)
  set('on', 'on')
  assert.deepEqual(resolveExecutionAuthorization(true), { status: 'configuration_conflict', workerAuthorized: false, developAuthorized: false })

  // develop on + dispatcher configured + worker off → develop authorized
  set('off', 'on')
  assert.equal(resolveExecutionAuthorization(true).status, 'develop_authorized')
  assert.equal(resolveExecutionAuthorization(true).developAuthorized, true)

  // develop on but NO dispatcher configured → not authorized (never falls back)
  assert.equal(resolveExecutionAuthorization(false).status, 'not_authorized')
  assert.equal(resolveExecutionAuthorization(false).developAuthorized, false)

  // worker on, develop off → worker authorized, develop not
  set('on', 'off')
  assert.equal(resolveExecutionAuthorization(true).status, 'worker_authorized')
  assert.equal(resolveExecutionAuthorization(true).workerAuthorized, true)
  assert.equal(resolveExecutionAuthorization(true).developAuthorized, false)

  // both off → nothing
  set('off', 'off')
  assert.equal(resolveExecutionAuthorization(true).status, 'not_authorized')
})

// ── STEP 6: full A–F HTTP matrix (spy dispatcher + landmine worker) ───────────

function makeSpyDispatcher () {
  const calls = []
  const fn = async (args) => { calls.push({ phase: args && args.phase }) }
  fn.calls = calls
  return fn
}

// Confirm one ready bridge proposal through a freshly-built app and report what
// actually fired. `dispatcher` (spy) is injected only when provided.
async function confirmCase ({ worker, develop, dispatcher }) {
  if (worker == null) delete process.env.WORKER_INVOCATION; else process.env.WORKER_INVOCATION = worker
  if (develop == null) delete process.env.DEVELOP_DISPATCH; else process.env.DEVELOP_DISPATCH = develop

  const workerState = { called: 0 }
  const landmineRunner = { run: async () => { workerState.called += 1 } }
  const opts = { serviceToken: TOKEN, workerDeps: { runner: landmineRunner, artifactStore: inertArtifactStore }, proposalPersistence: false, runPersistence: false }
  if (dispatcher) opts.dispatcher = dispatcher

  const built = createApp(opts)
  const server = built.listen(0)
  try {
    const ps = built.locals.proposalStore
    const p = ps.createBridgeProposal({ task: 'Title: containment\n\nDetails: no real execution', sourceTaskId: 'task_c9' })
    ps.setLinkState(p.id, 'ready')
    const { port } = server.address()
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/proposals/${p.id}/confirm`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}'
    })
    const json = await res.json()
    await new Promise(r => setTimeout(r, 120)) // let setImmediate dispatch + microtask worker settle
    return { status: res.status, json, workerCalled: workerState.called, proposal: ps.getProposal(p.id) }
  } finally { server.close() }
}

test('Case A: WORKER off, DEVELOP off → dispatcher 0, worker 0, not_authorized, proposal confirmed', async () => {
  const spy = makeSpyDispatcher()
  const r = await confirmCase({ worker: undefined, develop: undefined, dispatcher: spy })
  assert.equal(r.status, 201)
  assert.equal(r.json.proposalStatus, 'confirmed')
  assert.equal(r.json.dispatchStatus, 'not_authorized')
  assert.equal(spy.calls.length, 0, 'spy dispatcher must NOT be called')
  assert.equal(r.workerCalled, 0, 'sandbox worker must NOT run')
  assert.equal(r.proposal.status, 'confirmed') // proposal still confirmed + persisted
})

test('Case B: WORKER on, DEVELOP off → sandbox worker runs; Develop dispatcher 0', async () => {
  const spy = makeSpyDispatcher()
  const r = await confirmCase({ worker: 'on', develop: undefined, dispatcher: spy })
  assert.equal(r.json.dispatchStatus, 'worker_scheduled')
  assert.equal(r.workerCalled, 1, 'sandbox worker runs under WORKER on')
  assert.equal(spy.calls.length, 0, 'Develop dispatcher must NOT fire (DEVELOP off)')
})

test('Case C: WORKER off, DEVELOP on, dispatcher INJECTED → dispatcher called exactly 1; worker 0', async () => {
  const spy = makeSpyDispatcher()
  const r = await confirmCase({ worker: undefined, develop: 'on', dispatcher: spy })
  assert.equal(r.json.dispatchStatus, 'develop_dispatched')
  assert.equal(spy.calls.length, 1, 'the injected dispatcher fires exactly once')
  assert.equal(spy.calls[0].phase, 'develop')
  assert.equal(r.workerCalled, 0, 'sandbox worker must NOT run')
})

test('Case C2: WORKER off, DEVELOP on, NO dispatcher injected → nothing dispatched; not_authorized (no productionDispatcher fallback)', async () => {
  const r = await confirmCase({ worker: undefined, develop: 'on', dispatcher: undefined })
  assert.equal(r.json.dispatchStatus, 'not_authorized')
  assert.equal(r.workerCalled, 0)
  // No dispatcher configured ⇒ developAuthorized is false even though DEVELOP='on'.
  assert.equal(resolveExecutionAuthorization(false).developAuthorized, false)
})

test('Case D: WORKER on, DEVELOP on → configuration_conflict, both paths 0, no side effects', async () => {
  const spy = makeSpyDispatcher()
  const r = await confirmCase({ worker: 'on', develop: 'on', dispatcher: spy })
  assert.equal(r.json.dispatchStatus, 'configuration_conflict')
  assert.equal(spy.calls.length, 0, 'no dispatcher under conflict')
  assert.equal(r.workerCalled, 0, 'no worker under conflict')
})

test('Case E: DEVELOP wrong-case/misspelled/illegal → treated as off; dispatcher 0', async () => {
  for (const bad of ['ON', 'On', 'true', 'yes', 'enabled', 'onn']) {
    const spy = makeSpyDispatcher()
    const r = await confirmCase({ worker: undefined, develop: bad, dispatcher: spy })
    assert.equal(r.json.dispatchStatus, 'not_authorized', `DEVELOP="${bad}" must be off`)
    assert.equal(spy.calls.length, 0, `DEVELOP="${bad}" must not dispatch`)
  }
})

test('Case F: an injected spy is the ONLY dispatcher reached — production wiring never touched', async () => {
  // With a spy injected and DEVELOP on, the SPY is what fires (proving no real
  // productionDispatcher path is taken); with DEVELOP off, nothing fires.
  const spyOn = makeSpyDispatcher()
  await confirmCase({ worker: undefined, develop: 'on', dispatcher: spyOn })
  assert.equal(spyOn.calls.length, 1)
  const spyOff = makeSpyDispatcher()
  await confirmCase({ worker: undefined, develop: undefined, dispatcher: spyOff })
  assert.equal(spyOff.calls.length, 0)
})
