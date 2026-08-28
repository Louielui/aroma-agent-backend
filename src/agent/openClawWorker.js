'use strict'

/**
 * openClawWorker.js — OpenClaw as a BOUNDED EXECUTOR, and at C1 an INERT one.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 * A second implementation of the worker boundary agentRunner already calls:
 *
 *     worker.invoke('AgentBridge', 1, { workOrder, workspace, cloneDir, branch })
 *
 * Deliberately the SAME interface, not a new one. agentRunner is unchanged by this
 * file, which is the point: every governance gate it owns — Work Order validation,
 * repository identity, approved hash, expectedSha vs observedBaseSha, patchSha256,
 * audit, cleanup — keeps applying to OpenClaw exactly as it applies to Claude Code,
 * because OpenClaw arrives through the same door rather than beside it.
 *
 * ── WHY IT CANNOT RUN ANYTHING (C1) ─────────────────────────────────────────
 * There is no default transport, and this module imports NO process, shell, socket
 * or HTTP capability at all — no child_process, no http, no net. That is stronger
 * than a disabled flag: a flag can be flipped by someone who does not know what it
 * guards, whereas a module that never required the ability to spawn cannot acquire
 * it by configuration. Importing this file in production is inert by construction.
 *
 * A transport is INJECTED for tests. With none, invoke() refuses and says so.
 *
 * ── AUTHORITY ───────────────────────────────────────────────────────────────
 * The sealed Work Order is the only authority. Nothing here — and nothing a
 * transport returns — may widen allowedFiles, forbiddenActions, allowedTestCommand,
 * expectedSha, the repository identity or the caps. Executor policy may only ever
 * NARROW: V1 is read-only, so a run that changed a repository file FAILS, and the
 * attempted change is reported rather than reverted.
 */

const { validateWorkOrder } = require('./workOrder')
const { createResult } = require('../capability/adapter')

/** Only the capability agentRunner actually calls, at the version it calls. */
const SUPPORTED = Object.freeze({ AgentBridge: [1] })

/** OpenClaw does not talk to the Owner. Relay stays zero, like the other executor. */
const NO_RELAY = Object.freeze({ toUser: 0, fromUser: 0, manual: 0 })

/** The empty output skeleton, so every refusal has the same readable shape. */
function emptyOutput (branch) {
  return {
    branch: branch === undefined ? null : branch,
    filesChanged: [],
    diffSummary: null,
    patchText: '',
    testResults: null,
    exit: null,
    result: null,
    risks: [],
    warnings: [],
    relay: NO_RELAY
  }
}

function fail (out, error, risks) {
  const output = Object.assign(emptyOutput(null), out || {})
  if (Array.isArray(risks)) output.risks = risks
  return createResult({ ok: false, output, error, cost: 0, latencyMs: 0 })
}

/**
 * ONE read-only verdict, taken at every checkpoint.
 *
 * ⛔ IT USES repoChanges, NOT filesChanged, AND HAS NO FALLBACK TO IT.
 * filesChanged asks `git diff --name-only HEAD`, which by definition never lists an
 * UNTRACKED file — so an executor that CREATED a new source file was reported perfectly
 * clean. A fallback to the incomplete detector would reintroduce exactly that blind spot
 * on whichever workspace happened not to implement the complete one, which is the worst
 * possible place for it to hide.
 *
 * A detector that cannot answer is not an answer of 'clean'. Both the missing-API case and
 * the throwing case fail closed, because 'nobody knows whether the repository was written
 * to' must never be actionable as 'it wasn't'.
 *
 * @returns {{ok:true, changed:string[]}|{ok:false, reason:string}}
 */
function repositoryChanges (workspace, cloneDir) {
  if (!workspace || typeof workspace.repoChanges !== 'function') {
    return { ok: false, reason: 'workspace does not provide complete repository change detection' }
  }
  try {
    const changed = workspace.repoChanges(cloneDir)
    return { ok: true, changed: Array.isArray(changed) ? changed : [] }
  } catch (e) {
    return { ok: false, reason: (e && e.message) || 'repository change detection failed' }
  }
}

/**
 * The execution brief — INFORMATION, never authority.
 *
 * Built from sealed facts only, in a fixed order, with no clock, no random id and no
 * model enrichment, so the same Work Order always produces the same bytes. A brief that
 * varied per call could not be compared, reproduced, or reasoned about after the fact.
 *
 * ⛔ currentExcerpt is NOT here. It exists so the OWNER could read what he was approving;
 * shipping it to an executor would send repository source outward for no purpose the
 * executor has — it is about to read the file itself, from its own clone. Nor is the
 * production repo path, any environment value, or any credential: this object is built
 * from the Work Order and nothing else, which is why it cannot leak what it never saw.
 *
 * @param {object} workOrder the sealed order
 * @returns {object} a deterministic, information-only brief
 */
function buildExecutionBrief (workOrder) {
  const wo = workOrder || {}
  const brief = {
    goal: typeof wo.goal === 'string' ? wo.goal : null,
    allowedFiles: Array.isArray(wo.allowedFiles) ? [...wo.allowedFiles].sort() : [],
    intendedChange: wo.intendedChange == null ? null : wo.intendedChange,
    allowedTestCommand: wo.allowedTestCommand == null ? null : wo.allowedTestCommand
  }
  return brief
}

/** Stable bytes for the brief, so "same order, same brief" is testable as an identity. */
function briefBytes (brief) { return JSON.stringify(brief) }

/**
 * @param {{ transport?: function, testRunner?: function }} options
 *   transport(brief, ctx) -> { ok, exit?, stdout?, stderr?, result?, timedOut?, error? }
 *   Both are INJECTED. There is no default for either at C1.
 */
/**
 * The read-only refusal, identical wherever it is detected.
 *
 * The change is NOT reverted and NOT retried: the clone is disposable and the attempted
 * edit is the most useful thing the run produced. It is carried back in the fields
 * agentRunner already understands, so the evidence survives without a second channel.
 */
function readOnlyViolation (workspace, cloneDir, branch, changed, run, warning) {
  const diffSummary = typeof workspace.diffStat === 'function' ? workspace.diffStat(cloneDir) : null
  const patchText = typeof workspace.diffPatch === 'function' ? workspace.diffPatch(cloneDir) : ''
  return createResult({
    ok: false,
    output: Object.assign(emptyOutput(branch), {
      filesChanged: changed,
      diffSummary: diffSummary || null,
      patchText: typeof patchText === 'string' ? patchText : '',
      exit: run && run.exit !== undefined ? run.exit : null,
      risks: ['openclaw_read_only_violation'],
      warnings: [warning]
    }),
    error: 'openclaw_read_only_violation',
    cost: 0,
    latencyMs: 0
  })
}

function createOpenClawWorker (options = {}) {
  const transport = typeof options.transport === 'function' ? options.transport : null
  const testRunner = typeof options.testRunner === 'function' ? options.testRunner : null

  async function invoke (capabilityId, version, input = {}) {
    if (!SUPPORTED[capabilityId]) throw new Error(`openClawWorker does not support capability: ${capabilityId}`)
    if (!SUPPORTED[capabilityId].includes(version)) throw new Error(`openClawWorker does not support ${capabilityId} v${version}`)

    const { workOrder, workspace, cloneDir, branch = null } = input || {}

    if (!workspace || typeof workspace.containmentCheck !== 'function') {
      return fail({ branch }, 'refuse: no workspace provider', ['no_workspace'])
    }

    // Defensive re-validation. agentRunner already validated, and that is not a reason to
    // skip it: this module is a boundary, and a boundary that trusts its caller is not one.
    const v = validateWorkOrder(workOrder)
    if (!v.ok) {
      return fail({ branch }, 'refuse: invalid work order', ['invalid_work_order'])
    }

    // ⛔ CONTAINMENT BEFORE TRANSPORT. Nothing may be handed a directory that has not been
    // proven to be the isolated clone — and proving it AFTER starting the executor would be
    // proving it after the damage.
    try {
      workspace.containmentCheck(cloneDir)
    } catch (e) {
      return fail({ branch }, `refuse: ${(e && e.message) || 'containment check failed'}`, ['containment'])
    }

    // C1: no transport is configured and none can be discovered. This is the honest end of
    // the path, not a fallback — there is deliberately no other executor to hand this to.
    if (!transport) {
      return fail({ branch }, 'refuse: openclaw transport not configured', ['no_transport'])
    }

    const brief = buildExecutionBrief(workOrder)

    let run
    try {
      run = await transport(brief, { cloneDir, branch })
    } catch (e) {
      // Normalized, never retried. A transport that failed once is a fact to report.
      return fail({ branch }, `openclaw transport failed: ${(e && e.message) || String(e)}`, ['transport_failed'])
    }
    if (!run || run.ok !== true) {
      const why = (run && (run.error || run.stderr)) || 'openclaw transport did not succeed'
      const risks = [run && run.timedOut === true ? 'timeout' : 'transport_failed']
      return fail({ branch, exit: run && run.exit !== undefined ? run.exit : null }, String(why), risks)
    }

    // ⛔ CONTAINMENT AGAIN, AFTER. The check before proves where we sent it; only the check
    // after can speak to where it actually operated.
    try {
      workspace.containmentCheck(cloneDir)
    } catch (e) {
      return fail({ branch }, `refuse: ${(e && e.message) || 'containment check failed after execution'}`, ['containment'])
    }

    const afterTransport = repositoryChanges(workspace, cloneDir)
    if (!afterTransport.ok) {
      return fail({ branch }, `refuse: ${afterTransport.reason}`, ['workspace_change_detection_failed'])
    }
    const filesChanged = afterTransport.changed

    // ── V1 IS READ-ONLY, STRUCTURALLY ────────────────────────────────────────
    // Any repository change is a violation, whatever the executor reported about itself.
    // The change is NOT reverted and NOT retried: the clone is disposable, and the
    // attempted edit is the most useful thing this run produced. It is carried back in the
    // fields agentRunner already understands, so the evidence survives without a second
    // reporting channel — and ok:false means no amount of "it went fine" can outrank it.
    if (filesChanged.length > 0) {
      return readOnlyViolation(workspace, cloneDir, branch, filesChanged, run,
        'OpenClaw V1 is read-only; the isolated clone was modified')
    }

    // The approved test command, at most once, and only on an otherwise clean run. The
    // executor never receives shell authority for this: the runner is injected, and it is
    // handed the APPROVED command from the sealed order — never a command of its own.
    let testResults = null
    const cmd = workOrder.allowedTestCommand
    if (typeof cmd === 'string' && cmd.trim() !== '') {
      if (!testRunner) {
        return fail({ branch, filesChanged }, 'refuse: openclaw test runner not configured', ['no_test_runner'])
      }
      try {
        testResults = await testRunner({ command: cmd, cwd: cloneDir, timeoutSec: workOrder.timeoutSec })
      } catch (e) {
        return fail({ branch, filesChanged }, `openclaw test runner failed: ${(e && e.message) || String(e)}`, ['test_failed'])
      }
      // ⛔ THE TEST IS VERIFIED TOO, AND A PASS DOES NOT EXCUSE IT.
      //
      // The approved command runs inside the clone, so it can modify, delete or CREATE
      // repository files just as the executor can. Checking only before the test would let a
      // read-only run become a repository mutation and still return ok:true, with a green
      // test as the cover story. Filesystem truth outranks a self-report here exactly as it
      // does for the transport — so this runs even when the test passed.
      try {
        workspace.containmentCheck(cloneDir)
      } catch (e) {
        return fail({ branch }, `refuse: ${(e && e.message) || 'containment check failed after test'}`, ['containment'])
      }
      const afterTest = repositoryChanges(workspace, cloneDir)
      if (!afterTest.ok) {
        return fail({ branch }, `refuse: ${afterTest.reason}`, ['workspace_change_detection_failed'])
      }
      if (afterTest.changed.length > 0) {
        return readOnlyViolation(workspace, cloneDir, branch, afterTest.changed, run,
          'the approved test command modified the repository')
      }

      if (!testResults || testResults.ok !== true) {
        return createResult({
          ok: false,
          output: Object.assign(emptyOutput(branch), {
            filesChanged, testResults: testResults || null,
            exit: run.exit === undefined ? null : run.exit,
            risks: ['test_failed'],
            warnings: ['the approved test command did not pass']
          }),
          error: 'the approved test command did not pass',
          cost: 0,
          latencyMs: 0
        })
      }
    }

    // A clean read-only run: no files changed, so patchText stays '' and the runner's
    // patchSha256 is null of its own accord. Nothing here has to remember to do that.
    return createResult({
      ok: true,
      output: Object.assign(emptyOutput(branch), {
        filesChanged: [],
        diffSummary: null,
        patchText: '',
        testResults,
        exit: run.exit === undefined ? null : run.exit,
        result: typeof run.result === 'string' ? run.result : null,
        risks: [],
        warnings: []
      }),
      error: null,
      cost: 0,
      latencyMs: 0
    })
  }

  /** Honest health: at C1 this executor can never run, and says so rather than implying readiness. */
  function health () {
    return { available: false, reason: transport ? 'transport injected (test only)' : 'openclaw transport not configured' }
  }

  return { invoke, health, buildExecutionBrief, briefBytes }
}

module.exports = { createOpenClawWorker, buildExecutionBrief, briefBytes, SUPPORTED, NO_RELAY }
