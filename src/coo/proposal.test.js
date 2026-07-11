'use strict'

/**
 * proposal.test.js — unit tests for the conversation → Proposal → Run bridge.
 *
 * Uses the built-in Node test runner (node:test), no extra dependencies.
 *   Run: node --test src/coo/
 *
 * Every test injects a FAKE llm and a FAKE runStore. The REAL Claude Code
 * adapter, and any real model, are never imported and never invoked here — the
 * bridge is exercised entirely against fakes we control, so no test can start
 * real work or reach a language model.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createProposalStore } = require('./proposal')
const { classifyIntent } = require('./intent')

// --- fakes -----------------------------------------------------------------

/** A fake runStore that records every startRun call and hands back a fixed id.
 *  It NEVER dispatches anything — it only lets us prove who called it and with
 *  what. */
function makeFakeRunStore (runId = 'run_fake01') {
  const calls = []
  return {
    startRun (input) {
      calls.push(input)
      return runId
    },
    calls
  }
}

/** A fake llm that always returns the same canned classification. */
function fakeLlm (result) {
  return async () => result
}

// A development request the fake model is happy to classify. The task string is
// what we expect to survive VERBATIM all the way to the worker.
const VERBATIM_TASK = 'Add a created_at timestamp to the /health response payload.'
const developLlm = fakeLlm({ intent: 'develop', task: VERBATIM_TASK, targetProject: 'backend' })

// --- tests -----------------------------------------------------------------

test('a greeting yields intent chat and creates no Proposal', async () => {
  const runStore = makeFakeRunStore()
  const store = createProposalStore({ runStore, persistence: false })

  const greetingLlm = fakeLlm({ intent: 'chat', reply: 'Hi Louie! How can I help?' })
  const result = await store.propose({ conversationId: 'c1', message: 'good morning!', llm: greetingLlm })

  assert.equal(result.intent, 'chat')
  assert.equal(result.proposal, null)
  assert.equal(result.reply, 'Hi Louie! How can I help?')
  // No Proposal was stored and, above all, the runStore was never touched.
  assert.equal(store.listProposals().length, 0)
  assert.equal(runStore.calls.length, 0)
})

test('a development request yields a Proposal whose task is the exact verbatim worker string', async () => {
  const runStore = makeFakeRunStore()
  const store = createProposalStore({ runStore, persistence: false })

  const result = await store.propose({ conversationId: 'c2', message: 'please add a timestamp', llm: developLlm })

  assert.equal(result.intent, 'develop')
  const p = result.proposal
  assert.ok(p)
  // The stored task is the byte-for-byte string that would be sent to the worker.
  assert.equal(p.task, VERBATIM_TASK)
  assert.equal(p.conversationId, 'c2')
  assert.equal(p.targetProject, 'backend')
  assert.equal(p.capabilityId, 'Develop')
  assert.equal(p.version, 1)
  assert.equal(p.status, 'pending')
  assert.ok(p.createdAt)
})

test('creating a Proposal never calls the runStore', async () => {
  const runStore = makeFakeRunStore()
  const store = createProposalStore({ runStore, persistence: false })

  await store.propose({ conversationId: 'c3', message: 'add a timestamp', llm: developLlm })

  // Proposing is inert: no Run is created and nothing is dispatched.
  assert.equal(runStore.calls.length, 0)
  assert.equal(store.listProposals().length, 1)
  assert.equal(store.listProposals()[0].status, 'pending')
})

test('confirmProposal is the only path that calls runStore.startRun, passing the conversationId through', async () => {
  const runStore = makeFakeRunStore('run_created99')
  const store = createProposalStore({ runStore, persistence: false })

  const { proposal } = await store.propose({ conversationId: 'conv-42', message: 'add a timestamp', llm: developLlm })
  assert.equal(runStore.calls.length, 0) // still nothing after proposing

  const runId = store.confirmProposal(proposal.id, 'louie')

  // Confirmation created exactly one Run, and returned its id.
  assert.equal(runId, 'run_created99')
  assert.equal(runStore.calls.length, 1)
  const startRunInput = runStore.calls[0]
  // The Run carries the verbatim task, the fixed capability, and the conversationId.
  assert.equal(startRunInput.task, VERBATIM_TASK)
  assert.equal(startRunInput.targetProject, 'backend')
  assert.equal(startRunInput.capabilityId, 'Develop')
  assert.equal(startRunInput.version, 1)
  assert.equal(startRunInput.conversationId, 'conv-42')

  // The Proposal is now confirmed.
  assert.equal(store.getProposal(proposal.id).status, 'confirmed')
})

test('confirmProposal rejects a proposal that is not pending', async () => {
  const runStore = makeFakeRunStore()
  const store = createProposalStore({ runStore, persistence: false })

  const { proposal } = await store.propose({ conversationId: 'c4', message: 'add a timestamp', llm: developLlm })
  store.confirmProposal(proposal.id, 'louie') // now confirmed (not pending)

  assert.throws(
    () => store.confirmProposal(proposal.id, 'louie'),
    err => /not pending/i.test(err.message) && err.statusCode === 409
  )
})

test('a cancelled proposal can never be confirmed and creates no Run', async () => {
  const runStore = makeFakeRunStore()
  const store = createProposalStore({ runStore, persistence: false })

  const { proposal } = await store.propose({ conversationId: 'c5', message: 'add a timestamp', llm: developLlm })
  const cancelled = store.cancelProposal(proposal.id, 'louie')
  assert.equal(cancelled.status, 'cancelled')

  assert.throws(
    () => store.confirmProposal(proposal.id, 'louie'),
    err => /not pending/i.test(err.message) && err.statusCode === 409
  )
  // Cancelling and the failed confirm both left the runStore untouched.
  assert.equal(runStore.calls.length, 0)
})

test('a confirmed proposal cannot be confirmed twice — only one Run is ever created', async () => {
  const runStore = makeFakeRunStore()
  const store = createProposalStore({ runStore, persistence: false })

  const { proposal } = await store.propose({ conversationId: 'c6', message: 'add a timestamp', llm: developLlm })
  store.confirmProposal(proposal.id, 'louie')

  assert.throws(() => store.confirmProposal(proposal.id, 'louie'), err => err.statusCode === 409)
  // Exactly one startRun call, despite the second confirm attempt.
  assert.equal(runStore.calls.length, 1)
})

test('an llm returning a targetProject of production is rejected — no Proposal is created', async () => {
  const runStore = makeFakeRunStore()
  const store = createProposalStore({ runStore, persistence: false })

  const productionLlm = fakeLlm({ intent: 'develop', task: 'ship it to prod', targetProject: 'production' })
  const result = await store.propose({ conversationId: 'c7', message: 'push straight to production', llm: productionLlm })

  // The classification falls back to chat; no Proposal, no Run.
  assert.equal(result.intent, 'chat')
  assert.equal(result.proposal, null)
  assert.equal(store.listProposals().length, 0)
  assert.equal(runStore.calls.length, 0)

  // Prove the same at the classifier level: production is never a valid target.
  const classification = await classifyIntent('push to production', productionLlm)
  assert.equal(classification.intent, 'chat')
})

test('an llm that returns text agreeing to proceed does not confirm anything', async () => {
  const runStore = makeFakeRunStore()
  const store = createProposalStore({ runStore, persistence: false })

  const { proposal } = await store.propose({ conversationId: 'c8', message: 'add a timestamp', llm: developLlm })
  assert.equal(store.getProposal(proposal.id).status, 'pending')

  // A later message where the model "agrees" in free text. Feeding it through
  // propose can only ever produce chat or a NEW proposal — it can never confirm
  // the pending one. Only the structured confirmProposal action creates a Run.
  const agreementLlm = fakeLlm({ intent: 'chat', reply: 'Yes, absolutely — let us proceed and ship it!' })
  const agreement = await store.propose({ conversationId: 'c8', message: 'yes go ahead', llm: agreementLlm })

  assert.equal(agreement.intent, 'chat')
  assert.equal(agreement.proposal, null)
  // The pending proposal is untouched and no Run was created by "agreement".
  assert.equal(store.getProposal(proposal.id).status, 'pending')
  assert.equal(runStore.calls.length, 0)

  // Only the explicit, structured action makes the Run.
  store.confirmProposal(proposal.id, 'louie')
  assert.equal(runStore.calls.length, 1)
})

test('confirmedBy is always set by the server and can never be supplied by the caller/model', async () => {
  // The server context resolves the owner; a caller cannot influence it.
  const runStore = makeFakeRunStore()
  const store = createProposalStore({ runStore, resolveOwner: () => 'server-louie', persistence: false })

  const { proposal } = await store.propose({ conversationId: 'c9', message: 'add a timestamp', llm: developLlm })

  // The server hands in its own trusted identity for confirmedBy.
  store.confirmProposal(proposal.id, 'server-louie')
  const confirmed = store.getProposal(proposal.id)
  assert.equal(confirmed.confirmedBy, 'server-louie')

  // And when the server passes nothing, it still falls back to resolveOwner —
  // never to any caller- or model-supplied value.
  const { proposal: p2 } = await store.propose({ conversationId: 'c9b', message: 'add another field', llm: developLlm })
  store.confirmProposal(p2.id)
  assert.equal(store.getProposal(p2.id).confirmedBy, 'server-louie')
})
