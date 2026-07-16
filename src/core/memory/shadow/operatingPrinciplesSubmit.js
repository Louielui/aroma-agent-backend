'use strict'

/**
 * operatingPrinciplesSubmit — M3b-2 submission tooling (governed, append-only).
 *
 * PROPOSED BOUNDARY (not an established repository mandate). This slice ONLY:
 *   build canonical payload -> create exactly ONE revision -> emit exactly ONE
 *   SUBMITTED_FOR_REVIEW event -> stop in derived state `review_ready`.
 *
 * It NEVER emits APPROVED / ACTIVATED / ADMITTED / SUPERSEDED / REJECTED /
 * DEPRECATED, never edits/deletes, never creates a second revision to recover a
 * partial first attempt, never rolls back, never silently repairs. Approval and
 * activation are separate future steps under separate Owner GOs.
 *
 * `--submission-ref` / `--rationale` are submission-authorization + audit
 * provenance ONLY — they create NO approval record and imply NO content approval.
 *
 * `sourceCommit` is derived EXCLUSIVELY from the verified M3a trust anchor
 * (behavioralMapping.SOURCE_COMMIT), never from operator input or branch HEAD.
 *
 * Read-only outside the two governed writes; SAFE metadata only (no fragment text).
 */

const fs = require('fs')
const path = require('path')
const { MemoryError } = require('../errors')
const { canonicalize } = require('../canonical')
const { verifyRevision } = require('../envelope')
const { revisionState } = require('../resolver')
const store = require('../store')
const B = require('./behavioralMapping')
const shadow = require('./operatingPrinciplesShadow')

const OP_STORE = shadow.OP_STORE
const OP_RECORD_ID = shadow.OP_RECORD_ID
const SUBMISSION_EVENT = 'SUBMITTED_FOR_REVIEW'
const EMITTED_EVENT_TYPES = Object.freeze([SUBMISSION_EVENT]) // the ONLY event type this tool may ever write
const CREATED_AT_LABEL = 'M3B2-SUBMIT'

const REASON = Object.freeze({
  // success (exit 0)
  DRY_RUN: 'DRY_RUN',
  SUBMITTED: 'SUBMITTED',
  RESUMED_SUBMITTED: 'RESUMED_SUBMITTED',
  ALREADY_SUBMITTED_MATCH: 'ALREADY_SUBMITTED_MATCH',
  // config / tool (exit 3)
  CONFIG_ERROR: 'CONFIG_ERROR',
  MAPPING_CONTRACT_ERROR: 'MAPPING_CONTRACT_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  // governance refusal / write failure (exit 2)
  RESUME_REQUIRED: 'RESUME_REQUIRED',
  RESUME_TARGET_MISMATCH: 'RESUME_TARGET_MISMATCH',
  PARTIAL_PAYLOAD_MISMATCH: 'PARTIAL_PAYLOAD_MISMATCH',
  SUBMITTED_PAYLOAD_MISMATCH: 'SUBMITTED_PAYLOAD_MISMATCH',
  UNEXPECTED_LIFECYCLE_STATE: 'UNEXPECTED_LIFECYCLE_STATE',
  MULTIPLE_REVISIONS: 'MULTIPLE_REVISIONS',
  STORE_CORRUPT: 'STORE_CORRUPT',
  WRITE_FAILED: 'WRITE_FAILED',
  READBACK_FAILED: 'READBACK_FAILED',
  POST_SUBMIT_STATE_UNEXPECTED: 'POST_SUBMIT_STATE_UNEXPECTED'
})

const SUCCESS = new Set([REASON.DRY_RUN, REASON.SUBMITTED, REASON.RESUMED_SUBMITTED, REASON.ALREADY_SUBMITTED_MATCH])
const TIER3 = new Set([REASON.CONFIG_ERROR, REASON.MAPPING_CONTRACT_ERROR, REASON.VALIDATION_ERROR])

function exitCodeFor (status) {
  if (SUCCESS.has(status)) return 0
  if (TIER3.has(status)) return 3
  return 2
}

// ---------------------------------------------------------------------------
// Resolve + pin the source-of-record from the verified M3a trust anchor.
// Throws MAPPING_CONTRACT_ERROR if the mapping does not verify against the live
// persona (this is what binds the commit to the exact source bytes).
// ---------------------------------------------------------------------------
function resolveSourceOfRecord (personaIdentity) {
  const v = B.verifyBehavioralMapping(personaIdentity, B.MAPPING)
  if (v.status !== 'PASS') throw new MemoryError('MAPPING_CONTRACT_ERROR', v.reason || 'mapping verification failed')
  return { sourceCommit: B.SOURCE_COMMIT, classificationApprovalRef: B.CLASSIFICATION_REF, behavioralSectionSha256: v.behavioralSectionSha256 }
}

// Independent payload-identity proof (NOT the active-only verifier). Returns
// { ok, detail }. Used before resume and after submission.
function provePayloadIdentity (rev, canonicalPayload, personaIdentity) {
  try { verifyRevision(rev) } catch (e) { return { ok: false, detail: 'envelope-integrity' } } // (1)
  if (shadow.validatePayloadSchema(rev.payload) !== null) return { ok: false, detail: 'schema' } // (2)
  if (shadow.computeAggregateSha256(rev.payload) !== rev.payload.aggregateSha256) return { ok: false, detail: 'aggregate' } // (3)
  if (canonicalize(rev.payload) !== canonicalize(canonicalPayload)) return { ok: false, detail: 'payload-canonical' } // (4)
  const v = B.verifyBehavioralMapping(personaIdentity, B.MAPPING) // (5)
  if (v.status !== 'PASS') return { ok: false, detail: 'mapping' }
  return { ok: true, detail: null }
}

// ---------------------------------------------------------------------------
// Read-only state classification, scoped to the OP record only.
//   S0 empty · S1 revision-only(new) · S2 review_ready · S3 later-state ·
//   S4 multiple revisions · S5 corrupt
// ---------------------------------------------------------------------------
function classifyState (baseDir) {
  const storeExists = fs.existsSync(path.join(baseDir, OP_STORE))
  let revs, recState, events
  try {
    revs = store.listRevisions(baseDir, OP_STORE, OP_RECORD_ID)
    recState = store.getRecordState(baseDir, OP_STORE, OP_RECORD_ID)
    events = store.listEvents(baseDir, OP_STORE, OP_RECORD_ID)
  } catch (e) {
    return { code: 'S5', storeExists, reason: REASON.STORE_CORRUPT }
  }
  if (revs.some((r) => r.__unreadable) || recState.corruptEvents.length > 0) return { code: 'S5', storeExists, reason: REASON.STORE_CORRUPT }
  if (revs.length === 0) return { code: 'S0', storeExists, revs, events }
  if (revs.length > 1) return { code: 'S4', storeExists, revs, events, reason: REASON.MULTIPLE_REVISIONS }
  const rev = revs[0]
  const st = revisionState(OP_STORE, rev.revisionId, events).state
  if (st === 'new' && events.length === 0) return { code: 'S1', storeExists, rev, events, derivedState: st }
  if (st === 'review_ready' && events.length === 1 && events[0].eventType === SUBMISSION_EVENT) return { code: 'S2', storeExists, rev, events, derivedState: st }
  return { code: 'S3', storeExists, rev, events, derivedState: st, reason: REASON.UNEXPECTED_LIFECYCLE_STATE }
}

// ---------------------------------------------------------------------------
// Write helpers — the ONLY two governed writes this tool performs.
// ---------------------------------------------------------------------------
function createOpRevision (baseDir, canonicalPayload, prov) {
  return store.createRevision(baseDir, OP_STORE, {
    recordId: OP_RECORD_ID,
    supersedes: null,
    selectors: { category: OP_STORE, tags: [OP_STORE], links: [], project: 'aroma-core' },
    provenance: {
      source: 'operating-principles-submission',
      author: 'Louie',
      evidence: [prov.sourceCommit, `mapping:${prov.classificationApprovalRef}`, `submissionRef:${prov.submissionRef}`],
      derivedFrom: 'PERSONA_IDENTITY',
      notes: prov.rationale
    },
    payload: canonicalPayload,
    createdAtLabel: CREATED_AT_LABEL
  })
}
function recordSubmitted (baseDir, revisionId, rationale) {
  // expectedPreviousState 'new' — the ONLY transition this tool writes.
  return store.recordEvent(baseDir, OP_STORE, {
    recordId: OP_RECORD_ID,
    targetRevisionId: revisionId,
    eventType: SUBMISSION_EVENT,
    actor: 'submitter',
    approval: null, // submission carries NO approval record
    rationale,
    expectedPreviousState: 'new',
    timestampLabel: CREATED_AT_LABEL
  })
}

// Post-submit independent verification (checks 6-9 + identity) + M3b-1 compat.
function verifyAfterSubmit (baseDir, canonicalPayload, personaIdentity) {
  const revs = store.listRevisions(baseDir, OP_STORE, OP_RECORD_ID)
  if (revs.length !== 1 || revs[0].__unreadable) return { ok: false, detail: 'revision-count' } // (6)
  const events = store.listEvents(baseDir, OP_STORE, OP_RECORD_ID)
  if (events.length !== 1 || events[0].eventType !== SUBMISSION_EVENT) return { ok: false, detail: 'event-set' } // (8)(9)
  const st = revisionState(OP_STORE, revs[0].revisionId, events).state
  if (st !== 'review_ready') return { ok: false, detail: 'derived-state' } // (7)
  const id = provePayloadIdentity(revs[0], canonicalPayload, personaIdentity) // (1-5)
  if (!id.ok) return { ok: false, detail: 'identity:' + id.detail }
  // M3b-1 compatibility: an intentionally NOT-active submission must read as
  // NOT_READY / NO_ACTIVE_OPERATING_PRINCIPLES / NO_ACTIVE_REVISION / exit 4.
  const compat = shadow.verifyOperatingPrinciplesShadow(baseDir, personaIdentity)
  const compatOk = compat.status === shadow.REASON.NO_ACTIVE_OPERATING_PRINCIPLES && compat.subReason === 'NO_ACTIVE_REVISION' && shadow.exitCodeFor(compat.status) === 4
  if (!compatOk) return { ok: false, detail: 'm3b1-compat', compat: { status: compat.status, subReason: compat.subReason } }
  return { ok: true, revisionId: revs[0].revisionId, compat: { status: compat.status, subReason: compat.subReason, exitCode: 4 } }
}

// ---------------------------------------------------------------------------
// Main entry. opts: { personaIdentity, submissionRef, rationale, confirm,
//                     resumeRevisionId, expectSourceCommit }
// Returns SAFE metadata { status, ... }. exitCodeFor(status) gives the process code.
// ---------------------------------------------------------------------------
function submitOperatingPrinciples (baseDir, opts = {}) {
  const { personaIdentity, submissionRef, rationale, confirm, resumeRevisionId, expectSourceCommit } = opts
  const base = { recordId: OP_RECORD_ID }

  // trust anchor + source-of-record
  let sor
  try { sor = resolveSourceOfRecord(personaIdentity) } catch (e) { return { status: REASON.MAPPING_CONTRACT_ERROR, ...base } }
  if (expectSourceCommit != null && expectSourceCommit !== sor.sourceCommit) return { status: REASON.VALIDATION_ERROR, ...base, detail: 'expect-source-commit-mismatch' }

  // canonical payload (pure; no writes)
  let payload
  try { payload = shadow.buildOperatingPrinciplesPayload(personaIdentity) } catch (e) { return { status: REASON.MAPPING_CONTRACT_ERROR, ...base } }

  const state = classifyState(baseDir)

  // refusals that ignore confirm/resume (corruption / multi / later-state)
  if (state.code === 'S5') return { status: REASON.STORE_CORRUPT, ...base }
  if (state.code === 'S4') return { status: REASON.MULTIPLE_REVISIONS, ...base }
  if (state.code === 'S3') return { status: REASON.UNEXPECTED_LIFECYCLE_STATE, ...base, derivedState: state.derivedState }

  // S2: already submitted — idempotent success or mismatch
  if (state.code === 'S2') {
    const id = provePayloadIdentity(state.rev, payload, personaIdentity)
    if (!id.ok) return { status: REASON.SUBMITTED_PAYLOAD_MISMATCH, ...base, revisionId: state.rev.revisionId, detail: id.detail }
    return { status: REASON.ALREADY_SUBMITTED_MATCH, ...base, revisionId: state.rev.revisionId }
  }

  // S1: revision-only (new). Prove identity, then require exact resume acknowledgement.
  if (state.code === 'S1') {
    const id = provePayloadIdentity(state.rev, payload, personaIdentity)
    if (!id.ok) return { status: REASON.PARTIAL_PAYLOAD_MISMATCH, ...base, revisionId: state.rev.revisionId, detail: id.detail }
    if (resumeRevisionId == null) return { status: REASON.RESUME_REQUIRED, ...base, revisionId: state.rev.revisionId }
    if (resumeRevisionId !== state.rev.revisionId) return { status: REASON.RESUME_TARGET_MISMATCH, ...base, revisionId: state.rev.revisionId }
    // exact resume acknowledged -> this is a write path
    if (!confirm) return { status: REASON.DRY_RUN, ...base, plan: 'resume-submit', revisionId: state.rev.revisionId }
    const vErr = validateWriteInputs(submissionRef, rationale)
    if (vErr) return { status: REASON.VALIDATION_ERROR, ...base, detail: vErr }
    try { recordSubmitted(baseDir, state.rev.revisionId, rationale) } catch (e) { return mapWriteError(e, base) }
    const after = verifyAfterSubmit(baseDir, payload, personaIdentity)
    if (!after.ok) return { status: REASON.POST_SUBMIT_STATE_UNEXPECTED, ...base, detail: after.detail, compat: after.compat }
    return { status: REASON.RESUMED_SUBMITTED, ...base, revisionId: after.revisionId, compat: after.compat }
  }

  // S0: fresh submission. --resume points at nothing -> refuse.
  if (resumeRevisionId != null) return { status: REASON.RESUME_TARGET_MISMATCH, ...base, detail: 'no-existing-revision' }
  if (!confirm) return { status: REASON.DRY_RUN, ...base, plan: 'create-and-submit', sourceCommit: sor.sourceCommit }
  const vErr = validateWriteInputs(submissionRef, rationale)
  if (vErr) return { status: REASON.VALIDATION_ERROR, ...base, detail: vErr }
  let rev
  try { rev = createOpRevision(baseDir, payload, { sourceCommit: sor.sourceCommit, classificationApprovalRef: sor.classificationApprovalRef, submissionRef, rationale }) } catch (e) { return mapWriteError(e, base) }
  try { recordSubmitted(baseDir, rev.revisionId, rationale) } catch (e) { return mapWriteError(e, base, rev.revisionId) }
  const after = verifyAfterSubmit(baseDir, payload, personaIdentity)
  if (!after.ok) return { status: REASON.POST_SUBMIT_STATE_UNEXPECTED, ...base, revisionId: rev.revisionId, detail: after.detail, compat: after.compat }
  return { status: REASON.SUBMITTED, ...base, revisionId: after.revisionId, compat: after.compat }
}

function validateWriteInputs (submissionRef, rationale) {
  if (typeof submissionRef !== 'string' || !submissionRef) return 'submission-ref-required'
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
  OP_STORE, OP_RECORD_ID, SUBMISSION_EVENT, EMITTED_EVENT_TYPES, REASON,
  resolveSourceOfRecord, provePayloadIdentity, classifyState, verifyAfterSubmit,
  submitOperatingPrinciples, exitCodeFor
}
