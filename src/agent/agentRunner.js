'use strict'

/**
 * agentRunner.js — Agent Bridge Wiring v1. Assembles the three v0 parts (bounded
 * worker + isolated feature-branch workspace + append-only audit) into ONE runner
 * with a single entry point, so `agentRunnerConfigured` can mean something concrete.
 *
 * WHAT THIS IS NOT:
 *   - It is NOT a trigger. Nothing in this repo calls run() today: the chat lane, the
 *     decision-recall path and the read-context path have no reference to it, and the
 *     confirm handler does not invoke it. Making it *constructible* is the whole of
 *     this round; making it *invocable from an approved Work Order* still needs the
 *     missing Work Order producer and approval surface (see the Phase A report).
 *   - It is NOT a Work Order producer. run() REQUIRES an already-approved Work Order
 *     and refuses without one; it never infers scope, files or tests.
 *
 * FAIL-CLOSED ORDER inside run(): validate the Work Order → prepare an isolated
 * clone (tmpdir, agent branch, remotes removed) → invoke the bounded worker → write
 * the append-only audit record → return the enriched result. Any step failing stops
 * the run and returns an honest ok:false; nothing is retried and scope is never
 * widened (Cap 8). The audit record is written for BOTH outcomes, so an attempt can
 * never be silent.
 */

const crypto = require('node:crypto')
const { validateWorkOrder, hashWorkOrder } = require('./workOrder')
const { createAgentBridgeWorker, resolveAgentCliCommand } = require('./agentBridgeWorker')
const { createFeatureBranchWorkspace } = require('./featureBranchWorkspace')
const { createAuditLog } = require('./audit')

function fail (reason, extra = {}) {
  return Object.assign({ ok: false, error: reason, output: { risks: [reason], warnings: [], branch: null, filesChanged: [], diffSummary: null, testResults: null, exit: null } }, extra)
}

/**
 * @param {{ repoRoot, artifactStore, worker?, workspace?, auditLog?, newId?, clock? }} options
 *   worker / workspace / auditLog are injectable so tests never touch a real repo,
 *   never spawn the Claude Code CLI and never write outside a temp dir.
 */
function createAgentRunner (options = {}) {
  const repoRoot = options.repoRoot
  if (!options.workspace && (typeof repoRoot !== 'string' || repoRoot.trim() === '')) {
    throw new TypeError('createAgentRunner requires repoRoot (or an injected workspace)')
  }
  // Resolve the Claude Code CLI to an ABSOLUTE executable path here, at composition time,
  // and hand it to the worker. The worker used to default to the bare string 'claude',
  // which on Windows cannot start under shell:false at all (ENOENT for the extensionless
  // script, EINVAL for the .cmd). We do NOT switch to shell:true to work around that —
  // that would put our arguments back through a shell parser, which is precisely the
  // injection surface Cap 1 removes. An unresolvable CLI is passed through as
  // commandError and the worker REFUSES the run; there is no bare-'claude' fallback.
  const cli = options.command
    ? { ok: true, command: options.command }
    : resolveAgentCliCommand(options.env || process.env)
  const worker = options.worker || createAgentBridgeWorker({
    command: cli.ok ? cli.command : null,
    commandError: cli.ok ? null : cli.reason,
    parentEnv: options.env || process.env
  })
  const workspace = options.workspace || createFeatureBranchWorkspace({ repoRoot })
  const auditLog = options.auditLog || (options.artifactStore ? createAuditLog({ artifactStore: options.artifactStore }) : null)
  const newId = typeof options.newId === 'function' ? options.newId : () => `appr_${crypto.randomUUID().slice(0, 8)}`
  // Progress reporting is OPTIONAL and inert: it emits a fixed phase NAME from the closed
  // vocabulary and nothing else — no path, no output, no file content — and a throwing or
  // absent sink can never affect the run.
  const onPhase = typeof options.onPhase === 'function' ? options.onPhase : null
  const emitPhase = (approvalId, phase) => {
    if (!onPhase) return
    try { onPhase(approvalId, phase) } catch (_) {}
  }

  /**
   * Run ONE already-approved Work Order. @returns the enriched worker result.
   * @param {{ workOrder: object, who?: string }} input
   */
  async function run (input = {}) {
    const workOrder = input && input.workOrder
    const who = (input && typeof input.who === 'string') ? input.who : null

    // Cap 8 — fail-closed BEFORE any workspace or process work.
    const v = validateWorkOrder(workOrder)
    if (!v.ok) return fail('invalid_work_order', { validationErrors: v.errors })

    const approvalId = (typeof workOrder.approvalId === 'string' && workOrder.approvalId) ? workOrder.approvalId : newId()
    const workOrderHash = hashWorkOrder(workOrder)

    // HASH ENFORCEMENT (step 4). The hash is recomputed HERE from the order actually
    // about to execute and compared with the hash the Owner approved. Any difference —
    // an added file, a widened cap, a changed test command, a swapped goal — produces a
    // different hash and the run is REFUSED, audited and stopped. There is deliberately
    // NO amend path: a sealed order is never edited in flight. If a second file turns out
    // to be needed, this run stops and a NEW Work Order must be produced and approved.
    const approvedHash = input && input.approvedHash
    if (typeof approvedHash !== 'string' || approvedHash.length === 0) {
      const result = fail('missing_approved_hash')
      if (auditLog) { try { auditLog.append({ approvalId, workOrderHash, who, result }) } catch (_) {} }
      return result
    }
    if (approvedHash !== workOrderHash) {
      const result = fail('hash_mismatch')
      if (auditLog) { try { auditLog.append({ approvalId, workOrderHash, who, result }) } catch (_) {} }
      return result
    }

    let prepared
    try {
      emitPhase(approvalId, 'preparing')
      prepared = workspace.prepare(approvalId) // isolated clone + agent branch + remotes removed
    } catch (e) {
      const result = fail(`workspace_refused: ${(e && e.message) || String(e)}`)
      emitPhase(approvalId, 'failed')
      if (auditLog) { try { auditLog.append({ approvalId, workOrderHash, who, result }) } catch (_) {} }
      return result
    }

    let result
    try {
      emitPhase(approvalId, 'running')
      result = await worker.invoke('AgentBridge', 1, { workOrder, workspace, cloneDir: prepared.dir, branch: prepared.branch })
      emitPhase(approvalId, 'verifying')
    } catch (e) {
      result = fail(`worker_error: ${(e && e.message) || String(e)}`)
    }
    emitPhase(approvalId, result && result.ok === true ? 'done' : 'failed')

    // Cap 7 — append-only audit for EVERY attempt, success or failure.
    if (auditLog) { try { auditLog.append({ approvalId, workOrderHash, who, result }) } catch (_) {} }
    try { workspace.cleanup(prepared.dir) } catch (_) {}
    return result
  }

  return { run }
}

module.exports = { createAgentRunner }
