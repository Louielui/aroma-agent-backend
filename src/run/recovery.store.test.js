'use strict'

/**
 * recovery.store.test.js — B2-11b startup reconcile (pure mark, zero dispatch,
 * idempotent, crash-boundary matrix) + human-gated retry (new attempt, original
 * preserved, no auto-dispatch, duplicate → 409). Deterministic; injected fakes;
 * zero paid, zero real dispatch.
 *
 *   Run: node --test src/run/recovery.store.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createRunStore } = require('./store')
const runModel = require('./run')
const runPersist = require('./runPersistence')

function tmpFile () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-recover-'))
  return path.join(dir, 'aroma-runs.json')
}
const rec = (id, stages) => ({
  id, owner: 'louie', workspace: 'default', conversationId: null, goal: null,
  task: 't', intent: null, targetProject: 'backend', capabilityId: 'Develop', version: 1,
  timeline: stages.map(s => ({ stage: s, at: '2026-07-12T00:00:00.000Z', facts: {} })),
  createdAt: '2026-07-12T00:00:00.000Z'
})
const status = (store, id) => runModel.deriveStatus(store.getRun(id))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

test('startup reconcile: crash-boundary matrix marks correctly + dispatcher spy 0 + idempotent', async () => {
  const file = tmpFile()
  // Seed runs at each crash boundary directly on disk.
  runPersist.save(file, {
    order: ['run_pending', 'run_claimed', 'run_exec', 'run_succ', 'run_fail', 'run_late'],
    runs: {
      run_pending: rec('run_pending', ['TASK_CREATED']), // (a) before dispatch → pending
      run_claimed: rec('run_claimed', ['TASK_CREATED', 'DISPATCH_CLAIMED']), // (b) claimed, no exec → interrupted
      run_exec: rec('run_exec', ['TASK_CREATED', 'DISPATCH_CLAIMED']), // (c) exec, no result → interrupted
      run_succ: rec('run_succ', ['TASK_CREATED', 'DISPATCH_CLAIMED']), // (d) result ok → succeeded
      run_fail: rec('run_fail', ['TASK_CREATED', 'DISPATCH_CLAIMED']), // (e) result not-ok → failed
      run_late: rec('run_late', ['TASK_CREATED', 'DISPATCH_CLAIMED']) // (f) result present, timeline not updated → succeeded
    }
  })

  const findExecution = (runId) => (['run_exec', 'run_succ', 'run_fail', 'run_late'].includes(runId) ? { id: `task_${runId}`, runId, proposalId: 'prop_x' } : null)
  const findResult = (execId) => {
    if (execId === 'task_run_succ' || execId === 'task_run_late') return { ok: true }
    if (execId === 'task_run_fail') return { ok: false }
    return null // run_exec: mid-result / no result → safe-load null → interrupted
  }

  const spy = []
  const store = createRunStore({ dispatcher: async () => { spy.push(1) }, persistence: file })
  const out = store.reconcile({ findExecution, findResult })
  await sleep(30)

  assert.equal(spy.length, 0, 'reconcile + load triggers ZERO dispatch')
  assert.equal(out.reconciled, 6)
  assert.equal(status(store, 'run_pending'), 'pending')
  assert.equal(status(store, 'run_claimed'), 'interrupted')
  assert.equal(status(store, 'run_exec'), 'interrupted')
  assert.equal(status(store, 'run_succ'), 'succeeded')
  assert.equal(status(store, 'run_fail'), 'failed')
  assert.equal(status(store, 'run_late'), 'succeeded') // from the durable result artifact

  // idempotent: a second reconcile marks nothing new, still zero dispatch
  const again = store.reconcile({ findExecution, findResult })
  assert.equal(again.reconciled, 0)
  await sleep(10)
  assert.equal(spy.length, 0)
})

test('reconcile is durable + persists the mark (survives restart)', async () => {
  const file = tmpFile()
  runPersist.save(file, { order: ['run_c'], runs: { run_c: rec('run_c', ['TASK_CREATED', 'DISPATCH_CLAIMED']) } })
  const s1 = createRunStore({ dispatcher: async () => {}, persistence: file })
  s1.reconcile({ findExecution: () => null, findResult: () => null })
  assert.equal(status(s1, 'run_c'), 'interrupted')
  // restart: a fresh store loads the RECONCILED_INTERRUPTED mark from disk
  const s2 = createRunStore({ dispatcher: async () => {}, persistence: file })
  assert.equal(status(s2, 'run_c'), 'interrupted')
})

test('reconcile skips already-terminal runs (no mark on a COMPLETED run)', () => {
  const file = tmpFile()
  runPersist.save(file, { order: ['run_done'], runs: { run_done: rec('run_done', ['TASK_CREATED', 'DISPATCH_CLAIMED', 'PENDING_APPROVAL', 'APPLYING', 'COMPLETED']) } })
  const store = createRunStore({ dispatcher: async () => {}, persistence: file })
  const out = store.reconcile({ findExecution: () => null, findResult: () => null })
  assert.equal(out.reconciled, 0)
  assert.equal(status(store, 'run_done'), 'completed') // settled — untouched
})

test('retry: INTERRUPTED → new attempt (linkage), original preserved, NO auto-dispatch, still gated', async () => {
  const file = tmpFile()
  runPersist.save(file, { order: ['run_i'], runs: { run_i: rec('run_i', ['TASK_CREATED', 'DISPATCH_CLAIMED']) } })
  const spy = []
  const store = createRunStore({ dispatcher: async () => { spy.push(1) }, persistence: file })
  store.reconcile({ findExecution: () => ({ id: 'task_prior', runId: 'run_i', proposalId: 'prop_9' }), findResult: () => null })
  assert.equal(status(store, 'run_i'), 'interrupted')

  const before = store.getRun('run_i') // snapshot to prove preservation
  const spyBefore = spy.length
  const attempt = store.retry('run_i', { reason: 'Louie: retry the interrupted dispatch', findExecution: () => ({ id: 'task_prior', runId: 'run_i', proposalId: 'prop_9' }) })
  await sleep(20)

  // new attempt with full linkage, inert
  assert.notEqual(attempt.attemptId, 'run_i')
  assert.equal(attempt.priorRunId, 'run_i')
  assert.equal(attempt.priorExecutionId, 'task_prior')
  assert.equal(attempt.proposalId, 'prop_9')
  assert.equal(attempt.status, 'retry_pending') // inert — NOT dispatched
  assert.equal(attempt.retryApprovedBy, 'louie')
  assert.ok(attempt.retryApprovedAt)
  const newRun = store.getRun(attempt.attemptId)
  const ra = newRun.timeline.find(e => e.stage === 'RETRY_ATTEMPT')
  assert.equal(ra.facts.priorRunId, 'run_i')
  assert.equal(ra.facts.retryReason, 'Louie: retry the interrupted dispatch')

  // retry did NOT dispatch
  assert.equal(spy.length, spyBefore, 'retry NEVER auto-dispatches (new attempt is inert)')
  // original preserved byte-for-byte
  assert.deepEqual(store.getRun('run_i'), before)
})

test('retry guards: non-interrupted → 409; missing reason → 422; duplicate retry → 409 (no second attempt)', () => {
  const file = tmpFile()
  runPersist.save(file, { order: ['run_i', 'run_p'], runs: { run_i: rec('run_i', ['TASK_CREATED', 'DISPATCH_CLAIMED']), run_p: rec('run_p', ['TASK_CREATED']) } })
  const store = createRunStore({ dispatcher: async () => {}, persistence: file })
  store.reconcile({ findExecution: () => null, findResult: () => null })

  // run_p is PENDING → not retryable
  assert.throws(() => store.retry('run_p', { reason: 'x' }), /not interrupted/)
  // missing reason → 422
  assert.throws(() => store.retry('run_i', { reason: '' }), /explicit reason/)
  // first retry ok
  const first = store.retry('run_i', { reason: 'go' })
  // duplicate retry of the SAME interrupted attempt → 409, no second attempt
  const countBefore = store.listRuns().length
  assert.throws(() => store.retry('run_i', { reason: 'again' }), /already retried/)
  assert.equal(store.listRuns().length, countBefore, 'no second attempt created')
  assert.ok(first.attemptId)
})
