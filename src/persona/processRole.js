'use strict'

/**
 * processRole — R4a process-role guard.
 *
 * Resolves AROMA_PROCESS_ROLE and validates it against PERSONA_SOURCE at startup,
 * FAIL-CLOSED. A `primary` process may run `legacy` (memory-free) or `hybrid`; the
 * `hybrid` combination is only CONFIG-permitted here and is additionally gated at
 * startup by the Memory-readiness guard (primaryPersonaStartupGuard) — this module
 * reads NO Memory. `primary + shadow` stays forbidden (shadow is a canary-only
 * diagnostic that would compose+pin yet still serve legacy — a confusing half-state
 * on the primary). A `persona-canary` role may run any mode.
 *
 * Authority is the PROCESS ENVIRONMENT only — never a request / header / query /
 * cookie / body / user input / Memory payload. This module reads no Memory, loads
 * no composer, and calls no model; it only parses two env strings and applies a
 * fixed matrix. It reuses R2's persona-mode parser (personaSource.parseMode) without
 * changing R2/R3 semantics.
 *
 * Matching is EXACT — no case-folding, no whitespace trimming, no aliases.
 */

const { parseMode, PersonaSourceConfigError } = require('./personaSource') // reuse R2 mode parser (memory-free)

const VALID_ROLES = Object.freeze(['primary', 'persona-canary'])

class ProcessRoleConfigError extends Error {
  constructor (detail) { super('process role config error'); this.name = 'ProcessRoleConfigError'; this.code = 'PROCESS_ROLE_CONFIG_ERROR'; this.detail = detail }
}

// Resolve the process role from env. Unset/empty -> 'primary'. Exact match only.
function resolveProcessRole (env) {
  const v = env && env.AROMA_PROCESS_ROLE
  if (v == null || v === '') return 'primary'
  if (v === 'primary' || v === 'persona-canary') return v
  throw new ProcessRoleConfigError('unknown AROMA_PROCESS_ROLE') // fail closed (value not echoed)
}

/**
 * Pure config-layer validation of a (role, personaSourceMode) pair. Takes already
 * PARSED values — never a request object. Returns SAFE metadata only.
 * @param {{processRole:string, personaSourceMode:string}} cfg
 * @returns {{valid:boolean, status:string, reason:(string|null), processRole:string, personaSourceMode:string}}
 */
function validateProcessPersonaConfig (cfg) {
  const processRole = cfg && cfg.processRole
  const personaSourceMode = cfg && cfg.personaSourceMode
  const out = (valid, status, reason) => ({ valid: !!valid, status, reason: reason || null, processRole, personaSourceMode })
  if (!VALID_ROLES.includes(processRole)) return out(false, 'PROCESS_ROLE_CONFIG_ERROR', 'unknown-role')
  if (personaSourceMode !== 'legacy' && personaSourceMode !== 'shadow' && personaSourceMode !== 'hybrid') return out(false, 'PERSONA_SOURCE_CONFIG_ERROR', 'unknown-mode')
  // A primary process may run legacy (memory-free) or hybrid. `primary + hybrid` is
  // CONFIG-permitted here; whether the hybrid composer is actually READY is enforced
  // separately at startup by primaryPersonaStartupGuard (this layer reads NO Memory).
  // `primary + shadow` stays forbidden — shadow serves legacy to the model while
  // composing/pinning, a pointless half-state on the primary.
  if (processRole === 'primary' && personaSourceMode === 'shadow') return out(false, 'PRIMARY_SHADOW_FORBIDDEN', 'primary-shadow')
  // persona-canary + legacy|shadow|hybrid, and primary + legacy|hybrid, are valid at
  // the CONFIG layer. Whether hybrid is actually READY is decided later (R1/R2 + guard).
  return out(true, 'PROCESS_CONFIG_VALID', null)
}

/**
 * Evaluate the full startup config from env (role + persona source + matrix).
 * Never throws — parser failures become a fail-closed result. SAFE metadata only.
 * @param {object} env
 */
function evaluateStartupConfig (env) {
  let processRole
  try { processRole = resolveProcessRole(env) } catch (e) {
    return { valid: false, status: 'PROCESS_ROLE_CONFIG_ERROR', reason: (e && e.code) || 'PROCESS_ROLE_CONFIG_ERROR', processRole: null, personaSourceMode: null }
  }
  let personaSourceMode
  try { personaSourceMode = parseMode(env) } catch (e) {
    const code = (e instanceof PersonaSourceConfigError || (e && e.code === 'PERSONA_SOURCE_CONFIG_ERROR')) ? 'PERSONA_SOURCE_CONFIG_ERROR' : 'PERSONA_SOURCE_CONFIG_ERROR'
    return { valid: false, status: code, reason: code, processRole, personaSourceMode: null }
  }
  return validateProcessPersonaConfig({ processRole, personaSourceMode })
}

module.exports = { VALID_ROLES, ProcessRoleConfigError, resolveProcessRole, validateProcessPersonaConfig, evaluateStartupConfig }
