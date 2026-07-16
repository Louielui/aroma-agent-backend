'use strict'

/**
 * operatingPrinciplesShadow — M3b-1 read-only shadow verification + pure payload
 * builders for the Operating Principles domain of PERSONA_IDENTITY.
 *
 * The legacy "behavioral section" of PERSONA_IDENTITY (code units [807,1586)) is
 * split by the OWNER-approved M3a mapping into 8 operating-principles fragments
 * (sourceSequence 1,3,4,5,6,7,8,9) plus ONE personality fragment (sourceSequence 2,
 * range [886,952)). The Operating Principles Store holds ONLY the 8 OP fragments,
 * stored as an ordered-fragment payload. The personality fragment is NEVER stored
 * here.
 *
 * TRUST ANCHOR: the M3a mapping module (behavioralMapping.js). The verifier NEVER
 * trusts the store payload's self-described domain — every fragment is cross-checked
 * against the M3a mapping by exact source range + UTF-8 SHA-256 + Owner
 * classification. Equality is EXACT STRING equality; SHA-256 is integrity evidence.
 *
 * Two INDEPENDENT integrity layers (neither substitutes for the other):
 *   - M1 envelope contentHash  — per-revision artifact integrity (checked by store)
 *   - payload aggregateSha256  — cross-fragment payload integrity (checked here)
 *
 * Bridging reconstitution (M3c not built yet): the personality fragment text comes
 * from legacy PERSONA_IDENTITY, so metadata reports personalitySource:'legacy'.
 * This proves ONLY that the OP Store re-embeds exactly into the legacy behavioral
 * section — NOT a completed OP+Personality dual-store reconstitution.
 *
 * Read-only: NO writes, NO rebuildIndex, NO runtime/persona/prompt coupling.
 * PERSONA_IDENTITY is passed in by the CLI wrapper.
 */

const { MemoryError } = require('../errors')
const { canonicalize, sha256Hex } = require('../canonical')
const { verifyRevision } = require('../envelope')
const { revisionState } = require('../resolver')
const store = require('../store')
const B = require('./behavioralMapping')

const fs = require('fs')
const path = require('path')

const OP_STORE = 'operating-principles'
const OP_RECORD_ID = 'xiangxiang-operating-principles'
const SECTION = 'operating-principles'
const SCHEMA_VERSION = 'operating-principles-shadow/v1'
const PERSONALITY_SOURCE = 'legacy' // M3c not built; personality slice comes from legacy PERSONA_IDENTITY
const OP_SEQUENCES = Object.freeze([1, 3, 4, 5, 6, 7, 8, 9]) // M3a operating-principles fragment sequences

// Closed schemas — any unknown/missing key fails verification.
const ROOT_KEYS = Object.freeze(['aggregateSha256', 'behavioralSectionSha256', 'classificationApprovalRef', 'format', 'fragmentCount', 'fragments', 'schemaVersion', 'section', 'sourceCommit', 'sourceSymbol'])
const FRAG_KEYS = Object.freeze(['domainOrder', 'fragmentClassificationRef', 'sourceEndCodeUnit', 'sourceSequence', 'sourceSha256Utf8', 'sourceStartCodeUnit', 'text'])

const REASON = Object.freeze({
  PASS: 'PASS',
  CONFIG_ERROR: 'CONFIG_ERROR',
  MAPPING_CONTRACT_ERROR: 'MAPPING_CONTRACT_ERROR',
  OPERATING_PRINCIPLES_STORE_CORRUPT: 'OPERATING_PRINCIPLES_STORE_CORRUPT',
  AMBIGUOUS_ACTIVE_OPERATING_PRINCIPLES: 'AMBIGUOUS_ACTIVE_OPERATING_PRINCIPLES',
  NO_ACTIVE_OPERATING_PRINCIPLES: 'NO_ACTIVE_OPERATING_PRINCIPLES',
  OPERATING_PRINCIPLES_REVISION_CORRUPT: 'OPERATING_PRINCIPLES_REVISION_CORRUPT',
  OPERATING_PRINCIPLES_PAYLOAD_SCHEMA_INVALID: 'OPERATING_PRINCIPLES_PAYLOAD_SCHEMA_INVALID',
  PERSONALITY_DOMAIN_CONTAMINATION: 'PERSONALITY_DOMAIN_CONTAMINATION',
  NON_BEHAVIORAL_DOMAIN_CONTAMINATION: 'NON_BEHAVIORAL_DOMAIN_CONTAMINATION',
  OPERATING_PRINCIPLES_FRAGMENT_MISMATCH: 'OPERATING_PRINCIPLES_FRAGMENT_MISMATCH',
  OPERATING_PRINCIPLES_AGGREGATE_HASH_MISMATCH: 'OPERATING_PRINCIPLES_AGGREGATE_HASH_MISMATCH',
  OPERATING_PRINCIPLES_RECONSTITUTION_FAILED: 'OPERATING_PRINCIPLES_RECONSTITUTION_FAILED'
})

// Fixed precedence (Owner). Lower = evaluated first; PASS is the terminal success.
const PRECEDENCE = Object.freeze([
  REASON.CONFIG_ERROR,
  REASON.MAPPING_CONTRACT_ERROR,
  REASON.OPERATING_PRINCIPLES_STORE_CORRUPT,
  REASON.AMBIGUOUS_ACTIVE_OPERATING_PRINCIPLES,
  REASON.NO_ACTIVE_OPERATING_PRINCIPLES,
  REASON.OPERATING_PRINCIPLES_REVISION_CORRUPT,
  REASON.OPERATING_PRINCIPLES_PAYLOAD_SCHEMA_INVALID,
  REASON.PERSONALITY_DOMAIN_CONTAMINATION,
  REASON.NON_BEHAVIORAL_DOMAIN_CONTAMINATION,
  REASON.OPERATING_PRINCIPLES_FRAGMENT_MISMATCH,
  REASON.OPERATING_PRINCIPLES_AGGREGATE_HASH_MISMATCH,
  REASON.OPERATING_PRINCIPLES_RECONSTITUTION_FAILED,
  REASON.PASS
])

const HEX40 = /^[0-9a-f]{40}$/i
const HEX64 = /^[0-9a-f]{64}$/i

// ---------------------------------------------------------------------------
// M3a trust anchor: resolve the authoritative OP/personality/section geometry.
// Returns { section:{start,end}, personality:{start,end}, op:Map(seq->frag),
//           behavioralSectionSha256, classificationApprovalRef, sourceCommit }.
// Throws MAPPING_CONTRACT_ERROR (mapped by caller) if the M3a mapping is invalid.
// ---------------------------------------------------------------------------
function resolveAnchor (personaIdentity, mapping) {
  const map = mapping || B.MAPPING
  const v = B.verifyBehavioralMapping(personaIdentity, map)
  if (v.status !== 'PASS') throw new MemoryError('MAPPING_CONTRACT_ERROR', v.reason || 'mapping verification failed')
  const loc = B.locateSection(personaIdentity)
  if (loc.err) throw new MemoryError('MAPPING_CONTRACT_ERROR', 'section markers invalid')
  const personality = map.find((f) => f.authorityDomain === 'personality')
  if (!personality) throw new MemoryError('MAPPING_CONTRACT_ERROR', 'no personality fragment in mapping')
  const op = new Map()
  for (const f of map) if (f.authorityDomain === 'operating-principles') op.set(f.sequence, f)
  if (op.size !== OP_SEQUENCES.length) throw new MemoryError('MAPPING_CONTRACT_ERROR', 'unexpected operating-principles fragment count')
  return {
    section: { start: loc.midStart, end: loc.midEnd },
    personality: { start: personality.startCodeUnit, end: personality.endCodeUnit },
    op,
    behavioralSectionSha256: v.behavioralSectionSha256,
    classificationApprovalRef: B.CLASSIFICATION_REF,
    sourceCommit: B.SOURCE_COMMIT
  }
}

// ---------------------------------------------------------------------------
// PURE payload builder (NO filesystem writes). Reused by the future M3b-2 seeder
// and by tests. Derives the canonical OP payload from legacy + M3a mapping.
// ---------------------------------------------------------------------------
function buildOperatingPrinciplesPayload (personaIdentity, mapping) {
  if (typeof personaIdentity !== 'string' || personaIdentity.length === 0) throw new MemoryError('VALIDATION_ERROR', 'personaIdentity must be a non-empty string')
  const anchor = resolveAnchor(personaIdentity, mapping)
  const fragments = OP_SEQUENCES.map((seq, i) => {
    const f = anchor.op.get(seq)
    const text = personaIdentity.slice(f.startCodeUnit, f.endCodeUnit) // exact slice; no trim/normalize
    return {
      sourceSequence: seq,
      domainOrder: i + 1,
      fragmentClassificationRef: f.classificationRef,
      sourceStartCodeUnit: f.startCodeUnit,
      sourceEndCodeUnit: f.endCodeUnit,
      sourceSha256Utf8: f.sha256Utf8,
      text
    }
  })
  const core = {
    format: 'ordered-fragments',
    schemaVersion: SCHEMA_VERSION,
    section: SECTION,
    sourceSymbol: B.SOURCE_SYMBOL,
    sourceCommit: anchor.sourceCommit,
    classificationApprovalRef: anchor.classificationApprovalRef,
    behavioralSectionSha256: anchor.behavioralSectionSha256,
    fragmentCount: fragments.length,
    fragments
  }
  return Object.assign({}, core, { aggregateSha256: computeAggregateSha256(core) })
}

// Aggregate hash: canonical JSON (M1 canonicalize) over the payload EXCLUDING
// aggregateSha256. No delimiter/string concatenation. Independent of envelope hash.
function computeAggregateSha256 (payloadCore) {
  const input = {
    format: payloadCore.format,
    schemaVersion: payloadCore.schemaVersion,
    section: payloadCore.section,
    sourceSymbol: payloadCore.sourceSymbol,
    sourceCommit: payloadCore.sourceCommit,
    classificationApprovalRef: payloadCore.classificationApprovalRef,
    behavioralSectionSha256: payloadCore.behavioralSectionSha256,
    fragmentCount: payloadCore.fragmentCount,
    fragments: payloadCore.fragments.map((f) => ({
      sourceSequence: f.sourceSequence,
      domainOrder: f.domainOrder,
      fragmentClassificationRef: f.fragmentClassificationRef,
      sourceStartCodeUnit: f.sourceStartCodeUnit,
      sourceEndCodeUnit: f.sourceEndCodeUnit,
      sourceSha256Utf8: f.sourceSha256Utf8,
      text: f.text
    }))
  }
  return sha256Hex(canonicalize(input))
}

// ---------------------------------------------------------------------------
// Read-only diagnosis, scoped to the OP record only. Corruption of unrelated
// records in the same store does NOT taint this record's verdict.
// ---------------------------------------------------------------------------
function diagnoseOperatingPrinciples (baseDir) {
  const storeExists = fs.existsSync(path.join(baseDir, OP_STORE))
  const recordExists = fs.existsSync(path.join(baseDir, OP_STORE, 'records', OP_RECORD_ID))
  let revs, recState, events
  try {
    revs = store.listRevisions(baseDir, OP_STORE, OP_RECORD_ID)
    recState = store.getRecordState(baseDir, OP_STORE, OP_RECORD_ID)
    events = store.listEvents(baseDir, OP_STORE, OP_RECORD_ID)
  } catch (e) {
    // The target record's own data could not be safely parsed -> treat as corruption.
    return { recordId: OP_RECORD_ID, unsafe: true, storeExists, recordExists, revisionCount: 0, anyUnreadableRevision: true, corruptEvents: [], active: { status: 'NONE' } }
  }
  const anyUnreadableRevision = revs.some((r) => r.__unreadable)
  const approvedNotActive = revs.some((r) => !r.__unreadable && revisionState(OP_STORE, r.revisionId, events).state === 'approved')
  return {
    recordId: OP_RECORD_ID,
    unsafe: false,
    storeExists,
    recordExists,
    revisionCount: revs.length,
    anyUnreadableRevision,
    corruptEvents: recState.corruptEvents,
    approvedNotActive,
    active: recState.active
  }
}

function notReadySubReason (dx) {
  if (!dx.storeExists) return 'STORE_ABSENT'
  if (!dx.recordExists) return 'RECORD_ABSENT'
  if (dx.revisionCount === 0) return 'ZERO_REVISION'
  if (dx.approvedNotActive) return 'APPROVED_NOT_ACTIVE'
  return 'NO_ACTIVE_REVISION'
}

// ---------------------------------------------------------------------------
// Closed-schema structural validation of the stored payload. Returns null on OK
// or a { detail } object on the first violation. No cross-mapping checks here.
// ---------------------------------------------------------------------------
function validatePayloadSchema (payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return { detail: 'payload-not-object' }
  const rootKeys = Object.keys(payload).sort()
  if (rootKeys.length !== ROOT_KEYS.length || !rootKeys.every((k, i) => k === ROOT_KEYS[i])) return { detail: 'root-keys' }
  if (payload.format !== 'ordered-fragments') return { detail: 'format' }
  if (payload.schemaVersion !== SCHEMA_VERSION) return { detail: 'schemaVersion' }
  if (payload.section !== SECTION) return { detail: 'section' }
  if (typeof payload.sourceSymbol !== 'string' || !payload.sourceSymbol) return { detail: 'sourceSymbol' }
  if (typeof payload.sourceCommit !== 'string' || !HEX40.test(payload.sourceCommit)) return { detail: 'sourceCommit' }
  if (typeof payload.classificationApprovalRef !== 'string' || !payload.classificationApprovalRef) return { detail: 'classificationApprovalRef' }
  if (typeof payload.behavioralSectionSha256 !== 'string' || !HEX64.test(payload.behavioralSectionSha256)) return { detail: 'behavioralSectionSha256' }
  if (typeof payload.aggregateSha256 !== 'string' || !HEX64.test(payload.aggregateSha256)) return { detail: 'aggregateSha256' }
  if (!Number.isInteger(payload.fragmentCount) || payload.fragmentCount !== OP_SEQUENCES.length) return { detail: 'fragmentCount' }
  if (!Array.isArray(payload.fragments) || payload.fragments.length !== OP_SEQUENCES.length) return { detail: 'fragments-length' }
  const seenDomainOrder = new Set()
  let prevOrder = 0
  for (const f of payload.fragments) {
    if (f === null || typeof f !== 'object' || Array.isArray(f)) return { detail: 'fragment-not-object' }
    const fk = Object.keys(f).sort()
    if (fk.length !== FRAG_KEYS.length || !fk.every((k, i) => k === FRAG_KEYS[i])) return { detail: 'fragment-keys' }
    if (!Number.isInteger(f.sourceSequence)) return { detail: 'sourceSequence-type' }
    if (!Number.isInteger(f.domainOrder)) return { detail: 'domainOrder-type' }
    if (typeof f.fragmentClassificationRef !== 'string' || !f.fragmentClassificationRef) return { detail: 'fragmentClassificationRef-type' }
    if (!Number.isInteger(f.sourceStartCodeUnit) || f.sourceStartCodeUnit < 0) return { detail: 'sourceStartCodeUnit-type' }
    if (!Number.isInteger(f.sourceEndCodeUnit) || f.sourceEndCodeUnit <= f.sourceStartCodeUnit) return { detail: 'sourceEndCodeUnit-type' }
    if (typeof f.sourceSha256Utf8 !== 'string' || !HEX64.test(f.sourceSha256Utf8)) return { detail: 'sourceSha256Utf8-type' }
    if (typeof f.text !== 'string') return { detail: 'text-type' }
    if (seenDomainOrder.has(f.domainOrder)) return { detail: 'domainOrder-duplicate' }
    seenDomainOrder.add(f.domainOrder)
    if (f.domainOrder !== prevOrder + 1) return { detail: 'domainOrder-not-ascending-1..n' }
    prevOrder = f.domainOrder
  }
  return null
}

// ---------------------------------------------------------------------------
// Read-only verifier. Returns SAFE metadata only (never fragment/persona text).
// ---------------------------------------------------------------------------
function verifyOperatingPrinciplesShadow (baseDir, personaIdentity, mapping) {
  const base = { recordId: OP_RECORD_ID, personalitySource: PERSONALITY_SOURCE }

  // (1 CONFIG handled by CLI) — 2. TRUST ANCHOR
  let anchor
  try { anchor = resolveAnchor(personaIdentity, mapping) } catch (e) {
    if (e instanceof MemoryError && e.code === 'MAPPING_CONTRACT_ERROR') return { status: REASON.MAPPING_CONTRACT_ERROR, ...base }
    return { status: REASON.MAPPING_CONTRACT_ERROR, ...base }
  }

  // 3/4/5 — resolver truth (record-scoped). Corruption precedes NOT_READY.
  const dx = diagnoseOperatingPrinciples(baseDir)
  if (dx.unsafe || dx.anyUnreadableRevision || dx.corruptEvents.length > 0) {
    return { status: REASON.OPERATING_PRINCIPLES_STORE_CORRUPT, ...base, corruptEvents: dx.corruptEvents, unreadableRevision: dx.anyUnreadableRevision }
  }
  if (dx.active.status === 'AMBIGUOUS_ACTIVE_STATE') return { status: REASON.AMBIGUOUS_ACTIVE_OPERATING_PRINCIPLES, ...base, candidates: dx.active.candidates }
  if (dx.active.status !== 'ACTIVE') return { status: REASON.NO_ACTIVE_OPERATING_PRINCIPLES, ...base, subReason: notReadySubReason(dx), revisionCount: dx.revisionCount }

  // 6. active revision artifact integrity
  const rev = store.getRevision(baseDir, OP_STORE, OP_RECORD_ID, dx.active.revisionId)
  try { verifyRevision(rev) } catch (e) { return { status: REASON.OPERATING_PRINCIPLES_REVISION_CORRUPT, ...base, revisionId: dx.active.revisionId } }
  const meta = Object.assign({}, base, { revisionId: dx.active.revisionId, activeRevisionId: dx.active.revisionId })
  const payload = rev.payload

  // 7. closed-schema validation BEFORE any field use
  const sc = validatePayloadSchema(payload)
  if (sc) return { status: REASON.OPERATING_PRINCIPLES_PAYLOAD_SCHEMA_INVALID, ...meta, detail: sc.detail }

  // 8/9. contamination (before generic cross-validation)
  for (const f of payload.fragments) {
    const overlapsPersonality = f.sourceStartCodeUnit < anchor.personality.end && f.sourceEndCodeUnit > anchor.personality.start
    if (f.sourceSequence === 2 || overlapsPersonality) return { status: REASON.PERSONALITY_DOMAIN_CONTAMINATION, ...meta, sequence: f.sourceSequence }
  }
  for (const f of payload.fragments) {
    if (f.sourceStartCodeUnit < anchor.section.start || f.sourceEndCodeUnit > anchor.section.end) return { status: REASON.NON_BEHAVIORAL_DOMAIN_CONTAMINATION, ...meta, sequence: f.sourceSequence }
  }

  // 10. cross-validate against the M3a trust anchor (never trust payload self-description)
  if (payload.sourceCommit !== anchor.sourceCommit) return { status: REASON.OPERATING_PRINCIPLES_FRAGMENT_MISMATCH, ...meta, detail: 'record-sourceCommit' }
  if (payload.classificationApprovalRef !== anchor.classificationApprovalRef) return { status: REASON.OPERATING_PRINCIPLES_FRAGMENT_MISMATCH, ...meta, detail: 'record-classificationApprovalRef' }
  if (payload.behavioralSectionSha256 !== anchor.behavioralSectionSha256) return { status: REASON.OPERATING_PRINCIPLES_FRAGMENT_MISMATCH, ...meta, detail: 'record-behavioralSectionSha256' }
  const seenSeq = new Set()
  for (const f of payload.fragments) {
    const exp = anchor.op.get(f.sourceSequence)
    if (!exp) return { status: REASON.OPERATING_PRINCIPLES_FRAGMENT_MISMATCH, ...meta, detail: 'unknown-sequence', sequence: f.sourceSequence }
    if (seenSeq.has(f.sourceSequence)) return { status: REASON.OPERATING_PRINCIPLES_FRAGMENT_MISMATCH, ...meta, detail: 'duplicate-sequence', sequence: f.sourceSequence }
    seenSeq.add(f.sourceSequence)
    if (f.sourceStartCodeUnit !== exp.startCodeUnit || f.sourceEndCodeUnit !== exp.endCodeUnit) return { status: REASON.OPERATING_PRINCIPLES_FRAGMENT_MISMATCH, ...meta, detail: 'range', sequence: f.sourceSequence }
    if (f.sourceSha256Utf8 !== exp.sha256Utf8) return { status: REASON.OPERATING_PRINCIPLES_FRAGMENT_MISMATCH, ...meta, detail: 'source-hash', sequence: f.sourceSequence }
    if (f.fragmentClassificationRef !== exp.classificationRef) return { status: REASON.OPERATING_PRINCIPLES_FRAGMENT_MISMATCH, ...meta, detail: 'classification', sequence: f.sourceSequence }
    const legacyText = personaIdentity.slice(f.sourceStartCodeUnit, f.sourceEndCodeUnit)
    if (f.text !== legacyText) return { status: REASON.OPERATING_PRINCIPLES_FRAGMENT_MISMATCH, ...meta, detail: 'text', sequence: f.sourceSequence }
    if (B.sha256Utf8(f.text) !== f.sourceSha256Utf8) return { status: REASON.OPERATING_PRINCIPLES_FRAGMENT_MISMATCH, ...meta, detail: 'text-hash', sequence: f.sourceSequence }
  }
  if (seenSeq.size !== OP_SEQUENCES.length) return { status: REASON.OPERATING_PRINCIPLES_FRAGMENT_MISMATCH, ...meta, detail: 'sequence-set' }

  // 11. aggregate hash (independent of envelope contentHash)
  if (computeAggregateSha256(payload) !== payload.aggregateSha256) return { status: REASON.OPERATING_PRINCIPLES_AGGREGATE_HASH_MISMATCH, ...meta }

  // 12. reconstitution — OP fragments (store) + personality fragment (legacy) tile the
  //     behavioral section exactly, then the full persona reassembles exactly.
  const pieces = payload.fragments.map((f) => ({ start: f.sourceStartCodeUnit, end: f.sourceEndCodeUnit, text: f.text }))
  pieces.push({ start: anchor.personality.start, end: anchor.personality.end, text: personaIdentity.slice(anchor.personality.start, anchor.personality.end) })
  pieces.sort((a, b) => a.start - b.start)
  let cursor = anchor.section.start
  let assembled = ''
  let tilingOk = true
  for (const p of pieces) { if (p.start !== cursor) { tilingOk = false; break } assembled += p.text; cursor = p.end }
  const behavioralSection = personaIdentity.slice(anchor.section.start, anchor.section.end)
  const behavioralReconstituteOk = tilingOk && cursor === anchor.section.end && assembled === behavioralSection && sha256Hex(canonicalize(assembled)) === sha256Hex(canonicalize(behavioralSection))
  const fullAssembled = personaIdentity.slice(0, anchor.section.start) + assembled + personaIdentity.slice(anchor.section.end)
  const fullReconstituteOk = behavioralReconstituteOk && fullAssembled === personaIdentity
  const outMeta = Object.assign({}, meta, {
    fragmentCount: payload.fragments.length,
    aggregateSha256: payload.aggregateSha256,
    behavioralSectionSha256: payload.behavioralSectionSha256,
    behavioralReconstituteOk,
    fullReconstituteOk
  })
  if (!(behavioralReconstituteOk && fullReconstituteOk)) return { status: REASON.OPERATING_PRINCIPLES_RECONSTITUTION_FAILED, ...outMeta }

  // 13. PASS
  return { status: REASON.PASS, ...outMeta }
}

// Exit-code contract: 0 PASS · 2 FAIL · 3 config/tool · 4 NOT_READY.
function exitCodeFor (status) {
  if (status === REASON.PASS) return 0
  if (status === REASON.CONFIG_ERROR || status === REASON.MAPPING_CONTRACT_ERROR) return 3
  if (status === REASON.NO_ACTIVE_OPERATING_PRINCIPLES) return 4
  return 2
}

module.exports = {
  OP_STORE, OP_RECORD_ID, SECTION, SCHEMA_VERSION, PERSONALITY_SOURCE, OP_SEQUENCES,
  ROOT_KEYS, FRAG_KEYS, REASON, PRECEDENCE,
  resolveAnchor, buildOperatingPrinciplesPayload, computeAggregateSha256,
  diagnoseOperatingPrinciples, validatePayloadSchema, verifyOperatingPrinciplesShadow, exitCodeFor
}
