'use strict'

/**
 * personalityShadow — M3c-1 read-only shadow verification + pure payload builder
 * for the Personality domain of PERSONA_IDENTITY.
 *
 * The behavioral section of PERSONA_IDENTITY ([807,1586)) contains exactly ONE
 * personality fragment per the OWNER-approved M3a mapping: sequence 2, code units
 * [886,952) ("item-2 expression style / tone"). The Personality Store holds ONLY
 * that single fragment. It NEVER holds any operating-principles fragment.
 *
 * TRUST ANCHOR: the M3a mapping module. The verifier NEVER trusts the store
 * payload's self-described domain — the fragment is cross-checked against the M3a
 * mapping by exact source range + UTF-8 SHA-256 + Owner classification. Equality is
 * EXACT string equality; SHA-256 is integrity evidence only.
 *
 * NOTE ON DOMAIN LAYERS: the M3a fragment label is `personality`, but the M1
 * `personality` store's governance authorityDomain is `behavior`. Both are checked:
 * the M3a label via the mapping, the M1 layer via the revision envelope
 * (authorityDomain === "behavior").
 *
 * Two independent integrity layers: M1 envelope contentHash (per revision) and the
 * payload aggregateSha256 (cross-field). The verifier is ACTIVE-ONLY: review_ready
 * or approved return NOT_READY, never PASS. Read-only; SAFE metadata only.
 */

const { MemoryError } = require('../errors')
const { canonicalize, sha256Hex } = require('../canonical')
const { verifyRevision } = require('../envelope')
const { revisionState } = require('../resolver')
const { authorityDomain } = require('../lifecycle')
const store = require('../store')
const B = require('./behavioralMapping')

const fs = require('fs')
const path = require('path')

const PERSONALITY_STORE = 'personality'
const PERSONALITY_RECORD_ID = 'xiangxiang-personality'
const SECTION = 'personality'
const SCHEMA_VERSION = 'personality-shadow/v1'
const PERSONALITY_SEQUENCE = 2 // the sole personality fragment (M3a)
const OP_SEQUENCES = Object.freeze([1, 3, 4, 5, 6, 7, 8, 9]) // operating-principles sequences (forbidden here)

const ROOT_KEYS = Object.freeze(['aggregateSha256', 'behavioralSectionSha256', 'classificationApprovalRef', 'format', 'fragmentCount', 'fragments', 'schemaVersion', 'section', 'sourceCommit', 'sourceSymbol'])
const FRAG_KEYS = Object.freeze(['domainOrder', 'fragmentClassificationRef', 'sourceEndCodeUnit', 'sourceSequence', 'sourceSha256Utf8', 'sourceStartCodeUnit', 'text'])

const REASON = Object.freeze({
  PASS: 'PASS',
  CONFIG_ERROR: 'CONFIG_ERROR',
  MAPPING_CONTRACT_ERROR: 'MAPPING_CONTRACT_ERROR',
  PERSONALITY_STORE_CORRUPT: 'PERSONALITY_STORE_CORRUPT',
  AMBIGUOUS_ACTIVE_PERSONALITY: 'AMBIGUOUS_ACTIVE_PERSONALITY',
  NO_ACTIVE_PERSONALITY: 'NO_ACTIVE_PERSONALITY',
  PERSONALITY_REVISION_CORRUPT: 'PERSONALITY_REVISION_CORRUPT',
  PERSONALITY_PAYLOAD_SCHEMA_INVALID: 'PERSONALITY_PAYLOAD_SCHEMA_INVALID',
  OPERATING_PRINCIPLES_DOMAIN_CONTAMINATION: 'OPERATING_PRINCIPLES_DOMAIN_CONTAMINATION',
  NON_BEHAVIORAL_DOMAIN_CONTAMINATION: 'NON_BEHAVIORAL_DOMAIN_CONTAMINATION',
  PERSONALITY_FRAGMENT_MISMATCH: 'PERSONALITY_FRAGMENT_MISMATCH',
  PERSONALITY_AGGREGATE_HASH_MISMATCH: 'PERSONALITY_AGGREGATE_HASH_MISMATCH',
  PERSONALITY_RECONSTITUTION_FAILED: 'PERSONALITY_RECONSTITUTION_FAILED'
})

const HEX40 = /^[0-9a-f]{40}$/i
const HEX64 = /^[0-9a-f]{64}$/i

// Resolve the authoritative geometry from the verified M3a mapping.
function resolveAnchor (personaIdentity, mapping) {
  const map = mapping || B.MAPPING
  const v = B.verifyBehavioralMapping(personaIdentity, map)
  if (v.status !== 'PASS') throw new MemoryError('MAPPING_CONTRACT_ERROR', v.reason || 'mapping verification failed')
  const loc = B.locateSection(personaIdentity)
  if (loc.err) throw new MemoryError('MAPPING_CONTRACT_ERROR', 'section markers invalid')
  const personality = map.find((f) => f.authorityDomain === 'personality')
  if (!personality || personality.sequence !== PERSONALITY_SEQUENCE) throw new MemoryError('MAPPING_CONTRACT_ERROR', 'no single personality fragment at sequence 2')
  const opRanges = map.filter((f) => f.authorityDomain === 'operating-principles').map((f) => ({ start: f.startCodeUnit, end: f.endCodeUnit }))
  return {
    section: { start: loc.midStart, end: loc.midEnd },
    personality,
    opRanges,
    behavioralSectionSha256: v.behavioralSectionSha256,
    classificationApprovalRef: B.CLASSIFICATION_REF,
    sourceCommit: B.SOURCE_COMMIT
  }
}

// PURE payload builder (NO writes). Reused by the future M3c-2 seeder + tests.
function buildPersonalityPayload (personaIdentity, mapping) {
  if (typeof personaIdentity !== 'string' || personaIdentity.length === 0) throw new MemoryError('VALIDATION_ERROR', 'personaIdentity must be a non-empty string')
  const anchor = resolveAnchor(personaIdentity, mapping)
  const f = anchor.personality
  const fragment = {
    sourceSequence: f.sequence,
    domainOrder: 1,
    fragmentClassificationRef: f.classificationRef,
    sourceStartCodeUnit: f.startCodeUnit,
    sourceEndCodeUnit: f.endCodeUnit,
    sourceSha256Utf8: f.sha256Utf8,
    text: personaIdentity.slice(f.startCodeUnit, f.endCodeUnit) // exact slice; no trim/normalize
  }
  const core = {
    format: 'ordered-fragments',
    schemaVersion: SCHEMA_VERSION,
    section: SECTION,
    sourceSymbol: B.SOURCE_SYMBOL,
    sourceCommit: anchor.sourceCommit,
    classificationApprovalRef: anchor.classificationApprovalRef,
    behavioralSectionSha256: anchor.behavioralSectionSha256,
    fragmentCount: 1,
    fragments: [fragment]
  }
  return Object.assign({}, core, { aggregateSha256: computeAggregateSha256(core) })
}

// Aggregate hash: canonical JSON (M1 canonicalize) over the payload EXCLUDING
// aggregateSha256. No delimiter concatenation. Independent of the envelope hash.
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

// Read-only diagnosis, scoped to the personality record only.
function diagnosePersonality (baseDir) {
  const storeExists = fs.existsSync(path.join(baseDir, PERSONALITY_STORE))
  const recordExists = fs.existsSync(path.join(baseDir, PERSONALITY_STORE, 'records', PERSONALITY_RECORD_ID))
  let revs, recState, events
  try {
    revs = store.listRevisions(baseDir, PERSONALITY_STORE, PERSONALITY_RECORD_ID)
    recState = store.getRecordState(baseDir, PERSONALITY_STORE, PERSONALITY_RECORD_ID)
    events = store.listEvents(baseDir, PERSONALITY_STORE, PERSONALITY_RECORD_ID)
  } catch (e) {
    return { unsafe: true, storeExists, recordExists, revisionCount: 0, anyUnreadableRevision: true, corruptEvents: [], approvedNotActive: false, active: { status: 'NONE' } }
  }
  const anyUnreadableRevision = revs.some((r) => r.__unreadable)
  const approvedNotActive = revs.some((r) => !r.__unreadable && revisionState(PERSONALITY_STORE, r.revisionId, events).state === 'approved')
  return { unsafe: false, storeExists, recordExists, revisionCount: revs.length, anyUnreadableRevision, corruptEvents: recState.corruptEvents, approvedNotActive, active: recState.active }
}

function notReadySubReason (dx) {
  if (!dx.storeExists) return 'STORE_ABSENT'
  if (!dx.recordExists) return 'RECORD_ABSENT'
  if (dx.revisionCount === 0) return 'ZERO_REVISION'
  if (dx.approvedNotActive) return 'APPROVED_NOT_ACTIVE'
  return 'NO_ACTIVE_REVISION'
}

// Closed-schema structural validation. Returns null on OK, else { detail }.
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
  if (!Number.isInteger(payload.fragmentCount) || payload.fragmentCount !== 1) return { detail: 'fragmentCount' }
  if (!Array.isArray(payload.fragments) || payload.fragments.length !== 1) return { detail: 'fragments-length' }
  const f = payload.fragments[0]
  if (f === null || typeof f !== 'object' || Array.isArray(f)) return { detail: 'fragment-not-object' }
  const fk = Object.keys(f).sort()
  if (fk.length !== FRAG_KEYS.length || !fk.every((k, i) => k === FRAG_KEYS[i])) return { detail: 'fragment-keys' }
  if (!Number.isInteger(f.sourceSequence)) return { detail: 'sourceSequence-type' }
  if (f.domainOrder !== 1) return { detail: 'domainOrder' }
  if (typeof f.fragmentClassificationRef !== 'string' || !f.fragmentClassificationRef) return { detail: 'fragmentClassificationRef-type' }
  if (!Number.isInteger(f.sourceStartCodeUnit) || f.sourceStartCodeUnit < 0) return { detail: 'sourceStartCodeUnit-type' }
  if (!Number.isInteger(f.sourceEndCodeUnit) || f.sourceEndCodeUnit <= f.sourceStartCodeUnit) return { detail: 'sourceEndCodeUnit-type' }
  if (typeof f.sourceSha256Utf8 !== 'string' || !HEX64.test(f.sourceSha256Utf8)) return { detail: 'sourceSha256Utf8-type' }
  if (typeof f.text !== 'string') return { detail: 'text-type' }
  return null
}

/**
 * ACTIVE-ONLY read-only verifier. Returns SAFE metadata only.
 */
function verifyPersonalityShadow (baseDir, personaIdentity, mapping) {
  const base = { recordId: PERSONALITY_RECORD_ID }

  // 2. TRUST ANCHOR
  let anchor
  try { anchor = resolveAnchor(personaIdentity, mapping) } catch (e) { return { status: REASON.MAPPING_CONTRACT_ERROR, ...base } }

  // 3/4/5 — resolver truth (record-scoped). Corruption precedes NOT_READY.
  const dx = diagnosePersonality(baseDir)
  if (dx.unsafe || dx.anyUnreadableRevision || dx.corruptEvents.length > 0) return { status: REASON.PERSONALITY_STORE_CORRUPT, ...base, corruptEvents: dx.corruptEvents, unreadableRevision: dx.anyUnreadableRevision }
  if (dx.active.status === 'AMBIGUOUS_ACTIVE_STATE') return { status: REASON.AMBIGUOUS_ACTIVE_PERSONALITY, ...base, candidates: dx.active.candidates }
  if (dx.active.status !== 'ACTIVE') return { status: REASON.NO_ACTIVE_PERSONALITY, ...base, subReason: notReadySubReason(dx), revisionCount: dx.revisionCount }

  // 6. active revision artifact integrity
  const rev = store.getRevision(baseDir, PERSONALITY_STORE, PERSONALITY_RECORD_ID, dx.active.revisionId)
  try { verifyRevision(rev) } catch (e) { return { status: REASON.PERSONALITY_REVISION_CORRUPT, ...base, revisionId: dx.active.revisionId } }
  const meta = Object.assign({}, base, { revisionId: dx.active.revisionId, activeRevisionId: dx.active.revisionId })
  const payload = rev.payload

  // 6b. M1 envelope authority domain must be "behavior" (personality store's M1 domain)
  if (rev.authorityDomain !== authorityDomain(PERSONALITY_STORE)) return { status: REASON.PERSONALITY_REVISION_CORRUPT, ...meta, detail: 'authority-domain' }

  // 7. closed-schema validation BEFORE any field use
  const sc = validatePayloadSchema(payload)
  if (sc) return { status: REASON.PERSONALITY_PAYLOAD_SCHEMA_INVALID, ...meta, detail: sc.detail }

  const f = payload.fragments[0]

  // 8/9. contamination (before generic cross-validation)
  const overlapsOp = anchor.opRanges.some((r) => f.sourceStartCodeUnit < r.end && f.sourceEndCodeUnit > r.start)
  if (OP_SEQUENCES.includes(f.sourceSequence) || overlapsOp) return { status: REASON.OPERATING_PRINCIPLES_DOMAIN_CONTAMINATION, ...meta, sequence: f.sourceSequence }
  if (f.sourceStartCodeUnit < anchor.section.start || f.sourceEndCodeUnit > anchor.section.end) return { status: REASON.NON_BEHAVIORAL_DOMAIN_CONTAMINATION, ...meta, sequence: f.sourceSequence }

  // 10. cross-validate against the M3a personality fragment (never trust payload self-description)
  const exp = anchor.personality
  if (payload.sourceCommit !== anchor.sourceCommit) return { status: REASON.PERSONALITY_FRAGMENT_MISMATCH, ...meta, detail: 'record-sourceCommit' }
  if (payload.sourceSymbol !== B.SOURCE_SYMBOL) return { status: REASON.PERSONALITY_FRAGMENT_MISMATCH, ...meta, detail: 'record-sourceSymbol' }
  if (payload.classificationApprovalRef !== anchor.classificationApprovalRef) return { status: REASON.PERSONALITY_FRAGMENT_MISMATCH, ...meta, detail: 'record-classificationApprovalRef' }
  if (payload.behavioralSectionSha256 !== anchor.behavioralSectionSha256) return { status: REASON.PERSONALITY_FRAGMENT_MISMATCH, ...meta, detail: 'record-behavioralSectionSha256' }
  if (f.sourceSequence !== exp.sequence) return { status: REASON.PERSONALITY_FRAGMENT_MISMATCH, ...meta, detail: 'sequence' }
  if (f.sourceStartCodeUnit !== exp.startCodeUnit || f.sourceEndCodeUnit !== exp.endCodeUnit) return { status: REASON.PERSONALITY_FRAGMENT_MISMATCH, ...meta, detail: 'range' }
  if (f.sourceSha256Utf8 !== exp.sha256Utf8) return { status: REASON.PERSONALITY_FRAGMENT_MISMATCH, ...meta, detail: 'source-hash' }
  if (f.fragmentClassificationRef !== exp.classificationRef) return { status: REASON.PERSONALITY_FRAGMENT_MISMATCH, ...meta, detail: 'classification' }
  const legacyText = personaIdentity.slice(f.sourceStartCodeUnit, f.sourceEndCodeUnit)
  if (f.text !== legacyText) return { status: REASON.PERSONALITY_FRAGMENT_MISMATCH, ...meta, detail: 'text' }
  if (B.sha256Utf8(f.text) !== f.sourceSha256Utf8) return { status: REASON.PERSONALITY_FRAGMENT_MISMATCH, ...meta, detail: 'text-hash' }

  // 11. aggregate hash (independent of envelope contentHash)
  if (computeAggregateSha256(payload) !== payload.aggregateSha256) return { status: REASON.PERSONALITY_AGGREGATE_HASH_MISMATCH, ...meta }

  // 12. reconstitution — the personality fragment re-embeds exactly at its source range
  const reOk = f.text === legacyText && sha256Hex(canonicalize(f.text)) === sha256Hex(canonicalize(legacyText)) &&
    (personaIdentity.slice(0, f.sourceStartCodeUnit) + f.text + personaIdentity.slice(f.sourceEndCodeUnit)) === personaIdentity
  const outMeta = Object.assign({}, meta, {
    fragmentCount: payload.fragments.length,
    aggregateSha256: payload.aggregateSha256,
    behavioralSectionSha256: payload.behavioralSectionSha256,
    reconstituteOk: reOk
  })
  if (!reOk) return { status: REASON.PERSONALITY_RECONSTITUTION_FAILED, ...outMeta }

  return { status: REASON.PASS, ...outMeta }
}

// Exit-code contract: 0 PASS · 2 FAIL · 3 config/tool · 4 NOT_READY.
function exitCodeFor (status) {
  if (status === REASON.PASS) return 0
  if (status === REASON.CONFIG_ERROR || status === REASON.MAPPING_CONTRACT_ERROR) return 3
  if (status === REASON.NO_ACTIVE_PERSONALITY) return 4
  return 2
}

module.exports = {
  PERSONALITY_STORE, PERSONALITY_RECORD_ID, SECTION, SCHEMA_VERSION, PERSONALITY_SEQUENCE, OP_SEQUENCES,
  ROOT_KEYS, FRAG_KEYS, REASON,
  resolveAnchor, buildPersonalityPayload, computeAggregateSha256,
  diagnosePersonality, validatePayloadSchema, verifyPersonalityShadow, exitCodeFor
}
