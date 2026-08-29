'use strict'

/**
 * featureBranchWorkspace.js — the isolation brake for Agent Bridge v0 (Cap 3/4).
 *
 * prepare(approvalId) makes an ISOLATED git clone of THIS repo under a throwaway
 * tmpdir, checks out branch `agent/<approvalId>`, and REMOVES every remote — so
 * the agent physically cannot commit-to / push / PR / merge the real repo (there
 * is no origin to push to, and it never runs in the live checkout). It asserts,
 * fail-closed, that the workspace is strictly under os.tmpdir(), is NOT the repo
 * root, and is on the agent branch (never main).
 *
 * The sandbox prefix is `aroma-sandbox-agent-` so the existing B2-12 startup sweep
 * reaps aged clones. All git calls go through an INJECTED gitRunner so tests never
 * clone a real repo. THE tmpdir containment brake is reused verbatim.
 */

const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const childProcess = require('node:child_process')
const { assertSandboxUnderTmpdir } = require('../workers/workspace/tmpdirSandbox')

const AGENT_SANDBOX_PREFIX = 'aroma-sandbox-agent-'
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
/** A full 40-char lowercase commit sha. */
const FULL_SHA_RE = /^[0-9a-f]{40}$/

/**
 * ⛔ EVERY SECURITY GIT CALL DISABLES core.fsmonitor.
 *
 * fsmonitor names an EXTERNAL HELPER, and it is configured in .git/config — inside the very
 * sandbox being policed. Measured: with core.fsmonitor set to a script, `git diff` and
 * `git ls-files` in this repository RAN it, so the verifier itself was an execution surface
 * for the thing it was verifying. With `-c core.fsmonitor=false` prepended, the helper was
 * not executed. The override is passed in argv, per invocation: the repository's own config
 * cannot be trusted to say fsmonitor is off, and nothing global is modified.
 */
const SAFE_GIT_PREFIX = Object.freeze(['-c', 'core.fsmonitor=false'])

/**
 * One canonical form for comparing paths. realpath resolves symlinks (a .git symlinked to
 * another repository must not compare equal to this clone's own), and on Windows the
 * comparison folds case because the filesystem does.
 */
function canonPath (value) {
  let out = String(value === undefined || value === null ? '' : value).trim()
  if (out === '') return ''
  try { out = fs.realpathSync.native(out) } catch (_) { out = path.resolve(out) }
  out = path.resolve(out).replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? out.toLowerCase() : out
}

/**
 * The sandbox identity recorded by prepare(), keyed by canonical clone path.
 *
 * ⛔ IT LIVES HERE, NOT IN THE WORK ORDER AND NOT IN THE EXECUTOR'S HANDS. prepare() is the
 * authority that CREATES the sandbox, so it is the only thing entitled to say what the
 * sandbox's identity was before any executor could touch it. A baseline the executor could
 * supply would be a second authority object — precisely what a redirect attack needs.
 * Verification with no baseline fails closed: an unprepared directory is not a sandbox.
 */
const PREPARED = new Map()
/** A full 40-char lowercase commit sha — the same shape the Owner's expectedSha must be. */
const FULL_SHA = /^[0-9a-f]{40}$/

/** Default git runner: spawnSync, shell:false. Returns {status, stdout, stderr}. */
function defaultGitRunner (args, cwd) {
  const r = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8', shell: false })
  return { status: r.status == null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

function realOf (p) { try { return fs.realpathSync(path.resolve(p)) } catch (_) { return path.resolve(p) } }

function createFeatureBranchWorkspace (options = {}) {
  const opts = options || {}
  const repoRoot = opts.repoRoot
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') throw new TypeError('featureBranchWorkspace requires repoRoot')
  const sandboxRoot = typeof opts.sandboxRoot === 'string' && opts.sandboxRoot ? opts.sandboxRoot : os.tmpdir()
  const rawGit = typeof opts.gitRunner === 'function' ? opts.gitRunner : defaultGitRunner
  // Every call this module makes is hardened. There is deliberately no un-hardened path:
  // an exception 'just for evidence collection' is how the execution surface comes back.
  const git = (args, cwd) => rawGit(SAFE_GIT_PREFIX.concat(args), cwd)
  const mkdtemp = typeof opts.mkdtemp === 'function' ? opts.mkdtemp : (p) => fs.mkdtempSync(p)
  const repoReal = realOf(repoRoot)

  /** Clone → branch → strip remotes → measure base revision. Fail-closed throughout. */
  function prepare (approvalId) {
    if (typeof approvalId !== 'string' || !SAFE_ID.test(approvalId)) throw new Error('prepare requires a safe approvalId ([A-Za-z0-9_-]{1,64})')
    const branch = `agent/${approvalId}`

    const dir = mkdtemp(path.join(sandboxRoot, AGENT_SANDBOX_PREFIX))
    // CONTAINMENT: strictly under os.tmpdir() (reused brake), and NEVER the repo.
    const safe = assertSandboxUnderTmpdir(dir)
    if (realOf(safe) === repoReal) throw new Error('refuse: workspace equals repo root')

    let r = git(['clone', '--no-hardlinks', '--quiet', repoReal, safe])
    if (r.status !== 0) throw new Error(`refuse: clone failed (${(r.stderr || '').trim() || r.status})`)

    r = git(['checkout', '-q', '-b', branch], safe)
    if (r.status !== 0) throw new Error(`refuse: branch checkout failed (${(r.stderr || '').trim() || r.status})`)

    // Remove EVERY remote so there is no push/PR/merge target.
    const remotesOut = git(['remote'], safe)
    for (const rem of String(remotesOut.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      git(['remote', 'remove', rem], safe)
    }
    // Post-conditions (fail-closed): no remote, on the agent branch, not main.
    if (String(git(['remote'], safe).stdout || '').trim() !== '') throw new Error('refuse: a git remote is still present after removal')
    const cur = String(git(['rev-parse', '--abbrev-ref', 'HEAD'], safe).stdout || '').trim()
    if (cur !== branch) throw new Error(`refuse: not on agent branch (on '${cur}')`)
    if (cur === 'main') throw new Error('refuse: workspace is on main')

    // ── B2-B: WHICH REVISION THIS EXECUTION ACTUALLY STARTS FROM ─────────────
    //
    // Measured INSIDE THE CLONE, deliberately. Re-reading the live repository's HEAD
    // here would answer a different question — where the source is NOW — and the clone
    // is what the worker is about to edit. If the live repo moved between the Owner's
    // approval and this moment, the live HEAD would agree with itself and the mismatch
    // the gate exists to catch would be invisible.
    //
    // It is measured, never accepted: no caller, Work Order, worker or model supplies it.
    // If the clone cannot say what it is, no worker may receive it.
    const baseOut = git(['rev-parse', 'HEAD'], safe)
    if (baseOut.status !== 0) throw new Error(`refuse: clone HEAD unreadable (${(baseOut.stderr || '').trim() || baseOut.status})`)
    const baseSha = String(baseOut.stdout || '').trim()
    if (!FULL_SHA.test(baseSha)) throw new Error('refuse: clone HEAD is not a full commit sha')

    // The sandbox's identity, recorded the instant it exists and before any executor can
    // run. Everything later is compared against this rather than against itself.
    const topLevel = git(['rev-parse', '--show-toplevel'], safe)
    if (topLevel.status !== 0) throw new Error('refuse: clone top-level unreadable')
    const gitDir = git(['rev-parse', '--absolute-git-dir'], safe)
    if (gitDir.status !== 0) throw new Error('refuse: clone git-dir unreadable')
    const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], safe)
    if (commonDir.status !== 0) throw new Error('refuse: clone common-dir unreadable')

    PREPARED.set(canonPath(safe), Object.freeze({
      root: canonPath(safe),
      topLevel: canonPath(topLevel.stdout),
      gitDir: canonPath(gitDir.stdout),
      commonDir: canonPath(commonDir.stdout),
      baseSha,
      branch
    }))

    return { dir: safe, branch, baseSha }
  }

  /** THE BRAKE — canonical, strictly-under-tmpdir path or throw. */
  function containmentCheck (target) { return assertSandboxUnderTmpdir(target) }
  /** The --add-dir set: the isolated clone only. */
  function addDirs (dir) { return [dir] }
  /** Permission mode — NEVER bypassPermissions (Cap 1). */
  function permissionMode () { return 'acceptEdits' }
  /**
   * EVERY repository path whose worktree state differs from the clean clone.
   *
   * ⛔ NO --exclude-standard. THAT FLAG HID THE FILES THAT MATTER MOST.
   * `ls-files --others --exclude-standard` omits ignored paths, and this repository
   * ignores exactly the security-relevant ones: .env, *.log, data/, *.creds, /*.txt,
   * password.txt, browser-profile/. Measured in a scratch repo with those rules, the
   * flagged command reported only plain-new.txt while .env, app.log and data/db.json were
   * invisible. A read-only executor could therefore WRITE A CREDENTIALS FILE and be
   * reported clean. The invariant is that any repository write fails, so the question
   * asked here is 'what exists that HEAD does not have', with no opinion about whether
   * git would normally care about it.
   *
   * ⛔ PATHNAMES ARE NOT TOUCHED. No trim, no separator rewriting. A git pathname is an
   * IDENTITY: ' leading.txt', 'trailing.txt ' and even '   ' are legal distinct names, and
   * trimming them silently renames or erases a file that was really written. -z exists
   * precisely so the records need no interpretation — the only thing removed is the empty
   * record the final delimiter produces.
   *
   * ⛔ AND IT FAILS CLOSED. filesChanged returns [] when git fails, which reads as 'nothing
   * changed' when the truth is 'nobody knows'. Those are different facts and only one is
   * safe to act on, so this THROWS. A caller unable to tell whether the repository was
   * written to must not be able to conclude that it wasn't.
   *
   * A working-tree rename is a deletion plus an untracked file, so the pair covers it.
   *
   * @param {string} dir the clone
   * @returns {string[]} de-duplicated, sorted, EXACT git pathnames
   * @throws if either git command fails
   */
  function repoChanges (dir) {
    // NUL-delimited records. Only the trailing delimiter's empty record is dropped; every
    // other record is preserved byte-for-byte, including one that is only whitespace.
    const split = (out) => {
      const parts = String(out === undefined || out === null ? '' : out).split(String.fromCharCode(0))
      if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
      return parts
    }

    // --no-ext-diff / --no-textconv: a diff driver is configured IN .git/config, which is
    // inside the very sandbox being policed. Without these, an executor could register an
    // external command and have the read-only CHECK run it — turning the guard into the
    // thing it guards against.
    const tracked = git(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD'], dir)
    if (tracked.status !== 0) {
      throw new Error(`refuse: repository change detection failed (${(tracked.stderr || '').trim() || tracked.status})`)
    }
    // Deliberately WITHOUT --exclude-standard: ignored paths are still repository writes.
    const untracked = git(['ls-files', '--others', '-z'], dir)
    if (untracked.status !== 0) {
      throw new Error(`refuse: untracked change detection failed (${(untracked.stderr || '').trim() || untracked.status})`)
    }

    return [...new Set(split(tracked.stdout).concat(split(untracked.stdout)))].sort()
  }

  /** Files changed vs HEAD in the clone (relative, posix). */
  function filesChanged (dir) {
    const r = git(['diff', '--name-only', 'HEAD'], dir)
    if (r.status !== 0) return []
    return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean)
  }
  /** A human-readable diff stat. This is what the card shows. */
  function diffStat (dir) {
    const r = git(['diff', '--no-ext-diff', '--no-textconv', '--stat', 'HEAD'], dir)
    return r.status === 0 ? String(r.stdout || '').trim() : ''
  }
  /**
   * THE FULL PATCH — the whole point of v1.
   *
   * Without this the clone is thrown away and the Owner is told "3 files changed" with
   * nothing to apply, which would turn three copy-pastes into four. The patch is written
   * to a file the Owner can `git apply`; it is deliberately NOT shown in the card, which
   * carries the stat only.
   *
   * `--no-color` and `--no-ext-diff` so the bytes are a real patch and not a rendering,
   * and no external diff driver can be invoked from inside the clone.
   */
  function diffPatch (dir) {
    // --no-textconv added: measured, a configured textconv driver WAS executed by this exact
    // command. Collecting evidence must not be a way to run the sandbox's own code.
    const r = git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', 'HEAD'], dir)
    return r.status === 0 ? String(r.stdout || '') : ''
  }
  /** Current remotes (post-run verification — must stay empty). */
  function remotes (dir) {
    const r = git(['remote'], dir)
    return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  }
  /**
   * EVERYTHING that must still be true about this sandbox, measured in one place.
   *
   * ⛔ A CLEAN WORKTREE AND A CORRECT BRANCH PROVE ALMOST NOTHING. Reproduced in scratch
   * clones, every one of these leaves `git diff` empty, the branch correct and remotes at
   * zero:
   *
   *   git reset --hard <other>   HEAD moves; worktree matches the NEW head, so it is 'clean'
   *   git commit                 same, on the approved branch
   *   core.worktree=<elsewhere>  top-level redirects; the clone directory still exists
   *   .git replaced by a gitfile git-dir points at ANOTHER repository — and --show-toplevel
   *                              STILL reported this clone, so a top-level check alone passes
   *   update-index --assume-unchanged / --skip-worktree then edit the file
   *   stage a change, restore the worktree bytes: worktree clean, index carries other content
   *
   * So identity is compared against what prepare() recorded, not against the repository's
   * own current opinion of itself. Every git failure throws — 'cannot tell' is never 'fine'.
   *
   * @param {string} dir the clone
   * @param {string} expectedSha the approved revision, for the index-content comparison
   * @returns {object} measured facts plus baseline-identity booleans
   * @throws on any git failure, malformed output, or a directory prepare() never created
   */
  function sandboxState (dir, expectedSha) {
    const baseline = PREPARED.get(canonPath(dir))
    if (!baseline) throw new Error('refuse: no prepared sandbox baseline for this workspace')

    const ask = (args, what) => {
      const r = git(args, dir)
      if (!r || r.status !== 0) throw new Error(`refuse: ${what} unreadable (${((r && r.stderr) || '').trim() || (r && r.status)})`)
      return String(r.stdout || '')
    }

    // ── structural identity ────────────────────────────────────────────────
    // .git must still be a real directory of this clone's own. A gitfile or a symlink is
    // the documented, supported way to point Git at another repository entirely.
    let dotGitIsRealDir = false
    try {
      const st = fs.lstatSync(path.join(dir, '.git'))
      dotGitIsRealDir = st.isDirectory() && !st.isSymbolicLink()
    } catch (_) { dotGitIsRealDir = false }

    const topLevel = canonPath(ask(['rev-parse', '--show-toplevel'], 'top-level'))
    const gitDir = canonPath(ask(['rev-parse', '--absolute-git-dir'], 'git-dir'))
    const commonDir = canonPath(ask(['rev-parse', '--path-format=absolute', '--git-common-dir'], 'common-dir'))

    // ── revision and branch ────────────────────────────────────────────────
    const headSha = ask(['rev-parse', 'HEAD'], 'HEAD').trim()
    if (!FULL_SHA_RE.test(headSha)) throw new Error('refuse: HEAD is not a full commit sha')
    const currentBranch = ask(['rev-parse', '--abbrev-ref', 'HEAD'], 'branch').trim()
    if (currentBranch === '') throw new Error('refuse: branch state is empty')
    const remotes = ask(['remote'], 'remote state').split(/\r?\n/).map((x) => x.trim()).filter((x) => x !== '')

    // ── index safety ───────────────────────────────────────────────────────
    // `ls-files -v` marks assume-unchanged with a LOWERCASE tag and skip-worktree with 'S'.
    // Both were reproduced hiding a real file mutation from every worktree check.
    const flagged = []
    for (const rec of ask(['ls-files', '-v', '-z'], 'index flags').split(String.fromCharCode(0))) {
      if (rec === '') continue
      const tag = rec.charAt(0)
      const file = rec.slice(2)
      const assumeUnchanged = tag >= 'a' && tag <= 'z'
      const skipWorktree = tag === 'S' || tag === 's'
      if (assumeUnchanged || skipWorktree) flagged.push({ tag, file })
    }

    // Staged content that differs from the approved revision, even with a clean worktree.
    let indexDrift = []
    if (typeof expectedSha === 'string' && FULL_SHA_RE.test(expectedSha)) {
      indexDrift = ask(['diff', '--no-ext-diff', '--no-textconv', '--cached', '--name-only', '-z', expectedSha], 'index content')
        .split(String.fromCharCode(0)).filter((x) => x !== '')
    }

    return {
      headSha,
      currentBranch,
      remotes,
      indexFlagged: flagged,
      indexDrift,
      dotGitIsRealDir,
      topLevelOk: topLevel !== '' && topLevel === baseline.topLevel && topLevel === baseline.root,
      gitDirOk: gitDir !== '' && gitDir === baseline.gitDir,
      commonDirOk: commonDir !== '' && commonDir === baseline.commonDir,
      preparedBranch: baseline.branch,
      preparedBaseSha: baseline.baseSha
    }
  }

  /**
   * The clone's STRUCTURAL isolation: how many remotes it has, and which branch it is on.
   *
   * ⛔ WHY A CLEAN WORKTREE IS NOT ENOUGH. Both of these live in .git, not in the working
   * tree, so mutating them leaves repoChanges() perfectly empty. Measured in a scratch
   * clone: `git remote add attacker …` leaves the worktree clean with a push target now
   * present, and `git checkout main` leaves it clean because 'clean' is measured against
   * whatever HEAD has become. prepare() established both properties; only re-measuring can
   * say they survived.
   *
   * ⛔ AND IT FAILS CLOSED, WHICH remotes() DOES NOT. remotes() ignores exit status, so a
   * failed `git remote` yields '' and reads as 'no remotes' — the most reassuring possible
   * answer to a question that was never answered. currentBranch() has the same shape. Both
   * are left alone because they are shared with the AgentBridge worker; this is a separate,
   * stricter API for callers that need the answer to be trustworthy.
   *
   * @param {string} dir the clone
   * @returns {{remotes: string[], currentBranch: string}}
   * @throws if either git command fails or the branch is unusable
   */
  function isolationState (dir) {
    const r = git(['remote'], dir)
    if (r.status !== 0) {
      throw new Error(`refuse: remote state unreadable (${(r.stderr || '').trim() || r.status})`)
    }
    const b = git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)
    if (b.status !== 0) {
      throw new Error(`refuse: branch state unreadable (${(b.stderr || '').trim() || b.status})`)
    }
    const currentBranch = String(b.stdout || '').trim()
    if (currentBranch === '') throw new Error('refuse: branch state is empty')

    return {
      remotes: String(r.stdout || '').split(/\r?\n/).map((x) => x.trim()).filter((x) => x !== ''),
      currentBranch
    }
  }

  /** Current branch (post-run verification — must be the agent branch, never main). */
  function currentBranch (dir) {
    const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)
    return String(r.stdout || '').trim()
  }
  /** NO-OP: the B2-12 startup sweep reaps aged aroma-sandbox-* dirs. */
  function cleanup (dir) {
    // Forget the sandbox identity too. The directory is reaped at startup, but the baseline
    // is in-process state: leaving every run's entry behind grows without bound in a
    // long-lived server, and a stale entry is a baseline for a clone that no longer exists.
    try { PREPARED.delete(canonPath(dir)) } catch (_) {}
    /* logged residual, reaped at startup */
  }

  return { prepare, containmentCheck, addDirs, permissionMode, filesChanged, repoChanges, isolationState, sandboxState, diffStat, diffPatch, remotes, currentBranch, cleanup }
}

module.exports = { createFeatureBranchWorkspace, defaultGitRunner, AGENT_SANDBOX_PREFIX }
