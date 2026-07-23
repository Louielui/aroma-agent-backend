'use strict'

/**
 * personaClosure.js — Persona Closure builder + verifier (Case B Step 1 hardened).
 *
 * Aggregates a fail-closed, content-addressed attestation that Identity /
 * Operating Principles / Personality each have one ACTIVE revision that self-
 * verifies (native verifyRevision + verifyEvent) and compose into a byte-identical
 * Hybrid Persona. Adds provenance hardening + productionReleaseReference /
 * supersedes semantics.
 *
 * INVARIANTS:
 *   - Native primitives only (canonical.canonicalize/sha256Hex/hashOf,
 *     envelope.verifyRevision, events.verifyEvent, manifest.getStoreManifest,
 *     store.resolveActiveRecord/getRevision/loadEvents, composeHybridPersona).
 *   - closurePayloadHash = hashOf(closureObject, 'closurePayloadHash').
 *   - productionPersonaMode is 'NOT_VERIFIED' ONLY.
 *   - productionReleaseReference.relationship is 'REFERENCE_ONLY' ONLY (fail closed).
 *   - supersedes lineage is a SEPARATE field { closurePath, closurePayloadHash,
 *     reason:'GENERATOR_PROVENANCE_INCOMPLETE' } — never in productionReleaseReference.
 *   - READ-ONLY on core-data (no write handle); storeIdentityHash equal before/after.
 *   - REAL generation requires COMPLETE generator provenance (clean tree + the
 *     sourceCommit actually contains the builder). Dry-run may run dirty but is
 *     stamped generatorProvenance:'INCOMPLETE' and is not usable for a real write.
 *   - No persona payload text ever enters the closure (hashes + ids only).
 */

const fs = require('fs')
const store = require('../core/memory/store')
const { verifyRevision } = require('../core/memory/envelope')
const { verifyEvent } = require('../core/memory/events')
const { getStoreManifest } = require('../core/memory/manifest')
const { canonicalize, sha256Hex, hashOf } = require('../core/memory/canonical')
const { composeHybridPersona } = require('./hybridPersonaComposer')
const { PERSONA_IDENTITY } = require('./xiangxiang')

const SCHEMA_VERSION = 'aroma-xiangxiang-persona-closure/1'
const PRODUCTION_PERSONA_MODE = 'NOT_VERIFIED' // ONLY permitted value
const RELATIONSHIP_REFERENCE_ONLY = 'REFERENCE_ONLY' // ONLY permitted relationship
const SUPERSEDES_REASON = 'GENERATOR_PROVENANCE_INCOMPLETE' // ONLY permitted supersedes reason

const DOMAINS = Object.freeze([
  { key: 'identity', store: 'identity', recordId: 'xiangxiang-identity' },
  { key: 'operatingPrinciples', store: 'operating-principles', recordId: 'xiangxiang-operating-principles' },
  { key: 'personality', store: 'personality', recordId: 'xiangxiang-personality' }
])

const NATIVE_FUNCTIONS_USED = Object.freeze([
  'store.resolveActiveRecord', 'store.getRevision', 'store.loadEvents',
  'envelope.verifyRevision', 'events.verifyEvent', 'manifest.getStoreManifest',
  'hybridPersonaComposer.composeHybridPersona', 'canonical.canonicalize', 'canonical.hashOf'
])

function closureError (code, detail) {
  const e = new Error(code + (detail ? ': ' + detail : ''))
  e.code = code; e.detail = detail || null
  return e
}
function is40HexCommit (s) { return typeof s === 'string' && /^[0-9a-f]{40}$/.test(s) }

function computeStoreIdentityHash (coreDir) {
  return sha256Hex(canonicalize(DOMAINS.map((d) => getStoreManifest(coreDir, d.store).generation)))
}

// --- validation of the two cross-reference fields (fail closed) -----------------
function validateProductionReleaseReference (prr) {
  if (prr == null) return null
  if (typeof prr !== 'object') throw closureError('RELEASE_REF_INVALID', 'must be an object or null')
  if (!is40HexCommit(prr.releaseCommit)) throw closureError('RELEASE_COMMIT_INVALID', 'releaseCommit must be a 40-char lowercase hex commit')
  if (prr.relationship !== RELATIONSHIP_REFERENCE_ONLY) throw closureError('RELATIONSHIP_INVALID', 'relationship must be REFERENCE_ONLY')
  const install = prr.installAuthorization
  if (!(install === null || (typeof install === 'string' && install.length > 0))) throw closureError('RELEASE_REF_INVALID', 'installAuthorization must be a non-empty string or null')
  return { releaseCommit: prr.releaseCommit, installAuthorization: install == null ? null : install, relationship: RELATIONSHIP_REFERENCE_ONLY }
}

// supersedes: validate shape + reason, then PROVE the prior artifact exists and its
// recorded closurePayloadHash matches (fail closed otherwise). READ-ONLY on the prior.
function validateAndVerifySupersedes (sup) {
  if (sup == null) return null
  if (typeof sup !== 'object') throw closureError('SUPERSEDES_INVALID', 'must be an object or null')
  if (typeof sup.closurePath !== 'string' || sup.closurePath.length === 0) throw closureError('SUPERSEDES_INVALID', 'closurePath required')
  if (typeof sup.closurePayloadHash !== 'string' || sup.closurePayloadHash.length !== 64) throw closureError('SUPERSEDES_INVALID', 'closurePayloadHash must be a 64-hex string')
  if (sup.reason !== SUPERSEDES_REASON) throw closureError('SUPERSEDES_REASON_INVALID', 'reason must be ' + SUPERSEDES_REASON)
  let prior
  try { prior = JSON.parse(fs.readFileSync(sup.closurePath, 'utf8')) } catch (e) { throw closureError('SUPERSEDES_PRIOR_MISSING', sup.closurePath + ': ' + e.message) }
  if (prior.closurePayloadHash !== sup.closurePayloadHash) throw closureError('SUPERSEDES_PRIOR_MISMATCH', 'prior closurePayloadHash does not match supplied hash')
  return { closurePath: sup.closurePath, closurePayloadHash: sup.closurePayloadHash, reason: SUPERSEDES_REASON }
}

// generatorProvenance is COMPLETE only when: mode real, tree clean, the sourceCommit
// ACTUALLY CONTAINS the builder, and sourceCommit is a full 40-hex commit.
function deriveGeneratorProvenance (mode, generatorCommit, provenance) {
  const p = provenance || {}
  const complete = mode === 'real' && p.workingTreeClean === true && p.builderInCommit === true && is40HexCommit(generatorCommit)
  return complete ? 'COMPLETE' : 'INCOMPLETE'
}

function buildDomainEvidence (coreDir, d) {
  const active = store.resolveActiveRecord(coreDir, d.store, d.recordId)
  if (!active || active.status !== 'ACTIVE' || !active.revisionId) throw closureError('DOMAIN_NOT_ACTIVE', `${d.key} (${d.store}) status=${active ? active.status : 'NONE'}`)
  const rev = store.getRevision(coreDir, d.store, d.recordId, active.revisionId)
  if (!rev) throw closureError('DOMAIN_REVISION_MISSING', `${d.key} revision ${active.revisionId}`)
  try { verifyRevision(rev) } catch (e) { throw closureError('REVISION_VERIFY_FAILED', `${d.key}: ${e.code || e.message}`) }
  const { events } = store.loadEvents(coreDir, d.store, d.recordId)
  const eventsOut = []
  for (const ev of events) {
    try { verifyEvent(ev) } catch (e) { throw closureError('EVENT_VERIFY_FAILED', `${d.key} event ${ev && ev.eventId}: ${e.code || e.message}`) }
    eventsOut.push({ eventId: ev.eventId, sequence: ev.sequence, eventType: ev.eventType, targetRevisionId: ev.targetRevisionId, expectedPreviousState: ev.expectedPreviousState, actor: ev.actor, eventVerify: 'PASS' })
  }
  const activatedEvents = events.filter((e) => e.eventType === 'ACTIVATED')
  const activated = activatedEvents[activatedEvents.length - 1] || null
  if (!activated) throw closureError('NO_ACTIVATED_EVENT', d.key)
  if (activated.targetRevisionId !== active.revisionId) throw closureError('ACTIVATED_MISMATCH', `${d.key} activated->${activated.targetRevisionId} active=${active.revisionId}`)
  return {
    store: d.store, recordId: d.recordId, activeRevisionId: active.revisionId, lifecycleState: 'ACTIVE',
    contentHash: rev.contentHash, revisionVerify: 'PASS', manifestHash: getStoreManifest(coreDir, d.store).generation,
    events: eventsOut, activatedEventId: activated.eventId, activatedMatchesActive: true
  }
}

/**
 * buildPersonaClosure — pure aggregation over READ functions; writes nothing.
 * @param {{coreDir, generatorCommit?, generatedAt?, generatorName?,
 *          productionReleaseReference?, supersedes?, provenance?, mode?}} opts
 *   mode: 'real' | 'dry-run' (default 'dry-run'). REAL requires COMPLETE provenance.
 *   provenance: { workingTreeClean, builderInCommit, builderPath, builderSha256,
 *                 verifierPath, verifierSha256 } (git facts supplied by the CLI).
 * @returns {{gen, closure}}
 */
function buildPersonaClosure (opts = {}) {
  const coreDir = opts.coreDir
  if (typeof coreDir !== 'string' || coreDir.length === 0) throw closureError('CONFIG_ERROR', 'coreDir required')
  const mode = opts.mode === 'real' ? 'real' : 'dry-run'

  const prr = validateProductionReleaseReference(opts.productionReleaseReference)
  const supersedes = validateAndVerifySupersedes(opts.supersedes)

  const generatorCommit = opts.generatorCommit || null
  const generatorProvenance = deriveGeneratorProvenance(mode, generatorCommit, opts.provenance)
  if (mode === 'real' && generatorProvenance !== 'COMPLETE') {
    const p = opts.provenance || {}
    throw closureError('PROVENANCE_INCOMPLETE', `real generation requires clean tree + builder-in-commit + 40hex commit (workingTreeClean=${p.workingTreeClean}, builderInCommit=${p.builderInCommit}, commit40hex=${is40HexCommit(generatorCommit)})`)
  }

  const preStoreIdentityHash = computeStoreIdentityHash(coreDir)
  const domains = {}
  for (const d of DOMAINS) domains[d.key] = buildDomainEvidence(coreDir, d)

  const hybrid = composeHybridPersona(coreDir, { personaIdentity: PERSONA_IDENTITY })
  if (!hybrid || hybrid.ready !== true) throw closureError('HYBRID_NOT_READY', hybrid ? (hybrid.status || hybrid.reason) : 'no result')
  const sm = hybrid.safeMetadata || {}
  const pin = hybrid.pin || {}
  if (sm.byteIdentical !== true) throw closureError('HYBRID_NOT_BYTE_IDENTICAL', hybrid.status)
  const hybridOut = {
    status: hybrid.status, ready: true, byteIdentical: true,
    legacySha256: sm.legacySha256 || null, hybridSha256: sm.hybridSha256 || null, tailSource: sm.tailSource || null,
    mappingSourceCommit: pin.mappingSourceCommit || sm.mappingSourceCommit || null,
    pin: { identityRevisionId: pin.identityRevisionId || null, operatingPrinciplesRevisionId: pin.operatingPrinciplesRevisionId || null, personalityRevisionId: pin.personalityRevisionId || null }
  }

  const gen = [domains.identity.activeRevisionId, domains.operatingPrinciples.activeRevisionId, domains.personality.activeRevisionId].map((r) => String(r).slice(0, 8)).join('-')
  const prov = opts.provenance || {}

  const closure = {
    schemaVersion: SCHEMA_VERSION,
    closureId: gen,
    generatedAt: opts.generatedAt || null,
    generator: {
      name: opts.generatorName || 'buildPersonaClosure',
      sourceCommit: generatorCommit,
      nodeVersion: process.version,
      builderPath: prov.builderPath || null,
      builderSha256: prov.builderSha256 || null,
      verifierPath: prov.verifierPath || null,
      verifierSha256: prov.verifierSha256 || null
    },
    generatorProvenance,
    memoryStore: { coreDir, storeIdentityHash: preStoreIdentityHash },
    domains,
    hybrid: hybridOut,
    nativeFunctionsUsed: NATIVE_FUNCTIONS_USED.slice(),
    productionReleaseReference: prr,
    productionPersonaMode: PRODUCTION_PERSONA_MODE,
    supersedes,
    evidenceSourcePaths: { coreDir, domainRecordDirs: DOMAINS.map((d) => ({ key: d.key, store: d.store, recordId: d.recordId })) },
    overallResult: 'VERIFIED',
    closurePayloadHash: ''
  }
  closure.closurePayloadHash = hashOf(closure, 'closurePayloadHash')

  const postStoreIdentityHash = computeStoreIdentityHash(coreDir)
  if (postStoreIdentityHash !== preStoreIdentityHash) throw closureError('STORE_MUTATED_DURING_BUILD', 'storeIdentityHash changed')

  return { gen, closure }
}

/** verifyPersonaClosure — independent, re-reads + re-verifies from scratch. */
function verifyPersonaClosure (closure, opts = {}) {
  const coreDir = opts.coreDir
  if (!closure || typeof closure !== 'object') throw closureError('CONFIG_ERROR', 'closure object required')
  if (typeof coreDir !== 'string' || coreDir.length === 0) throw closureError('CONFIG_ERROR', 'coreDir required')
  const mismatches = []

  const recomputed = hashOf(closure, 'closurePayloadHash')
  const payloadHashMatch = recomputed === closure.closurePayloadHash
  if (!payloadHashMatch) mismatches.push('closurePayloadHash: recomputed ' + recomputed.slice(0, 12) + ' != stored ' + String(closure.closurePayloadHash).slice(0, 12))

  for (const d of DOMAINS) {
    const stored = closure.domains && closure.domains[d.key]
    if (!stored) { mismatches.push(d.key + ': missing from closure'); continue }
    let active
    try { active = store.resolveActiveRecord(coreDir, d.store, d.recordId) } catch (e) { mismatches.push(d.key + ': resolve error ' + (e.code || e.message)); continue }
    if (!active || active.status !== 'ACTIVE') { mismatches.push(d.key + ': not ACTIVE (' + (active && active.status) + ')'); continue }
    if (active.revisionId !== stored.activeRevisionId) mismatches.push(d.key + ': activeRevisionId drift')
    const rev = store.getRevision(coreDir, d.store, d.recordId, active.revisionId)
    if (!rev) { mismatches.push(d.key + ': revision missing'); continue }
    try { verifyRevision(rev) } catch (e) { mismatches.push(d.key + ': verifyRevision ' + (e.code || e.message)) }
    if (rev.contentHash !== stored.contentHash) mismatches.push(d.key + ': contentHash drift')
    const { events } = store.loadEvents(coreDir, d.store, d.recordId)
    for (const ev of events) { try { verifyEvent(ev) } catch (e) { mismatches.push(d.key + ': verifyEvent ' + (ev && ev.eventId) + ' ' + (e.code || e.message)) } }
    if (getStoreManifest(coreDir, d.store).generation !== stored.manifestHash) mismatches.push(d.key + ': manifestHash drift')
  }

  try {
    const hybrid = composeHybridPersona(coreDir, { personaIdentity: PERSONA_IDENTITY })
    const sm = (hybrid && hybrid.safeMetadata) || {}
    if (!hybrid || hybrid.ready !== true) mismatches.push('hybrid: not READY (' + (hybrid && hybrid.status) + ')')
    else if (sm.byteIdentical !== (closure.hybrid && closure.hybrid.byteIdentical)) mismatches.push('hybrid: byteIdentical drift')
  } catch (e) { mismatches.push('hybrid: compose error ' + (e.code || e.message)) }

  if (closure.productionPersonaMode !== PRODUCTION_PERSONA_MODE) mismatches.push('productionPersonaMode must be NOT_VERIFIED')
  if (closure.productionReleaseReference != null && closure.productionReleaseReference.relationship !== RELATIONSHIP_REFERENCE_ONLY) mismatches.push('productionReleaseReference.relationship must be REFERENCE_ONLY')
  if (closure.supersedes != null && closure.supersedes.reason !== SUPERSEDES_REASON) mismatches.push('supersedes.reason must be ' + SUPERSEDES_REASON)

  return { ok: payloadHashMatch && mismatches.length === 0, payloadHashMatch, mismatches }
}

module.exports = {
  SCHEMA_VERSION, PRODUCTION_PERSONA_MODE, RELATIONSHIP_REFERENCE_ONLY, SUPERSEDES_REASON, DOMAINS, NATIVE_FUNCTIONS_USED,
  buildPersonaClosure, verifyPersonaClosure, computeStoreIdentityHash,
  is40HexCommit, validateProductionReleaseReference, validateAndVerifySupersedes, deriveGeneratorProvenance
}
