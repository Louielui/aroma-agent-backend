'use strict'

/**
 * E0-W1 SERVICE COORDINATOR.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE HOLE WAS IN THE SIGNATURE, NOT IN THE CHECKS.
 *
 * `observationBinding.prepare()` takes `expectedSession` as a PARAMETER. Every check inside it
 * is sound, but a parameter is something a caller supplies — so the honest reading of that
 * guarantee was 「the result must match whatever the caller said to expect」. Hand it a session
 * lifted out of the JSON that AromaOperator wrote about itself and it binds, faithfully, to a
 * self-report.
 *
 * ⛔ THE FIX IS NOT MORE VALIDATION. This coordinator's `prepare` HAS NO `expectedSession`
 * PARAMETER. It asks its own fixed authority dependency. A caller cannot supply the expected
 * side because there is nowhere to put it — and anything that looks like an attempt is REFUSED
 * rather than dropped, because silently ignoring it would leave the caller believing its
 * expectation had been honoured.
 *
 * ⛔ AND IT REIMPLEMENTS NOTHING. Approved-step matching, single-use burning and result
 * correlation stay in `observationBinding`, where they are already proven. A second
 * implementation of 「once」 would be a second opinion about what once means.
 *
 * ⛔ STILL WIRED TO NOTHING. No transport, no Windows, no production caller. The authority is
 * an injected contract with no machine implementation anywhere in this repository.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { createObservationBinding } = require('./observationBinding')

/** Exactly the three inputs. A fourth is a smuggling attempt, not a convenience. */
const PREPARE_FIELDS = Object.freeze(['approvedStep', 'request', 'companionRef'])

/**
 * ⛔ THE REFERENCE IS OPAQUE AND STAYS THAT WAY. `refId` and nothing else: accepting a pid, a
 * sessionId or an account on it would put the target's own identity back into the domain
 * contract through a side door, which is the same defect in a smaller package.
 */
const REF_FIELDS = Object.freeze(['refId'])

const REASON = Object.freeze({
  UNKNOWN_INPUT: 'unknown-input',
  APPROVED_STEP_MISSING: 'approved-step-missing',
  REQUEST_MISSING: 'request-missing',
  COMPANION_REF_INVALID: 'companion-ref-invalid',
  NO_AUTHORITY: 'authority-misconfigured',
  DISPATCH_UNKNOWN: 'dispatch-unknown'
})

const refuse = (reason) => ({ ok: false, verdict: 'REFUSED', reason })

function createObservationServiceCoordinator (deps = {}) {
  const registry = deps.registry
  const authority = deps.expectedSessionAuthority
  const binding = createObservationBinding({ registry })
  const dispatches = new Map()
  let seq = 0

  function prepare (input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse(REASON.UNKNOWN_INPUT)
    /**
     * ⛔ THE STRUCTURAL FIX, ENFORCED AS A CLOSED KEY SET. `expectedSession`, `expectedSid`,
     * `evidencePath`, a SessionGate blob — each is refused by name-not-being-known rather than
     * by a blacklist, so a carrier nobody has thought of yet is refused too.
     */
    if (Object.keys(input).some((k) => !PREPARE_FIELDS.includes(k))) return refuse(REASON.UNKNOWN_INPUT)

    const { approvedStep, request, companionRef } = input
    if (!approvedStep || typeof approvedStep !== 'object') return refuse(REASON.APPROVED_STEP_MISSING)
    if (!request || typeof request !== 'object') return refuse(REASON.REQUEST_MISSING)

    if (!companionRef || typeof companionRef !== 'object' || Array.isArray(companionRef)) return refuse(REASON.COMPANION_REF_INVALID)
    if (Object.keys(companionRef).some((k) => !REF_FIELDS.includes(k))) return refuse(REASON.COMPANION_REF_INVALID)
    if (typeof companionRef.refId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(companionRef.refId)) {
      return refuse(REASON.COMPANION_REF_INVALID)
    }

    if (!authority || typeof authority.resolveForCompanion !== 'function') return refuse(REASON.NO_AUTHORITY)

    /**
     * ⛔ AUTHORITY FIRST, AND THEREFORE BEFORE THE BURN. The nonce is spent inside
     * `observationBinding.prepare()`, which is called only after this succeeds — so if Windows
     * authority cannot establish an independent target, nothing was dispatched and the Owner's
     * approval is untouched. Spending his authorisation on OUR inability to look something up
     * would be a self-inflicted denial of work he approved.
     *
     * ⛔ AND IT IS ASKED FRESH, PER TARGET. No cache: one authority answer belongs to one
     * companion reference, and reusing it for another target would authorise an observation in
     * a session nobody ever looked up.
     */
    const auth = authority.resolveForCompanion(companionRef)
    if (!auth || auth.ok !== true || !auth.expectedSession) {
      return refuse((auth && auth.reason) || 'invalid-authority-result')
    }

    const prepared = binding.prepare({ approvedStep, request, expectedSession: auth.expectedSession })
    if (!prepared || prepared.ok !== true) {
      return { ok: false, verdict: (prepared && prepared.verdict) || 'REFUSED', reason: (prepared && prepared.reason) || 'binding-refused' }
    }

    const dispatchId = 'dispatch-' + companionRef.refId + '-' + (++seq)
    dispatches.set(dispatchId, {
      bindingId: prepared.bindingId,
      refId: companionRef.refId,
      resolvedAt: auth.resolvedAt,
      proofId: prepared.proofId
    })

    /**
     * ⛔ THE SUMMARY CARRIES NO IDENTITY. Not the expected SID, not the service principal, not
     * the raw expected session — a convenient pair of account identifiers in a log is exactly
     * what the durable audit boundary already refuses.
     */
    return {
      ok: true,
      verdict: prepared.verdict,
      reason: null,
      dispatchId,
      bindingId: prepared.bindingId,
      approvalId: prepared.approvalId,
      stepIndex: prepared.stepIndex,
      action: prepared.action,
      refId: companionRef.refId,
      proofId: prepared.proofId,
      resolvedAt: auth.resolvedAt
    }
  }

  /**
   * ⛔ THE EXPECTED SIDE IS FROZEN. The authority is NOT re-queried here: the observation was
   * authorised against the machine state that existed when it was authorised, and asking again
   * afterwards would quietly accept a result from wherever the machine has drifted to since.
   *
   * ⛔ KNOWN OPEN, RECORDED RATHER THAN SOLVED: freezing means an old preparation can still be
   * verified long after that state has gone. There is deliberately NO freshness bound yet;
   * `resolvedAt` travels so a future policy has a fact to act on.
   *
   * Any additional argument is ignored on purpose — a third parameter must not become the back
   * door the second one was.
   */
  function verifyResult (dispatchId, response) {
    const rec = dispatches.get(dispatchId)
    if (!rec) return refuse(REASON.DISPATCH_UNKNOWN)

    const verified = binding.verifyResult(rec.bindingId, response)
    return Object.assign({}, verified, {
      dispatchId,
      refId: rec.refId,
      resolvedAt: rec.resolvedAt
    })
  }

  return { prepare, verifyResult }
}

module.exports = { createObservationServiceCoordinator, REASON, PREPARE_FIELDS, REF_FIELDS }
