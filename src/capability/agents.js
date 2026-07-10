'use strict'

/**
 * agents.js — Agent Registry & Runtime Health for the Aroma OS backend.
 *
 * Where registry.js answers "what typed contracts exist?", this module answers
 * "who can actually do the work, and how well are they doing it right now?".
 *
 * An AGENT MANIFEST is a static declaration: an agent (id/role/adapter) claims to
 * PROVIDE a set of capabilities, each pinned to an exact (capability, version)
 * with a seed quality and cost estimate. Every provided capability must be
 * routable in the Capability Registry — we never let an agent advertise an
 * unknown or retired contract.
 *
 * A HEALTH RECORD is the live, rolling counterpart: keyed by (agentId,
 * capability, version), it tracks the observed success rate, latency and cost as
 * events stream in. The router uses seed values until real samples exist, then
 * switches to the live numbers — see rankByHealth.
 *
 * Everything is in-memory: no file I/O, no network, no persistence.
 */

const { isRoutable } = require('./registry')

const AVAILABILITIES = ['local', 'cloud', 'manual-relay']
const STATUSES = ['active', 'inactive']
const HEALTH_AVAILABILITIES = ['up', 'degraded', 'down']

// Manifests keyed by agent id.
const agents = new Map()
// Live health records keyed by (agentId, capability, version).
const health = new Map()

/** Composite key so (agentId, capability, version) triples are unique. */
function healthKey (agentId, capabilityId, version) {
  return `${agentId}::${capabilityId}@${version}`
}

/**
 * Map a cost to a comparable number (lower is cheaper). Live health carries a
 * numeric rolling cost; manifest seeds carry a coarse string tier. Both flow
 * through here so ranking can compare them uniformly.
 */
function costValue (cost) {
  if (typeof cost === 'number') return cost
  switch (cost) {
    case 'free': return 0
    case '$': return 1
    case '$$': return 2
    case '$$$': return 3
    default: return Number.POSITIVE_INFINITY // unknown tier ranks worst
  }
}

/** Map a health availability to a comparable rank (higher is better). */
function availabilityRank (availability) {
  switch (availability) {
    case 'up': return 2
    case 'degraded': return 1
    case 'down': return 0
    default: return -1
  }
}

/** Derive a coarse availability from a rolling success rate. */
function availabilityFromQuality (quality) {
  if (quality >= 0.9) return 'up'
  if (quality >= 0.6) return 'degraded'
  return 'down'
}

/**
 * Validate and register an agent manifest. Every provided capability must be
 * routable in the Capability Registry; an unknown or retired capability is
 * rejected so an agent can never advertise a contract the OS won't route.
 *
 * @param {{ id: string, role: string, adapter: string,
 *           provides: Array<{ capability: string, version: number,
 *             seed_quality: number, seed_cost: string }>,
 *           availability: string, status: string }} manifest
 * @returns {object} the stored manifest
 */
function registerAgent (manifest) {
  if (!manifest || typeof manifest.id !== 'string' || manifest.id.length === 0) {
    throw new TypeError('manifest.id must be a non-empty string')
  }
  if (typeof manifest.role !== 'string' || manifest.role.length === 0) {
    throw new TypeError('manifest.role must be a non-empty string')
  }
  if (typeof manifest.adapter !== 'string' || manifest.adapter.length === 0) {
    throw new TypeError('manifest.adapter must be a non-empty string')
  }
  if (!AVAILABILITIES.includes(manifest.availability)) {
    throw new TypeError(`manifest.availability must be one of ${AVAILABILITIES.join('|')}`)
  }
  if (!STATUSES.includes(manifest.status)) {
    throw new TypeError(`manifest.status must be one of ${STATUSES.join('|')}`)
  }
  if (!Array.isArray(manifest.provides) || manifest.provides.length === 0) {
    throw new TypeError('manifest.provides must be a non-empty array')
  }

  for (const p of manifest.provides) {
    if (!p || typeof p.capability !== 'string' || !Number.isInteger(p.version)) {
      throw new TypeError('each provides entry needs a capability string and integer version')
    }
    if (typeof p.seed_quality !== 'number' || p.seed_quality < 0 || p.seed_quality > 1) {
      throw new TypeError(`seed_quality must be a number in [0,1] (got ${p.seed_quality})`)
    }
    if (typeof p.seed_cost !== 'string') {
      throw new TypeError('seed_cost must be a string')
    }
    // The core contract: refuse to register an agent that claims an
    // unknown/draft/retired capability. isRoutable is the single source of truth.
    if (!isRoutable(p.capability, p.version)) {
      throw new RangeError(`agent '${manifest.id}' provides non-routable capability ${p.capability}@${p.version}`)
    }
  }

  agents.set(manifest.id, manifest)
  return manifest
}

/**
 * Return every ACTIVE agent that provides an exact (capability, version).
 * Inactive agents and agents providing a different version are excluded.
 *
 * @param {string} capabilityId
 * @param {number} version
 * @returns {object[]} matching manifests
 */
function agentsProviding (capabilityId, version) {
  const matches = []
  for (const manifest of agents.values()) {
    if (manifest.status !== 'active') continue
    const provides = manifest.provides.some(
      p => p.capability === capabilityId && p.version === version
    )
    if (provides) matches.push(manifest)
  }
  return matches
}

/**
 * Fold a runtime event into the rolling health record for
 * (agentId, capability, version), creating the record on first sight.
 *
 * quality is the rolling success rate; latency and cost are rolling averages.
 * Each is updated incrementally so no event history needs to be retained.
 *
 * @param {{ agentId: string, capabilityId: string, version: number,
 *           success: boolean, latencyMs: number, cost: number }} event
 * @returns {object} the updated live health record
 */
function updateHealthFromEvent (event) {
  const key = healthKey(event.agentId, event.capabilityId, event.version)
  let record = health.get(key)
  if (!record) {
    record = {
      agentId: event.agentId,
      capabilityId: event.capabilityId,
      version: event.version,
      quality: 0,
      latency: 0,
      cost: 0,
      availability: 'up',
      sample_count: 0
    }
    health.set(key, record)
  }

  const n = record.sample_count + 1
  const successValue = event.success ? 1 : 0
  // Incremental average: avg += (sample - avg) / n
  record.quality += (successValue - record.quality) / n
  record.latency += (event.latencyMs - record.latency) / n
  record.cost += (event.cost - record.cost) / n
  record.availability = availabilityFromQuality(record.quality)
  record.sample_count = n

  return record
}

/**
 * Return the live health record for an exact (agentId, capability, version),
 * or null if no events have been seen yet.
 *
 * @param {string} agentId
 * @param {string} capabilityId
 * @param {number} version
 * @returns {object|null}
 */
function getHealth (agentId, capabilityId, version) {
  return health.get(healthKey(agentId, capabilityId, version)) || null
}

/**
 * Rank agents best-first for a given (capability, version).
 *
 * Ordering: quality (desc) → cost (asc) → latency (asc) → availability (desc).
 * When an agent has no samples yet (sample_count === 0), it falls back to the
 * manifest's seed_quality and seed_cost so a fresh agent is still routable; once
 * events exist, the live rolling numbers take over.
 *
 * @param {object[]} agents list of manifests to rank
 * @param {string} capabilityId
 * @param {number} version
 * @returns {object[]} a new array, sorted best-first
 */
function rankByHealth (agentList, capabilityId, version) {
  const scored = agentList.map(manifest => {
    const provided = manifest.provides.find(
      p => p.capability === capabilityId && p.version === version
    )
    const record = getHealth(manifest.id, capabilityId, version)
    const hasSamples = record && record.sample_count > 0

    const metric = hasSamples
      ? {
          quality: record.quality,
          cost: costValue(record.cost),
          latency: record.latency,
          availability: availabilityRank(record.availability)
        }
      : {
          // Seed fallback: use the manifest's advertised estimates. Latency is
          // unknown, so treat it as worst; availability is assumed 'up'.
          quality: provided ? provided.seed_quality : 0,
          cost: costValue(provided ? provided.seed_cost : undefined),
          latency: Number.POSITIVE_INFINITY,
          availability: availabilityRank('up')
        }

    return { manifest, metric }
  })

  scored.sort((a, b) => {
    if (b.metric.quality !== a.metric.quality) return b.metric.quality - a.metric.quality
    if (a.metric.cost !== b.metric.cost) return a.metric.cost - b.metric.cost
    if (a.metric.latency !== b.metric.latency) return a.metric.latency - b.metric.latency
    return b.metric.availability - a.metric.availability
  })

  return scored.map(s => s.manifest)
}

// Seed one manifest: the local claude-code engineer.
registerAgent({
  id: 'claude-code',
  role: 'Software Engineer',
  adapter: 'adapters/claude-code',
  provides: [
    { capability: 'Develop', version: 1, seed_quality: 0.9, seed_cost: '$' },
    { capability: 'Apply', version: 1, seed_quality: 0.95, seed_cost: 'free' }
  ],
  availability: 'local',
  status: 'active'
})

module.exports = {
  AVAILABILITIES,
  STATUSES,
  HEALTH_AVAILABILITIES,
  registerAgent,
  agentsProviding,
  updateHealthFromEvent,
  getHealth,
  rankByHealth
}
