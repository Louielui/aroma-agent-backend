'use strict'

/**
 * proposalBridge.test.js — B2-7 PROMOTE flow (pure, no HTTP, no paid calls).
 *
 * Drives promoteTaskToProposal() against a REAL in-memory Proposal store and a
 * fake Task store, so every branch — including a simulated bind failure and its
 * non-duplicating resume — is exercised deterministically. Proves promote NEVER
 * confirms and NEVER schedules a worker (the fake runStore is never called).
 *
 *   Run: node --test src/intake/proposalBridge.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { promoteTaskToProposal } = require('./proposalBridge')
const { serializeBriefV1 } = require('./briefSerializer')
const { createProposalStore } = require('../coo/proposal')

// A fake Task store backed by a Map. setTaskProposalId can be armed to throw once
// (simulating a persistence write failure) to exercise the bind-failure path.
function makeFakeTruthStore (tasks = []) {
  const map = new Map(tasks.map(t => [t.id, { ...t }]))
  let failBind = false
  return {
    getTask: (id) => (map.has(id) ? { ...map.get(id) } : null),
    setTaskProposalId: (id, proposalId) => {
      if (failBind) throw new Error('simulated bind write failure')
      const t = map.get(id)
      if (!t) throw new Error(`unknown task: ${id}`)
      t.proposalId = proposalId
      return { ...t }
    },
    armBindFailure: (v) => { failBind = v }
  }
}

function makeFakeRunStore () {
  const calls = []
  return { startRun (input) { calls.push(input); return 'run_x' }, calls }
}

function setup (tasks) {
  const runStore = makeFakeRunStore()
  const proposalStore = createProposalStore({ runStore, persistence: false })
  const store = makeFakeTruthStore(tasks)
  return { store, proposalStore, runStore }
}

const TASK = { id: 'task_1', title: 'Add supplier table', note: 'columns id, name', decision_id: 'dec_9', state: 'todo', created_at: '2026-07-11T00:00:00.000Z' }

test('valid task → Proposal(status pending, linkState ready), task bound, provenance complete', async () => {
  const { store, proposalStore, runStore } = setup([TASK])
  const { status, body } = await promoteTaskToProposal({ store, proposalStore, taskId: 'task_1' })

  assert.equal(status, 200)
  assert.equal(body.linkState, 'ready')
  const p = proposalStore.getProposal(body.proposalId)
  assert.equal(p.status, 'pending')          // PROMOTE never confirms
  assert.equal(p.linkState, 'ready')
  assert.equal(p.sourceTaskId, 'task_1')
  assert.equal(p.sourceDecisionId, 'dec_9')
  assert.equal(p.briefSerializationVersion, 'v1')
  assert.equal(p.task, serializeBriefV1(TASK)) // deterministic brief, no LLM
  assert.deepEqual(p.sourceTaskProvenance, {
    taskId: 'task_1', title: 'Add supplier table', state: 'todo', decisionId: 'dec_9', createdAt: '2026-07-11T00:00:00.000Z'
  })
  assert.equal(store.getTask('task_1').proposalId, body.proposalId) // bound
  assert.equal(runStore.calls.length, 0)      // PROMOTE never schedules/starts a Run
})

test('idempotent — a second promote returns the same proposal, no duplicate created', async () => {
  const { store, proposalStore } = setup([TASK])
  const first = await promoteTaskToProposal({ store, proposalStore, taskId: 'task_1' })
  const second = await promoteTaskToProposal({ store, proposalStore, taskId: 'task_1' })
  assert.equal(second.status, 200)
  assert.equal(second.body.proposalId, first.body.proposalId)
  assert.equal(proposalStore.listProposals().length, 1)
})

test('integrity — task.proposalId set but Proposal missing → 409 + evidence, no recreate', async () => {
  const { store, proposalStore } = setup([{ ...TASK, proposalId: 'prop_ghost' }])
  const { status, body } = await promoteTaskToProposal({ store, proposalStore, taskId: 'task_1' })
  assert.equal(status, 409)
  assert.equal(body.error, 'proposal integrity error')
  assert.equal(body.evidence.boundProposalId, 'prop_ghost')
  assert.equal(proposalStore.listProposals().length, 0) // did NOT recreate
})

test('rejects — unknown task 404, blank title 422, non-promotable state 409', async () => {
  const { store, proposalStore } = setup([
    TASK,
    { id: 'task_blank', title: '  ', note: 'x', state: 'todo' },
    { id: 'task_done', title: 'done one', state: 'done' }
  ])
  assert.equal((await promoteTaskToProposal({ store, proposalStore, taskId: 'nope' })).status, 404)
  assert.equal((await promoteTaskToProposal({ store, proposalStore, taskId: 'task_blank' })).status, 422)
  const done = await promoteTaskToProposal({ store, proposalStore, taskId: 'task_done' })
  assert.equal(done.status, 409)
  assert.match(done.body.error, /not promotable/)
})

test('bind failure → linkState linking_failed, worker NOT started, 500; retry resumes, no duplicate', async () => {
  const { store, proposalStore, runStore } = setup([TASK])
  store.armBindFailure(true)
  const failed = await promoteTaskToProposal({ store, proposalStore, taskId: 'task_1' })
  assert.equal(failed.status, 500)
  assert.equal(failed.body.linkState, 'linking_failed')
  assert.equal(runStore.calls.length, 0)                 // nothing started
  assert.equal(store.getTask('task_1').proposalId, undefined) // task not bound

  const orphan = proposalStore.findBySourceTaskId('task_1')
  assert.ok(orphan, 'the linking_failed proposal is durable/discoverable for resume')
  assert.equal(orphan.linkState, 'linking_failed')

  // retry: bind now succeeds → resume-to-ready, NO second proposal
  store.armBindFailure(false)
  const resumed = await promoteTaskToProposal({ store, proposalStore, taskId: 'task_1' })
  assert.equal(resumed.status, 200)
  assert.equal(resumed.body.linkState, 'ready')
  assert.equal(resumed.body.proposalId, orphan.id)       // SAME proposal
  assert.equal(proposalStore.listProposals().length, 1)  // no duplicate
  assert.equal(store.getTask('task_1').proposalId, orphan.id)
})

test('promote does not confirm and does not schedule — proposal stays pending, no Run', async () => {
  const { store, proposalStore, runStore } = setup([TASK])
  const { body } = await promoteTaskToProposal({ store, proposalStore, taskId: 'task_1' })
  const p = proposalStore.getProposal(body.proposalId)
  assert.equal(p.status, 'pending')      // not 'confirmed'
  assert.equal(p.confirmedBy, null)
  assert.equal(runStore.calls.length, 0) // no startRun ⇒ no Execution/Result could exist
})
