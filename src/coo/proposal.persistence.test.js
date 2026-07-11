'use strict'

/**
 * proposal.persistence.test.js — B2-6 durability tests for createProposalStore.
 *
 * A "restart" is simulated by constructing a SECOND store over the SAME file: it
 * loads from disk exactly as a fresh process would. Every test uses its own temp
 * dir (os.tmpdir + mkdtempSync) so tests never collide and never touch data/.
 * No paid calls, no real LLM (a fake develop llm + fake runStore, as in
 * proposal.test.js).
 *
 *   Run: node --test src/coo/proposal.persistence.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createProposalStore } = require('./proposal')
const { ProposalStoreCorruptError } = require('./proposalPersistence')

// --- fakes (mirroring proposal.test.js) -----------------------------------
function makeFakeRunStore (runId = 'run_fake01') {
  const calls = []
  return { startRun (input) { calls.push(input); return runId }, calls }
}
const fakeLlm = (result) => async () => result
const VERBATIM_TASK = 'Add a created_at timestamp to the /health response payload.'
const developLlm = fakeLlm({ intent: 'develop', task: VERBATIM_TASK, targetProject: 'backend' })

/** A fresh temp store file path (parent dir exists, file does not). */
function tmpStoreFile () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-prop-store-'))
  return path.join(dir, 'aroma-proposals.json')
}
/** Build a durable store over `file` with a fresh fake runStore. */
function storeOver (file, runId) {
  const runStore = makeFakeRunStore(runId)
  return { store: createProposalStore({ runStore, persistence: file }), runStore }
}

// --- acceptance ------------------------------------------------------------

test('create → restart → the proposal is present with identical fields', async () => {
  const file = tmpStoreFile()
  const a = storeOver(file)
  const { proposal } = await a.store.propose({ conversationId: 'c1', message: 'add ts', llm: developLlm })

  // restart: a brand-new store instance loading the same file
  const b = storeOver(file)
  const reloaded = b.store.getProposal(proposal.id)
  assert.ok(reloaded, 'proposal survives restart')
  assert.deepEqual(reloaded, proposal) // fields identical, byte-for-byte
  assert.equal(reloaded.status, 'pending')
})

test('confirm → restart → status/confirmedBy/confirmedAt/runId persist', async () => {
  const file = tmpStoreFile()
  const a = storeOver(file, 'run_persisted42')
  const { proposal } = await a.store.propose({ conversationId: 'c2', message: 'add ts', llm: developLlm })
  const runId = a.store.confirmProposal(proposal.id, 'louie')
  assert.equal(runId, 'run_persisted42')
  const confirmed = a.store.getProposal(proposal.id)

  const b = storeOver(file)
  const reloaded = b.store.getProposal(proposal.id)
  assert.equal(reloaded.status, 'confirmed')
  assert.equal(reloaded.confirmedBy, 'louie')
  assert.equal(reloaded.confirmedAt, confirmed.confirmedAt)
  assert.equal(reloaded.runId, 'run_persisted42')
  assert.deepEqual(reloaded, confirmed)
})

test('pending proposal → restart → still pending (no confirm fields fabricated)', async () => {
  const file = tmpStoreFile()
  const a = storeOver(file)
  const { proposal } = await a.store.propose({ conversationId: 'c3', message: 'add ts', llm: developLlm })

  const b = storeOver(file)
  const reloaded = b.store.getProposal(proposal.id)
  assert.equal(reloaded.status, 'pending')
  assert.equal(reloaded.confirmedBy, null)
  assert.equal(reloaded.cancelledBy, null)
  assert.equal('confirmedAt' in reloaded, false, 'no fabricated confirmedAt')
  assert.equal('runId' in reloaded, false, 'no fabricated runId')
  // a pending proposal reloaded after restart is still confirmable
  const runId = b.store.confirmProposal(proposal.id, 'louie')
  assert.ok(runId)
})

test('cancel → restart → status/cancelledBy/cancelledAt persist', async () => {
  const file = tmpStoreFile()
  const a = storeOver(file)
  const { proposal } = await a.store.propose({ conversationId: 'c4', message: 'add ts', llm: developLlm })
  const cancelled = a.store.cancelProposal(proposal.id, 'louie')

  const b = storeOver(file)
  const reloaded = b.store.getProposal(proposal.id)
  assert.equal(reloaded.status, 'cancelled')
  assert.equal(reloaded.cancelledBy, 'louie')
  assert.equal(reloaded.cancelledAt, cancelled.cancelledAt)
  assert.deepEqual(reloaded, cancelled)
})

test('list/get identical across restart — order preserved (most-recent-first)', async () => {
  const file = tmpStoreFile()
  const a = storeOver(file)
  const p1 = (await a.store.propose({ conversationId: 'c5a', message: 'one', llm: developLlm })).proposal
  const p2 = (await a.store.propose({ conversationId: 'c5b', message: 'two', llm: developLlm })).proposal
  const before = a.store.listProposals()

  const b = storeOver(file)
  const after = b.store.listProposals()
  assert.deepEqual(after, before)
  // listProposals is most-recent-first: p2 (created last) leads
  assert.equal(after[0].id, p2.id)
  assert.equal(after[1].id, p1.id)
})

test('missing file → safe empty init; first proposal creates the file', async () => {
  const file = tmpStoreFile()
  assert.equal(fs.existsSync(file), false)
  const a = storeOver(file)
  assert.equal(a.store.listProposals().length, 0) // empty, no throw
  assert.equal(fs.existsSync(file), false, 'reading empty does not create the file')
  await a.store.propose({ conversationId: 'c6', message: 'add ts', llm: developLlm })
  assert.equal(fs.existsSync(file), true, 'first mutation creates the file')
})

test('malformed file → construction throws a controlled error; file NOT overwritten, nothing fabricated', () => {
  const file = tmpStoreFile()
  fs.writeFileSync(file, '{ corrupt not json ')
  const before = fs.readFileSync(file, 'utf8')
  assert.throws(
    () => createProposalStore({ runStore: makeFakeRunStore(), persistence: file }),
    (err) => { assert.ok(err instanceof ProposalStoreCorruptError); return true }
  )
  // the corrupt file is left exactly as-is — never emptied, recreated, or fabricated
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  assert.equal(fs.existsSync(file + '.tmp'), false)
})

test('old record missing status → normalized to controlled "unknown", never "pending" (not confirmable)', () => {
  const file = tmpStoreFile()
  // hand-write an old-shape record with NO status field
  fs.writeFileSync(file, JSON.stringify({
    order: ['prop_old'],
    proposals: { prop_old: { id: 'prop_old', task: 't', targetProject: 'backend', conversationId: 'c' } }
  }))
  const { store } = storeOver(file)
  const rec = store.getProposal('prop_old')
  assert.equal(rec.status, 'unknown') // controlled sentinel, NOT fabricated 'pending'
  assert.equal(rec.confirmedBy, null)
  assert.equal(rec.cancelledBy, null)
  // 'unknown' is not 'pending', so the confirm gate refuses it
  assert.throws(() => store.confirmProposal('prop_old', 'louie'), /not pending/)
})

test('provenance / extra fields present at create survive restart intact', async () => {
  const file = tmpStoreFile()
  // developLlm returns a fixed shape; assert every field created is preserved
  const a = storeOver(file)
  const { proposal } = await a.store.propose({ conversationId: 'prov1', message: 'add ts', llm: developLlm })
  const b = storeOver(file)
  const reloaded = b.store.getProposal(proposal.id)
  assert.equal(reloaded.owner, proposal.owner)
  assert.equal(reloaded.capabilityId, 'Develop')
  assert.equal(reloaded.version, 1)
  assert.equal(reloaded.task, VERBATIM_TASK)
  assert.equal(reloaded.createdAt, proposal.createdAt)
  assert.deepEqual(reloaded, proposal)
})

test('in-memory mode (persistence:false) writes no file — pre-B2-6 behaviour', async () => {
  const file = tmpStoreFile()
  const runStore = makeFakeRunStore()
  const store = createProposalStore({ runStore, persistence: false })
  await store.propose({ conversationId: 'mem', message: 'add ts', llm: developLlm })
  assert.equal(fs.existsSync(file), false)
  assert.equal(store.listProposals().length, 1)
})
