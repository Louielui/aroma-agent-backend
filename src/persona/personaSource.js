'use strict'

/**
 * personaSource — R2 Runtime Persona Source Selector.
 *
 * Chooses the runtime persona per `PERSONA_SOURCE` ∈ { legacy | shadow | hybrid }:
 *
 *   legacy (default): runtime persona = frozen PERSONA_IDENTITY. Reads NO Memory,
 *     loads NO composer / core/memory, builds NO pin — byte-identical to today.
 *   shadow: composes + pins the Hybrid Persona at init for readiness/drift tracking,
 *     but the model ALWAYS receives the legacy PERSONA_IDENTITY. Hybrid text is
 *     NEVER handed to the prompt builder.
 *   hybrid: uses the pinned Hybrid Persona ONLY when it verified READY at init and
 *     the per-request active-revision pin still matches. Otherwise FAIL CLOSED — no
 *     model call, no fallback to legacy.
 *
 * CRITICAL: this module's top-level imports touch ONLY the frozen persona constant
 * (via xiangxiang) — NOT the composer, NOT core/memory. The composer + core/memory
 * are lazy-`require`d only inside the non-legacy init path, so `legacy` truly loads
 * no Memory dependency. Unknown `PERSONA_SOURCE` fails closed. The pin is built once
 * at init and NEVER auto-updated; re-pinning requires a process restart.
 */

const crypto = require('crypto')
const { PERSONA_IDENTITY } = require('./xiangxiang') // persona constant ONLY (no core/memory)
const telemetry = require('./personaTelemetry') // memory-free structured logging
const nodePath = require('path')

// Fixed allowlist of the ONLY internal modules the non-legacy path may load. Using a
// computed path (not a `require('./relative')` literal) keeps these OUT of the static
// require-graph — so the runtime persona path stays statically zero-reachable to
// core/memory, and legacy (which never calls this) loads nothing. The key is ALWAYS
// a hardcoded internal literal — never from env / request / header / user / Memory
// payload / arbitrary caller argument. Any unapproved key fails closed. This is NOT
// a general module loader.
const ALLOWED_MODULES = Object.freeze({
  'core/memory/store': '../core/memory/store',
  hybridPersonaComposer: './hybridPersonaComposer'
})
function dynLoad (key) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_MODULES, key)) throw new PersonaSourceConfigError('unapproved dynamic module')
  return require(nodePath.resolve(__dirname, ALLOWED_MODULES[key]))
}
function sha256Utf8 (s) { return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex') }

const VALID_MODES = Object.freeze(['legacy', 'shadow', 'hybrid'])
const IDENTITY_RECORD_ID = 'xiangxiang-identity'
const OP_STORE = 'operating-principles'
const OP_RECORD_ID = 'xiangxiang-operating-principles'
const PS_STORE = 'personality'
const PS_RECORD_ID = 'xiangxiang-personality'

class PersonaSourceConfigError extends Error {
  constructor (detail) { super('persona source config error'); this.name = 'PersonaSourceConfigError'; this.code = 'PERSONA_SOURCE_CONFIG_ERROR'; this.detail = detail }
}
class PersonaSourceUnavailableError extends Error {
  constructor (reason) { super('persona source unavailable'); this.name = 'PersonaSourceUnavailableError'; this.code = 'PERSONA_SOURCE_UNAVAILABLE'; this.reason = reason }
}

function parseMode (env) {
  const v = env && env.PERSONA_SOURCE
  if (v == null || v === '') return 'legacy'
  if (VALID_MODES.includes(v)) return v
  throw new PersonaSourceConfigError('unknown PERSONA_SOURCE') // fail closed (no leak of the value)
}

/**
 * Build a persona source. Legacy is memory-free. Non-legacy composes + pins ONCE.
 * @param {object} opts { env?, coreDir? }
 */
function createPersonaSource (opts = {}) {
  const env = opts.env || process.env
  const tel = opts.telemetry || telemetry
  const sink = opts.telemetrySink // undefined -> console (default)
  const mode = parseMode(env)

  if (mode === 'legacy') {
    // Startup telemetry emitted ONCE at creation; NO Memory / composer load.
    tel.recordStartup({ personaSourceMode: 'legacy', status: 'LEGACY_ACTIVE', ready: true, modelPersonaSource: 'legacy', memoryReadAttempted: false, pinState: 'NOT_APPLICABLE', byteIdentical: null }, sink)
    return {
      mode: 'legacy',
      ready: true,
      runtimePersona () { return { mode: 'legacy', personaText: PERSONA_IDENTITY, drift: false, pinStatus: null } },
      safeMetadata () { return { mode: 'legacy' } }
    }
  }

  // ---- NON-LEGACY: lazy-load Memory dependencies ONLY here (allowlisted keys) --
  const store = dynLoad('core/memory/store')
  const composer = dynLoad('hybridPersonaComposer')
  const coreDir = opts.coreDir || store.resolveCoreDir()
  const composed = composer.composeHybridPersona(coreDir, { personaIdentity: PERSONA_IDENTITY })
  const ready = composed.ready === true
  const pin = ready ? composed.pin : null // immutable; never auto-updated
  const hybridPersona = ready ? composed.personaText : null
  const initStatus = composed.status
  const sm = composed.safeMetadata || {}

  // Startup readiness telemetry (safe metadata only), emitted ONCE at creation.
  {
    const exit = composer.exitCodeFor(composed.status)
    let status, modelPersonaSource, pinState
    if (mode === 'shadow') {
      modelPersonaSource = 'legacy'
      status = ready ? 'SHADOW_READY' : (exit === 4 ? 'SHADOW_NOT_READY' : 'SHADOW_VERIFICATION_FAILED')
      pinState = ready ? 'CURRENT' : 'UNAVAILABLE'
    } else {
      status = ready ? 'HYBRID_READY' : (exit === 4 ? 'HYBRID_NOT_READY' : 'HYBRID_VERIFICATION_FAILED')
      modelPersonaSource = ready ? 'hybrid' : 'none'
      pinState = ready ? 'CURRENT' : 'UNAVAILABLE'
    }
    tel.recordStartup({
      personaSourceMode: mode, status, reason: ready ? null : (composed.reason || composed.status), ready,
      modelPersonaSource, memoryReadAttempted: true, pinState,
      identityRevisionId: pin ? pin.identityRevisionId : null, operatingPrinciplesRevisionId: pin ? pin.operatingPrinciplesRevisionId : null, personalityRevisionId: pin ? pin.personalityRevisionId : null,
      mappingSourceCommit: pin ? pin.mappingSourceCommit : null,
      legacyPersonaSha256: sm.legacySha256 || sha256Utf8(PERSONA_IDENTITY), hybridPersonaSha256: sm.hybridSha256 || null,
      byteIdentical: ready ? (sm.byteIdentical === true) : null, tailSource: sm.tailSource || null
    }, sink)
  }

  // Safe metadata used for drift telemetry (revision ids + mapping commit only).
  function driftMeta () {
    return {
      personaSourceMode: mode, status: 'PERSONA_SOURCE_PIN_DRIFT', reason: 'PERSONA_SOURCE_PIN_DRIFT', ready: mode === 'shadow',
      modelPersonaSource: mode === 'hybrid' ? 'none' : 'legacy', memoryReadAttempted: true, pinState: 'DRIFT',
      identityRevisionId: pin ? pin.identityRevisionId : null, operatingPrinciplesRevisionId: pin ? pin.operatingPrinciplesRevisionId : null, personalityRevisionId: pin ? pin.personalityRevisionId : null,
      mappingSourceCommit: pin ? pin.mappingSourceCommit : null
    }
  }

  // Cheap per-request drift check: re-resolve the three active revision IDs and
  // compare to the pin. Any difference / non-ACTIVE / ambiguous => drift.
  function driftReason () {
    if (!pin) return 'NO_PIN'
    const id = store.resolveActiveRecord(coreDir, 'identity', IDENTITY_RECORD_ID)
    const op = store.resolveActiveRecord(coreDir, OP_STORE, OP_RECORD_ID)
    const ps = store.resolveActiveRecord(coreDir, PS_STORE, PS_RECORD_ID)
    if (id.status !== 'ACTIVE' || op.status !== 'ACTIVE' || ps.status !== 'ACTIVE') return 'PERSONA_SOURCE_PIN_DRIFT'
    if (id.revisionId !== pin.identityRevisionId || op.revisionId !== pin.operatingPrinciplesRevisionId || ps.revisionId !== pin.personalityRevisionId) return 'PERSONA_SOURCE_PIN_DRIFT'
    return null
  }

  return {
    mode,
    ready,
    initStatus,
    pin, // safe: revision ids + hashes only (no persona text)
    driftReason, // exposed for tests / R3
    runtimePersona () {
      if (mode === 'shadow') {
        // The model ALWAYS uses legacy in shadow; hybrid text is never returned here.
        if (!pin) return { mode: 'shadow', personaText: PERSONA_IDENTITY, drift: false, ready: false, readiness: initStatus, pinStatus: 'NO_PIN' }
        const dr = driftReason()
        // Telemetry is NON-AUTHORITATIVE and deduped; it never changes routing.
        if (dr) tel.recordPinDrift(driftMeta(), sink)
        return { mode: 'shadow', personaText: PERSONA_IDENTITY, drift: !!dr, driftReason: dr, ready: true, pinStatus: dr ? 'PERSONA_SOURCE_PIN_DRIFT' : 'PIN_CURRENT' }
      }
      // hybrid: fail closed unless READY at init AND the pin still matches.
      if (!ready) throw new PersonaSourceUnavailableError(initStatus)
      const dr = driftReason()
      if (dr) { tel.recordPinDrift(driftMeta(), sink); throw new PersonaSourceUnavailableError(dr) }
      return { mode: 'hybrid', personaText: hybridPersona, drift: false, ready: true, pinStatus: 'PIN_CURRENT' }
    },
    safeMetadata () {
      return {
        mode,
        ready,
        initStatus,
        pinnedIdentityRevisionId: pin ? pin.identityRevisionId : null,
        pinnedOperatingPrinciplesRevisionId: pin ? pin.operatingPrinciplesRevisionId : null,
        pinnedPersonalityRevisionId: pin ? pin.personalityRevisionId : null,
        mappingSourceCommit: pin ? pin.mappingSourceCommit : null
      }
    }
  }
}

// Per-process singleton — created ONCE, never auto-updated. Re-pin requires restart
// (or an explicit test reset). intakeService uses this for the demo persona slot.
let _singleton = null
function getPersonaSource (opts) {
  if (!_singleton) _singleton = createPersonaSource(opts)
  return _singleton
}
function _resetForTest () { _singleton = null }

module.exports = { createPersonaSource, getPersonaSource, parseMode, VALID_MODES, ALLOWED_MODULES, dynLoad, PersonaSourceConfigError, PersonaSourceUnavailableError, _resetForTest }
