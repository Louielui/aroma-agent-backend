'use strict'

/**
 * store.persistence.test.js — B2-10 durability for the Run store.
 *
 * A "restart" is a SECOND store constructed over the SAME file: its order/owned
 * are per-store and are populated ONLY by load-at-construct (it never calls
 * startRun), so a run appearing in store2 proves the file round-trip. Each test
 * uses its own temp file. No paid calls, no worker, no real dispatch.
 *
 *   Run: node --test src/run/store.persistence.test.js
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-run-store-'))
  return path.join(dir, 'aroma-runs.json')
}
const INPUT = (over = {}) => ({ task: 'do a thing', targetProject: 'backend', capabilityId: 'Develop', version: 1, ...over })
const noDispatch = () => async () => {}

test('createRun → restart → run present, timeline intact, derived status identical', () => {
  const file = tmpFile()
  // authorizeDispatch false → the run is created + persisted but never dispatched
  // (mirrors a B2-9-gated confirm: a Run at TASK_CREATED, status "created").
  const store1 = createRunStore({ dispatcher: noDispatch(), authorizeDispatch: () => false, persistence: file })
  const id = store1.startRun(INPUT({ task: 'hello' }))
  const before = store1.getRun(id)

  const store2 = createRunStore({ dispatcher: noDispatch(), persistence: file })
  const after = store2.getRun(id)
  assert.ok(after, 'run survives restart (loaded into store2 from disk)')
  assert.equal(after.task, 'hello')
  assert.deepEqual(after.timeline.map(e => e.stage), ['TASK_CREATED'])
  assert.equal(runModel.deriveStatus(after), runModel.deriveStatus(before))
  assert.equal(runModel.deriveStatus(after), 'created')
  assert.equal(store2.listRuns().some(r => r.id === id), true) // order rehydrated
})

test('direct file evidence: createRun writes { order, runs } with the timeline', () => {
  const file = tmpFile()
  const store1 = createRunStore({ dispatcher: noDispatch(), authorizeDispatch: () => false, persistence: file })
  const id = store1.startRun(INPUT())
  const disk = runPersist.load(file)
  assert.deepEqual(disk.order, [id])
  assert.equal(disk.runs[id].id, id)
  assert.deepEqual(disk.runs[id].timeline.map(e => e.stage), ['TASK_CREATED'])
  assert.equal(disk.runs[id].targetProject, 'backend')
})

test('appendStage (via dispatcher) → restart → stage persists; deriveStatus unchanged', async () => {
  const file = tmpFile()
  let resolveDone
  const done = new Promise(r => { resolveDone = r })
  const store1 = createRunStore({
    dispatcher: async ({ runContext }) => { runContext.appendStage('POLICY_EVALUATED', { verdict: 'allow', rule_id: 'r1' }); resolveDone() },
    persistence: file
  })
  const id = store1.startRun(INPUT())
  await done
  const statusLive = runModel.deriveStatus(store1.getRun(id))

  // direct file evidence, then restart
  assert.deepEqual(runPersist.load(file).runs[id].timeline.map(e => e.stage), ['TASK_CREATED', 'POLICY_EVALUATED'])
  const store2 = createRunStore({ dispatcher: noDispatch(), persistence: file })
  const after = store2.getRun(id)
  assert.deepEqual(after.timeline.map(e => e.stage), ['TASK_CREATED', 'POLICY_EVALUATED'])
  assert.equal(runModel.deriveStatus(after), statusLive)
  assert.equal(runModel.deriveStatus(after), 'policy_evaluated')
})

test('B2-9 INVARIANT: constructing/loading the store triggers NO dispatch (spy 0)', async () => {
  const file = tmpFile()
  // Seed a file with a TASK_CREATED run (a confirmed-but-not-executed Run).
  const rec = { id: 'run_load1', owner: 'louie', workspace: 'default', conversationId: null, goal: null, task: 't', intent: null, targetProject: 'backend', capabilityId: 'Develop', version: 1, timeline: [{ stage: 'TASK_CREATED', at: '2026-07-12T00:00:00.000Z', facts: {} }], createdAt: '2026-07-12T00:00:00.000Z' }
  runPersist.save(file, { order: ['run_load1'], runs: { run_load1: rec } })

  const spy = []
  const store = createRunStore({ dispatcher: async () => { spy.push(1) }, persistence: file })
  await new Promise(r => setTimeout(r, 40)) // give any (wrongly) scheduled dispatch a chance

  assert.equal(spy.length, 0, 'loading Runs must NOT invoke the dispatcher')
  // loaded faithfully; slice does NOT mark Interrupted or add any stage
  const r = store.getRun('run_load1')
  assert.ok(r)
  assert.deepEqual(r.timeline.map(e => e.stage), ['TASK_CREATED'])
  assert.equal(runModel.deriveStatus(r), 'created') // NOT 'interrupted', NOT dispatched
})

test('missing file → safe empty init, no throw, file not created on read', () => {
  const file = tmpFile()
  assert.equal(fs.existsSync(file), false)
  const store = createRunStore({ dispatcher: noDispatch(), persistence: file })
  assert.equal(store.listRuns().length, 0)
  assert.equal(fs.existsSync(file), false)
  // first createRun creates the file
  createRunStore({ dispatcher: noDispatch(), authorizeDispatch: () => false, persistence: file }).startRun(INPUT())
  assert.equal(fs.existsSync(file), true)
})

test('corrupt file → RunStoreCorruptError at construct; file NOT overwritten, nothing fabricated', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{ corrupt not json ')
  const before = fs.readFileSync(file, 'utf8')
  assert.throws(
    () => createRunStore({ dispatcher: noDispatch(), persistence: file }),
    (err) => { assert.ok(err instanceof runPersist.RunStoreCorruptError); return true }
  )
  assert.equal(fs.readFileSync(file, 'utf8'), before) // corrupt file untouched
  assert.equal(fs.existsSync(file + '.tmp'), false)
})

test('in-memory mode (persistence:false) writes no file — pre-B2-10 behaviour', () => {
  const file = tmpFile()
  const store = createRunStore({ dispatcher: noDispatch(), authorizeDispatch: () => false, persistence: false })
  store.startRun(INPUT())
  assert.equal(fs.existsSync(file), false)
  assert.equal(store.listRuns().length, 1)
})
