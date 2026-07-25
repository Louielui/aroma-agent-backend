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

  /** Clone → branch → strip remotes; return { dir, branch }. Fail-closed throughout. */
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

    return { dir: safe, branch }
  }

  /** THE BRAKE — canonical, strictly-under-tmpdir path or throw. */
  function containmentCheck (target) { return assertSandboxUnderTmpdir(target) }
  /** The --add-dir set: the isolated clone only. */
  function addDirs (dir) { return [dir] }
  /** Permission mode — NEVER bypassPermissions (Cap 1). */
  function permissionMode () { return 'acceptEdits' }
  /** Files changed vs HEAD in the clone (relative, posix). */
  function filesChanged (dir) {
    const r = git(['diff', '--name-only', 'HEAD'], dir)
    if (r.status !== 0) return []
    return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean)
  }
  /** A human-readable diff stat (never a raw patch; no secrets projected upstream). */
  function diffStat (dir) {
    const r = git(['diff', '--stat', 'HEAD'], dir)
    return r.status === 0 ? String(r.stdout || '').trim() : ''
  }
  /** Current remotes (post-run verification — must stay empty). */
  function remotes (dir) {
    const r = git(['remote'], dir)
    return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  }
  /** Current branch (post-run verification — must be the agent branch, never main). */
  function currentBranch (dir) {
    const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)
    return String(r.stdout || '').trim()
  }
  /** NO-OP: the B2-12 startup sweep reaps aged aroma-sandbox-* dirs. */
  function cleanup (_dir) { /* logged residual, reaped at startup */ }

  return { prepare, containmentCheck, addDirs, permissionMode, filesChanged, diffStat, remotes, currentBranch, cleanup }
}

module.exports = { createFeatureBranchWorkspace, defaultGitRunner, AGENT_SANDBOX_PREFIX }
