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
 * Pure FOUR-flag authorization (Owner ruling, 2026-07-28).
 *
 * COMPUTER_OPERATOR joins the same gate as a peer rather than getting an exemption:
 * ANY TWO of the four 'on' → configuration_conflict → zero execution. The Owner's
 * reasoning, adopted here: the rule's value is that it is simple enough not to be
 * reasoned about wrongly. A table with exceptions has to be remembered; this does not.
 *
 * BACKWARD COMPATIBILITY IS EXACT, NOT APPROXIMATE. With `computer` absent or 'off' —
 * which is every caller today, since nothing reads the flag — this function returns
 * byte-identical results to the three-flag version for all 32 combinations of the other
 * inputs. agentAuthorization.test.js proves that against a verbatim copy of the old
 * implementation rather than against a hand-written table.
 *
 * @param {{ worker:'on'|'off', develop:'on'|'off', agent:'on'|'off', computer?:'on'|'off',
 *           dispatcherConfigured?:boolean, agentRunnerConfigured?:boolean,
 *           computerSupervisorConfigured?:boolean }} o
 * @returns {{ status, workerAuthorized, developAuthorized, agentBridgeAuthorized, computerOperatorAuthorized }}
 */
function authorizeExecution (o = {}) {
  const worker = o.worker === 'on' ? 'on' : 'off'
  const develop = o.develop === 'on' ? 'on' : 'off'
  const agent = o.agent === 'on' ? 'on' : 'off'
  const computer = o.computer === 'on' ? 'on' : 'off'
  const onCount = [worker, develop, agent, computer].filter((x) => x === 'on').length

  if (onCount >= 2) {
    return {
      status: 'configuration_conflict',
      workerAuthorized: false,
      developAuthorized: false,
      agentBridgeAuthorized: false,
      computerOperatorAuthorized: false
    }
  }
  const developAuthorized = develop === 'on' && o.dispatcherConfigured === true
  const workerAuthorized = worker === 'on'
  const agentBridgeAuthorized = agent === 'on' && o.agentRunnerConfigured === true
  // Like the other lanes, the flag alone is not enough: a concrete supervisor must also
  // be configured. Today none is, so this can only ever be false.
  const computerOperatorAuthorized = computer === 'on' && o.computerSupervisorConfigured === true
  const status = developAuthorized
    ? 'develop_authorized'
    : (workerAuthorized
        ? 'worker_authorized'
        : (agentBridgeAuthorized
            ? 'agent_bridge_authorized'
            : (computerOperatorAuthorized ? 'computer_operator_authorized' : 'not_authorized')))
  return { status, workerAuthorized, developAuthorized, agentBridgeAuthorized, computerOperatorAuthorized }
}

module.exports = { resolveAgentBridge, authorizeExecution }
