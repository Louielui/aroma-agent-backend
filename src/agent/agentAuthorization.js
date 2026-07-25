'use strict'

/**
 * agentAuthorization.js — the AGENT_BRIDGE flag resolver + the pure three-flag
 * execution-authorization gate (two-of-three conflict). Agent Bridge v0.
 *
 * The gate is fail-closed and has NO implicit priority:
 *   - ANY two (or three) of {WORKER_INVOCATION, DEVELOP_DISPATCH, AGENT_BRIDGE}
 *     'on' → 'configuration_conflict' → ZERO execution.
 *   - exactly one 'on' → that lane is authorized ONLY if its concrete runner is
 *     also configured (develop needs a dispatcher; agent needs an agent runner).
 *   - otherwise → 'not_authorized'.
 *
 * Default is OFF everywhere; an unset/empty/invalid flag can never open the gate.
 * app.js delegates to this so there is a single source of truth for the matrix.
 */

/** Resolve AGENT_BRIDGE: strict 'on' only; unset/empty/invalid → 'off' (never open). */
function resolveAgentBridge (env = process.env) {
  const raw = env.AGENT_BRIDGE
  if (raw === undefined || raw === null || raw === '') return 'off'
  if (raw === 'on' || raw === 'off') return raw
  console.warn(`[AROMA-HUB] Invalid AGENT_BRIDGE="${raw}" — falling back to 'off'.`)
  return 'off'
}

/**
 * Pure three-flag authorization.
 * @param {{ worker:'on'|'off', develop:'on'|'off', agent:'on'|'off',
 *           dispatcherConfigured?:boolean, agentRunnerConfigured?:boolean }} o
 * @returns {{ status, workerAuthorized, developAuthorized, agentBridgeAuthorized }}
 */
function authorizeExecution (o = {}) {
  const worker = o.worker === 'on' ? 'on' : 'off'
  const develop = o.develop === 'on' ? 'on' : 'off'
  const agent = o.agent === 'on' ? 'on' : 'off'
  const onCount = [worker, develop, agent].filter((x) => x === 'on').length

  if (onCount >= 2) {
    return { status: 'configuration_conflict', workerAuthorized: false, developAuthorized: false, agentBridgeAuthorized: false }
  }
  const developAuthorized = develop === 'on' && o.dispatcherConfigured === true
  const workerAuthorized = worker === 'on'
  const agentBridgeAuthorized = agent === 'on' && o.agentRunnerConfigured === true
  const status = developAuthorized
    ? 'develop_authorized'
    : (workerAuthorized
        ? 'worker_authorized'
        : (agentBridgeAuthorized ? 'agent_bridge_authorized' : 'not_authorized'))
  return { status, workerAuthorized, developAuthorized, agentBridgeAuthorized }
}

module.exports = { resolveAgentBridge, authorizeExecution }
