'use strict'

/**
 * operatingPrinciplesDomain.test.js — M3b-0.
 *
 * Verifies the additive registration of the 'operating-principles' store in M1's
 * central domain registry, and that the EXISTING generic M1 primitives (no
 * store-specific bypass) work for it: create revision, lifecycle events, integrity
 * verification, single-active resolution, ambiguous-active detection, index rebuild.
 * The four existing stores keep their behaviour; unknown stores still fail closed.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const lifecycle = require('../../../src/core/memory/lifecycle')
const store = require('../../../src/core/memory/store')
const { verifyRevision } = require('../../../src/core/memory/envelope')
const { verifyEvent } = require('../../../src/core/memory/events')
const { tmpBase, cleanup, createRev, ev, activateIdentityLike } = require('./_helpers')

const OP = 'operating-principles'

test('operating-principles is a known store; the four existing stores are unchanged; unknown fails closed', () => {
  assert.equal(lifecycle.isKnownStore(OP), true)
  for (const s of ['identity', 'personality', 'experience', 'skills']) assert.equal(lifecycle.isKnownStore(s), true)
  assert.equal(lifecycle.isKnownStore('nope'), false)
  // existing authority domains unchanged
  assert.equal(lifecycle.authorityDomain('identity'), 'identity')
  assert.equal(lifecycle.authorityDomain('personality'), 'behavior')
  assert.equal(lifecycle.authorityDomain('experience'), 'advisory')
  assert.equal(lifecycle.authorityDomain('skills'), 'capability')
  assert.equal(lifecycle.authorityDomain(OP), 'operating-principles')
})

test('operating-principles uses the generic lifecycle vocabulary (no skills-only ENABLE/DISABLE)', () => {
  const ev = lifecycle.allowedEventTypes(OP)
  for (const t of ['SUBMITTED_FOR_REVIEW', 'APPROVED', 'ACTIVATED', 'SUPERSEDED', 'DEPRECATED', 'REJECTED']) assert.ok(ev.has(t), `missing ${t}`)
  assert.equal(ev.has('ENABLED'), false)
  assert.equal(ev.has('DISABLED'), false)
})

test('generic M1 primitives drive the operating-principles store end-to-end (isolated temp dir)', () => {
  const base = tmpBase()
  try {
    const rev = createRev(base, OP, 'xiangxiang-operating-principles', { revisionId: 'r1', payload: { format: 'ordered-fragments', section: 'operating-principles', fragments: [] } })
    assert.equal(verifyRevision(rev), true)
    // lifecycle via generic events: SUBMITTED -> APPROVED -> ACTIVATED
    ev(base, OP, 'xiangxiang-operating-principles', 'r1', 'SUBMITTED_FOR_REVIEW', 'new')
    ev(base, OP, 'xiangxiang-operating-principles', 'r1', 'APPROVED', 'review_ready', { approval: { approvedBy: 'Louie', decision: 'approved' } })
    // APPROVED but not yet ACTIVATED -> not active
    assert.equal(store.resolveActiveRecord(base, OP, 'xiangxiang-operating-principles').status, 'NONE')
    ev(base, OP, 'xiangxiang-operating-principles', 'r1', 'ACTIVATED', 'approved')
    const active = store.resolveActiveRecord(base, OP, 'xiangxiang-operating-principles')
    assert.equal(active.status, 'ACTIVE')
    assert.equal(active.revisionId, 'r1')
    // events verify + index rebuild
    for (const e of store.listEvents(base, OP, 'xiangxiang-operating-principles')) assert.equal(verifyEvent(e), true)
    const idx = store.rebuildIndex(base, OP)
    assert.ok(idx.records['xiangxiang-operating-principles'])
  } finally { cleanup(base) }
})

test('ambiguous active is detected for operating-principles (single-active governance holds)', () => {
  const base = tmpBase()
  try {
    createRev(base, OP, 'rec', { revisionId: 'a' }); activateIdentityLike(base, OP, 'rec', 'a')
    createRev(base, OP, 'rec', { revisionId: 'b', supersedes: 'a' }); activateIdentityLike(base, OP, 'rec', 'b')
    assert.equal(store.resolveActiveRecord(base, OP, 'rec').status, 'AMBIGUOUS_ACTIVE_STATE')
  } finally { cleanup(base) }
})
