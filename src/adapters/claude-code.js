'use strict'

/**
 * claude-code.js — the first Worker Adapter for the Aroma OS backend.
 *
 * This adapter wraps the local Claude Code "selfexec" scripts to provide two
 * capabilities: Develop v1 and Apply v1. It fulfils the Worker Adapter contract
 * defined in ../capability/adapter.js.
 *
 * SAFETY — this adapter NEVER builds a shell command string. It always builds an
 * argument ARRAY and, when it must run a child process, uses child_process
 * .spawn with the array and `shell: false`, so arguments are passed to the
 * kernel one-by-one and are never concatenated, quoted, or unescaped. This
 * removes the entire class of shell-injection bugs.
 *
 * NON-BLOCKING — execution is asynchronous. An operating system must never be
 * unable to answer questions about itself while it is working, so the worker is
 * NEVER run with a synchronous, event-loop-blocking spawn. The child process is
 * spawned asynchronously and its exit is awaited, leaving the event loop free to
 * serve health checks and the live Run Timeline for the 25–80 seconds a worker
 * runs.
 *
 * All child-process execution goes through an injectable `runner` function with
 * the signature:
 *
 *   runner(command, argsArray) → Promise<{ status, stdout, stderr }>
 *
 * so tests can inject a fake runner and never touch the real Claude Code. When
 * no runner is supplied, a real runner backed by spawn (shell: false) is used.
 */

const path = require('node:path')
const childProcess = require('node:child_process')
const { createResult } = require('../capability/adapter')

// The only (capability id, version) pairs this adapter serves.
const SUPPORTED = {
  Develop: [1],
  Apply: [1]
}

/**
 * Default runner. Executes `command` with an argument ARRAY via the ASYNCHRONOUS
 * child_process.spawn, explicitly disabling the shell so arguments are never
 * re-parsed. It collects stdout and stderr and resolves only when the child
 * exits, so the Node event loop stays free the entire time the worker runs. This
 * is the only place a real process is spawned, and it is replaced by a fake in
 * tests. The arguments are always passed as an array — a shell string is never
 * built and the arguments are never concatenated.
 *
 * @param {string} command
 * @param {string[]} argsArray
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>}
 */
function defaultRunner (command, argsArray) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, argsArray, { shell: false })

    let stdout = ''
    let stderr = ''
    if (child.stdout) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => { stdout += chunk })
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => { stderr += chunk })
    }

    // A failure to even start the process (e.g. the executable is missing) is a
    // rejection; invoke() turns it into an honest ok:false result.
    child.on('error', reject)

    child.on('close', (code) => {
      resolve({
        status: typeof code === 'number' ? code : 1,
        stdout,
        stderr
      })
    })
  })
}

/**
 * Parse a real patch path from Develop stdout. A valid patch is a filesystem
 * path that ends with `.zip` and lives under a directory named `patches` — this
 * is the only evidence that Claude Code actually produced a patch.
 *
 * We must extract the PATH ITSELF, not the line that contains it. The develop
 * script may print a localized label before the path (e.g. a Chinese "補丁 :"
 * prefix), and that label — including any stray punctuation such as the colon —
 * must never leak into the returned path. So instead of slicing a line, we scan
 * for a path token that begins at a real path anchor: a Windows drive letter
 * (`C:\...`) or a leading separator (POSIX `/...`, or `\...`). The character
 * class for path segments excludes whitespace and quotes, so surrounding quotes
 * and trailing whitespace are naturally trimmed off the match.
 *
 * We never assume the label is English and never assume the path starts at the
 * beginning of the line. When several candidates appear we return the LAST one,
 * matching the develop script's habit of printing the final artifact last.
 * Returns null when no such path exists.
 *
 * @param {string} stdout
 * @returns {string|null}
 */
function parsePatchPath (stdout) {
  const text = String(stdout || '')
  // START: a Windows drive (C:\ or C:/) or a bare separator (/ or \).
  // Then any directory segments, a literal `patches` segment, more segments,
  // and a `.zip` filename. A segment char is anything but whitespace, quotes
  // and separators, so the match stops cleanly at a label, quote or newline.
  const re = /(?:[A-Za-z]:[\\/]|[\\/])(?:[^\s"'\\/]+[\\/])*patches[\\/](?:[^\s"'\\/]+[\\/])*[^\s"'\\/]*\.zip/gi
  const matches = text.match(re)
  if (!matches || matches.length === 0) {
    return null
  }
  return matches[matches.length - 1]
}

/**
 * Parse a backup reference from Apply stdout. The same discipline as
 * parsePatchPath applies: extract the reference ITSELF, not the whole line, so
 * a localized label before it (e.g. a Chinese "備份 :" prefix) is dropped rather
 * than captured. A backup reference lives under a directory named `backup` or
 * `backups`, so we match a token that starts at that directory. This also skips
 * an English `backupRef:` key, because the key is immediately followed by `Ref`
 * rather than a path separator. The segment class excludes whitespace and
 * quotes, so surrounding quotes and trailing whitespace are trimmed off.
 *
 * When several candidates appear we return the LAST one. Returns null when no
 * reference can be extracted.
 *
 * @param {string} stdout
 * @returns {string|null}
 */
function parseBackupRef (stdout) {
  const text = String(stdout || '')
  const re = /backups?[\\/][^\s"']+/gi
  const matches = text.match(re)
  if (!matches || matches.length === 0) {
    return null
  }
  return matches[matches.length - 1]
}

/**
 * Detect whether stdout explicitly reports that no files were changed. When a
 * develop run changes nothing there is no patch to apply, so the adapter must
 * treat this as a failure rather than a healthy sample.
 *
 * @param {string} stdout
 * @returns {boolean}
 */
function indicatesNoChanges (stdout) {
  return /no files (?:were )?changed|changed no files|no changes/i.test(String(stdout || ''))
}

/**
 * Parse a cost figure from stdout by matching a number that follows a US dollar
 * sign (e.g. "cost: $0.42"). Returns the parsed number, or null when no cost
 * can be found — the adapter must NEVER report zero it cannot prove, because
 * zero is a factual claim that no money was spent.
 *
 * @param {string} stdout
 * @returns {number|null}
 */
function parseCost (stdout) {
  const match = String(stdout || '').match(/\$\s*([0-9]+(?:\.[0-9]+)?)/)
  if (!match) {
    return null
  }
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

/**
 * Build a normalized result but preserve an unprovable cost as null. The shared
 * createResult() helper coerces a missing cost to 0; here we override it so an
 * unparsed cost stays null rather than falsely claiming zero spend.
 *
 * @param {object} result
 * @param {number|null} cost
 * @returns {object}
 */
function resultWithCost (result, cost) {
  const normalized = createResult(result)
  normalized.cost = (typeof cost === 'number' && Number.isFinite(cost)) ? cost : null
  return normalized
}

/**
 * Create a Claude Code Worker Adapter.
 *
 * @param {{ runner?: Function, selfexecDir?: string, backendRoot?: string,
 *           targetProject?: 'backend'|'frontend' }} [options]
 *   targetProject — which project the Develop script should target. The develop
 *   script defaults to the frontend project unless the `--backend` flag is
 *   passed, so backend work aimed at Aroma OS itself would silently land in the
 *   frontend and never produce a patch. We therefore default to 'backend' and
 *   only omit the flag when the caller explicitly asks for 'frontend'.
 * @returns {{ invoke: Function, health: Function }}
 */
function createClaudeCodeAdapter (options = {}) {
  const opts = options || {}
  const runner = typeof opts.runner === 'function' ? opts.runner : defaultRunner
  const backendRoot = opts.backendRoot || process.cwd()
  const selfexecDir = opts.selfexecDir || path.join(backendRoot, 'selfexec')
  const targetProject = opts.targetProject === 'frontend' ? 'frontend' : 'backend'

  // Resolve the absolute paths of the two scripts this adapter drives.
  const developScript = path.join(selfexecDir, 'develop.js')
  const applyScript = path.join(selfexecDir, 'apply.js')

  /**
   * Guard: this adapter is a development-only worker and must never be pointed
   * at production. Throw immediately if a caller asks for it.
   */
  function assertNotProduction (target) {
    if (target === 'production') {
      throw new Error('claude-code adapter never touches production')
    }
  }

  /**
   * Build the argument array for the Develop script. No shell string, ever.
   *
   * The target project is decided PER INVOCATION: when the input names a
   * targetProject (carried from the Run), that wins, so a frontend Run is never
   * misdirected to the backend project this adapter happened to be constructed
   * with. Only when the input is silent do we fall back to the constructed
   * `targetProject` option.
   *
   * When the effective target is 'backend' the `--backend` flag is inserted as
   * its own separate element immediately before the task string, so the develop
   * script targets the backend project instead of defaulting to the frontend.
   * When it is 'frontend' the flag is omitted entirely. The flag is never
   * concatenated into the task string.
   */
  function buildDevelopArgs (input) {
    const requested = input && input.targetProject
    const effectiveTarget = (requested === 'frontend' || requested === 'backend')
      ? requested
      : targetProject
    const args = [developScript, '--task']
    if (effectiveTarget === 'backend') {
      args.push('--backend')
    }
    args.push(String(input.task), '--target', String(input.target))
    return args
  }

  /**
   * Build the argument array for the Apply script. No shell string, ever.
   *
   * The apply script reads the patch zip as a bare POSITIONAL argument and
   * accepts only one optional flag, `--yes`, which skips its interactive
   * confirmation prompt. It does NOT understand `--patch` or `--target`: passing
   * `--patch` made the script treat that literal string as the zip path, fail to
   * find it, and exit non-zero without ever applying.
   *
   * So the arguments are exactly three elements: the apply script path, the
   * `--yes` flag, then the patch path taken from input.patchPath. The `--yes`
   * flag is required because the adapter runs the script non-interactively — the
   * human approval already happened upstream through the approval endpoint, and
   * an apply script waiting for a keystroke would hang forever.
   */
  function buildApplyArgs (input) {
    return [applyScript, '--yes', String(input.patchPath)]
  }

  /**
   * Perform one unit of work for an exact (capabilityId, version).
   * Rejects for any unsupported capability id or version, and for production.
   *
   * Asynchronous: the worker is awaited so the event loop stays free while it
   * runs. The resolved value is the same normalized result object as before,
   * with the fields ok, output, error, cost and latencyMs.
   *
   * @param {string} capabilityId
   * @param {number} version
   * @param {object} input
   * @returns {Promise<{ ok, output, error, cost, latencyMs }>}
   */
  async function invoke (capabilityId, version, input = {}) {
    const versions = SUPPORTED[capabilityId]
    if (!versions) {
      throw new Error(`claude-code adapter does not support capability: ${capabilityId}`)
    }
    if (!versions.includes(version)) {
      throw new Error(`claude-code adapter does not support ${capabilityId} version ${version}`)
    }

    // Reject production before running anything.
    assertNotProduction(input && input.target)

    const started = Date.now()

    if (capabilityId === 'Develop') {
      const args = buildDevelopArgs(input)
      // A runner that rejects (e.g. the child failed to start) is turned into an
      // honest ok:false result, never an unhandled rejection.
      let status, stdout, stderr
      try {
        ({ status, stdout, stderr } = await runner('node', args))
      } catch (err) {
        return resultWithCost({
          ok: false,
          output: { patchPath: null },
          error: (err && err.message) || String(err),
          latencyMs: Date.now() - started
        }, null)
      }
      const latencyMs = Date.now() - started
      const cost = parseCost(stdout)

      // A non-zero exit is always a failure, whatever stdout claims.
      if (status !== 0) {
        return resultWithCost({
          ok: false,
          output: { patchPath: null },
          error: stderr || `develop exited with status ${status}`,
          latencyMs
        }, cost)
      }

      // The adapter must never report success it cannot prove: a develop run
      // that changed no files produced no patch and is a failure, not a healthy
      // sample.
      if (indicatesNoChanges(stdout)) {
        return resultWithCost({
          ok: false,
          output: { patchPath: null },
          error: 'no patch produced: the worker changed no files',
          latencyMs
        }, cost)
      }

      // Only report success when a real patch path can be parsed from stdout.
      const patchPath = parsePatchPath(stdout)
      if (!patchPath) {
        return resultWithCost({
          ok: false,
          output: { patchPath: null },
          error: 'no patch produced: the worker changed no files',
          latencyMs
        }, cost)
      }

      return resultWithCost({
        ok: true,
        output: { patchPath },
        latencyMs
      }, cost)
    }

    // capabilityId === 'Apply'
    const args = buildApplyArgs(input)
    // As with Develop, a rejected runner becomes an honest ok:false result.
    let status, stdout, stderr
    try {
      ({ status, stdout, stderr } = await runner('node', args))
    } catch (err) {
      return resultWithCost({
        ok: false,
        output: { backupRef: null },
        error: (err && err.message) || String(err),
        latencyMs: Date.now() - started
      }, null)
    }
    const latencyMs = Date.now() - started
    const cost = parseCost(stdout)

    // A non-zero exit is always a failure, whatever stdout claims.
    if (status !== 0) {
      return resultWithCost({
        ok: false,
        output: { backupRef: null },
        error: stderr || `apply exited with status ${status}`,
        latencyMs
      }, cost)
    }

    // Same honesty rule: only report success when a backup reference proving the
    // apply happened can be parsed from stdout.
    const backupRef = parseBackupRef(stdout)
    if (!backupRef) {
      return resultWithCost({
        ok: false,
        output: { backupRef: null },
        error: 'no backup reference produced by apply',
        latencyMs
      }, cost)
    }

    return resultWithCost({
      ok: true,
      output: { backupRef },
      latencyMs
    }, cost)
  }

  /**
   * Cheap liveness probe. The adapter is 'up' when the runner is callable.
   *
   * @returns {{ availability: 'up'|'degraded'|'down', latencyMs: number }}
   */
  function health () {
    const availability = typeof runner === 'function' ? 'up' : 'down'
    return { availability, latencyMs: 0 }
  }

  return { invoke, health }
}

module.exports = {
  createClaudeCodeAdapter,
  defaultRunner
}
