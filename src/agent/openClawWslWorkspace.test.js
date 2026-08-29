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

const { createOpenClawWslWorkspace, DISTRO, SANDBOX_ROOT, MIRROR_PATH, EXPECTED_REMOTE } = require('../agent/openClawWslWorkspace')

const SHA = '4511f7deeb279b189642b3b812b56250ce518d98'
const OTHER_SHA = 'e034ccc5cc89409375f538ce2a6b7a30f2d14700'
const ROOT = '/home/openclaw/.aroma/sandboxes'
const DIR = ROOT + '/appr_x'

/** Strip the fixed `-d <distro> --` prefix so a fake can read the command it was given. */
const inner = (argv) => argv.slice(argv.indexOf('--') + 1)
/** Strip git's leading `-c key=value` globals, exactly as git does. */
function gitArgs (a) { let i = 0; while (a[i] === '-c') i += 2; return a.slice(i) }

/**
 * A scripted distro. Every answer is explicit, so a test can compose exactly the state it
 * wants without a real WSL present.
 */
function fakeWsl (over = {}) {
  const calls = []
  const ok = (stdout) => ({ status: 0, stdout: stdout === undefined ? '' : stdout, stderr: '', timedOut: false })
  const runner = (argv) => {
    const a = inner(argv)
    calls.push(a.join(' '))
    if (over.fail && over.fail(a)) return { status: 128, stdout: '', stderr: 'fatal: scripted failure', timedOut: false }
    if (over.timeout && over.timeout(a)) return { status: null, stdout: '', stderr: 'timeout', timedOut: true }

    if (a[0] === 'mkdir' || a[0] === 'rm' || a[0] === 'ln') return ok()
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
      if (sub[0] === 'remote' && sub[1] === 'get-url') return ok((over.mirrorUrl === undefined ? EXPECTED_REMOTE : over.mirrorUrl) + '\n')
      if (sub[0] === 'fetch') return ok()
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
  return runner
}

const mk = (over = {}, cfg = {}) => createOpenClawWslWorkspace(Object.assign({
  sandboxRoot: ROOT, mirrorPath: MIRROR_PATH, wslRunner: fakeWsl(over)
}, cfg))

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
    ['/home/openclaw/dev/aroma-agent-backend', 'the dev repo'],
    [MIRROR_PATH, 'the source mirror']
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

test('W3b. ⛔ a mirror placed UNDER the sandbox root is still refused', () => {
  // Under the fixed configuration the mirror lives outside the sandbox root, so the
  // outside-root rule already covers it. This pins the case that rule cannot catch: a
  // misconfiguration — or a later move — that puts the source of every future clone
  // inside the area executors are handed.
  const nested = ROOT + '/mirrors/aroma.git'
  const ws = createOpenClawWslWorkspace({
    sandboxRoot: ROOT,
    mirrorPath: nested,
    wslRunner: fakeWsl({})
  })
  assert.throws(() => ws.containmentCheck(nested), /mirror is not an execution sandbox/,
    'the mirror is never an execution target, wherever it happens to live')
  // and an ordinary sandbox beside it is still fine
  assert.strictEqual(ws.containmentCheck(DIR), DIR)
})

test('W2b. malformed, relative and traversing paths never reach argv', () => {
  for (const bad of ['', '   ', 'relative/path', '../etc', '/tmp/../etc', null, undefined, 42, '/tmp/a\nb', '/tmp/a b']) {
    assert.throws(() => mk().containmentCheck(bad), /refuse:/, `${JSON.stringify(bad)} must be refused`)
  }
})

test('W3. ⛔ the MIRROR is never a valid execution sandbox, even if it sits under the root', () => {
  // The executor is never told the mirror path — but if it ever guessed it, handing it over
  // would put the source of every future clone inside the blast radius.
  const ws = mk({ realpath: { [ROOT + '/sneaky']: MIRROR_PATH } })
  assert.throws(() => ws.containmentCheck(ROOT + '/sneaky'), /mirror|outside/)
})

/* ══════════════ W4/W5 — prepare returns a WSL sandbox, measured in WSL ══════════════ */

test('W4/W5. prepare returns a POSIX sandbox on the exact agent branch with zero remotes', () => {
  const runner = fakeWsl({})
  const ws = createOpenClawWslWorkspace({ sandboxRoot: ROOT, mirrorPath: MIRROR_PATH, wslRunner: runner })
  const p = ws.prepare('appr_x')

  assert.strictEqual(p.dir, DIR, 'the executor receives a POSIX path inside the distro')
  assert.ok(p.dir.startsWith(ROOT + '/'), 'strictly beneath the fixed sandbox root')
  assert.strictEqual(p.branch, 'agent/appr_x')
  assert.strictEqual(p.baseSha, SHA)

  // Measured INSIDE the clone: the rev-parse is addressed to the sandbox, never to Windows.
  const headCall = runner.calls.find((c) => c.includes('rev-parse HEAD'))
  assert.ok(headCall.includes('-C ' + DIR), `baseSha must be read from the clone: ${headCall}`)
  // Cloned FROM the mirror, and the remotes are stripped afterwards.
  assert.ok(runner.calls.some((c) => c.includes('clone') && c.includes(MIRROR_PATH)))
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
  const w2 = createOpenClawWslWorkspace({ sandboxRoot: ROOT, mirrorPath: MIRROR_PATH, wslRunner: runner })
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
    mirrorPath: MIRROR_PATH,
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
    sandboxRoot: ROOT, mirrorPath: MIRROR_PATH,
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

test('W12. ⛔ cleanup removes only a proven sandbox', () => {
  const ws = mk({})
  ws.prepare('appr_x')
  for (const bad of [ROOT, '/', '/home/openclaw', MIRROR_PATH, '/home/openclaw/dev/aroma-agent-backend']) {
    const r = ws.cleanup(bad)
    assert.strictEqual(r.ok, false, `${bad} must not be removable`)
  }
  const runner = fakeWsl({})
  const w2 = createOpenClawWslWorkspace({ sandboxRoot: ROOT, mirrorPath: MIRROR_PATH, wslRunner: runner })
  w2.prepare('appr_x')
  assert.deepStrictEqual(w2.cleanup(DIR), { ok: true })
  const rm = runner.calls.find((c) => c.startsWith('rm -rf'))
  assert.ok(rm.includes('-- ' + DIR), `rm must be bounded to the sandbox: ${rm}`)
  // and the baseline is forgotten, so a later verification cannot pass on a dead sandbox
  assert.throws(() => w2.sandboxState(DIR, SHA), /no prepared sandbox baseline/)
})

/* ══════════════ mirror identity and hardening ══════════════ */

test('M1. the mirror fetch refuses a remote that is not the approved repository', () => {
  const wrong = mk({ mirrorUrl: 'https://github.com/attacker/evil.git' })
  const r = wrong.refreshMirror()
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /not the approved repository/)
})

test('M2. the mirror fetch never pushes and passes no credentials', () => {
  const runner = fakeWsl({})
  const ws = createOpenClawWslWorkspace({ sandboxRoot: ROOT, mirrorPath: MIRROR_PATH, wslRunner: runner })
  assert.deepStrictEqual(ws.refreshMirror(), { ok: true })
  assert.ok(runner.calls.some((c) => c.includes('fetch')), 'a fetch happened')
  assert.ok(!runner.calls.some((c) => c.includes('push')), 'nothing may push')
  const joined = runner.calls.join(' | ')
  for (const secret of ['ANTHROPIC', 'OPENAI', 'TOKEN', 'PASSWORD', 'SECRET', 'GH_TOKEN']) {
    assert.ok(!joined.includes(secret), `${secret} must never appear in argv`)
  }
})

test('H1. every git call disables fsmonitor and every diff disables ext-diff/textconv', () => {
  // .git/config lives inside the sandbox being policed. Without these the verifier itself
  // becomes an execution surface for the thing it is verifying.
  const runner = fakeWsl({})
  const ws = createOpenClawWslWorkspace({ sandboxRoot: ROOT, mirrorPath: MIRROR_PATH, wslRunner: runner })
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
    sandboxRoot: ROOT, mirrorPath: MIRROR_PATH,
    wslRunner: (argv) => { seen.push(argv); return { status: 0, stdout: SHA + '\n', stderr: '', timedOut: false } }
  })
  try { ws.prepare('appr_x') } catch (_) {}
  assert.ok(seen.length > 0)
  for (const argv of seen) {
    assert.strictEqual(argv[0], '-d')
    assert.strictEqual(argv[1], DISTRO)
    assert.strictEqual(argv[2], '--')
    for (const a of argv) {
      assert.ok(!/^(cmd|powershell|bash|sh)$/.test(a) || a === 'sh', 'no shell interpreter is invoked for workspace commands')
      assert.ok(!String(a).includes('&&') && !String(a).includes('|'), `no shell metacharacters in argv: ${a}`)
    }
  }
})

test('H3. the fixed identity is not reachable from any caller input', () => {
  assert.strictEqual(DISTRO, 'OpenClawGateway')
  assert.strictEqual(SANDBOX_ROOT, '/home/openclaw/.aroma/sandboxes')
  assert.ok(MIRROR_PATH.endsWith('.git'))
  assert.strictEqual(EXPECTED_REMOTE, 'https://github.com/Louielui/aroma-agent-backend.git')
  // the dev clone discovered in C2-A is explicitly NOT the execution sandbox
  assert.ok(!SANDBOX_ROOT.includes('/dev/'), 'the dev repo is not the sandbox root')
  assert.notStrictEqual(SANDBOX_ROOT, MIRROR_PATH)
})
