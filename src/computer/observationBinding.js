'use strict'

/**
 * E0-W1 SESSION / GOVERNANCE BINDING FOUNDATION.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.
 *
 * The observation contract can now describe a real result, and the kill control can end a
 * real process. Neither of them answers the question that has been outstanding since the
 * first audit: WHOSE OBSERVATION IS THIS, AND WHO SAID IT COULD HAPPEN. Until something
 * carries an Owner-approved step through to the returned bytes, `validateResult()` is a
 * schema check with nobody's authority behind it.
 *
 * This module is that seam and nothing more. It is PURE — no fs, no net, no child process,
 * no clock of its own, no Windows API — so everything it can be trusted to do, it can be
 * proven to do in a deterministic test.
 *
 * ⛔ IT DOES NOT PROVE OWNER APPROVAL. It receives an approved step from the Service as a
 * TRUSTED INPUT. Pretending otherwise would be the worst possible failure here: a module
 * that looks like it verifies approval, and does not. What it actually guarantees is
 * narrower and worth stating exactly: THE REQUEST THAT GOES OUT CANNOT DRIFT FROM THE STEP
 * THE OWNER APPROVED, AND THE RESULT THAT COMES BACK CANNOT DRIFT FROM THAT REQUEST.
 *
 * ⛔ IT DOES NOT DISCOVER THE SESSION EITHER. Expected session proof is injected. It never
 * calls quser, never reads a process list, never infers 「session 5 because that is what we
 * measured once」, and never treats the producer's own `measuredSid` as its own authority —
 * that string is exactly what an impostor would also write. The comparison is only worth
 * something because the expected side arrives independently.
 *
 * ⛔ AND IT IS WIRED TO NOTHING. Zero production callers by design. The Companion must never
 * be the thing that decides its own session is trusted, so the authority stays Service-side,
 * and connecting the two is a later tranche with its own GO.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { OBSERVATION_ACTIONS, validateResult } = require('./observation')
const { ROLE_SERVICE, ROLE_COMPANION } = require('./sessionBoundary')

/** Verdicts. Coarse on purpose — the reason id carries the detail. */
const VERDICT = Object.freeze({
  AUTHORISED: 'AUTHORISED',
  OBSERVED_AND_BOUND: 'OBSERVED_AND_BOUND',
  CORRELATED_REFUSAL: 'CORRELATED_REFUSAL',
  BINDING_FAILURE: 'BINDING-FAILURE',
  REFUSED: 'REFUSED'
})

/**
 * ⛔ A SID, NOT A NAME. `measuredBy` is a label — 「AROMABRAIN\AromaOperator」 — and labels are
 * renameable, localised and forgeable in a string field. The SID is the account.
 */
const SID_SHAPE = /^S-1-\d+(-\d+){1,15}$/

/** The window station and desktop an interactive observation must have run in. */
const REQUIRED_WINDOW_STATION = 'WinSta0'
const REQUIRED_DESKTOP = 'Default'

const isSafeId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)
const isStepIndex = (v) => Number.isInteger(v) && v >= 0
const isNonce = (v) => typeof v === 'string' && v.length >= 16
const isSessionId = (v) => Number.isInteger(v) && v >= 0

const refuse = (reason, extra) => Object.assign({ ok: false, verdict: VERDICT.REFUSED, reason }, extra || {})
const bindingFailure = (reason, extra) => Object.assign({ ok: false, verdict: VERDICT.BINDING_FAILURE, reason }, extra || {})

/**
 * ⛔ THE EXPECTED-SESSION CONTRACT. Shape only — this module cannot and does not check that
 * the proof is TRUE. A `proofId` may travel with it for the Service's own records and
 * manufactures no trust here; there is deliberately no freshness window, because no policy
 * exists yet and inventing one would be a guess wearing a rule's clothes.
 */
function checkExpectedSession (p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'expected-session-missing'
  if (typeof p.expectedSid !== 'string' || !SID_SHAPE.test(p.expectedSid)) return 'expected-session-malformed:sid'
  if (!isSessionId(p.sessionId)) return 'expected-session-malformed:sessionId'
  if (p.windowStation !== REQUIRED_WINDOW_STATION) return 'expected-session-malformed:windowStation'
  if (p.desktop !== REQUIRED_DESKTOP) return 'expected-session-malformed:desktop'
  return null
}

function checkApprovedStep (s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return 'approved-step-missing'
  if (!isSafeId(s.approvalId)) return 'approved-step-malformed:approvalId'
  if (!isStepIndex(s.stepIndex)) return 'approved-step-malformed:stepIndex'
  if (!isNonce(s.stepNonce)) return 'approved-step-malformed:stepNonce'
  if (typeof s.action !== 'string' || !s.action) return 'approved-step-malformed:action'
  if (typeof s.workOrderHash !== 'string' || !s.workOrderHash) return 'approved-step-malformed:workOrderHash'
  return null
}

/**
 * ⛔ ONLY THE SIX IPC KEYS COME OFF, AND NOTHING ELSE IS TOUCHED.
 *
 * The tempting version is 「keep the keys that are declared RESULT_FIELDS」 — and that is a
 * silent shredder. A response carrying `secretText` or `pixels` would be quietly trimmed into
 * something that validates, and the evidence that a leak was attempted would be destroyed by
 * the very step meant to catch it. So extraction removes exactly the envelope's own keys and
 * hands EVERYTHING else to `validateResult`, which fails closed on anything undeclared.
 */
const IPC_KEYS = Object.freeze(['from', 'to', 'type', 'approvalId', 'stepIndex', 'stepNonce'])

function extractResult (response) {
  const out = {}
  for (const k of Object.keys(response)) {
    if (IPC_KEYS.includes(k)) continue
    out[k] = response[k]
  }
  return out
}

/**
 * @param {{ registry: object }} deps — `registry` is an orderRegistry-compatible authority
 *   exposing `isLive(approvalId)` and `consumeStep({approvalId, stepIndex, stepNonce})`.
 *   ⛔ INJECTED, NEVER CONSTRUCTED. A second nonce store would be a second opinion about
 *   what is single-use, and two ledgers of the same fact is the same as none.
 */
function createObservationBinding (deps = {}) {
  const registry = deps.registry
  const prepared = new Map()
  let seq = 0

  /**
   * PHASE 1 — AUTHORISE AND PREPARE, before anything is dispatched.
   *
   * ⛔ TWO PHASES BECAUSE ONE WOULD BE A POST-MORTEM. A single 「validate the result」 call
   * can only ever run after the observation already happened; by then the only question left
   * is whether to believe it. The decision to let it happen at all has to exist separately,
   * and has to fail closed on its own.
   */
  function prepare (input = {}) {
    const { approvedStep, request, expectedSession } = input

    // 1. shapes first. Malformed junk must not reach the authority at all.
    const stepErr = checkApprovedStep(approvedStep)
    if (stepErr) return refuse(stepErr)
    if (!request || typeof request !== 'object' || Array.isArray(request)) return refuse('request-missing')

    /**
     * 2. ⛔ THE REQUEST MUST BE THE APPROVED STEP, FIELD FOR FIELD — AND THIS HAPPENS BEFORE
     * THE NONCE IS SPENT. A caller who presents rubbish has not yet shown it holds anything
     * of the Owner's, so burning the Owner's authorisation on its behalf would let any
     * malformed message destroy an approved step. Once the request IS shown to correspond to
     * the approved step, the single-use rule applies in full.
     */
    if (request.approvalId !== approvedStep.approvalId) return refuse('approvalId-mismatch')
    if (request.stepIndex !== approvedStep.stepIndex) return refuse('stepIndex-mismatch')
    if (request.stepNonce !== approvedStep.stepNonce) return refuse('stepNonce-mismatch')
    /**
     * ⛔ THE SUBSTITUTION THIS EXISTS TO STOP. A valid approvalId and a valid, live, unspent
     * nonce say 「the Owner approved A step」. They say nothing whatever about WHICH action,
     * so without this line an approval for `list_windows` authorises a screenshot.
     */
    if (request.action !== approvedStep.action) return refuse('action-mismatch')
    if (!OBSERVATION_ACTIONS.includes(approvedStep.action)) return refuse('action-not-observation')

    // 3. the authority must still consider this order live
    if (!registry || typeof registry.isLive !== 'function' || typeof registry.consumeStep !== 'function') {
      return refuse('no-authority')
    }
    if (!registry.isLive(approvedStep.approvalId)) return refuse('approval-not-live')

    /**
     * 4. ⛔ AND THE SESSION PROOF IS CHECKED BEFORE THE BURN, NOT AFTER — THE 6A DECISION.
     *
     * The nonce is consumed LAST, once every pre-dispatch check has passed. The alternative
     * — burn on first sight — turns any Service-side bug into a permanent denial of the
     * Owner's own decision: a malformed proof object would spend an approved step that was
     * never dispatched, and the Owner would have to approve the work again because of a
     * defect on our side. A refusal that never reached dispatch is not a USE of the
     * authorisation, so it does not spend it.
     *
     * ⛔ WHAT IS EXPLICITLY NOT ALLOWED: a second attempt after the burn. Once consumed the
     * step is authorised-for-dispatch and dead thereafter — success, failure, or no result at
     * all. If verification later fails, that step is finished and the Owner must approve a
     * fresh one. There is no retry path, and no code below this point can fail in a way that
     * would leave a spent-but-unusable nonce.
     */
    const sessionErr = checkExpectedSession(expectedSession)
    if (sessionErr) return refuse(sessionErr)

    const burn = registry.consumeStep({
      approvalId: approvedStep.approvalId,
      stepIndex: approvedStep.stepIndex,
      stepNonce: approvedStep.stepNonce
    })
    if (!burn || burn.ok !== true) return refuse('nonce-refused:' + ((burn && burn.reason) || 'unknown'))

    const bindingId = 'bind-' + approvedStep.approvalId + '-' + approvedStep.stepIndex + '-' + (++seq)
    prepared.set(bindingId, {
      approvalId: approvedStep.approvalId,
      stepIndex: approvedStep.stepIndex,
      stepNonce: approvedStep.stepNonce,
      action: approvedStep.action,
      expectedSession: {
        expectedSid: expectedSession.expectedSid,
        sessionId: expectedSession.sessionId,
        windowStation: expectedSession.windowStation,
        desktop: expectedSession.desktop,
        proofId: typeof expectedSession.proofId === 'string' ? expectedSession.proofId : null
      },
      verified: false
    })

    return {
      ok: true,
      verdict: VERDICT.AUTHORISED,
      reason: null,
      bindingId,
      approvalId: approvedStep.approvalId,
      stepIndex: approvedStep.stepIndex,
      action: approvedStep.action,
      proofId: typeof expectedSession.proofId === 'string' ? expectedSession.proofId : null
    }
  }

  /**
   * PHASE 2 — VERIFY ONE RESULT AGAINST ONE PREPARED BINDING.
   */
  function verifyResult (bindingId, response) {
    const rec = prepared.get(bindingId)
    if (!rec) return refuse('binding-unknown')
    /**
     * ⛔ ONE AUTHORISATION, ONE ANSWER. The request nonce is single-use, but without this the
     * same authorisation could be satisfied twice — a byte-identical response replayed into a
     * second acceptance. Single-use on the way out and unlimited on the way back is not
     * single-use.
     */
    if (rec.verified) return refuse('binding-already-verified')

    if (!response || typeof response !== 'object' || Array.isArray(response)) return refuse('response-missing')
    if (response.from !== ROLE_COMPANION) return refuse('not-from-companion')
    if (response.to !== ROLE_SERVICE) return refuse('not-to-service')
    if (response.type !== 'step_result') return refuse('wrong-type')

    // ⛔ Exact correlation, all three, before the payload is looked at.
    if (response.approvalId !== rec.approvalId) return refuse('approvalId-mismatch')
    if (response.stepIndex !== rec.stepIndex) return refuse('stepIndex-mismatch')
    if (typeof response.stepNonce !== 'string' || !response.stepNonce) return refuse('stepNonce-missing')
    if (response.stepNonce !== rec.stepNonce) return refuse('stepNonce-mismatch')

    // from here the binding is spent whatever happens — one attempt at a step
    rec.verified = true

    const candidate = extractResult(response)
    const schema = validateResult(candidate, { ownSessionId: rec.expectedSession.sessionId })
    if (!schema.ok) return refuse('result-invalid:' + (schema.errors[0] || 'unknown'))

    const common = {
      bindingId,
      approvalId: rec.approvalId,
      stepIndex: rec.stepIndex,
      action: rec.action,
      proofId: rec.expectedSession.proofId
    }

    /**
     * ⛔ A REFUSAL IS CORRELATED, NOT PROVEN. `ok: false` means the Companion declined; no
     * Windows session was demonstrated because no observation happened. It still has to be
     * the answer to THIS request and still has to be schema-clean — but it is never relabelled
     * as observed, and every match flag stays false rather than being left to read as absent.
     */
    if (candidate.ok !== true) {
      return Object.assign({
        ok: true,
        verdict: VERDICT.CORRELATED_REFUSAL,
        reason: typeof candidate.refusal === 'string' ? candidate.refusal : null,
        sessionMatched: false,
        sidMatched: false,
        windowStationMatched: false,
        desktopMatched: false
      }, common)
    }

    /**
     * ⛔ IDENTITY BINDING, AND ONLY NOW IS `measuredSid` WORTH ANYTHING. On its own it is a
     * string the producer wrote about itself. Compared against a SID that arrived from an
     * independent source, it becomes a claim that can be wrong — which is the only kind of
     * claim worth checking. A difference here is a CONTAINMENT/BINDING failure, not an
     * ordinary refusal: it means the thing that answered is not the thing we authorised.
     */
    if (candidate.action !== rec.action) return bindingFailure('action-mismatch', common)
    if (candidate.sessionId !== rec.expectedSession.sessionId) return bindingFailure('session-id-mismatch', common)
    if (candidate.measuredSid !== rec.expectedSession.expectedSid) return bindingFailure('sid-mismatch', common)
    if (candidate.windowStation !== rec.expectedSession.windowStation) return bindingFailure('window-station-mismatch', common)
    if (candidate.desktop !== rec.expectedSession.desktop) return bindingFailure('desktop-mismatch', common)

    /**
     * ⛔ AND THE OUTPUT CARRIES NO IDENTITY STRINGS. Returning `{expectedSid, measuredSid}`
     * side by side would be convenient and would put a durable pair of account identifiers
     * into whatever logs this — the same category of thing the audit boundary refuses. The
     * booleans say what was proven; they do not say who anybody is.
     */
    return Object.assign({
      ok: true,
      verdict: VERDICT.OBSERVED_AND_BOUND,
      reason: null,
      sessionMatched: true,
      sidMatched: true,
      windowStationMatched: true,
      desktopMatched: true
    }, common)
  }

  return { prepare, verifyResult }
}

module.exports = {
  createObservationBinding,
  VERDICT,
  SID_SHAPE,
  IPC_KEYS,
  REQUIRED_WINDOW_STATION,
  REQUIRED_DESKTOP
}
