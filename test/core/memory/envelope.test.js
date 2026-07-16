'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildRevision, verifyRevision } = require('../../../src/core/memory/envelope')

const BASE = { store: 'identity', recordId: 'r', revisionId: 'rev1', revision: 1, supersedes: null, selectors: { tags: [], links: [] }, provenance: { source: 's', author: 'a', evidence: [] }, payload: { v: 1 }, createdAtLabel: 'L' }

test('buildRevision produces a hashed, lifecycle-free content artifact', () => {
  const rev = buildRevision(BASE)
  assert.equal(rev.kind, 'revision')
  assert.equal(rev.authorityDomain, 'identity')
  assert.match(rev.contentHash, /^[a-f0-9]{64}$/)
  assert.equal('lifecycleState' in rev, false) // state is NOT stored on the revision
  assert.equal('approval' in rev, false) // approval is NOT stored on the revision
})

test('verifyRevision detects tampering', () => {
  const rev = buildRevision(BASE)
  assert.equal(verifyRevision(rev), true)
  const tampered = { ...rev, payload: { v: 999 } }
  assert.throws(() => verifyRevision(tampered), (e) => e.code === 'HASH_MISMATCH')
})

test('validation rejects bad input', () => {
  assert.throws(() => buildRevision({ ...BASE, store: 'nope' }), (e) => e.code === 'VALIDATION_ERROR')
  assert.throws(() => buildRevision({ ...BASE, revision: 0 }), (e) => e.code === 'VALIDATION_ERROR')
  assert.throws(() => buildRevision({ ...BASE, provenance: { source: 's' } }), (e) => e.code === 'VALIDATION_ERROR')
  assert.throws(() => buildRevision({ ...BASE, payload: [1, 2] }), (e) => e.code === 'VALIDATION_ERROR')
})
