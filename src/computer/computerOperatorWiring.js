'use strict'

/**
 * computerOperatorWiring.js — the caller. The one place where the parts are joined up.
 *
 * ── "STRUCTURALLY UNREACHABLE" MEANS WHAT IT SAYS ──────────────────────────
 * The Owner's requirement was that with COMPUTER_OPERATOR OFF the execution path is not merely
 * refused but UNREACHABLE. A refusal is a decision taken at run time by code that is loaded,
 * constructed and one edit away from saying yes. That is not what was asked for.
 *
 * So the flag is resolved FIRST, and the modules that can act — the adapter, its process
 * runner, the executor — are `require`d INSIDE the enabled branch. With the flag off:
 *
 *   . desktopAdapter.js is never loaded into the process at all
 *   . computerExecutor.js is never loaded
 *   . no adapter object exists, so nothing holds a reference to one
 *   . the Companion is built without an executor and is exactly as inert as it was in 3a
 *
 * There is no object graph in which a desktop call could be made, rather than an object graph
 * that declines to make one. A test asserts both halves by inspecting the module cache.
 *
 * ── AND THE FLAG IS STILL NOT SUFFICIENT ───────────────────────────────────
 * Turning it on builds the path; it authorises nothing. Every action still has to pass
 * sealedOrderGate — sealed, hash-matching, Owner-approved, not stopped — and the gate refuses
 * `sealed_order_required` when the flag is on and no order is presented. The flag is the
 * necessary condition that a human controls; the seal is the one that says what may happen.
 */

const { resolveComputerOperator } = require('./computerOperatorFlag')
const { createCompanion } = require('./companion')

/**
 * Build the Computer Operator for this process.
 *
 * @param {object} [opts]
 * @param {object} [opts.env]            defaults to process.env
 * @param {object} [opts.artifactStore]  the durable audit sink; REQUIRED to execute
 * @param {object} [opts.runner]         the injected process runner for the adapter
 * @returns {{enabled:boolean, reason:string|null, companion:object, executor:object|null}}
 */
function buildComputerOperator (opts = {}) {
  const env = opts.env || process.env
  const flag = resolveComputerOperator(env)

  if (flag !== 'on') {
    // Nothing that can act is loaded on this path. Note there is no `executor` variable to
    // assign later either — the disabled build simply does not have one.
    return {
      enabled: false,
      reason: 'flag_off',
      flag,
      executor: null,
      companion: createCompanion({ now: opts.now })
    }
  }

  // ── enabled branch: the ONLY place these modules enter the process ───────
  const { createDesktopAdapter } = require('./desktopAdapter')
  const { createComputerExecutor } = require('./computerExecutor')

  if (!opts.artifactStore || typeof opts.artifactStore.write !== 'function') {
    // Fail-closed at composition, not at the first step. A build with no audit sink must not
    // exist, because everything downstream assumes a record can be written.
    return { enabled: false, reason: 'audit_not_configured', flag, executor: null, companion: createCompanion({ now: opts.now }) }
  }
  if (!opts.runner || typeof opts.runner.run !== 'function') {
    return { enabled: false, reason: 'no_runner', flag, executor: null, companion: createCompanion({ now: opts.now }) }
  }

  const desktop = createDesktopAdapter({ runner: opts.runner, scriptPath: opts.scriptPath, timeoutSec: opts.timeoutSec })
  const executor = createComputerExecutor({ artifactStore: opts.artifactStore, desktop, now: opts.now })

  return {
    enabled: true,
    reason: null,
    flag,
    executor,
    companion: createCompanion({ now: opts.now, executor })
  }
}

module.exports = { buildComputerOperator }
