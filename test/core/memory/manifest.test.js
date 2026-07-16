'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { getStoreManifest, beginSnapshot } = require('../../../src/core/memory/manifest')
const { hashOf } = require('../../../src/core/memory/canonical')
const { tmpBase, cleanup, createRev, activateIdentityLike } = require('./_helpers')

test('manifest generation is stable for unchanged artifacts and changes when they change', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    activateIdentityLike(base, 'identity', 'id1', 'r1')
    const g1 = getStoreManifest(base, 'identity').generation
    assert.equal(getStoreManifest(base, 'identity').generation, g1) // stable
    createRev(base, 'identity', 'id2', { revisionId: 'r9' })
    assert.notEqual(getStoreManifest(base, 'identity').generation, g1) // advanced
    assert.match(g1, /^[a-f0-9]{64}$/)
  } finally { cleanup(base) }
})

test('snapshot lists relative artifacts with hashes that re-verify against files', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    activateIdentityLike(base, 'identity', 'id1', 'r1')
    const snap = beginSnapshot(base, 'identity')
    assert.ok(snap.generation && snap.artifacts.length >= 1)
    for (const a of snap.artifacts) {
      assert.ok(!a.relPath.includes(base), 'relative paths only, no absolute/user path')
      assert.ok(!path.isAbsolute(a.relPath))
      if (!a.unreadable) {
        const obj = JSON.parse(fs.readFileSync(path.join(base, 'identity', a.relPath), 'utf8'))
        const hashKey = a.kind === 'revision' ? 'contentHash' : 'eventHash'
        assert.equal(hashOf(obj, hashKey), a.hash) // Guardian can re-verify
      }
    }
  } finally { cleanup(base) }
})
