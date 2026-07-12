'use strict'

/**
 * runPersistence.test.js — unit tests for the pure Run safe-write/load helper.
 * No paid calls, no worker. Each test uses its OWN temp dir (never the repo data/).
 *
 *   Run: node --test src/run/runPersistence.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { load, save, emptyShape, RunStoreCorruptError } = require('./runPersistence')

function tmpFile () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-run-persist-'))
  return path.join(dir, 'aroma-runs.json')
}
const RUN = (id) => ({ id, owner: 'louie', targetProject: 'backend', timeline: [{ stage: 'TASK_CREATED', at: '2026-07-12T00:00:00.000Z', facts: {} }], createdAt: '2026-07-12T00:00:00.000Z' })

test('load: missing file returns empty shape, never throws, does not create the file', () => {
  const file = tmpFile()
  assert.deepEqual(load(file), emptyShape())
  assert.deepEqual(load(file), { order: [], runs: {} })
  assert.equal(fs.existsSync(file), false)
})

test('save then load round-trips the envelope byte-identically', () => {
  const file = tmpFile()
  const env = { order: ['run_a'], runs: { run_a: RUN('run_a') } }
  save(file, env)
  assert.deepEqual(load(file), env)
})

test('save uses temp+rename: no .tmp remains and the file is valid JSON', () => {
  const file = tmpFile()
  save(file, emptyShape())
  assert.equal(fs.existsSync(file + '.tmp'), false)
  JSON.parse(fs.readFileSync(file, 'utf8'))
})

test('save is atomic: a pre-existing good file is replaced in place', () => {
  const file = tmpFile()
  save(file, { order: ['run_a'], runs: { run_a: RUN('run_a') } })
  assert.equal(load(file).order.length, 1)
  save(file, { order: ['run_a', 'run_b'], runs: { run_a: RUN('run_a'), run_b: RUN('run_b') } })
  assert.equal(load(file).order.length, 2)
})

test('load: malformed JSON throws RunStoreCorruptError and does NOT overwrite the file', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{ not valid json ')
  const before = fs.readFileSync(file, 'utf8')
  assert.throws(() => load(file), (err) => {
    assert.ok(err instanceof RunStoreCorruptError)
    assert.equal(err.name, 'RunStoreCorruptError')
    return true
  })
  assert.equal(fs.readFileSync(file, 'utf8'), before) // corrupt bytes untouched
})

test('load: wrong envelope shapes throw RunStoreCorruptError', () => {
  const f1 = tmpFile(); fs.writeFileSync(f1, JSON.stringify([1, 2, 3]))
  assert.throws(() => load(f1), RunStoreCorruptError)
  const f2 = tmpFile(); fs.writeFileSync(f2, JSON.stringify({ order: 'nope', runs: {} }))
  assert.throws(() => load(f2), RunStoreCorruptError)
  const f3 = tmpFile(); fs.writeFileSync(f3, JSON.stringify({ order: [], runs: 'nope' }))
  assert.throws(() => load(f3), RunStoreCorruptError)
})

test('load: order id with no matching record throws', () => {
  const file = tmpFile()
  fs.writeFileSync(file, JSON.stringify({ order: ['ghost'], runs: {} }))
  assert.throws(() => load(file), RunStoreCorruptError)
})

test('load: a run record without a timeline array is corruption (throws)', () => {
  const file = tmpFile()
  fs.writeFileSync(file, JSON.stringify({ order: ['run_x'], runs: { run_x: { id: 'run_x', owner: 'louie' } } }))
  assert.throws(() => load(file), RunStoreCorruptError)
})
