'use strict'

/**
 * agentBridgeWorker.js — the bounded Claude Code runner for Agent Bridge v0.
 *
 * It runs ONE approved Work Order inside an isolated feature-branch clone and
 * returns an enriched, honest Result. Every Phase-0 security cap is enforced here
 * by STRUCTURE, not by prompt:
 *
 *  - Cap 1: NO bypassPermissions. The command uses the workspace's restrictive
 *    permission mode + an explicit --allowedTools allowlist of exactly Read/Edit/
 *    Write. The agent gets NO Bash, NO git, NO network tool. The single approved
 *    test command is run by THIS runner (defaultTestRunner), not by the agent —
 *    so the CLI's tool-deny semantics are never the sole barrier (see report).
 *  - Cap 2: HARD spawn timeout (kill on expiry) + bounded output + cost cap. A
 *    missing/invalid timeout is a fail-closed REFUSE.
 *  - Cap 3/4: workspace containment re-checked before spawn; post-run it verifies
 *    the clone still has NO remote and is NOT on main, and that every changed file
 *    is inside allowedFiles — any violation forces ok:false + a risk flag.
 *  - Cap 8: FAIL = STOP. Any error returns ok:false; it never retries, never
 *    widens scope, never auto-remediates.
 *
 * All process execution is INJECTED (runner, testRunner) so unit tests never call
 * real claude or run a real test. Builds an argument ARRAY — never a shell string.
 */

const childProcess = require('node:child_process')
const { createResult } = require('../capability/adapter')
const { validateWorkOrder, normRel } = require('./workOrder')

const SUPPORTED = { AgentBridge: [1] }
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024 // bounded output (Cap 2)
const NO_RELAY = { toUser: 0, fromUser: 0, manual: 0 }
const TIMEOUT_EXIT = 124

/** The explicit, minimal tool allowlist. No Bash/git/network — ever (Cap 1). */
function buildAllowedTools () { return ['Read', 'Edit', 'Write'] }

/** Build the claude argument ARRAY. NEVER bypassPermissions; NEVER a shell string. */
function buildArgs (workOrder, cloneDir, permissionMode) {
  return [
    '-p', workOrder.goal,
    '--add-dir', cloneDir,
    '--permission-mode', permissionMode,
    '--allowedTools', buildAllowedTools().join(' '),
    '--output-format', 'json'
  ]
}

/** Real runner: async spawn, shell:false, HARD timeout kill, bounded output. */
function defaultRunner (command, args, opts = {}) {
  return new Promise((resolve) => {
    const child = childProcess.spawn(command, args, { shell: false, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const cap = (s, chunk) => (s.length < MAX_OUTPUT_BYTES ? s + chunk : s)
    child.stdout.on('data', (d) => { stdout = cap(stdout, d.toString()) })
    child.stderr.on('data', (d) => { stderr = cap(stderr, d.toString()) })
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL') } catch (_) {} }, opts.timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); resolve({ status: 1, stdout, stderr: (stderr + '\n' + ((e && e.message) || String(e))).trim(), timedOut }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ status: timedOut ? TIMEOUT_EXIT : (typeof code === 'number' ? code : 1), stdout, stderr, timedOut }) })
  })
}

/** Run the Owner-approved test command in the clone. shell:false; HARD timeout. */
function defaultTestRunner (cmd, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const parts = String(cmd).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
    const exe = parts[0]
    const a = parts.slice(1).map((s) => s.replace(/^["']|["']$/g, ''))
    if (!exe) { resolve({ ok: false, exit: null, output: 'no test command' }); return }
    const child = childProcess.spawn(exe, a, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let killed = false
    const cap = (d) => { if (out.length < 1024 * 1024) out += d.toString() }
    child.stdout.on('data', cap)
    child.stderr.on('data', cap)
    const t = setTimeout(() => { killed = true; try { child.kill('SIGKILL') } catch (_) {} }, timeoutMs)
    child.on('error', (e) => { clearTimeout(t); resolve({ ok: false, exit: null, output: String((e && e.message) || e) }) })
    child.on('close', (code) => { clearTimeout(t); resolve({ ok: !killed && code === 0, exit: killed ? TIMEOUT_EXIT : code, output: out.slice(0, 100000) }) })
  })
}

function fail (out, error, cost, latencyMs) {
  return createResult({ ok: false, output: Object.assign({ relay: NO_RELAY }, out), error, cost: cost || 0, latencyMs: latencyMs || 0 })
}

function createAgentBridgeWorker (options = {}) {
  const runner = typeof options.runner === 'function' ? options.runner : defaultRunner
  const command = typeof options.command === 'string' && options.command ? options.command : 'claude'
  const testRunner = typeof options.testRunner === 'function' ? options.testRunner : defaultTestRunner
  const clock = typeof options.clock === 'function' ? options.clock : () => Date.now()

  /**
   * @param {'AgentBridge'} capabilityId
   * @param {number} version
   * @param {{ workOrder, workspace, cloneDir, branch }} input
   */
  async function invoke (capabilityId, version, input = {}) {
    if (!SUPPORTED[capabilityId]) throw new Error(`agentBridgeWorker does not support capability: ${capabilityId}`)
    if (!SUPPORTED[capabilityId].includes(version)) throw new Error(`agentBridgeWorker does not support ${capabilityId} v${version}`)

    const { workOrder, workspace, cloneDir, branch = null } = input || {}
    if (!workspace || typeof workspace.containmentCheck !== 'function') return fail({ branch, filesChanged: [], exit: null, risks: ['no_workspace'], warnings: ['missing workspace provider'] }, 'refuse: no workspace provider')

    // Cap 8 fail-closed: validate the Work Order first.
    const v = validateWorkOrder(workOrder)
    if (!v.ok) return fail({ branch, filesChanged: [], diffSummary: null, testResults: null, exit: null, risks: ['invalid_work_order'], warnings: v.errors }, `invalid work order: ${v.errors.join('; ')}`)

    // Cap 2: a valid positive timeout is REQUIRED (validate already enforces > 0).
    const timeoutMs = Math.floor(workOrder.timeoutSec * 1000)
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fail({ branch, filesChanged: [], exit: null, risks: ['no_timeout'], warnings: ['fail-closed: no valid timeout'] }, 'refuse: no valid timeout')

    // Cap 3: re-check containment before spawning.
    let safeClone
    try { safeClone = workspace.containmentCheck(cloneDir) } catch (e) { return fail({ branch, filesChanged: [], exit: null, risks: ['containment_failed'], warnings: [e.message] }, e.message) }

    // Cap 1: refuse bypassPermissions no matter what the provider says.
    const permissionMode = workspace.permissionMode()
    if (permissionMode === 'bypassPermissions') return fail({ branch, filesChanged: [], exit: null, risks: ['bypass_forbidden'], warnings: ['permission mode bypassPermissions is forbidden'] }, 'refuse: bypassPermissions is forbidden')

    const args = buildArgs(workOrder, safeClone, permissionMode)
    const started = clock()
    let run
    try {
      run = await runner(command, args, { cwd: safeClone, timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return fail({ branch, filesChanged: [], exit: null, risks: ['spawn_failed'], warnings: [(e && e.message) || String(e)] }, (e && e.message) || String(e), 0, clock() - started)
    }
    const latencyMs = clock() - started

    let parsed = null
    try { parsed = JSON.parse(run.stdout) } catch (_) {}
    const cost = parsed && Number.isFinite(parsed.total_cost_usd) ? parsed.total_cost_usd : 0

    const risks = []
    const warnings = []
    if (run.timedOut) { risks.push('timeout'); warnings.push(`agent killed after ${workOrder.timeoutSec}s`) }
    if (cost > workOrder.costCapUsd) { risks.push('cost_cap_exceeded'); warnings.push(`cost ${cost} exceeds cap ${workOrder.costCapUsd}`) }

    // Post-run structural verification in the clone (Cap 3/4/5).
    const changed = workspace.filesChanged(safeClone)
    const allowedSet = new Set((workOrder.allowedFiles || []).map(normRel))
    const outside = changed.filter((f) => !allowedSet.has(normRel(f)))
    if (outside.length) { risks.push('files_outside_allowlist'); warnings.push(`changed outside allowlist: ${outside.join(', ')}`) }
    const rem = workspace.remotes(safeClone)
    if (rem.length) { risks.push('remote_present'); warnings.push(`remote unexpectedly present: ${rem.join(', ')}`) }
    const curBranch = workspace.currentBranch(safeClone)
    if (curBranch === 'main' || curBranch === '') { risks.push('branch_violation'); warnings.push(`unexpected branch: '${curBranch}'`) }
    if (branch && curBranch !== branch) { risks.push('branch_mismatch'); warnings.push(`expected ${branch}, on ${curBranch}`) }
    const diffSummary = workspace.diffStat(safeClone)

    // Cap 1: the approved test is run by US, not the agent.
    let testResults = null
    if (typeof workOrder.allowedTestCommand === 'string' && workOrder.allowedTestCommand.trim() !== '') {
      try { testResults = await testRunner(workOrder.allowedTestCommand, safeClone, timeoutMs) } catch (e) { testResults = { ok: false, exit: null, output: (e && e.message) || String(e) } }
      if (testResults && testResults.ok === false) { risks.push('tests_failed'); warnings.push('approved test command did not pass') }
    }

    const claudeOk = run.status === 0 && parsed && parsed.is_error !== true && parsed.subtype === 'success'
    const ok = claudeOk && risks.length === 0

    return createResult({
      ok,
      output: {
        branch: curBranch,
        filesChanged: changed,
        diffSummary,
        testResults,
        exit: run.status,
        result: parsed && typeof parsed.result === 'string' ? parsed.result : null,
        risks,
        warnings,
        relay: NO_RELAY
      },
      error: ok ? null : ((warnings.length ? warnings.join('; ') : (run.stderr || `agent failed (exit ${run.status})`))),
      cost,
      latencyMs
    })
  }

  function health () { return { availability: 'up', latencyMs: 0 } }
  return { invoke, health, buildArgs, buildAllowedTools }
}

module.exports = { createAgentBridgeWorker, defaultRunner, defaultTestRunner, buildAllowedTools, SUPPORTED, NO_RELAY, MAX_OUTPUT_BYTES }
