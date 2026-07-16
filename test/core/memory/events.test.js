'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildEvent, verifyEvent } = require('../../../src/core/memory/events')

const BASE = { store: 'identity', recordId: 'r', targetRevisionId: 'rev1', eventId: 'e1', sequence: 1, eventType: 'SUBMITTED_FOR_REVIEW', actor: 'xiangxiang', approval: null, rationale: 'x', expectedPreviousState: 'new', timestampLabel: 'L' }

test('buildEvent produces a hashed lifecycle artifact', () => {
  const ev = buildEvent(BASE)
  assert.equal(ev.kind, 'event')
  assert.match(ev.eventHash, /^[a-f0-9]{64}$/)
  assert.equal(verifyEvent(ev), true)
})

test('APPROVED event requires an approval record', () => {
  assert.throws(() => buildEvent({ ...BASE, eventType: 'APPROVED', expectedPreviousState: 'review_ready', approval: null }), (e) => e.code === 'VALIDATION_ERROR')
  const ok = buildEvent({ ...BASE, eventType: 'APPROVED', expectedPreviousState: 'review_ready', approval: { approvedBy: 'louie', decision: 'approved' } })
  assert.equal(ok.approval.approvedBy, 'louie')
})

test('rejects an event type not valid for the store domain', () => {
  // ADMITTED is an experience event, not an identity event
  assert.throws(() => buildEvent({ ...BASE, eventType: 'ADMITTED' }), (e) => e.code === 'VALIDATION_ERROR')
  assert.throws(() => buildEvent({ ...BASE, sequence: 0 }), (e) => e.code === 'VALIDATION_ERROR')
})

test('verifyEvent detects tampering', () => {
  const ev = buildEvent(BASE)
  assert.throws(() => verifyEvent({ ...ev, actor: 'someone-else' }), (e) => e.code === 'HASH_MISMATCH')
})
