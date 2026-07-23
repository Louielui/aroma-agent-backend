'use strict'

/**
 * hybridPersonaComposer — R1 read-only Hybrid Persona Composer.
 *
 * Composes a persona from the ACTIVE Memory stores PLUS the frozen legacy tail, and
 * proves it is byte-identical to the frozen PERSONA_IDENTITY:
 *
 *   hybridPersona = verifiedIdentityText          // [0,807)  from the identity store
 *                 + verifiedBehavioralText         // [807,1586) from OP + Personality (dual-store proof)
 *                 + legacyTail                     // [1586,end) = PERSONA_IDENTITY.slice(1586), FROZEN legacy
 *
 * This is a HYBRID composer, NOT a fully-memory composer: the [1586,end) tail
 * (Stable Business Context + Runtime & Governance Awareness) is NOT yet governed by
 * a Memory store, so it is sourced from the frozen legacy constant (tailSource =
 * 'legacy-frozen'). The `memory` mode name is reserved for when that tail is also
 * Memory-governed.
 *
 * Read-only: no writes, no lifecycle, no runtime coupling. It reuses the existing
 * identity shadow, dual-store behavioral reconstitution, and both payload-identity
 * provers — none weakened, no merge logic re-written. On failure / NOT_READY it
 * returns SAFE metadata only and NEVER the persona text. R1 builds the pin only;
 * per-request drift re-checks are R2.
 */

const store = require('../core/memory/store')
const identityShadow = require('../core/memory/shadow/identityShadow')
const opShadow = require('../core/memory/shadow/operatingPrinciplesShadow')
const psShadow = require('../core/memory/shadow/personalityShadow')
const BR = require('../core/memory/shadow/behavioralReconstitution')

const IDENTITY_STORE = 'identity'
const TAIL_START_CODE_UNIT = 1586
const TAIL_SOURCE = 'legacy-frozen'

const STATUS = Object.freeze({
  HYBRID_PERSONA_READY: 'HYBRID_PERSONA_READY',
  HYBRID_PERSONA_NOT_READY: 'HYBRID_PERSONA_NOT_READY',
  CONFIG_ERROR: 'CONFIG_ERROR',
  MAPPING_CONTRACT_ERROR: 'MAPPING_CONTRACT_ERROR',
  IDENTITY_VERIFICATION_FAILED: 'IDENTITY_VERIFICATION_FAILED',
  OP_VERIFICATION_FAILED: 'OP_VERIFICATION_FAILED',
  PERSONALITY_VERIFICATION_FAILED: 'PERSONALITY_VERIFICATION_FAILED',
  BEHAVIORAL_RECONSTITUTION_FAILED: 'BEHAVIORAL_RECONSTITUTION_FAILED',
  TAIL_MISMATCH: 'TAIL_MISMATCH',
  FULL_PERSONA_TEXT_MISMATCH: 'FULL_PERSONA_TEXT_MISMATCH',
  FULL_PERSONA_HASH_MISMATCH: 'FULL_PERSONA_HASH_MISMATCH',
  AMBIGUOUS_ACTIVE_STATE: 'AMBIGUOUS_ACTIVE_STATE',
  STORE_CORRUPT: 'STORE_CORRUPT'
})

// NOT_READY sub-reasons.
const NOT_READY = Object.freeze({
  IDENTITY_NOT_ACTIVE: 'IDENTITY_NOT_ACTIVE',
  OPERATING_PRINCIPLES_STORE_ABSENT: 'OPERATING_PRINCIPLES_STORE_ABSENT',
  OPERATING_PRINCIPLES_NOT_ACTIVE: 'OPERATING_PRINCIPLES_NOT_ACTIVE',
  PERSONALITY_STORE_ABSENT: 'PERSONALITY_STORE_ABSENT',
  PERSONALITY_NOT_ACTIVE: 'PERSONALITY_NOT_ACTIVE',
  BEHAVIORAL_RECONSTITUTION_NOT_READY: 'BEHAVIORAL_RECONSTITUTION_NOT_READY'
})

function sha256Utf8 (s) { return require('crypto').createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex') }
const notReady = (reason, extra) => Object.assign({ ready: false, status: STATUS.HYBRID_PERSONA_NOT_READY, reason }, extra)
const fail = (status, extra) => Object.assign({ ready: false, status, reason: status }, extra)

/**
 * @param {string} coreDir  AROMA_CORE_DIR (absolute)
 * @param {object} options { personaIdentity }
 * @returns {object} SAFE-by-default result. On READY, `.personaText` and `.pin` are
 *   present for in-process consumers (R2); callers must NEVER print `.personaText`.
 */
function composeHybridPersona (coreDir, options = {}) {
  const persona = options.personaIdentity
  if (typeof persona !== 'string' || persona.length === 0) return fail(STATUS.CONFIG_ERROR, { detail: 'persona-unavailable' })

  // Anchor / mapping (also proves 9-fragment continuity of [807,1586)).
  let anchor
  try { anchor = BR.resolveAnchor(persona) } catch (e) { return fail(STATUS.MAPPING_CONTRACT_ERROR, { detail: e.code || 'mapping' }) }

  // ---- Identity ----------------------------------------------------------
  const idActive = store.resolveActiveRecord(coreDir, IDENTITY_STORE, identityShadow.IDENTITY_RECORD_ID)
  if (idActive.status === 'AMBIGUOUS_ACTIVE_STATE') return fail(STATUS.AMBIGUOUS_ACTIVE_STATE, { identityStatus: 'AMBIGUOUS' })
  if (idActive.status !== 'ACTIVE') return notReady(NOT_READY.IDENTITY_NOT_ACTIVE, { identityStatus: idActive.status })
  const idV = identityShadow.verifyIdentityShadow(coreDir, persona)
  if (idV.status !== 'PASS') {
    if (idV.status === identityShadow.REASON.IDENTITY_STORE_CORRUPT) return fail(STATUS.STORE_CORRUPT, { identityStatus: idV.status })
    if (idV.status === identityShadow.REASON.AMBIGUOUS_ACTIVE_IDENTITY) return fail(STATUS.AMBIGUOUS_ACTIVE_STATE, { identityStatus: idV.status })
    if (idV.status === identityShadow.REASON.NO_ACTIVE_IDENTITY) return notReady(NOT_READY.IDENTITY_NOT_ACTIVE, { identityStatus: idV.status })
    return fail(STATUS.IDENTITY_VERIFICATION_FAILED, { identityStatus: idV.status })
  }
  const idRev = store.getRevision(coreDir, IDENTITY_STORE, identityShadow.IDENTITY_RECORD_ID, idActive.revisionId)
  const identityText = (idRev && idRev.payload && typeof idRev.payload.text === 'string') ? idRev.payload.text : null
  if (identityText == null) return fail(STATUS.IDENTITY_VERIFICATION_FAILED, { detail: 'identity-text-missing' })

  // ---- Behavioral (dual-store reconstitution) ----------------------------
  const brV = BR.verifyBehavioralReconstitution(coreDir, persona)
  if (brV.status === BR.REASON.MAPPING_CONTRACT_ERROR) return fail(STATUS.MAPPING_CONTRACT_ERROR)
  if (brV.status === BR.REASON.STORE_CORRUPT) return fail(STATUS.STORE_CORRUPT, { behavioralStatus: brV.status })
  if (brV.status === BR.REASON.AMBIGUOUS_ACTIVE_STATE) return fail(STATUS.AMBIGUOUS_ACTIVE_STATE, { behavioralStatus: brV.status })
  if (brV.status === BR.REASON.BEHAVIORAL_RECONSTITUTION_NOT_READY) return notReady(brV.subReason || NOT_READY.BEHAVIORAL_RECONSTITUTION_NOT_READY, { opStatus: brV.operatingPrinciplesStatus, personalityStatus: brV.personalityStatus })
  if (brV.status === BR.REASON.OP_PAYLOAD_IDENTITY_FAILED) return fail(STATUS.OP_VERIFICATION_FAILED, { detail: brV.detail })
  if (brV.status === BR.REASON.PERSONALITY_PAYLOAD_IDENTITY_FAILED) return fail(STATUS.PERSONALITY_VERIFICATION_FAILED, { detail: brV.detail })
  if (brV.status !== BR.REASON.PASS) return fail(STATUS.BEHAVIORAL_RECONSTITUTION_FAILED, { behavioralStatus: brV.status })

  // reuse the verified merge to obtain the behavioral text (no re-written merge logic)
  const opActive = store.resolveActiveRecord(coreDir, opShadow.OP_STORE, opShadow.OP_RECORD_ID)
  const psActive = store.resolveActiveRecord(coreDir, psShadow.PERSONALITY_STORE, psShadow.PERSONALITY_RECORD_ID)
  const opRev = store.getRevision(coreDir, opShadow.OP_STORE, opShadow.OP_RECORD_ID, opActive.revisionId)
  const psRev = store.getRevision(coreDir, psShadow.PERSONALITY_STORE, psShadow.PERSONALITY_RECORD_ID, psActive.revisionId)
  const combined = BR.combineFragments(opRev.payload.fragments, psRev.payload.fragments)
  const rec = BR.reconstituteBehavioral(combined, persona, anchor)
  if (!rec.ok || typeof rec.section !== 'string') return fail(STATUS.BEHAVIORAL_RECONSTITUTION_FAILED, { detail: rec.reason })
  const behavioralText = rec.section

  // ---- Frozen legacy tail [1586,end) -------------------------------------
  const legacyTail = persona.slice(TAIL_START_CODE_UNIT)
  const legacyTailSha256 = sha256Utf8(legacyTail)
  // tail is a direct slice of the frozen persona; the invariant below is the guard.
  if (persona.slice(0, TAIL_START_CODE_UNIT) + legacyTail !== persona) return fail(STATUS.TAIL_MISMATCH)

  // ---- Full composition + byte identity ----------------------------------
  const hybridPersona = identityText + behavioralText + legacyTail
  if (hybridPersona.length !== persona.length || hybridPersona !== persona) return fail(STATUS.FULL_PERSONA_TEXT_MISMATCH)
  const hybridPersonaSha256 = sha256Utf8(hybridPersona)
  if (hybridPersonaSha256 !== sha256Utf8(persona)) return fail(STATUS.FULL_PERSONA_HASH_MISMATCH)

  // ---- Immutable pin (this exact verified snapshot) ----------------------
  const pin = Object.freeze({
    identityRevisionId: idActive.revisionId,
    operatingPrinciplesRevisionId: opActive.revisionId,
    personalityRevisionId: psActive.revisionId,
    mappingSourceCommit: anchor.sourceCommit,
    identityPayloadSha256: sha256Utf8(identityText),
    behavioralSectionSha256: rec.sectionSha,
    legacyTailSha256,
    hybridPersonaSha256
  })

  return {
    ready: true,
    status: STATUS.HYBRID_PERSONA_READY,
    reason: STATUS.HYBRID_PERSONA_READY,
    personaText: hybridPersona, // in-process only; callers must never print this
    personaSha256: hybridPersonaSha256,
    pin,
    safeMetadata: buildSafeMetadata(pin, anchor, brV, legacyTailSha256, hybridPersonaSha256, persona)
  }
}

function buildSafeMetadata (pin, anchor, brV, legacyTailSha256, hybridPersonaSha256, persona) {
  return {
    identityRevisionId: pin.identityRevisionId,
    operatingPrinciplesRevisionId: pin.operatingPrinciplesRevisionId,
    personalityRevisionId: pin.personalityRevisionId,
    mappingSourceCommit: pin.mappingSourceCommit,
    identityStatus: 'PASS', opStatus: 'PASS', personalityStatus: 'PASS', behavioralStatus: 'PASS',
    tailSource: TAIL_SOURCE, tailStartCodeUnit: TAIL_START_CODE_UNIT,
    legacySha256: sha256Utf8(persona), hybridSha256: hybridPersonaSha256,
    byteIdentical: true
  }
}

// Exit-code contract: 0 READY · 2 FAIL · 3 config/tool · 4 NOT_READY.
function exitCodeFor (status) {
  if (status === STATUS.HYBRID_PERSONA_READY) return 0
  if (status === STATUS.CONFIG_ERROR || status === STATUS.MAPPING_CONTRACT_ERROR) return 3
  if (status === STATUS.HYBRID_PERSONA_NOT_READY) return 4
  return 2
}

module.exports = { STATUS, NOT_READY, TAIL_START_CODE_UNIT, TAIL_SOURCE, composeHybridPersona, exitCodeFor }
