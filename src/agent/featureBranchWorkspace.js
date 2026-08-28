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
  const git = typeof opts.gitRunner === 'function' ? opts.gitRunner : defaultGitRunner
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
    const r = git(['diff', '--stat', 'HEAD'], dir)
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
    const r = git(['diff', '--no-color', '--no-ext-diff', 'HEAD'], dir)
    return r.status === 0 ? String(r.stdout || '') : ''
  }
  /** Current remotes (post-run verification — must stay empty). */
  function remotes (dir) {
    const r = git(['remote'], dir)
    return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
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
  function cleanup (_dir) { /* logged residual, reaped at startup */ }

  return { prepare, containmentCheck, addDirs, permissionMode, filesChanged, repoChanges, isolationState, diffStat, diffPatch, remotes, currentBranch, cleanup }
}

module.exports = { createFeatureBranchWorkspace, defaultGitRunner, AGENT_SANDBOX_PREFIX }
