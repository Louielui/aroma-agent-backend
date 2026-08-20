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
const fs = require('node:fs')
const path = require('node:path')
const { createResult } = require('../capability/adapter')
const { validateWorkOrder, normRel } = require('./workOrder')

const SUPPORTED = { AgentBridge: [1] }
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024 // bounded output (Cap 2)
const NO_RELAY = { toUser: 0, fromUser: 0, manual: 0 }
const TIMEOUT_EXIT = 124

/** The explicit, minimal tool allowlist. No Bash/git/network — ever (Cap 1). */
function buildAllowedTools () { return ['Read', 'Edit', 'Write'] }

// ── CLI RESOLUTION ───────────────────────────────────────────────────────────
// The command used to be the bare string 'claude' with shell:false. On Windows that
// cannot start: `claude` is an extensionless shell script (ENOENT) and `claude.cmd`
// cannot be spawned without a shell (EINVAL, Node >= 18.20). Using shell:true would
// "fix" it by reintroducing shell interpretation of our arguments — exactly the
// injection surface Cap 1 exists to remove — so the command stays an absolute path to
// a real executable and shell:false never changes.
//
// Resolution order: an explicit AGENT_CLI_PATH override, then the known global-install
// locations. If nothing resolves we return null and the run REFUSES — there is
// deliberately no bare-'claude' fallback, because a fallback that cannot start is just
// a delayed, confusing failure.
const CLI_PATH_ENV = 'AGENT_CLI_PATH'

function claudeCandidates (env) {
  const out = []
  const pkgBin = path.join('node_modules', '@anthropic-ai', 'claude-code', 'bin')
  if (env.APPDATA) out.push(path.join(env.APPDATA, 'npm', pkgBin, 'claude.exe'))
  if (env.LOCALAPPDATA) out.push(path.join(env.LOCALAPPDATA, 'npm', pkgBin, 'claude.exe'))
  if (env.HOME) {
    out.push(path.join(env.HOME, '.npm-global', pkgBin, 'claude'))
    out.push(path.join(env.HOME, '.local', 'bin', 'claude'))
  }
  out.push(path.join('/usr', 'local', 'lib', pkgBin, 'claude'))
  out.push(path.join('/usr', 'local', 'bin', 'claude'))
  return out
}

/**
 * @returns {{ ok:true, command:string, source:string }|{ ok:false, reason:string }}
 */
function resolveAgentCliCommand (env = process.env, existsSync = fs.existsSync) {
  const override = env[CLI_PATH_ENV]
  if (typeof override === 'string' && override.trim() !== '') {
    const p = override.trim()
    if (!path.isAbsolute(p)) return { ok: false, reason: `${CLI_PATH_ENV} must be an absolute path` }
    if (!existsSync(p)) return { ok: false, reason: `${CLI_PATH_ENV} points at a file that does not exist` }
    return { ok: true, command: p, source: CLI_PATH_ENV }
  }
  for (const c of claudeCandidates(env)) {
    if (existsSync(c)) return { ok: true, command: c, source: 'default_install_path' }
  }
  return { ok: false, reason: `the Claude Code CLI executable was not found; set ${CLI_PATH_ENV} to its absolute path` }
}

// ── CHILD ENVIRONMENT ALLOWLIST ──────────────────────────────────────────────
// The agent used to inherit the WHOLE parent environment. On this machine that parent
// is the 心燈 server, whose env holds ANTHROPIC_API_KEY, HUB_TOKEN, GITHUB_READ_TOKEN,
// OPENAI_API_KEY and Google credential paths. Cap 5 makes credential FILES
// un-allowlistable, but none of that helps if the secrets are handed to the child in
// its environment — the agent could simply read them out of process.env.
//
// So the child env is BUILT, not inherited: only these names are copied, everything
// else is dropped. Each entry is here because the CLI cannot run without it:
//
//   PATH / Path        - locating helper binaries the CLI itself invokes
//   PATHEXT            - Windows executable resolution
//   SystemRoot/windir  - Windows API + networking DLLs live there; omit and it dies
//   COMSPEC            - Windows process creation expects it
//   USERPROFILE/HOMEDRIVE/HOMEPATH/HOME - so the CLI finds ~/.claude/.credentials.json,
//                        which is the ONLY authentication we deliberately pass (FIX 3)
//   APPDATA/LOCALAPPDATA - the CLI's own config/state directories
//   TEMP/TMP/TMPDIR    - scratch space
//   LANG/LC_ALL        - text encoding, so non-ASCII goals are not mangled
//   OS/PROCESSOR_ARCHITECTURE/NUMBER_OF_PROCESSORS - benign platform facts
//
// DELIBERATELY ABSENT: ANTHROPIC_API_KEY. Passing it would (a) make the agent bill the
// API account instead of the Owner's subscription and (b) hand a live credential to a
// process whose whole point is to be untrusted. The agent authenticates with the OAuth
// credentials file instead.
const CHILD_ENV_ALLOWLIST = Object.freeze([
  'PATH', 'Path', 'PATHEXT',
  'SystemRoot', 'windir', 'COMSPEC', 'ComSpec',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME',
  'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL',
  'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS'
])

// Belt and braces: even an allowlisted name is dropped if it LOOKS like a credential,
// so a future edit to the list above cannot quietly reopen this hole.
const SECRET_SHAPED = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|SESSION|COOKIE|PRIVATE)/i

/** Build the child's environment from the allowlist. Never inherits. */
function buildChildEnv (parentEnv = process.env) {
  const out = {}
  for (const name of CHILD_ENV_ALLOWLIST) {
    if (SECRET_SHAPED.test(name)) continue // unreachable today; guards future edits
    const v = parentEnv[name]
    if (typeof v === 'string' && v !== '') out[name] = v
  }
  return out
}

/**
 * THE EXECUTION BRIEF — the approved facts the executor is actually told.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHAT THIS FIXES, MEASURED. The first real canary approved 「add a line after the
 * first line of docs/HOUSE-RULES.md」 and the executor changed nothing, truthfully, for
 * 42 seconds and US$0.24 — because `-p` carried ONLY `workOrder.goal`, and `goal` is
 * the Owner's sentence with the FILENAME DELIBERATELY STRIPPED (requestInference's
 * intentFrom removes it so the approval card does not repeat the path). So the agent
 * received 「第一行之後加一行：…」 plus a whole repository via --add-dir, and no statement
 * of which file the Owner meant. It was never told the target; it did not ignore one.
 *
 * ⛔ INFORMATION, NOT AUTHORITY. Every fact here is already inside the SEALED, hashed,
 * Owner-approved Work Order. Naming the file in the prompt grants nothing: the fences
 * are still validateWorkOrder, the allowedFiles post-run check, the forbidden-file
 * list, the isolated remote-less clone, the Read/Edit/Write allowlist, the timeout and
 * the cost cap. None of them is relaxed because the prompt is now honest.
 *
 * ⛔ DETERMINISTIC. Same Work Order → same bytes. No clock, no random, no absolute
 * machine path, no model-generated enrichment. `cloneDir` deliberately stays OUT of
 * the semantic brief — it is an execution argument (--add-dir), not something the
 * Owner approved the agent to be told.
 *
 * ⛔ AND currentExcerpt STAYS OUT. The agent has Read access to the clone; injecting a
 * second, truncated copy of the file would add a source of truth that can disagree
 * with the file it is about to edit. The excerpt exists for the Owner's card.
 * ══════════════════════════════════════════════════════════════════════════════
 */
function buildExecutionBrief (workOrder) {
  const wo = workOrder || {}
  const lines = [String(wo.goal == null ? '' : wo.goal)]

  const files = Array.isArray(wo.allowedFiles) ? wo.allowedFiles.filter((f) => typeof f === 'string' && f !== '') : []
  if (files.length) {
    lines.push('')
    lines.push(files.length === 1 ? 'Approved target file: ' + files[0] : 'Approved target files: ' + files.join(', '))
  }

  if (typeof wo.intendedChange === 'string' && wo.intendedChange.trim() !== '') {
    lines.push('')
    lines.push('Approved intended change: ' + wo.intendedChange.trim())
  }

  return lines.join('\n')
}

/** Build the claude argument ARRAY. NEVER bypassPermissions; NEVER a shell string. */
function buildArgs (workOrder, cloneDir, permissionMode) {
  return [
    '-p', buildExecutionBrief(workOrder),
    '--add-dir', cloneDir,
    '--permission-mode', permissionMode,
    '--allowedTools', buildAllowedTools().join(' '),
    '--output-format', 'json'
  ]
}

/**
 * Real runner: async spawn, shell:false, HARD timeout kill, bounded output.
 * `opts.env` is the BUILT allowlist env — when supplied the child does not inherit the
 * parent's environment, so no credential reaches the agent through process.env.
 */
function defaultRunner (command, args, opts = {}) {
  return new Promise((resolve) => {
    const spawnOpts = { shell: false, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] }
    if (opts.env && typeof opts.env === 'object') spawnOpts.env = opts.env
    const child = childProcess.spawn(command, args, spawnOpts)
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

/**
 * Run the Owner-approved test command in the clone. shell:false; HARD timeout.
 * It gets the same allowlisted environment as the agent — a test command is Owner-chosen,
 * but it still runs inside the throwaway clone and still has no business seeing a secret.
 */
function defaultTestRunner (cmd, cwd, timeoutMs, env) {
  return new Promise((resolve) => {
    const parts = String(cmd).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
    const exe = parts[0]
    const a = parts.slice(1).map((s) => s.replace(/^["']|["']$/g, ''))
    if (!exe) { resolve({ ok: false, exit: null, output: 'no test command' }); return }
    const spawnOpts = { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }
    if (env && typeof env === 'object') spawnOpts.env = env
    const child = childProcess.spawn(exe, a, spawnOpts)
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
  // NO bare-'claude' fallback: an unresolvable CLI is a REFUSAL, not a guess.
  const command = (typeof options.command === 'string' && options.command) ? options.command : null
  const commandError = command ? null : (options.commandError || 'the Claude Code CLI path was not provided or could not be resolved')
  const testRunner = typeof options.testRunner === 'function' ? options.testRunner : defaultTestRunner
  const clock = typeof options.clock === 'function' ? options.clock : () => Date.now()
  const parentEnv = options.parentEnv || process.env

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

    // FAIL CLOSED on an unresolvable CLI — before the clone is touched, before any spawn.
    if (!command) return fail({ branch, filesChanged: [], exit: null, risks: ['cli_not_resolved'], warnings: [commandError] }, `refuse: ${commandError}`)

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
    // The child's environment is BUILT from the allowlist — never inherited. This is what
    // keeps ANTHROPIC_API_KEY / HUB_TOKEN / GITHUB_READ_TOKEN / OPENAI_API_KEY out of the
    // agent's reach.
    const childEnv = buildChildEnv(parentEnv)
    const started = clock()
    let run
    try {
      run = await runner(command, args, { cwd: safeClone, timeoutMs, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
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
    // ⛔ AN APPROVED MUTATION THAT CHANGED NOTHING IS NOT A SUCCESS.
    //
    // The CLI exiting 0 with subtype 'success' means the agent finished its turn, not
    // that the Owner's change exists. The first real canary proved the gap: exit 0,
    // no risks, zero files changed — and the whole chain above reported SUCCEEDED for
    // an approval that delivered nothing.
    //
    // The trigger is a non-empty `intendedChange`, because that is the Owner stating,
    // inside the hashed order, that a mutation was approved. A Work Order without one
    // keeps its previous behaviour exactly (see the compatibility test).
    //
    // ⛔ AND IT FAILS CLOSED RATHER THAN GUESSING 「already satisfied」. A natural-language
    //    intendedChange is not a machine-verifiable postcondition, and `currentExcerpt`
    //    is a truncated view — so nothing here can prove the requested state was
    //    already present. Calling a no-op 「already done」 would be inventing the one
    //    answer that hides the defect. Until a real postcondition verifier is designed
    //    and approved, zero delivery is refused.
    const mutationApproved = typeof workOrder.intendedChange === 'string' && workOrder.intendedChange.trim() !== ''
    if (mutationApproved && changed.length === 0) {
      risks.push('no_delivery_change')
      warnings.push('executor completed without producing the approved change')
    }
    const rem = workspace.remotes(safeClone)
    if (rem.length) { risks.push('remote_present'); warnings.push(`remote unexpectedly present: ${rem.join(', ')}`) }
    const curBranch = workspace.currentBranch(safeClone)
    if (curBranch === 'main' || curBranch === '') { risks.push('branch_violation'); warnings.push(`unexpected branch: '${curBranch}'`) }
    if (branch && curBranch !== branch) { risks.push('branch_mismatch'); warnings.push(`expected ${branch}, on ${curBranch}`) }
    const diffSummary = workspace.diffStat(safeClone)
    // THE PATCH ITSELF, captured before the clone is reaped. Taken here, next to the
    // stat, so the two can never describe different states of the tree. Written to a
    // file by the runner; the card shows the stat only.
    const patchText = typeof workspace.diffPatch === 'function' ? workspace.diffPatch(safeClone) : ''

    // Cap 1: the approved test is run by US, not the agent.
    let testResults = null
    if (typeof workOrder.allowedTestCommand === 'string' && workOrder.allowedTestCommand.trim() !== '') {
      try { testResults = await testRunner(workOrder.allowedTestCommand, safeClone, timeoutMs, childEnv) } catch (e) { testResults = { ok: false, exit: null, output: (e && e.message) || String(e) } }
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
        // Carried on the OUTPUT so the runner can persist it, and stripped from the
        // Owner-facing view — the card shows the stat, the file holds the patch.
        patchText,
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
  return { invoke, health, buildArgs, buildAllowedTools, command, buildChildEnv: () => buildChildEnv(parentEnv) }
}

module.exports = {
  createAgentBridgeWorker,
  defaultRunner,
  defaultTestRunner,
  buildAllowedTools,
  resolveAgentCliCommand,
  buildChildEnv,
  claudeCandidates,
  CHILD_ENV_ALLOWLIST,
  SECRET_SHAPED,
  CLI_PATH_ENV,
  SUPPORTED,
  NO_RELAY,
  MAX_OUTPUT_BYTES
}
