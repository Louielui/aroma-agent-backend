'use strict'

/**
 * claudeWorker.js — B2-1 worker invocation adapter.
 *
 * Drives a headless `claude` process to perform ONE task inside a throwaway
 * sandbox, and returns a normalized Result (capability/adapter.js shape). It
 * builds the exact validated spike command:
 *
 *   claude -p "<task>" --add-dir <sandbox> --permission-mode bypassPermissions
 *          --output-format json
 *
 * SAFETY — THE ONLY BRAKE. Because the command runs with
 * `--permission-mode bypassPermissions`, the single thing standing between this
 * worker and a real repository is the sandbox containment guard below. Before
 * ANY process is spawned, assertSandboxUnderTmpdir() canonicalises the target
 * (resolving '..' and symlinks) and refuses to invoke unless it lives strictly
 * UNDER os.tmpdir(). If the guard is wrong, bypassPermissions has no brake — so
 * it is tested hardest (escapes, symlinks, the repo path, tmpdir itself).
 *
 * All process execution goes through an INJECTED `runner(command, argsArray)
 * -> Promise<{ status, stdout, stderr }>` (spawn, shell:false), so unit tests
 * inject a stub and never call real claude. This module builds an argument
 * ARRAY and never a shell string — no quoting, no injection surface.
 */

const childProcess = require('node:child_process')
const { createResult } = require('../capability/adapter')
// THE BRAKE + the workspace provider now live in the WorkspaceProvider (B2-7).
// Re-exported below so existing `require('./claudeWorker').assertSandboxUnderTmpdir`
// call-sites keep working unchanged.
const { createTmpdirSandbox, assertSandboxUnderTmpdir, canonicalise } = require('./workspace/tmpdirSandbox')

const SUPPORTED = { Invoke: [1] }

// Zero human-relay round-trips: this path is fully non-interactive (spawn with
// no stdin/readline, bypassPermissions => no Allow prompt). Recorded on every
// result so the artifact carries the 0/0/0 proof.
const NO_RELAY = { toUser: 0, fromUser: 0, manual: 0 }

/**
 * Real runner: async spawn, shell:false. Never called by unit tests (stub injected).
 * `opts.cwd` sets the child's working directory (the validated sandbox) so claude
 * operates INSIDE the sandbox, not the parent repo — `--add-dir` only widens the
 * allowed set, it does not move the workspace. `opts.stdio` closes stdin
 * (['ignore','pipe','pipe']) so the process physically cannot block on or request
 * input — non-interactivity by mechanism, not by claim.
 */
function defaultRunner (command, argsArray, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, argsArray, {
      shell: false,
      cwd: opts.cwd,
      stdio: opts.stdio || ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}

/** Build the exact spike command argument array. Order is asserted by tests.
 *  --add-dir and --permission-mode are sourced from the workspace provider; the
 *  default TmpdirSandbox yields the identical B2-1 args (byte-for-byte). */
function buildArgs (task, sandbox, workspace = createTmpdirSandbox()) {
  return ['-p', task, '--add-dir', ...workspace.addDirs(sandbox), '--permission-mode', workspace.permissionMode(), '--output-format', 'json']
}

/** Turn a runner result into a normalized Result (capability/adapter.js shape). */
function parseResult ({ status, stdout, stderr, command, args, sandbox }) {
  let parsed = null
  try {
    parsed = JSON.parse(stdout)
  } catch (_) {
    return createResult({
      ok: false,
      output: { exit: status, relay: NO_RELAY, command, args, sandbox, raw: null },
      error: `worker output was not valid JSON${stderr ? `: ${stderr}` : ''}`,
      cost: 0
    })
  }
  const isError = parsed.is_error === true
  const ok = status === 0 && !isError && parsed.subtype === 'success'
  return createResult({
    ok,
    output: {
      exit: status,
      subtype: parsed.subtype,
      isError,
      result: typeof parsed.result === 'string' ? parsed.result : null,
      relay: NO_RELAY,
      command,
      args,
      sandbox,
      raw: parsed
    },
    error: ok ? null : (stderr || parsed.result || `worker failed (exit ${status}, subtype ${parsed.subtype})`),
    cost: Number.isFinite(parsed.total_cost_usd) ? parsed.total_cost_usd : 0
  })
}

/**
 * Create the worker adapter.
 * @param {{ runner?: function, command?: string }} [options]
 *   runner  — injected process runner (defaults to a real spawn runner)
 *   command — the executable name (defaults to 'claude')
 * @returns {{ invoke, health, buildArgs }}
 */
function createClaudeWorker (options = {}) {
  const runner = typeof options.runner === 'function' ? options.runner : defaultRunner
  const command = typeof options.command === 'string' && options.command ? options.command : 'claude'
  // The workspace provider owns the sandbox brake + permission-mode/add-dir. The
  // default TmpdirSandbox reproduces B2-1 behaviour exactly.
  const workspace = options.workspace || createTmpdirSandbox()

  /**
   * @param {'Invoke'} capabilityId
   * @param {number} version
   * @param {{ task: string, sandbox: string }} input
   * @returns {Promise<import('../capability/adapter')>} normalized Result
   */
  async function invoke (capabilityId, version, input = {}) {
    if (!SUPPORTED[capabilityId]) {
      throw new Error(`claudeWorker does not support capability: ${capabilityId}`)
    }
    if (!SUPPORTED[capabilityId].includes(version)) {
      throw new Error(`claudeWorker does not support ${capabilityId} version ${version}`)
    }
    const task = input && input.task
    if (typeof task !== 'string' || task.trim() === '') {
      throw new Error('worker invoke requires a non-empty task')
    }
    // THE BRAKE — runs BEFORE any process is spawned. Throws => runner never called.
    // The SAME validated path is used for BOTH --add-dir AND the child's cwd, so
    // claude's workspace is the sandbox, not the repo. stdin is closed.
    const safeSandbox = workspace.containmentCheck(input && input.sandbox)
    const args = buildArgs(task, safeSandbox, workspace)
    const { status, stdout, stderr } = await runner(command, args, {
      cwd: safeSandbox,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return parseResult({ status, stdout, stderr, command, args, sandbox: safeSandbox })
  }

  function health () {
    return { availability: 'up', latencyMs: 0 }
  }

  return { invoke, health, buildArgs }
}

module.exports = {
  createClaudeWorker,
  assertSandboxUnderTmpdir,
  canonicalise,
  buildArgs,
  defaultRunner,
  SUPPORTED,
  NO_RELAY
}
