'use strict'

/**
 * recovery.test.js — B2-11b pure six-state derivation. No I/O, no dispatch.
 *   Run: node --test src/run/recovery.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { deriveRecoveredStatus } = require('./recovery')

const runWith = (stages) => ({ timeline: stages.map(s => ({ stage: s, at: 't', facts: {} })) })
const SEED = ['TASK_CREATED']
const CLAIMED = ['TASK_CREATED', 'DISPATCH_CLAIMED']
const WORKER_CLAIMED = ['TASK_CREATED', 'WORKER_CLAIMED']

test('(a) confirmed, NO DISPATCH_CLAIMED → PENDING', () => {
  assert.deepEqual(deriveRecoveredStatus({ run: runWith(SEED) }), { status: 'pending', mark: 'RECONCILED_PENDING' })
})

test('(b) DISPATCH_CLAIMED present, NO execution → INTERRUPTED (fail-closed)', () => {
  assert.deepEqual(deriveRecoveredStatus({ run: runWith(CLAIMED) }), { status: 'interrupted', mark: 'RECONCILED_INTERRUPTED' })
})

test('(b) WORKER_CLAIMED present, NO execution → INTERRUPTED (B2-14 worker track, mirrors DISPATCH_CLAIMED)', () => {
  assert.deepEqual(deriveRecoveredStatus({ run: runWith(WORKER_CLAIMED) }), { status: 'interrupted', mark: 'RECONCILED_INTERRUPTED' })
})

test('(c) execution present, NO result → INTERRUPTED', () => {
  assert.deepEqual(
    deriveRecoveredStatus({ run: runWith(CLAIMED), execution: { id: 'task_e' } }),
    { status: 'interrupted', mark: 'RECONCILED_INTERRUPTED' }
  )
})

test('(d) result present + ok → SUCCEEDED (from disk)', () => {
  assert.deepEqual(
    deriveRecoveredStatus({ run: runWith(CLAIMED), execution: { id: 'task_e' }, result: { ok: true } }),
    { status: 'succeeded', mark: 'RECONCILED_SUCCEEDED' }
  )
})

test('(e) result present + not ok → FAILED (from disk)', () => {
  assert.deepEqual(
    deriveRecoveredStatus({ run: runWith(CLAIMED), execution: { id: 'task_e' }, result: { ok: false } }),
    { status: 'failed', mark: 'RECONCILED_FAILED' }
  )
})

test('(f) result present but timeline not updated → SUCCEEDED/FAILED from the artifact', () => {
  // timeline is only at DISPATCH_CLAIMED (crash after result write, before timeline flush)
  assert.equal(deriveRecoveredStatus({ run: runWith(CLAIMED), execution: { id: 'e' }, result: { ok: true } }).status, 'succeeded')
  assert.equal(deriveRecoveredStatus({ run: runWith(CLAIMED), execution: { id: 'e' }, result: { ok: false } }).status, 'failed')
})

test('corrupt/absent result (safe-load passed null) → INTERRUPTED, never guessed success', () => {
  // a half-written result artifact is skipped by safe-load → reaches here as null
  assert.equal(deriveRecoveredStatus({ run: runWith(CLAIMED), execution: { id: 'e' }, result: null }).status, 'interrupted')
})
