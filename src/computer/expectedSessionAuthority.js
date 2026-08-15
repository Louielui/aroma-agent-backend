'use strict'

/**
 * E0-W1 EXPECTED-SESSION AUTHORITY CONTRACT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE COMPARISON IS ONLY WORTH SOMETHING IF THE TWO SIDES COME FROM DIFFERENT PLACES.
 *
 * `observationBinding` checks the Observer's `measuredSid` against an expected SID. The
 * obvious source for the expected side was the registered SessionGate task — which runs
 * `session-identity.ps1` AS AromaOperator, reads its own token and writes its own JSON. Wire
 * that in and the check degenerates:
 *
 *     AromaOperator process A: I am SID X in session Y
 *     AromaOperator process B: I am SID X in session Y
 *     Service: they agree, therefore proven
 *
 * Two self-reports from ONE security principal, compared with each other and called
 * independent. It would look like a binding and verify nothing — `measuredSid` trusted on its
 * own, one level further out.
 *
 * ⛔ SO INDEPENDENCE IS A PRECONDITION, NOT A PROPERTY OF THE DATA. A structurally perfect
 * expected session is refused if the resolver could not establish that the authority
 * principal is not the target principal. This module never upgrades that verdict.
 *
 * ⛔ WHAT THIS FILE IS NOT. It is a pure contract — no imports at all. It cannot check that
 * anything it is told is true, and deterministic tests of it prove NOTHING about Windows.
 * Whether a real resolver runs under a principal AromaOperator cannot control is a machine
 * question for a machine tranche that does not exist yet. What this enforces is the shape,
 * the refusals, and the rule that the expected side may never arrive from the target.
 *
 * ⛔ AND NO MECHANISM IS ENCODED HERE. Not quser, not WTSEnumerateSessions, not
 * ProcessIdToSessionId, not PowerShell. The contract must not grow around whichever API the
 * first implementation happens to reach for — that is how a domain rule ends up shaped like
 * an accident.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** Coarse and closed. Detail belongs behind the boundary, not in a reason string. */
const REASON = Object.freeze({
  MISCONFIGURED: 'authority-misconfigured',
  UNAVAILABLE: 'authority-unavailable',
  NOT_INDEPENDENT: 'authority-not-independent',
  NOT_FOUND: 'target-not-found',
  AMBIGUOUS: 'target-ambiguous',
  INVALID: 'invalid-authority-result'
})

/** The only failures a resolver may name. Anything else is an invalid result, not a new reason. */
const RESOLVER_REASONS = Object.freeze([REASON.UNAVAILABLE, REASON.NOT_INDEPENDENT, REASON.NOT_FOUND, REASON.AMBIGUOUS])

/**
 * ⛔ POLICY, NOT MEASUREMENT. `WinSta0` and `Default` say 「an interactive desktop is what we
 * will accept」. Taking them from whatever the target reported would let the target choose the
 * standard it is judged against — a policy turned into an echo.
 */
const REQUIRED_WINDOW_STATION = 'WinSta0'
const REQUIRED_DESKTOP = 'Default'

/** A SID, not an account name. Names are labels; the SID is the account. */
const SID_SHAPE = /^S-1-\d+(-\d+){1,15}$/

/**
 * ⛔ A STRICT ALLOWLIST ON THE WAY IN. The motivating case is a resolver that hands over
 * `measuredSid`, `evidencePath` or raw SessionGate JSON: it is telling us HOW it decided, and
 * the answer is the source this contract exists to exclude. Rather than blacklist the
 * carriers we can think of today, nothing unknown is accepted at all.
 */
const RESOLVER_FIELDS = Object.freeze(['ok', 'reason', 'independence', 'expectedSid', 'sessionId', 'windowStation', 'desktop', 'proofId'])

const fail = (reason) => ({ ok: false, reason })

/**
 * @param {object} deps
 * @param {Function} deps.resolveIndependentForCompanion — SERVICE-CONTROLLED. The real one must
 *   derive the target's session and SID from Windows authority under a principal INDEPENDENT of
 *   AromaOperator, and must refuse when that independence cannot be established. It must not
 *   read the target's self-report — no SessionGate JSON, no evidence file, no Companion claim.
 * @param {Function} deps.now — injected clock. Required: without it there is no honest record of
 *   WHEN authority was established, and a wall-clock read would make this module impure.
 */
function createExpectedSessionAuthority (deps = {}) {
  const resolve = deps.resolveIndependentForCompanion
  const now = deps.now

  function resolveForCompanion (companionRef) {
    if (typeof resolve !== 'function' || typeof now !== 'function') return fail(REASON.MISCONFIGURED)

    let raw
    try {
      // ⛔ The reference travels UNREAD. Opaque means opaque: no pid, session or account is
      //    inferred from it here, because inferring identity from a caller's token is the
      //    door this whole tranche closes.
      raw = resolve(companionRef)
    } catch (e) {
      /**
       * ⛔ A THROW IS AN UNAVAILABLE AUTHORITY, AND ITS TEXT DOES NOT TRAVEL. An OS error
       * carries paths, SIDs and account names; forwarding it would leak exactly what the
       * output contract refuses to expose, through the one channel nobody inspects.
       */
      return fail(REASON.UNAVAILABLE)
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(REASON.INVALID)
    if (Object.keys(raw).some((k) => !RESOLVER_FIELDS.includes(k))) return fail(REASON.INVALID)

    if (raw.ok !== true) {
      return fail(RESOLVER_REASONS.includes(raw.reason) ? raw.reason : REASON.INVALID)
    }

    /**
     * ⛔ THE RULE THE WHOLE TRANCHE EXISTS FOR, AND IT IS CHECKED BEFORE THE DATA IS ADMIRED.
     * Independence must be ASSERTED — absent, null or truthy-ish is not a yes. A wrapper that
     * accepts a well-formed payload from a principal it could not distinguish from the target
     * has restored the degenerate comparison.
     */
    if (raw.independence !== true) return fail(REASON.NOT_INDEPENDENT)

    if (typeof raw.expectedSid !== 'string' || !SID_SHAPE.test(raw.expectedSid)) return fail(REASON.INVALID)
    if (!Number.isInteger(raw.sessionId) || raw.sessionId < 0) return fail(REASON.INVALID)
    if (raw.windowStation !== REQUIRED_WINDOW_STATION) return fail(REASON.INVALID)
    if (raw.desktop !== REQUIRED_DESKTOP) return fail(REASON.INVALID)
    if (raw.proofId !== undefined && typeof raw.proofId !== 'string') return fail(REASON.INVALID)

    /**
     * ⛔ NOTHING ABOUT THE SERVICE COMES OUT. No service SID, no account name, no mechanism, no
     * file path — the caller receives the expected session and a correlation id, and learns
     * nothing about who asked or how. `proofId` is correlation metadata and manufactures no
     * trust; it is not a receipt for anything.
     */
    return {
      ok: true,
      expectedSession: {
        expectedSid: raw.expectedSid,
        sessionId: raw.sessionId,
        windowStation: REQUIRED_WINDOW_STATION,
        desktop: REQUIRED_DESKTOP,
        proofId: typeof raw.proofId === 'string' ? raw.proofId : null
      },
      /**
       * ⛔ 12A — WHEN, RECORDED, BECAUSE THERE IS NO FRESHNESS RULE YET. The expected side is
       * frozen at prepare and never re-queried, which is correct and also means a preparation
       * made in one machine state can be verified long after that state has gone. No bound
       * exists and none is invented here — inventing one would be a guess wearing a policy's
       * clothes. This timestamp is carried so a future policy has something to act on rather
       * than discovering the fact was available and thrown away.
       */
      resolvedAt: now()
    }
  }

  return { resolveForCompanion }
}

module.exports = {
  createExpectedSessionAuthority,
  REASON,
  RESOLVER_REASONS,
  RESOLVER_FIELDS,
  REQUIRED_WINDOW_STATION,
  REQUIRED_DESKTOP,
  SID_SHAPE
}
