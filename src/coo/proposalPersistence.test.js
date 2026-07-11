'use strict'

/**
 * proposalPersistence.test.js — unit tests for the pure safe-write/load helper.
 *
 * No paid calls, no real LLM, no server. Every test writes into its OWN temp
 * directory (os.tmpdir + mkdtempSync), so tests never collide and never touch
 * the repo's data/ dir.
 *
 *   Run: node --test src/coo/proposalPersistence.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { load, save, emptyShape, ProposalStoreCorruptError } = require('./proposalPersistence')

/** A fresh temp dir + the store file path inside it. */
function tmpFile () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-prop-persist-'))
  return path.join(dir, 'aroma-proposals.json')
}

test('load: missing file returns an empty shape, NEVER throws', () => {
  const file = tmpFile() // parent dir exists, file does not
  const data = load(file)
  assert.deepEqual(data, emptyShape())
  assert.deepEqual(data, { order: [], proposals: {} })
  // safe init must NOT have created the file
  assert.equal(fs.existsSync(file), false)
})

test('save then load round-trips the envelope byte-identically', () => {
  const file = tmpFile()
  const env = { order: ['prop_a'], proposals: { prop_a: { id: 'prop_a', status: 'pending', task: 'x' } } }
  save(file, env)
  assert.deepEqual(load(file), env)
})

test('save uses temp+rename: no .tmp remains and the file is valid JSON', () => {
  const file = tmpFile()
  save(file, { order: [], proposals: {} })
  assert.equal(fs.existsSync(file + '.tmp'), false, 'no leftover .tmp')
  // the real file parses cleanly
  JSON.parse(fs.readFileSync(file, 'utf8'))
})

test('save is atomic: a pre-existing good file survives (rename replaces in place)', () => {
  const file = tmpFile()
  save(file, { order: ['a'], proposals: { a: { id: 'a', status: 'pending' } } })
  const first = load(file)
  save(file, { order: ['a', 'b'], proposals: { a: { id: 'a', status: 'pending' }, b: { id: 'b', status: 'pending' } } })
  assert.equal(first.order.length, 1)
  assert.equal(load(file).order.length, 2)
})

test('load: malformed JSON throws ProposalStoreCorruptError and does NOT overwrite the file', () => {
  const file = tmpFile()
  fs.writeFileSync(file, '{ this is not valid json ')
  const before = fs.readFileSync(file, 'utf8')
  assert.throws(() => load(file), (err) => {
    assert.ok(err instanceof ProposalStoreCorruptError)
    assert.equal(err.name, 'ProposalStoreCorruptError')
    return true
  })
  // the corrupt bytes are untouched — never silently recreated/emptied
  assert.equal(fs.readFileSync(file, 'utf8'), before)
})

test('load: valid JSON but wrong top-level shape throws ProposalStoreCorruptError', () => {
  const file = tmpFile()
  fs.writeFileSync(file, JSON.stringify([1, 2, 3])) // an array, not the envelope
  assert.throws(() => load(file), ProposalStoreCorruptError)
})

test('load: order id with no matching record throws (structural integrity)', () => {
  const file = tmpFile()
  fs.writeFileSync(file, JSON.stringify({ order: ['ghost'], proposals: {} }))
  assert.throws(() => load(file), ProposalStoreCorruptError)
})

test('load: non-array order / non-object proposals throw', () => {
  const f1 = tmpFile()
  fs.writeFileSync(f1, JSON.stringify({ order: 'nope', proposals: {} }))
  assert.throws(() => load(f1), ProposalStoreCorruptError)
  const f2 = tmpFile()
  fs.writeFileSync(f2, JSON.stringify({ order: [], proposals: 'nope' }))
  assert.throws(() => load(f2), ProposalStoreCorruptError)
})
