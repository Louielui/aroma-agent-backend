'use strict'

/**
 * personalitySubmit — M3c-2 submission tooling for the Personality domain
 * (governed, append-only).
 *
 * ONLY: build the canonical single-fragment personality payload -> create exactly
 * ONE revision -> emit exactly ONE SUBMITTED_FOR_REVIEW event -> stop in derived
 * state `review_ready`. It NEVER emits APPROVED/ACTIVATED/ADMITTED/SUPERSEDED/
 * REJECTED/DEPRECATED, never edits/deletes, never creates a second revision to
 * recover a partial attempt, never rolls back, never silently repairs.
 *
 * `--submission-ref` / `--rationale` are provenance/audit ONLY (no approval).
 * `sourceCommit` is derived EXCLUSIVELY from the verified M3a anchor.
 *
 * Exports `provePayloadIdentity` — a PURE read-only prover reused by the future
 * M3c-G Guardian personality integration (no writes, no index rebuild, no lifecycle).
 */

const fs = require('fs')
const path = require('path')
const { MemoryError } = require('../errors')
const { canonicalize } = require('../canonical')
const { verifyRevision } = require('../envelope')
const { revisionState } = require('../resolver')
const { authorityDomain } = require('../lifecycle')
const store = require('../store')
const B = require('./behavioralMapping')
const shadow = require('./personalityShadow')

const PS_STORE = shadow.PERSONALITY_STORE
const PS_RECORD_ID = shadow.PERSONALITY_RECORD_ID
const SUBMISSION_EVENT = 'SUBMITTED_FOR_REVIEW'
const EMITTED_EVENT_TYPES = Object.freeze([SUBMISSION_EVENT]) // the ONLY event type this tool may ever write
const CREATED_AT_LABEL = 'M3C2-SUBMIT'

const REASON = Object.freeze({
  DRY_RUN: 'DRY_RUN',
  SUBMITTED: 'SUBMITTED',
  RESUMED_SUBMITTED: 'RESUMED_SUBMITTED',
  ALREADY_SUBMITTED_MATCH: 'ALREADY_SUBMITTED_MATCH',
  CONFIG_ERROR: 'CONFIG_ERROR',
  MAPPING_CONTRACT_ERROR: 'MAPPING_CONTRACT_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RESUME_REQUIRED: 'RESUME_REQUIRED',
  RESUME_TARGET_MISMATCH: 'RESUME_TARGET_MISMATCH',
  PARTIAL_PAYLOAD_MISMATCH: 'PARTIAL_PAYLOAD_MISMATCH',
  SUBMITTED_PAYLOAD_MISMATCH: 'SUBMITTED_PAYLOAD_MISMATCH',
  UNEXPECTED_LIFECYCLE_STATE: 'UNEXPECTED_LIFECYCLE_STATE',
  MULTIPLE_REVISIONS: 'MULTIPLE_REVISIONS',
  PERSONALITY_STORE_CORRUPT: 'PERSONALITY_STORE_CORRUPT',
  WRITE_FAILED: 'WRITE_FAILED',
  READBACK_FAILED: 'READBACK_FAILED',
  POST_SUBMIT_STATE_UNEXPECTED: 'POST_SUBMIT_STATE_UNEXPECTED'
})

const SUCCESS = new Set([REASON.DRY_RUN, REASON.SUBMITTED, REASON.RESUMED_SUBMITTED, REASON.ALREADY_SUBMITTED_MATCH])
const TIER3 = new Set([REASON.CONFIG_ERROR, REASON.MAPPING_CONTRACT_ERROR, REASON.VALIDATION_ERROR])
function exitCodeFor (status) { if (SUCCESS.has(status)) return 0; if (TIER3.has(status)) return 3; return 2 }

function resolveSourceOfRecord (personaIdentity) {
  const v = B.verifyBehavioralMapping(personaIdentity, B.MAPPING)
  if (v.status !== 'PASS') throw new MemoryError('MAPPING_CONTRACT_ERROR', v.reason || 'mapping verification failed')
  return { sourceCommit: B.SOURCE_COMMIT }
}

/**
 * PURE read-only payload-identity prover (reused by M3c-G). Proves the given
 * revision is genuinely the exact classified personality content. NO writes, NO
 * index rebuild, NO lifecycle transition. Returns { ok, detail }.
 *
 * Checks: envelope integrity, recordId, M1 authorityDomain === "behavior", closed
 * root schema, root provenance, fragmentCount === 1, exact seq-2/range/hash/
 * classification/text, no OP contamination, aggregate hash, canonical equality vs a
 * freshly rebuilt M3a-derived payload, personality slice reconstitution, mapping PASS.
 */
function provePayloadIdentity (rev, canonicalPayload, personaIdentity) {
  if (!rev || rev.recordId !== PS_RECORD_ID) return { ok: false, detail: 'recordId' }
  try { verifyRevision(rev) } catch (e) { return { ok: false, detail: 'envelope-integrity' } }
  if (rev.authorityDomain !== authorityDomain(PS_STORE)) return { ok: false, detail: 'authority-domain' }
  if (shadow.validatePayloadSchema(rev.payload) !== null) return { ok: false, detail: 'schema' }
  // cross-validate against the M3a anchor via the shadow verifier's own geometry
  const anchor = shadow.resolveAnchor(personaIdentity) // throws MAPPING_CONTRACT_ERROR if mapping bad
  const p = rev.payload
  const f = p.fragments[0]
  if (p.sourceCommit !== anchor.sourceCommit || p.sourceSymbol !== B.SOURCE_SYMBOL || p.classificationApprovalRef !== anchor.classificationApprovalRef || p.behavioralSectionSha256 !== anchor.behavioralSectionSha256) return { ok: false, detail: 'root-provenance' }
  if (p.fragmentCount !== 1 || p.fragments.length !== 1) return { ok: false, detail: 'fragment-count' }
  // OP contamination
  if (shadow.OP_SEQUENCES.includes(f.sourceSequence)) return { ok: false, detail: 'op-sequence' }
  if (anchor.opRanges.some((r) => f.sourceStartCodeUnit < r.end && f.sourceEndCodeUnit > r.start)) return { ok: false, detail: 'op-range' }
  if (f.sourceStartCodeUnit < anchor.section.start || f.sourceEndCodeUnit > anchor.section.end) return { ok: false, detail: 'non-behavioral' }
  const exp = anchor.personality
  if (f.sourceSequence !== exp.sequence || f.sourceStartCodeUnit !== exp.startCodeUnit || f.sourceEndCodeUnit !== exp.endCodeUnit) return { ok: false, detail: 'range' }
  if (f.sourceSha256Utf8 !== exp.sha256Utf8) return { ok: false, detail: 'source-hash' }
  if (f.fragmentClassificationRef !== exp.classificationRef) return { ok: false, detail: 'classification' }
  const legacyText = personaIdentity.slice(f.sourceStartCodeUnit, f.sourceEndCodeUnit)
  if (f.text !== legacyText) return { ok: false, detail: 'text' }
  if (B.sha256Utf8(f.text) !== f.sourceSha256Utf8) return { ok: false, detail: 'text-hash' }
  if (shadow.computeAggregateSha256(rev.payload) !== rev.payload.aggregateSha256) return { ok: false, detail: 'aggregate' }
  if (canonicalize(rev.payload) !== canonicalize(canonicalPayload)) return { ok: false, detail: 'payload-canonical' }
  // personality slice reconstitution
  if ((personaIdentity.slice(0, f.sourceStartCodeUnit) + f.text + personaIdentity.slice(f.sourceEndCodeUnit)) !== personaIdentity) return { ok: false, detail: 'reconstitution' }
  return { ok: true, detail: null }
}

// Read-only state classification, scoped to the personality record only.
function classifyState (baseDir) {
  const storeExists = fs.existsSync(path.join(baseDir, PS_STORE))
  let revs, recState, events
  try {
    revs = store.listRevisions(baseDir, PS_STORE, PS_RECORD_ID)
    recState = store.getRecordState(baseDir, PS_STORE, PS_RECORD_ID)
    events = store.listEvents(baseDir, PS_STORE, PS_RECORD_ID)
  } catch (e) { return { code: 'S5', reason: REASON.PERSONALITY_STORE_CORRUPT } }
  if (revs.some((r) => r.__unreadable) || recState.corruptEvents.length > 0) return { code: 'S5', reason: REASON.PERSONALITY_STORE_CORRUPT }
  if (!storeExists || revs.length === 0) return { code: 'S0', revs, events }
  if (revs.length > 1) return { code: 'S4', reason: REASON.MULTIPLE_REVISIONS }
  const rev = revs[0]
  // dangling / mis-targeted events under this record fail closed
  if (events.some((e) => e.targetRevisionId !== rev.revisionId)) return { code: 'S5', reason: REASON.PERSONALITY_STORE_CORRUPT }
  const st = revisionState(PS_STORE, rev.revisionId, events).state
  if (st === 'new' && events.length === 0) return { code: 'S1', rev, events }
  if (st === 'review_ready' && events.length === 1 && events[0].eventType === SUBMISSION_EVENT) return { code: 'S2', rev, events }
  return { code: 'S3', rev, events, derivedState: st }
}

function createPersonalityRevision (baseDir, canonicalPayload, prov) {
  return store.createRevision(baseDir, PS_STORE, {
    recordId: PS_RECORD_ID,
    supersedes: null,
    selectors: { category: PS_STORE, tags: [PS_STORE], links: [], project: 'aroma-core' },
    provenance: { source: 'personality-submission', author: 'Louie', evidence: [prov.sourceCommit, `mapping:${prov.classificationApprovalRef}`, `submissionRef:${prov.submissionRef}`], derivedFrom: 'PERSONA_IDENTITY', notes: prov.rationale },
    payload: canonicalPayload,
    createdAtLabel: CREATED_AT_LABEL
  })
}
function recordSubmitted (baseDir, revisionId, rationale) {
  return store.recordEvent(baseDir, PS_STORE, { recordId: PS_RECORD_ID, targetRevisionId: revisionId, eventType: SUBMISSION_EVENT, actor: 'submitter', approval: null, rationale, expectedPreviousState: 'new', timestampLabel: CREATED_AT_LABEL })
}

function verifyAfterSubmit (baseDir, canonicalPayload, personaIdentity) {
  const revs = store.listRevisions(baseDir, PS_STORE, PS_RECORD_ID)
  if (revs.length !== 1 || revs[0].__unreadable) return { ok: false, detail: 'revision-count' }
  const events = store.listEvents(baseDir, PS_STORE, PS_RECORD_ID)
  if (events.length !== 1 || events[0].eventType !== SUBMISSION_EVENT) return { ok: false, detail: 'event-set' }
  const st = revisionState(PS_STORE, revs[0].revisionId, events).state
  if (st !== 'review_ready') return { ok: false, detail: 'derived-state' }
  const id = provePayloadIdentity(revs[0], canonicalPayload, personaIdentity)
  if (!id.ok) return { ok: false, detail: 'identity:' + id.detail }
  const compat = shadow.verifyPersonalityShadow(baseDir, personaIdentity)
  const compatOk = compat.status === shadow.REASON.NO_ACTIVE_PERSONALITY && compat.subReason === 'NO_ACTIVE_REVISION' && shadow.exitCodeFor(compat.status) === 4
  if (!compatOk) return { ok: false, detail: 'm3c1-compat', compat: { status: compat.status, subReason: compat.subReason } }
  return { ok: true, revisionId: revs[0].revisionId, compat: { status: compat.status, subReason: compat.subReason, exitCode: 4 } }
}

function submitPersonality (baseDir, opts = {}) {
  const { personaIdentity, submissionRef, rationale, confirm, resumeRevisionId, expectSourceCommit } = opts
  const base = { recordId: PS_RECORD_ID }

  let sor
  try { sor = resolveSourceOfRecord(personaIdentity) } catch (e) { return { status: REASON.MAPPING_CONTRACT_ERROR, ...base } }
  if (expectSourceCommit != null && expectSourceCommit !== sor.sourceCommit) return { status: REASON.VALIDATION_ERROR, ...base, detail: 'expect-source-commit-mismatch' }

  let payload
  try { payload = shadow.buildPersonalityPayload(personaIdentity) } catch (e) { return { status: REASON.MAPPING_CONTRACT_ERROR, ...base } }

  const state = classifyState(baseDir)
  if (state.code === 'S5') return { status: REASON.PERSONALITY_STORE_CORRUPT, ...base }
  if (state.code === 'S4') return { status: REASON.MULTIPLE_REVISIONS, ...base }
  if (state.code === 'S3') return { status: REASON.UNEXPECTED_LIFECYCLE_STATE, ...base, derivedState: state.derivedState }

  if (state.code === 'S2') {
    const id = provePayloadIdentity(state.rev, payload, personaIdentity)
    if (!id.ok) return { status: REASON.SUBMITTED_PAYLOAD_MISMATCH, ...base, revisionId: state.rev.revisionId, detail: id.detail }
    return { status: REASON.ALREADY_SUBMITTED_MATCH, ...base, revisionId: state.rev.revisionId }
  }

  if (state.code === 'S1') {
    const id = provePayloadIdentity(state.rev, payload, personaIdentity)
    if (!id.ok) return { status: REASON.PARTIAL_PAYLOAD_MISMATCH, ...base, revisionId: state.rev.revisionId, detail: id.detail }
    if (resumeRevisionId == null) return { status: REASON.RESUME_REQUIRED, ...base, revisionId: state.rev.revisionId }
    if (resumeRevisionId !== state.rev.revisionId) return { status: REASON.RESUME_TARGET_MISMATCH, ...base, revisionId: state.rev.revisionId }
    if (!confirm) return { status: REASON.DRY_RUN, ...base, plan: 'resume-submit', revisionId: state.rev.revisionId }
    const vErr = validateWriteInputs(submissionRef, rationale, expectSourceCommit, sor.sourceCommit)
    if (vErr) return { status: REASON.VALIDATION_ERROR, ...base, detail: vErr }
    try { recordSubmitted(baseDir, state.rev.revisionId, rationale) } catch (e) { return mapWriteError(e, base) }
    const after = verifyAfterSubmit(baseDir, payload, personaIdentity)
    if (!after.ok) return { status: REASON.POST_SUBMIT_STATE_UNEXPECTED, ...base, detail: after.detail, compat: after.compat }
    return { status: REASON.RESUMED_SUBMITTED, ...base, revisionId: after.revisionId, compat: after.compat }
  }

  // S0
  if (resumeRevisionId != null) return { status: REASON.RESUME_TARGET_MISMATCH, ...base, detail: 'no-existing-revision' }
  if (!confirm) return { status: REASON.DRY_RUN, ...base, plan: 'create-and-submit', sourceCommit: sor.sourceCommit }
  const vErr = validateWriteInputs(submissionRef, rationale, expectSourceCommit, sor.sourceCommit)
  if (vErr) return { status: REASON.VALIDATION_ERROR, ...base, detail: vErr }
  let rev
  try { rev = createPersonalityRevision(baseDir, payload, { sourceCommit: sor.sourceCommit, classificationApprovalRef: B.CLASSIFICATION_REF, submissionRef, rationale }) } catch (e) { return mapWriteError(e, base) }
  try { recordSubmitted(baseDir, rev.revisionId, rationale) } catch (e) { return mapWriteError(e, base, rev.revisionId) }
  const after = verifyAfterSubmit(baseDir, payload, personaIdentity)
  if (!after.ok) return { status: REASON.POST_SUBMIT_STATE_UNEXPECTED, ...base, revisionId: rev.revisionId, detail: after.detail, compat: after.compat }
  return { status: REASON.SUBMITTED, ...base, revisionId: after.revisionId, compat: after.compat }
}

// Confirmed writes require submission-ref + rationale + a matching source-commit guard.
function validateWriteInputs (submissionRef, rationale, expectSourceCommit, anchorCommit) {
  if (typeof submissionRef !== 'string' || !submissionRef) return 'submission-ref-required'
  if (typeof rationale !== 'string' || !rationale) return 'rationale-required'
  if (expectSourceCommit == null) return 'expect-source-commit-required'
  if (expectSourceCommit !== anchorCommit) return 'expect-source-commit-mismatch'
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
  PS_STORE, PS_RECORD_ID, SUBMISSION_EVENT, EMITTED_EVENT_TYPES, REASON,
  resolveSourceOfRecord, provePayloadIdentity, classifyState, verifyAfterSubmit, submitPersonality, exitCodeFor
}
