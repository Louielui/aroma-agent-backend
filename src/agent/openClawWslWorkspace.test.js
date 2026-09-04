'use strict'

/**
 * openClawWslWorkspace.test.js — THE VERIFIER MUST WATCH THE DIRECTORY THE EXECUTOR USES.
 *
 * ── THE MISTAKE THIS PROVIDER EXISTS TO PREVENT ─────────────────────────────
 * OpenClaw runs inside the OpenClawGateway WSL distro, which is sealed off from Windows:
 * measured, automount and interop are both disabled, /mnt/c has zero entries. The obvious
 * shortcut — copy the Windows clone into WSL, run there, keep verifying the Windows clone —
 * would make every C1 guarantee pass VACUOUSLY. repoChanges, sandboxState and containment
 * would all be reading a directory nobody wrote to, and a read-only verifier aimed at an
 * untouched directory always reports clean. It would be indistinguishable from working.
 *
 * So these tests pin the one property that prevents it: the path handed to the executor is
 * the same path later verified and later cleaned up.
 *
 * Unit tests drive an injected WSL runner. The real-distro proof lives in
 * openClawWslWorkspace.live.test.js and only runs where OpenClawGateway exists.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-c2b1-test-'))

const test = require('node:test')
const assert = require('node:assert')

const { createOpenClawWslWorkspace, DISTRO, SANDBOX_ROOT, SOURCE_URL, WSL_EXE, CHILD_ENV } = require('../agent/openClawWslWorkspace')
const { windowsArgvFor } = require('../agent/exactWslExecRunner')

const SHA = '4511f7deeb279b189642b3b812b56250ce518d98'
const OTHER_SHA = 'e034ccc5cc89409375f538ce2a6b7a30f2d14700'
const ROOT = SANDBOX_ROOT
const APPROVAL = 'appr_x'
const ENV_DIR = ROOT + '/' + APPROVAL
const DIR = ENV_DIR + '/repo'

/** Strip the fixed `-d <distro> --` prefix so a fake can read the command it was given. */

/**
 * Terminality is proven, not asserted: cleanup requires a grant the quarantine ledger
 * issues only after observing a terminal task status. Tests mint real grants the same way
 * production does, so no test can quietly bypass the gate a caller cannot bypass.
 */
const { createOpenClawQuarantine } = require('../agent/openClawQuarantine')
function memLedgerStore () {
  let data = {}
  return { read: () => JSON.parse(JSON.stringify(data)), write: (d) => { data = JSON.parse(JSON.stringify(d)) } }
}
/** One ledger governs the workspaces in this file; grants are bound to it. */
const LEDGER = createOpenClawQuarantine({ store: memLedgerStore() })
const verifyGrant = (g, expect) => LEDGER.verifyGrant(g, expect)
function grantFor (approvalId) {
  if (LEDGER.state(approvalId) === null) LEDGER.begin(approvalId)
  if (LEDGER.state(approvalId) === LEDGER.STATES.PREPARED) LEDGER.abortPreExecution(approvalId)
  return LEDGER.preExecutionGrant(approvalId)
}


/**
 * The injected runner now receives the LINUX argv only (X4-B1): the distro flags and
 * `--exec` are built inside exactWslExecRunner and never reach a mechanic. So there is no
 * prefix to strip — and a `--` inside git/rm/stat argv is an ordinary argument, not a seam.
 */
const inner = (argv) => argv
/** Strip git's leading `-c key=value` globals, exactly as git does. */
function gitArgs (a) { let i = 0; while (a[i] === '-c') i += 2; return a.slice(i) }

/**
 * A scripted distro. Every answer is explicit, so a test can compose exactly the state it
 * wants without a real WSL present.
 */
function fakeWsl (over = {}) {
  const calls = []
  const ok = (stdout) => ({ status: 0, stdout: stdout === undefined ? '' : stdout, stderr: '', timedOut: false })
  const launches = [];
  const runner = (argv) => {
    launches.push(argv)
    const a = inner(argv)
    calls.push(a.join(' '))
    if (over.fail && over.fail(a)) return { status: 128, stdout: '', stderr: 'fatal: scripted failure', timedOut: false }
    if (over.timeout && over.timeout(a)) return { status: null, stdout: '', stderr: 'timeout', timedOut: true }

    if (a[0] === 'mkdir' || a[0] === 'rm' || a[0] === 'ln') return ok()
    if (a[0] === 'stat') {
      // device:inode. `objects` lets a test change the answer after prepare, which is the
      // replacement attack in miniature.
      const target = a[a.length - 1]
      const table = over.objects || {}
      const v = table[target] !== undefined ? table[target] : '2049:1000'
      return v === null ? { status: 1, stdout: '', stderr: 'stat: cannot statx', timedOut: false } : ok(v + '\n')
    }
    if (a[0] === 'test') {
      const target = a[a.length - 1]
      if (a[1] === '-L') return { status: over.dotGitIsSymlink ? 0 : 1, stdout: '', stderr: '', timedOut: false }
      if (a[1] === '-d' && target.endsWith('/.git')) return { status: over.dotGitMissing ? 1 : 0, stdout: '', stderr: '', timedOut: false }
      if (a[1] === '-e') return { status: over.staleSandbox ? 0 : 1, stdout: '', stderr: '', timedOut: false }
      return { status: 1, stdout: '', stderr: '', timedOut: false }
    }
    if (a[0] === 'readlink') {
      const target = a[a.length - 1]
      if (over.realpath && over.realpath[target] !== undefined) {
        const v = over.realpath[target]
        return v === null ? { status: 1, stdout: '', stderr: '', timedOut: false } : ok(v + '\n')
      }
      return ok(target + '\n')
    }
    if (a[0] === 'git') {
      const g = gitArgs(a.slice(1))
      // `-C <dir>` may precede the subcommand
      const sub = g[0] === '-C' ? g.slice(2) : g
      const j = sub.join(' ')
      if (sub[0] === 'clone') return ok()
      if (sub[0] === 'checkout') return ok()
      if (j === 'remote') return ok(over.remotes === undefined ? '' : over.remotes.join('\n'))
      if (sub[0] === 'remote' && sub[1] === 'remove') return ok()
      if (j === 'rev-parse HEAD') return ok((over.headSha || SHA) + '\n')
      if (j === 'rev-parse --abbrev-ref HEAD') return ok((over.branch || 'agent/appr_x') + '\n')
      if (j === 'rev-parse --show-toplevel') return ok((over.topLevel || DIR) + '\n')
      if (j === 'rev-parse --absolute-git-dir') return ok((over.gitDir || DIR + '/.git') + '\n')
      if (j.includes('--git-common-dir')) return ok((over.commonDir || DIR + '/.git') + '\n')
      if (j.includes('ls-files -v -z')) return ok(over.lsFilesV === undefined ? '' : over.lsFilesV)
      if (j.includes('--cached')) return ok(over.cached === undefined ? '' : over.cached)
      if (j.includes('--name-only') && j.includes('-z')) return ok(over.tracked === undefined ? '' : over.tracked)
      if (j.includes('ls-files --others')) return ok(over.untracked === undefined ? '' : over.untracked)
      if (j.includes('--stat')) return ok(over.stat === undefined ? '' : over.stat)
      if (sub[0] === 'diff') return ok(over.patch === undefined ? '' : over.patch)
      return ok()
    }
    return ok()
  }
  runner.calls = calls
  runner.launches = launches
  return runner
}

const mk = (over = {}, cfg = {}) => createOpenClawWslWorkspace(Object.assign({ wslRunner: fakeWsl(over), verifyGrant }, cfg))

/* ══════════════ W1/W2/W3 — containment lives in POSIX, inside the distro ══════════════ */

test('W1. a sandbox strictly beneath the fixed root is accepted', () => {
  assert.strictEqual(mk().containmentCheck(DIR), DIR)
})

test('W2. ⛔ every escape is refused, including a symlink that points out', () => {
  // The literal string can look contained while the real path is not, so containment is
  // decided on the canonical path the DISTRO reports, not on the text we were handed.
  const escapes = [
    [ROOT, 'the sandbox root itself'],
    ['/', 'the filesystem root'],
    ['/home/openclaw', 'the home directory'],
    ['/home/openclaw/dev/aroma-agent-backend', 'the dev repo']
  ]
  for (const [p, why] of escapes) {
    assert.throws(() => mk().containmentCheck(p), /refuse:/, `${why} must be refused`)
  }
  // a path inside the root whose realpath is elsewhere
  const ws = mk({ realpath: { [ROOT + '/escape']: '/etc' } })
  assert.throws(() => ws.containmentCheck(ROOT + '/escape'), /outside/, 'a symlink escape must be refused')
})

test('W2c. the sandbox ROOT is refused with its own distinct reason', () => {
  // Subsumed by the outside-root rule, and kept anyway: "you handed me the root" and "you
  // handed me something outside the root" are different mistakes, and the operator reading
  // the refusal should be told which one happened. Pinning the wording keeps that true.
  assert.throws(() => mk().containmentCheck(ROOT), /the sandbox root itself is not a sandbox/)
})

test('W2b. malformed, relative and traversing paths never reach argv', () => {
  for (const bad of ['', '   ', 'relative/path', '../etc', '/tmp/../etc', null, undefined, 42, '/tmp/a\nb', '/tmp/a b']) {
    assert.throws(() => mk().containmentCheck(bad), /refuse:/, `${JSON.stringify(bad)} must be refused`)
  }
})

test('W3. ⛔ there is NO persistent local source authority to compromise', () => {
  // The first design kept a bare mirror inside the distro and protected it by not telling
  // the executor where it was. That is not a permission boundary: the path was fixed, the
  // mirror and OpenClaw share one Unix identity, and an agent that can look at the
  // filesystem can simply find it. The authority is removed rather than defended.
  const src = fs.readFileSync(path.join(__dirname, 'openClawWslWorkspace.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/mirrorPath/.test(src), 'no mirror path may remain in the implementation')
  assert.ok(!/refreshMirror/.test(src), 'no separate refresh step may remain')
  assert.ok(!src.includes('.aroma/mirrors'), 'no persistent local source directory')
})

test('W3b. the approved source URL is fixed configuration, not caller input', () => {
  assert.strictEqual(SOURCE_URL, 'https://github.com/Louielui/aroma-agent-backend.git')
  assert.ok(SOURCE_URL.startsWith('https://'), 'a fixed https origin, never a local path')
  // and prepare clones from exactly it
  const runner = fakeWsl({})
  const ws = createOpenClawWslWorkspace({ wslRunner: runner, verifyGrant })
  ws.prepare('appr_x')
  const clone = runner.calls.find((c) => c.includes('clone'))
  assert.ok(clone.includes(SOURCE_URL), `prepare must clone the approved URL: ${clone}`)
})

test('W4/W5. prepare returns a POSIX sandbox on the exact agent branch with zero remotes', () => {
  const runner = fakeWsl({})
  const ws = createOpenClawWslWorkspace({ wslRunner: runner, verifyGrant })
  const p = ws.prepare('appr_x')

  assert.strictEqual(p.dir, DIR, 'the executor receives a POSIX path inside the distro')
  assert.ok(p.dir.startsWith(ROOT + '/'), 'strictly beneath the fixed sandbox root')
  assert.strictEqual(p.branch, 'agent/appr_x')
  assert.strictEqual(p.baseSha, SHA)

  // Measured INSIDE the clone: the rev-parse is addressed to the sandbox, never to Windows.
  const headCall = runner.calls.find((c) => c.includes('rev-parse HEAD'))
  assert.ok(headCall.includes('-C ' + DIR), `baseSha must be read from the clone: ${headCall}`)
  // Cloned FROM the mirror, and the remotes are stripped afterwards.
  assert.ok(runner.calls.some((c) => c.includes('clone') && c.includes(SOURCE_URL)),
    'the sandbox is cloned from the approved URL, not from any local source authority')
  assert.ok(runner.calls.some((c) => c.includes('remote remove') || c.includes('remote')))
})

test('W4b. an unsafe approvalId never becomes a path or an argument', () => {
  for (const bad of ['../escape', 'a/b', 'a b', '', 'x'.repeat(65), null, undefined, 'a;rm -rf /']) {
    assert.throws(() => mk().prepare(bad), /safe approvalId/)
  }
})

test('W5b. a clone whose HEAD is malformed fails closed', () => {
  assert.throws(() => mk({ headSha: 'not-a-sha' }).prepare('appr_x'), /full commit sha/)
})

test('W5c. a surviving remote refuses the sandbox', () => {
  assert.throws(() => mk({ remotes: ['origin'] }).prepare('appr_x'), /remote is still present/)
})

test('W5d. landing on the wrong branch refuses', () => {
  assert.throws(() => mk({ branch: 'main' }).prepare('appr_x'), /not on agent branch|on main/)
})

/* ══════════════ W6–W10 — every C1 detection class, carried over ══════════════ */

const NUL = String.fromCharCode(0)

function preparedWith (over) {
  const ws = mk(over)
  ws.prepare('appr_x')
  return ws
}

test('W6. ⛔ IGNORED untracked files are detected — no --exclude-standard', () => {
  const ws = preparedWith({ untracked: '.env' + NUL + 'app.log' + NUL })
  assert.deepStrictEqual(ws.repoChanges(DIR), ['.env', 'app.log'])
  // and the flag that would hide them is never passed
  const runner = fakeWsl({})
  const w2 = createOpenClawWslWorkspace({ wslRunner: runner, verifyGrant })
  w2.prepare('appr_x'); w2.repoChanges(DIR)
  const ls = runner.calls.find((c) => c.includes('ls-files --others'))
  assert.ok(!ls.includes('--exclude-standard'), `ignored files must stay visible: ${ls}`)
})

test('W6b. tracked and untracked are merged, de-duplicated and sorted, pathnames exact', () => {
  const ws = preparedWith({ tracked: 'b.txt' + NUL + 'a.txt' + NUL, untracked: ' leading.txt' + NUL + 'a.txt' + NUL })
  assert.deepStrictEqual(ws.repoChanges(DIR), [' leading.txt', 'a.txt', 'b.txt'],
    'a leading space is part of the name, not whitespace to trim')
})

test('W7. HEAD movement is visible while branch, remotes and worktree stay perfect', () => {
  const ws = preparedWith({ headSha: SHA })
  const moved = mk({ headSha: OTHER_SHA })
  moved.prepare('appr_x')
  const st = moved.sandboxState(DIR, SHA)
  assert.strictEqual(st.headSha, OTHER_SHA)
  assert.strictEqual(st.currentBranch, 'agent/appr_x', 'branch still correct')
  assert.deepStrictEqual(st.remotes, [], 'remotes still zero')
  assert.deepStrictEqual(ws.repoChanges(DIR), [], 'worktree still clean')
})

test('W8. a remote reappearing AFTER prepare is visible', () => {
  // prepare() refuses a surviving remote outright, so the case that matters is one that
  // appears later — restoring the push target prepare() deliberately stripped.
  const state = { remotes: [] }
  const base = fakeWsl({})
  const ws = createOpenClawWslWorkspace({
    sandboxRoot: ROOT,
    sourceUrl: SOURCE_URL,
    wslRunner: (argv, o) => {
      const a = inner(argv)
      if (a[0] === 'git' && gitArgs(a.slice(1)).slice(-1)[0] === 'remote') {
        return { status: 0, stdout: state.remotes.join('\n'), stderr: '', timedOut: false }
      }
      return base(argv, o)
    }
  })
  ws.prepare('appr_x')
  assert.deepStrictEqual(ws.sandboxState(DIR, SHA).remotes, [], 'clean immediately after prepare')

  state.remotes = ['attacker']
  const st = ws.sandboxState(DIR, SHA)
  assert.deepStrictEqual(st.remotes, ['attacker'])
  assert.deepStrictEqual(ws.repoChanges(DIR), [], 'the worktree stays spotless — that is the trap')
})

test('W9. assume-unchanged and skip-worktree are both detected', () => {
  const h = preparedWith({ lsFilesV: 'h tracked.txt' + NUL, tracked: '', untracked: '' })
  assert.deepStrictEqual(h.sandboxState(DIR, SHA).indexFlagged, [{ tag: 'h', file: 'tracked.txt' }])
  assert.deepStrictEqual(h.repoChanges(DIR), [], 'the worktree check sees nothing — that is the point')

  const s = preparedWith({ lsFilesV: 'S tracked.txt' + NUL })
  assert.deepStrictEqual(s.sandboxState(DIR, SHA).indexFlagged, [{ tag: 'S', file: 'tracked.txt' }])

  const clean = preparedWith({ lsFilesV: 'H tracked.txt' + NUL })
  assert.deepStrictEqual(clean.sandboxState(DIR, SHA).indexFlagged, [], 'H is an ordinary cached entry')
})

test('W10. index-only drift against the approved revision is detected', () => {
  const ws = preparedWith({ cached: 'tracked.txt' + NUL, tracked: '', untracked: '' })
  assert.deepStrictEqual(ws.sandboxState(DIR, SHA).indexDrift, ['tracked.txt'])
  assert.deepStrictEqual(ws.repoChanges(DIR), [], 'the worktree was restored, so it reads clean')
})

test('W10b. structural identity is compared against the PREPARED baseline', () => {
  const redirected = mk({ topLevel: '/tmp/elsewhere' })
  redirected.prepare('appr_x')
  // prepare recorded /tmp/elsewhere as the baseline, so a LATER change is what fails;
  // build one where the answer changes after prepare.
  let n = 0
  const shifting = createOpenClawWslWorkspace({
    wslRunner: (() => { const good = fakeWsl({}); const bad = fakeWsl({ topLevel: '/tmp/elsewhere', gitDir: '/tmp/other/.git' })
      return (argv, o) => { const a = inner(argv); if (a[0] === 'git' && a.join(' ').includes('--show-toplevel')) { n++; return n > 1 ? bad(argv, o) : good(argv, o) } return (n > 0 ? bad : good)(argv, o) } })()
  })
  shifting.prepare('appr_x')
  const st = shifting.sandboxState(DIR, SHA)
  assert.strictEqual(st.topLevelOk, false, 'a top-level that moved after prepare must not pass')
})

test('W10c. sandboxState refuses a directory prepare() never created', () => {
  assert.throws(() => mk().sandboxState(DIR, SHA), /no prepared sandbox baseline/)
})

/* ══════════════ W11 — failure is never an answer ══════════════ */

test('W11. a git failure or a timeout fails closed — it never reports "clean"', () => {
  const failing = mk({ fail: (a) => a[0] === 'git' && a.join(' ').includes('--name-only') })
  failing.prepare('appr_x')
  assert.throws(() => failing.repoChanges(DIR), /unreadable/)

  const untrackedFails = mk({ fail: (a) => a.join(' ').includes('ls-files --others') })
  untrackedFails.prepare('appr_x')
  assert.throws(() => untrackedFails.repoChanges(DIR), /unreadable/)

  const hanging = mk({ timeout: (a) => a.join(' ').includes('rev-parse HEAD') })
  assert.throws(() => hanging.prepare('appr_x'), /timed out/)
})

/* ══════════════ W12 — cleanup cannot escape ══════════════ */

test('W12. ⛔ cleanup removes only a proven sandbox, and only the whole ENVELOPE', () => {
  const ws = mk({})
  ws.prepare('appr_x')
  for (const bad of [ROOT, '/', '/home/openclaw', '/home/openclaw/dev/aroma-agent-backend', ENV_DIR]) {
    const r = ws.discardPreparedSandbox(bad, { grant: grantFor(APPROVAL) })
    assert.strictEqual(r.ok, false, `${bad} must not be removable`)
  }

  const runner = fakeWsl({})
  const w2 = createOpenClawWslWorkspace({ wslRunner: runner, verifyGrant })
  w2.prepare('appr_x')
  const ok = w2.discardPreparedSandbox(DIR, { grant: grantFor(APPROVAL) })
  assert.strictEqual(ok.ok, true, JSON.stringify(ok))
  assert.strictEqual(ok.removed, ENV_DIR, 'the ENVELOPE is removed, not just the repo')

  const rm = runner.calls.filter((c) => c.startsWith('rm -rf')).pop()
  assert.ok(rm.includes('-- ' + ENV_DIR), `rm must be bounded to the envelope: ${rm}`)
  assert.ok(!rm.includes(DIR), `rm must NOT target the repo child alone: ${rm}`)

  // and the baseline is forgotten, so a later verification cannot pass on a dead sandbox
  assert.throws(() => w2.sandboxState(DIR, SHA), /no prepared sandbox baseline/)
})

test('W12b. ⛔ terminality cannot be ASSERTED by a caller — only a real grant works', () => {
  // The first version took `{ terminal: true }`. Review was right that a boolean is the
  // wrong shape: it lets whoever calls cleanup DECLARE the executor finished, which is
  // exactly the claim no caller is in a position to make. C2-B2-A measured that `tasks
  // cancel` reports success while the turn keeps running and that killing the client does
  // not stop it, so a returning client proves nothing about what is still writing in here.
  const runner = fakeWsl({})
  const ws = createOpenClawWslWorkspace({ wslRunner: runner, verifyGrant })
  ws.prepare(APPROVAL)

  const forged = [
    undefined,
    {},
    { terminal: true },                                        // the old contract
    { grant: true },
    { grant: { approvalId: APPROVAL } },                       // right shape, never issued
    { grant: { approvalId: APPROVAL, state: 'TERMINAL_OBSERVED' } },
    { grant: Object.freeze({ approvalId: APPROVAL, state: 'TERMINAL_OBSERVED' }) }
  ]
  for (const opts of forged) {
    const r = ws.discardPreparedSandbox(DIR, opts)
    assert.strictEqual(r.ok, false, `${JSON.stringify(opts)} must refuse`)
    assert.match(r.reason, /requires a 'pre-execution' grant from the governing quarantine ledger/)
  }
  assert.ok(!runner.calls.some((c) => c.startsWith('rm -rf')), 'nothing may be removed without a grant')

  // a grant issued for a DIFFERENT approval is refused too
  const wrong = ws.discardPreparedSandbox(DIR, { grant: grantFor('some_other_approval') })
  assert.strictEqual(wrong.ok, false)
  assert.match(wrong.reason, /requires a 'pre-execution' grant/)

  // the sandbox is still usable afterwards — a refused cleanup is not a broken sandbox
  assert.ok(ws.sandboxState(DIR, SHA))

  // and a genuine grant for THIS approval works
  assert.strictEqual(ws.discardPreparedSandbox(DIR, { grant: grantFor(APPROVAL) }).ok, true)
})

test('W12c. ⛔ an unwired workspace can never delete anything', () => {
  // No verifier injected at construction means no grant can ever be accepted. Fail closed
  // is the default, so a composition that forgets to wire the ledger is inert rather than
  // dangerous.
  const runner = fakeWsl({})
  const ws = createOpenClawWslWorkspace({ wslRunner: runner })
  ws.prepare(APPROVAL)
  const r = ws.discardPreparedSandbox(DIR, { grant: grantFor(APPROVAL) })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /requires a 'pre-execution' grant from the governing quarantine ledger/)
  assert.ok(!runner.calls.some((c) => c.startsWith('rm -rf')))
})

/* ══════════════ mirror identity and hardening ══════════════ */

test('E1. ⛔ the Windows child environment is EMPTY — no backend secret can cross', () => {
  // The first version omitted `env`, so spawnSync inherited the whole backend environment:
  // every provider key, database credential and session secret the server happens to hold.
  // The original claim rested on argv containing no secrets, which was the wrong evidence —
  // a secret in the environment never appears in argv.
  assert.deepStrictEqual(CHILD_ENV, {}, 'the child environment is empty by construction')
  assert.ok(Object.isFrozen(CHILD_ENV))
})

test('E2. ⛔ sentinel secrets in the PARENT environment never reach the child', () => {
  // Test the environment, not only argv.
  const SENTINELS = {
    ANTHROPIC_API_KEY: 'sk-ant-SENTINEL',
    OPENAI_API_KEY: 'sk-oai-SENTINEL',
    GH_TOKEN: 'ghp_SENTINEL',
    GOOGLE_APPLICATION_CREDENTIALS: 'C:/creds/SENTINEL.json',
    DATABASE_URL: 'mysql://user:SENTINEL@host/db',
    JWT_SECRET: 'SENTINEL-jwt',
    HUB_TOKEN: 'SENTINEL-hub',
    WSLENV: 'ANTHROPIC_API_KEY/u:GH_TOKEN/u'
  }
  const saved = {}
  for (const k of Object.keys(SENTINELS)) { saved[k] = process.env[k]; process.env[k] = SENTINELS[k] }
  try {
    const seen = []
    const { defaultWslRunner } = require('../agent/openClawWslWorkspace')
    // Intercept at the spawn boundary: whatever defaultWslRunner passes as `env` is what
    // the child would receive.
    const cp = require('node:child_process')
    const realSpawn = cp.spawnSync
    cp.spawnSync = (exe, argv, opts) => { seen.push(opts && opts.env); return { status: 0, stdout: '', stderr: '' } }
    try {
      // the runner takes the LINUX argv; it builds the Windows-side prefix itself
      defaultWslRunner(['git', '--version'])
    } finally { cp.spawnSync = realSpawn }

    assert.strictEqual(seen.length, 1)
    const childEnv = seen[0]
    assert.ok(childEnv && typeof childEnv === 'object', 'env must be explicit, never omitted')
    const serialized = JSON.stringify(childEnv)
    assert.ok(!serialized.includes('SENTINEL'), `no parent secret may reach the child: ${serialized}`)
    assert.strictEqual(childEnv.WSLENV, undefined, 'WSLENV would carry named variables across the boundary')
    assert.strictEqual(Object.keys(childEnv).length, 0, 'an empty allowlist cannot drift')
  } finally {
    for (const k of Object.keys(SENTINELS)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]
    }
  }
})

test('E3. the launcher is an absolute path, so no PATH is needed', () => {
  assert.ok(/^[A-Za-z]:\\/.test(WSL_EXE), 'an absolute launcher path')
  assert.ok(WSL_EXE.toLowerCase().endsWith('wsl.exe'))
})

test('H1. every git call disables fsmonitor and every diff disables ext-diff/textconv', () => {
  // .git/config lives inside the sandbox being policed. Without these the verifier itself
  // becomes an execution surface for the thing it is verifying.
  const runner = fakeWsl({})
  const ws = createOpenClawWslWorkspace({ wslRunner: runner, verifyGrant })
  ws.prepare('appr_x'); ws.repoChanges(DIR); ws.sandboxState(DIR, SHA); ws.diffStat(DIR); ws.diffPatch(DIR)

  const gitCalls = runner.calls.filter((c) => c.startsWith('git '))
  assert.ok(gitCalls.length > 0)
  for (const c of gitCalls) {
    assert.ok(c.startsWith('git -c core.fsmonitor=false'), `fsmonitor must be disabled: ${c}`)
  }
  for (const c of gitCalls.filter((x) => x.includes(' diff'))) {
    assert.ok(c.includes('--no-ext-diff') && c.includes('--no-textconv'), `diff must be hardened: ${c}`)
  }
  assert.ok(gitCalls.find((c) => c.includes('--no-color')), 'diffPatch keeps --no-color')
})

test('H2. the launcher is always wsl.exe with a fixed argv and no shell', () => {
  const seen = []
  const ws = createOpenClawWslWorkspace({
    wslRunner: (argv) => { seen.push(argv); return { status: 0, stdout: SHA + '\n', stderr: '', timedOut: false } }
  })
  try { ws.prepare('appr_x') } catch (_) {}
  assert.ok(seen.length > 0)
  for (const argv of seen) {
    // ⛔ the mechanic receives the LINUX argv only — never the distro flags, never a separator
    assert.notStrictEqual(argv[0], '-d', 'no distro flag reaches an injected mechanic')
    assert.ok(!argv.includes('--exec'), 'the exec flag is the runner\'s, not the workspace\'s')
    // ...and the runner turns it into exactly the fixed prefix plus that argv, with --exec
    const win = windowsArgvFor(argv)
    assert.strictEqual(win[0], '-d')
    assert.strictEqual(win[1], DISTRO)
    assert.strictEqual(win[2], '--exec')
    assert.deepStrictEqual(win.slice(3), argv)
    for (const a of argv) {
      // The first version of this line read `|| a === 'sh'`, which made the assertion PASS
      // for the one interpreter most likely to be reached for. It asserted nothing.
      assert.ok(!/^(cmd|cmd\.exe|powershell|powershell\.exe|pwsh|pwsh\.exe|bash|sh|dash|zsh)$/i.test(String(a)),
        `no shell interpreter may be invoked for workspace commands: ${a}`)
      assert.ok(!String(a).includes('&&') && !String(a).includes('|'), `no shell metacharacters in argv: ${a}`)
    }
  }
})

test('H3. ⛔ PRODUCTION identity cannot be overridden by a caller', () => {
  // The previous version of this test asserted the exported CONSTANTS, which says nothing
  // about what the constructor accepts — and the constructor accepted all three. Any
  // composition site could have pointed the provider at another distro or repository.
  const runner = fakeWsl({})
  const ws = createOpenClawWslWorkspace({
    distro: 'OtherDistro',
    sandboxRoot: '/tmp/other',
    sourceUrl: 'https://example.invalid/evil.git',
    wslRunner: runner
  })
  const p = ws.prepare('appr_x')

  assert.strictEqual(ws.distro, DISTRO, 'the distro is not a parameter')
  assert.strictEqual(ws.sandboxRoot, SANDBOX_ROOT, 'the sandbox root is not a parameter')
  assert.ok(p.dir.startsWith(SANDBOX_ROOT + '/'), `the sandbox stays under the fixed root: ${p.dir}`)
  assert.ok(!p.dir.startsWith('/tmp/other'), 'the supplied root was ignored')

  const joined = runner.calls.join(' | ')
  assert.ok(joined.includes(SOURCE_URL), 'it clones the approved URL')
  assert.ok(!joined.includes('example.invalid'), 'the supplied source URL never reaches git')

  // and the distro named in every launch is the fixed one. The mechanic sees the LINUX argv
  // only, so the supplied distro can appear nowhere in it, and the runner's own prefix
  // (built by windowsArgvFor, which no option reaches) names the fixed distro every time.
  const launches = runner.launches || []
  assert.ok(launches.length > 0)
  for (const argv of launches) {
    assert.ok(!argv.includes('OtherDistro'), 'the supplied distro never reaches a launch')
    assert.notStrictEqual(argv[0], '-d', 'no distro flag in the Linux argv')
    assert.strictEqual(windowsArgvFor(argv)[1], DISTRO, 'every launch targets the fixed distro')
  }
})

/* ══════════════ round 2 — object identity, not path identity ══════════════ */

const OBJ_DIR = '2049:1000'
const OBJ_GIT = '2049:1001'
const freshObjects = () => ({ [DIR]: OBJ_DIR, [DIR + '/.git']: OBJ_GIT })

test('O1. ⛔ a REPLACED sandbox directory is refused, however clean it looks', () => {
  // A path is a name. A same-user executor can rename this sandbox away and drop a pristine
  // clone at the original path: same HEAD, same agent branch, no remotes, clean worktree, its
  // own local .git. Every path-based check passes while the verifier inspects an object
  // prepare() never created. device:inode is what tells them apart.
  const objects = freshObjects()
  const ws = mk({ objects })
  ws.prepare('appr_x')
  assert.ok(ws.sandboxState(DIR, SHA), 'the prepared object verifies normally')

  objects[DIR] = '2049:7777'
  assert.throws(() => ws.sandboxState(DIR, SHA), /sandbox directory is not the prepared object/)
})

test('O2. ⛔ a REPLACED .git directory is refused too', () => {
  const objects = freshObjects()
  const ws = mk({ objects })
  ws.prepare('appr_x')
  objects[DIR + '/.git'] = '2049:8888'
  assert.throws(() => ws.sandboxState(DIR, SHA), /\.git is not the prepared object/)
})

test('O3. object identity is checked BEFORE any git evidence is trusted', () => {
  // Asking git about a replacement would produce a perfectly clean, perfectly false report,
  // so the cheap identity question comes first.
  const objects = freshObjects()
  const runner = fakeWsl({ objects })
  const ws = createOpenClawWslWorkspace({ wslRunner: runner, verifyGrant })
  ws.prepare('appr_x')
  const before = runner.calls.length
  objects[DIR] = '2049:7777'
  assert.throws(() => ws.sandboxState(DIR, SHA), /sandbox directory is not the prepared object/)
  const after = runner.calls.slice(before)
  assert.ok(!after.some((c) => c.includes('rev-parse HEAD')),
    'no git evidence may be gathered from a replaced object: ' + after.join(' | '))
})

test('O4. an unreadable or malformed identity fails closed', () => {
  // "I could not tell whether this is the same object" is not "it is the same object".
  const gone = mk({ objects: { [DIR]: null } })
  assert.throws(() => gone.prepare('appr_x'), /identity unreadable/)

  const junk = mk({ objects: { [DIR]: 'not-an-inode' } })
  assert.throws(() => junk.prepare('appr_x'), /malformed filesystem identity/)
})

test('O5. the baseline is never refreshed from the current state', () => {
  // Re-recording identity after execution would simply adopt whatever is there now, which is
  // precisely the attack rather than a defence against it.
  const objects = freshObjects()
  const ws = mk({ objects })
  ws.prepare('appr_x')
  objects[DIR] = '2049:7777'
  assert.throws(() => ws.sandboxState(DIR, SHA), /sandbox directory is not the prepared object/)
  assert.throws(() => ws.sandboxState(DIR, SHA), /sandbox directory is not the prepared object/, 'the mismatch is not learned away')
})
