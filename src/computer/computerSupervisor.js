'use strict'

/**
 * computerSupervisor.js — Computer Operator v0, Phase 2. THE DRY-RUN SUPERVISOR.
 *
 * It takes a sealed ComputerWorkOrder, walks the declared steps, resolves each one,
 * checks what can be checked, and reports what it WOULD do. It is structurally incapable
 * of doing it: this module imports no filesystem, no process, no network and no input or
 * screen library, and phase2Inert.test.js fails if that ever changes.
 *
 * ═══ THE ASSURANCE BOUNDARY — READ THIS BEFORE TRUSTING A DRY-RUN ═══════════════
 *
 * A dry-run that implies more assurance than it has is worse than none, so the two
 * classes are kept apart in the code, not blurred into one "passed".
 *
 * VERIFIED — decided entirely by the order and the rules, and true regardless of what
 * the machine looks like:
 *   · the schema is well-formed and every action is in the closed enum
 *   · every path is inside the single approved root, with no traversal or escape
 *   · every step path is covered by allowedPaths
 *   · every required prohibition is declared
 *   · step count is within maxSteps, and both are within the hard ceilings
 *   · the order is the one live order, and each step nonce is unused
 *   · nothing is stopped
 *
 * NOT VERIFIED — needs a Companion on a real desktop, and NOTHING here can stand in
 * for it. Every one of these is reported as UNKNOWN, never as ok:
 *   · does the source file exist, and is it readable
 *   · does the destination already exist (create_file must not overwrite — and whether
 *     it WOULD overwrite is unknowable from here)
 *   · is there enough disk, are the ACLs right, is the file locked by another process
 *   · is the target application installed, running, or focused
 *   · does a UI element exist, and is it the one that was meant
 *   · what is actually on the screen
 *
 * So a clean dry-run means: THIS ORDER IS WELL-FORMED AND IN SCOPE. It does not mean
 * the order would succeed, and it does not mean the machine is in the expected state.
 * The result object says exactly this, in `assurance`, so a caller cannot read a clean
 * dry-run as a green light by accident.
 *
 * ═══ WHY THE AUDIT IS WRITTEN ON A DRY-RUN ══════════════════════════════════════
 * The Agent Bridge audit was wired to an injected dependency that was undefined in the
 * real assembly. Everything passed; the gap only appeared on the FIRST REAL EXECUTION,
 * which succeeded and left no record — a failed canary. So the audit path is exercised
 * here, in the real composition, before anything real can happen: every dry-run writes a
 * computer-audit record marked `dryRun: true`, and `auditConfigured` is exposed so the
 * wiring can be asserted rather than assumed.
 */

const { validateComputerWorkOrder, hashComputerWorkOrder, isPathAllowed, isWithin, ALLOWED_ROOT } = require('./computerWorkOrder')
const { buildComputerAuditRecord } = require('./computerAudit')
const { createKillSwitch } = require('./killSwitch')
const { createOrderRegistry } = require('./orderRegistry')

/** What a dry-run can and cannot answer, as data, so the report and the code agree. */
const ASSURANCE = Object.freeze({
  verified: Object.freeze([
    'schema_well_formed', 'action_in_closed_enum', 'path_inside_approved_root',
    'path_covered_by_allowed_paths', 'prohibitions_declared', 'within_step_and_time_ceilings',
    'single_live_order', 'step_nonce_unused', 'not_stopped'
  ]),
  notVerified: Object.freeze([
    'source_file_exists', 'destination_absent', 'file_readable', 'file_not_locked',
    'sufficient_disk_space', 'filesystem_permissions', 'application_installed',
    'application_running', 'ui_element_exists', 'screen_contents'
  ]),
  meaning: 'A clean dry-run means the order is well-formed and in scope. It does NOT mean the order would succeed.'
})

/** Preconditions each action needs that only a Companion could ever check. */
const UNVERIFIABLE_BY_ACTION = Object.freeze({
  read_file: Object.freeze(['source_file_exists', 'file_readable', 'file_not_locked', 'filesystem_permissions']),
  create_file: Object.freeze(['destination_absent', 'sufficient_disk_space', 'filesystem_permissions']),
  copy_file: Object.freeze(['source_file_exists', 'file_readable', 'destination_absent', 'sufficient_disk_space', 'filesystem_permissions'])
})

/**
 * The production audit sink, built the SAME way app.js builds the agent one: the
 * artifact root is resolved from the environment with the repo's .aroma as the default.
 * Built here at composition time rather than read out of an options bag, so it cannot be
 * quietly absent — which is precisely how the Agent Bridge audit came to be unwired.
 */
function buildProductionArtifactStore () {
  const nodePath = require('node:path')
  const { resolveArtifactDir } = require('../runtime/artifactDir')
  const { createArtifactStore } = require('../store/artifactStore')
  const root = resolveArtifactDir(process.env, nodePath.resolve(__dirname, '..', '..', '.aroma'))
  return createArtifactStore({ baseDir: root.dir })
}

/**
 * @param {object} deps
 * @param {{write:Function}} [deps.artifactStore]  audit sink. Omitted in production →
 *        the REAL store is built here, so the audit can never be silently absent.
 * @param {Function} [deps.now] injected clock
 */
function createComputerSupervisor (deps = {}) {
  // THE COMPOSITION-ROOT LESSON, APPLIED. In production nothing is injected, so the real
  // store is constructed HERE rather than read out of an options bag that happens to be
  // empty. `auditConfigured` then means something concrete and is asserted in tests
  // against the real root, not against a fake.
  const artifactStore = deps.artifactStore || buildProductionArtifactStore()
  const auditConfigured = !!(artifactStore && typeof artifactStore.write === 'function')

  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const clock = typeof deps.clock === 'function' ? deps.clock : () => new Date(now()).toISOString()
  const newId = typeof deps.newId === 'function' ? deps.newId : () => 'caudit_' + Math.abs(now() % 1e9).toString(36)

  const killSwitch = deps.killSwitch || createKillSwitch({ now })
  const registry = deps.orderRegistry || createOrderRegistry({ now })

  /**
   * Resolve ONE step: what it targets, what is checked, what cannot be.
   *
   * ── THE SCOPE CHECK BELOW IS CURRENTLY UNREACHABLE ────────────────────────
   * `refused_out_of_scope` cannot be produced today: validateComputerWorkOrder already
   * checks both "inside the approved root" and "covered by allowedPaths", so an order
   * containing an out-of-scope path is rejected before any step is walked. Owner ruling
   * 2026-07-28: KEEP it. It is retained as the SECOND gate for the Phase 3 desktop order
   * types, whose steps will carry preconditions the file schema cannot express — at which
   * point the two layers diverge and this one starts doing work.
   *
   * It is neither working nor broken today: it is dormant, on purpose. A test asserts
   * exactly that, so nobody later reads a green suite as proof this branch runs, or reads
   * the dead branch as a bug and deletes the second gate.
   */
  function resolveStep (wo, step, index) {
    const params = (step && step.params) || {}
    const targets = ['path', 'sourcePath', 'destPath']
      .filter((k) => params[k] !== undefined)
      .map((k) => ({ role: k, path: params[k] }))

    const checks = []
    for (const t of targets) {
      const inRoot = isPathAllowed(t.path)
      const covered = inRoot && (wo.allowedPaths || []).some((a) => isWithin(t.path, a))
      checks.push({ role: t.role, insideApprovedRoot: inRoot, coveredByAllowedPaths: covered })
    }
    const allOk = checks.length > 0 && checks.every((c) => c.insideApprovedRoot && c.coveredByAllowedPaths)

    return {
      n: index + 1,
      action: step.action,
      targets: targets.map((t) => t.role), // roles only; paths appear in `checks`
      checks,
      wouldDo: allOk ? describe(step.action, params) : null,
      // Named individually so a reader cannot mistake "no problems found" for "checked".
      unverifiable: [...(UNVERIFIABLE_BY_ACTION[step.action] || [])],
      verdict: allOk ? 'in_scope' : 'refused_out_of_scope'
    }
  }

  /** A plain-language description of the INTENT. Never a claim that it happened. */
  function describe (action, params) {
    if (action === 'read_file') return `would read ${params.path}`
    if (action === 'create_file') return `would create a NEW file at ${params.path} (never overwrite)`
    if (action === 'copy_file') return `would copy ${params.sourcePath} to a NEW file at ${params.destPath} (never overwrite)`
    return null
  }

  /**
   * Walk an order and report what it WOULD do. Performs no action of any kind.
   * ALWAYS writes an audit record — including on refusal — so an attempt is never silent.
   */
  function dryRun (wo, opts = {}) {
    const who = typeof opts.who === 'string' ? opts.who : null
    const approvalId = wo && typeof wo.approvalId === 'string' ? wo.approvalId : null
    const finish = (result) => {
      const record = writeAudit(result, wo, who)
      return Object.assign({}, result, { auditRecordId: record ? record.id : null, auditWritten: !!record })
    }

    const stopped = killSwitch.guard()
    if (!stopped.ok) {
      return finish({ ok: false, dryRun: true, refusal: 'stopped', reason: stopped.reason, steps: [], assurance: ASSURANCE })
    }

    const v = validateComputerWorkOrder(wo)
    if (!v.ok) {
      return finish({ ok: false, dryRun: true, refusal: 'invalid_work_order', errors: v.errors, steps: [], assurance: ASSURANCE })
    }

    const admitted = registry.admit({
      approvalId,
      workOrderHash: hashComputerWorkOrder(wo),
      stepCount: wo.steps.length,
      timeoutSec: wo.timeoutSec
    })
    if (!admitted.ok) {
      return finish({ ok: false, dryRun: true, refusal: admitted.reason, steps: [], assurance: ASSURANCE })
    }

    const steps = wo.steps.map((s, i) => resolveStep(wo, s, i))
    // Every step nonce is consumed by the dry-run itself: walking an order uses it up, so
    // a dry-run cannot be replayed and cannot be followed by a real run on the same
    // nonces. A real run will need its own approval and its own order.
    steps.forEach((_, i) => registry.consumeStep({ approvalId, stepIndex: i, stepNonce: admitted.stepNonces[i] }))
    registry.close(approvalId)

    const inScope = steps.every((s) => s.verdict === 'in_scope')
    return finish({
      ok: inScope,
      dryRun: true,
      refusal: inScope ? null : 'step_out_of_scope',
      workOrderHash: hashComputerWorkOrder(wo),
      approvedRoot: ALLOWED_ROOT,
      steps,
      assurance: ASSURANCE,
      // Stated in the result, not only in a comment, so a caller reading this object
      // cannot mistake it for a green light.
      meaning: ASSURANCE.meaning
    })
  }

  /** Build and persist the computer-audit record. Never throws into the caller's path. */
  function writeAudit (result, wo, who) {
    if (!auditConfigured) return null
    try {
      const record = buildComputerAuditRecord({
        id: newId(),
        createdAt: clock(),
        approvalId: (wo && wo.approvalId) || null,
        workOrderHash: result.workOrderHash || null,
        who,
        steps: (result.steps || []).map((s) => ({
          n: s.n,
          action: s.action,
          targetApp: null,
          startedAt: clock(),
          durationMs: 0,
          // A dry-run performed nothing, so the honest outcome is 'refused' — never 'ok'.
          // 'ok' in this audit means an action happened and was verified. Marking a
          // dry-run 'ok' would make the record claim work that was never done.
          outcome: 'refused',
          refusalReason: s.verdict === 'in_scope' ? 'dry_run_no_action' : 'out_of_scope'
        })),
        risks: result.errors || [],
        abortReason: result.refusal || null
      })
      record.dryRun = true // marked unmistakably, at the top level
      artifactStore.write('computer-audit', record)
      return record
    } catch (_) {
      return null
    }
  }

  return {
    dryRun,
    auditConfigured,
    killSwitch,
    orderRegistry: registry,
    ASSURANCE,
    // There is no execute(). Its absence is asserted in the tests — a supervisor that
    // could act would need one, and this one must never grow it in Phase 2.
    capabilities: Object.freeze({ dryRun: true, execute: false, touchesDesktop: false })
  }
}

module.exports = { createComputerSupervisor, ASSURANCE, UNVERIFIABLE_BY_ACTION }
