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
      const j = args.join(' ')
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
