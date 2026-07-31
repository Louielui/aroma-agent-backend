'use strict'

/**
 * sealedOrderGate.test.js — the unlock decision, held to the Owner's exact wording.
 *
 * The ruling of 2026-07-31 moved five action names from absolute prohibition to default deny
 * with ONE unlock condition, and named the failure mode to avoid in the same sentence: the
 * unlock must not degrade to "the flag is on". So the test that matters most in this file is
 * the one asserting that a flag turned on, with no order, unlocks nothing.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const gate = require('./sealedOrderGate')
const { verifyUnlock, verifySeal, computeOrderHash, ALLOWED_PATH, LIMITS, RESTRICTED_ACTIONS, NEVER_ACTIONS, CAP } = gate

const TEXT = 'Aroma Computer Operator canary. Round 1.'
const BIND = { processId: 4242, sessionId: 1, windowHandle: '0x9001', uiaControlId: 'Edit1' }

function seal (over = {}) {
  const o = Object.assign({
    orderId: 'wo_canary_1',
    approvalId: 'appr_canary_1',
    sealed: true,
    sealedText: TEXT,
    allowedPath: ALLOWED_PATH,
    maxSteps: 3,
    timeoutSec: 300,
    steps: [
      { n: 1, action: 'open_app', appId: 'notepad' },
      { n: 2, action: 'type_text', text: TEXT, bind: Object.assign({}, BIND) },
      { n: 3, action: 'save', fileName: 'canary-1.txt', bind: Object.assign({}, BIND) }
    ]
  }, over)
  if (!o.orderHash) o.orderHash = computeOrderHash(o)
  return o
}

const ON = { flag: 'on' }

/* ── the line the Owner drew ──────────────────────────────────────────────── */

test('*** THE FLAG IS NOT SUFFICIENT — on, with no order, unlocks nothing ***', () => {
  for (const action of RESTRICTED_ACTIONS) {
    const r = verifyUnlock({ action, flag: 'on' })
    assert.equal(r.ok, false, action)
    assert.equal(r.refusal, 'sealed_order_required', action)
    assert.match(r.reason, /unlocks nothing by itself/)
  }
})

test('*** the flag is still NECESSARY — a perfect order with the flag off is refused ***', () => {
  for (const flag of ['off', undefined, '', 'ON', 'yes', '1', true]) {
    const r = verifyUnlock({ action: 'type_text', order: seal(), flag })
    assert.equal(r.ok, false, String(flag))
    assert.equal(r.refusal, 'flag_off', String(flag))
  }
})

test('*** all five conditions together, and then it unlocks ***', () => {
  for (const action of ['open_app', 'type_text', 'save']) {
    const r = verifyUnlock({ action, order: seal(), flag: 'on', killSwitch: { isStopped: () => false } })
    assert.equal(r.ok, true, action)
    assert.equal(r.approvalId, 'appr_canary_1')
  }
})

/* ── the never-list is decided before the order is read ───────────────────── */

test('*** NO order unlocks a NEVER action — however perfect the seal ***', () => {
  for (const action of NEVER_ACTIONS) {
    // Presented WITH a valid order, the flag on and nothing stopped: the strongest case
    // anyone could make, and it is still refused.
    const order = seal({ steps: [{ n: 1, action: 'open_app', appId: 'notepad' }] })
    const r = verifyUnlock({ action, order, flag: 'on', killSwitch: { isStopped: () => false } })
    assert.equal(r.ok, false, action)
    assert.equal(r.refusal, 'action_never_permitted', action)
  }
})

test('the never-list and the restricted list do not overlap', () => {
  for (const a of RESTRICTED_ACTIONS) assert.equal(NEVER_ACTIONS.includes(a), false, 'both lists name: ' + a)
  assert.deepEqual([...RESTRICTED_ACTIONS].sort(), ['launch_app', 'open_app', 'save', 'send_keys', 'type_text'])
  for (const must of ['move_mouse', 'click', 'set_clipboard', 'write_file', 'network', 'read_file']) {
    assert.ok(NEVER_ACTIONS.includes(must), 'must stay absolute: ' + must)
  }
})

test('write_file stays NEVER even though save is unlockable', () => {
  // The distinction is the whole reason both names exist: `save` is Notepad writing through
  // its own dialog, `write_file` is this system writing to disk. One is gated, one is not
  // available at any price, and collapsing them would quietly grant the second.
  assert.equal(verifyUnlock({ action: 'write_file', order: seal(), flag: 'on' }).refusal, 'action_never_permitted')
  assert.ok(RESTRICTED_ACTIONS.includes('save'))
})

/* ── the seal ─────────────────────────────────────────────────────────────── */

test('*** an unsealed, unapproved or unhashed order unlocks nothing ***', () => {
  const cases = [
    [{ sealed: false }, 'order_not_sealed'],
    [{ sealed: undefined }, 'order_not_sealed'],
    [{ approvalId: '' }, 'order_not_approved'],
    [{ approvalId: null }, 'order_not_approved'],
    [{ orderHash: 'f'.repeat(64) }, 'order_hash_mismatch']
  ]
  for (const [over, refusal] of cases) {
    const r = verifyUnlock(Object.assign({ action: 'type_text', order: seal(over) }, ON))
    assert.equal(r.refusal, refusal, JSON.stringify(over))
  }
  // An empty or missing hash, set AFTER sealing so the helper cannot fill it back in.
  for (const bad of ['', null, undefined, 42]) {
    const o = seal()
    o.orderHash = bad
    assert.equal(verifyUnlock(Object.assign({ action: 'type_text', order: o }, ON)).refusal,
      'order_not_sealed', String(bad))
  }
  assert.equal(verifyUnlock({ action: 'type_text', flag: 'on', order: null }).refusal, 'sealed_order_required')
})

test('*** allowedPath must be EXACTLY the one directory ***', () => {
  const wrong = [
    'C:\\Aroma\\ComputerOperator-Test\\', // trailing separator
    'C:\\Aroma',
    'C:\\Aroma\\ComputerOperator-Test\\sub',
    'c:\\aroma\\computeroperator-test',
    'C:\\Aroma\\ComputerOperator-Test2',
    '\\\\server\\share',
    '',
    undefined
  ]
  for (const allowedPath of wrong) {
    const o = seal({ allowedPath })
    o.orderHash = computeOrderHash(o) // re-seal, so ONLY the path rule can catch it
    assert.equal(verifyUnlock(Object.assign({ action: 'type_text', order: o }, ON)).refusal,
      'allowed_path_mismatch', String(allowedPath))
  }
  assert.equal(ALLOWED_PATH, 'C:\\Aroma\\ComputerOperator-Test')
})

test('*** the limits are carried IN the order, and bounded ***', () => {
  assert.equal(LIMITS.maxSteps, 10)
  assert.equal(LIMITS.timeoutSec, 300)
  for (const over of [{ maxSteps: 11 }, { maxSteps: 0 }, { maxSteps: 3.5 }, { maxSteps: '3' },
    { timeoutSec: 301 }, { timeoutSec: 0 }, { timeoutSec: null }]) {
    const o = seal(over)
    o.orderHash = computeOrderHash(o)
    assert.equal(verifyUnlock(Object.assign({ action: 'type_text', order: o }, ON)).refusal,
      'limits_exceeded', JSON.stringify(over))
  }
})

test('the limits are inside the hash, so they cannot be edited after approval', () => {
  const base = seal()
  for (const field of ['allowedPath', 'maxSteps', 'timeoutSec', 'sealedText', 'orderId', 'approvalId']) {
    const o = JSON.parse(JSON.stringify(base))
    o[field] = field === 'maxSteps' || field === 'timeoutSec' ? 9 : 'tampered'
    assert.notEqual(computeOrderHash(o), base.orderHash, 'the hash must cover: ' + field)
  }
})

test('*** an order that does not contain the action does not authorise it ***', () => {
  // A valid, sealed, approved order for opening Notepad is not permission to type.
  const openOnly = seal({ steps: [{ n: 1, action: 'open_app', appId: 'notepad' }], maxSteps: 1 })
  assert.equal(verifyUnlock(Object.assign({ action: 'open_app', order: openOnly }, ON)).ok, true)
  assert.equal(verifyUnlock(Object.assign({ action: 'type_text', order: openOnly }, ON)).refusal, 'action_not_in_order')
  assert.equal(verifyUnlock(Object.assign({ action: 'save', order: openOnly }, ON)).refusal, 'action_not_in_order')
})

/* ── the kill switch ──────────────────────────────────────────────────────── */

test('*** a stopped run unlocks nothing — the 3a binding is not weakened ***', () => {
  const stopped = { isStopped: () => true }
  for (const action of RESTRICTED_ACTIONS) {
    const r = verifyUnlock({ action, order: seal(), flag: 'on', killSwitch: stopped })
    assert.equal(r.ok, false, action)
    assert.equal(r.refusal, 'stopped', action)
  }
  // and it is checked BEFORE the flag, so a stopped run reads as stopped rather than as a
  // configuration problem
  assert.equal(verifyUnlock({ action: 'type_text', flag: 'off', killSwitch: stopped }).refusal, 'stopped')
})

/* ── the capability states ────────────────────────────────────────────────── */

test('the three capability states are distinct and named', () => {
  assert.equal(CAP.OFF, false)
  assert.equal(CAP.SEALED_ORDER_ONLY, 'sealed_order_only')
  assert.equal(CAP.NEVER, 'never')
  assert.notEqual(CAP.SEALED_ORDER_ONLY, true, 'unlockable is not the same as enabled')
})

test('verifySeal is pure — it neither mutates the order nor touches anything', () => {
  const o = seal()
  const before = JSON.stringify(o)
  verifySeal(o)
  verifyUnlock(Object.assign({ action: 'type_text', order: o }, ON))
  assert.equal(JSON.stringify(o), before, 'the order came back unchanged')
})

test('an action nobody gated is refused rather than allowed by omission', () => {
  for (const action of ['fly', '', null, undefined, 42, 'read_uia_tree']) {
    const r = verifyUnlock({ action, order: seal(), flag: 'on' })
    assert.equal(r.ok, false, String(action))
    assert.equal(r.refusal, 'action_not_restricted', String(action))
  }
})
