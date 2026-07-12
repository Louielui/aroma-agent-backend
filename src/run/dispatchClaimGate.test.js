'use strict'

/**
 * dispatchClaimGate.test.js — B2-13 execution idempotency. The synchronous,
 * non-yielding Dispatch Claim Gate makes DISPATCH_CLAIMED the atomic claim.
 * Deterministic; injected spy dispatcher + resultEvidence + persistence; ZERO
 * paid, ZERO real dispatch.
 *
 *   Run: node --test src/run/dispatchClaimGate.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createRunStore } = require('./store')
const runPersist = require('./runPersistence')

function tmpFile () { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-gate-')); return path.join(d, 'aroma-runs.json') }
const INPUT = (o = {}) => ({ task: 't', targetProject: 'backend', capabilityId: 'Develop', version: 1, ...o })
const claimCount = (store, id) => store.getRun(id).timeline.filter(e => e.stage === 'DISPATCH_CLAIMED').length
const rec = (id, stages) => ({ id, owner: 'louie', workspace: 'default', conversationId: null, goal: null, task: 't', intent: null, targetProject: 'backend', capabilityId: 'Develop', version: 1, timeline: stages.map(s => ({ stage: s, at: '2026-07-12T00:00:00.000Z', facts: {} })), createdAt: '2026-07-12T00:00:00.000Z' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

test('first dispatch → claim written once + spawn once', async () => {
  const spy = []
  const store = createRunStore({ dispatcher: async () => { spy.push(1) }, authorizeDispatch: () => true, persistence: tmpFile() })
  const id = store.startRun(INPUT())
  assert.equal(claimCount(store, id), 1)
  await sleep(20)
  assert.equal(spy.length, 1)
})

test('double re-dispatch of the SAME run → ONE spawn; 2nd already_dispatched; claim IMMUTABLE (count stays 1)', async () => {
  const spy = []
  const store = createRunStore({ dispatcher: async () => { spy.push(1) }, authorizeDispatch: () => true, persistence: tmpFile() })
  const id = store.startRun(INPUT()) // first dispatch
  const again = store.dispatchRun(id) // same gate — must refuse
  assert.equal(again.dispatchStatus, 'already_dispatched')
  assert.equal(claimCount(store, id), 1, 'the claim is NEVER re-written')
  await sleep(20)
  assert.equal(spy.length, 1, 'exactly one spawn across both dispatch attempts')
})

test('claimDispatch back-to-back (no event-loop yield) → one dispatched, one already_dispatched (no interleave); count stays 1', async () => {
  let authorized = false
  const spy = []
  const store = createRunStore({ dispatcher: async () => { spy.push(1) }, authorizeDispatch: () => authorized, persistence: tmpFile() })
  const id = store.startRun(INPUT()) // authorizeDispatch false → run created, NOT claimed
  assert.equal(claimCount(store, id), 0)
  authorized = true
  const a = store.claimDispatch(id) // synchronous gate
  const b = store.claimDispatch(id) // immediately, same tick — no yield between
  assert.equal(a.status, 'dispatched')
  assert.equal(b.status, 'already_dispatched')
  assert.equal(claimCount(store, id), 1, 'exactly one claim event — immutable')
  await sleep(20)
  assert.equal(spy.length, 0, 'claimDispatch itself NEVER spawns (pure gate)')
})

test('durable terminal result (resultEvidence ok) → already_completed; NO claim, NO spawn', async () => {
  const spy = []
  const store = createRunStore({ dispatcher: async () => { spy.push(1) }, authorizeDispatch: () => false, persistence: tmpFile(), resultEvidence: () => ({ kind: 'ok' }) })
  const id = store.startRun(INPUT())
  const g = store.claimDispatch(id)
  assert.equal(g.status, 'already_completed')
  assert.equal(claimCount(store, id), 0, 'no claim written for a completed run')
  await sleep(20)
  assert.equal(spy.length, 0)
})

test('completed-terminal timeline (COMPLETED) → already_completed', () => {
  const file = tmpFile()
  runPersist.save(file, { order: ['run_done'], runs: { run_done: rec('run_done', ['TASK_CREATED', 'DISPATCH_CLAIMED', 'PENDING_APPROVAL', 'APPLYING', 'COMPLETED']) } })
  const store = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => true, persistence: file })
  assert.equal(store.claimDispatch('run_done').status, 'already_completed')
})

test('corrupt/inconsistent evidence (safe-load null/throw) → needs_review; NOT guessed, NO claim, NO spawn', async () => {
  const spy = []
  const corruptStore = createRunStore({ dispatcher: async () => { spy.push(1) }, authorizeDispatch: () => false, persistence: tmpFile(), resultEvidence: () => ({ kind: 'corrupt' }) })
  const id1 = corruptStore.startRun(INPUT())
  assert.equal(corruptStore.claimDispatch(id1).status, 'needs_review')
  assert.equal(claimCount(corruptStore, id1), 0)

  // resultEvidence THROWING is also treated as corrupt → needs_review (fail-closed)
  const throwStore = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => false, persistence: tmpFile(), resultEvidence: () => { throw new Error('boom') } })
  const id2 = throwStore.startRun(INPUT())
  assert.equal(throwStore.claimDispatch(id2).status, 'needs_review')
  await sleep(20)
  assert.equal(spy.length, 0)
})

test('claim FLUSH failure → dispatch_claim_failed (fail-closed); NO spawn', async () => {
  let authorized = false
  const spy = []
  const save = (data) => { if (JSON.stringify(data).includes('DISPATCH_CLAIMED')) throw new Error('disk full') }
  const load = () => ({ order: [], runs: {} })
  const store = createRunStore({ dispatcher: async () => { spy.push(1) }, authorizeDispatch: () => authorized, persistence: { load, save } })
  const id = store.startRun(INPUT()) // createRun flush has no DISPATCH_CLAIMED → save ok
  authorized = true
  const g = store.claimDispatch(id) // appends DISPATCH_CLAIMED → flush save() throws
  assert.equal(g.status, 'dispatch_claim_failed')
  await sleep(20)
  assert.equal(spy.length, 0, 'no spawn without a durable claim')
})

test('durable claim protects across RESTART: re-dispatch after restart → already_dispatched, no spawn', async () => {
  const file = tmpFile()
  const s1 = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => true, persistence: file })
  const id = s1.startRun(INPUT()) // claimed + flushed to disk
  // restart: fresh store loads the durable DISPATCH_CLAIMED
  const spy = []
  const s2 = createRunStore({ dispatcher: async () => { spy.push(1) }, authorizeDispatch: () => true, persistence: file })
  const g = s2.dispatchRun(id)
  assert.equal(g.dispatchStatus, 'already_dispatched')
  assert.equal(claimCount(s2, id), 1)
  await sleep(20)
  assert.equal(spy.length, 0, 'the durable claim refuses a post-restart re-dispatch')
})

test('B2-9 preserved: flag-off (authorizeDispatch false) → not_authorized, 0 claim, 0 execution', async () => {
  const spy = []
  const store = createRunStore({ dispatcher: async () => { spy.push(1) }, authorizeDispatch: () => false, persistence: tmpFile() })
  const id = store.startRun(INPUT())
  assert.equal(claimCount(store, id), 0, 'flag-off → 0 claim')
  assert.equal(store.dispatchRun(id).dispatchStatus, 'not_authorized')
  await sleep(20)
  assert.equal(spy.length, 0, 'flag-off → 0 execution')
})
