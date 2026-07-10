'use strict'

/**
 * adapter.js — the standard Worker Adapter contract for the Aroma OS backend.
 *
 * A Worker Adapter is the boundary between a capability (a typed contract in the
 * registry) and a concrete worker that can actually perform the work. The OS
 * routes a capability call to an adapter; the adapter does the work and returns
 * a normalized result. Every adapter must expose two methods:
 *
 *   invoke(capabilityId, version, input)
 *     → Promise<{ ok, output, error, cost, latencyMs }> or the same object
 *       synchronously. Performs one unit of work for an exact (id, version).
 *
 *   health()
 *     → { availability: 'up'|'degraded'|'down', latencyMs }
 *       Cheap liveness probe the OS uses before routing.
 *
 * This module only defines the contract plus two small helpers. It contains no
 * worker logic of its own and does not depend on any concrete adapter.
 */

const AVAILABILITY = ['up', 'degraded', 'down']

/**
 * Validate that an object satisfies the Worker Adapter contract.
 * Throws if either required method is missing or is not a function.
 *
 * @param {object} adapter
 * @returns {object} the same adapter (so callers can chain/assign)
 * @throws {TypeError} if invoke or health is missing / not a function
 */
function validateAdapter (adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('adapter must be an object')
  }
  if (typeof adapter.invoke !== 'function') {
    throw new TypeError('adapter.invoke must be a function')
  }
  if (typeof adapter.health !== 'function') {
    throw new TypeError('adapter.health must be a function')
  }
  return adapter
}

/**
 * Normalize a result object with safe defaults so every adapter returns the
 * exact same shape regardless of what it chose to populate.
 *
 * Defaults: ok=false, output={}, error=null, cost=0, latencyMs=0.
 *
 * @param {{ ok?: boolean, output?: object, error?: (string|null),
 *           cost?: number, latencyMs?: number }} [result]
 * @returns {{ ok: boolean, output: object, error: (string|null),
 *             cost: number, latencyMs: number }}
 */
function createResult (result = {}) {
  const { ok, output, error, cost, latencyMs } = result || {}
  return {
    ok: ok === true,
    output: (output && typeof output === 'object') ? output : {},
    error: (typeof error === 'string') ? error : null,
    cost: Number.isFinite(cost) ? cost : 0,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : 0
  }
}

module.exports = {
  AVAILABILITY,
  validateAdapter,
  createResult
}
