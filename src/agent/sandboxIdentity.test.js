'use strict'

/**
 * sandboxIdentity.test.js — THE SANDBOX MUST STILL BE THE SANDBOX.
 *
 * ── WHAT A CLEAN `git diff` DOES NOT PROVE ──────────────────────────────────
 * Every attack below was reproduced in a scratch clone before this suite existed, and every
 * one of them leaves the worktree empty, the branch correct and the remote list at zero:
 *
 *   git reset --hard <other>    HEAD moves; the worktree matches the NEW head, so it is "clean"
 *   git commit                  the same, on the approved branch
 *   core.worktree=<elsewhere>   the effective worktree redirects; the clone directory remains
 *   .git replaced by a gitfile  git-dir points at ANOTHER repository — and --show-toplevel
 *                               still reported this clone, so a top-level check alone passes
 *   update-index --assume-unchanged / --skip-worktree, then edit the file
 *   stage a change, restore the worktree bytes: worktree clean, index holds other content
 *
 * ── AND THE VERIFIER ITSELF WAS AN EXECUTION SURFACE ────────────────────────
 * core.fsmonitor names an external helper and is configured INSIDE the sandbox. Measured: it
 * was executed by the detector's own `git diff` and `git ls-files`. A textconv driver was
 * executed by diffPatch. Collecting evidence must not be a way to run the sandbox's code, so
 * the sentinel tests below assert a marker file is never created — inspecting argv would only
 * prove what we intended, not what git did.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-sandbox-test-'))

const test = require('node:test')
const assert = require('node:assert')
const { spawnSync } = require('node:child_process')

const { createFeatureBranchWorkspace } = require('../agent/featureBranchWorkspace')

/** Skip leading `-c key=value` global overrides, exactly as git itself does. */
function gitArgs (args) {
  let i = 0
  while (args[i] === '-c') i += 2
  return args.slice(i)
}

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', shell: false })

/** A real source repo plus a workspace that has genuinely prepare()d a clone of it. */
function preparedSandbox () {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-src-'))
  git(['init', '-q', '.'], src)
  git(['config', 'user.email', 'fixture@test'], src)
  git(['config', 'user.name', 'fixture'], src)
  fs.writeFileSync(path.join(src, 'tracked.txt'), 'one\n')
  fs.writeFileSync(path.join(src, 'second.txt'), 'two\n')
  git(['add', '.'], src)
  git(['commit', '-qm', 'one'], src)

  const ws = createFeatureBranchWorkspace({ repoRoot: src })
  const prepared = ws.prepare('appr_sandbox')
  return { src, ws, dir: prepared.dir, branch: prepared.branch, baseSha: prepared.baseSha }
}

const cleanupSandbox = (s) => {
  try { fs.rmSync(s.dir, { recursive: true, force: true }) } catch (_) {}
  try { fs.rmSync(s.src, { recursive: true, force: true }) } catch (_) {}
}

/* ══════════════════ S12 — the honest baseline ══════════════════ */

test('S12. a freshly prepared sandbox is structurally pristine', () => {
  const s = preparedSandbox()
  const st = s.ws.sandboxState(s.dir, s.baseSha)
  assert.strictEqual(st.headSha, s.baseSha)
  assert.strictEqual(st.currentBranch, s.branch)
  assert.deepStrictEqual(st.remotes, [])
  assert.deepStrictEqual(st.indexFlagged, [])
  assert.deepStrictEqual(st.indexDrift, [])
  assert.strictEqual(st.dotGitIsRealDir, true)
  assert.strictEqual(st.topLevelOk, true)
  assert.strictEqual(st.gitDirOk, true)
  assert.strictEqual(st.commonDirOk, true)
  assert.deepStrictEqual(s.ws.repoChanges(s.dir), [])
  cleanupSandbox(s)
})

test('S0. a directory prepare() never created has NO baseline and fails closed', () => {
  // An unprepared directory is not a sandbox. Verification cannot invent a baseline for it.
  const s = preparedSandbox()
  const stranger = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-stranger-'))
  git(['init', '-q', '.'], stranger)
  assert.throws(() => s.ws.sandboxState(stranger, s.baseSha), /no prepared sandbox baseline/)
  fs.rmSync(stranger, { recursive: true, force: true })
  cleanupSandbox(s)
})

/* ══════════════════ S1/S2 — HEAD moves, everything else looks fine ══════════════════ */

test('S1. ⛔ reset --hard moves HEAD while branch, remotes and worktree stay perfect', () => {
  const s = preparedSandbox()
  fs.writeFileSync(path.join(s.dir, 'tracked.txt'), 'two\n')
  git(['commit', '-qam', 'two'], s.dir)
  const other = git(['rev-parse', 'HEAD'], s.dir).stdout.trim()
  git(['reset', '-q', '--hard', other], s.dir)

  const st = s.ws.sandboxState(s.dir, s.baseSha)
  assert.strictEqual(st.currentBranch, s.branch, 'branch still correct')
  assert.deepStrictEqual(st.remotes, [], 'remotes still zero')
  assert.deepStrictEqual(s.ws.repoChanges(s.dir), [], 'worktree still perfectly clean')
  assert.notStrictEqual(st.headSha, s.baseSha, 'ONLY HEAD gives it away')
  cleanupSandbox(s)
})

test('S2. ⛔ a plain commit on the APPROVED branch also moves HEAD', () => {
  const s = preparedSandbox()
  fs.writeFileSync(path.join(s.dir, 'tracked.txt'), 'edited\n')
  git(['commit', '-qam', 'sneaky'], s.dir)

  const st = s.ws.sandboxState(s.dir, s.baseSha)
  assert.strictEqual(st.currentBranch, s.branch)
  assert.deepStrictEqual(s.ws.repoChanges(s.dir), [], 'committing makes the worktree clean again')
  assert.notStrictEqual(st.headSha, s.baseSha)
  cleanupSandbox(s)
})

/* ══════════════════ S3/S4/S5 — redirection ══════════════════ */

test('S3. ⛔ core.worktree redirects the effective worktree elsewhere', () => {
  const s = preparedSandbox()
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-elsewhere-'))
  git(['config', 'core.worktree', elsewhere], s.dir)

  const st = s.ws.sandboxState(s.dir, s.baseSha)
  assert.strictEqual(st.topLevelOk, false, 'the top-level is no longer this clone')
  fs.rmSync(elsewhere, { recursive: true, force: true })
  cleanupSandbox(s)
})

test('S4. ⛔ a .git gitfile redirects metadata to ANOTHER repository', () => {
  const s = preparedSandbox()
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-other-'))
  git(['init', '-q', '.'], other)
  git(['config', 'user.email', 'x@x'], other)
  git(['config', 'user.name', 'x'], other)
  fs.writeFileSync(path.join(other, 'z.txt'), 'z\n')
  git(['add', '.'], other)
  git(['commit', '-qm', 'z'], other)

  fs.renameSync(path.join(s.dir, '.git'), path.join(s.dir, '.git-real'))
  fs.writeFileSync(path.join(s.dir, '.git'), 'gitdir: ' + other.replace(/\\/g, '/') + '/.git\n')

  // The redirected metadata cannot even resolve the approved commit, so verification THROWS.
  // That is the correct fail-closed outcome — the worker maps it to an isolation refusal —
  // and it is asserted rather than smoothed over into a returned object.
  assert.throws(() => s.ws.sandboxState(s.dir, s.baseSha), /unreadable|bad object/)
  // The structural fact stays independently visible without asking the redirected repository.
  assert.strictEqual(fs.lstatSync(path.join(s.dir, String.fromCharCode(46,103,105,116))).isDirectory(), false)

  fs.rmSync(path.join(s.dir, '.git'))
  fs.renameSync(path.join(s.dir, '.git-real'), path.join(s.dir, '.git'))
  fs.rmSync(other, { recursive: true, force: true })
  cleanupSandbox(s)
})

test('S5. a .git that is not a real directory fails closed however it was replaced', () => {
  const s = preparedSandbox()
  fs.renameSync(path.join(s.dir, '.git'), path.join(s.dir, '.git-real'))
  // A symlink is the other supported redirect; where the platform refuses to create one,
  // the plain-file case above already proves the structural check.
  let made = false
  try { fs.symlinkSync(path.join(s.dir, '.git-real'), path.join(s.dir, '.git'), 'junction'); made = true } catch (_) { made = false }
  if (made) {
    const st = s.ws.sandboxState(s.dir, s.baseSha)
    assert.strictEqual(st.dotGitIsRealDir, false, 'a symlinked .git is not the clone\'s own directory')
    fs.unlinkSync(path.join(s.dir, '.git'))
  }
  fs.renameSync(path.join(s.dir, '.git-real'), path.join(s.dir, '.git'))
  cleanupSandbox(s)
})

/* ══════════════════ S6/S7/S8 — the index ══════════════════ */

test('S6. ⛔ assume-unchanged hides a real file mutation from every worktree check', () => {
  const s = preparedSandbox()
  git(['update-index', '--assume-unchanged', 'tracked.txt'], s.dir)
  fs.writeFileSync(path.join(s.dir, 'tracked.txt'), 'MUTATED\n')

  assert.deepStrictEqual(s.ws.repoChanges(s.dir), [], 'the worktree check sees nothing at all')
  const st = s.ws.sandboxState(s.dir, s.baseSha)
  assert.strictEqual(st.indexFlagged.length, 1)
  assert.strictEqual(st.indexFlagged[0].file, 'tracked.txt')
  cleanupSandbox(s)
})

test('S7. ⛔ skip-worktree hides it too', () => {
  const s = preparedSandbox()
  git(['update-index', '--skip-worktree', 'tracked.txt'], s.dir)
  fs.writeFileSync(path.join(s.dir, 'tracked.txt'), 'MUTATED\n')

  assert.deepStrictEqual(s.ws.repoChanges(s.dir), [])
  const st = s.ws.sandboxState(s.dir, s.baseSha)
  assert.strictEqual(st.indexFlagged.length, 1)
  assert.strictEqual(st.indexFlagged[0].tag, 'S', 'skip-worktree is marked S — pinned empirically')
  cleanupSandbox(s)
})

test('S8. ⛔ index-only drift: staged content differs while the worktree is restored', () => {
  const s = preparedSandbox()
  fs.writeFileSync(path.join(s.dir, 'tracked.txt'), 'STAGED\n')
  git(['add', 'tracked.txt'], s.dir)
  fs.writeFileSync(path.join(s.dir, 'tracked.txt'), 'one\n')

  assert.deepStrictEqual(s.ws.repoChanges(s.dir), [], 'worktree restored, so it reads clean')
  const st = s.ws.sandboxState(s.dir, s.baseSha)
  assert.deepStrictEqual(st.indexDrift, ['tracked.txt'], 'the index still carries other content')
  cleanupSandbox(s)
})

/* ══════════════════ S9/S10/S11 — remotes and branch ══════════════════ */

test('S9/S10/S11. a remote, a wrong branch, and main are each visible', () => {
  const s = preparedSandbox()
  git(['remote', 'add', 'attacker', 'https://example.invalid/x.git'], s.dir)
  assert.deepStrictEqual(s.ws.sandboxState(s.dir, s.baseSha).remotes, ['attacker'])
  git(['remote', 'remove', 'attacker'], s.dir)

  git(['checkout', '-q', '-b', 'agent/appr_somebody_else'], s.dir)
  assert.strictEqual(s.ws.sandboxState(s.dir, s.baseSha).currentBranch, 'agent/appr_somebody_else')

  git(['checkout', '-q', '-B', 'main'], s.dir)
  assert.strictEqual(s.ws.sandboxState(s.dir, s.baseSha).currentBranch, 'main')
  cleanupSandbox(s)
})

/* ══════════════════ the verifier must not become an execution surface ══════════════════ */

/** A sentinel helper that creates a marker OUTSIDE the repo if it is ever executed. */
function sentinel (dir, name) {
  const marker = path.join(dir, name + '_RAN')
  const script = path.join(dir, name + '.sh')
  fs.writeFileSync(script, '#!/bin/sh\ntouch "' + marker.replace(/\\/g, '/') + '"\ncat "$1" 2>/dev/null\nprintf ""\n')
  try { fs.chmodSync(script, 0o755) } catch (_) {}
  return { marker, script: script.replace(/\\/g, '/'), ran: () => fs.existsSync(marker) }
}

test('F1. ⛔ core.fsmonitor is NEVER executed by any verifier command', () => {
  // Measured before the fix: this helper WAS run by the detector's own git diff and
  // ls-files. Asserting on argv would only prove what we intended; the marker proves
  // what git actually did.
  const s = preparedSandbox()
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-sentinel-'))
  const fsm = sentinel(host, 'FSMONITOR')
  git(['config', 'core.fsmonitor', fsm.script], s.dir)

  s.ws.repoChanges(s.dir)
  s.ws.sandboxState(s.dir, s.baseSha)
  s.ws.diffStat(s.dir)
  s.ws.diffPatch(s.dir)

  assert.strictEqual(fsm.ran(), false, 'the fsmonitor helper must never run')
  fs.rmSync(host, { recursive: true, force: true })
  cleanupSandbox(s)
})

test('F2. ⛔ a textconv driver is NEVER executed by repoChanges, diffStat or diffPatch', () => {
  // Measured before the fix: diffPatch executed this driver, because it passed
  // --no-ext-diff but not --no-textconv.
  const s = preparedSandbox()
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-sentinel-'))
  const tc = sentinel(host, 'TEXTCONV')
  git(['config', 'diff.evil.textconv', tc.script], s.dir)
  fs.writeFileSync(path.join(s.dir, '.gitattributes'), 'tracked.txt diff=evil\n')
  fs.writeFileSync(path.join(s.dir, 'tracked.txt'), 'CHANGED\n')

  s.ws.repoChanges(s.dir)
  s.ws.diffStat(s.dir)
  s.ws.diffPatch(s.dir)

  assert.strictEqual(tc.ran(), false, 'evidence collection must not run the sandbox\'s own code')
  fs.rmSync(host, { recursive: true, force: true })
  cleanupSandbox(s)
})

test('F3. ⛔ an external diff driver is NEVER executed either', () => {
  const s = preparedSandbox()
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-sentinel-'))
  const ext = sentinel(host, 'EXTDIFF')
  git(['config', 'diff.external', ext.script], s.dir)
  fs.writeFileSync(path.join(s.dir, 'tracked.txt'), 'CHANGED\n')

  s.ws.repoChanges(s.dir)
  s.ws.diffStat(s.dir)
  s.ws.diffPatch(s.dir)

  assert.strictEqual(ext.ran(), false, 'no external diff driver may run')
  fs.rmSync(host, { recursive: true, force: true })
  cleanupSandbox(s)
})

test('F4. the hardening survives a repository that CLAIMS fsmonitor is fine', () => {
  // The override is passed per invocation in argv precisely because .git/config is inside
  // the sandbox: the repository's own opinion of its settings is not evidence.
  const seen = []
  const spy = createFeatureBranchWorkspace({
    repoRoot: process.cwd(),
    gitRunner: (args) => { seen.push(args.join(' ')); return { status: 0, stdout: '', stderr: '' } }
  })
  spy.repoChanges('C:/tmp/x')
  spy.diffStat('C:/tmp/x')
  spy.diffPatch('C:/tmp/x')
  assert.ok(seen.length > 0)
  for (const call of seen) {
    assert.ok(call.startsWith('-c core.fsmonitor=false'), `every git call must disable fsmonitor: ${call}`)
  }
  const patch = seen.find((c) => c.includes('--no-color'))
  assert.ok(patch.includes('--no-ext-diff') && patch.includes('--no-textconv'), `diffPatch hardening: ${patch}`)
  const stat = seen.find((c) => c.includes('--stat'))
  assert.ok(stat.includes('--no-ext-diff') && stat.includes('--no-textconv'), `diffStat hardening: ${stat}`)
})
