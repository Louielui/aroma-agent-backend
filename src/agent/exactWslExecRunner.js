'use strict'

/**
 * exactWslExecRunner.js — THE ONE WAY AROMA CROSSES INTO THE DISTRO.
 *
 * ── WHY `--exec`, AND WHY A SEPARATE MODULE ────────────────────────────────
 * `wsl.exe -d <distro> -- <argv>` hands argv to the user's LOGIN SHELL. Measured in X4-A.1
 * on this machine: the element `A|B;C>D$HOME\`id\`` produced "B: command not found" and an
 * "ambiguous redirect" — bash had parsed our argv as a command line. Every security decision
 * this programme makes about the executor rests on the argv it sends being the argv that
 * runs, so a boundary that re-parses it is not a boundary.
 *
 * `wsl.exe -d <distro> --exec <argv>` execs the binary directly. Measured, same round: the
 * identical element printed back byte-for-byte, `printf '%s|' 'a b' c` printed `a b|c|`, the
 * WSL-init environment (XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS) was still present under an
 * EMPTY Windows environment, `systemctl --user` was reachable, and a missing binary failed
 * loudly at execvpe instead of falling through to a shell. Nothing about the security posture
 * changed except the one thing that was wrong.
 *
 * It lives in its own module so that the workspace, the OS readers and the executor launcher
 * share ONE runner with ONE semantics. A second WSL implementation anywhere would be a second
 * place for `--` to come back.
 *
 * ── WHAT IS INJECTABLE ──────────────────────────────────────────────────────
 * Only execution MECHANICS: the spawn implementation, and bounds on time and output. The
 * launcher path, the distro, the empty child environment and shell:false are constants that
 * no option can reach. A test proves the constructed spawn call; nothing here trusts a caller
 * to describe the boundary.
 */

const childProcess = require('node:child_process')

/** The launcher, by absolute path so no PATH is needed in the child environment. */
const WSL_EXE = 'C:\\Windows\\System32\\wsl.exe'

/** Fixed trusted distro. Not reachable from any option, work order, model or executor. */
const DISTRO = 'OpenClawGateway'

/**
 * ⛔ THE CHILD ENVIRONMENT IS EMPTY, AND THAT IS THE POINT.
 * spawnSync inherits process.env when `env` is omitted — every provider key, database
 * credential and session secret the backend holds, plus WSLENV, the documented mechanism for
 * translating named Windows variables into the Linux side. Measured: wsl.exe runs correctly
 * with a completely empty environment, so nothing is allowlisted and nothing can drift.
 */
const CHILD_ENV = Object.freeze({})

const DEFAULT_TIMEOUT_MS = 120000
const DEFAULT_MAX_OUTPUT = 2 * 1024 * 1024

/** The literal separator that must never appear on the execution path again. */
const BARE_SEPARATOR = '--'
const EXEC_FLAG = '--exec'

/**
 * Validate a Linux argv before it is allowed near a spawn.
 * Every element must be a string (spawn would coerce anything else, and a coerced value is a
 * value nobody reviewed), the command itself must be non-empty, and no element may carry a
 * NUL — an argv element cannot contain one, and a string that does is a string that was
 * meant to end early.
 */
function assertLinuxArgv (argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new TypeError('exactWslExec requires a non-empty Linux argv array')
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (typeof a !== 'string') throw new TypeError(`exactWslExec argv[${i}] must be a string`)
    if (a.indexOf('\0') !== -1) throw new TypeError(`exactWslExec argv[${i}] contains NUL`)
  }
  if (argv[0] === '') throw new TypeError('exactWslExec requires a non-empty command')
}

/**
 * The Windows-side argv for a Linux argv. PURE and exported so a test can prove the exact
 * shape rather than scan source text:
 *
 *   ['git', '-C', '/x', 'status']  ->  ['-d', 'OpenClawGateway', '--exec', 'git', '-C', '/x', 'status']
 */
function windowsArgvFor (linuxArgv) {
  assertLinuxArgv(linuxArgv)
  return ['-d', DISTRO, EXEC_FLAG].concat(linuxArgv)
}

/**
 * Bound a caller-supplied limit: a finite positive number is honoured, anything else falls
 * back to the default. A caller can tighten or loosen how long a command may run — that is a
 * mechanic — but cannot make it unbounded.
 */
function bounded (value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Build a runner. `spawn` is the only injectable piece and exists for tests that must prove
 * the constructed call without a distro; the real one is node's spawnSync.
 *
 * The returned function takes a LINUX argv and returns
 *   { status, stdout, stderr, timedOut }
 * exactly as the workspace has always consumed it.
 *
 * @param {{ spawn?: function }} mechanics
 */
function createExactWslExecRunner (mechanics = {}) {
  // Resolved at CALL time, not construction time, so a test that intercepts spawnSync at the
  // module boundary still sees the production runner's actual call.
  const spawn = typeof mechanics.spawn === 'function'
    ? mechanics.spawn
    : (exe, argv, opts) => childProcess.spawnSync(exe, argv, opts)

  return function exactWslExec (linuxArgv, opts = {}) {
    const argv = windowsArgvFor(linuxArgv)
    const r = spawn(WSL_EXE, argv, {
      // Explicit, and empty. Omitting `env` would inherit the backend's whole environment.
      env: CHILD_ENV,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: bounded(opts && opts.timeoutMs, DEFAULT_TIMEOUT_MS),
      maxBuffer: bounded(opts && opts.maxOutput, DEFAULT_MAX_OUTPUT)
    }) || {}
    const err = r.error
    const timedOut = !!(err && (err.code === 'ETIMEDOUT' || /timed? ?out/i.test(String(err.message || ''))))
    return {
      // ⛔ A SPAWN THAT NEVER RAN IS A FAILURE, NOT A SUCCESS. `status` is null when the
      // launcher itself could not start or was killed; with an error attached that is 1.
      status: r.status === null || r.status === undefined ? (err ? 1 : null) : r.status,
      stdout: r.stdout || '',
      stderr: r.stderr || (err ? String(err.message || '') : ''),
      timedOut
    }
  }
}

/** The production runner: real spawnSync, nothing injected. */
const exactWslExec = createExactWslExecRunner()

module.exports = {
  createExactWslExecRunner,
  exactWslExec,
  windowsArgvFor,
  assertLinuxArgv,
  WSL_EXE,
  DISTRO,
  CHILD_ENV,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT,
  EXEC_FLAG,
  BARE_SEPARATOR
}
