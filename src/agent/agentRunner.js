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
const { checkCredentialHealth } = require('./credentialHealth')
const { writePatch, applyHint } = require('./patchStore')

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
  // Injectable so tests never read the real credentials file and never write a real patch.
  const checkCredentials = typeof options.checkCredentials === 'function' ? options.checkCredentials : checkCredentialHealth
  const writePatchFn = typeof options.writePatch === 'function' ? options.writePatch : writePatch
  // P1-C1c: runId rides along so a listener can write the phase onto the CANONICAL Run
  // timeline as well as the memory cache. Still inert and still bounded — a phase name
  // and two identifiers, never a path, an output or a file's contents — and a throwing
  // or absent sink can no more affect the run than before.
  const emitPhase = (approvalId, phase, runId) => {
    if (!onPhase) return
    try { onPhase(approvalId, phase, runId || null) } catch (_) {}
  }

  /**
   * Run ONE already-approved Work Order. @returns the enriched worker result.
   * @param {{ workOrder: object, who?: string }} input
   */
  async function run (input = {}) {
    // Measured from the top of the run, so the audit records the WHOLE thing — clone,
    // spawn and post-run verification — not just the worker's spawn latency.
    const runStartedAt = Date.now()
    const workOrder = input && input.workOrder
    const who = (input && typeof input.who === 'string') ? input.who : null
    // P1-C1c: the canonical Run this attempt belongs to. Null for callers that have no
    // Run (direct/machine callers, tests) — the audit then records the absence honestly
    // rather than inventing a link.
    const runId = (input && typeof input.runId === 'string' && input.runId) ? input.runId : null

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
      if (auditLog) { try { auditLog.append({ approvalId, runId, workOrderHash, who, result, durationMs: Date.now() - runStartedAt }) } catch (_) {} }
      return result
    }
    if (approvedHash !== workOrderHash) {
      const result = fail('hash_mismatch')
      if (auditLog) { try { auditLog.append({ approvalId, runId, workOrderHash, who, result, durationMs: Date.now() - runStartedAt }) } catch (_) {} }
      return result
    }

    // CREDENTIAL HEALTH — after the order is proven sealed and matching, before any clone
    // or spawn. An expired login then costs nothing and produces a sentence the Owner can
    // act on, instead of an opaque spawn failure three days from now. Only the two expiry
    // timestamps are read; the tokens themselves are never touched.
    const health = checkCredentials({ cliPath: cli.ok ? cli.command : null })
    if (health.canRun !== true) {
      const result = fail('login_expired')
      result.output.warnings = [health.refusal]
      result.output.credential = publicCredentialFacts(health)
      emitPhase(approvalId, 'failed', runId)
      if (auditLog) { try { auditLog.append({ approvalId, runId, workOrderHash, who, result, durationMs: Date.now() - runStartedAt }) } catch (_) {} }
      return result
    }

    let prepared
    try {
      emitPhase(approvalId, 'preparing', runId)
      prepared = workspace.prepare(approvalId) // isolated clone + agent branch + remotes removed
    } catch (e) {
      const result = fail(`workspace_refused: ${(e && e.message) || String(e)}`)
      emitPhase(approvalId, 'failed', runId)
      if (auditLog) { try { auditLog.append({ approvalId, runId, workOrderHash, who, result, durationMs: Date.now() - runStartedAt }) } catch (_) {} }
      return result
    }

    let result
    try {
      emitPhase(approvalId, 'running', runId)
      result = await worker.invoke('AgentBridge', 1, { workOrder, workspace, cloneDir: prepared.dir, branch: prepared.branch })
      emitPhase(approvalId, 'verifying', runId)
    } catch (e) {
      result = fail(`worker_error: ${(e && e.message) || String(e)}`)
    }
    emitPhase(approvalId, result && result.ok === true ? 'done' : 'failed', runId)

    // ── THE PATCH ─────────────────────────────────────────────────────────
    // Written BEFORE cleanup, because the clone is the only place the change exists.
    // The patch text is then REMOVED from the result: it is third-party-sized source
    // material with no business in the audit record or the Owner's card, both of which
    // want the stat. A failure to write is reported, never thrown — the run already
    // happened, and losing the file is a smaller loss than losing the report of it.
    let patch = null
    try {
      const text = (result && result.output && typeof result.output.patchText === 'string') ? result.output.patchText : ''
      patch = writePatchFn(approvalId, text, { now: () => new Date().toISOString() })
    } catch (_) { patch = { ok: false, reason: 'write_failed' } }

    if (result && result.output) {
      delete result.output.patchText
      result.output.patchFile = patch && patch.ok ? patch.path : null
      result.output.patchBytes = patch && patch.ok ? patch.bytes : 0
      result.output.patchStatus = patch && patch.ok ? 'written' : (patch ? patch.reason : 'write_failed')
      result.output.applyHint = patch && patch.ok ? applyHint(patch.path, repoRoot) : null
      // A warning close to expiry rides back with the result, so the card can show it
      // without the Owner having to ask.
      if (health.warning) result.output.warnings = (result.output.warnings || []).concat([health.warning])
      result.output.credential = publicCredentialFacts(health)
    }

    // Cap 7 — append-only audit for EVERY attempt, success or failure.
    if (auditLog) { try { auditLog.append({ approvalId, runId, workOrderHash, who, result, durationMs: Date.now() - runStartedAt }) } catch (_) {} }
    try { workspace.cleanup(prepared.dir) } catch (_) {}
    return result
  }

  /** Expiry facts only — never a token, never a token length, never a prefix. */
  function publicCredentialFacts (h) {
    return {
      state: h.state,
      refreshExpiresAt: h.refreshExpiresAt,
      daysLeft: h.daysLeft,
      accessTokenValid: h.accessTokenValid,
      subscription: h.subscription
    }
  }

  // Observable so the composition root can be ASSERTED, not assumed. The first canary
  // ran with auditLog === null because production wiring passed an undefined artifact
  // store; nothing in the runner could report that, so nothing caught it.
  return { run, auditConfigured: auditLog !== null }
}

module.exports = { createAgentRunner }
