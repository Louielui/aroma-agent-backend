'use strict'

/**
 * proposal.confirmGuard.test.js — B2-7 bridge-only confirm integrity guard.
 *
 * The guard is ADDITIVE and fail-closed: a proposal carrying a sourceTaskId may
 * be confirmed ONLY when linkState === 'ready'. Non-bridge proposals (no
 * sourceTaskId) are unaffected — confirm behaves byte-for-byte as before. The
 * existing status==='pending' rule is never altered. No paid calls.
 *
 *   Run: node --test src/coo/proposal.confirmGuard.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createProposalStore } = require('./proposal')

function makeFakeRunStore () {
  const calls = []
  return { startRun (input) { calls.push(input); return 'run_guard1' }, calls }
}
const developLlm = async () => ({ intent: 'develop', task: 'do a thing', targetProject: 'backend' })

function inMemStore () {
  const runStore = makeFakeRunStore()
  return { store: createProposalStore({ runStore, persistence: false }), runStore }
}

// A persisted store seeded with a hand-written record (for linkState values that
// createBridgeProposal never produces: missing / unknown).
function seededStore (record) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-guard-'))
  const file = path.join(dir, 'aroma-proposals.json')
  fs.writeFileSync(file, JSON.stringify({ order: [record.id], proposals: { [record.id]: record } }))
  const runStore = makeFakeRunStore()
  return { store: createProposalStore({ runStore, persistence: file }), runStore, id: record.id }
}

test('non-bridge pending proposal (no sourceTaskId) → confirm works exactly as today', async () => {
  const { store, runStore } = inMemStore()
  const { proposal } = await store.propose({ conversationId: 'c', message: 'build', llm: developLlm })
  const runId = store.confirmProposal(proposal.id, 'louie')
  assert.ok(runId)
  assert.equal(runStore.calls.length, 1)              // startRun called
  const p = store.getProposal(proposal.id)
  assert.equal(p.status, 'confirmed')
  assert.equal(p.confirmedBy, 'louie')
  assert.ok(p.confirmedAt)
})

test("bridge pending + linkState 'linking' → 409, no worker, no confirm side-effects", () => {
  const { store, runStore } = inMemStore()
  const p = store.createBridgeProposal({ task: 'Title: x', sourceTaskId: 'task_a' }) // linkState 'linking'
  assert.throws(() => store.confirmProposal(p.id, 'louie'), /not ready to confirm/)
  assert.equal(runStore.calls.length, 0)              // startRun NOT called
  const after = store.getProposal(p.id)
  assert.equal(after.status, 'pending')               // unchanged
  assert.equal(after.confirmedBy, null)
  assert.equal('confirmedAt' in after, false)
})

test("bridge pending + linkState 'linking_failed' → 409, no side-effects", () => {
  const { store, runStore } = inMemStore()
  const p = store.createBridgeProposal({ task: 'Title: x', sourceTaskId: 'task_b' })
  store.setLinkState(p.id, 'linking_failed')
  assert.throws(() => store.confirmProposal(p.id, 'louie'), /not ready to confirm/)
  assert.equal(runStore.calls.length, 0)
  assert.equal(store.getProposal(p.id).status, 'pending')
})

test('bridge pending + linkState MISSING (null/undefined) → 409 fail-closed', () => {
  // hand-written bridge record with sourceTaskId but NO linkState
  const { store, runStore, id } = seededStore({
    id: 'prop_nolink', status: 'pending', task: 'Title: x', targetProject: 'backend',
    sourceTaskId: 'task_c', confirmedBy: null, cancelledBy: null, createdAt: '2026-07-11T00:00:00.000Z'
  })
  assert.equal(store.getProposal(id).linkState, undefined)
  assert.throws(() => store.confirmProposal(id, 'louie'), /not ready to confirm/)
  assert.equal(runStore.calls.length, 0)
})

test('bridge pending + UNKNOWN linkState value → 409 fail-closed', () => {
  const { store, runStore, id } = seededStore({
    id: 'prop_weird', status: 'pending', task: 'Title: x', targetProject: 'backend',
    sourceTaskId: 'task_d', linkState: 'weird', confirmedBy: null, cancelledBy: null, createdAt: '2026-07-11T00:00:00.000Z'
  })
  assert.throws(() => store.confirmProposal(id, 'louie'), /not ready to confirm/)
  assert.equal(runStore.calls.length, 0)
})

test("bridge pending + linkState 'ready' → confirm succeeds; confirmedBy/At from the real confirm", () => {
  const { store, runStore } = inMemStore()
  const p = store.createBridgeProposal({ task: 'Title: x', sourceTaskId: 'task_e' })
  store.setLinkState(p.id, 'ready')
  const runId = store.confirmProposal(p.id, 'louie')
  assert.ok(runId)
  assert.equal(runStore.calls.length, 1)
  const after = store.getProposal(p.id)
  assert.equal(after.status, 'confirmed')
  assert.equal(after.confirmedBy, 'louie')
  assert.ok(after.confirmedAt)
})
