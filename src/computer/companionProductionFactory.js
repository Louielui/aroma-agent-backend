'use strict'

/**
 * companionProductionFactory.js — G1. The Companion side, assembled once.
 *
 * ── WHAT THIS EXISTS TO MAKE STRUCTURALLY TRUE ─────────────────────────────
 * The canary reached "press E" fully sealed, approved and unlocked, and would still have run as
 * louis — because the entrypoint called executor.execute() directly and the Companion was built
 * and never used. Every containment property belonged to AromaOperator and applied to nothing on
 * that path.
 *
 * So the executor is created HERE and nowhere else, and this file only runs inside the
 * Companion. The Owner's side writes a request and stops. It cannot call across a token and a
 * desktop boundary, so it does not try.
 *
 * ── ONE RUNNER, SHARED ─────────────────────────────────────────────────────
 * The machine probe and the desktop adapter receive the SAME PowerShell transport instance. Two
 * launchers had already drifted apart once and both were broken in ways only a real run
 * exposed; one instance is the fix, and passing it to both is what keeps it one.
 *
 * ── ORDER OF ASSEMBLY IS NOT ORDER OF TRUST ────────────────────────────────
 * Building the operator does not authorise anything. Identity is attested, the receipt and
 * package are re-verified, and the machine is measured — by this process, as itself — before
 * the executor is handed a single step. companionCanaryRunner owns that sequence; this file
 * only makes sure the pieces it needs exist and are the right ones.
 */

const { createPowershellJsonRunner } = require('./powershellJsonRunner')
const { createMachineProbe } = require('./machineProbe')
const { createComputerExecutor } = require('./computerExecutor')
const { createDesktopAdapter } = require('./desktopAdapter')
const { createOrderRegistry } = require('./orderRegistry')

/**
 * Assemble the Companion's execution side.
 *
 * @param {object} deps.artifactStore  durable audit — REQUIRED
 * @param {object} [deps.runner]       injected only by tests
 * @returns {{ok:boolean, runner, machine, executor, registry}}
 */
function buildCompanionExecution (deps = {}) {
  if (!deps.artifactStore || typeof deps.artifactStore.write !== 'function') {
    // Fail closed at composition. A build with no audit sink must not exist, because everything
    // downstream assumes a record can be written and would discover otherwise mid-run.
    return { ok: false, reason: 'audit_not_configured' }
  }

  // ONE transport. Both consumers below get this exact object, never a second one.
  const runner = deps.runner || createPowershellJsonRunner({ timeoutMs: deps.timeoutMs })

  const machine = createMachineProbe({ runner })
  const desktop = createDesktopAdapter({ runner })
  const registry = createOrderRegistry({ now: deps.now })
  const executor = createComputerExecutor({
    artifactStore: deps.artifactStore,
    desktop,
    orderRegistry: registry,
    now: deps.now
  })

  return { ok: true, runner, machine, desktop, executor, registry }
}

module.exports = { buildCompanionExecution }
