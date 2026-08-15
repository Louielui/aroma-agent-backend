'use strict'

/**
 * companion.js — Computer Operator v0, Phase 3a. THE COMPANION, WITH ZERO CAPABILITY.
 *
 * ── WHAT THIS PROCESS CAN DO: NOTHING ─────────────────────────────────────────
 * It holds one end of the IPC contract and answers. That is the whole of it. It cannot
 * observe (no window list, no accessibility tree, no screenshot) and it cannot act (no
 * mouse, no keyboard, no app launch, no file write). Those are not disabled by a setting
 * that could be flipped — the code to do them does not exist in this process, and
 * phase3aInert.test.js fails if it ever appears.
 *
 * Capability arrives one narrow slice at a time, each behind its own Owner GO. Phase 3b
 * adds observation ONLY. Action is not in Phase 3 at all.
 *
 * ── WHY A PROCESS THAT DOES NOTHING IS WORTH BUILDING ─────────────────────────
 * Every part of the containment can be exercised while the blast radius is exactly zero:
 * the channel, the handshake, the refusal path, the audit, and — the reason this phase
 * exists — the kill switch, which until now was a latch that stopped nothing. A stop that
 * has never been demonstrated against a real process is a belief, not a control.
 *
 * ── IT REFUSES EVERYTHING, AND SAYS WHY ───────────────────────────────────────
 * Every request is answered with a refusal naming the capability that is absent. It never
 * fails silently and never partially complies: there is no "best effort" path, because a
 * partial action on a real desktop cannot be undone by an apology.
 */

const { validateEnvelope, ROLE_SERVICE, ROLE_COMPANION } = require('./sessionBoundary')
const gate = require('./sealedOrderGate')
const { CAP } = gate
const { resolveComputerOperator } = require('./computerOperatorFlag')
// Phase 3b. Observation lives behind its own module so the Companion's cannot-ACT proof
// stays exactly as strong as it was in 3a - see observation.js and GOV-001.
const { createObserver, OBSERVATION_ACTIONS } = require('./observation')

/**
 * THE CAPABILITY REGISTER. Every capability the Companion will ever have, and whether it
 * exists in THIS build. Phase 3a: all false. This is data so the tests, the report and
 * the running process cannot drift apart — the process answers from the same object the
 * tests assert against.
 */
/**
 * THE CAPABILITY REGISTER, IN THREE STATES RATHER THAN TWO.
 *
 * A boolean could only say "off" or "on", and the Owner's ruling of 2026-07-31 needs a third
 * thing: allowed, but ONLY under a sealed, hash-matching, Owner-approved work order. Writing
 * that as `false` would have been a lie by omission, and writing it as `true` would have been a
 * far worse one, so it is its own value.
 *
 *   false                — not implemented in this build
 *   'sealed_order_only'  — DEFAULT DENY. Unlocked only by sealedOrderGate.verifyUnlock.
 *   'never'              — no order unlocks it, ever
 *
 * NOTHING here is `true`, and `anyCapabilityEnabled()` still answers false, because nothing is
 * unconditionally enabled. That is the claim worth keeping, and it survived the change.
 */
const CAPABILITIES = Object.freeze({
  // Phase 3b — observation only, each behind its own GO
  list_windows: false,
  read_ui_tree: false,
  capture_own_screen: false,

  // Default deny; the ONLY unlock is a verified sealed order. Owner ruling 2026-07-31.
  open_app: CAP.SEALED_ORDER_ONLY,
  type_text: CAP.SEALED_ORDER_ONLY,
  send_keys: CAP.SEALED_ORDER_ONLY,
  launch_app: CAP.SEALED_ORDER_ONLY,
  save: CAP.SEALED_ORDER_ONLY,

  // No order reaches these. `write_file` staying NEVER while `save` is gated is deliberate:
  // one is this system writing to disk, the other is an application's own Save As.
  move_mouse: CAP.NEVER,
  write_file: CAP.NEVER,
  read_file: CAP.NEVER,
  network: CAP.NEVER
})

const NO_CAPABILITY = 'no_capability_enabled'

/**
 * Create a Companion. Pure logic + an injected channel; it opens nothing by itself, so a
 * test can drive it end to end without a pipe and the production entrypoint supplies the
 * real transport.
 *
 * @param {{ channel?: object, onAudit?: Function, now?: Function }} deps
 */
function createCompanion (deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const onAudit = typeof deps.onAudit === 'function' ? deps.onAudit : () => {}
  const observer = (deps.observer && typeof deps.observer.observe === 'function') ? deps.observer : createObserver({ now })
  // Injected, never constructed. Absent by default, so the default Companion is exactly as
  // incapable as it was in 3a — the difference is that an injected one is now possible.
  const executor = (deps.executor && typeof deps.executor.execute === 'function') ? deps.executor : null
  let aborted = false
  let stopReason = null

  /** Answer one request. Always a value, never a throw — a caller must not proceed by catching. */
  function handle (envelope) {
    const v = validateEnvelope(envelope)
    if (!v.ok) {
      return reply(envelope, { ok: false, refusal: 'bad_envelope', detail: v.errors[0] || null })
    }
    if (envelope.to !== ROLE_COMPANION || envelope.from !== ROLE_SERVICE) {
      return reply(envelope, { ok: false, refusal: 'not_addressed_to_companion' })
    }

    // ABORT is honoured even after an abort — stopping twice is not an error.
    if (envelope.type === 'abort') {
      aborted = true
      stopReason = 'service_abort'
      return { from: ROLE_COMPANION, to: ROLE_SERVICE, type: 'aborted', approvalId: envelope.approvalId, stepIndex: envelope.stepIndex, stepNonce: envelope.stepNonce, at: now() }
    }
    if (aborted) {
      return reply(envelope, { ok: false, refusal: 'aborted', detail: stopReason })
    }
    if (envelope.type === 'ping') {
      return { from: ROLE_COMPANION, to: ROLE_SERVICE, type: 'pong', approvalId: envelope.approvalId, stepIndex: envelope.stepIndex, stepNonce: envelope.stepNonce, capabilities: CAPABILITIES, at: now() }
    }
    if (envelope.type === 'execute_step') {
      // THE ONLY ANSWER THIS BUILD CAN GIVE. Not "not implemented" — refused, named, and
      // audited, so a Service that somehow sent a real step gets an unambiguous no.
      const wanted = (envelope.step && typeof envelope.step.action === 'string') ? envelope.step.action : null

      // Observation is DELEGATED, never performed here. In stage 1 the observer refuses
      // everything, so this changes the source of the refusal and nothing else — but it
      // means the Companion never grows observation code of its own, which is what keeps
      // its own source scan meaningful.
      if (wanted && OBSERVATION_ACTIONS.includes(wanted)) {
        const seen = observer.observe({ action: wanted })
        onAudit({ approvalId: envelope.approvalId, stepIndex: envelope.stepIndex, action: wanted, outcome: seen.ok ? 'observed' : 'refused', refusalReason: seen.ok ? null : seen.refusal, at: now() })
        return reply(envelope, seen)
      }

      // ── THE GATED SET ───────────────────────────────────────────────────────
      // Default deny. The gate is asked BEFORE the executor is so much as named, so a refused
      // action cannot reach an execution path even if one is wired in. Note what is NOT here:
      // there is no branch that checks the flag and proceeds. The flag is one of five
      // conditions the gate requires, and it is the only one an environment variable controls.
      if (wanted && gate.RESTRICTED_ACTIONS.includes(wanted)) {
        const unlocked = gate.verifyUnlock({
          action: wanted,
          order: envelope.order || null,
          // No argument, deliberately: the flag is read from the REAL process environment, so
          // a caller who assembles a Companion cannot hand it a fabricated `{ on }`. There is
          // no injection point here, and computerOperatorWiring.test.js asserts that.
          flag: resolveComputerOperator(),
          killSwitch: { isStopped: () => aborted }
        })
        if (!unlocked.ok) {
          onAudit({ approvalId: envelope.approvalId, stepIndex: envelope.stepIndex, action: wanted, outcome: 'refused', refusalReason: unlocked.refusal, at: now() })
          return reply(envelope, { ok: false, refusal: unlocked.refusal, reason: unlocked.reason, capability: wanted })
        }
        // Unlocked — and still incapable, unless an executor was injected. The Companion
        // never builds one; it cannot reach a desktop by itself and this keeps that true.
        if (!executor) {
          onAudit({ approvalId: envelope.approvalId, stepIndex: envelope.stepIndex, action: wanted, outcome: 'refused', refusalReason: 'no_executor', at: now() })
          return reply(envelope, { ok: false, refusal: 'no_executor', capability: wanted })
        }
        const ran = executor.execute(envelope.order, { flagOn: true, killSwitch: { isStopped: () => aborted } })
        onAudit({ approvalId: envelope.approvalId, stepIndex: envelope.stepIndex, action: wanted, outcome: ran.ok ? 'executed' : 'refused', refusalReason: ran.ok ? null : ran.refusal, at: now() })
        return reply(envelope, ran)
      }

      onAudit({ approvalId: envelope.approvalId, stepIndex: envelope.stepIndex, action: wanted, outcome: 'refused', refusalReason: NO_CAPABILITY, at: now() })
      return reply(envelope, { ok: false, refusal: NO_CAPABILITY, capability: wanted })
    }
    return reply(envelope, { ok: false, refusal: 'unsupported_message_type' })
  }

  /**
   * ⛔ THE RESPONSE ECHOES THE NONCE IT WAS ASKED WITH — VERBATIM.
   *
   * Requests carried `stepNonce` and responses did not, so the Service could correlate a
   * reply only by (approvalId, stepIndex) — which is exactly the pair a replayed or
   * out-of-order response also carries. Nothing could tell 「the answer to THIS request」
   * from 「an answer to that step」, and single-use protection on the way out bought nothing
   * on the way back.
   *
   * ⛔ AND IT IS COPIED, NEVER MANUFACTURED. No generation, no transformation, no `|| null`
   * fallback: a Companion that can invent a correlation token is a Companion that can claim
   * to be answering a request nobody made. If the request carried no nonce, the reply carries
   * none and fails the Service's own envelope check — which is the correct outcome, not a
   * gap to paper over.
   */
  function reply (envelope, body) {
    return Object.assign({
      from: ROLE_COMPANION,
      to: ROLE_SERVICE,
      type: 'step_result',
      approvalId: (envelope && envelope.approvalId) || null,
      stepIndex: (envelope && envelope.stepIndex) !== undefined ? envelope.stepIndex : null,
      stepNonce: envelope && envelope.stepNonce,
      at: now()
    }, body)
  }

  return {
    handle,
    capabilities: CAPABILITIES,
    /** True once the Service has aborted it. */
    isAborted () { return aborted },
    /** The OS fallback and the local kill both come through here. */
    stop (reason) { aborted = true; stopReason = typeof reason === 'string' ? reason : 'stopped'; return { ok: true, stopReason } },
    stopReason () { return stopReason }
  }
}

/**
 * Is any capability UNCONDITIONALLY enabled in this build? Must be false.
 *
 * `some(Boolean)` would now answer true, because 'sealed_order_only' is a truthy string — and
 * answering true would be wrong, because none of those is enabled. The comparison is against
 * `true` explicitly, and a test asserts no register value is ever `true`.
 */
function anyCapabilityEnabled () {
  return Object.values(CAPABILITIES).some((v) => v === true)
}

/** The names that a verified sealed order — and nothing else — can unlock. */
function sealedOrderOnlyCapabilities () {
  return Object.entries(CAPABILITIES).filter(([, v]) => v === CAP.SEALED_ORDER_ONLY).map(([k]) => k)
}

module.exports = { createCompanion, CAPABILITIES, anyCapabilityEnabled, sealedOrderOnlyCapabilities, NO_CAPABILITY, CAP }
