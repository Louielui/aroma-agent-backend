'use strict'

/**
 * killSwitch.test.js — Computer Operator v0, Phase 2.
 *
 * The first test says the quiet part out loud: THIS STOPS NOTHING TODAY. It is a latch
 * with settled semantics, tested before there is anything at stake. A "kill switch" that
 * reads like a working control and is not one is worse than none, so the gap is asserted
 * rather than described.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createKillSwitch, KILL_SWITCH_BINDINGS, STOP_CONDITIONS } = require('./killSwitch')

/* ── honesty about what does not exist ────────────────────────────────────── */

test('*** it stops NOTHING today, and says so as data ***', () => {
  assert.equal(KILL_SWITCH_BINDINGS.stopsAnythingRunningToday, false)
  assert.equal(KILL_SWITCH_BINDINGS.serviceGate.implemented, true, 'the latch itself exists')
  assert.equal(KILL_SWITCH_BINDINGS.companionAbortSignal.implemented, false, 'no Companion to signal')
  assert.equal(KILL_SWITCH_BINDINGS.osBackstop.implemented, false, 'no service or account to stop')
})

/* ── the latch ────────────────────────────────────────────────────────────── */

test('the guard passes while running and refuses once stopped', () => {
  const k = createKillSwitch({ now: () => 1000 })
  assert.equal(k.isStopped(), false)
  assert.deepEqual(k.guard(), { ok: true })
  k.stop('owner_kill_switch')
  assert.equal(k.isStopped(), true)
  assert.deepEqual(k.guard(), { ok: false, refusal: 'stopped', reason: 'owner_kill_switch' })
})

test('*** a stop is FIRST-WINS — the record says what actually stopped it ***', () => {
  const k = createKillSwitch({ now: () => 1000 })
  k.stop('screen_lock', 'workstation locked')
  const second = k.stop('order_timeout')
  assert.equal(second.alreadyStopped, true)
  assert.equal(k.reason().reason, 'screen_lock', 'not overwritten by a later cause')
  assert.equal(k.reason().detail, 'workstation locked')
})

test('*** the stop vocabulary is CLOSED — no free text can become a reason ***', () => {
  const k = createKillSwitch({ now: () => 1 })
  for (const bad of ['because', 'owner_kill_switch ', 'OWNER_KILL_SWITCH', '', null, undefined, 42, {}]) {
    const r = k.stop(bad)
    assert.equal(r.ok, false, 'refused: ' + String(bad))
    assert.equal(r.error, 'unknown_stop_condition')
  }
  assert.equal(k.isStopped(), false, 'a refused stop did not latch')
})

test('a stop is final — there is no resume', () => {
  const k = createKillSwitch({ now: () => 1 })
  k.stop('owner_kill_switch')
  for (const method of ['resume', 'reset', 'clear', 'restart', 'unstop']) {
    assert.equal(typeof k[method], 'undefined', 'must not expose: ' + method)
  }
})

test('the reason record is frozen, so nothing can rewrite why it stopped', () => {
  const k = createKillSwitch({ now: () => 1 })
  k.stop('evidence_missing')
  const rec = k.reason()
  assert.throws(() => { rec.reason = 'owner_kill_switch' }, TypeError)
  assert.equal(k.reason().reason, 'evidence_missing')
})

test('the conditions that must stop a run are all defined', () => {
  for (const c of ['owner_kill_switch', 'screen_lock', 'session_switch', 'order_timeout',
    'step_nonce_reuse', 'evidence_missing', 'companion_lost']) {
    assert.ok(STOP_CONDITIONS.includes(c), c)
    assert.equal(createKillSwitch({ now: () => 1 }).stop(c).ok, true, 'usable as a reason: ' + c)
  }
})

test('a long or non-string detail is dropped, not carried', () => {
  const k = createKillSwitch({ now: () => 1 })
  k.stop('owner_kill_switch', 'x'.repeat(500))
  assert.equal(k.reason().detail, null, 'detail is a short note, not a content channel')
})
