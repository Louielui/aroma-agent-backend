'use strict'

/**
 * orderRegistry.test.js — Computer Operator v0, Phase 2.
 *
 * One live order, and one attempt per step. Both are structural: a refusal is returned,
 * never an exception a caller could catch and continue past.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createOrderRegistry } = require('./orderRegistry')

const reg = (t = { v: 1000 }) => ({ r: createOrderRegistry({ now: () => t.v }), t })

/* ── one live order ───────────────────────────────────────────────────────── */

test('*** a second order is refused while one is live — there is no queue ***', () => {
  const { r } = reg()
  assert.equal(r.admit({ approvalId: 'appr_a', stepCount: 2, timeoutSec: 60 }).ok, true)
  const second = r.admit({ approvalId: 'appr_b', stepCount: 1, timeoutSec: 60 })
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'another_order_is_live')
  assert.equal(r.liveApprovalId(), 'appr_a', 'the first is untouched by the attempt')
})

test('closing the live order lets the next one in', () => {
  const { r } = reg()
  r.admit({ approvalId: 'appr_a', stepCount: 1, timeoutSec: 60 })
  assert.equal(r.close('appr_a').ok, true)
  assert.equal(r.admit({ approvalId: 'appr_b', stepCount: 1, timeoutSec: 60 }).ok, true)
})

test('an expired order stops blocking, and stops being live', () => {
  const t = { v: 1000 }
  const r = createOrderRegistry({ now: () => t.v })
  r.admit({ approvalId: 'appr_a', stepCount: 1, timeoutSec: 60 })
  assert.equal(r.isLive('appr_a'), true)
  t.v += 61_000
  assert.equal(r.isLive('appr_a'), false, 'past its window')
  assert.equal(r.admit({ approvalId: 'appr_b', stepCount: 1, timeoutSec: 60 }).ok, true)
})

test('admission is fail-closed on malformed input', () => {
  const { r } = reg()
  assert.equal(r.admit({ approvalId: '../x', stepCount: 1, timeoutSec: 60 }).reason, 'bad_approval_id')
  assert.equal(r.admit({ approvalId: 'a', stepCount: 0, timeoutSec: 60 }).reason, 'bad_step_count')
  assert.equal(r.admit({ approvalId: 'a', stepCount: 1, timeoutSec: 0 }).reason, 'bad_timeout')
  assert.equal(r.admit({}).ok, false)
})

/* ── single-use steps ─────────────────────────────────────────────────────── */

test('*** a step nonce burns on FIRST use — replay and double-submit both refused ***', () => {
  const { r } = reg()
  const a = r.admit({ approvalId: 'appr_a', stepCount: 2, timeoutSec: 60 })
  const first = r.consumeStep({ approvalId: 'appr_a', stepIndex: 0, stepNonce: a.stepNonces[0] })
  assert.equal(first.ok, true)
  const replay = r.consumeStep({ approvalId: 'appr_a', stepIndex: 0, stepNonce: a.stepNonces[0] })
  assert.equal(replay.ok, false)
  assert.equal(replay.reason, 'nonce_already_used')
})

test('*** a nonce is bound to its POSITION — step 2\'s nonce cannot run step 1 ***', () => {
  const { r } = reg()
  const a = r.admit({ approvalId: 'appr_a', stepCount: 3, timeoutSec: 60 })
  const wrong = r.consumeStep({ approvalId: 'appr_a', stepIndex: 0, stepNonce: a.stepNonces[1] })
  assert.equal(wrong.ok, false)
  assert.equal(wrong.reason, 'nonce_not_bound_to_this_step')
  // …and it is burned anyway: something held a nonce it should not have, so it must not
  // stay usable in its correct position either
  const later = r.consumeStep({ approvalId: 'appr_a', stepIndex: 1, stepNonce: a.stepNonces[1] })
  assert.equal(later.ok, false)
  assert.equal(later.reason, 'nonce_already_used')
})

test('a nonce from another order is unknown here', () => {
  const { r } = reg()
  const a = r.admit({ approvalId: 'appr_a', stepCount: 1, timeoutSec: 60 })
  r.close('appr_a')
  r.admit({ approvalId: 'appr_b', stepCount: 1, timeoutSec: 60 })
  const cross = r.consumeStep({ approvalId: 'appr_b', stepIndex: 0, stepNonce: a.stepNonces[0] })
  assert.equal(cross.ok, false)
  assert.equal(cross.reason, 'unknown_nonce')
})

test('steps cannot be consumed against the wrong order, or with no order live', () => {
  const { r } = reg()
  assert.equal(r.consumeStep({ approvalId: 'appr_a', stepIndex: 0, stepNonce: 'x' }).reason, 'no_live_order')
  const a = r.admit({ approvalId: 'appr_a', stepCount: 1, timeoutSec: 60 })
  assert.equal(r.consumeStep({ approvalId: 'appr_zz', stepIndex: 0, stepNonce: a.stepNonces[0] }).reason, 'wrong_order')
})

test('nonces are unguessable and distinct per step', () => {
  const { r } = reg()
  const a = r.admit({ approvalId: 'appr_a', stepCount: 5, timeoutSec: 60 })
  assert.equal(new Set(a.stepNonces).size, 5, 'all different')
  for (const n of a.stepNonces) assert.ok(n.length >= 16, 'long enough not to be guessed')
})

test('every refusal is a returned value, never a thrown error', () => {
  // A caller must not be able to proceed by catching.
  const { r } = reg()
  assert.doesNotThrow(() => r.consumeStep({}))
  assert.doesNotThrow(() => r.admit({}))
  assert.doesNotThrow(() => r.close('nope'))
})
