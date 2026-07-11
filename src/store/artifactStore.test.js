'use strict'

/**
 * artifactStore.test.js — B2-1 Step 1. Exercises the filesystem artifact store
 * (.aroma/tasks + .aroma/results) against a throwaway temp dir under os.tmpdir(),
 * so no test ever writes into the repo.
 *
 *   Run: node --test src/store/artifactStore.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createArtifactStore, KINDS } = require('./artifactStore')

function freshBase () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-artifacts-'))
}
function cleanup (dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

test('requires a non-empty baseDir', () => {
  assert.throws(() => createArtifactStore(), TypeError)
  assert.throws(() => createArtifactStore({ baseDir: '' }), TypeError)
})

test('write then read round-trips a task and a result', () => {
  const base = freshBase()
  try {
    const store = createArtifactStore({ baseDir: base })
    const task = { id: 'task_1', createdAt: '2026-07-11T10:00:00.000Z', proposalId: 'prop_a', approval: { approvedBy: 'louie' } }
    const result = { id: 'res_1', createdAt: '2026-07-11T10:01:00.000Z', taskId: 'task_1', ok: true }

    const wt = store.write('tasks', task)
    const wr = store.write('results', result)
    assert.match(wt.path, /[/\\]tasks[/\\]/)
    assert.match(wr.path, /[/\\]results[/\\]/)

    assert.deepEqual(store.read('tasks', 'task_1'), task)
    assert.deepEqual(store.read('results', 'res_1'), result)
  } finally { cleanup(base) }
})

test('filename is timestamped (sanitized createdAt) and id-suffixed', () => {
  const base = freshBase()
  try {
    const store = createArtifactStore({ baseDir: base })
    const { path: p } = store.write('tasks', { id: 'task_x', createdAt: '2026-07-11T10:00:00.000Z' })
    const name = path.basename(p)
    // ':' and '.' sanitized to '-'; ends with -<id>.json
    assert.equal(name, '2026-07-11T10-00-00-000Z-task_x.json')
    assert.ok(!name.includes(':'))
  } finally { cleanup(base) }
})

test('read returns null for a missing id or an empty store', () => {
  const base = freshBase()
  try {
    const store = createArtifactStore({ baseDir: base })
    assert.equal(store.read('tasks', 'nope'), null)     // dir does not exist yet
    store.write('tasks', { id: 'task_1', createdAt: '2026-07-11T10:00:00.000Z' })
    assert.equal(store.read('tasks', 'other'), null)    // dir exists, no match
  } finally { cleanup(base) }
})

test('list returns every record oldest-first', () => {
  const base = freshBase()
  try {
    const store = createArtifactStore({ baseDir: base })
    store.write('results', { id: 'b', createdAt: '2026-07-11T10:02:00.000Z' })
    store.write('results', { id: 'a', createdAt: '2026-07-11T10:01:00.000Z' })
    const ids = store.list('results').map(r => r.id)
    assert.deepEqual(ids, ['a', 'b']) // chronological by createdAt, not insert order
    assert.equal(store.list('tasks').length, 0)
  } finally { cleanup(base) }
})

test('write rejects a record without id or createdAt', () => {
  const base = freshBase()
  try {
    const store = createArtifactStore({ baseDir: base })
    assert.throws(() => store.write('tasks', {}), TypeError)
    assert.throws(() => store.write('tasks', { id: 'x' }), TypeError)
    assert.throws(() => store.write('tasks', { createdAt: '2026-07-11T10:00:00.000Z' }), TypeError)
  } finally { cleanup(base) }
})

test('an unknown artifact kind throws', () => {
  const base = freshBase()
  try {
    const store = createArtifactStore({ baseDir: base })
    assert.throws(() => store.write('logs', { id: 'x', createdAt: '2026-07-11T10:00:00.000Z' }), /unknown artifact kind/)
    assert.throws(() => store.read('logs', 'x'), /unknown artifact kind/)
    assert.deepEqual(KINDS, ['tasks', 'results'])
  } finally { cleanup(base) }
})
