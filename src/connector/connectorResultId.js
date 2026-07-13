'use strict'

/**
 * connectorResultId.js — Phase 2 Gate 1 (MCP connector). Mint and validate an
 * OPAQUE, random result handle bound to (principal, app, window,
 * egressPolicyVersion, classificationPolicyVersion) with a TTL. The id itself
 * carries no data; the binding record is held by the caller (the projection
 * endpoint). Validation is fail-closed: any mismatch, expiry, or a policy-version
 * change invalidates the handle. Pure — `now` and `rng` are injected for
 * deterministic tests.
 */

const crypto = require('node:crypto')

const DEFAULT_TTL_MS = 300000 // 5 minutes (Owner decision C-(d))

const REQUIRED_BINDINGS = ['principal', 'app', 'window', 'egressPolicyVersion', 'classificationPolicyVersion']

/**
 * Mint an opaque handle + its binding record.
 * @param {{ principal, app, window, egressPolicyVersion, classificationPolicyVersion,
 *   ttlMs?: number, now: number, rng?: (n:number)=>Buffer }} args
 * @returns {{ id: string, record: object }}
 */
function mint (args = {}) {
  for (const k of REQUIRED_BINDINGS) {
    if (typeof args[k] !== 'string' || args[k] === '') throw new TypeError(`mint requires non-empty ${k}`)
  }
  if (typeof args.now !== 'number' || !Number.isFinite(args.now)) throw new TypeError('mint requires an injected numeric now (ms)')
  const ttl = Number.isInteger(args.ttlMs) && args.ttlMs > 0 ? args.ttlMs : DEFAULT_TTL_MS
  const bytes = typeof args.rng === 'function' ? args.rng(32) : crypto.randomBytes(32)
  const id = Buffer.from(bytes).toString('base64url') // opaque — reveals nothing

  const record = {
    id,
    principal: args.principal,
    app: args.app,
    window: args.window,
    egressPolicyVersion: args.egressPolicyVersion,
    classificationPolicyVersion: args.classificationPolicyVersion,
    issuedAt: args.now,
    expiresAt: args.now + ttl
  }
  return { id, record }
}

/**
 * Validate a presented id against its stored record and the current context.
 * @returns {{ valid: boolean, code: 'OK'|'ID_MISMATCH'|'EXPIRED'|'PRINCIPAL_MISMATCH'
 *   |'APP_MISMATCH'|'WINDOW_MISMATCH'|'POLICY_VERSION_CHANGED' }}
 */
function validate (args = {}) {
  const { id, record, principal, app, window, egressPolicyVersion, classificationPolicyVersion, now } = args
  if (!record || typeof record !== 'object') return { valid: false, code: 'ID_MISMATCH' }
  if (typeof id !== 'string' || id !== record.id) return { valid: false, code: 'ID_MISMATCH' }
  if (typeof now !== 'number' || now >= record.expiresAt) return { valid: false, code: 'EXPIRED' }
  if (principal !== record.principal) return { valid: false, code: 'PRINCIPAL_MISMATCH' }
  if (app !== record.app) return { valid: false, code: 'APP_MISMATCH' }
  if (window !== record.window) return { valid: false, code: 'WINDOW_MISMATCH' }
  if (egressPolicyVersion !== record.egressPolicyVersion || classificationPolicyVersion !== record.classificationPolicyVersion) {
    return { valid: false, code: 'POLICY_VERSION_CHANGED' }
  }
  return { valid: true, code: 'OK' }
}

module.exports = { mint, validate, DEFAULT_TTL_MS, REQUIRED_BINDINGS }
