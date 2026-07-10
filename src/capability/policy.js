'use strict'

/**
 * policy.js — Policy Engine for the Aroma OS backend.
 *
 * The Policy Engine runs BEFORE dispatch. Given a routing request it decides
 * whether the OS may proceed automatically ('allow'), must pause for a human
 * ('require_approval'), or must refuse outright ('deny'). It never dispatches
 * anything itself and therefore deliberately does NOT import any dispatcher
 * module — coupling to dispatch here would invert the control flow.
 *
 * Decisions are driven by an ordered data table (RULES), not by a tangle of
 * hardcoded if-statements. Rules are evaluated in strict priority order and the
 * FIRST matching rule wins, so ordering encodes precedence (e.g. a deny always
 * beats a would-be allow because it sits earlier in the table).
 *
 * The only external dependency is the Capability Registry, consulted read-only
 * via getCapability to look up a capability's risk_tier. Everything else is
 * in-memory: no file I/O, no network.
 */

const { getCapability, isRoutable } = require('./registry')

// Data domains / keywords that are never allowed to flow through automatically.
const SENSITIVE_TERMS = ['banking', 'cra', 'sin', 'secrets']

// Word-boundary matcher so 'sin' matches the word SIN but not e.g. "using".
const SENSITIVE_WORD_RE = new RegExp(`\\b(${SENSITIVE_TERMS.join('|')})\\b`, 'i')

/** True if the request context touches any sensitive data domain. */
function touchesSensitiveDomain (context) {
  const domains = context && Array.isArray(context.data_domains) ? context.data_domains : []
  return domains.some(d => SENSITIVE_TERMS.includes(String(d).toLowerCase()))
}

/** True if the free-text description mentions a sensitive term (case-insensitive). */
function descriptionIsSensitive (context) {
  const description = context && typeof context.description === 'string' ? context.description : ''
  return SENSITIVE_WORD_RE.test(description)
}

/**
 * The ordered rule table. Each entry is pure data plus a `match` predicate that
 * receives ({ request, context, capability }) and returns a boolean. The engine
 * walks this table top-to-bottom and stops at the first match.
 *
 *   requires_backup — whether a successful action must be backed up first. Only
 *   the auto-apply rule sets it; every other outcome leaves it false.
 */
const RULES = [
  {
    id: 'deny-sensitive-data',
    verdict: 'deny',
    requires_backup: false,
    reason: 'request touches a sensitive data domain (banking/cra/sin/secrets)',
    match: ({ context }) => touchesSensitiveDomain(context) || descriptionIsSensitive(context)
  },
  {
    id: 'prod-deploy-approval',
    verdict: 'require_approval',
    requires_backup: false,
    reason: 'Deploy/Rollback to production requires human approval',
    match: ({ request }) =>
      (request.capabilityId === 'Deploy' || request.capabilityId === 'Rollback') &&
      request.target === 'production'
  },
  {
    id: 'apply-dev-auto',
    verdict: 'allow',
    requires_backup: true,
    reason: 'Apply to dev is auto-approved but must be backed up first',
    match: ({ request }) => request.capabilityId === 'Apply' && request.target === 'dev'
  },
  {
    id: 'high-risk-approval',
    verdict: 'require_approval',
    requires_backup: false,
    reason: 'high risk_tier capability defaults to human approval',
    // Safety net: any high-risk capability with no earlier match stops rather
    // than proceeding, so future high-risk capabilities fail safe.
    match: ({ capability }) => capability.risk_tier === 'high'
  },
  {
    id: 'default-allow',
    verdict: 'allow',
    requires_backup: false,
    reason: 'no restricting rule matched',
    match: () => true
  }
]

/**
 * Evaluate a routing request against the ordered rule table.
 *
 * @param {{ capabilityId: string, version?: number, target: ('dev'|'production'|null),
 *           context?: { description?: string, data_domains?: string[] } }} request
 * @returns {{ verdict: ('allow'|'require_approval'|'deny'), reason: string,
 *             rule_id: string, requires_backup: boolean }}
 * @throws {TypeError} if the request is malformed
 * @throws {RangeError} if the capability is not routable
 */
function evaluate (request) {
  if (!request || typeof request.capabilityId !== 'string' || request.capabilityId.length === 0) {
    throw new TypeError('request.capabilityId must be a non-empty string')
  }

  // No implicit "latest": callers name a version; default only for convenience.
  const version = request.version == null ? 1 : request.version

  // The Policy Engine refuses to reason about work the OS could not route.
  if (!isRoutable(request.capabilityId, version)) {
    throw new RangeError(`not routable: ${request.capabilityId}@${version}`)
  }

  // Read-only lookup of the typed contract (for risk_tier). Routable ⇒ exists.
  const capability = getCapability(request.capabilityId, version)
  const context = request.context || {}

  for (const rule of RULES) {
    if (rule.match({ request, context, capability })) {
      return {
        verdict: rule.verdict,
        reason: rule.reason,
        rule_id: rule.id,
        requires_backup: rule.requires_backup
      }
    }
  }

  // Unreachable: 'default-allow' matches everything. Kept as a defensive guard.
  throw new Error('no policy rule matched — the rule table is missing a default')
}

/**
 * Return the ordered rule table as plain data (without the match predicates),
 * so callers can introspect precedence without executing anything.
 *
 * @returns {{ rule_id: string, verdict: string, requires_backup: boolean, reason: string }[]}
 */
function listRules () {
  return RULES.map(r => ({
    rule_id: r.id,
    verdict: r.verdict,
    requires_backup: r.requires_backup,
    reason: r.reason
  }))
}

module.exports = {
  evaluate,
  listRules
}
