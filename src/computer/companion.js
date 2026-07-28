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

/**
 * THE CAPABILITY REGISTER. Every capability the Companion will ever have, and whether it
 * exists in THIS build. Phase 3a: all false. This is data so the tests, the report and
 * the running process cannot drift apart — the process answers from the same object the
 * tests assert against.
 */
const CAPABILITIES = Object.freeze({
  // Phase 3b — observation only, each behind its own GO
  list_windows: false,
  read_ui_tree: false,
  capture_own_screen: false,
  // Never in Phase 3
  move_mouse: false,
  send_keys: false,
  launch_app: false,
  write_file: false,
  read_file: false,
  network: false
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
      return { from: ROLE_COMPANION, to: ROLE_SERVICE, type: 'aborted', approvalId: envelope.approvalId, stepIndex: envelope.stepIndex, at: now() }
    }
    if (aborted) {
      return reply(envelope, { ok: false, refusal: 'aborted', detail: stopReason })
    }
    if (envelope.type === 'ping') {
      return { from: ROLE_COMPANION, to: ROLE_SERVICE, type: 'pong', approvalId: envelope.approvalId, stepIndex: envelope.stepIndex, capabilities: CAPABILITIES, at: now() }
    }
    if (envelope.type === 'execute_step') {
      // THE ONLY ANSWER THIS BUILD CAN GIVE. Not "not implemented" — refused, named, and
      // audited, so a Service that somehow sent a real step gets an unambiguous no.
      const wanted = (envelope.step && typeof envelope.step.action === 'string') ? envelope.step.action : null
      onAudit({ approvalId: envelope.approvalId, stepIndex: envelope.stepIndex, action: wanted, outcome: 'refused', refusalReason: NO_CAPABILITY, at: now() })
      return reply(envelope, { ok: false, refusal: NO_CAPABILITY, capability: wanted })
    }
    return reply(envelope, { ok: false, refusal: 'unsupported_message_type' })
  }

  function reply (envelope, body) {
    return Object.assign({
      from: ROLE_COMPANION,
      to: ROLE_SERVICE,
      type: 'step_result',
      approvalId: (envelope && envelope.approvalId) || null,
      stepIndex: (envelope && envelope.stepIndex) !== undefined ? envelope.stepIndex : null,
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

/** Is any capability enabled in this build? Phase 3a: must be false. */
function anyCapabilityEnabled () {
  return Object.values(CAPABILITIES).some(Boolean)
}

module.exports = { createCompanion, CAPABILITIES, anyCapabilityEnabled, NO_CAPABILITY }
