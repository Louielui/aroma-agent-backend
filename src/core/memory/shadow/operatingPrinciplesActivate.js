'use strict'

/**
 * operatingPrinciplesActivate — M3b-4 activation tooling (governed, append-only).
 *
 * Consumes an explicit out-of-band Owner activation GO and records ONE `ACTIVATED`
 * lifecycle event on the single `approved` operating-principles revision, advancing
 * the derived state to `active` (resolver ACTIVE). It NEVER emits any other event
 * (ADMITTED — the experience-domain verb — is invalid for OP and unreachable here),
 * never creates a revision, never rolls back, never introduces a mutable active
 * pointer (ACTIVE is derived from the immutable event log).
 *
 * Activation ≠ runtime cutover: the store becoming ACTIVE in the Memory truth layer
 * does NOT touch PERSONA_IDENTITY / buildPersonaSystem. Runtime stays isolated.
 *
 * `event.actor`/`activatedBy`/`activationSource` are FIXED (Louie / owner-authorized-
 * activation) and cannot be caller-supplied. The `ACTIVATED.rationale` is a
 * deterministic canonical-JSON string (stable key order via M1 canonicalize):
 *   {activatedBy, activationRef, activationSource, reason}
 *
 * Before activating, the tool proves the EXACT lifecycle chain (not just derived
 * state) and re-proves canonical payload identity. `--confirm` requires
 * `--expect-revision-id` + `--expect-source-commit` + `--activation-ref` +
 * `--rationale`. No `--resume`: ACTIVATED is a single atomic event append.
 *
 * Read-only outside the ONE governed ACTIVATED write; SAFE metadata only.
 */

const fs = require('fs')
const path = require('path')
const { MemoryError } = require('../errors')
const { canonicalize } = require('../canonical')
const { revisionState } = require('../resolver')
const store = require('../store')
const B = require('./behavioralMapping')
const shadow = require('./operatingPrinciplesShadow')
const { provePayloadIdentity } = require('./operatingPrinciplesSubmit')

const OP_STORE = shadow.OP_STORE
const OP_RECORD_ID = shadow.OP_RECORD_ID
const ACTIVATION_EVENT = 'ACTIVATED'
const EMITTED_EVENT_TYPES = Object.freeze([ACTIVATION_EVENT]) // the ONLY event type this tool may ever write
const CREATED_AT_LABEL = 'M3B4-ACTIVATE'

// FIXED activation identity (B2) — never caller-supplied.
const ACTOR = 'Louie'
const ACTIVATED_BY = 'Louie'
const ACTIVATION_SOURCE = 'owner-authorized-activation'

const FORBIDDEN_EVENTS = ['ADMITTED', 'SUPERSEDED', 'DEPRECATED', 'REJECTED']

const REASON = Object.freeze({
  // success (exit 0)
  DRY_RUN: 'DRY_RUN',
  ACTIVATED: 'ACTIVATED',
  ALREADY_ACTIVE_MATCH: 'ALREADY_ACTIVE_MATCH',
  // config / tool (exit 3)
  CONFIG_ERROR: 'CONFIG_ERROR',
  MAPPING_CONTRACT_ERROR: 'MAPPING_CONTRACT_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  // governance refusal / write failure (exit 2)
  STORE_CORRUPT: 'STORE_CORRUPT',
  MULTIPLE_REVISIONS: 'MULTIPLE_REVISIONS',
  UNEXPECTED_LIFECYCLE_STATE: 'UNEXPECTED_LIFECYCLE_STATE',
  NOT_APPROVED: 'NOT_APPROVED',
  REVISION_TARGET_MISMATCH: 'REVISION_TARGET_MISMATCH',
  PAYLOAD_IDENTITY_FAILED: 'PAYLOAD_IDENTITY_FAILED',
  ACTIVE_PAYLOAD_MISMATCH: 'ACTIVE_PAYLOAD_MISMATCH',
  AMBIGUOUS_ACTIVE: 'AMBIGUOUS_ACTIVE',
  CHAIN_PROOF_FAILED: 'CHAIN_PROOF_FAILED',
  WRITE_FAILED: 'WRITE_FAILED',
  READBACK_FAILED: 'READBACK_FAILED',
  POST_ACTIVATE_STATE_UNEXPECTED: 'POST_ACTIVATE_STATE_UNEXPECTED'
})

const SUCCESS = new Set([REASON.DRY_RUN, REASON.ACTIVATED, REASON.ALREADY_ACTIVE_MATCH])
const TIER3 = new Set([REASON.CONFIG_ERROR, REASON.MAPPING_CONTRACT_ERROR, REASON.VALIDATION_ERROR])
function exitCodeFor (status) { if (SUCCESS.has(status)) return 0; if (TIER3.has(status)) return 3; return 2 }

// Build the deterministic canonical-JSON rationale (B1). Fixed identity fields are
// set here and never taken from the caller.
function buildActivationRationale (activationRef, reason) {
  return canonicalize({ activatedBy: ACTIVATED_BY, activationRef, activationSource: ACTIVATION_SOURCE, reason })
}

function resolveSourceOfRecord (personaIdentity) {
  const v = B.verifyBehavioralMapping(personaIdentity, B.MAPPING)
  if (v.status !== 'PASS') throw new MemoryError('MAPPING_CONTRACT_ERROR', v.reason || 'mapping verification failed')
  return { sourceCommit: B.SOURCE_COMMIT }
}

// Exact lifecycle-chain analysis (record-scoped). Does NOT rely on derived state
// alone — it counts events, checks the forbidden set, causal closure, and that
// every event targets the sole revision.
function analyzeChain (baseDir) {
  const revs = store.listRevisions(baseDir, OP_STORE, OP_RECORD_ID)
  const rec = store.getRecordState(baseDir, OP_STORE, OP_RECORD_ID)
  const events = store.listEvents(baseDir, OP_STORE, OP_RECORD_ID)
  const unreadable = revs.some((r) => r.__unreadable)
  const counts = {}
  for (const e of events) counts[e.eventType] = (counts[e.eventType] || 0) + 1
  const forbiddenCount = FORBIDDEN_EVENTS.reduce((n, t) => n + (counts[t] || 0), 0)
  const soleRevId = (revs.length === 1 && !revs[0].__unreadable) ? revs[0].revisionId : null
  const allTargetSole = soleRevId != null && events.every((e) => e.targetRevisionId === soleRevId)
  const revIds = new Set(revs.filter((r) => !r.__unreadable).map((r) => r.revisionId))
  const causalClosure = events.every((e) => revIds.has(e.targetRevisionId))
  const derivedState = soleRevId ? revisionState(OP_STORE, soleRevId, events).state : null
  const resolver = store.resolveActiveRecord(baseDir, OP_STORE, OP_RECORD_ID)
  return { revisionCount: revs.length, unreadable, corruptEvents: rec.corruptEvents, total: events.length, counts, forbiddenCount, soleRevId, allTargetSole, causalClosure, derivedState, resolver }
}

const n = (counts, t) => counts[t] || 0
// Exact "ready to activate" chain: 1 revision, exactly [SUBMITTED,APPROVED], no
// forbidden/extra events, derived approved, resolver NONE, closure holds.
function isApprovedChain (a) {
  return a.revisionCount === 1 && a.total === 2 &&
    n(a.counts, 'SUBMITTED_FOR_REVIEW') === 1 && n(a.counts, 'APPROVED') === 1 && n(a.counts, 'ACTIVATED') === 0 &&
    a.forbiddenCount === 0 && a.derivedState === 'approved' && a.resolver.status === 'NONE' &&
    a.allTargetSole && a.causalClosure
}
// Exact "already active" chain: 1 revision, exactly [SUBMITTED,APPROVED,ACTIVATED],
// no forbidden/extra events, derived active, resolver ACTIVE for the sole revision.
function isActiveChain (a) {
  return a.revisionCount === 1 && a.total === 3 &&
    n(a.counts, 'SUBMITTED_FOR_REVIEW') === 1 && n(a.counts, 'APPROVED') === 1 && n(a.counts, 'ACTIVATED') === 1 &&
    a.forbiddenCount === 0 && a.derivedState === 'active' &&
    a.resolver.status === 'ACTIVE' && a.resolver.revisionId === a.soleRevId &&
    a.allTargetSole && a.causalClosure
}

// The ONLY governed write this tool performs.
function recordActivated (baseDir, revisionId, activationRef, reason) {
  return store.recordEvent(baseDir, OP_STORE, {
    recordId: OP_RECORD_ID,
    targetRevisionId: revisionId,
    eventType: ACTIVATION_EVENT,
    actor: ACTOR,
    approval: null, // ACTIVATED carries no approval record; authorization lives in the canonical rationale
    rationale: buildActivationRationale(activationRef, reason),
    expectedPreviousState: 'approved',
    timestampLabel: CREATED_AT_LABEL
  })
}

// Post-activation independent verification (exact active chain) + M3b-1 compat PASS.
function verifyAfterActivate (baseDir, canonicalPayload, personaIdentity) {
  const a = analyzeChain(baseDir)
  if (!isActiveChain(a)) return { ok: false, detail: 'active-chain' }
  if (a.counts.ADMITTED) return { ok: false, detail: 'admitted-present' }
  const rev = store.getRevision(baseDir, OP_STORE, OP_RECORD_ID, a.soleRevId)
  const id = provePayloadIdentity(rev, canonicalPayload, personaIdentity)
  if (!id.ok) return { ok: false, detail: 'identity:' + id.detail }
  const compat = shadow.verifyOperatingPrinciplesShadow(baseDir, personaIdentity)
  const compatOk = compat.status === shadow.REASON.PASS && shadow.exitCodeFor(compat.status) === 0
  if (!compatOk) return { ok: false, detail: 'm3b1-compat', compat: { status: compat.status } }
  return { ok: true, revisionId: a.soleRevId, compat: { status: compat.status, exitCode: 0 } }
}

/**
 * Main entry. opts: { personaIdentity, activationRef, rationale, confirm,
 *                     expectRevisionId, expectSourceCommit }
 */
function activateOperatingPrinciples (baseDir, opts = {}) {
  const { personaIdentity, activationRef, rationale, confirm, expectRevisionId, expectSourceCommit } = opts
  const base = { recordId: OP_RECORD_ID }

  // trust anchor + source-of-record
  let sor
  try { sor = resolveSourceOfRecord(personaIdentity) } catch (e) { return { status: REASON.MAPPING_CONTRACT_ERROR, ...base } }
  if (expectSourceCommit != null && expectSourceCommit !== sor.sourceCommit) return { status: REASON.VALIDATION_ERROR, ...base, detail: 'expect-source-commit-mismatch' }

  // canonical payload (pure; no writes)
  let payload
  try { payload = shadow.buildOperatingPrinciplesPayload(personaIdentity) } catch (e) { return { status: REASON.MAPPING_CONTRACT_ERROR, ...base } }

  let a
  try { a = analyzeChain(baseDir) } catch (e) { return { status: REASON.STORE_CORRUPT, ...base } }
  if (a.unreadable || a.corruptEvents.length > 0) return { status: REASON.STORE_CORRUPT, ...base }
  // ambiguous active is a more specific verdict than "multiple revisions" (it needs >=2 active)
  if (a.resolver.status === 'AMBIGUOUS_ACTIVE_STATE') return { status: REASON.AMBIGUOUS_ACTIVE, ...base }
  if (a.revisionCount > 1) return { status: REASON.MULTIPLE_REVISIONS, ...base }

  // already-active (or any ACTIVATED present): require the EXACT active chain,
  // else fail closed — never report ALREADY_ACTIVE_MATCH for a malformed chain.
  if (n(a.counts, 'ACTIVATED') > 0 || a.resolver.status === 'ACTIVE') {
    if (!isActiveChain(a)) return { status: REASON.CHAIN_PROOF_FAILED, ...base, detail: 'active-chain-not-exact' }
    const id = provePayloadIdentity(store.getRevision(baseDir, OP_STORE, OP_RECORD_ID, a.soleRevId), payload, personaIdentity)
    if (!id.ok) return { status: REASON.ACTIVE_PAYLOAD_MISMATCH, ...base, revisionId: a.soleRevId, detail: id.detail }
    return { status: REASON.ALREADY_ACTIVE_MATCH, ...base, revisionId: a.soleRevId }
  }

  // not active yet — must be the EXACT approved chain to proceed
  if (!isApprovedChain(a)) {
    if (a.revisionCount === 0 || a.derivedState === 'review_ready' || a.derivedState === 'new') return { status: REASON.NOT_APPROVED, ...base, derivedState: a.derivedState }
    if (['deprecated', 'superseded', 'rejected'].includes(a.derivedState)) return { status: REASON.UNEXPECTED_LIFECYCLE_STATE, ...base, derivedState: a.derivedState }
    return { status: REASON.CHAIN_PROOF_FAILED, ...base, detail: 'approved-chain-not-exact', derivedState: a.derivedState }
  }

  // exact revision + source guards (Owner-required)
  if (expectRevisionId == null || expectRevisionId !== a.soleRevId) return { status: REASON.REVISION_TARGET_MISMATCH, ...base, revisionId: a.soleRevId }

  // payload identity re-proof (never activate corrupted/contaminated content)
  const id = provePayloadIdentity(store.getRevision(baseDir, OP_STORE, OP_RECORD_ID, a.soleRevId), payload, personaIdentity)
  if (!id.ok) return { status: REASON.PAYLOAD_IDENTITY_FAILED, ...base, revisionId: a.soleRevId, detail: id.detail }

  if (!confirm) return { status: REASON.DRY_RUN, ...base, plan: 'activate', revisionId: a.soleRevId, sourceCommit: sor.sourceCommit }

  // confirmed activation — all guards mandatory
  if (expectSourceCommit == null) return { status: REASON.VALIDATION_ERROR, ...base, detail: 'expect-source-commit-required' }
  const vErr = validateWriteInputs(activationRef, rationale)
  if (vErr) return { status: REASON.VALIDATION_ERROR, ...base, detail: vErr }
  try { recordActivated(baseDir, a.soleRevId, activationRef, rationale) } catch (e) { return mapWriteError(e, base, a.soleRevId) }
  const after = verifyAfterActivate(baseDir, payload, personaIdentity)
  if (!after.ok) return { status: REASON.POST_ACTIVATE_STATE_UNEXPECTED, ...base, revisionId: a.soleRevId, detail: after.detail, compat: after.compat }
  return { status: REASON.ACTIVATED, ...base, revisionId: after.revisionId, compat: after.compat }
}

function validateWriteInputs (activationRef, rationale) {
  if (typeof activationRef !== 'string' || !activationRef) return 'activation-ref-required'
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
  OP_STORE, OP_RECORD_ID, ACTIVATION_EVENT, EMITTED_EVENT_TYPES, REASON,
  ACTOR, ACTIVATED_BY, ACTIVATION_SOURCE,
  buildActivationRationale, resolveSourceOfRecord, analyzeChain, isApprovedChain, isActiveChain,
  verifyAfterActivate, activateOperatingPrinciples, exitCodeFor
}
