'use strict'

/**
 * workerClaimGate.test.js — B2-14 sandbox-worker idempotency. claimWorker is the
 * worker-track twin of claimDispatch, over an IMMUTABLE WORKER_CLAIMED event,
 * keyed by runId. Deterministic; injected resultEvidence + persistence; ZERO
 * paid, ZERO real worker.
 *
 *   Run: node --test src/run/workerClaimGate.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createRunStore } = require('./store')
const runModel = require('./run')
const runPersist = require('./runPersistence')

function tmpFile () { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-wclaim-')); return path.join(d, 'aroma-runs.json') }
const INPUT = (o = {}) => ({ task: 't', targetProject: 'backend', capabilityId: 'Develop', version: 1, ...o })
const workerClaims = (store, id) => store.getRun(id).timeline.filter(e => e.stage === 'WORKER_CLAIMED').length
const dispatchClaims = (store, id) => store.getRun(id).timeline.filter(e => e.stage === 'DISPATCH_CLAIMED').length
const rec = (id, stages) => ({ id, owner: 'louie', workspace: 'default', conversationId: null, goal: null, task: 't', intent: null, targetProject: 'backend', capabilityId: 'Develop', version: 1, timeline: stages.map(s => ({ stage: s, at: '2026-07-12T00:00:00.000Z', facts: {} })), createdAt: '2026-07-12T00:00:00.000Z' })

// A run WITHOUT a Develop claim (authorizeDispatch false → TASK_CREATED only),
// the realistic worker scenario (WORKER on, DEVELOP off).
function unclaimedRun (opts = {}) {
  const store = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => false, persistence: opts.persistence || tmpFile(), resultEvidence: opts.resultEvidence })
  const id = store.startRun(INPUT())
  return { store, id }
}

test('first worker claim → WORKER_CLAIMED written once; DISPATCH_CLAIMED untouched (distinct track)', () => {
  const { store, id } = unclaimedRun()
  const g = store.claimWorker(id)
  assert.equal(g.status, 'dispatched')
  assert.equal(workerClaims(store, id), 1)
  assert.equal(dispatchClaims(store, id), 0, 'worker track is distinct — no DISPATCH_CLAIMED written')
})

test('double claimWorker → one dispatched, one already_dispatched; WORKER_CLAIMED IMMUTABLE (count stays 1)', () => {
  const { store, id } = unclaimedRun()
  const a = store.claimWorker(id)
  const b = store.claimWorker(id)
  assert.equal(a.status, 'dispatched')
  assert.equal(b.status, 'already_dispatched')
  assert.equal(workerClaims(store, id), 1, 'the claim is never re-written')
})

test('durable terminal result (resultEvidence ok) → already_completed; NO claim', () => {
  const { store, id } = unclaimedRun({ resultEvidence: () => ({ kind: 'ok' }) })
  assert.equal(store.claimWorker(id).status, 'already_completed')
  assert.equal(workerClaims(store, id), 0)
})

test('completed-terminal timeline → already_completed', () => {
  const file = tmpFile()
  runPersist.save(file, { order: ['r'], runs: { r: rec('r', ['TASK_CREATED', 'WORKER_CLAIMED', 'PENDING_APPROVAL', 'APPLYING', 'COMPLETED']) } })
  const store = createRunStore({ dispatcher: async () => {}, persistence: file })
  assert.equal(store.claimWorker('r').status, 'already_completed')
})

test('corrupt evidence (safe-load null/throw) → needs_review; NO claim', () => {
  const { store: s1, id: id1 } = unclaimedRun({ resultEvidence: () => ({ kind: 'corrupt' }) })
  assert.equal(s1.claimWorker(id1).status, 'needs_review')
  assert.equal(workerClaims(s1, id1), 0)
  const { store: s2, id: id2 } = unclaimedRun({ resultEvidence: () => { throw new Error('boom') } })
  assert.equal(s2.claimWorker(id2).status, 'needs_review')
})

test('claim FLUSH failure → dispatch_claim_failed (fail-closed)', () => {
  let authorized = false
  const save = (data) => { if (JSON.stringify(data).includes('WORKER_CLAIMED')) throw new Error('disk full') }
  const load = () => ({ order: [], runs: {} })
  const store = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => authorized, persistence: { load, save } })
  const id = store.startRun(INPUT()) // createRun flush has no WORKER_CLAIMED → save ok
  authorized = true
  assert.equal(store.claimWorker(id).status, 'dispatch_claim_failed')
})

test('durable claim protects across RESTART: re-claim after restart → already_dispatched', () => {
  const file = tmpFile()
  const { store: s1, id } = unclaimedRun({ persistence: file })
  assert.equal(s1.claimWorker(id).status, 'dispatched')
  const s2 = createRunStore({ dispatcher: async () => {}, persistence: file })
  assert.equal(s2.claimWorker(id).status, 'already_dispatched')
  assert.equal(workerClaims(s2, id), 1)
})

// ── STEP 5 recovery interaction (B2-11b recovery UNCHANGED) ──────────────────
test('recovery: interrupted worker (WORKER_CLAIMED + Execution artifact, no result) → INTERRUPTED (branch c)', () => {
  const file = tmpFile()
  runPersist.save(file, { order: ['run_w'], runs: { run_w: rec('run_w', ['TASK_CREATED', 'WORKER_CLAIMED']) } })
  const store = createRunStore({ dispatcher: async () => {}, persistence: file })
  store.reconcile({ findExecution: (rid) => (rid === 'run_w' ? { id: 'task_e', runId: 'run_w', proposalId: 'p' } : null), findResult: () => null })
  assert.equal(runModel.deriveStatus(store.getRun('run_w')), 'interrupted', 'the free recovery benefit — via the Execution artifact, recovery unchanged')
})

test('SCOPED QUESTION (documented, NOT changed): WORKER_CLAIMED-only, no Execution artifact → still PENDING today', () => {
  const file = tmpFile()
  runPersist.save(file, { order: ['run_w2'], runs: { run_w2: rec('run_w2', ['TASK_CREATED', 'WORKER_CLAIMED']) } })
  const store = createRunStore({ dispatcher: async () => {}, persistence: file })
  store.reconcile({ findExecution: () => null, findResult: () => null })
  // recovery.js only recognizes DISPATCH_CLAIMED (not WORKER_CLAIMED) for the
  // no-execution-artifact window → PENDING. Recognizing WORKER_CLAIMED equivalently
  // is a 1-line recovery.js change — RAISED as a scoped question, NOT made here.
  assert.equal(runModel.deriveStatus(store.getRun('run_w2')), 'pending')
})
