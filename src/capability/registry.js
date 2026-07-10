'use strict'

/**
 * registry.js — Capability Registry for the Aroma OS backend.
 *
 * A capability is a TYPED CONTRACT the OS can route work through — not code.
 * Each entry declares its id, version, lifecycle, input/output schemas, its risk
 * tier and whether human approval is required by default. The dispatcher/router
 * asks this registry two things: "give me the contract" (getCapability) and
 * "may I route to this?" (isRoutable).
 *
 * Lifecycle governs routability:
 *   'draft'      → not yet routable (still being defined).
 *   'active'     → routable, no warning.
 *   'deprecated' → still routable, but callers are WARNED to migrate.
 *   'retired'    → NOT routable.
 *
 * Versions are explicit integers. There is no implicit "latest" — a caller must
 * name the exact (id, version) it was built against, so an unknown version is
 * rejected rather than silently upgraded.
 */

const LIFECYCLES = ['draft', 'active', 'deprecated', 'retired']
const RISK_TIERS = ['none', 'low', 'medium', 'high']

/** Small helper for the JSON-Schema-ish typed contracts below. */
function objectSchema (properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

// Shared default contracts for capabilities without a bespoke schema.
const DEFAULT_INPUT = objectSchema(
  { payload: { type: 'object' }, context: { type: 'object' } },
  ['payload']
)
const DEFAULT_OUTPUT = objectSchema(
  { result: { type: 'object' }, notes: { type: 'string' } },
  ['result']
)

// The M1 capability set. All seeded at version 1, lifecycle 'active'.
// approval_default follows risk: medium/high require approval, none/low do not.
const SEED = [
  { id: 'Think', risk_tier: 'none' },
  { id: 'Plan', risk_tier: 'none' },
  { id: 'Research', risk_tier: 'low' },
  { id: 'Analyze', risk_tier: 'none' },
  { id: 'Develop', risk_tier: 'low' },
  { id: 'Review', risk_tier: 'low' },
  { id: 'Verify', risk_tier: 'low' },
  { id: 'Apply', risk_tier: 'medium' },
  { id: 'Report', risk_tier: 'none' },
  { id: 'Deploy', risk_tier: 'high' },
  { id: 'Rollback', risk_tier: 'high' },
  { id: 'Monitor', risk_tier: 'low' },
  { id: 'Learn', risk_tier: 'medium' }
]

const registry = new Map()

/** Composite key so (id, version) pairs are unique. */
function keyOf (id, version) {
  return `${id}@${version}`
}

function assertValidSpec (spec) {
  if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) {
    throw new TypeError('capability.id must be a non-empty string')
  }
  if (!Number.isInteger(spec.version) || spec.version < 1) {
    throw new TypeError(`capability.version must be a positive integer (got ${spec.version})`)
  }
  if (!LIFECYCLES.includes(spec.lifecycle)) {
    throw new TypeError(`capability.lifecycle must be one of ${LIFECYCLES.join('|')}`)
  }
  if (!RISK_TIERS.includes(spec.risk_tier)) {
    throw new TypeError(`capability.risk_tier must be one of ${RISK_TIERS.join('|')}`)
  }
  if (typeof spec.approval_default !== 'boolean') {
    throw new TypeError('capability.approval_default must be a boolean')
  }
}

/**
 * Register (or replace) a capability contract for a given (id, version).
 * Validates the shape, then stores a frozen, typed contract. Used both for the
 * seed and for real lifecycle transitions / version bumps.
 *
 * @param {{ id: string, version: number, lifecycle?: string, input_schema?: object,
 *           output_schema?: object, risk_tier?: string, approval_default?: boolean }} spec
 * @returns {object} the frozen contract that was stored
 */
function register (spec) {
  const risk_tier = spec.risk_tier || 'none'
  const contract = {
    id: spec.id,
    version: spec.version,
    lifecycle: spec.lifecycle || 'active',
    input_schema: spec.input_schema || DEFAULT_INPUT,
    output_schema: spec.output_schema || DEFAULT_OUTPUT,
    risk_tier,
    // medium/high work requires a human by default; none/low does not.
    approval_default: typeof spec.approval_default === 'boolean'
      ? spec.approval_default
      : (risk_tier === 'medium' || risk_tier === 'high')
  }
  assertValidSpec(contract)
  registry.set(keyOf(contract.id, contract.version), Object.freeze(contract))
  return registry.get(keyOf(contract.id, contract.version))
}

// Seed the registry.
for (const s of SEED) {
  register({ id: s.id, version: 1, lifecycle: 'active', risk_tier: s.risk_tier })
}

/**
 * Return the typed contract for an exact (id, version).
 * There is no implicit "latest": an unknown id/version is rejected.
 *
 * @param {string} id
 * @param {number} version
 * @returns {object} frozen capability contract
 * @throws {RangeError} if no capability matches (id, version)
 */
function getCapability (id, version) {
  const contract = registry.get(keyOf(id, version))
  if (!contract) {
    throw new RangeError(`unknown capability: ${keyOf(id, version)}`)
  }
  return contract
}

/**
 * List every capability currently in the 'active' lifecycle.
 * @returns {object[]} frozen contracts
 */
function listActive () {
  return [...registry.values()].filter(c => c.lifecycle === 'active')
}

/**
 * Whether the OS may route work to a capability version.
 *  - unknown / draft / retired → false (retired is explicitly non-routable)
 *  - deprecated                → true, but WARNS so callers migrate
 *  - active                    → true
 *
 * @param {string} id
 * @param {number} version
 * @returns {boolean}
 */
function isRoutable (id, version) {
  const contract = registry.get(keyOf(id, version))
  if (!contract) return false
  switch (contract.lifecycle) {
    case 'active':
      return true
    case 'deprecated':
      console.warn(`[AROMA-CAPABILITY] ${keyOf(id, version)} is deprecated — migrate to a newer version`)
      return true
    case 'retired':
    case 'draft':
    default:
      return false
  }
}

module.exports = {
  LIFECYCLES,
  RISK_TIERS,
  register,
  getCapability,
  listActive,
  isRoutable
}
