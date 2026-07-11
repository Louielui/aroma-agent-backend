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

const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const childProcess = require('node:child_process')
const { createResult } = require('../capability/adapter')

const SUPPORTED = { Invoke: [1] }

// Zero human-relay round-trips: this path is fully non-interactive (spawn with
// no stdin/readline, bypassPermissions => no Allow prompt). Recorded on every
// result so the artifact carries the 0/0/0 proof.
const NO_RELAY = { toUser: 0, fromUser: 0, manual: 0 }

/**
 * Canonicalise a path, resolving '..' AND symlinks. For a path that does not
 * exist yet (the sandbox is created just before invocation), the deepest
 * existing ancestor is realpath'd and the remaining segments re-appended — so a
 * symlinked ancestor pointing outside tmpdir cannot smuggle the target back in.
 * @param {string} p
 * @returns {string}
 */
function canonicalise (p) {
  const resolved = path.resolve(p)
  try {
    return fs.realpathSync(resolved)
  } catch (_) {
    let dir = resolved
    const tail = []
    while (!fs.existsSync(dir)) {
      tail.unshift(path.basename(dir))
      const parent = path.dirname(dir)
      if (parent === dir) return resolved // reached a root that doesn't exist; give up on symlink resolution
      dir = parent
    }
    return path.join(fs.realpathSync(dir), ...tail)
  }
}

/**
 * THE BRAKE. Assert `target` resolves strictly UNDER os.tmpdir(); return the
 * canonical target. Throws (refusing invocation) on anything else: a repo path,
 * a '..' escape, an absolute real path, a symlink out, or tmpdir itself.
 * @param {string} target
 * @returns {string} the canonical, sandbox-safe path
 * @throws {Error} if the target is not strictly under os.tmpdir()
 */
function assertSandboxUnderTmpdir (target) {
  if (typeof target !== 'string' || target.trim() === '') {
    throw new Error('worker refuses to invoke: sandbox target must be a non-empty path')
  }
  const tmpReal = fs.realpathSync(os.tmpdir())
  const targetReal = canonicalise(target)
  const rel = path.relative(tmpReal, targetReal)
  // rel === ''       -> target IS tmpdir (need a subdir, not the root)
  // rel starts '..'  -> target escapes tmpdir
  // path.isAbsolute  -> different drive/root (Windows) -> outside tmpdir
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `worker refuses to invoke: sandbox target is not under os.tmpdir() ` +
      `(target="${target}", resolved="${targetReal}", tmpdir="${tmpReal}")`
    )
  }
  return targetReal
}

/** Real runner: async spawn, shell:false. Never called by unit tests (stub injected). */
function defaultRunner (command, argsArray) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, argsArray, { shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}

/** Build the exact spike command argument array. Order is asserted by tests. */
function buildArgs (task, sandbox) {
  return ['-p', task, '--add-dir', sandbox, '--permission-mode', 'bypassPermissions', '--output-format', 'json']
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
    const safeSandbox = assertSandboxUnderTmpdir(input && input.sandbox)
    const args = buildArgs(task, safeSandbox)
    const { status, stdout, stderr } = await runner(command, args)
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
