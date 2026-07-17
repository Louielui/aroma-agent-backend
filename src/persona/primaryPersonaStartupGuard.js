'use strict'

/**
 * primaryPersonaStartupGuard — Runtime Guard: a PURE Memory-readiness decision for a
 * PRIMARY process's persona source, evaluated ONCE at startup (before listen).
 *
 * Decision only — it NEVER process.exit()s, NEVER falls back, NEVER mutates env or
 * Memory, and NEVER re-implements the hybrid verifier. It delegates readiness to the
 * EXISTING persona-source path (R1 composeHybridPersona + R2 pin/driftReason), which
 * already enforces: identity/OP/personality active + shadow PASS, dual-store
 * behavioral reconstitution PASS (sectionByteIdentical + fullPersonaByteIdentical),
 * resolver↔active-revision pin, payload identity / provenance / aggregate / mapping /
 * closure / domain isolation, and full byte-identity to the frozen persona.
 *
 * Matrix (processRole, personaSourceMode) -> decision:
 *   - non-primary role                : allow (this guard governs the primary only)
 *   - primary + legacy                : allow, WITHOUT touching Memory (memory-free)
 *   - primary + hybrid + composer READY + no pin drift : allow (memory read)
 *   - primary + hybrid + NOT READY / drift / error     : DENY (fail-closed)
 *   - primary + anything else (e.g. shadow reaching here): DENY (config guard error)
 *
 * `deps.getPersonaSource` is injected (the existing personaSource.getPersonaSource in
 * production; a fake in tests) so the guard has no import/startup side effects and is
 * unit-testable without booting. For legacy it is never called (memory-free contract).
 */

const READY_CODE = 'PRIMARY_HYBRID_READY'
const NOT_READY_CODE = 'PRIMARY_HYBRID_NOT_READY'
const LEGACY_CODE = 'PRIMARY_LEGACY_ALLOWED'
const NON_PRIMARY_CODE = 'NON_PRIMARY_ROLE'
const GUARD_ERROR_CODE = 'PRIMARY_PERSONA_GUARD_ERROR'

// Echo only opaque uppercase status/reason codes; anything else collapses to a
// generic token so no persona text / path / secret can leak through diagnostics.
const SAFE_REASON = /^[A-Z0-9_:-]{1,64}$/
function safeReason (r) { return (typeof r === 'string' && SAFE_REASON.test(r)) ? r : 'NOT_READY' }

/**
 * @param {{processRole:string, personaSourceMode:string}} cfg  already-parsed config
 * @param {{getPersonaSource?:function}} deps  injected readiness provider
 * @returns {{allow:boolean, code:string, processRole:string, mode:string, memoryRead:boolean, reason?:string}}
 */
function evaluatePrimaryPersonaStartup (cfg, deps = {}) {
  const processRole = cfg && cfg.processRole
  const mode = cfg && cfg.personaSourceMode
  const base = { processRole, mode }

  // Only the PRIMARY startup is gated here. Other roles (persona-canary) own their
  // own readiness surface and are not this guard's concern.
  if (processRole !== 'primary') return Object.assign({ allow: true, code: NON_PRIMARY_CODE, memoryRead: false }, base)

  // Legacy: allowed WITHOUT reading Memory. This preserves the memory-free contract
  // and byte-identical legacy behavior — getPersonaSource is NOT called.
  if (mode === 'legacy') return Object.assign({ allow: true, code: LEGACY_CODE, memoryRead: false }, base)

  // Only `hybrid` should reach here for a primary (shadow/unknown are config-forbidden
  // upstream). Anything else is an internal inconsistency -> fail closed.
  if (mode !== 'hybrid') return Object.assign({ allow: false, code: GUARD_ERROR_CODE, reason: 'unexpected-mode', memoryRead: false }, base)

  const getSource = deps.getPersonaSource
  if (typeof getSource !== 'function') return Object.assign({ allow: false, code: GUARD_ERROR_CODE, reason: 'no-source-provider', memoryRead: false }, base)

  // Consult the EXISTING readiness path. It composes + pins once. Never re-implement.
  let src
  try { src = getSource() } catch (e) { return Object.assign({ allow: false, code: NOT_READY_CODE, reason: safeReason(e && (e.reason || e.code)), memoryRead: true }, base) }
  if (!src || src.ready !== true) return Object.assign({ allow: false, code: NOT_READY_CODE, reason: safeReason(src && src.initStatus), memoryRead: true }, base)

  // Belt-and-suspenders at startup: the pinned snapshot must still resolve (R2 drift
  // check re-resolves the three active revision IDs vs the pin).
  let drift = null
  try { drift = (typeof src.driftReason === 'function') ? src.driftReason() : null } catch (e) { drift = 'DRIFT_CHECK_ERROR' }
  if (drift) return Object.assign({ allow: false, code: NOT_READY_CODE, reason: safeReason(drift), memoryRead: true }, base)

  return Object.assign({ allow: true, code: READY_CODE, memoryRead: true }, base)
}

module.exports = { evaluatePrimaryPersonaStartup, safeReason, READY_CODE, NOT_READY_CODE, LEGACY_CODE, NON_PRIMARY_CODE, GUARD_ERROR_CODE }
