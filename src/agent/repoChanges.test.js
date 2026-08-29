'use strict'

/**
 * repoChanges.test.js — "NOTHING WAS WRITTEN HERE" IS TWO QUESTIONS, NOT ONE.
 *
 * ── THE BLIND SPOT ──────────────────────────────────────────────────────────
 * The read-only verdict used filesChanged(), which asks `git diff --name-only HEAD`. That
 * command by definition never lists an UNTRACKED file. Measured in a scratch repository:
 * create brand-new-untracked.txt and the command answers [] while `ls-files --others`
 * names it. So an executor told to be read-only could CREATE a new source file and be
 * reported perfectly clean.
 *
 * ── WHY THE OLD TESTS MISSED IT ─────────────────────────────────────────────
 * Every C1 workspace was a fake whose filesChanged() answer was scripted, so the tests
 * agreed with the implementation about a question neither of them was asking. These tests
 * therefore drive REAL git against REAL repositories — the only way a detector's blind
 * spot can be seen at all.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-repochanges-test-'))

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

/** A real git repository with one committed file. */
function scratchRepo () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-repo-'))
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false })
    if (r.status !== 0) throw new Error(args.join(' ') + ' -> ' + (r.stderr || r.status))
    return r.stdout
  }
  g(['init', '-q'])
  g(['config', 'user.email', 'fixture@test'])
  g(['config', 'user.name', 'fixture'])
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'one\n')
  fs.writeFileSync(path.join(dir, 'second.txt'), 'two\n')
  g(['add', '.'])
  g(['commit', '-qm', 'init'])
  return dir
}

/** The real workspace object, so the real repoChanges implementation is what runs. */
const ws = () => createFeatureBranchWorkspace({ repoRoot: process.cwd() })

test('U1. a tracked MODIFICATION is detected', () => {
  const dir = scratchRepo()
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'one\nchanged\n')
  assert.deepStrictEqual(ws().repoChanges(dir), ['tracked.txt'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('U2. a tracked DELETION is detected', () => {
  const dir = scratchRepo()
  fs.rmSync(path.join(dir, 'tracked.txt'))
  assert.deepStrictEqual(ws().repoChanges(dir), ['tracked.txt'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('U3. ⛔ a NEW UNTRACKED FILE is detected — the whole point of this detector', () => {
  const dir = scratchRepo()
  fs.writeFileSync(path.join(dir, 'brand-new-untracked.txt'), 'SNEAKY\n')

  // The old detector's exact question, asked here so the gap is visible rather than argued.
  const trackedOnly = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: dir, encoding: 'utf8', shell: false })
  assert.strictEqual(String(trackedOnly.stdout).trim(), '',
    'this is the blind spot: the tracked-only question sees nothing')

  assert.deepStrictEqual(ws().repoChanges(dir), ['brand-new-untracked.txt'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('U3b. a RENAME is detected (a working-tree rename is a deletion plus an untracked file)', () => {
  const dir = scratchRepo()
  fs.renameSync(path.join(dir, 'tracked.txt'), path.join(dir, 'renamed.txt'))
  assert.deepStrictEqual(ws().repoChanges(dir), ['renamed.txt', 'tracked.txt'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('U4. tracked and untracked paths are all returned, once each, sorted', () => {
  const dir = scratchRepo()
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'edited\n')
  fs.rmSync(path.join(dir, 'second.txt'))
  fs.mkdirSync(path.join(dir, 'nested'))
  fs.writeFileSync(path.join(dir, 'nested', 'new.txt'), 'x\n')
  fs.writeFileSync(path.join(dir, 'another-new.txt'), 'y\n')

  const changed = ws().repoChanges(dir)
  assert.deepStrictEqual(changed, ['another-new.txt', 'nested/new.txt', 'second.txt', 'tracked.txt'])
  assert.strictEqual(new Set(changed).size, changed.length, 'no duplicates')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('U4b. a clean repository reports nothing changed', () => {
  const dir = scratchRepo()
  assert.deepStrictEqual(ws().repoChanges(dir), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('U5. ⛔ a detector FAILURE throws — it never answers "clean"', () => {
  // "Could not determine whether files changed" and "no files changed" are different facts,
  // and only one of them is safe to act on. Returning [] on failure — which the old
  // filesChanged does — makes the dangerous one indistinguishable from the safe one.
  const failing = (which) => createFeatureBranchWorkspace({
    repoRoot: process.cwd(),
    gitRunner: (args) => {
      const j = gitArgs(args).join(' ')
      if (which === 'diff' && j.startsWith('diff')) return { status: 128, stdout: '', stderr: 'fatal: not a git repository' }
      if (which === 'ls' && j.startsWith('ls-files')) return { status: 128, stdout: '', stderr: 'fatal: broken index' }
      return { status: 0, stdout: '', stderr: '' }
    }
  })
  assert.throws(() => failing('diff').repoChanges('C:/tmp/x'), /repository change detection failed/)
  assert.throws(() => failing('ls').repoChanges('C:/tmp/x'), /untracked change detection failed/)
})

test('U6. NUL-separated parsing survives a path containing a space', () => {
  // -z exists so paths are emitted raw instead of quoted; a filename with a space must not
  // arrive as two files.
  const dir = scratchRepo()
  fs.writeFileSync(path.join(dir, 'a file with spaces.txt'), 'x\n')
  assert.deepStrictEqual(ws().repoChanges(dir), ['a file with spaces.txt'])
  fs.rmSync(dir, { recursive: true, force: true })
})

/* ══════ PR #49 final review: IGNORED files are still repository writes ══════ */

/** A scratch repo that ignores the security-relevant shapes this repository ignores. */
function ignoringRepo () {
  const dir = scratchRepo()
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false })
    if (r.status !== 0) throw new Error(args.join(' ') + ' -> ' + (r.stderr || r.status))
  }
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.log\n.env\ndata/\n*.creds\npassword.txt\n')
  g(['add', '.gitignore'])
  g(['commit', '-qm', 'ignore rules'])
  return dir
}

test('G2. ⛔ a .gitignore-IGNORED untracked file is detected', () => {
  // The blocker, kept permanently visible: the flagged command is asked alongside the fixed
  // detector, and its blindness is asserted rather than described.
  const dir = ignoringRepo()
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n')
  fs.writeFileSync(path.join(dir, 'app.log'), 'noise\n')
  fs.writeFileSync(path.join(dir, 'password.txt'), 'hunter2\n')

  const hidden = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: dir, encoding: 'utf8', shell: false })
  assert.strictEqual(String(hidden.stdout).trim(), '',
    '--exclude-standard HIDES all three — this is exactly the blind spot being closed')

  assert.deepStrictEqual(ws().repoChanges(dir), ['.env', 'app.log', 'password.txt'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('G3. a .git/info/exclude-ignored file is detected', () => {
  const dir = scratchRepo()
  fs.mkdirSync(path.join(dir, '.git', 'info'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.git', 'info', 'exclude'), 'local-secret.txt\n')
  fs.writeFileSync(path.join(dir, 'local-secret.txt'), 'x\n')

  const hidden = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: dir, encoding: 'utf8', shell: false })
  assert.strictEqual(String(hidden.stdout).trim(), '', 'info/exclude hides it from the flagged command too')

  assert.deepStrictEqual(ws().repoChanges(dir), ['local-secret.txt'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('G4. content inside an IGNORED DIRECTORY is detected', () => {
  const dir = ignoringRepo()
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data', 'db.json'), '{"rows":1}\n')
  assert.deepStrictEqual(ws().repoChanges(dir), ['data/db.json'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('G10. a clean IGNORING repository still reports nothing', () => {
  const dir = ignoringRepo()
  assert.deepStrictEqual(ws().repoChanges(dir), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

/* ══════ exact pathname identity — the parser must not edit git's answer ══════ */

const NUL = String.fromCharCode(0)

/** Drive the real parser with exact synthetic git output, since Windows cannot host these names. */
function parserWith (trackedOut, untrackedOut) {
  return createFeatureBranchWorkspace({
    repoRoot: process.cwd(),
    gitRunner: (args) => {
      const j = gitArgs(args).join(' ')
      if (j.startsWith('diff')) return { status: 0, stdout: trackedOut, stderr: '' }
      if (j.startsWith('ls-files')) return { status: 0, stdout: untrackedOut, stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    }
  }).repoChanges('C:/tmp/x')
}

test('P1. leading, trailing and whitespace-only pathnames survive EXACTLY', () => {
  // A git pathname is an identity. ' leading.txt' and 'leading.txt' are different files, so
  // trimming silently renames one into the other — or, for '   ', erases it entirely and
  // reports the repository clean.
  const names = [' leading.txt', 'trailing.txt ', '   ', 'a file with spaces.txt']
  const out = parserWith('', names.join(NUL) + NUL)
  for (const n of names) assert.ok(out.includes(n), `${JSON.stringify(n)} must survive verbatim`)
  assert.strictEqual(out.length, names.length, 'no record dropped or merged')
})

test('P2. a NEWLINE inside a pathname does not become a record separator', () => {
  const weird = 'line\nbreak.txt'
  const out = parserWith('', weird + NUL + 'other.txt' + NUL)
  assert.deepStrictEqual(out.sort(), [weird, 'other.txt'].sort())
  assert.strictEqual(out.length, 2, 'a newline is data, not a delimiter — -z is why')
})

test('P3. a BACKSLASH in a pathname is not rewritten to a forward slash', () => {
  // The old parser rewrote separators for presentation. That edits the identity of a path
  // that legitimately contains a backslash on a POSIX checkout.
  const out = parserWith('', 'weird\name.txt' + NUL)
  assert.deepStrictEqual(out, ['weird\name.txt'])
})

test('P4. only the FINAL delimiter-generated empty record is removed', () => {
  assert.deepStrictEqual(parserWith('a.txt' + NUL, ''), ['a.txt'])
  assert.deepStrictEqual(parserWith('', ''), [])
  // Two records where the second is whitespace — the whitespace one is kept.
  assert.deepStrictEqual(parserWith('a.txt' + NUL + ' ' + NUL, '').sort(), [' ', 'a.txt'])
})

/* ══════ PR #49: STRUCTURAL isolation lives in .git, not the worktree ══════ */

test('I1. a fresh clone on the expected branch with zero remotes passes', () => {
  const dir = scratchRepo()
  const state = ws().isolationState(dir)
  assert.deepStrictEqual(state.remotes, [])
  assert.ok(typeof state.currentBranch === 'string' && state.currentBranch !== '')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('I2. ⛔ a added remote is reported — while the WORKTREE stays clean', () => {
  // This is the whole point: prepare() stripped every remote so push/PR/merge would have
  // nowhere to go. Restoring one is invisible to any worktree-based check.
  const dir = scratchRepo()
  spawnSync('git', ['remote', 'add', 'attacker', 'https://example.invalid/x.git'], { cwd: dir, shell: false })

  assert.deepStrictEqual(ws().repoChanges(dir), [], 'the worktree is spotless — that is the trap')
  assert.deepStrictEqual(ws().isolationState(dir).remotes, ['attacker'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('I3. ⛔ a branch switch is reported — while the WORKTREE stays clean', () => {
  // "Clean" is measured against whatever HEAD has become, so switching branch makes the
  // read-only verdict true about the wrong thing.
  const dir = scratchRepo()
  spawnSync('git', ['checkout', '-q', '-b', 'main'], { cwd: dir, shell: false })

  assert.deepStrictEqual(ws().repoChanges(dir), [], 'still spotless')
  assert.strictEqual(ws().isolationState(dir).currentBranch, 'main')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('I4/I5. a git failure THROWS — it never answers "no remotes" or an empty branch', () => {
  // The existing remotes() ignores exit status, so a failed `git remote` yields '' and reads
  // as "no remotes" — the most reassuring possible answer to a question never answered.
  const failing = (which) => createFeatureBranchWorkspace({
    repoRoot: process.cwd(),
    gitRunner: (args) => {
      const j = gitArgs(args).join(' ')
      if (which === 'remote' && j === 'remote') return { status: 128, stdout: '', stderr: 'fatal: broken' }
      if (which === 'branch' && j.startsWith('rev-parse')) return { status: 128, stdout: '', stderr: 'fatal: broken' }
      if (j.startsWith('rev-parse')) return { status: 0, stdout: 'agent/appr_x\n', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    }
  })
  assert.throws(() => failing('remote').isolationState('C:/tmp/x'), /remote state unreadable/)
  assert.throws(() => failing('branch').isolationState('C:/tmp/x'), /branch state unreadable/)

  const emptyBranch = createFeatureBranchWorkspace({
    repoRoot: process.cwd(),
    gitRunner: (args) => gitArgs(args).join(' ').startsWith('rev-parse')
      ? { status: 0, stdout: '\n', stderr: '' }
      : { status: 0, stdout: '', stderr: '' }
  })
  assert.throws(() => emptyBranch.isolationState('C:/tmp/x'), /branch state is empty/)
})

test('I6. the change detector disables external diff drivers', () => {
  // A diff driver is configured IN .git/config, inside the very sandbox being policed.
  // Without these flags an executor could register an external command and have the
  // read-only CHECK run it — turning the guard into the thing it guards against.
  const seen = []
  const spy = createFeatureBranchWorkspace({
    repoRoot: process.cwd(),
    gitRunner: (args) => { seen.push(gitArgs(args).join(' ')); return { status: 0, stdout: '', stderr: '' } }
  })
  spy.repoChanges('C:/tmp/x')
  const diff = seen.find((c) => c.startsWith('diff'))
  assert.ok(diff.includes('--no-ext-diff'), `external diff must be disabled: ${diff}`)
  assert.ok(diff.includes('--no-textconv'), `textconv must be disabled: ${diff}`)
})
