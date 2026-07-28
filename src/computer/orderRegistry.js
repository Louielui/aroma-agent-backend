'use strict'

/**
 * orderRegistry.js — Computer Operator v0, Phase 2. One live order, single-use steps.
 *
 * Two rules, both structural:
 *
 *   ONE LIVE ORDER. A second admission is refused while one is live. Concurrency on a
 *   real desktop means two runs fighting over the same windows, the same clipboard and
 *   the same files, with an audit trail that cannot say which one did what. There is no
 *   queue on purpose: a refused order is visible, a queued one is a surprise later.
 *
 *   EVERY STEP IS SINGLE-USE. Each step gets a nonce bound to (approvalId, stepIndex).
 *   It is consumed on FIRST use, whatever the outcome — success, failure or refusal —
 *   so a replay, a double-submit and a retry-after-failure are all the same thing and
 *   all refused. This mirrors the Owner approval nonce, which burns on every outcome
 *   precisely so a refusal is not a free retry.
 *
 * Pure: no I/O, no timers. Expiry is evaluated against an injected clock.
 */

const crypto = require('node:crypto')

function createOrderRegistry (options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const newNonce = typeof options.newNonce === 'function'
    ? options.newNonce
    : () => crypto.randomBytes(24).toString('base64url')

  let live = null // { approvalId, workOrderHash, expiresAt, nonces: Map, closed }

  function expired () { return live !== null && live.expiresAt <= now() }

  function sweep () { if (expired()) live = null }

  return {
    /**
     * Admit an order as THE live one. Refused if another is live and unexpired.
     * @returns {{ok:true, stepNonces:string[]}|{ok:false, reason:string}}
     */
    admit ({ approvalId, workOrderHash, stepCount, timeoutSec } = {}) {
      sweep()
      if (live) return { ok: false, reason: 'another_order_is_live' }
      if (typeof approvalId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(approvalId)) {
        return { ok: false, reason: 'bad_approval_id' }
      }
      if (!Number.isInteger(stepCount) || stepCount <= 0) return { ok: false, reason: 'bad_step_count' }
      if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) return { ok: false, reason: 'bad_timeout' }

      const nonces = new Map()
      const stepNonces = []
      for (let i = 0; i < stepCount; i++) {
        const n = newNonce()
        // Bound to BOTH the order and the position, so a nonce from step 3 cannot be
        // presented for step 1, and a nonce from another order cannot be presented here.
        nonces.set(n, { approvalId, stepIndex: i, consumed: false })
        stepNonces.push(n)
      }
      live = { approvalId, workOrderHash: workOrderHash || null, expiresAt: now() + timeoutSec * 1000, nonces, closed: false }
      return { ok: true, stepNonces }
    },

    /** Is this order the live one, and still within its window? */
    isLive (approvalId) {
      sweep()
      return !!live && live.approvalId === approvalId && !live.closed
    },

    /**
     * Consume a step nonce. Burns on EVERY outcome — the caller gets one attempt at a
     * step, full stop.
     */
    consumeStep ({ approvalId, stepIndex, stepNonce } = {}) {
      sweep()
      if (!live) return { ok: false, reason: 'no_live_order' }
      if (live.closed) return { ok: false, reason: 'order_closed' }
      if (live.approvalId !== approvalId) return { ok: false, reason: 'wrong_order' }
      const rec = live.nonces.get(stepNonce)
      if (!rec) return { ok: false, reason: 'unknown_nonce' }
      if (rec.consumed) return { ok: false, reason: 'nonce_already_used' }
      if (rec.approvalId !== approvalId || rec.stepIndex !== stepIndex) {
        // Burn it anyway: a nonce presented for the wrong position has been handled by
        // something that should not have had it, and must not remain usable.
        rec.consumed = true
        return { ok: false, reason: 'nonce_not_bound_to_this_step' }
      }
      rec.consumed = true
      return { ok: true }
    },

    /** Close the live order. Idempotent; a closed order is never reopened. */
    close (approvalId) {
      sweep()
      if (!live || live.approvalId !== approvalId) return { ok: false, reason: 'not_live' }
      live.closed = true
      live = null
      return { ok: true }
    },

    /** Diagnostics only — never a control. */
    liveApprovalId () { sweep(); return live ? live.approvalId : null }
  }
}

module.exports = { createOrderRegistry }
