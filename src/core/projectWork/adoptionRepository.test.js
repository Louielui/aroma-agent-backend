'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process'), { randomUUID } = require('node:crypto')
const { createRepository, git: command } = require('./adoptionRepository'), { createSource } = require('./source'), { FILE } = require('./contract')
function fixture (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-adoption-')), git = args => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', windowsHide: true })
  t.after(() => { const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); fs.rmSync(resolved, { recursive: true, force: true }) })
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'core.autocrlf', 'false'])
  fs.mkdirSync(path.dirname(path.join(root, FILE)), { recursive: true }); fs.writeFileSync(path.join(root, FILE), 'original\n'); fs.writeFileSync(path.join(root, 'other.txt'), 'tracked'); git(['add', '.']); git(['commit', '-qm', 'fixture'])
  const head = () => git(['rev-parse', 'HEAD']).trim(); let boot = head(); const source = createSource({ root, health: async () => ({ status: 'ok', bootCommit: boot }) })
  return { root, git, source, head, boot: () => { boot = head() } }
}
test('actual single-file commit and rollback preserve unrelated staged, unstaged and untracked bytes', async t => {
  const f = fixture(t), repo = createRepository({ root: f.root, source: f.source })
  fs.writeFileSync(path.join(f.root, 'other.txt'), 'staged'); f.git(['add', 'other.txt']); fs.writeFileSync(path.join(f.root, 'other.txt'), 'unstaged'); fs.writeFileSync(path.join(f.root, '.env'), 'fixture-only')
  const other = () => [f.git(['diff', '--', 'other.txt']), f.git(['diff', '--cached', '--', 'other.txt']), fs.readFileSync(path.join(f.root, '.env'), 'utf8')]
  const untouched = other(), snapshot = await f.source.read(f.head()); const adopted = await repo.apply({ snapshot, before: 'original\n', after: 'candidate\n', id: randomUUID(), action: 'adopt' })
  assert.deepEqual(other(), untouched); assert.equal(f.git(['show', 'HEAD:other.txt']), 'tracked'); assert.equal(f.git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).trim(), FILE)
  await assert.rejects(repo.verifyLoaded({ commit: adopted.commit, after: 'candidate\n', change: adopted }), /source_changed/); f.boot(); await repo.verifyLoaded({ commit: adopted.commit, after: 'candidate\n', change: adopted })
  const reverted = await repo.apply({ snapshot: await f.source.read(f.head()), before: 'candidate\n', after: 'original\n', id: randomUUID(), action: 'rollback' }); f.boot()
  assert.equal(reverted.parentCommit, adopted.commit); assert.equal(f.git(['show', 'HEAD:' + FILE]), 'original\n'); assert.deepEqual(other(), untouched)
})
test('proven commit failure restores only its uncommitted bytes', async t => {
  const f = fixture(t), previous = f.head(), snapshot = await f.source.read(previous), repo = createRepository({ root: f.root, source: f.source, command: (root, args) => args.includes('commit') ? Promise.reject(Error('repository_unavailable')) : command(root, args) })
  await assert.rejects(repo.apply({ snapshot, before: 'original\n', after: 'candidate\n', id: randomUUID(), action: 'adopt' }), /repository_unavailable/)
  assert.equal(fs.readFileSync(path.join(f.root, FILE), 'utf8'), 'original\n'); assert.equal(f.head(), previous); assert.equal(f.git(['status', '--porcelain']).trim(), '')
})
test('ambiguous committed outcome is retained for inspection rather than reset', async t => {
  const f = fixture(t), previous = f.head(), snapshot = await f.source.read(previous), repo = createRepository({ root: f.root, source: f.source, command: async (root, args) => { const out = await command(root, args); if (args.includes('commit')) throw Error('transport_after_commit'); return out } })
  await assert.rejects(repo.apply({ snapshot, before: 'original\n', after: 'candidate\n', id: randomUUID(), action: 'adopt' }), /adoption_inspection_required/)
  assert.notEqual(f.head(), previous); assert.equal(fs.readFileSync(path.join(f.root, FILE), 'utf8'), 'candidate\n')
})
