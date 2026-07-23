'use strict'

/**
 * operatingPrinciplesApprove — M3b-3 approval tooling (governed, append-only).
 *
 * Consumes an explicit out-of-band Owner approval GO and records it as ONE
 * `APPROVED` lifecycle event on the single `review_ready` operating-principles
 * revision, advancing the derived state to `approved` — and STOPPING there. It
 * NEVER activates (no ACTIVATED/ADMITTED), never creates/rejects/supersedes/
 * deprecates a revision, never emits a second APPROVED, never rolls back.
 *
 * The recorded approval object is AUDIT evidence of the Owner GO, not proof that
 * running the CLI constitutes approval. `--approval-ref` is the GO reference;
 * `approvedBy`/`approvalSource`/`decision` are FIXED (not caller-supplied):
 *   approvedBy="Louie", approvalSource="owner-authorized-approval", decision="approved".
 *
 * Before approving, the target revision's payload is independently RE-PROVEN
 * against the M3a-derived canonical truth (reusing the M3b-2 prover) so corrupted/
 * contaminated content can never be approved.
 *
 * `sourceCommit` truth is the verified M3a anchor; `--expect-source-commit` is an
 * optional equality guard only. `--expect-revision-id` is REQUIRED for --confirm so
 * approval always names the exact revision. There is no `--resume`: APPROVED is a
 * single atomic event append (either present or not).
 *
 * Read-only outside the ONE governed APPROVED write; SAFE metadata only.
 */

const fs = require('fs')
const path = require('path')
const { MemoryError } = require('../errors')
const { revisionState } = require('../resolver')
const store = require('../store')
const B = require('./behavioralMapping')
const shadow = require('./operatingPrinciplesShadow')
const { provePayloadIdentity } = require('./operatingPrinciplesSubmit')

const OP_STORE = shadow.OP_STORE
const OP_RECORD_ID = shadow.OP_RECORD_ID
const APPROVAL_EVENT = 'APPROVED'
const EMITTED_EVENT_TYPES = Object.freeze([APPROVAL_EVENT]) // the ONLY event type this tool may ever write
const CREATED_AT_LABEL = 'M3B3-APPROVE'

// FIXED approval identity (A3) — never caller-supplied.
const APPROVED_BY = 'Louie'
const APPROVAL_SOURCE = 'owner-authorized-approval'
const APPROVAL_DECISION = 'approved'

const REASON = Object.freeze({
  // success (exit 0)
  DRY_RUN: 'DRY_RUN',
  APPROVED: 'APPROVED',
  ALREADY_APPROVED_MATCH: 'ALREADY_APPROVED_MATCH',
  // config / tool (exit 3)
  CONFIG_ERROR: 'CONFIG_ERROR',
  MAPPING_CONTRACT_ERROR: 'MAPPING_CONTRACT_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  // governance refusal / write failure (exit 2)
  STORE_CORRUPT: 'STORE_CORRUPT',
  MULTIPLE_REVISIONS: 'MULTIPLE_REVISIONS',
  UNEXPECTED_LIFECYCLE_STATE: 'UNEXPECTED_LIFECYCLE_STATE',
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  REVISION_TARGET_MISMATCH: 'REVISION_TARGET_MISMATCH',
  PAYLOAD_IDENTITY_FAILED: 'PAYLOAD_IDENTITY_FAILED',
  APPROVED_PAYLOAD_MISMATCH: 'APPROVED_PAYLOAD_MISMATCH',
  WRITE_FAILED: 'WRITE_FAILED',
  READBACK_FAILED: 'READBACK_FAILED',
  POST_APPROVE_STATE_UNEXPECTED: 'POST_APPROVE_STATE_UNEXPECTED'
})

const SUCCESS = new Set([REASON.DRY_RUN, REASON.APPROVED, REASON.ALREADY_APPROVED_MATCH])
const TIER3 = new Set([REASON.CONFIG_ERROR, REASON.MAPPING_CONTRACT_ERROR, REASON.VALIDATION_ERROR])
function exitCodeFor (status) { if (SUCCESS.has(status)) return 0; if (TIER3.has(status)) return 3; return 2 }

// Resolve + pin the source-of-record from the verified M3a trust anchor.
function resolveSourceOfRecord (personaIdentity) {
  const v = B.verifyBehavioralMapping(personaIdentity, B.MAPPING)
  if (v.status !== 'PASS') throw new MemoryError('MAPPING_CONTRACT_ERROR', v.reason || 'mapping verification failed')
  return { sourceCommit: B.SOURCE_COMMIT }
}

// Read-only state classification, scoped to the OP record only.
//   corrupt · multiRev · none(no revision) · new · review_ready · approved · later
function classifyState (baseDir) {
  const storeExists = fs.existsSync(path.join(baseDir, OP_STORE))
  let revs, recState, events
  try {
    revs = store.listRevisions(baseDir, OP_STORE, OP_RECORD_ID)
    recState = store.getRecordState(baseDir, OP_STORE, OP_RECORD_ID)
    events = store.listEvents(baseDir, OP_STORE, OP_RECORD_ID)
  } catch (e) { return { code: 'CORRUPT' } }
  if (revs.some((r) => r.__unreadable) || recState.corruptEvents.length > 0) return { code: 'CORRUPT' }
  if (!storeExists || revs.length === 0) return { code: 'NONE' }
  if (revs.length > 1) return { code: 'MULTI' }
  const rev = revs[0]
  const st = revisionState(OP_STORE, rev.revisionId, events).state
  if (st === 'new') return { code: 'NEW', rev, events }
  if (st === 'review_ready') return { code: 'REVIEW_READY', rev, events }
  if (st === 'approved') return { code: 'APPROVED', rev, events }
  return { code: 'LATER', rev, events, derivedState: st }
}

// The ONLY governed write this tool performs.
function recordApproved (baseDir, revisionId, approvalRef, rationale) {
  return store.recordEvent(baseDir, OP_STORE, {
    recordId: OP_RECORD_ID,
    targetRevisionId: revisionId,
    eventType: APPROVAL_EVENT,
    actor: 'approver',
    approval: { approvedBy: APPROVED_BY, decision: APPROVAL_DECISION, approvalSource: APPROVAL_SOURCE, reviewRef: approvalRef, rationale },
    rationale,
    expectedPreviousState: 'review_ready',
    timestampLabel: CREATED_AT_LABEL
  })
}

// Post-approve independent verification + M3b-1 compat.
function verifyAfterApprove (baseDir, canonicalPayload, personaIdentity) {
  const revs = store.listRevisions(baseDir, OP_STORE, OP_RECORD_ID)
  if (revs.length !== 1 || revs[0].__unreadable) return { ok: false, detail: 'revision-count' }
  const events = store.listEvents(baseDir, OP_STORE, OP_RECORD_ID)
  if (events.length !== 2) return { ok: false, detail: 'event-count' }
  const types = events.map((e) => e.eventType)
  if (!(types.includes('SUBMITTED_FOR_REVIEW') && types.includes('APPROVED'))) return { ok: false, detail: 'event-set' }
  if (types.includes('ACTIVATED') || types.includes('ADMITTED')) return { ok: false, detail: 'activation-present' }
  const approvedEv = events.find((e) => e.eventType === 'APPROVED')
  if (!approvedEv.approval || approvedEv.approval.approvedBy !== APPROVED_BY || approvedEv.approval.decision !== APPROVAL_DECISION || approvedEv.approval.approvalSource !== APPROVAL_SOURCE) return { ok: false, detail: 'approval-record' }
  const st = revisionState(OP_STORE, revs[0].revisionId, events).state
  if (st !== 'approved') return { ok: false, detail: 'derived-state' }
  if (store.resolveActiveRecord(baseDir, OP_STORE, OP_RECORD_ID).status !== 'NONE') return { ok: false, detail: 'unexpected-active' }
  const rev = store.getRevision(baseDir, OP_STORE, OP_RECORD_ID, revs[0].revisionId)
  const id = provePayloadIdentity(rev, canonicalPayload, personaIdentity)
  if (!id.ok) return { ok: false, detail: 'identity:' + id.detail }
  const compat = shadow.verifyOperatingPrinciplesShadow(baseDir, personaIdentity)
  const compatOk = compat.status === shadow.REASON.NO_ACTIVE_OPERATING_PRINCIPLES && compat.subReason === 'APPROVED_NOT_ACTIVE' && shadow.exitCodeFor(compat.status) === 4
  if (!compatOk) return { ok: false, detail: 'm3b1-compat', compat: { status: compat.status, subReason: compat.subReason } }
  return { ok: true, revisionId: revs[0].revisionId, compat: { status: compat.status, subReason: compat.subReason, exitCode: 4 } }
}

/**
 * Main entry. opts: { personaIdentity, approvalRef, rationale, confirm,
 *                     expectRevisionId, expectSourceCommit }
 */
function approveOperatingPrinciples (baseDir, opts = {}) {
  const { personaIdentity, approvalRef, rationale, confirm, expectRevisionId, expectSourceCommit } = opts
  const base = { recordId: OP_RECORD_ID }

  // trust anchor + source-of-record
  let sor
  try { sor = resolveSourceOfRecord(personaIdentity) } catch (e) { return { status: REASON.MAPPING_CONTRACT_ERROR, ...base } }
  if (expectSourceCommit != null && expectSourceCommit !== sor.sourceCommit) return { status: REASON.VALIDATION_ERROR, ...base, detail: 'expect-source-commit-mismatch' }

  // canonical payload (pure; no writes)
  let payload
  try { payload = shadow.buildOperatingPrinciplesPayload(personaIdentity) } catch (e) { return { status: REASON.MAPPING_CONTRACT_ERROR, ...base } }

  const state = classifyState(baseDir)
  if (state.code === 'CORRUPT') return { status: REASON.STORE_CORRUPT, ...base }
  if (state.code === 'MULTI') return { status: REASON.MULTIPLE_REVISIONS, ...base }
  if (state.code === 'NONE') return { status: REASON.NOT_SUBMITTED, ...base, detail: 'no-revision' }
  if (state.code === 'NEW') return { status: REASON.NOT_SUBMITTED, ...base, revisionId: state.rev.revisionId, detail: 'new-not-submitted' }
  if (state.code === 'LATER') return { status: REASON.UNEXPECTED_LIFECYCLE_STATE, ...base, revisionId: state.rev.revisionId, derivedState: state.derivedState }

  // APPROVED already -> idempotent success or mismatch
  if (state.code === 'APPROVED') {
    const id = provePayloadIdentity(state.rev, payload, personaIdentity)
    if (!id.ok) return { status: REASON.APPROVED_PAYLOAD_MISMATCH, ...base, revisionId: state.rev.revisionId, detail: id.detail }
    return { status: REASON.ALREADY_APPROVED_MATCH, ...base, revisionId: state.rev.revisionId }
  }

  // REVIEW_READY -> the approve path
  const id = provePayloadIdentity(state.rev, payload, personaIdentity)
  if (!id.ok) return { status: REASON.PAYLOAD_IDENTITY_FAILED, ...base, revisionId: state.rev.revisionId, detail: id.detail }
  if (expectRevisionId == null) return { status: REASON.REVISION_TARGET_MISMATCH, ...base, revisionId: state.rev.revisionId, detail: 'expect-revision-id-required' }
  if (expectRevisionId !== state.rev.revisionId) return { status: REASON.REVISION_TARGET_MISMATCH, ...base, revisionId: state.rev.revisionId, detail: 'expect-revision-id-mismatch' }
  if (!confirm) return { status: REASON.DRY_RUN, ...base, plan: 'approve', revisionId: state.rev.revisionId, sourceCommit: sor.sourceCommit }

  const vErr = validateWriteInputs(approvalRef, rationale)
  if (vErr) return { status: REASON.VALIDATION_ERROR, ...base, detail: vErr }
  try { recordApproved(baseDir, state.rev.revisionId, approvalRef, rationale) } catch (e) { return mapWriteError(e, base, state.rev.revisionId) }
  const after = verifyAfterApprove(baseDir, payload, personaIdentity)
  if (!after.ok) return { status: REASON.POST_APPROVE_STATE_UNEXPECTED, ...base, revisionId: state.rev.revisionId, detail: after.detail, compat: after.compat }
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
  OP_STORE, OP_RECORD_ID, APPROVAL_EVENT, EMITTED_EVENT_TYPES, REASON,
  APPROVED_BY, APPROVAL_SOURCE, APPROVAL_DECISION,
  resolveSourceOfRecord, classifyState, verifyAfterApprove, approveOperatingPrinciples, exitCodeFor
}
