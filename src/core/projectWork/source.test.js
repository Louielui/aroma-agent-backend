'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process')
const { createSource, gitRead } = require('./source'), { FILE, TEST, TESTS } = require('./contract'), { digest } = require('../../workers/execution/windowsSandbox')
function fixture (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-source-')), git = args => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', windowsHide: true })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid'])
  fs.mkdirSync(path.dirname(path.join(root, FILE)), { recursive: true }); fs.writeFileSync(path.join(root, FILE), "'use strict'\nmodule.exports = {}\n")
  git(['add', '--', FILE]); git(['commit', '-qm', 'fixture'])
  const head = () => git(['rev-parse', 'HEAD']).trim()
  let boot = head()
  const source = createSource({ root, health: async () => ({ status: 'ok', bootCommit: boot }) })
  return { root, git, source, head, setBoot: v => { boot = v } }
}
test('packages exact current source and protected host tests, with provenance', async t => {
  const f = fixture(t), packet = await f.source.read(f.head())
  assert.deepEqual(Object.keys(packet.order.files), [FILE, TEST]); assert.equal(packet.order.files[TEST], TESTS)
  assert.equal(packet.evidence.revision, f.head()); assert.equal(packet.evidence.sourceFiles[0].sha256, digest(packet.order.files[FILE]))
  assert.equal(packet.evidence.acceptanceFiles[0].sha256, digest(TESTS)); await f.source.verify(packet)
})
test('unrelated dirty files stay outside the package', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, '.env'), 'fixture-secret'); fs.writeFileSync(path.join(f.root, 'unrelated.js'), 'dirty')
  assert.deepEqual(Object.keys((await f.source.read(f.head())).order.files), [FILE, TEST])
})
test('dirty or staged affected source is rejected', async t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.root, FILE), '// dirty\n')
  await assert.rejects(f.source.read(f.head()), /source_dirty/); f.git(['add', '--', FILE]); await assert.rejects(f.source.read(f.head()), /source_dirty/)
})
test('unchanged CRLF checkout survives stale stat data without accepting real or staged edits', async t => {
  const f = fixture(t), name = path.join(f.root, FILE), original = f.git(['show', 'HEAD:' + FILE]).replace(/\r\n/g, '\n')
  f.git(['config', 'core.autocrlf', 'false'])
  fs.writeFileSync(name, original.replace(/\n/g, '\r\n'))
  const stamp = new Date(Date.now() + 1000); fs.utimesSync(name, stamp, stamp)
  assert.match(await gitRead(f.root, ['status', '--porcelain=v1', '--', FILE]), /^ M /)
  const packet = await f.source.read(f.head()); assert.equal(packet.order.files[FILE], original)
  await f.source.verify(packet)
  fs.appendFileSync(name, '// actual edit\r\n'); await assert.rejects(f.source.read(f.head()), /source_dirty/)
  f.git(['add', '--', FILE]); fs.writeFileSync(name, original)
  await assert.rejects(f.source.read(f.head()), /source_dirty/)
})
test('runtime and committed source must match, and a later commit invalidates approval evidence', async t => {
  const f = fixture(t), packet = await f.source.read(f.head()); f.setBoot('a'.repeat(40))
  await assert.rejects(f.source.read(f.head()), /source_changed/); f.setBoot(f.head())
  fs.writeFileSync(path.join(f.root, 'next.txt'), 'next'); f.git(['add', '--', 'next.txt']); f.git(['commit', '-qm', 'next']); f.setBoot(f.head())
  await assert.rejects(f.source.verify(packet), /source_changed/)
})
test('committed symlink mode and credential-like content fail closed', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, FILE), '-----BEGIN PRIVATE KEY-----'); f.git(['add', '--', FILE]); f.git(['commit', '-qm', 'sensitive']); f.setBoot(f.head())
  await assert.rejects(f.source.read(f.head()), /source_sensitive/)
  const blob = f.git(['rev-parse', 'HEAD:' + FILE]).trim(); f.git(['update-index', '--cacheinfo', '120000,' + blob + ',' + FILE]); f.git(['commit', '-qm', 'symlink']); f.setBoot(f.head())
  await assert.rejects(f.source.read(f.head()), /source_unavailable/)
})
test('ambient Git root redirection cannot select another repository', async t => {
  const f = fixture(t), head = f.head(), original = process.env.GIT_DIR; process.env.GIT_DIR = path.join(f.root, 'absent')
  try { assert.equal((await gitRead(f.root, ['rev-parse', 'HEAD'])).trim(), head) } finally { if (original === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = original }
})
