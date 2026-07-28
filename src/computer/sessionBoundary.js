'use strict'

/**
 * sessionBoundary.js — Computer Operator v0, PHASE 1. DEFINITION ONLY.
 *
 * ── NOTHING HERE STARTS, CONNECTS TO, OR TALKS TO ANYTHING ────────────────────
 * This file declares the two roles, what each one is permitted to be, and the SHAPE of
 * the messages that would pass between them. It opens no pipe, spawns no process,
 * installs nothing and names no real account that exists. It is a contract on paper,
 * expressed as constants and a validator so the contract is testable before anything is
 * ever built against it.
 *
 * ── WHY TWO PROCESSES ─────────────────────────────────────────────────────────
 * Windows Session 0 isolation means a background service literally cannot see or touch
 * an interactive desktop. So governance and capability have to be split — which is
 * useful rather than merely necessary:
 *
 *   SERVICE   holds the sealed order, the audit, the clock and the kill switch.
 *             It decides. It has no desktop and cannot act.
 *   COMPANION runs in the interactive session of a SEPARATE, NON-ADMIN Windows account
 *             with a brand-new browser profile. It acts. It decides nothing: it
 *             receives one already-authorized action at a time and reports what
 *             happened.
 *
 * Neither half is sufficient alone. The Companion cannot authorize itself; the Service
 * cannot reach the desktop. That is the containment, and the OS enforces it — not our
 * code.
 *
 * ── THE BANK RED LINE IS STRUCTURAL, NOT A BLOCKLIST ──────────────────────────
 * The Companion account has never logged into a bank, a payroll system or a payment
 * method, and holds no saved credential. "It cannot reach TD" is therefore a property
 * of there being no session to ride — not a URL list that some future bug could get
 * past. A blocklist may be added later as depth, but it is never the primary control.
 */

// ── ROLES ─────────────────────────────────────────────────────────────────────
const ROLE_SERVICE = 'service'
const ROLE_COMPANION = 'companion'
const ROLES = Object.freeze([ROLE_SERVICE, ROLE_COMPANION])

/**
 * The Companion account, as DECIDED but NOT CREATED. Phase 1 must not create a Windows
 * account, so this is a name to design against and to assert against — nothing checks
 * whether it exists, and nothing here would create it.
 */
const COMPANION_ACCOUNT = Object.freeze({
  name: 'AromaOperator', // provisional (Owner decision 2)
  mustBeAdmin: false,
  mustBeSeparateFromOwner: true,
  browserProfile: 'new', // brand-new profile; never the Owner's
  mayHoldSavedCredentials: false,
  mayHoldBankOrPayrollSession: false,
  created: false // Phase 1 creates nothing. Stated as data so a test can hold us to it.
})

// ── CAPABILITY SPLIT ──────────────────────────────────────────────────────────
// What each role is allowed to BE. Phase 1 asserts these are disjoint where it matters:
// the half that decides cannot act, and the half that acts cannot decide.
const CAPABILITIES = Object.freeze({
  [ROLE_SERVICE]: Object.freeze({
    holdsSealedOrder: true,
    writesAudit: true,
    ownsKillSwitch: true,
    ownsClock: true,
    touchesDesktop: false,
    movesInput: false,
    capturesScreen: false
  }),
  [ROLE_COMPANION]: Object.freeze({
    holdsSealedOrder: false,
    writesAudit: false,
    ownsKillSwitch: false,
    ownsClock: false,
    touchesDesktop: true,
    movesInput: true,
    capturesScreen: true
  })
})

// ── THE IPC CONTRACT (shape only) ─────────────────────────────────────────────
// A closed message vocabulary, in both directions. Same reasoning as the action enum:
// if message types are a closed set, no text from a screen or a model can become one.
const SERVICE_TO_COMPANION = Object.freeze(['execute_step', 'abort', 'ping'])
const COMPANION_TO_SERVICE = Object.freeze(['step_result', 'heartbeat', 'aborted', 'pong'])
const MESSAGE_TYPES = Object.freeze([...SERVICE_TO_COMPANION, ...COMPANION_TO_SERVICE])

/**
 * THE ONE-STEP RULE. The Service never sends a plan; it sends ONE already-authorized
 * step and waits for the result. The Companion therefore never holds the shape of the
 * work, cannot run ahead, and cannot be talked into a next step by anything it sees on
 * screen — there is no next step in its possession to influence.
 */
const MAX_STEPS_IN_FLIGHT = 1

/**
 * Validate an IPC envelope's SHAPE. Pure; sends nothing.
 * Fail-closed: unknown type, wrong direction, missing correlation → invalid.
 */
function validateEnvelope (env) {
  const errors = []
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return { ok: false, errors: ['envelope must be an object'] }
  }
  if (!ROLES.includes(env.from)) errors.push('from must be a known role')
  if (!ROLES.includes(env.to)) errors.push('to must be a known role')
  if (env.from && env.to && env.from === env.to) errors.push('a role cannot message itself')
  if (typeof env.type !== 'string' || !MESSAGE_TYPES.includes(env.type)) {
    errors.push('type is not one of the approved message types')
  } else if (env.from === ROLE_SERVICE && !SERVICE_TO_COMPANION.includes(env.type)) {
    errors.push('service may not send that message type')
  } else if (env.from === ROLE_COMPANION && !COMPANION_TO_SERVICE.includes(env.type)) {
    errors.push('companion may not send that message type')
  }
  // Every message belongs to exactly one approved order and one step, so nothing can be
  // replayed into a different order or a different position in the same one.
  if (typeof env.approvalId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(env.approvalId)) {
    errors.push('approvalId must be a safe id token')
  }
  if (!Number.isInteger(env.stepIndex) || env.stepIndex < 0) errors.push('stepIndex must be a non-negative integer')
  if (typeof env.stepNonce !== 'string' || env.stepNonce.length < 16) {
    errors.push('stepNonce must be a single-use token of at least 16 characters')
  }
  return { ok: errors.length === 0, errors }
}

/** The conditions that STOP everything. Definition only — nothing here observes them. */
const STOP_CONDITIONS = Object.freeze([
  'owner_kill_switch', // explicit stop
  'screen_lock', // the Owner is not present ⇒ nothing runs in his session
  'session_switch',
  'order_timeout',
  'step_nonce_reuse', // a replay is a stop, not a retry
  'evidence_missing', // an unverifiable step is a failed step
  'companion_lost'
])

module.exports = {
  ROLE_SERVICE,
  ROLE_COMPANION,
  ROLES,
  COMPANION_ACCOUNT,
  CAPABILITIES,
  SERVICE_TO_COMPANION,
  COMPANION_TO_SERVICE,
  MESSAGE_TYPES,
  MAX_STEPS_IN_FLIGHT,
  STOP_CONDITIONS,
  validateEnvelope
}
