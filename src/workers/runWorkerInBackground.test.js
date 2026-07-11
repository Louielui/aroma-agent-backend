'use strict'

/**
 * runWorkerInBackground.test.js — B2-1 Step 3 (unit). Deterministic: injected
 * clock/newId, a no-op sandbox prep (no git spawn), a stub worker (no claude).
 * Proves the trigger writes an Execution Artifact and a linked Result Artifact,
 * mints a sandbox under os.tmpdir(), and survives a throwing worker.
 *
 *   Run: node --test src/workers/runWorkerInBackground.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createArtifactStore } = require('../store/artifactStore')
const { createWorkerRunner } = require('./runWorkerInBackground')

const tempBase = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-run-'))

function makeRunner (store, worker) {
  let i = 0
  return createWorkerRunner({
    worker,
    artifactStore: store,
    sandboxRoot: os.tmpdir(),
    prepareSandbox: () => {}, // no git subprocess in unit tests
    clock: () => '2026-07-11T12:00:00.000Z',
    newId: (p) => `${p}_${i++}`
  })
}

test('requires a worker with invoke() and an artifactStore with write()', () => {
  assert.throws(() => createWorkerRunner({}), TypeError)
  assert.throws(() => createWorkerRunner({ worker: { invoke () {} } }), TypeError)
})

test('writes Execution + linked Result artifacts; sandbox is under os.tmpdir()', async () => {
  const base = tempBase()
  try {
    const store = createArtifactStore({ baseDir: base })
    const worker = {
      invoke: async () => ({ ok: true, output: { exit: 0, result: 'done', relay: { toUser: 0, fromUser: 0, manual: 0 } }, cost: 0.002, error: null })
    }
    const out = await makeRunner(store, worker).run({
      proposalId: 'prop_a', runId: 'run_a', task: 'create hello',
      approval: { confirmedBy: 'louie', confirmedAt: '2026-07-11T11:59:00.000Z' }
    })

    const exec = store.read('tasks', out.taskId)
    assert.ok(exec)
    assert.equal(exec.proposalId, 'prop_a')
    assert.equal(exec.runId, 'run_a')
    assert.equal(exec.task, 'create hello')
    assert.equal(exec.approval.confirmedBy, 'louie')
    const rel = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(exec.sandbox))
    assert.ok(rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel), 'sandbox under tmpdir')

    const result = store.read('results', out.resultId)
    assert.ok(result)
    assert.equal(result.taskId, out.taskId) // Result -> Execution link
    assert.equal(result.proposalId, 'prop_a')
    assert.equal(result.ok, true)
    assert.deepEqual(result.relay, { toUser: 0, fromUser: 0, manual: 0 })

    fs.rmSync(exec.sandbox, { recursive: true, force: true })
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})

test('a throwing worker still records a failed Result (no unhandled rejection)', async () => {
  const base = tempBase()
  try {
    const store = createArtifactStore({ baseDir: base })
    const worker = { invoke: async () => { throw new Error('boom') } }
    const out = await makeRunner(store, worker).run({ proposalId: 'p', runId: 'r', task: 't', approval: null })

    assert.equal(store.read('tasks', out.taskId).task, 't') // execution still recorded
    const result = store.read('results', out.resultId)
    assert.equal(result.ok, false)
    assert.match(result.error, /boom/)
    fs.rmSync(result.sandbox, { recursive: true, force: true })
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})
