'use strict'

/**
 * sessionBoundary.test.js — Computer Operator v0, Phase 1.
 *
 * The split is the containment. Agent Bridge is safe because of what it LACKS — no
 * shell, no network, a throwaway clone — and none of that survives into a desktop
 * operator, which is a shell and a network by definition. What replaces it is this:
 * the half that decides cannot act, the half that acts cannot decide, and the boundary
 * between them is enforced by Windows, not by our code.
 *
 * Definition only. Nothing here opens a pipe, starts a process or names a real account.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  ROLE_SERVICE, ROLE_COMPANION, ROLES, COMPANION_ACCOUNT, CAPABILITIES,
  SERVICE_TO_COMPANION, COMPANION_TO_SERVICE, MESSAGE_TYPES, MAX_STEPS_IN_FLIGHT,
  STOP_CONDITIONS, validateEnvelope
} = require('./sessionBoundary')

const envelope = (over = {}) => Object.assign({
  from: ROLE_SERVICE, to: ROLE_COMPANION, type: 'execute_step',
  approvalId: 'appr_test01', stepIndex: 0, stepNonce: 'n'.repeat(24)
}, over)

/* ── the split ────────────────────────────────────────────────────────────── */

test('*** the half that DECIDES cannot act; the half that ACTS cannot decide ***', () => {
  const svc = CAPABILITIES[ROLE_SERVICE]
  const cmp = CAPABILITIES[ROLE_COMPANION]
  // the Service governs and is blind to the desktop
  assert.equal(svc.holdsSealedOrder, true)
  assert.equal(svc.writesAudit, true)
  assert.equal(svc.ownsKillSwitch, true)
  assert.equal(svc.touchesDesktop, false)
  assert.equal(svc.movesInput, false)
  assert.equal(svc.capturesScreen, false)
  // the Companion acts and authorizes nothing
  assert.equal(cmp.touchesDesktop, true)
  assert.equal(cmp.holdsSealedOrder, false)
  assert.equal(cmp.writesAudit, false)
  assert.equal(cmp.ownsKillSwitch, false)
  // and no capability is held by both — neither half is sufficient alone
  for (const k of Object.keys(svc)) {
    assert.equal(svc[k] && cmp[k], false, 'capability must not be shared: ' + k)
  }
})

test('*** the Companion account holds no credential and no bank session ***', () => {
  // The bank red line is STRUCTURAL: there is no session to ride, not a URL list that a
  // bug could get past.
  assert.equal(COMPANION_ACCOUNT.mayHoldSavedCredentials, false)
  assert.equal(COMPANION_ACCOUNT.mayHoldBankOrPayrollSession, false)
  assert.equal(COMPANION_ACCOUNT.browserProfile, 'new', 'a brand-new profile, never the Owner\'s')
  assert.equal(COMPANION_ACCOUNT.mustBeSeparateFromOwner, true)
  assert.equal(COMPANION_ACCOUNT.mustBeAdmin, false)
})

/* ── the IPC contract ─────────────────────────────────────────────────────── */

test('*** the message vocabulary is CLOSED, like the action enum ***', () => {
  // `canary_execute` / `canary_outcome` joined on 2026-08-01. They extend THIS vocabulary rather
  // than opening a second channel — a bypass channel is a second set of rules that eventually
  // disagrees with the first, and the disagreement is where things get through. The list stays
  // exact, so a third addition is a decision somebody has to write down.
  assert.deepEqual([...SERVICE_TO_COMPANION], ['execute_step', 'abort', 'ping', 'canary_execute'])
  assert.deepEqual([...COMPANION_TO_SERVICE], ['step_result', 'heartbeat', 'aborted', 'pong', 'canary_outcome'])
  for (const bad of ['execute_plan', 'run', 'EXECUTE_STEP', 'execute_step ', '', null, {}, ['ping']]) {
    assert.equal(validateEnvelope(envelope({ type: bad })).ok, false, 'refused type: ' + String(bad))
  }
  assert.equal(MESSAGE_TYPES.length, SERVICE_TO_COMPANION.length + COMPANION_TO_SERVICE.length)
})

test('a role cannot send a message that belongs to the other direction', () => {
  assert.equal(validateEnvelope(envelope({ from: ROLE_COMPANION, to: ROLE_SERVICE, type: 'execute_step' })).ok, false,
    'the Companion cannot tell itself to execute')
  assert.equal(validateEnvelope(envelope({ from: ROLE_SERVICE, to: ROLE_COMPANION, type: 'step_result' })).ok, false)
  assert.equal(validateEnvelope(envelope({ from: ROLE_SERVICE, to: ROLE_SERVICE })).ok, false, 'no self-messaging')
  assert.equal(validateEnvelope(envelope({ from: 'admin' })).ok, false, 'no third role exists')
})

test('*** ONE step in flight — the Companion never holds the plan ***', () => {
  // It cannot run ahead, and nothing it sees on screen can influence a next step,
  // because it does not possess one.
  assert.equal(MAX_STEPS_IN_FLIGHT, 1)
  assert.equal(CAPABILITIES[ROLE_COMPANION].holdsSealedOrder, false)
})

test('every message is bound to one order and one step, so nothing can be replayed', () => {
  assert.equal(validateEnvelope(envelope()).ok, true)
  assert.equal(validateEnvelope(envelope({ approvalId: '../../etc' })).ok, false)
  assert.equal(validateEnvelope(envelope({ approvalId: '' })).ok, false)
  assert.equal(validateEnvelope(envelope({ stepIndex: -1 })).ok, false)
  assert.equal(validateEnvelope(envelope({ stepIndex: 1.5 })).ok, false)
  assert.equal(validateEnvelope(envelope({ stepNonce: 'short' })).ok, false, 'a weak nonce is refused')
  assert.equal(validateEnvelope(envelope({ stepNonce: undefined })).ok, false)
})

test('the envelope validator is fail-closed on anything malformed', () => {
  for (const junk of [null, undefined, 'msg', 42, [], true]) {
    assert.equal(validateEnvelope(junk).ok, false, 'refused: ' + String(junk))
  }
})

/* ── stopping ─────────────────────────────────────────────────────────────── */

test('*** the screen locking is a STOP condition — nothing runs when he is not there ***', () => {
  for (const c of ['owner_kill_switch', 'screen_lock', 'session_switch', 'order_timeout',
    'step_nonce_reuse', 'evidence_missing', 'companion_lost']) {
    assert.ok(STOP_CONDITIONS.includes(c), 'stop condition defined: ' + c)
  }
  // a replay is a stop, not a retry; an unverifiable step is a failure, not a shrug
  assert.ok(STOP_CONDITIONS.includes('step_nonce_reuse'))
  assert.ok(STOP_CONDITIONS.includes('evidence_missing'))
})

test('the roles are exactly two, and both are named', () => {
  assert.deepEqual([...ROLES], ['service', 'companion'])
})
