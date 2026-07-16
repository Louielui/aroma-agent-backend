'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { deriveState, validateTransition, authorityDomain, allowedEventTypes } = require('../../../src/core/memory/lifecycle')

function seq (types) { return types.map((t, i) => ({ eventType: t, sequence: i + 1 })) }

test('authority domains are recorded (domain-scoped, not ranked)', () => {
  assert.equal(authorityDomain('identity'), 'identity')
  assert.equal(authorityDomain('personality'), 'behavior')
  assert.equal(authorityDomain('experience'), 'advisory')
  assert.equal(authorityDomain('skills'), 'capability')
})

test('approval is NOT auto-activation (identity)', () => {
  const afterApprove = deriveState('identity', seq(['SUBMITTED_FOR_REVIEW', 'APPROVED']))
  assert.equal(afterApprove.state, 'approved')
  assert.equal(afterApprove.approved, true)
  assert.equal(afterApprove.activated, false) // approved != active
  const afterActivate = deriveState('identity', seq(['SUBMITTED_FOR_REVIEW', 'APPROVED', 'ACTIVATED']))
  assert.equal(afterActivate.state, 'active')
  assert.equal(afterActivate.activated, true)
})

test('experience cannot be ADMITTED without APPROVED (no auto-admit)', () => {
  // from review_ready, ADMITTED is not a valid transition (must go through approved)
  assert.throws(() => validateTransition('experience', { state: 'review_ready', enabled: false }, 'ADMITTED'), (e) => e.code === 'INVALID_TRANSITION')
  // and structurally there is no ADMITTED edge except from 'approved'
  assert.equal(validateTransition('experience', { state: 'approved', enabled: false }, 'ADMITTED').state, 'active')
})

test('skill activated but ENABLED is separate; DISABLED requires enabled', () => {
  const active = deriveState('skills', seq(['REGISTERED', 'APPROVED', 'ACTIVATED']))
  assert.equal(active.state, 'active')
  assert.equal(active.enabled, false) // registered/approved/active but DISABLED by default
  assert.equal(validateTransition('skills', { state: 'active', enabled: false }, 'ENABLED').enabled, true)
  assert.throws(() => validateTransition('skills', { state: 'active', enabled: false }, 'DISABLED'), (e) => e.code === 'INVALID_TRANSITION')
  assert.throws(() => validateTransition('skills', { state: 'approved', enabled: false }, 'ENABLED'), (e) => e.code === 'INVALID_TRANSITION')
})

test('invalid transition throws INVALID_TRANSITION', () => {
  assert.throws(() => validateTransition('identity', { state: 'new', enabled: false }, 'ACTIVATED'), (e) => e.code === 'INVALID_TRANSITION')
  assert.throws(() => validateTransition('identity', { state: 'approved', enabled: false }, 'APPROVED'), (e) => e.code === 'INVALID_TRANSITION')
})

test('allowedEventTypes are domain-specific', () => {
  assert.ok(allowedEventTypes('experience').has('ADMITTED'))
  assert.ok(!allowedEventTypes('identity').has('ADMITTED'))
  assert.ok(allowedEventTypes('skills').has('ENABLED'))
  assert.ok(!allowedEventTypes('identity').has('ENABLED'))
})
