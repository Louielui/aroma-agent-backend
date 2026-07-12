'use strict'

/**
 * store.test.js — unit tests for the Run Store.
 *
 * Uses the built-in Node test runner (node:test), no extra dependencies.
 *   Run: node --test src/run/
 *
 * Every test injects a FAKE dispatcher. The REAL Claude Code adapter is never
 * imported and never invoked here — the store is exercised entirely against
 * fakes we control, so no test can start real work.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createRunStore: createRealRunStore } = require('./store')
// B2-10: every store in this file runs in-memory (persistence:false) so these
// process-local tests never touch disk or collide on the default runs file.
const createRunStore = (opts = {}) => createRealRunStore({ ...opts, persistence: false })
const { deriveStatus, isTerminal } = require('./run')

// --- tiny async helpers ----------------------------------------------------

/** A promise plus its resolve/reject, so a test can control exactly when a
 *  fake dispatcher settles. */
function deferred () {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** Poll `predicate` until it is truthy or the timeout elapses. */
function waitUntil (predicate, { timeout = 1000, interval = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      let ok
      try { ok = predicate() } catch (err) { return reject(err) }
      if (ok) return resolve()
      if (Date.now() - start > timeout) return reject(new Error('waitUntil timed out'))
      setTimeout(tick, interval)
    }
    tick()
  })
}

/** The stages recorded on a run, in order. */
function stagesOf (run) {
  return run.timeline.map(e => e.stage)
}

/** A well-formed input; individual tests override the fields they care about. */
function sampleInput (overrides = {}) {
  return {
    task: 'add a field to /health',
    targetProject: 'backend',
    capabilityId: 'Develop',
    version: 1,
    intent: 'develop',
    ...overrides
  }
}

// --- tests -----------------------------------------------------------------

test('startRun returns a run id immediately, before the dispatch has finished', async () => {
  const gate = deferred()
  const store = createRunStore({
    dispatcher: async ({ runContext }) => {
      runContext.appendStage('POLICY_EVALUATED', { verdict: 'allow', rule_id: 'default-allow' })
      await gate.promise
      runContext.appendStage('COMPLETED', { backupRef: 'bak_fake' })
    }
  })

  const id = store.startRun(sampleInput())

  // Returned synchronously, and at the moment it returns the run is NOT finished:
  // the dispatch is scheduled for a later turn and has not even started.
  assert.equal(typeof id, 'string')
  assert.match(id, /^run_/)
  const now = store.getRun(id)
  assert.equal(isTerminal(deriveStatus(now)), false)
  // B2-11a: the authorized dispatch synchronously records a durable DISPATCH_CLAIMED
  // marker before the (later-turn) spawn — so the seed timeline is TASK_CREATED +
  // DISPATCH_CLAIMED, still non-terminal, dispatcher not yet run.
  assert.deepEqual(stagesOf(now), ['TASK_CREATED', 'DISPATCH_CLAIMED'])

  // Let the run finish so nothing dangles past the test.
  gate.resolve()
  await waitUntil(() => isTerminal(deriveStatus(store.getRun(id))))
})

test('the timeline gains stages over time and the status becomes terminal once dispatch completes', async () => {
  const gate = deferred()
  const store = createRunStore({
    dispatcher: async ({ runContext }) => {
      runContext.appendStage('POLICY_EVALUATED', { verdict: 'allow', rule_id: 'default-allow' })
      runContext.appendStage('AGENT_SELECTED', { agentId: 'fake-agent' })
      runContext.appendStage('AGENT_RUNNING', { agentId: 'fake-agent' })
      await gate.promise
      runContext.appendStage('AGENT_FINISHED', { agentId: 'fake-agent', success: true })
      runContext.appendStage('COMPLETED', { backupRef: 'bak_fake' })
    }
  })

  const id = store.startRun(sampleInput())

  // While the dispatch is paused at the gate, stages accrue but the run is still
  // in flight (non-terminal).
  await waitUntil(() => stagesOf(store.getRun(id)).includes('AGENT_RUNNING'))
  const midway = store.getRun(id)
  assert.equal(isTerminal(deriveStatus(midway)), false)
  assert.ok(midway.timeline.length > 1)

  // Release the dispatch: it completes and the derived status is terminal.
  gate.resolve()
  await waitUntil(() => isTerminal(deriveStatus(store.getRun(id))))
  const done = store.getRun(id)
  assert.equal(deriveStatus(done), 'completed')
  assert.ok(stagesOf(done).includes('COMPLETED'))
})

test('getRun exposes the full timeline and the caller cannot mutate it', async () => {
  const store = createRunStore({
    dispatcher: async ({ runContext }) => {
      runContext.appendStage('POLICY_EVALUATED', { verdict: 'allow', rule_id: 'default-allow' })
      runContext.appendStage('AGENT_SELECTED', { agentId: 'fake-agent' })
      runContext.appendStage('COMPLETED', { backupRef: 'bak_fake' })
    }
  })

  const id = store.startRun(sampleInput())
  await waitUntil(() => isTerminal(deriveStatus(store.getRun(id))))

  const snapshot = store.getRun(id)
  const before = snapshot.timeline.length
  assert.ok(before >= 2) // TASK_CREATED + the dispatcher's stages

  // The returned snapshot is deeply frozen — mutation attempts throw and the
  // stored run is unchanged.
  assert.throws(() => snapshot.timeline.push({ stage: 'FAILED', at: 'now', facts: {} }))
  assert.throws(() => { snapshot.timeline[0].stage = 'HACKED' })

  const after = store.getRun(id)
  assert.equal(after.timeline.length, before)
  assert.equal(after.timeline[0].stage, 'TASK_CREATED')
})

test('startRun rejects a targetProject of production and never dispatches', () => {
  let dispatched = 0
  const store = createRunStore({
    dispatcher: async () => { dispatched += 1 }
  })

  assert.throws(() => store.startRun(sampleInput({ targetProject: 'production' })), RangeError)
  // No run was created and no dispatch was scheduled.
  assert.equal(dispatched, 0)
  assert.equal(store.listRuns().length, 0)
})

// The store hands the background dispatcher a frozen Run snapshot; app.js's
// productionDispatcher builds the Develop adapter input straight from that
// snapshot's targetProject (input.targetProject = run.targetProject), which is
// what steers the Claude Code adapter to the right project. These tests capture
// the snapshot the store dispatches and prove it carries the Run's targetProject,
// so a frontend Run can never be misdirected to the backend.

/** A fake develop dispatcher that records the params it was handed, then drives
 *  the Run to a terminal COMPLETED so nothing dangles past the test. */
function makeCapturingDispatcher () {
  const calls = []
  async function dispatcher (params) {
    calls.push(params)
    const { runContext } = params
    runContext.appendStage('POLICY_EVALUATED', { verdict: 'allow', rule_id: 'default-allow' })
    runContext.appendStage('COMPLETED', { backupRef: 'bak_fake' })
  }
  return { dispatcher, calls }
}

test('a frontend Run dispatches a snapshot carrying targetProject frontend (the adapter input the dispatcher builds)', async () => {
  const { dispatcher, calls } = makeCapturingDispatcher()
  const store = createRunStore({ dispatcher })

  const id = store.startRun(sampleInput({ targetProject: 'frontend' }))
  await waitUntil(() => isTerminal(deriveStatus(store.getRun(id))))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].run.targetProject, 'frontend')
})

test('a backend Run dispatches a snapshot carrying targetProject backend', async () => {
  const { dispatcher, calls } = makeCapturingDispatcher()
  const store = createRunStore({ dispatcher })

  const id = store.startRun(sampleInput({ targetProject: 'backend' }))
  await waitUntil(() => isTerminal(deriveStatus(store.getRun(id))))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].run.targetProject, 'backend')
})

test('the develop dispatch always carries the Run targetProject', async () => {
  const { dispatcher, calls } = makeCapturingDispatcher()
  const store = createRunStore({ dispatcher })

  for (const targetProject of ['frontend', 'backend']) {
    const id = store.startRun(sampleInput({ targetProject }))
    await waitUntil(() => isTerminal(deriveStatus(store.getRun(id))))
  }

  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.phase, 'develop')
    assert.ok(call.run.targetProject === 'frontend' || call.run.targetProject === 'backend')
    assert.notEqual(call.run.targetProject, 'production')
  }
})

test('a Run can never be created or dispatched with a targetProject of production', () => {
  const { dispatcher, calls } = makeCapturingDispatcher()
  const store = createRunStore({ dispatcher })

  assert.throws(() => store.startRun(sampleInput({ targetProject: 'production' })), RangeError)
  // No run was created and nothing was ever dispatched.
  assert.equal(store.listRuns().length, 0)
  assert.equal(calls.length, 0)
})

test('owner cannot be supplied by the caller — the store always sets it', async () => {
  const store = createRunStore({
    resolveOwner: () => 'server-owner',
    dispatcher: async ({ runContext }) => {
      runContext.appendStage('POLICY_EVALUATED', { verdict: 'allow', rule_id: 'default-allow' })
      runContext.appendStage('COMPLETED', { backupRef: 'bak_fake' })
    }
  })

  // The caller tries to smuggle in an owner; it must be ignored.
  const id = store.startRun(sampleInput({ owner: 'attacker' }))
  const run = store.getRun(id)
  assert.equal(run.owner, 'server-owner')
  assert.notEqual(run.owner, 'attacker')

  await waitUntil(() => isTerminal(deriveStatus(store.getRun(id))))
})

test('a rejecting dispatcher yields a FAILED stage carrying the error, no unhandled rejection, terminal status', async () => {
  const rejections = []
  const onRejection = (err) => rejections.push(err)
  process.on('unhandledRejection', onRejection)

  try {
    const store = createRunStore({
      dispatcher: async ({ runContext }) => {
        runContext.appendStage('POLICY_EVALUATED', { verdict: 'allow', rule_id: 'default-allow' })
        throw new Error('worker exploded')
      }
    })

    const id = store.startRun(sampleInput())
    await waitUntil(() => isTerminal(deriveStatus(store.getRun(id))))

    const run = store.getRun(id)
    const failed = run.timeline.find(e => e.stage === 'FAILED')
    assert.ok(failed, 'a FAILED stage must be recorded')
    assert.equal(failed.facts.error, 'worker exploded')
    assert.equal(deriveStatus(run), 'failed')
    assert.equal(isTerminal(deriveStatus(run)), true)

    // Give any stray rejection a turn to surface, then assert there were none.
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(rejections.length, 0, 'the background failure must not be an unhandled rejection')
  } finally {
    process.removeListener('unhandledRejection', onRejection)
  }
})

test('a policy-denying dispatcher produces DENIED and no AGENT_SELECTED stage', async () => {
  const store = createRunStore({
    dispatcher: async ({ runContext }) => {
      runContext.appendStage('POLICY_EVALUATED', { verdict: 'deny', rule_id: 'deny-sensitive-data' })
      runContext.appendStage('DENIED', { reason: 'sensitive data', rule_id: 'deny-sensitive-data' })
    }
  })

  const id = store.startRun(sampleInput())
  await waitUntil(() => isTerminal(deriveStatus(store.getRun(id))))

  const run = store.getRun(id)
  const stages = stagesOf(run)
  assert.ok(stages.includes('DENIED'))
  assert.equal(stages.includes('AGENT_SELECTED'), false)
  assert.equal(deriveStatus(run), 'denied')
})

test('listRuns returns the most recent runs, most-recent-first', () => {
  const store = createRunStore({
    dispatcher: async ({ runContext }) => {
      runContext.appendStage('POLICY_EVALUATED', { verdict: 'allow', rule_id: 'default-allow' })
      runContext.appendStage('COMPLETED', { backupRef: 'bak_fake' })
    }
  })

  // listRuns reflects creation order and does not depend on dispatch progress,
  // so we can assert on it synchronously right after creating the runs.
  const ids = []
  for (let i = 0; i < 5; i++) {
    ids.push(store.startRun(sampleInput({ task: `task ${i}` })))
  }

  const recent = store.listRuns(2)
  assert.equal(recent.length, 2)
  assert.deepEqual(recent.map(r => r.id), [ids[4], ids[3]])

  // With no limit we get every run this store owns, still most-recent-first.
  const all = store.listRuns()
  assert.deepEqual(all.map(r => r.id), [...ids].reverse())
})

test('the store answers a request while a run is still in flight', async () => {
  const gate = deferred()
  let resolved = false
  const store = createRunStore({
    dispatcher: async ({ runContext }) => {
      runContext.appendStage('POLICY_EVALUATED', { verdict: 'allow', rule_id: 'default-allow' })
      runContext.appendStage('AGENT_RUNNING', { agentId: 'fake-agent' })
      await gate.promise
      resolved = true
      runContext.appendStage('COMPLETED', { backupRef: 'bak_fake' })
    }
  })

  const id = store.startRun(sampleInput())

  // Wait until the run is genuinely mid-flight (dispatch has started but is
  // still blocked on the gate), then prove getRun answers before it resolves.
  await waitUntil(() => stagesOf(store.getRun(id)).includes('AGENT_RUNNING'))
  const inFlight = store.getRun(id)
  assert.equal(resolved, false, 'the dispatch must still be in flight')
  assert.ok(inFlight, 'getRun answered while the dispatch was still running')
  assert.equal(isTerminal(deriveStatus(inFlight)), false)

  // Now let it finish.
  gate.resolve()
  await waitUntil(() => isTerminal(deriveStatus(store.getRun(id))))
  assert.equal(resolved, true)
})

// --- approval / rejection --------------------------------------------------

/**
 * A single FAKE dispatcher that serves BOTH phases the store drives:
 *   • develop — mimics a real Develop: records milestones through PATCH_READY
 *     and stops there (the store then parks the Run at PENDING_APPROVAL).
 *   • apply   — records the (request, approval) it was handed and returns the
 *     configured outcome. It NEVER touches the timeline, so the store owns the
 *     APPLYING → COMPLETED/ROLLED_BACK stages. The real Claude Code adapter is
 *     never imported or invoked.
 *
 * `apply` selects the apply outcome: { ok: true } → succeed with a backupRef;
 * { ok: false } → return a failed result; { throw: true } → reject.
 */
function makeApprovalDispatcher ({ patchPath = 'patches/fe-001.diff', apply = { ok: true } } = {}) {
  const calls = []
  async function dispatcher (params) {
    calls.push(params)
    if (params.phase === 'apply') {
      if (apply.throw) throw new Error(apply.error || 'apply exploded')
      if (apply.ok === false) return { status: 'failed', error: apply.error || 'apply failed' }
      return { status: 'ok', output: { backupRef: apply.backupRef || 'bak_applied' } }
    }
    // develop phase — leave the Run at PATCH_READY, exactly as the real one does.
    const { runContext } = params
    runContext.appendStage('POLICY_EVALUATED', { verdict: 'allow', rule_id: 'default-allow' })
    runContext.appendStage('AGENT_SELECTED', { agentId: 'fake-agent' })
    runContext.appendStage('AGENT_RUNNING', { agentId: 'fake-agent' })
    runContext.appendStage('AGENT_FINISHED', { agentId: 'fake-agent', success: true })
    runContext.appendStage('PATCH_READY', { patchPath })
  }
  return { dispatcher, calls, applyCalls: () => calls.filter(c => c.phase === 'apply') }
}

/** Start a Run and wait until the store has parked it at pending approval. */
async function startPendingApproval (store, overrides = {}) {
  const id = store.startRun(sampleInput({ targetProject: 'frontend', ...overrides }))
  await waitUntil(() => deriveStatus(store.getRun(id)) === 'pending_approval')
  return id
}

test('a successful Develop leaves the Run pending approval: PATCH_READY then PENDING_APPROVAL', async () => {
  const { dispatcher } = makeApprovalDispatcher({ patchPath: 'patches/fe-hero.diff' })
  const store = createRunStore({ dispatcher })

  const id = await startPendingApproval(store)
  const run = store.getRun(id)
  const stages = stagesOf(run)

  assert.equal(deriveStatus(run), 'pending_approval')
  // PATCH_READY is immediately followed by PENDING_APPROVAL, carrying the patch.
  const patchIdx = stages.indexOf('PATCH_READY')
  const pendingIdx = stages.indexOf('PENDING_APPROVAL')
  assert.ok(patchIdx >= 0 && pendingIdx === patchIdx + 1)
  const pending = run.timeline[pendingIdx]
  assert.equal(pending.facts.patchPath, 'patches/fe-hero.diff')
  assert.equal(isTerminal(deriveStatus(run)), false)
})

test('approveRun on a frontend Run dispatches Apply@1 (approved:true) and reaches COMPLETED with a backupRef', async () => {
  const { dispatcher, applyCalls } = makeApprovalDispatcher({
    patchPath: 'patches/fe-001.diff',
    apply: { ok: true, backupRef: 'bak_42' }
  })
  const store = createRunStore({ resolveOwner: () => 'louie', dispatcher })

  const id = await startPendingApproval(store)
  const run = await store.approveRun(id)

  // The apply phase dispatched exactly Apply@1 → dev, with an explicit approval.
  const applies = applyCalls()
  assert.equal(applies.length, 1)
  const call = applies[0]
  assert.equal(call.request.capabilityId, 'Apply')
  assert.equal(call.request.version, 1)
  assert.equal(call.request.target, 'dev')
  assert.equal(call.request.input.patchPath, 'patches/fe-001.diff')
  assert.equal(call.approval.approved, true)

  // The timeline gained APPLYING then COMPLETED with the backupRef.
  const stages = stagesOf(run)
  const applyingIdx = stages.indexOf('APPLYING')
  const completedIdx = stages.indexOf('COMPLETED')
  assert.ok(applyingIdx >= 0 && completedIdx === applyingIdx + 1)
  assert.equal(run.timeline[completedIdx].facts.backupRef, 'bak_42')
  assert.equal(deriveStatus(run), 'completed')
})

test('approveRun on a backend Run is rejected with a clear error and dispatches nothing', async () => {
  const { dispatcher, applyCalls } = makeApprovalDispatcher()
  const store = createRunStore({ dispatcher })

  // A backend Develop also reaches pending approval — approval is what is blocked.
  const id = await startPendingApproval(store, { targetProject: 'backend' })

  await assert.rejects(
    () => store.approveRun(id),
    err => /backend patch/i.test(err.message) && err.statusCode === 422
  )
  assert.equal(applyCalls().length, 0)
  // The Run is untouched — still pending approval, nothing dispatched.
  assert.equal(deriveStatus(store.getRun(id)), 'pending_approval')
})

test('approveRun on a Run that is not pending approval is rejected and dispatches nothing', async () => {
  // A dispatcher that drives the Run straight to a terminal COMPLETED (never
  // pending approval).
  const store = createRunStore({
    dispatcher: async ({ phase, runContext }) => {
      if (phase === 'apply') throw new Error('apply must never be dispatched here')
      runContext.appendStage('POLICY_EVALUATED', { verdict: 'allow', rule_id: 'default-allow' })
      runContext.appendStage('COMPLETED', { backupRef: 'bak_done' })
    }
  })

  const id = store.startRun(sampleInput({ targetProject: 'frontend' }))
  await waitUntil(() => deriveStatus(store.getRun(id)) === 'completed')

  await assert.rejects(
    () => store.approveRun(id),
    err => /not pending approval/i.test(err.message) && err.statusCode === 409
  )
})

test('approveRun can never be steered to dispatch Deploy — only Apply@1', async () => {
  const { dispatcher, applyCalls } = makeApprovalDispatcher()
  const store = createRunStore({ dispatcher })

  // A caller tries to smuggle Deploy/production in through the run-creation input.
  const id = await startPendingApproval(store, {
    capabilityId: 'Deploy',
    intent: 'ship to production'
  })
  await store.approveRun(id)

  const applies = applyCalls()
  assert.equal(applies.length, 1)
  // The dispatched capability/target are fixed by the store, not the caller.
  assert.equal(applies[0].request.capabilityId, 'Apply')
  assert.notEqual(applies[0].request.capabilityId, 'Deploy')
  assert.notEqual(applies[0].request.target, 'production')
  assert.equal(applies.some(c => c.request.capabilityId === 'Deploy'), false)
})

test('approvedBy is always set by the store and can never be supplied by the caller', async () => {
  const { dispatcher, applyCalls } = makeApprovalDispatcher()
  const store = createRunStore({ resolveOwner: () => 'server-louie', dispatcher })

  // The caller tries to smuggle an approver in through the run-creation input.
  const id = await startPendingApproval(store, { approvedBy: 'attacker', owner: 'attacker' })
  // The server does not pass an approver — the store fills it from resolveOwner.
  const run = await store.approveRun(id)

  const applying = run.timeline.find(e => e.stage === 'APPLYING')
  assert.equal(applying.facts.approvedBy, 'server-louie')
  assert.notEqual(applying.facts.approvedBy, 'attacker')
  // The approval object handed to the dispatcher carries the same trusted value.
  assert.equal(applyCalls()[0].approval.approvedBy, 'server-louie')
})

test('a failing apply appends ROLLED_BACK with the error and never COMPLETED', async () => {
  const { dispatcher } = makeApprovalDispatcher({ apply: { ok: false, error: 'patch did not apply cleanly' } })
  const store = createRunStore({ dispatcher })

  const id = await startPendingApproval(store)
  const run = await store.approveRun(id)

  const stages = stagesOf(run)
  const rolled = run.timeline.find(e => e.stage === 'ROLLED_BACK')
  assert.ok(rolled, 'a ROLLED_BACK stage must be recorded')
  assert.equal(rolled.facts.error, 'patch did not apply cleanly')
  assert.equal(stages.includes('COMPLETED'), false)
  assert.equal(deriveStatus(run), 'rolled_back')
  assert.equal(isTerminal(deriveStatus(run)), true)
})

test('a throwing apply dispatch also rolls back, carrying the thrown error', async () => {
  const { dispatcher } = makeApprovalDispatcher({ apply: { throw: true, error: 'worker vanished' } })
  const store = createRunStore({ dispatcher })

  const id = await startPendingApproval(store)
  const run = await store.approveRun(id)

  const rolled = run.timeline.find(e => e.stage === 'ROLLED_BACK')
  assert.ok(rolled)
  assert.equal(rolled.facts.error, 'worker vanished')
  assert.equal(deriveStatus(run), 'rolled_back')
})

test('rejectRun appends REJECTED, dispatches nothing, and the status is terminal', async () => {
  const { dispatcher, applyCalls } = makeApprovalDispatcher()
  const store = createRunStore({ resolveOwner: () => 'louie', dispatcher })

  const id = await startPendingApproval(store)
  const run = store.rejectRun(id, 'louie', 'not what I asked for')

  const rejected = run.timeline.find(e => e.stage === 'REJECTED')
  assert.ok(rejected)
  assert.equal(rejected.facts.rejectedBy, 'louie')
  assert.equal(rejected.facts.reason, 'not what I asked for')
  assert.equal(applyCalls().length, 0)
  assert.equal(deriveStatus(run), 'rejected')
  assert.equal(isTerminal(deriveStatus(run)), true)
})

test('rejectRun accepts no reason and still records the rejection', async () => {
  const { dispatcher } = makeApprovalDispatcher()
  const store = createRunStore({ resolveOwner: () => 'louie', dispatcher })

  const id = await startPendingApproval(store)
  const run = store.rejectRun(id)

  const rejected = run.timeline.find(e => e.stage === 'REJECTED')
  assert.ok(rejected)
  assert.equal(rejected.facts.rejectedBy, 'louie')
  assert.equal('reason' in rejected.facts, false)
  assert.equal(deriveStatus(run), 'rejected')
})

test('a rejected Run cannot afterwards be approved', async () => {
  const { dispatcher, applyCalls } = makeApprovalDispatcher()
  const store = createRunStore({ dispatcher })

  const id = await startPendingApproval(store)
  store.rejectRun(id, 'louie', 'no thanks')

  await assert.rejects(
    () => store.approveRun(id),
    err => /not pending approval/i.test(err.message)
  )
  assert.equal(applyCalls().length, 0)
  assert.equal(deriveStatus(store.getRun(id)), 'rejected')
})

test('approveRun on an unknown run id rejects with a 404', async () => {
  const { dispatcher } = makeApprovalDispatcher()
  const store = createRunStore({ dispatcher })

  await assert.rejects(
    () => store.approveRun('run_does_not_exist'),
    err => err.statusCode === 404
  )
})
