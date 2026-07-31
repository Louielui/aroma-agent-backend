'use strict'

/**
 * identityAttestation.js — WHO is about to act, proven before it acts.
 *
 * ── THE FAILURE THIS EXISTS FOR ────────────────────────────────────────────
 * The canary was built, sealed, approved and unlocked, and on the first real press of E it
 * turned out the whole chain would have run as louis: the entrypoint called executor.execute()
 * directly, the Companion was constructed and never used, and every containment property
 * attached to AromaOperator — separate account, separate session, non-elevated token, the DENY
 * around C:\Aroma — applied to nothing.
 *
 * Nothing in the design was wrong about containment. The gap was that NOBODY EVER ASKED WHO WAS
 * RUNNING. A preflight can check a folder, a hash, a flag and an audit sink and still be
 * checking the wrong process's world.
 *
 * So identity stops being an assumption and becomes an assertion, made by the process that is
 * about to act, about itself, immediately before it acts.
 *
 * ── FAIL CLOSED, AND NEVER "PROBABLY" ─────────────────────────────────────
 * Every field must be present and must match. A field that cannot be read is a refusal, not a
 * pass — an attestation that silently drops what it could not measure is worth less than none,
 * because it looks like evidence.
 *
 * ── IT MEASURES, IT DOES NOT ACT ──────────────────────────────────────────
 * Pure comparison over a snapshot the caller supplies. No process spawning, no Windows API, no
 * privilege of its own. The snapshot is gathered by the Companion in its own session, which is
 * the only place it means anything.
 */

/**
 * The one identity permitted to run the canary. Pinned from the provisioning record, and by SID
 * rather than by name: a name can be recreated, and a recreated account with the same name is a
 * different principal wearing the same label.
 */
const REQUIRED = Object.freeze({
  account: 'AROMABRAIN\\AromaOperator',
  sid: 'S-1-5-21-2042659270-2029498691-2127769412-1009',
  desktop: 'WinSta0\\Default',
  elevated: false,
  interactive: true
})

/** SIDs whose presence in the token means the process can escape its own containment. */
const FORBIDDEN_GROUPS = Object.freeze({
  'S-1-5-32-544': 'BUILTIN\\Administrators',
  'S-1-5-18': 'NT AUTHORITY\\SYSTEM',
  'S-1-5-32-551': 'BUILTIN\\Backup Operators',
  'S-1-16-12288': 'High Mandatory Level',
  'S-1-16-16384': 'System Mandatory Level'
})

/** Everything an attestation must carry. A missing field is a refusal. */
const REQUIRED_FIELDS = Object.freeze([
  'account', 'sid', 'sessionId', 'desktop', 'isElevated', 'isInteractive',
  'integrityLevel', 'groupSids', 'processId', 'attestedAt'
])

const no = (refusal, reason, detail) => ({ ok: false, refusal, reason, detail: detail || null })

/**
 * @param {object} snapshot  gathered by the Companion about ITSELF
 * @param {object} [expected] overrides for tests; production uses REQUIRED
 */
function attest (snapshot, expected = REQUIRED) {
  if (!snapshot || typeof snapshot !== 'object') return no('no_attestation', 'nothing was measured')

  // Completeness first. A partial attestation must never be scored on the fields it happens to
  // have — that is how "we could not read the token" becomes "the token was fine".
  const missing = REQUIRED_FIELDS.filter((f) => snapshot[f] === undefined || snapshot[f] === null)
  if (missing.length > 0) return no('incomplete_attestation', 'these could not be measured', missing.join(', '))

  if (snapshot.sid !== expected.sid) {
    return no('wrong_identity', 'the process is not the operator account', snapshot.account + ' / ' + snapshot.sid)
  }
  // The name is checked too, and separately: a SID match with a surprising name means the
  // pinned record and the machine disagree, which is worth stopping for.
  if (String(snapshot.account).toUpperCase() !== String(expected.account).toUpperCase()) {
    return no('identity_name_mismatch', 'the SID matches but the account name does not', snapshot.account)
  }

  if (snapshot.isElevated !== false) return no('elevated_token', 'the canary must not run elevated')
  if (snapshot.isInteractive !== true) return no('not_interactive', 'there is no interactive session to act in')

  // Session 0 is the service session: no desktop, no windows, nothing for UIA to find.
  if (!Number.isInteger(snapshot.sessionId) || snapshot.sessionId <= 0) {
    return no('bad_session', 'not a real interactive session', String(snapshot.sessionId))
  }
  if (expected.sessionId !== undefined && snapshot.sessionId !== expected.sessionId) {
    return no('wrong_session', 'not the session this run was admitted for', String(snapshot.sessionId))
  }

  if (snapshot.desktop !== expected.desktop) {
    return no('wrong_desktop', 'not the interactive desktop', snapshot.desktop)
  }

  // The token's GROUPS, not just its user. An account can be non-elevated and still carry a
  // group that grants what elevation would have.
  const groups = Array.isArray(snapshot.groupSids) ? snapshot.groupSids : null
  if (!groups) return no('incomplete_attestation', 'the token groups were not measured')
  for (const sid of groups) {
    if (FORBIDDEN_GROUPS[sid]) {
      return no('privileged_group', 'the token carries a group that defeats containment', FORBIDDEN_GROUPS[sid])
    }
  }
  if (snapshot.integrityLevel !== 'Medium') {
    return no('wrong_integrity', 'the token integrity level is not Medium', String(snapshot.integrityLevel))
  }

  return {
    ok: true,
    account: snapshot.account,
    sid: snapshot.sid,
    sessionId: snapshot.sessionId,
    desktop: snapshot.desktop,
    processId: snapshot.processId,
    attestedAt: snapshot.attestedAt
  }
}

/** The record written into the audit chain. Everything measured, nothing inferred. */
function toAuditRecord (snapshot, verdict) {
  return {
    kind: 'identity-attestation',
    ok: verdict.ok === true,
    refusal: verdict.ok ? null : verdict.refusal,
    detail: verdict.ok ? null : verdict.detail,
    account: snapshot && snapshot.account,
    sid: snapshot && snapshot.sid,
    sessionId: snapshot && snapshot.sessionId,
    desktop: snapshot && snapshot.desktop,
    isElevated: snapshot && snapshot.isElevated,
    integrityLevel: snapshot && snapshot.integrityLevel,
    groupSids: (snapshot && snapshot.groupSids) || null,
    processId: snapshot && snapshot.processId,
    attestedAt: snapshot && snapshot.attestedAt,
    expectedSid: REQUIRED.sid,
    expectedDesktop: REQUIRED.desktop
  }
}

module.exports = { attest, toAuditRecord, REQUIRED, FORBIDDEN_GROUPS, REQUIRED_FIELDS }
