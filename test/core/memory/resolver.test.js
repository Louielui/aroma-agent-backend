'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const store = require('../../../src/core/memory/store')
const { tmpBase, cleanup, createRev, ev, activateIdentityLike } = require('./_helpers')

test('unapproved revision is never active', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    ev(base, 'identity', 'id1', 'r1', 'SUBMITTED_FOR_REVIEW', 'new')
    assert.equal(store.resolveActiveRecord(base, 'identity', 'id1').status, 'NONE')
  } finally { cleanup(base) }
})

test('two independently-active revisions -> AMBIGUOUS_ACTIVE_STATE (never "highest wins")', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    activateIdentityLike(base, 'identity', 'id1', 'r1')
    createRev(base, 'identity', 'id1', { revisionId: 'r2', supersedes: 'r1' })
    activateIdentityLike(base, 'identity', 'id1', 'r2') // both active, no SUPERSEDED recorded
    const res = store.resolveActiveRecord(base, 'identity', 'id1')
    assert.equal(res.status, 'AMBIGUOUS_ACTIVE_STATE')
    assert.deepEqual(res.candidates.sort(), ['r1', 'r2'])
  } finally { cleanup(base) }
})

test('superseding resolves back to a single active', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    activateIdentityLike(base, 'identity', 'id1', 'r1')
    createRev(base, 'identity', 'id1', { revisionId: 'r2', supersedes: 'r1' })
    activateIdentityLike(base, 'identity', 'id1', 'r2')
    ev(base, 'identity', 'id1', 'r1', 'SUPERSEDED', 'active') // retire the old one
    const res = store.resolveActiveRecord(base, 'identity', 'id1')
    assert.equal(res.status, 'ACTIVE')
    assert.equal(res.revisionId, 'r2')
  } finally { cleanup(base) }
})

test('validity window excludes an expired active revision when asOf is supplied', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1', selectors: { tags: [], links: [], validUntil: '2026-01-01T00:00:00Z' } })
    activateIdentityLike(base, 'identity', 'id1', 'r1')
    assert.equal(store.resolveActiveRecord(base, 'identity', 'id1', { asOf: '2025-06-01T00:00:00Z' }).status, 'ACTIVE')
    assert.equal(store.resolveActiveRecord(base, 'identity', 'id1', { asOf: '2027-06-01T00:00:00Z' }).status, 'NONE')
  } finally { cleanup(base) }
})
