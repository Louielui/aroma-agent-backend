'use strict'

/**
 * identityShadow — M2 read-only shadow verification + governed seeding for the
 * frozen Identity prefix of PERSONA_IDENTITY.
 *
 * PERSONA_IDENTITY is NOT pure Identity — it also carries Operating Principles /
 * Personality, Stable Business Context, and Runtime & Governance Awareness. The
 * Identity Store holds ONLY the frozen Identity prefix, split at the exact marker
 * '\n\n1. 思考順序:' (which must occur exactly once). The remainder is left
 * untouched and stored NOWHERE in M2.
 *
 * Equality is EXACT STRING equality. SHA-256 is audit/integrity evidence only and
 * never used to mask a text difference.
 *
 * This module has NO runtime coupling and does not import persona/prompt/intake —
 * PERSONA_IDENTITY is passed in by the CLI wrappers. Runtime entrypoints must not
 * be able to reach it.
 */

const { MemoryError } = require('../errors')
const { canonicalize, sha256Hex } = require('../canonical')
const { verifyRevision } = require('../envelope')
const store = require('../store')

const IDENTITY_RECORD_ID = 'xiangxiang-identity'
const MARKER = '\n\n1. 思考順序:'

const REASON = Object.freeze({
  PASS: 'PASS',
  IDENTITY_SPLIT_CONTRACT_ERROR: 'IDENTITY_SPLIT_CONTRACT_ERROR',
  IDENTITY_STORE_CORRUPT: 'IDENTITY_STORE_CORRUPT',
  AMBIGUOUS_ACTIVE_IDENTITY: 'AMBIGUOUS_ACTIVE_IDENTITY',
  NO_ACTIVE_IDENTITY: 'NO_ACTIVE_IDENTITY',
  IDENTITY_TEXT_MISMATCH: 'IDENTITY_TEXT_MISMATCH'
})

// Split the frozen Identity prefix from the rest. Marker must occur exactly once.
// No trim, no newline normalization, no Unicode normalization, no character change.
function splitIdentity (personaIdentity) {
  if (typeof personaIdentity !== 'string' || personaIdentity.length === 0) {
    throw new MemoryError('IDENTITY_SPLIT_CONTRACT_ERROR', 'personaIdentity must be a non-empty string')
  }
  const first = personaIdentity.indexOf(MARKER)
  const last = personaIdentity.lastIndexOf(MARKER)
  if (first === -1) throw new MemoryError('IDENTITY_SPLIT_CONTRACT_ERROR', 'identity marker not found')
  if (first !== last) throw new MemoryError('IDENTITY_SPLIT_CONTRACT_ERROR', 'identity marker must occur exactly once')
  const frozenIdentityText = personaIdentity.slice(0, first)
  const remainder = personaIdentity.slice(first)
  // exact recomposition invariant
  if (frozenIdentityText + remainder !== personaIdentity) {
    throw new MemoryError('IDENTITY_SPLIT_CONTRACT_ERROR', 'recomposition invariant violated')
  }
  return { frozenIdentityText, remainder }
}

// Read-only diagnostic: where does the (possibly partial) migration currently stand?
function diagnoseIdentity (baseDir) {
  const revisions = store.listRevisions(baseDir, 'identity', IDENTITY_RECORD_ID)
  const recState = store.getRecordState(baseDir, 'identity', IDENTITY_RECORD_ID)
  const anyUnreadableRevision = revisions.some((r) => r.__unreadable)
  const corruptEvents = recState.corruptEvents
  return {
    recordId: IDENTITY_RECORD_ID,
    exists: revisions.length > 0,
    revisionCount: revisions.length,
    anyUnreadableRevision,
    corruptEvents,
    active: recState.active
  }
}

/**
 * Read-only verification. Precedence (Owner-fixed):
 *   1. (CONFIG handled by the CLI before this is called)
 *   2. split contract
 *   3. target-record store corruption   -> IDENTITY_STORE_CORRUPT
 *   4. AMBIGUOUS_ACTIVE_IDENTITY
 *   5. NO_ACTIVE_IDENTITY
 *   6. active revision integrity         -> IDENTITY_STORE_CORRUPT
 *   7. exact text (a)+(b)                -> IDENTITY_TEXT_MISMATCH
 *   8. PASS
 * Returns SAFE metadata only (no Identity text).
 */
function verifyIdentityShadow (baseDir, personaIdentity) {
  let split
  try { split = splitIdentity(personaIdentity) } catch (e) {
    return { status: REASON.IDENTITY_SPLIT_CONTRACT_ERROR, recordId: IDENTITY_RECORD_ID, detail: e.detail || null }
  }
  const { frozenIdentityText, remainder } = split

  const dx = diagnoseIdentity(baseDir)

  // 3. corruption of THIS record wins over "no active"
  if (dx.anyUnreadableRevision || dx.corruptEvents.length > 0) {
    return { status: REASON.IDENTITY_STORE_CORRUPT, recordId: IDENTITY_RECORD_ID, corruptEvents: dx.corruptEvents, unreadableRevision: dx.anyUnreadableRevision }
  }
  // 4 / 5
  if (dx.active.status === 'AMBIGUOUS_ACTIVE_STATE') {
    return { status: REASON.AMBIGUOUS_ACTIVE_IDENTITY, recordId: IDENTITY_RECORD_ID, candidates: dx.active.candidates }
  }
  if (dx.active.status !== 'ACTIVE') {
    return { status: REASON.NO_ACTIVE_IDENTITY, recordId: IDENTITY_RECORD_ID, revisionCount: dx.revisionCount }
  }
  // 6. active revision integrity
  const rev = store.getRevision(baseDir, 'identity', IDENTITY_RECORD_ID, dx.active.revisionId)
  try { verifyRevision(rev) } catch (e) {
    return { status: REASON.IDENTITY_STORE_CORRUPT, recordId: IDENTITY_RECORD_ID, revisionId: dx.active.revisionId }
  }
  const shadowText = (rev.payload && typeof rev.payload.text === 'string') ? rev.payload.text : null
  // 7. exact string equality (SHA-256 is audit evidence, not the decision)
  const equalA = shadowText === frozenIdentityText
  const equalB = shadowText != null && (shadowText + remainder) === personaIdentity
  const metadata = {
    recordId: IDENTITY_RECORD_ID,
    revisionId: dx.active.revisionId,
    activeStatus: dx.active.status,
    hFrozenIdentity: sha256Hex(canonicalize(frozenIdentityText)),
    hShadow: shadowText != null ? sha256Hex(canonicalize(shadowText)) : null,
    reconstituteOk: equalB
  }
  if (!(equalA && equalB)) return { status: REASON.IDENTITY_TEXT_MISMATCH, ...metadata }
  return { status: REASON.PASS, ...metadata }
}

// Provenance must record the FULL 40-char commit SHA (audit evidence; abbreviated
// SHAs are display-only and too weak for permanent governance evidence). No repo
// lookup / network verification — format only. Not cryptographic identity verification.
function looksLikeCommit (s) { return typeof s === 'string' && /^[0-9a-fA-F]{40}$/.test(s) }

/**
 * Governed one-time seeding. Multi-step append-only writes (createRevision ->
 * SUBMITTED_FOR_REVIEW -> APPROVED -> ACTIVATED) are NOT a single transaction:
 * any failure stops immediately, does NOT roll back, and leaves the written
 * artifacts in place (auditable). A partial migration is never ACTIVE and re-seed
 * is refused while ANY revision exists. Recovery/resume is a separate slice.
 *
 * approvedBy is fixed to "Louie" and approvalSource to "owner-authorized-migration".
 * These are governance AUDIT records — NOT identity verification. Real authorization
 * is Louie's explicit out-of-band GO; running this CLI does not constitute approval.
 */
function seedIdentity (baseDir, opts = {}) {
  const { personaIdentity, approvalRef, rationale, sourceCommit, createdAtLabel, timestampLabel } = opts
  const { frozenIdentityText } = splitIdentity(personaIdentity)
  if (typeof approvalRef !== 'string' || !approvalRef) throw new MemoryError('VALIDATION_ERROR', 'approvalRef is required')
  if (typeof rationale !== 'string' || !rationale) throw new MemoryError('VALIDATION_ERROR', 'rationale is required')
  if (!looksLikeCommit(sourceCommit)) throw new MemoryError('VALIDATION_ERROR', 'sourceCommit must be a full 40-char hex git commit SHA')

  // refuse if ANY revision already exists (no duplicate seed, no resume)
  if (store.listRevisions(baseDir, 'identity', IDENTITY_RECORD_ID).length > 0) {
    throw new MemoryError('IDENTITY_ALREADY_SEEDED', 'identity record already has revisions; refuse to re-seed (recovery is a separate slice)')
  }

  const cl = createdAtLabel || 'M2-SEED'
  const tl = timestampLabel || 'M2-SEED'
  const rev = store.createRevision(baseDir, 'identity', {
    recordId: IDENTITY_RECORD_ID,
    selectors: { category: 'identity', tags: ['identity'], links: [], project: 'aroma-core' },
    provenance: { source: 'migrated-from-persona-constant', author: 'Louie', evidence: [sourceCommit, `marker:${JSON.stringify(MARKER)}`], derivedFrom: 'PERSONA_IDENTITY', notes: rationale },
    payload: { format: 'verbatim', section: 'identity', text: frozenIdentityText },
    createdAtLabel: cl
  })
  const approval = { approvedBy: 'Louie', decision: 'approved', approvalSource: 'owner-authorized-migration', reviewRef: approvalRef, rationale }
  store.recordEvent(baseDir, 'identity', { recordId: IDENTITY_RECORD_ID, targetRevisionId: rev.revisionId, eventType: 'SUBMITTED_FOR_REVIEW', actor: 'seeder', rationale, expectedPreviousState: 'new', timestampLabel: tl })
  store.recordEvent(baseDir, 'identity', { recordId: IDENTITY_RECORD_ID, targetRevisionId: rev.revisionId, eventType: 'APPROVED', actor: 'seeder', approval, rationale, expectedPreviousState: 'review_ready', timestampLabel: tl })
  store.recordEvent(baseDir, 'identity', { recordId: IDENTITY_RECORD_ID, targetRevisionId: rev.revisionId, eventType: 'ACTIVATED', actor: 'seeder', rationale, expectedPreviousState: 'approved', timestampLabel: tl })

  // read-back self-verify (hash + resolver + exact equality)
  const v = verifyIdentityShadow(baseDir, personaIdentity)
  if (v.status !== REASON.PASS) throw new MemoryError('READBACK_FAILED', `seed read-back did not PASS: ${v.status}`)
  return { seeded: true, revisionId: rev.revisionId, verify: v }
}

// Verifier exit-code contract: 0 PASS · 2 SHADOW_VERIFICATION_FAILED · 3 CONFIG_OR_TOOL_ERROR.
function exitCodeFor (status) {
  if (status === REASON.PASS) return 0
  if (status === REASON.IDENTITY_SPLIT_CONTRACT_ERROR) return 3 // tool/contract error
  return 2 // NO_ACTIVE / AMBIGUOUS / CORRUPT / TEXT_MISMATCH
}

module.exports = { IDENTITY_RECORD_ID, MARKER, REASON, splitIdentity, diagnoseIdentity, verifyIdentityShadow, seedIdentity, looksLikeCommit, exitCodeFor }
