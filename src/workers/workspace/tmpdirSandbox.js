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

  return {
    /** Mint a fresh throwaway sandbox and init it. @returns {{ dir: string }} */
    prepare () {
      const dir = fs.mkdtempSync(path.join(sandboxRoot, 'aroma-sandbox-'))
      prepareSandbox(dir)
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
}

module.exports = { createTmpdirSandbox, assertSandboxUnderTmpdir, canonicalise, defaultPrepareSandbox }
