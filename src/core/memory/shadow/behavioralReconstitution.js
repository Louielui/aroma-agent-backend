'use strict'

/**
 * behavioralReconstitution — M3 dual-store behavioral reconstitution proof
 * (read-only; no writes, no lifecycle, no runtime coupling).
 *
 * Proves that when BOTH the operating-principles store (8 fragments, sequences
 * 1,3,4,5,6,7,8,9) and the personality store (1 fragment, sequence 2) are ACTIVE,
 * their stored fragments reassemble — in source sequence order 1..9 — into the exact
 * frozen behavioral section of PERSONA_IDENTITY (code units [807,1586)), and that
 * the full persona reconstructs byte-identically.
 *
 * TRUST ANCHOR: the M3a mapping + frozen PERSONA_IDENTITY only — NEVER the store
 * payloads' self-description. Both stores must independently pass their active-only
 * shadow verifiers AND their read-only payload-identity provers before any merge.
 * Domain isolation is enforced (OP holds no sequence 2; personality holds only
 * sequence 2, no OP sequence/range). ACTIVE-ONLY: a non-active store → NOT_READY.
 *
 * Read-only: no createRevision/recordEvent/rebuildIndex/submit/approve/activate.
 * SAFE metadata only (never fragment / section / persona text).
 */

const fs = require('fs')
const path = require('path')
const { MemoryError } = require('../errors')
const { canonicalize, sha256Hex } = require('../canonical')
const store = require('../store')
const B = require('./behavioralMapping')
const opShadow = require('./operatingPrinciplesShadow')
const psShadow = require('./personalityShadow')
const opSubmit = require('./operatingPrinciplesSubmit')
const psSubmit = require('./personalitySubmit')

const OP_SEQUENCES = Object.freeze([1, 3, 4, 5, 6, 7, 8, 9])
const PERSONALITY_SEQUENCE = 2
const FULL_SEQUENCE_SET = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9])

const REASON = Object.freeze({
  PASS: 'PASS',
  BEHAVIORAL_RECONSTITUTION_NOT_READY: 'BEHAVIORAL_RECONSTITUTION_NOT_READY',
  CONFIG_ERROR: 'CONFIG_ERROR',
  MAPPING_CONTRACT_ERROR: 'MAPPING_CONTRACT_ERROR',
  STORE_CORRUPT: 'STORE_CORRUPT',
  AMBIGUOUS_ACTIVE_STATE: 'AMBIGUOUS_ACTIVE_STATE',
  OP_PAYLOAD_IDENTITY_FAILED: 'OP_PAYLOAD_IDENTITY_FAILED',
  PERSONALITY_PAYLOAD_IDENTITY_FAILED: 'PERSONALITY_PAYLOAD_IDENTITY_FAILED',
  DOMAIN_CONTAMINATION: 'DOMAIN_CONTAMINATION',
  SEQUENCE_SET_MISMATCH: 'SEQUENCE_SET_MISMATCH',
  FRAGMENT_GAP: 'FRAGMENT_GAP',
  FRAGMENT_OVERLAP: 'FRAGMENT_OVERLAP',
  FRAGMENT_RANGE_MISMATCH: 'FRAGMENT_RANGE_MISMATCH',
  BEHAVIORAL_SECTION_TEXT_MISMATCH: 'BEHAVIORAL_SECTION_TEXT_MISMATCH',
  BEHAVIORAL_SECTION_HASH_MISMATCH: 'BEHAVIORAL_SECTION_HASH_MISMATCH',
  FULL_PERSONA_RECONSTITUTION_FAILED: 'FULL_PERSONA_RECONSTITUTION_FAILED'
})

// NOT_READY sub-reasons.
const SUB = Object.freeze({
  OPERATING_PRINCIPLES_STORE_ABSENT: 'OPERATING_PRINCIPLES_STORE_ABSENT',
  OPERATING_PRINCIPLES_NOT_ACTIVE: 'OPERATING_PRINCIPLES_NOT_ACTIVE',
  PERSONALITY_STORE_ABSENT: 'PERSONALITY_STORE_ABSENT',
  PERSONALITY_NOT_ACTIVE: 'PERSONALITY_NOT_ACTIVE',
  BOTH_DOMAINS_NOT_ACTIVE: 'BOTH_DOMAINS_NOT_ACTIVE'
})

// Resolve the authoritative geometry from the verified M3a mapping. Also proves
// mapping continuity: exactly 9 fragments, sequences 1..9, contiguous [807,1586).
function resolveAnchor (personaIdentity, mapping) {
  const map = mapping || B.MAPPING
  const v = B.verifyBehavioralMapping(personaIdentity, map)
  if (v.status !== 'PASS') throw new MemoryError('MAPPING_CONTRACT_ERROR', v.reason || 'mapping verification failed')
  const loc = B.locateSection(personaIdentity)
  if (loc.err) throw new MemoryError('MAPPING_CONTRACT_ERROR', 'section markers invalid')
  const bySeq = new Map()
  for (const f of map) bySeq.set(f.sequence, { start: f.startCodeUnit, end: f.endCodeUnit, sha: f.sha256Utf8, classificationRef: f.classificationRef, authorityDomain: f.authorityDomain })
  // continuity: seqs exactly 1..9, contiguous tiling of the section
  const seqs = map.map((f) => f.sequence).sort((a, b) => a - b)
  if (seqs.length !== 9 || !seqs.every((s, i) => s === i + 1)) throw new MemoryError('MAPPING_CONTRACT_ERROR', 'sequence set is not 1..9')
  let cursor = loc.midStart
  for (const s of FULL_SEQUENCE_SET) { const e = bySeq.get(s); if (!e || e.start !== cursor) throw new MemoryError('MAPPING_CONTRACT_ERROR', 'mapping not contiguous'); cursor = e.end }
  if (cursor !== loc.midEnd) throw new MemoryError('MAPPING_CONTRACT_ERROR', 'mapping does not cover the section')
  return { section: { start: loc.midStart, end: loc.midEnd }, bySeq, behavioralSectionSha256: v.behavioralSectionSha256, sourceCommit: B.SOURCE_COMMIT }
}

// Read-only per-store diagnosis: exists / corrupt / ambiguous / active / rev.
function diagnoseStore (baseDir, storeName, recordId) {
  const exists = fs.existsSync(path.join(baseDir, storeName))
  let revs, recState, active
  try {
    revs = store.listRevisions(baseDir, storeName, recordId)
    recState = store.getRecordState(baseDir, storeName, recordId)
    active = store.resolveActiveRecord(baseDir, storeName, recordId)
  } catch (e) { return { exists, corrupt: true, ambiguous: false, active: false, rev: null } }
  const corrupt = revs.some((r) => r.__unreadable) || recState.corruptEvents.length > 0
  const ambiguous = active.status === 'AMBIGUOUS_ACTIVE_STATE'
  const isActive = active.status === 'ACTIVE'
  const rev = isActive ? store.getRevision(baseDir, storeName, recordId, active.revisionId) : null
  return { exists, corrupt, ambiguous, active: isActive, rev }
}

// PURE: build the combined 9-fragment set from the two stores' payload fragments.
function combineFragments (opFragments, personalityFragments) {
  const pick = (f) => ({ sourceSequence: f.sourceSequence, sourceStartCodeUnit: f.sourceStartCodeUnit, sourceEndCodeUnit: f.sourceEndCodeUnit, sourceSha256Utf8: f.sourceSha256Utf8, fragmentClassificationRef: f.fragmentClassificationRef, text: f.text })
  return opFragments.map(pick).concat(personalityFragments.map(pick))
}

// PURE: domain isolation over the two payloads' fragments.
function checkDomainIsolation (opFragments, personalityFragments, anchor) {
  const pr = anchor.bySeq.get(PERSONALITY_SEQUENCE)
  for (const f of opFragments) {
    if (f.sourceSequence === PERSONALITY_SEQUENCE) return { ok: false, detail: 'op-has-personality-sequence' }
    if (f.sourceStartCodeUnit < pr.end && f.sourceEndCodeUnit > pr.start) return { ok: false, detail: 'op-overlaps-personality-range' }
  }
  if (personalityFragments.length !== 1) return { ok: false, detail: 'personality-fragment-count' }
  for (const f of personalityFragments) {
    if (OP_SEQUENCES.includes(f.sourceSequence)) return { ok: false, detail: 'personality-has-op-sequence' }
    for (const s of OP_SEQUENCES) { const r = anchor.bySeq.get(s); if (f.sourceStartCodeUnit < r.end && f.sourceEndCodeUnit > r.start) return { ok: false, detail: 'personality-overlaps-op-range' } }
  }
  return { ok: true, detail: null }
}

// PURE: ordered merge + behavioral-section + full-persona reconstitution.
// Returns { ok, reason, sequenceSet, sectionSha, sectionByteIdentical, fullPersonaByteIdentical }.
function reconstituteBehavioral (combined, personaIdentity, anchor) {
  const bySeq = combined.slice().sort((a, b) => a.sourceSequence - b.sourceSequence)
  const sequenceSet = bySeq.map((f) => f.sourceSequence)
  if (sequenceSet.length !== 9 || !sequenceSet.every((s, i) => s === i + 1)) return { ok: false, reason: REASON.SEQUENCE_SET_MISMATCH, sequenceSet }
  // per-fragment range must match the mapping expectation for its sequence
  for (const f of bySeq) { const e = anchor.bySeq.get(f.sourceSequence); if (f.sourceStartCodeUnit !== e.start || f.sourceEndCodeUnit !== e.end) return { ok: false, reason: REASON.FRAGMENT_RANGE_MISMATCH, sequenceSet } }
  // tiling by position (sequence order == position order)
  let cursor = anchor.section.start
  for (const f of bySeq) {
    if (f.sourceStartCodeUnit < cursor) return { ok: false, reason: REASON.FRAGMENT_OVERLAP, sequenceSet }
    if (f.sourceStartCodeUnit > cursor) return { ok: false, reason: REASON.FRAGMENT_GAP, sequenceSet }
    cursor = f.sourceEndCodeUnit
  }
  if (cursor !== anchor.section.end) return { ok: false, reason: cursor < anchor.section.end ? REASON.FRAGMENT_GAP : REASON.FRAGMENT_OVERLAP, sequenceSet }
  // concatenate in sequence order — no trim / normalize / delimiter
  const section = bySeq.map((f) => f.text).join('')
  const legacySection = personaIdentity.slice(anchor.section.start, anchor.section.end)
  const sectionByteIdentical = section === legacySection
  if (!sectionByteIdentical) return { ok: false, reason: REASON.BEHAVIORAL_SECTION_TEXT_MISMATCH, sequenceSet, sectionByteIdentical: false }
  const sectionSha = B.sha256Utf8(section)
  if (sectionSha !== anchor.behavioralSectionSha256) return { ok: false, reason: REASON.BEHAVIORAL_SECTION_HASH_MISMATCH, sequenceSet, sectionSha }
  const full = personaIdentity.slice(0, anchor.section.start) + section + personaIdentity.slice(anchor.section.end)
  const fullPersonaByteIdentical = full === personaIdentity
  if (!fullPersonaByteIdentical) return { ok: false, reason: REASON.FULL_PERSONA_RECONSTITUTION_FAILED, sequenceSet, sectionSha, sectionByteIdentical: true, fullPersonaByteIdentical: false }
  // `section` is returned additively (verified behavioral text) so consumers such as
  // the hybrid persona composer can reuse the verified merge without re-writing it.
  // The safe verifier output (verifyBehavioralReconstitution / CLI) does NOT include
  // it, so this adds no leak and does not change status / precedence / semantics.
  return { ok: true, reason: REASON.PASS, sequenceSet, sectionSha, sectionByteIdentical: true, fullPersonaByteIdentical: true, section }
}

// Static read-only runtime-isolation probe: does index.js/app.js reach core/memory?
function runtimeReachability () {
  const SRC = path.resolve(__dirname, '../../..')
  const resolveReq = (d, rel) => { const b = path.resolve(d, rel); for (const c of [b, b + '.js', path.join(b, 'index.js')]) { try { if (fs.statSync(c).isFile()) return c } catch (e) {} } return null }
  const reach = (entry) => { const seen = new Set(); const st = [entry]; while (st.length) { const f = st.pop(); if (!f || seen.has(f)) continue; seen.add(f); let s; try { s = fs.readFileSync(f, 'utf8') } catch (e) { continue } const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g; let m; while ((m = re.exec(s))) { const t = resolveReq(path.dirname(f), m[1]); if (t) st.push(t) } } return seen }
  let count = 0
  for (const e of ['index.js', 'app.js']) { const entry = resolveReq(SRC, e); if (!entry) continue; count += [...reach(entry)].filter((f) => /[\\/]core[\\/]memory[\\/]/.test(f)).length }
  return count
}

/**
 * Read-only dual-store verifier. Returns SAFE metadata only.
 */
function verifyBehavioralReconstitution (baseDir, personaIdentity, mapping) {
  const base = {}
  let anchor
  try { anchor = resolveAnchor(personaIdentity, mapping) } catch (e) { return { status: REASON.MAPPING_CONTRACT_ERROR, ...base } }

  const op = diagnoseStore(baseDir, opShadow.OP_STORE, opShadow.OP_RECORD_ID)
  const ps = diagnoseStore(baseDir, psShadow.PERSONALITY_STORE, psShadow.PERSONALITY_RECORD_ID)

  // corruption / ambiguity (exit 2) precede readiness
  if (op.corrupt || ps.corrupt) return { status: REASON.STORE_CORRUPT, ...base, operatingPrinciplesStatus: op.corrupt ? 'CORRUPT' : undefined, personalityStatus: ps.corrupt ? 'CORRUPT' : undefined }
  if (op.ambiguous || ps.ambiguous) return { status: REASON.AMBIGUOUS_ACTIVE_STATE, ...base }

  // readiness (exit 4)
  if (!op.active && !ps.active) return notReady(SUB.BOTH_DOMAINS_NOT_ACTIVE, op, ps)
  if (!op.active) return notReady(op.exists ? SUB.OPERATING_PRINCIPLES_NOT_ACTIVE : SUB.OPERATING_PRINCIPLES_STORE_ABSENT, op, ps)
  if (!ps.active) return notReady(ps.exists ? SUB.PERSONALITY_NOT_ACTIVE : SUB.PERSONALITY_STORE_ABSENT, op, ps)

  // active-state proof: both shadow verifiers must PASS
  const opV = opShadow.verifyOperatingPrinciplesShadow(baseDir, personaIdentity)
  const psV = psShadow.verifyPersonalityShadow(baseDir, personaIdentity)
  if (opV.status !== opShadow.REASON.PASS) return { status: REASON.OP_PAYLOAD_IDENTITY_FAILED, ...base, detail: 'op-shadow:' + opV.status, operatingPrinciplesStatus: opV.status, personalityStatus: psV.status }
  if (psV.status !== psShadow.REASON.PASS) return { status: REASON.PERSONALITY_PAYLOAD_IDENTITY_FAILED, ...base, detail: 'ps-shadow:' + psV.status, operatingPrinciplesStatus: opV.status, personalityStatus: psV.status }

  const opFrags = op.rev.payload.fragments
  const psFrags = ps.rev.payload.fragments

  // domain isolation (before the merge)
  const iso = checkDomainIsolation(opFrags, psFrags, anchor)
  if (!iso.ok) return { status: REASON.DOMAIN_CONTAMINATION, ...base, detail: iso.detail }

  // payload identity re-proof (reuse the existing read-only provers, unweakened)
  const opId = opSubmit.provePayloadIdentity(op.rev, opShadow.buildOperatingPrinciplesPayload(personaIdentity), personaIdentity)
  if (!opId.ok) return { status: REASON.OP_PAYLOAD_IDENTITY_FAILED, ...base, detail: opId.detail }
  const psId = psSubmit.provePayloadIdentity(ps.rev, psShadow.buildPersonalityPayload(personaIdentity), personaIdentity)
  if (!psId.ok) return { status: REASON.PERSONALITY_PAYLOAD_IDENTITY_FAILED, ...base, detail: psId.detail }

  // ordered merge + reconstitution
  const combined = combineFragments(opFrags, psFrags)
  const rec = reconstituteBehavioral(combined, personaIdentity, anchor)
  const meta = {
    operatingPrinciplesStatus: 'PASS', personalityStatus: 'PASS',
    fragmentCount: combined.length, sequenceSet: rec.sequenceSet,
    behavioralStartCodeUnit: anchor.section.start, behavioralEndCodeUnit: anchor.section.end,
    expectedSectionSha256: anchor.behavioralSectionSha256, actualSectionSha256: rec.sectionSha,
    sectionByteIdentical: !!rec.sectionByteIdentical, fullPersonaByteIdentical: !!rec.fullPersonaByteIdentical,
    runtimeReachability: runtimeReachability()
  }
  if (!rec.ok) return { status: rec.reason, ...meta }
  return { status: REASON.PASS, ...meta }
}

function notReady (subReason, op, ps) {
  return { status: REASON.BEHAVIORAL_RECONSTITUTION_NOT_READY, subReason, operatingPrinciplesStatus: op.active ? 'ACTIVE' : (op.exists ? 'NOT_ACTIVE' : 'ABSENT'), personalityStatus: ps.active ? 'ACTIVE' : (ps.exists ? 'NOT_ACTIVE' : 'ABSENT') }
}

// Exit-code contract: 0 PASS · 2 FAIL · 3 config/tool · 4 NOT_READY.
function exitCodeFor (status) {
  if (status === REASON.PASS) return 0
  if (status === REASON.CONFIG_ERROR || status === REASON.MAPPING_CONTRACT_ERROR) return 3
  if (status === REASON.BEHAVIORAL_RECONSTITUTION_NOT_READY) return 4
  return 2
}

module.exports = {
  OP_SEQUENCES, PERSONALITY_SEQUENCE, FULL_SEQUENCE_SET, REASON, SUB,
  resolveAnchor, diagnoseStore, combineFragments, checkDomainIsolation, reconstituteBehavioral, runtimeReachability,
  verifyBehavioralReconstitution, exitCodeFor
}
