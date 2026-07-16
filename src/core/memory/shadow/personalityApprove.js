'use strict'

/**
 * personalityApprove — M3c-3 approval tooling for the Personality domain
 * (governed, append-only).
 *
 * Consumes an explicit out-of-band Owner approval GO and records ONE `APPROVED`
 * lifecycle event on the single `review_ready` personality revision, advancing the
 * derived state to `approved`. It STOPS there: never activates (no ACTIVATED/
 * ADMITTED), never creates a revision, never emits any other event, never rolls
 * back, never silently repairs.
 *
 * `approvedBy`/`approvalSource`/`decision`/`actor` are FIXED (Louie / owner-
 * authorized-approval / approved) and cannot be caller-supplied. `--approval-ref`
 * is the Owner GO reference (recorded as approval.reviewRef).
 *
 * Before approving, the tool proves the EXACT review_ready lifecycle chain (not
 * just derived state) and RE-PROVES canonical payload identity (reusing the M3c-2
 * read-only prover) so corrupted/contaminated content can never be approved.
 * `--confirm` requires `--approval-ref` + `--rationale` + `--expect-revision-id`.
 * No `--resume`. Read-only outside the ONE governed APPROVED write; SAFE metadata only.
 */

const { MemoryError } = require('../errors')
const { revisionState } = require('../resolver')
const store = require('../store')
const B = require('./behavioralMapping')
const shadow = require('./personalityShadow')
const { provePayloadIdentity } = require('./personalitySubmit')

const PS_STORE = shadow.PERSONALITY_STORE
const PS_RECORD_ID = shadow.PERSONALITY_RECORD_ID
const APPROVAL_EVENT = 'APPROVED'
const EMITTED_EVENT_TYPES = Object.freeze([APPROVAL_EVENT]) // the ONLY event type this tool may ever write
const CREATED_AT_LABEL = 'M3C3-APPROVE'

// FIXED approval identity — never caller-supplied.
const ACTOR = 'Louie'
const APPROVED_BY = 'Louie'
const APPROVAL_SOURCE = 'owner-authorized-approval'
const APPROVAL_DECISION = 'approved'

const FORBIDDEN_EVENTS = ['ACTIVATED', 'ADMITTED', 'SUPERSEDED', 'DEPRECATED', 'REJECTED']

const REASON = Object.freeze({
  DRY_RUN: 'DRY_RUN',
  APPROVED: 'APPROVED',
  ALREADY_APPROVED_MATCH: 'ALREADY_APPROVED_MATCH',
  CONFIG_ERROR: 'CONFIG_ERROR',
  MAPPING_CONTRACT_ERROR: 'MAPPING_CONTRACT_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  STORE_CORRUPT: 'STORE_CORRUPT',
  MULTIPLE_REVISIONS: 'MULTIPLE_REVISIONS',
  UNEXPECTED_LIFECYCLE_STATE: 'UNEXPECTED_LIFECYCLE_STATE',
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  REVISION_TARGET_MISMATCH: 'REVISION_TARGET_MISMATCH',
  PAYLOAD_IDENTITY_FAILED: 'PAYLOAD_IDENTITY_FAILED',
  APPROVED_PAYLOAD_MISMATCH: 'APPROVED_PAYLOAD_MISMATCH',
  CHAIN_PROOF_FAILED: 'CHAIN_PROOF_FAILED',
  WRITE_FAILED: 'WRITE_FAILED',
  READBACK_FAILED: 'READBACK_FAILED',
  POST_APPROVE_STATE_UNEXPECTED: 'POST_APPROVE_STATE_UNEXPECTED'
})

const SUCCESS = new Set([REASON.DRY_RUN, REASON.APPROVED, REASON.ALREADY_APPROVED_MATCH])
const TIER3 = new Set([REASON.CONFIG_ERROR, REASON.MAPPING_CONTRACT_ERROR, REASON.VALIDATION_ERROR])
function exitCodeFor (status) { if (SUCCESS.has(status)) return 0; if (TIER3.has(status)) return 3; return 2 }

function resolveSourceOfRecord (personaIdentity) {
  const v = B.verifyBehavioralMapping(personaIdentity, B.MAPPING)
  if (v.status !== 'PASS') throw new MemoryError('MAPPING_CONTRACT_ERROR', v.reason || 'mapping verification failed')
  return { sourceCommit: B.SOURCE_COMMIT }
}

// Exact lifecycle-chain analysis (record-scoped) — does not rely on derived state.
function analyzeChain (baseDir) {
  const revs = store.listRevisions(baseDir, PS_STORE, PS_RECORD_ID)
  const rec = store.getRecordState(baseDir, PS_STORE, PS_RECORD_ID)
  const events = store.listEvents(baseDir, PS_STORE, PS_RECORD_ID)
  const unreadable = revs.some((r) => r.__unreadable)
  const counts = {}
  for (const e of events) counts[e.eventType] = (counts[e.eventType] || 0) + 1
  const forbiddenCount = FORBIDDEN_EVENTS.reduce((n, t) => n + (counts[t] || 0), 0)
  const soleRevId = (revs.length === 1 && !revs[0].__unreadable) ? revs[0].revisionId : null
  const allTargetSole = soleRevId != null && events.every((e) => e.targetRevisionId === soleRevId)
  const revIds = new Set(revs.filter((r) => !r.__unreadable).map((r) => r.revisionId))
  const causalClosure = events.every((e) => revIds.has(e.targetRevisionId))
  const derivedState = soleRevId ? revisionState(PS_STORE, soleRevId, events).state : null
  const resolver = store.resolveActiveRecord(baseDir, PS_STORE, PS_RECORD_ID)
  return { revisionCount: revs.length, unreadable, corruptEvents: rec.corruptEvents, total: events.length, counts, forbiddenCount, soleRevId, allTargetSole, causalClosure, derivedState, resolver }
}
const n = (counts, t) => counts[t] || 0
// Exact "ready to approve" chain: 1 revision, exactly [SUBMITTED], no forbidden/
// extra events, derived review_ready, resolver NONE, closure holds.
function isReviewReadyChain (a) {
  return a.revisionCount === 1 && a.total === 1 && n(a.counts, 'SUBMITTED_FOR_REVIEW') === 1 &&
    n(a.counts, 'APPROVED') === 0 && a.forbiddenCount === 0 && a.derivedState === 'review_ready' &&
    a.resolver.status === 'NONE' && a.allTargetSole && a.causalClosure
}
// Exact "already approved" chain: 1 revision, exactly [SUBMITTED, APPROVED],
// no forbidden/extra events, derived approved, resolver NONE.
function isApprovedChain (a) {
  return a.revisionCount === 1 && a.total === 2 && n(a.counts, 'SUBMITTED_FOR_REVIEW') === 1 &&
    n(a.counts, 'APPROVED') === 1 && a.forbiddenCount === 0 && a.derivedState === 'approved' &&
    a.resolver.status === 'NONE' && a.allTargetSole && a.causalClosure
}

function recordApproved (baseDir, revisionId, approvalRef, rationale) {
  return store.recordEvent(baseDir, PS_STORE, {
    recordId: PS_RECORD_ID,
    targetRevisionId: revisionId,
    eventType: APPROVAL_EVENT,
    actor: ACTOR,
    approval: { approvedBy: APPROVED_BY, decision: APPROVAL_DECISION, approvalSource: APPROVAL_SOURCE, reviewRef: approvalRef, rationale },
    rationale,
    expectedPreviousState: 'review_ready',
    timestampLabel: CREATED_AT_LABEL
  })
}

function verifyAfterApprove (baseDir, canonicalPayload, personaIdentity) {
  const a = analyzeChain(baseDir)
  if (!isApprovedChain(a)) return { ok: false, detail: 'approved-chain' }
  const events = store.listEvents(baseDir, PS_STORE, PS_RECORD_ID)
  const approvedEv = events.find((e) => e.eventType === 'APPROVED')
  if (!approvedEv.approval || approvedEv.approval.approvedBy !== APPROVED_BY || approvedEv.approval.decision !== APPROVAL_DECISION || approvedEv.approval.approvalSource !== APPROVAL_SOURCE) return { ok: false, detail: 'approval-record' }
  const rev = store.getRevision(baseDir, PS_STORE, PS_RECORD_ID, a.soleRevId)
  const id = provePayloadIdentity(rev, canonicalPayload, personaIdentity)
  if (!id.ok) return { ok: false, detail: 'identity:' + id.detail }
  const compat = shadow.verifyPersonalityShadow(baseDir, personaIdentity)
  const compatOk = compat.status === shadow.REASON.NO_ACTIVE_PERSONALITY && compat.subReason === 'APPROVED_NOT_ACTIVE' && shadow.exitCodeFor(compat.status) === 4
  if (!compatOk) return { ok: false, detail: 'm3c1-compat', compat: { status: compat.status, subReason: compat.subReason } }
  return { ok: true, revisionId: a.soleRevId, compat: { status: compat.status, subReason: compat.subReason, exitCode: 4 } }
}

function approvePersonality (baseDir, opts = {}) {
  const { personaIdentity, approvalRef, rationale, confirm, expectRevisionId } = opts
  const base = { recordId: PS_RECORD_ID }

  try { resolveSourceOfRecord(personaIdentity) } catch (e) { return { status: REASON.MAPPING_CONTRACT_ERROR, ...base } }
  let payload
  try { payload = shadow.buildPersonalityPayload(personaIdentity) } catch (e) { return { status: REASON.MAPPING_CONTRACT_ERROR, ...base } }

  let a
  try { a = analyzeChain(baseDir) } catch (e) { return { status: REASON.STORE_CORRUPT, ...base } }
  if (a.unreadable || a.corruptEvents.length > 0) return { status: REASON.STORE_CORRUPT, ...base }
  if (a.revisionCount > 1) return { status: REASON.MULTIPLE_REVISIONS, ...base }

  // active / later state wins over the already-approved branch (an active revision
  // also has an APPROVED event, but it is past the approval stage).
  if (n(a.counts, 'ACTIVATED') > 0 || a.resolver.status === 'ACTIVE' || ['active', 'deprecated', 'superseded', 'rejected'].includes(a.derivedState)) return { status: REASON.UNEXPECTED_LIFECYCLE_STATE, ...base, derivedState: a.derivedState }

  // already APPROVED (or any APPROVED present): require the EXACT approved chain.
  if (n(a.counts, 'APPROVED') > 0 || a.derivedState === 'approved') {
    if (!isApprovedChain(a)) return { status: REASON.CHAIN_PROOF_FAILED, ...base, detail: 'approved-chain-not-exact' }
    const id = provePayloadIdentity(store.getRevision(baseDir, PS_STORE, PS_RECORD_ID, a.soleRevId), payload, personaIdentity)
    if (!id.ok) return { status: REASON.APPROVED_PAYLOAD_MISMATCH, ...base, revisionId: a.soleRevId, detail: id.detail }
    return { status: REASON.ALREADY_APPROVED_MATCH, ...base, revisionId: a.soleRevId }
  }

  // must be the EXACT review_ready chain to proceed
  if (!isReviewReadyChain(a)) {
    if (a.revisionCount === 0 || a.derivedState === 'new') return { status: REASON.NOT_SUBMITTED, ...base, derivedState: a.derivedState }
    return { status: REASON.CHAIN_PROOF_FAILED, ...base, detail: 'review-ready-chain-not-exact', derivedState: a.derivedState }
  }

  // payload identity re-proof (never approve corrupted/contaminated content)
  const id = provePayloadIdentity(store.getRevision(baseDir, PS_STORE, PS_RECORD_ID, a.soleRevId), payload, personaIdentity)
  if (!id.ok) return { status: REASON.PAYLOAD_IDENTITY_FAILED, ...base, revisionId: a.soleRevId, detail: id.detail }

  // exact revision target guard
  if (expectRevisionId == null || expectRevisionId !== a.soleRevId) return { status: REASON.REVISION_TARGET_MISMATCH, ...base, revisionId: a.soleRevId }

  if (!confirm) return { status: REASON.DRY_RUN, ...base, plan: 'approve', revisionId: a.soleRevId }

  const vErr = validateWriteInputs(approvalRef, rationale)
  if (vErr) return { status: REASON.VALIDATION_ERROR, ...base, detail: vErr }
  try { recordApproved(baseDir, a.soleRevId, approvalRef, rationale) } catch (e) { return mapWriteError(e, base, a.soleRevId) }
  const after = verifyAfterApprove(baseDir, payload, personaIdentity)
  if (!after.ok) return { status: REASON.POST_APPROVE_STATE_UNEXPECTED, ...base, revisionId: a.soleRevId, detail: after.detail, compat: after.compat }
  return { status: REASON.APPROVED, ...base, revisionId: after.revisionId, compat: after.compat }
}

function validateWriteInputs (approvalRef, rationale) {
  if (typeof approvalRef !== 'string' || !approvalRef) return 'approval-ref-required'
  if (typeof rationale !== 'string' || !rationale) return 'rationale-required'
  return null
}
function mapWriteError (e, base, revisionId) {
  const code = (e instanceof MemoryError) ? e.code : null
  const status = code === 'READBACK_FAILED' ? REASON.READBACK_FAILED : REASON.WRITE_FAILED
  const out = { status, ...base, detail: code || 'write-error' }
  if (revisionId) out.revisionId = revisionId
  return out
}

module.exports = {
  PS_STORE, PS_RECORD_ID, APPROVAL_EVENT, EMITTED_EVENT_TYPES, REASON,
  ACTOR, APPROVED_BY, APPROVAL_SOURCE, APPROVAL_DECISION,
  resolveSourceOfRecord, analyzeChain, isReviewReadyChain, isApprovedChain, verifyAfterApprove, approvePersonality, exitCodeFor
}
