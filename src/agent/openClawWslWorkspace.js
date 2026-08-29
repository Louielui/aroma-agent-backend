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

/** The clone lives in this fixed child of the envelope. See envelopeContainmentCheck. */
const REPO_CHILD = 'repo'

/** Grant kinds, mirrored from the quarantine ledger. Each operation fixes its own. */
const GRANT_TERMINAL = 'terminal-observed'
const GRANT_PRE_EXECUTION = 'pre-execution'

/**
 * ⛔ THERE IS NO PERSISTENT LOCAL MIRROR, DELIBERATELY.
 *
 * The first design kept a bare mirror inside the distro and protected it by not telling
 * the executor where it was. That is not a permission boundary. The path is fixed, the
 * mirror and OpenClaw share one Unix identity, and an agent able to look at the filesystem
 * can simply find it — after which the source of every future clone is inside the blast
 * radius. Secrecy is not a control.
 *
 * So the local source authority is removed rather than defended. Each sandbox is cloned
 * directly from the fixed approved URL, which also makes freshness structural: a clone IS
 * current source, so nothing has to remember to refresh anything.
 *
 * Measured: the repository is public and `git ls-remote` succeeds from a completely
 * stripped environment (env -i, HOME=/nonexistent). No credential of any kind is required,
 * which is why none is provided.
 */
const SOURCE_URL = 'https://github.com/Louielui/aroma-agent-backend.git'

/**
 * The launcher, by absolute path so no PATH is needed in the child environment.
 */
const WSL_EXE = 'C:\\Windows\\System32\\wsl.exe'

/**
 * ⛔ THE CHILD ENVIRONMENT IS EMPTY, AND THAT IS THE POINT.
 *
 * spawnSync inherits process.env when `env` is omitted, so the first version handed the
 * Aroma backend's ENTIRE environment to wsl.exe — every provider key, database credential
 * and session secret the server happens to hold. The original report claimed no secrets
 * crossed the boundary on the strength of argv containing none, which was the wrong
 * evidence for the claim: a secret in the environment never appears in argv.
 *
 * WSLENV matters most of all. It is the documented mechanism for translating named
 * Windows variables into the Linux side, so inheriting it would let the very variables we
 * are excluding be carried across anyway.
 *
 * Measured: wsl.exe runs correctly with a completely empty environment, so nothing is
 * allowlisted. An empty allowlist needs no maintenance and cannot drift.
 */
const CHILD_ENV = Object.freeze({})

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
  const r = childProcess.spawnSync(WSL_EXE, argv, {
    // Explicit, and empty. Omitting `env` would inherit the backend's whole environment.
    env: CHILD_ENV,
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
/**
 * ⛔ THE TRUSTED IDENTITY IS NOT A PARAMETER.
 *
 * The first version accepted `distro`, `sandboxRoot` and `sourceUrl` as options while
 * claiming they were fixed configuration unreachable from callers — and the test that
 * 'proved' it only asserted the exported constants, which says nothing about what the
 * constructor accepts. Any composition site could have pointed the whole provider at
 * another distro or another repository.
 *
 * Only execution MECHANICS are injectable now: how a command is run, how long it may take,
 * how much it may print. What is run, where, and from which source are closed.
 *
 * @param {{ wslRunner?: function, timeoutMs?: number, maxOutput?: number }} options
 */
function createOpenClawWslWorkspace (options = {}) {
  const distro = DISTRO
  const sandboxRoot = SANDBOX_ROOT
  const sourceUrl = SOURCE_URL

  const run = typeof options.wslRunner === 'function' ? options.wslRunner : defaultWslRunner
  // Injected at construction by the governed adapter. Default refuses everything, so an
  // unwired workspace can never remove an envelope.
  // Injected at construction by the governed adapter: the GOVERNING ledger's own verifier.
  // Default refuses everything, so an unwired workspace can never remove an envelope.
  const verifyGrant = typeof options.verifyGrant === 'function' ? options.verifyGrant : () => false
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const maxOutput = Number.isFinite(options.maxOutput) ? options.maxOutput : DEFAULT_MAX_OUTPUT

  if (!SAFE_POSIX.test(sandboxRoot)) throw new TypeError('openClawWslWorkspace requires a safe POSIX sandboxRoot')

  /** The sandbox identity recorded by prepare(), keyed by the POSIX clone path. */
  const PREPARED = new Map()

  /**
   * The envelope identity pinned the instant the envelope exists, keyed by approvalId.
   * This is what makes a rollback after a FAILED prepare() safe: without it, rollback would
   * have only the path to go on.
   */
  const PREPARING = new Map()

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
  /**
   * Canonicalise a path inside the distro and require it strictly beneath the sandbox root.
   * Returns the REAL path, so callers compare canonical forms rather than the literal string
   * a symlink could disguise.
   */
  function realUnderRoot (dir) {
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

    return { root, real }
  }

  /**
   * ⛔ THE ENVELOPE IS EXACTLY ONE LEVEL DOWN, AND THE REPO IS EXACTLY ITS `repo` CHILD.
   *
   * OpenClaw writes its own bootstrap layer (AGENTS.md, SOUL.md, TOOLS.md, BOOTSTRAP.md, a
   * workspace-state file, and its own `git init`) at the root of whatever workspace it is
   * given. Handing it the clone directly would therefore plant untracked files inside the
   * repository being audited, and every run would fail as a read-only violation caused by
   * OpenClaw rather than by the model. So the workspace is the ENVELOPE and the clone is a
   * child of it.
   *
   * "Somewhere underneath the root" is not good enough for either. A depth check that only
   * says "beneath" would accept `<root>/a/b/c/repo`, letting a caller nominate an arbitrary
   * descendant as a sandbox. Both shapes are pinned exactly.
   */
  function envelopeContainmentCheck (envDir) {
    const { root, real } = realUnderRoot(envDir)
    const rest = real.slice(root.length + 1)
    if (rest === '' || rest.includes('/')) {
      throw new Error(`refuse: envelope must be exactly one level under ${root} (got '${rest}')`)
    }
    if (!SAFE_ID.test(rest)) throw new Error('refuse: envelope name is not a safe approvalId')
    return envDir
  }

  function containmentCheck (dir) {
    const { root, real } = realUnderRoot(dir)
    const rest = real.slice(root.length + 1)
    const parts = rest.split('/')
    if (parts.length !== 2 || parts[1] !== REPO_CHILD) {
      throw new Error(`refuse: repo must be exactly <envelope>/${REPO_CHILD} (got '${rest}')`)
    }
    if (!SAFE_ID.test(parts[0])) throw new Error('refuse: envelope name is not a safe approvalId')
    return dir
  }

  /**
   * A disposable clone of the approved source, on its own agent branch, with no remotes.
   *
   * The executor receives only the disposable clone, and
   * the clone's remotes are stripped so commit/push/PR/merge have nowhere to go — the same
   * shape featureBranchWorkspace established, enforced here in POSIX terms.
   */
  function prepare (approvalId) {
    if (typeof approvalId !== 'string' || !SAFE_ID.test(approvalId)) {
      throw new Error('prepare requires a safe approvalId ([A-Za-z0-9_-]{1,64})')
    }
    const branch = `agent/${approvalId}`
    // Both paths are DERIVED from the fixed root and the approvalId. Neither is a parameter,
    // so no caller can nominate where the envelope or the repo lives.
    const envelope = `${sandboxRoot}/${approvalId}`
    const dir = `${envelope}/${REPO_CHILD}`
    if (!SAFE_POSIX.test(envelope) || !SAFE_POSIX.test(dir)) throw new Error('refuse: unsafe sandbox path')

    const mk = wsl(['mkdir', '-p', sandboxRoot])
    if (mk.status !== 0) throw new Error('refuse: sandbox root not creatable')

    // A leftover ENVELOPE from a previous attempt is removed whole, and only after it has
    // been proven to be an envelope — never on the strength of its name.
    const exists = wsl(['test', '-e', envelope])
    if (exists.status === 0) {
      envelopeContainmentCheck(envelope)
      const rm = wsl(['rm', '-rf', '--', envelope])
      if (rm.status !== 0) throw new Error('refuse: stale envelope not removable')
    }

    const mkEnv = wsl(['mkdir', '-p', envelope])
    if (mkEnv.status !== 0) throw new Error('refuse: envelope not creatable')
    envelopeContainmentCheck(envelope)

    // ⛔ PIN THE ENVELOPE OBJECT BEFORE ANYTHING FALLIBLE RUNS.
    //
    // prepare() can throw during the clone, the checkout, or the remote strip — long after
    // the envelope exists but before the PREPARED baseline is written. Rollback would then
    // have had nothing but the PATH to go on, which is exactly the same-path replacement
    // hazard C2-B1 exists to close: between the failure and the rollback, this directory can
    // be swapped for another, and `rm -rf` would take the replacement.
    //
    // The identity is therefore recorded HERE — immediately after mkdir and containment,
    // and before the first operation that can fail.
    PREPARING.set(approvalId, Object.freeze({ envelope: canon(envelope), envelopeObject: objectIdentity(envelope) }))

    // ⛔ FRESHNESS IS STRUCTURAL, NOT A PREREQUISITE SOMEONE MUST REMEMBER.
    // The first version exposed refreshMirror() as a separate method, so current source
    // depended on a future composition layer calling it first — and AgentRunner only ever
    // calls prepare(). Cloning the approved URL here makes the clone current by
    // construction. A network or source failure refuses the sandbox; there is no retry,
    // because a source we could not reach is not a source we may guess at.
    const clone = wsl(['git'].concat(SAFE_GIT, ['clone', '--quiet', sourceUrl, dir]))
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

    // ⛔ WHICH OBJECT, NOT MERELY WHICH PATH.
    // A path is a name, and a same-user executor can rename this sandbox away and drop a
    // pristine clone at the original path: same HEAD, same agent branch, no remotes, clean
    // worktree, its own local .git. Every path-based check would pass while the verifier
    // inspected an object prepare() never created. device:inode is what distinguishes the
    // directory we built from a convincing replacement standing in its place.
    //
    // The ENVELOPE is pinned too, because it is what cleanup ultimately removes. Recovering
    // it by string-slicing the repo path at cleanup time would trust the caller's path
    // exactly where trusting it is most expensive.
    // The envelope must still be the object pinned at the top of prepare(). Re-measuring it
    // fresh here would adopt whatever is standing there now, which is the attack rather than
    // a check against it.
    const preparing = PREPARING.get(approvalId)
    if (!preparing) throw new Error('refuse: no preparing baseline for this envelope')
    const envelopeObject = objectIdentity(envelope)
    if (envelopeObject !== preparing.envelopeObject) {
      throw new Error(`refuse: the envelope changed during preparation (${preparing.envelopeObject} -> ${envelopeObject})`)
    }
    const dirObject = objectIdentity(dir)
    const gitObject = objectIdentity(dir + '/.git')

    PREPARED.set(dir, Object.freeze({
      approvalId, root: canon(dir), envelope: canon(envelope), topLevel, gitDir, commonDir,
      baseSha, branch, envelopeObject, dirObject, gitObject
    }))

    // The identity is now owned by PREPARED; the preparing record has done its job.
    PREPARING.delete(approvalId)

    return { dir, branch, baseSha }
  }

  /**
   * ⛔ ROLL BACK A FAILED prepare(), BY APPROVAL ID — NEVER BY A THROWN PATH.
   *
   * If prepare() fails partway (clone refused, branch checkout failed, a remote survived) it
   * may already have created the envelope, and it throws rather than returning — so there is
   * no `dir` for anyone to clean up with, and AgentRunner never calls cleanup because prepare
   * never returned. Review found the envelope simply orphaned there.
   *
   * The rollback target is DERIVED from the fixed sandbox root and the approvalId, exactly as
   * prepare derives it. It is never parsed out of an error message: a thrown string is
   * attacker-influenced input, and this function ends in `rm -rf`.
   *
   * Nothing has executed at this point, so a pre-execution grant is what authorises it — the
   * removal path is still gated, just by a different and mechanically distinguishable proof.
   */
  function abortPrepare (approvalId, opts = {}) {
    if (typeof approvalId !== 'string' || !SAFE_ID.test(approvalId)) {
      return { ok: false, reason: 'refuse: abortPrepare requires a safe approvalId' }
    }
    // ⛔ THE KIND IS FIXED BY THE OPERATION, NOT CHOSEN BY THE CALLER.
    // Rollback is only ever legitimate when nothing executed, so only a pre-execution grant
    // authorises it. A genuine terminal-observed grant is refused here.
    if (!verifyGrant(opts.grant, { approvalId, kind: GRANT_PRE_EXECUTION })) {
      return { ok: false, reason: `refuse: abortPrepare requires a '${GRANT_PRE_EXECUTION}' grant from the governing quarantine ledger for '${approvalId}'` }
    }

    const envelope = `${sandboxRoot}/${approvalId}`
    try {
      envelopeContainmentCheck(envelope)
    } catch (e) {
      return { ok: false, reason: (e && e.message) || 'containment refused' }
    }

    const preparing = PREPARING.get(approvalId)
    const exists = wsl(['test', '-e', envelope])

    // Nothing there: rollback is idempotent, and the baseline can be dropped safely.
    if (exists.status !== 0) {
      PREPARING.delete(approvalId)
      PREPARED.delete(`${envelope}/${REPO_CHILD}`)
      return { ok: true, removed: null, note: 'nothing to roll back' }
    }

    // ⛔ AN EXISTING PATH WITH NO BASELINE IS NOT OURS TO DELETE.
    // prepare() can fail BEFORE the identity was pinned — the stale-envelope removal itself
    // can fail, for instance. Path identity alone is not evidence that this directory is the
    // one we created, and this function ends in `rm -rf`.
    if (!preparing) {
      return { ok: false, reason: `refuse: '${envelope}' exists but this workspace never pinned its identity; refusing to delete a directory it cannot account for` }
    }

    let now
    try {
      now = objectIdentity(envelope)
    } catch (e) {
      return { ok: false, reason: (e && e.message) || 'envelope identity unreadable' }
    }
    if (now !== preparing.envelopeObject) {
      // Never adopt the replacement as the new baseline: keep refusing, and keep the object
      // so somebody can look at what is actually sitting there.
      return { ok: false, reason: `refuse: the envelope is not the object this prepare created (${preparing.envelopeObject} -> ${now}); the replacement is preserved` }
    }

    const rm = wsl(['rm', '-rf', '--', envelope])
    if (rm.status !== 0) return { ok: false, reason: (rm.stderr || '').trim().slice(0, 200) || 'remove failed' }

    PREPARING.delete(approvalId)
    PREPARED.delete(`${envelope}/${REPO_CHILD}`)
    return { ok: true, removed: envelope }
  }

  /**
   * device:inode for one path, measured inside the distro with a fixed argv.
   * Failure throws: an identity we cannot read is not an identity that matched.
   *
   * ⛔ WHAT THIS PRIMITIVE DOES *NOT* CATCH — MEASURED, NOT ASSUMED.
   * On the distro's real ext4 root:
   *
   *   move aside + create new   2096:118042 -> 2096:118060   DETECTED
   *   delete + recreate         inode MAY be reused    NOT RELIABLY DETECTED
   *
   * ext4 MAY hand a freed inode straight back — observed both reused and not, depending on
   * allocator state — so a same-path replacement that first DELETES the original is not
   * reliably visible to this check. What it DOES defeat is the substitution that keeps the
   * original alive for the attacker to use — the C2-B1 attack, where the genuine sandbox is
   * moved aside and a convincing clone is dropped at the path.
   *
   * Do not treat device:inode as a general same-path replacement detector during activation
   * design. The control that actually bounds the blast radius is CONTAINMENT: every path
   * this provider removes is derived from the fixed sandbox root, exactly one level down.
   * Asserted both ways in openClawEnvelope.live.test.js (PI3).
   */
  function objectIdentity (target) {
    const r = wsl(['stat', '-c', '%d:%i', '--', target])
    if (!r || r.timedOut) throw new Error('refuse: filesystem identity timed out')
    if (r.status !== 0) throw new Error(`refuse: filesystem identity unreadable for ${target}`)
    const id = String(r.stdout || '').trim()
    if (!/^\d+:\d+$/.test(id)) throw new Error(`refuse: malformed filesystem identity for ${target}`)
    return id
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

    // ⛔ FIRST, AND BEFORE ANY GIT EVIDENCE IS TRUSTED: is this still the same object?
    // Asking git about a replacement would produce a perfectly clean, perfectly false
    // report. The baseline is never refreshed from the current state — refreshing it would
    // simply adopt whatever is there now, which is the attack.
    // The envelope is checked first: swapping it relocates everything underneath, so a repo
    // that still looks right could be sitting inside a directory we never built.
    const envNow = objectIdentity(baseline.envelope)
    if (envNow !== baseline.envelopeObject) {
      throw new Error(`refuse: the envelope is not the prepared object (${baseline.envelopeObject} -> ${envNow})`)
    }
    const dirNow = objectIdentity(dir)
    if (dirNow !== baseline.dirObject) {
      throw new Error(`refuse: the sandbox directory is not the prepared object (${baseline.dirObject} -> ${dirNow})`)
    }
    const gitNow = objectIdentity(dir + '/.git')
    if (gitNow !== baseline.gitObject) {
      throw new Error(`refuse: the sandbox .git is not the prepared object (${baseline.gitObject} -> ${gitNow})`)
    }

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
   * not strictly beneath the sandbox root — the root itself, the dev repo, a
   * symlinked escape, or a path shaped to look contained. `rm -rf` earns its danger only
   * after the target has been proven, never on the strength of the string it was handed.
   */
  /**
   * Remove the WHOLE envelope — but only for a sandbox we prepared, and only once the caller
   * states the executor is terminal.
   *
   * ⛔ TERMINALITY IS PROVEN, NOT ASSERTED.
   * C2-B2-A proved `openclaw tasks cancel` reports success while the turn keeps running, and
   * that killing the client does not stop it either. So "the client returned" says nothing
   * about whether anything is still writing here.
   *
   * The first version took `{ terminal: true }`. Review was right that this is the wrong
   * shape: it lets whoever calls cleanup DECLARE the executor finished, which is exactly the
   * claim no caller is in a position to make. A boolean is not evidence.
   *
   * So cleanup now requires a GRANT — a branded object issued by the quarantine ledger only
   * after it has observed a terminal task status, verified through a checker injected at
   * CONSTRUCTION time (trusted composition, not per-call input). Absent a verifier this
   * fails closed, so an unwired workspace can never delete anything.
   *
   * ⛔ THE ENVELOPE COMES FROM THE PREPARED RECORD, NOT FROM THE ARGUMENT.
   * Deriving it by trimming '/repo' off the caller's string would reintroduce exactly the
   * path-trust this provider exists to remove.
   */
  function removeEnvelope (dir, opts, expectedKind, label) {
    const baseline = PREPARED.get(dir)
    if (!baseline) return { ok: false, reason: 'refuse: no prepared sandbox baseline for this workspace' }

    // ⛔ THE EXPECTED KIND IS SUPPLIED BY THE OPERATION, NEVER BY THE CALLER.
    if (!verifyGrant(opts.grant, { approvalId: baseline.approvalId, kind: expectedKind })) {
      return { ok: false, reason: `refuse: ${label} requires a '${expectedKind}' grant from the governing quarantine ledger for '${baseline.approvalId}'` }
    }

    const envelope = baseline.envelope
    try {
      containmentCheck(dir)
      envelopeContainmentCheck(envelope)
    } catch (e) {
      return { ok: false, reason: (e && e.message) || 'containment refused' }
    }

    // Best-effort identity re-check. A REPLACED envelope must never be deleted: whatever is
    // standing there now is not the directory we created, and removing it would destroy
    // something we cannot account for. An envelope that has already vanished is not an
    // error — cleanup is idempotent — so only a genuine mismatch refuses.
    try {
      const envNow = objectIdentity(envelope)
      if (envNow !== baseline.envelopeObject) {
        return { ok: false, reason: `refuse: the envelope is not the prepared object (${baseline.envelopeObject} -> ${envNow})` }
      }
    } catch (e) {
      const gone = wsl(['test', '-e', envelope])
      if (gone.status === 0) return { ok: false, reason: (e && e.message) || 'envelope identity unreadable' }
    }

    const rm = wsl(['rm', '-rf', '--', envelope])
    PREPARED.delete(dir)
    if (rm.status !== 0) return { ok: false, reason: (rm.stderr || '').trim().slice(0, 200) || 'remove failed' }
    return { ok: true, removed: envelope }
  }

  /**
   * Cleanup AFTER an executor ran. Only a terminal-observed grant authorises it, so a
   * pre-execution grant can never stand in for evidence that a real task finished.
   */
  function cleanupAfterExecution (dir, opts = {}) {
    return removeEnvelope(dir, opts, GRANT_TERMINAL, 'cleanup after execution')
  }

  /**
   * Discard a sandbox no executor ever touched. Only a pre-execution grant authorises it.
   */
  function discardPreparedSandbox (dir, opts = {}) {
    return removeEnvelope(dir, opts, GRANT_PRE_EXECUTION, 'discarding a prepared sandbox')
  }

  return {
    prepare,
    containmentCheck,
    envelopeContainmentCheck,
    abortPrepare,
    cleanupAfterExecution,
    discardPreparedSandbox,
    repoChanges,
    sandboxState,
    diffStat,
    diffPatch,
    // Observable so composition can be asserted rather than assumed.
    distro,
    sandboxRoot
  }
}

module.exports = { createOpenClawWslWorkspace, defaultWslRunner, DISTRO, SANDBOX_ROOT, REPO_CHILD, SOURCE_URL, WSL_EXE, CHILD_ENV }
