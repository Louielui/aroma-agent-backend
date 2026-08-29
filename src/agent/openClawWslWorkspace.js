'use strict'

/**
 * openClawWslWorkspace.js — THE SANDBOX LIVES WHERE THE EXECUTOR LIVES.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * OpenClaw runs inside the OpenClawGateway WSL distro, and that distro is genuinely
 * sealed off from Windows: measured, /etc/wsl.conf sets `[automount] enabled=false` and
 * `[interop] enabled=false`, /mnt/c has zero entries, and nothing under C: is readable.
 *
 * featureBranchWorkspace creates its clone under the WINDOWS tmpdir. So if OpenClaw were
 * pointed at a COPY inside WSL while verification kept inspecting the Windows clone, every
 * C1 guarantee would pass VACUOUSLY — repoChanges, sandboxState and containment would all
 * be reading a directory the executor never touched. A read-only verifier aimed at a
 * directory nobody wrote to always reports "clean", and it would look exactly like a
 * successful audit. That is worse than having no verifier, because it is indistinguishable
 * from one that works.
 *
 * So this provider measures every filesystem and Git fact INSIDE the distro, on the same
 * POSIX directory OpenClaw is given. Windows fs/path/git APIs are never security truth here.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 * It is NOT a dual-mode rewrite of featureBranchWorkspace. That provider is production-proven
 * for AgentBridge and is left exactly as it is; a shared implementation would put Claude's
 * proven path at risk for OpenClaw's benefit.
 *
 * Every C1 invariant is carried over deliberately, not by inheritance: complete change
 * detection including IGNORED files, exact NUL pathname identity, HEAD/branch/remote/index
 * identity against a baseline recorded at prepare time, and the hardening that stops the
 * verifier from becoming an execution surface.
 */

const childProcess = require('node:child_process')

/** Fixed trusted configuration. None of it is reachable from a Work Order, model or executor. */
const DISTRO = 'OpenClawGateway'
const SANDBOX_ROOT = '/home/openclaw/.aroma/sandboxes'
const MIRROR_PATH = '/home/openclaw/.aroma/mirrors/aroma-agent-backend.git'
const EXPECTED_REMOTE = 'https://github.com/Louielui/aroma-agent-backend.git'

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const FULL_SHA_RE = /^[0-9a-f]{40}$/
/** A POSIX absolute path with no traversal, no NUL, no newline — validated before it enters argv. */
const SAFE_POSIX = /^\/[A-Za-z0-9._\-/]{1,200}$/

const DEFAULT_TIMEOUT_MS = 120000
const DEFAULT_MAX_OUTPUT = 2 * 1024 * 1024

/**
 * ⛔ EVERY GIT CALL DISABLES core.fsmonitor.
 * fsmonitor names an external helper and is configured in .git/config — inside the sandbox
 * being policed. Measured on this machine: with it set, the detector's own `git diff` and
 * `git ls-files` EXECUTED it. The override travels in argv per invocation, because the
 * repository's own config cannot be trusted to say it is off.
 */
const SAFE_GIT = Object.freeze(['-c', 'core.fsmonitor=false'])

/** Default launcher: wsl.exe with a fixed argv, shell:false, bounded output and time. */
function defaultWslRunner (argv, opts = {}) {
  const r = childProcess.spawnSync('wsl.exe', argv, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxBuffer: opts.maxOutput || DEFAULT_MAX_OUTPUT
  })
  const timedOut = r.error && (r.error.code === 'ETIMEDOUT' || /timed? ?out/i.test(String(r.error.message || '')))
  return {
    status: r.status === null || r.status === undefined ? (r.error ? 1 : null) : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || (r.error ? String(r.error.message || '') : ''),
    timedOut: !!timedOut
  }
}

/**
 * @param {object} options fixed trusted configuration; `wslRunner` is injected by tests so
 *   no unit test needs a real distro, and the real-distro proof injects nothing.
 */
function createOpenClawWslWorkspace (options = {}) {
  const distro = typeof options.distro === 'string' && options.distro ? options.distro : DISTRO
  const sandboxRoot = typeof options.sandboxRoot === 'string' && options.sandboxRoot ? options.sandboxRoot : SANDBOX_ROOT
  const mirrorPath = typeof options.mirrorPath === 'string' && options.mirrorPath ? options.mirrorPath : MIRROR_PATH
  const expectedRemote = typeof options.expectedRemote === 'string' && options.expectedRemote ? options.expectedRemote : EXPECTED_REMOTE
  const run = typeof options.wslRunner === 'function' ? options.wslRunner : defaultWslRunner
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const maxOutput = Number.isFinite(options.maxOutput) ? options.maxOutput : DEFAULT_MAX_OUTPUT

  if (!SAFE_POSIX.test(sandboxRoot)) throw new TypeError('openClawWslWorkspace requires a safe POSIX sandboxRoot')

  /** The sandbox identity recorded by prepare(), keyed by the POSIX clone path. */
  const PREPARED = new Map()

  /** Run a fixed-argv command inside the distro. No shell, ever. */
  function wsl (argv) {
    return run(['-d', distro, '--'].concat(argv), { timeoutMs, maxOutput })
  }

  /** Run git inside the distro against an explicit repository, always hardened. */
  function git (args, dir) {
    const argv = ['git'].concat(SAFE_GIT)
    if (dir) argv.push('-C', dir)
    return wsl(argv.concat(args))
  }

  /** Ask git a question that must succeed; a failure or a timeout is never an answer. */
  function ask (args, dir, what) {
    const r = git(args, dir)
    if (!r || r.timedOut) throw new Error(`refuse: ${what} timed out`)
    if (r.status !== 0) throw new Error(`refuse: ${what} unreadable (${(r.stderr || '').trim().slice(0, 200) || r.status})`)
    return String(r.stdout || '')
  }

  /**
   * ⛔ WSL CONTAINMENT, NOT WINDOWS CONTAINMENT.
   *
   * os.tmpdir() semantics mean nothing here: the path is POSIX, inside another operating
   * system. Containment is proven by asking the DISTRO to canonicalise the path, then
   * requiring it to sit strictly beneath the fixed sandbox root — strictly, so the root
   * itself is refused, and canonically, so a symlink cannot point out of the sandbox while
   * the literal string still looks contained.
   */
  function containmentCheck (dir) {
    if (typeof dir !== 'string' || !SAFE_POSIX.test(dir)) throw new Error('refuse: unsafe sandbox path')

    const rootReal = wsl(['readlink', '-f', sandboxRoot])
    if (rootReal.status !== 0) throw new Error('refuse: sandbox root unresolvable')
    const dirReal = wsl(['readlink', '-f', dir])
    if (dirReal.status !== 0) throw new Error('refuse: sandbox path unresolvable')

    const root = String(rootReal.stdout || '').trim().replace(/\/+$/, '')
    const real = String(dirReal.stdout || '').trim().replace(/\/+$/, '')
    if (root === '' || real === '') throw new Error('refuse: sandbox path unresolvable')
    if (real === root) throw new Error('refuse: the sandbox root itself is not a sandbox')
    if (!real.startsWith(root + '/')) throw new Error(`refuse: sandbox is outside ${root}`)

    // The mirror is trusted source, never an execution target. Even if it were moved
    // beneath the sandbox root, handing it to an executor would put the source of every
    // future clone inside the blast radius.
    const mirrorReal = wsl(['readlink', '-f', mirrorPath])
    const mirror = mirrorReal.status === 0 ? String(mirrorReal.stdout || '').trim().replace(/\/+$/, '') : null
    if (mirror && (real === mirror || real.startsWith(mirror + '/'))) {
      throw new Error('refuse: the source mirror is not an execution sandbox')
    }
    return dir
  }

  /**
   * A disposable clone of the trusted mirror, on its own agent branch, with no remotes.
   *
   * The executor is never told the mirror path. It receives only the disposable clone, and
   * the clone's remotes are stripped so commit/push/PR/merge have nowhere to go — the same
   * shape featureBranchWorkspace established, enforced here in POSIX terms.
   */
  function prepare (approvalId) {
    if (typeof approvalId !== 'string' || !SAFE_ID.test(approvalId)) {
      throw new Error('prepare requires a safe approvalId ([A-Za-z0-9_-]{1,64})')
    }
    const branch = `agent/${approvalId}`
    const dir = `${sandboxRoot}/${approvalId}`
    if (!SAFE_POSIX.test(dir)) throw new Error('refuse: unsafe sandbox path')

    const mk = wsl(['mkdir', '-p', sandboxRoot])
    if (mk.status !== 0) throw new Error('refuse: sandbox root not creatable')

    // A leftover directory from a previous attempt is removed only after it has been proven
    // to be a sandbox — never on the strength of its name.
    const exists = wsl(['test', '-e', dir])
    if (exists.status === 0) {
      containmentCheck(dir)
      const rm = wsl(['rm', '-rf', '--', dir])
      if (rm.status !== 0) throw new Error('refuse: stale sandbox not removable')
    }

    const clone = wsl(['git'].concat(SAFE_GIT, ['clone', '--no-hardlinks', '--quiet', mirrorPath, dir]))
    if (clone.status !== 0) throw new Error(`refuse: clone failed (${(clone.stderr || '').trim().slice(0, 200) || clone.status})`)

    containmentCheck(dir)

    const co = git(['checkout', '-q', '-b', branch], dir)
    if (co.status !== 0) throw new Error(`refuse: branch checkout failed (${(co.stderr || '').trim().slice(0, 200) || co.status})`)

    for (const rem of String(ask(['remote'], dir, 'remote state')).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
      git(['remote', 'remove', rem], dir)
    }
    if (String(ask(['remote'], dir, 'remote state')).trim() !== '') throw new Error('refuse: a git remote is still present after removal')

    const cur = ask(['rev-parse', '--abbrev-ref', 'HEAD'], dir, 'branch').trim()
    if (cur !== branch) throw new Error(`refuse: not on agent branch (on '${cur}')`)
    if (cur === 'main') throw new Error('refuse: workspace is on main')

    const baseSha = ask(['rev-parse', 'HEAD'], dir, 'HEAD').trim()
    if (!FULL_SHA_RE.test(baseSha)) throw new Error('refuse: clone HEAD is not a full commit sha')

    // The identity, recorded the instant the sandbox exists and before anything can run.
    const topLevel = canon(ask(['rev-parse', '--show-toplevel'], dir, 'top-level'))
    const gitDir = canon(ask(['rev-parse', '--absolute-git-dir'], dir, 'git-dir'))
    const commonDir = canon(ask(['rev-parse', '--path-format=absolute', '--git-common-dir'], dir, 'common-dir'))
    PREPARED.set(dir, Object.freeze({ root: canon(dir), topLevel, gitDir, commonDir, baseSha, branch }))

    return { dir, branch, baseSha }
  }

  /** POSIX paths are case-sensitive and already canonical from git; only trailing slashes vary. */
  function canon (value) {
    return String(value === undefined || value === null ? '' : value).trim().replace(/\/+$/, '')
  }

  /**
   * EVERY repository path whose worktree state differs from the clean clone.
   *
   * ⛔ NO --exclude-standard. That flag omits IGNORED paths, and the ignored ones are exactly
   * the security-relevant shapes: .env, *.log, data/, *.creds. A read-only executor could
   * otherwise write a credentials file and be reported clean.
   *
   * ⛔ PATHNAMES ARE NOT TOUCHED. -z makes the records NUL-delimited so they need no
   * interpretation; only the empty record the final delimiter produces is dropped. Trimming
   * would silently rename ' leading.txt' or erase '   ', both legal names.
   */
  function repoChanges (dir) {
    const split = (out) => {
      const parts = String(out === undefined || out === null ? '' : out).split(String.fromCharCode(0))
      if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
      return parts
    }
    const tracked = ask(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD'], dir, 'repository change detection')
    const untracked = ask(['ls-files', '--others', '-z'], dir, 'untracked change detection')
    return [...new Set(split(tracked).concat(split(untracked)))].sort()
  }

  /** Everything that must still be true about this sandbox, measured inside the distro. */
  function sandboxState (dir, expectedSha) {
    const baseline = PREPARED.get(dir)
    if (!baseline) throw new Error('refuse: no prepared sandbox baseline for this workspace')

    // .git must still be this clone's own real directory: a gitfile or a symlink is the
    // supported way to point Git at another repository entirely.
    const dotGit = wsl(['test', '-d', `${dir}/.git`])
    const dotGitLink = wsl(['test', '-L', `${dir}/.git`])
    const dotGitIsRealDir = dotGit.status === 0 && dotGitLink.status !== 0

    const topLevel = canon(ask(['rev-parse', '--show-toplevel'], dir, 'top-level'))
    const gitDir = canon(ask(['rev-parse', '--absolute-git-dir'], dir, 'git-dir'))
    const commonDir = canon(ask(['rev-parse', '--path-format=absolute', '--git-common-dir'], dir, 'common-dir'))

    const headSha = ask(['rev-parse', 'HEAD'], dir, 'HEAD').trim()
    if (!FULL_SHA_RE.test(headSha)) throw new Error('refuse: HEAD is not a full commit sha')
    const currentBranch = ask(['rev-parse', '--abbrev-ref', 'HEAD'], dir, 'branch').trim()
    if (currentBranch === '') throw new Error('refuse: branch state is empty')
    const remotes = ask(['remote'], dir, 'remote state').split(/\r?\n/).map((x) => x.trim()).filter((x) => x !== '')

    // ls-files -v marks assume-unchanged with a lowercase tag and skip-worktree with S.
    // Both hide a real file mutation from every worktree check.
    const indexFlagged = []
    for (const rec of ask(['ls-files', '-v', '-z'], dir, 'index flags').split(String.fromCharCode(0))) {
      if (rec === '') continue
      const tag = rec.charAt(0)
      if ((tag >= 'a' && tag <= 'z') || tag === 'S' || tag === 's') indexFlagged.push({ tag, file: rec.slice(2) })
    }

    let indexDrift = []
    if (typeof expectedSha === 'string' && FULL_SHA_RE.test(expectedSha)) {
      indexDrift = ask(['diff', '--no-ext-diff', '--no-textconv', '--cached', '--name-only', '-z', expectedSha], dir, 'index content')
        .split(String.fromCharCode(0)).filter((x) => x !== '')
    }

    return {
      headSha,
      currentBranch,
      remotes,
      indexFlagged,
      indexDrift,
      dotGitIsRealDir,
      topLevelOk: topLevel !== '' && topLevel === baseline.topLevel && topLevel === baseline.root,
      gitDirOk: gitDir !== '' && gitDir === baseline.gitDir,
      commonDirOk: commonDir !== '' && commonDir === baseline.commonDir,
      preparedBranch: baseline.branch,
      preparedBaseSha: baseline.baseSha
    }
  }

  function diffStat (dir) {
    const r = git(['diff', '--no-ext-diff', '--no-textconv', '--stat', 'HEAD'], dir)
    if (r.status !== 0) return ''
    return String(r.stdout || '').trim()
  }

  function diffPatch (dir) {
    const r = git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', 'HEAD'], dir)
    if (r.status !== 0) return ''
    return String(r.stdout || '')
  }

  /**
   * Remove ONLY a proven sandbox. containmentCheck runs first and throws on anything that is
   * not strictly beneath the sandbox root — the root itself, the mirror, the dev repo, a
   * symlinked escape, or a path shaped to look contained. `rm -rf` earns its danger only
   * after the target has been proven, never on the strength of the string it was handed.
   */
  function cleanup (dir) {
    try {
      containmentCheck(dir)
    } catch (e) {
      return { ok: false, reason: (e && e.message) || 'containment refused' }
    }
    const rm = wsl(['rm', '-rf', '--', dir])
    PREPARED.delete(dir)
    if (rm.status !== 0) return { ok: false, reason: (rm.stderr || '').trim().slice(0, 200) || 'remove failed' }
    return { ok: true }
  }

  /**
   * Refresh the trusted mirror. Read-only network, fetch only, and the remote identity is
   * proven mechanically first — an arbitrary existing remote is not trusted just because it
   * is already configured. No credential ever travels from the Windows process; if the fetch
   * needs auth it uses the distro's own local Git state.
   */
  function refreshMirror () {
    const url = ask(['remote', 'get-url', 'origin'], mirrorPath, 'mirror remote').trim()
    if (url !== expectedRemote) {
      return { ok: false, reason: `refuse: mirror origin is not the approved repository (${url || 'unset'})` }
    }
    const r = git(['fetch', '--prune', 'origin', '+refs/heads/*:refs/heads/*'], mirrorPath)
    if (r.timedOut) return { ok: false, reason: 'refuse: mirror fetch timed out' }
    if (r.status !== 0) return { ok: false, reason: (r.stderr || '').trim().slice(0, 200) || 'fetch failed' }
    return { ok: true }
  }

  return {
    prepare,
    containmentCheck,
    repoChanges,
    sandboxState,
    diffStat,
    diffPatch,
    cleanup,
    refreshMirror,
    // Observable so composition can be asserted rather than assumed.
    distro,
    sandboxRoot
  }
}

module.exports = { createOpenClawWslWorkspace, defaultWslRunner, DISTRO, SANDBOX_ROOT, MIRROR_PATH, EXPECTED_REMOTE }
