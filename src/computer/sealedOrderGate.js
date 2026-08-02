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
/**
 * ── RUNTIME BINDING IS NOT PART OF A SEALED ORDER. Owner ruling, 2026-08-01. ──
 *
 * `bind` used to be here, on type_text and save. It could not work, and the contradiction was
 * total:
 *
 *   . validateOrder REQUIRED every bind field to be non-null BEFORE execution;
 *   . processId, sessionId, windowHandle and uiaControlId do not exist until open_app has run;
 *   . `bind` was inside the hash, so filling it in would have invalidated the approval — measured:
 *     the same order with binds filled hashes differently;
 *   . and had it been pre-filled and re-approved, the executor compares each step's bind against
 *     the binding the REAL open_app produced, so invented values would refuse as stale_binding.
 *
 * Both routes were closed. The approved canary could never have executed, and it would have
 * failed at execute() with the operator flag already on.
 *
 * The seal protects WHAT THE OWNER APPROVED — which app, which text, which filename, which
 * folder, which limits. A window handle is not something an Owner approves; it is a fact that
 * comes into existence when the app opens. So it leaves the order entirely, and an incoming
 * order that carries one is refused as `unexpected_field` rather than quietly ignored: an order
 * shaped like the old one is an order written against the old rules, and it should be rejected
 * loudly by whoever still produces it.
 */
const ACTION_FIELDS = Object.freeze({
  open_app: Object.freeze(['action', 'n', 'appId']),
  type_text: Object.freeze(['action', 'n', 'text']),
  save: Object.freeze(['action', 'n', 'fileName'])
})

/**
 * THE RUNTIME BINDING — what identifies the thing we are about to act on.
 *
 * ── WHY uiaControlId IS GONE (measured 2026-08-02) ────────────────────────
 * It was `$edit.Current.AutomationId`, required non-empty. On this machine the packaged
 * Notepad's document is:
 *
 *     ControlType  ControlType.Document
 *     AutomationId <empty>
 *     Name         'Text editor'
 *     ClassName    'RichEditD2DPT'
 *
 * The AutomationId is empty because Windows did not give it one. Requiring it non-empty was
 * enforcing somebody else's invariant — and one that is simply false here, so the canary would
 * have refused every run, after opening Notepad, forever. We may only enforce invariants we
 * create.
 *
 * ── WHAT REPLACES IT, AND WHY IT IS NOT "ANY DOCUMENT" ────────────────────
 * Identity now comes from two things we DO establish:
 *
 *   1. UNIQUENESS INSIDE A WINDOW WE ALREADY IDENTIFIED. The window is pinned by pid +
 *      native handle. Inside it there must be EXACTLY ONE Document (or, failing that, exactly
 *      one Edit). Two would be `uia_control_ambiguous` and a refusal — never a choice. So
 *      "the editable control of THAT window" is a description with exactly one referent, and
 *      the uniqueness is a rule we impose rather than a property we hope for.
 *
 *   2. UIA's OWN RuntimeId, recorded at open_app and compared on every later step. It is the
 *      identity UIA itself uses for "is this the same element", it is not localised, and it is
 *      not something we invented — but unlike AutomationId it is always produced.
 *
 * ClassName and ControlType travel too. They are not identity on their own; they make a
 * mismatch DIAGNOSABLE — "the RuntimeId changed and it is still a RichEditD2DPT Document" is a
 * different problem from "the control is now something else".
 *
 * `uiaAutomationId` is still carried and is ALLOWED TO BE EMPTY. Recording what Windows says,
 * without depending on it, is how the next machine's difference becomes visible instead of fatal.
 */
const BIND_FIELDS = Object.freeze([
  'processId', 'sessionId', 'windowHandle',
  'uiaRuntimeId', 'uiaControlType', 'uiaClassName',
  'uiaAutomationId'
])

/** The subset that must be present AND non-empty. uiaAutomationId is deliberately not here. */
const BIND_REQUIRED = Object.freeze([
  'processId', 'sessionId', 'windowHandle',
  'uiaRuntimeId', 'uiaControlType', 'uiaClassName'
])

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

  // ── allowedPath EXISTS TO BOUND A SAVE, SO IT TRACKS THE SAVE ────────────
  // Owner decision 2026-08-02: the canary shrinks to open_app + type_text. With no save there
  // is no file, no directory and nothing for allowedPath to bound — carrying it would be a
  // field that describes a capability the order does not contain.
  //
  // BOTH directions are enforced, and the second is the one that matters. An order with a save
  // MUST carry exactly the allowed path; an order WITHOUT a save must not carry one at all. A
  // merely-optional field would let a two-step order keep a stale path and look like it had
  // been scoped when it had not — and would leave a save-shaped order one edit away.
  const declaresSave = Array.isArray(order.steps) && order.steps.some((s) => s && s.action === 'save')
  if (declaresSave) {
    if (order.allowedPath !== ALLOWED_PATH) {
      return no('allowed_path_mismatch', `allowedPath must be exactly ${ALLOWED_PATH}`)
    }
  } else if (order.allowedPath !== undefined) {
    return no('unexpected_field', 'allowedPath is present but no step saves — remove it or add the save it bounds')
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
  BIND_REQUIRED,
  computeOrderHash,
  verifySeal,
  verifyUnlock
}
