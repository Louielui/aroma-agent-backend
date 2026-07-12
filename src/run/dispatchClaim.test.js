'use strict'

/**
 * dispatchClaim.test.js — B2-11a durable DISPATCH_CLAIMED evidence.
 *
 * The claim is written ONLY after the B2-9 authorization gate passes and BEFORE
 * the real dispatcher spawns; never on the unauthorized path. It is durable
 * (B2-10), so after a restart "claimed-but-no-execution" is distinguishable from
 * "never-claimed". This slice records evidence only — no recovery, no dispatch on
 * load. All fakes/spies; zero paid, zero real dispatch.
 *
 *   Run: node --test src/run/dispatchClaim.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createRunStore } = require('./store')

function tmpFile () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-claim-'))
  return path.join(dir, 'aroma-runs.json')
}
const INPUT = (over = {}) => ({ task: 't', targetProject: 'backend', capabilityId: 'Develop', version: 1, ...over })
const stagesOf = (r) => r.timeline.map(e => e.stage)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

test('AUTHORIZED dispatch: DISPATCH_CLAIMED written AFTER auth and BEFORE the spawn, with linkage, durable', async () => {
  const file = tmpFile()
  const spy = []
  const store = createRunStore({ dispatcher: async () => { spy.push(1) }, authorizeDispatch: () => true, persistence: file })
  const id = store.startRun(INPUT())

  // Synchronously after startRun (before the setImmediate spawn turn): the claim
  // is already on the timeline, but the dispatcher has NOT run yet.
  const immediate = store.getRun(id)
  assert.deepEqual(stagesOf(immediate), ['TASK_CREATED', 'DISPATCH_CLAIMED'])
  assert.equal(spy.length, 0, 'claim is written BEFORE the dispatcher spawns')

  const claim = immediate.timeline.find(e => e.stage === 'DISPATCH_CLAIMED')
  assert.equal(claim.facts.runId, id)
  assert.equal(claim.facts.attempt, 1)
  assert.ok(typeof claim.facts.ts === 'string' && claim.facts.ts)

  // durable: the claim is flushed to disk
  const disk = require('./runPersistence').load(file)
  assert.deepEqual(disk.runs[id].timeline.map(e => e.stage), ['TASK_CREATED', 'DISPATCH_CLAIMED'])

  await sleep(20)
  assert.equal(spy.length, 1, 'the dispatcher then spawns (after the claim)')
})

test('UNAUTHORIZED (gate false): NO DISPATCH_CLAIMED, dispatcher spy 0, no execution (B2-9 preserved)', async () => {
  const file = tmpFile()
  const spy = []
  const store = createRunStore({ dispatcher: async () => { spy.push(1) }, authorizeDispatch: () => false, persistence: file })
  const id = store.startRun(INPUT())
  await sleep(20)

  const r = store.getRun(id)
  assert.deepEqual(stagesOf(r), ['TASK_CREATED']) // gate returned BEFORE the claim
  assert.equal(r.timeline.some(e => e.stage === 'DISPATCH_CLAIMED'), false)
  assert.equal(spy.length, 0, 'no dispatch when unauthorized')
})

test('state-distinguishability after restart: claimed vs never-claimed (evidence only, no action)', async () => {
  const file = tmpFile()
  let authorized = true
  const store = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => authorized, persistence: file })
  const idClaimed = store.startRun(INPUT({ task: 'A' })) // authorized → claimed
  authorized = false
  const idNever = store.startRun(INPUT({ task: 'B' })) // unauthorized → never claimed
  await sleep(20)

  // restart: a fresh store over the same file, with a dispatcher SPY
  const spy = []
  const store2 = createRunStore({ dispatcher: async () => { spy.push(1) }, persistence: file })
  await sleep(30)

  const a = store2.getRun(idClaimed)
  const b = store2.getRun(idNever)
  assert.equal(a.timeline.some(e => e.stage === 'DISPATCH_CLAIMED'), true, 'claimed run keeps its DISPATCH_CLAIMED')
  assert.equal(b.timeline.some(e => e.stage === 'DISPATCH_CLAIMED'), false, 'never-claimed run has none')
  // they are DISTINGUISHABLE — but this slice does NOT act on it:
  assert.equal(spy.length, 0, 'loading the store triggers NO dispatch (no recovery/retry here)')
  assert.deepEqual(stagesOf(b), ['TASK_CREATED']) // not marked Interrupted, not dispatched
})
