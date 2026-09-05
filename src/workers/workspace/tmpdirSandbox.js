'use strict'

/**
 * tmpdirSandbox.js — the TmpdirSandbox WorkspaceProvider (B2-7 extraction).
 *
 * This is a pure MOVE of the B2-1 sandbox logic into one provider, so callers
 * source their workspace behaviour from a single seam instead of open-coding it.
 * Behaviour is byte-for-byte identical to B2-1:
 *
 *   prepare()             → mkdtemp('aroma-sandbox-') under os.tmpdir() + git init
 *   containmentCheck(t)   → assertSandboxUnderTmpdir(t) (THE BRAKE, unchanged)
 *   permissionMode()      → 'bypassPermissions'
 *   addDirs(dir)          → [dir]
 *   cleanup(dir)          → NO-OP (B2-1 kept sandboxes; production cleanup is OUT
 *                           of scope — a logged residual, not a silent drop)
 *
 * The containment guard (canonicalise + assertSandboxUnderTmpdir) lives HERE now;
 * claudeWorker.js re-exports it so existing imports keep working. Crossing into a
 * real repo is a DIFFERENT provider gated by signed Policy — out of scope here.
 */

const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const childProcess = require('node:child_process')

/**
 * Canonicalise a path, resolving '..' AND symlinks. For a path that does not
 * exist yet (the sandbox is created just before invocation), the deepest
 * existing ancestor is realpath'd and the remaining segments re-appended — so a
 * symlinked ancestor pointing outside tmpdir cannot smuggle the target back in.
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

/* ══════════════ THE MINT REGISTER ══════════════ */

/**
 * ⛔ WHO ACTUALLY MADE THIS DIRECTORY — the one question a location check cannot answer.
 *
 * `assertSandboxUnderTmpdir` proves WHERE a path is. It cannot prove WHERE IT CAME FROM, so a
 * directory anyone created with the right name in the right place passed every check we had.
 * The prefix was doing the work of provenance, and a prefix is a naming convention.
 *
 * This register is the record a location check does not keep: a module-private WeakMap from the
 * provider OBJECT to the canonical roots that provider's own `prepare()` actually completed,
 * each with the directory identity (dev+ino) it had at that moment.
 *
 * ⛔ IT IS PRIVATE, AND THAT IS THE POINT. Nothing outside this module can add to it, so a
 * hand-made directory, a foreign provider, or an object with a `mintedByThisProvider()` that
 * returns true are all equally unregistered. Verification asks THIS MODULE, never the provider.
 *
 * ⚠ WHAT THIS IS NOT: it is in-process provenance for a trusted creation path. It is NOT OS
 * isolation, and it proves nothing against a hostile process running as the same user — such a
 * process can create, move or replace directories whatever this map says. Keeping that boundary
 * explicit is why it is written here rather than implied by the name.
 */
const MINTED = new WeakMap()

/** win32 paths compare case-insensitively; everywhere else they do not. */
const foldCase = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)

/** Same path, or inside it — by path SEGMENTS, never by string prefix. */
function withinRoot (root, target) {
  const rel = path.relative(foldCase(root), foldCase(target))
  if (rel === '') return true
  return !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)
}

/**
 * Prove that `target` belongs to a workspace THIS module minted for THIS provider.
 *
 * Returns the canonical record; throws otherwise. Every refusal names which fact failed, because
 * "not minted" and "minted but replaced since" are different problems with different fixes.
 *
 * @param {object} provider the object returned by createTmpdirSandbox()
 * @param {string} target   the directory a caller wants to use (the root, or inside it)
 */
function assertMintedWorkspace (provider, target) {
  const registry = (provider !== null && typeof provider === 'object') ? MINTED.get(provider) : undefined
  if (!registry) {
    throw new Error('workspace provenance: this provider was not created by tmpdirSandbox, so nothing it offers is a minted workspace')
  }
  if (typeof target !== 'string' || target.trim() === '') {
    throw new Error('workspace provenance: target must be a non-empty path')
  }
  // canonicalise resolves symlinks and junctions, so an alias pointing at ANOTHER sandbox is
  // compared as the directory it really is rather than as the name it was given.
  const canonicalTarget = canonicalise(target)
  for (const [root, minted] of registry) {
    if (!withinRoot(root, canonicalTarget)) continue
    let rootStat
    try { rootStat = fs.statSync(root) } catch (_) {
      throw new Error('workspace provenance: the minted workspace no longer exists — ' + root)
    }
    // ⛔ THE OBJECT, NOT THE NAME. A root deleted and recreated at the same path is a different
    // directory wearing the same label, and it was not the one this provider minted.
    if (String(rootStat.dev) !== minted.dev || String(rootStat.ino) !== minted.ino) {
      throw new Error(`workspace provenance: '${root}' is no longer the directory that was minted (identity changed)`)
    }
    let targetStat
    try { targetStat = fs.statSync(canonicalTarget) } catch (_) {
      throw new Error('workspace provenance: the target does not exist — ' + canonicalTarget)
    }
    if (!targetStat.isDirectory()) {
      throw new Error('workspace provenance: the target is not a directory — ' + canonicalTarget)
    }
    return { root, path: canonicalTarget, dev: String(targetStat.dev), ino: String(targetStat.ino) }
  }
  throw new Error('workspace provenance: ' + canonicalTarget + ' was not minted by this provider')
}

/** Default: make the sandbox a git repo so a real worker can commit inside it. */
function defaultPrepareSandbox (dir) {
  childProcess.spawnSync('git', ['init', '-q'], { cwd: dir })
}

/**
 * Create a TmpdirSandbox workspace provider.
 * @param {{ sandboxRoot?: string, prepareSandbox?: function }} [options]
 *   sandboxRoot    — root under which sandboxes are minted (default os.tmpdir()).
 *   prepareSandbox — per-sandbox init (default git init); injectable for tests.
 */
function createTmpdirSandbox (options = {}) {
  const opts = options || {}
  const sandboxRoot = typeof opts.sandboxRoot === 'string' && opts.sandboxRoot ? opts.sandboxRoot : os.tmpdir()
  const prepareSandbox = typeof opts.prepareSandbox === 'function' ? opts.prepareSandbox : defaultPrepareSandbox

  const provider = {
    /**
     * Mint a fresh throwaway sandbox and init it. @returns {{ dir: string }}
     *
     * ⛔ REGISTERED LAST, AND ONLY ON FULL SUCCESS. If `prepareSandbox` throws, the directory
     * may exist but the workspace was never finished — and a half-built sandbox that counts as
     * minted is exactly the thing a provenance check exists to catch. The register is written
     * after the init returned and after the brake has canonicalised the path.
     */
    prepare () {
      const dir = fs.mkdtempSync(path.join(sandboxRoot, 'aroma-sandbox-'))
      prepareSandbox(dir)
      // ⛔ REGISTRATION MUST NOT CHANGE WHAT prepare() DOES. A caller may mint under its own
      // `sandboxRoot`, and before this register existed that worked; making the brake throw here
      // would break those callers for a reason unrelated to what they asked for. So a workspace
      // the brake rejects is simply NOT REGISTERED — and an unregistered workspace is refused
      // later, loudly, by whoever demands provenance. Nothing is silently accepted.
      try {
        const safe = assertSandboxUnderTmpdir(dir)
        const st = fs.statSync(safe)
        MINTED.get(provider).set(safe, { dev: String(st.dev), ino: String(st.ino) })
      } catch (_) { /* unregistered on purpose; see above */ }
      // The RAW path is still what callers receive, unchanged from B2-1.
      return { dir }
    },
    /** THE BRAKE — canonical, sandbox-safe path or throw. */
    containmentCheck (target) {
      return assertSandboxUnderTmpdir(target)
    },
    /** The permission mode for this workspace. */
    permissionMode () {
      return 'bypassPermissions'
    },
    /** The --add-dir set for this workspace. */
    addDirs (dir) {
      return [dir]
    },
    /** NO-OP by design — B2-1 preserved sandboxes; production cleanup is OUT. */
    cleanup (_dir) {
      // intentionally empty (logged residual: tmpdir sandboxes are not reaped yet)
    }
  }
  // The register is keyed by THIS provider object, so two providers never see each other's
  // workspaces and a provider from anywhere else has no entry at all.
  MINTED.set(provider, new Map())
  return provider
}

// ── B2-12 startup-only conservative sandbox cleanup ──────────────────────────
// The exact prefix prepare() mints (mkdtemp(path.join(root, SANDBOX_PREFIX))).
const SANDBOX_PREFIX = 'aroma-sandbox-'
const DEFAULT_TTL_HOURS = 24

/**
 * Resolve SANDBOX_TTL_HOURS, fail-safe (mirrors resolveWorkerInvocation's style):
 * unset/empty → 24; non-numeric / <= 0 / non-finite → 24 with a warning. A longer
 * default is the SAFE direction (keep more, delete less).
 * @returns {number} hours
 */
function resolveSandboxTtl () {
  const raw = process.env.SANDBOX_TTL_HOURS
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TTL_HOURS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[AROMA-HUB] Invalid SANDBOX_TTL_HOURS="${raw}" — falling back to ${DEFAULT_TTL_HOURS}h.`)
    return DEFAULT_TTL_HOURS
  }
  return n
}

/**
 * Sweep aged ephemeral sandbox dirs ONCE (startup-only; NO lifecycle management).
 * BEST-EFFORT: every candidate is guarded independently; a failure logs + continues
 * and the whole call NEVER throws — so it can never block server boot.
 *
 * Containment (STRICTER than creation) — a candidate is deleted ONLY if ALL hold:
 *   1. basename starts with the exact `aroma-sandbox-` prefix;
 *   2. it is NOT a symlink (lstat) — symlinks are skipped, never followed/deleted;
 *   3. it is a directory;
 *   4. its canonical (realpath, symlink-resolved) path is a DIRECT child of tmpDir
 *      (reject anything whose canonical location is not directly under tmpDir);
 *   5. its age (now - mtime) exceeds the TTL.
 * Any check failing → SKIP + log; NEVER attempt a delete. It only ever touches
 * `<tmpDir>/aroma-sandbox-*` dirs — never .aroma/, data/, or any real repo.
 *
 * @param {{ tmpDir?: string, ttlHours?: number, now?: number, rm?: function }} [options]
 *   All injectable so tests use a scratch dir + controlled ages (no real os.tmpdir
 *   mutation). `rm(path)` defaults to fs.rmSync(recursive, force).
 * @returns {{ scanned: number, deleted: number, skipped: number, errors: number }}
 */
function sweepAgedSandboxes (options = {}) {
  const opts = options || {}
  const tmpDir = typeof opts.tmpDir === 'string' && opts.tmpDir ? opts.tmpDir : os.tmpdir()
  const ttlHours = Number.isFinite(opts.ttlHours) && opts.ttlHours > 0 ? opts.ttlHours : resolveSandboxTtl()
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const rm = typeof opts.rm === 'function' ? opts.rm : (p) => fs.rmSync(p, { recursive: true, force: true })
  const ttlMs = ttlHours * 60 * 60 * 1000
  const summary = { scanned: 0, deleted: 0, skipped: 0, errors: 0 }

  let tmpReal
  try { tmpReal = fs.realpathSync(tmpDir) } catch (_) { return summary } // no tmpDir → nothing to do
  let entries
  try { entries = fs.readdirSync(tmpReal) } catch (_) { return summary }

  for (const name of entries) {
    summary.scanned += 1
    try {
      // (1) name
      if (!name.startsWith(SANDBOX_PREFIX)) { summary.skipped += 1; continue }
      const entryPath = path.join(tmpReal, name)
      // (2) lstat — never follow symlinks
      const lst = fs.lstatSync(entryPath)
      if (lst.isSymbolicLink()) { summary.skipped += 1; console.warn(`[sandbox-sweep] skip symlink: ${name}`); continue }
      // (3) directory only
      if (!lst.isDirectory()) { summary.skipped += 1; continue }
      // (4) canonical path must be a DIRECT child of tmpDir (no escape)
      const real = fs.realpathSync(entryPath)
      if (path.dirname(real) !== tmpReal) { summary.skipped += 1; console.warn(`[sandbox-sweep] skip out-of-prefix: ${name}`); continue }
      // (5) TTL — keep anything younger than the TTL (fail-safe)
      if ((now - lst.mtimeMs) <= ttlMs) { summary.skipped += 1; continue }
      // all checks passed — delete (best-effort)
      rm(real)
      summary.deleted += 1
    } catch (err) {
      summary.errors += 1
      console.warn(`[sandbox-sweep] error on ${name}: ${err && err.message ? err.message : String(err)}`)
      // continue to the next entry — never abort the sweep
    }
  }
  return summary
}

module.exports = {
  createTmpdirSandbox,
  assertMintedWorkspace,
  assertSandboxUnderTmpdir,
  canonicalise,
  defaultPrepareSandbox,
  resolveSandboxTtl,
  sweepAgedSandboxes,
  SANDBOX_PREFIX,
  DEFAULT_TTL_HOURS
}
