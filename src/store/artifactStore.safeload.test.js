'use strict'

/**
 * artifactStore.safeload.test.js — B2-11a safe-load for .aroma artifact READS.
 *
 * Contract:
 *   read(kind, id): missing → null (as today); FOUND but malformed → throw
 *     ArtifactCorruptError (controlled, distinct from not-found); never a raw
 *     crash, never a half-written file read as valid, never overwritten.
 *   list(kind):     SKIP-and-continue on a malformed entry (a crash mid-write
 *     leaves invalid JSON); return the valid records; never crash the whole list.
 *   missing dir:    read → null, list → [] (as today).
 *
 * Writes are NOT changed. No paid calls, no worker.
 *
 *   Run: node --test src/store/artifactStore.safeload.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createArtifactStore, ArtifactCorruptError } = require('./artifactStore')

function tmpBase () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-artifact-'))
}

test('read: valid → record; missing → null; malformed → ArtifactCorruptError (file untouched)', () => {
  const base = tmpBase()
  const store = createArtifactStore({ baseDir: base })
  store.write('results', { id: 'result_ok', createdAt: '2026-07-12T00:00:00.000Z', kind: 'result', ok: true })

  assert.equal(store.read('results', 'result_ok').ok, true) // valid
  assert.equal(store.read('results', 'nope'), null) // missing id → null

  // a half-written / malformed artifact (crash mid-write leaves invalid JSON)
  const dir = path.join(base, 'results')
  const badPath = path.join(dir, '2026-07-12T00-00-01-000Z-result_bad.json')
  fs.writeFileSync(badPath, '{ "id": "result_bad", "ok": tr') // truncated
  const before = fs.readFileSync(badPath, 'utf8')

  assert.throws(() => store.read('results', 'result_bad'), (err) => {
    assert.ok(err instanceof ArtifactCorruptError)
    assert.equal(err.name, 'ArtifactCorruptError')
    return true
  })
  assert.equal(fs.readFileSync(badPath, 'utf8'), before) // corrupt file NOT overwritten
})

test('list: skips the malformed entry and returns the valid ones (never crashes, never misreads)', () => {
  const base = tmpBase()
  const store = createArtifactStore({ baseDir: base })
  store.write('results', { id: 'result_a', createdAt: '2026-07-12T00:00:00.000Z', kind: 'result', ok: true })
  store.write('results', { id: 'result_c', createdAt: '2026-07-12T00:00:02.000Z', kind: 'result', ok: false })
  // insert a corrupt file BETWEEN them (sorts in the middle)
  fs.writeFileSync(path.join(base, 'results', '2026-07-12T00-00-01-000Z-result_bad.json'), 'not json at all')

  const listed = store.list('results')
  assert.equal(listed.length, 2, 'corrupt entry skipped, valid ones returned')
  assert.deepEqual(listed.map(r => r.id), ['result_a', 'result_c'])
})

test('missing dir → read null, list [] (controlled, as today)', () => {
  const store = createArtifactStore({ baseDir: tmpBase() })
  assert.equal(store.read('tasks', 'x'), null)
  assert.deepEqual(store.list('tasks'), [])
  assert.deepEqual(store.list('results'), [])
})
