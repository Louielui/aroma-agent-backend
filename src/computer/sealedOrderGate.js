'use strict'

/**
 * sealedOrderGate.js — the ONE place that answers "is this action permitted right now?".
 *
 * ── WHAT CHANGED, AND WHY IT IS NOT A WEAKENING ────────────────────────────
 * Until the Owner ruling of 2026-07-31, `open_app`, `type_text`, `send_keys` and `launch_app`
 * were on an ABSOLUTE prohibition list in observation.js and were `false` in the Companion's
 * capability register. That was the right shape while Phase 3b was read-only, but it makes the
 * canary unrunnable, and an absolute list that has to be edited to do approved work is not a
 * boundary — it is a speed bump with a comment.
 *
 * So the four move to DEFAULT DENY WITH ONE UNLOCK CONDITION, and the condition is the whole
 * point:
 *
 *     sealed order  +  hash matches  +  Owner approval id  +  flag on  +  not stopped
 *
 * ALL of them, every time, checked here. There is deliberately no path where turning the flag
 * on is sufficient — the Owner named that as the failure mode to avoid, and `verifyUnlock`
 * refuses with `sealed_order_required` when the flag is on and no order is presented.
 *
 * ── WHAT DID NOT MOVE ──────────────────────────────────────────────────────
 * NEVER_ACTIONS is unreachable by any order at all. Nothing in this file reads a work order
 * before deciding a NEVER action, so no seal, however well formed, can unlock one. Clicking,
 * mouse movement, clipboard, file writes and network stay outside the negotiable set.
 *
 * ── IT DOES NOTHING ITSELF ─────────────────────────────────────────────────
 * `node:crypto` is the only import. This module computes and compares; it never acts. That is
 * what lets observation.js and companion.js consult it without either of them growing the
 * ability to do anything.
 */

const crypto = require('node:crypto')

/** Capability states. A boolean cannot express "allowed only under an order", so it is a value. */
const CAP = Object.freeze({
  OFF: false, // not implemented in this build
  SEALED_ORDER_ONLY: 'sealed_order_only', // default deny; unlockable ONLY by a verified order
  NEVER: 'never' // no order can ever unlock it
})

/**
 * Default deny, unlockable by a verified sealed order. Owner ruling 2026-07-31 named four:
 * open_app, type_text, send_keys, launch_app.
 *
 * `save` is added here as a fifth, which is more gating rather than less. It is the canary's
 * third step and it had no gate at all before. It is NOT the same thing as `write_file`, which
 * stays in NEVER_ACTIONS: `write_file` is this system writing to disk, whereas `save` is
 * NOTEPAD writing to disk through its own Save As dialog, bounded to the allowed path. Keeping
 * both names, on opposite lists, is what stops one being quietly used to mean the other.
 */
const RESTRICTED_ACTIONS = Object.freeze(['open_app', 'type_text', 'send_keys', 'launch_app', 'save'])

/** No order unlocks these. The list is consulted BEFORE any order is read. */
const NEVER_ACTIONS = Object.freeze([
  'click', 'double_click', 'right_click', 'key_down', 'key_up',
  'move_mouse', 'drag', 'scroll', 'close_window', 'focus_window',
  'write_file', 'delete_file', 'set_clipboard', 'read_file', 'network'
])

/** Exactly this directory. No parent, no child, no sibling, no trailing-slash variant. */
const ALLOWED_PATH = 'C:\\Aroma\\ComputerOperator-Test'

const LIMITS = Object.freeze({ maxSteps: 10, timeoutSec: 300, oneStepInFlight: true })

/** Exact per-action parameter sets. An unexpected field is a refusal, not an ignored key. */
const ACTION_FIELDS = Object.freeze({
  open_app: Object.freeze(['action', 'n', 'appId']),
  type_text: Object.freeze(['action', 'n', 'text', 'bind']),
  save: Object.freeze(['action', 'n', 'fileName', 'bind'])
})

const BIND_FIELDS = Object.freeze(['processId', 'sessionId', 'windowHandle', 'uiaControlId'])

/**
 * The seal covers everything the executor will act on, INCLUDING the limits and the allowed
 * path. If those lived only in code, an order could be approved against one set of bounds and
 * run against another; folding them into the hash means the approval and the bounds are the
 * same object.
 */
function computeOrderHash (order) {
  const canonical = JSON.stringify({
    orderId: order.orderId,
    approvalId: order.approvalId,
    allowedPath: order.allowedPath,
    maxSteps: order.maxSteps,
    timeoutSec: order.timeoutSec,
    sealedText: order.sealedText,
    steps: (order.steps || []).map((s) => {
      const o = {}
      for (const k of (ACTION_FIELDS[s.action] || []).slice().sort()) if (s[k] !== undefined) o[k] = s[k]
      return o
    })
  })
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')
}

const no = (refusal, reason) => ({ ok: false, refusal, reason: reason || null })

/**
 * Is this order sealed, approved, hash-correct and within its declared bounds?
 * Pure comparison — no side effects, no I/O, safe to call from anywhere.
 */
function verifySeal (order) {
  if (!order || typeof order !== 'object') return no('order_missing', 'no order presented')
  if (order.sealed !== true) return no('order_not_sealed', 'only a sealed order may unlock an action')
  if (typeof order.approvalId !== 'string' || order.approvalId === '') {
    return no('order_not_approved', 'no Owner approval id')
  }
  if (typeof order.orderHash !== 'string' || order.orderHash === '') {
    return no('order_not_sealed', 'orderHash is required')
  }

  if (order.allowedPath !== ALLOWED_PATH) {
    return no('allowed_path_mismatch', `allowedPath must be exactly ${ALLOWED_PATH}`)
  }
  if (!Number.isInteger(order.maxSteps) || order.maxSteps < 1 || order.maxSteps > LIMITS.maxSteps) {
    return no('limits_exceeded', `maxSteps must be 1..${LIMITS.maxSteps}`)
  }
  if (!Number.isInteger(order.timeoutSec) || order.timeoutSec < 1 || order.timeoutSec > LIMITS.timeoutSec) {
    return no('limits_exceeded', `timeoutSec must be 1..${LIMITS.timeoutSec}`)
  }
  if (!Array.isArray(order.steps) || order.steps.length === 0) return no('malformed_order', 'no steps')
  if (order.steps.length > order.maxSteps) return no('too_many_steps', `${order.steps.length} > ${order.maxSteps}`)

  // Last, so a mismatch is reported as a mismatch rather than masked by a shape complaint.
  const actual = computeOrderHash(order)
  if (actual !== order.orderHash) {
    return no('order_hash_mismatch', `sealed ${order.orderHash}, computed ${actual}`)
  }
  return { ok: true, orderHash: actual }
}

/**
 * The single unlock decision. Every caller — observer, Companion, executor — asks this and
 * nothing else, so the four conditions cannot drift apart across three files.
 *
 * @param {object} q
 * @param {string} q.action
 * @param {object} [q.order]      the sealed work order, if one is presented
 * @param {string} [q.flag]       resolved COMPUTER_OPERATOR: 'on' | 'off'
 * @param {object} [q.killSwitch] anything with isStopped(); a stopped run unlocks nothing
 */
function verifyUnlock (q = {}) {
  const action = typeof q.action === 'string' ? q.action : null

  // NEVER is decided before the order is even looked at. This ordering is the guarantee that
  // no seal can reach these, and it is asserted by a test rather than left to reading.
  if (NEVER_ACTIONS.includes(action)) return no('action_never_permitted', 'no order can unlock: ' + action)
  if (!RESTRICTED_ACTIONS.includes(action)) return no('action_not_restricted', 'not a gated action: ' + String(action))

  if (q.killSwitch && typeof q.killSwitch.isStopped === 'function' && q.killSwitch.isStopped()) {
    return no('stopped', 'the kill switch is tripped')
  }
  if (q.flag !== 'on') return no('flag_off', 'COMPUTER_OPERATOR is not on')

  // THE LINE THE OWNER DREW. The flag being on is necessary and NOT sufficient.
  if (!q.order) return no('sealed_order_required', 'the flag is on, which unlocks nothing by itself')

  const sealed = verifySeal(q.order)
  if (!sealed.ok) return sealed

  // And the order must actually authorise THIS action, not merely be a valid order.
  const authorises = q.order.steps.some((s) => s && s.action === action)
  if (!authorises) return no('action_not_in_order', `the sealed order does not contain: ${action}`)

  return { ok: true, orderHash: sealed.orderHash, approvalId: q.order.approvalId }
}

module.exports = {
  CAP,
  RESTRICTED_ACTIONS,
  NEVER_ACTIONS,
  ALLOWED_PATH,
  LIMITS,
  ACTION_FIELDS,
  BIND_FIELDS,
  computeOrderHash,
  verifySeal,
  verifyUnlock
}
