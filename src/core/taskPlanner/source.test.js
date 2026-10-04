'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process')
const { createSource, createRemoteSource } = require('./source'), { validatePacket, READ_PROFILES } = require('./contract'), { FAILURE_RECIPE, FILE, GATEWAY } = require('../projectWork/contract')
function fixture (t, names = [FILE, GATEWAY]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-planner-source-')), git = args => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', windowsHide: true })
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); fs.rmSync(root, { recursive: true, force: true }) })
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid'])
  for (const name of names) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), fs.readFileSync(path.join(__dirname, '../../..', name), 'utf8').replace(/\r\n/g, '\n')) }
  git(['add', '--', ...names]); git(['commit', '-qm', 'actual source'])
  const head = git(['rev-parse', 'HEAD']).trim(); let boot = head
  const health = async () => ({ status: 'ok', bootCommit: boot })
  return { root, git, head, source: createSource({ root, health }), project: require('../projectWork/source').createSource({ root, health }), boot: value => { boot = value } }
}
test('planner reads only actual committed fixed blobs and rejects dirty, boot drift and credential patterns', async t => {
  const f = fixture(t), input = { bootCommit: f.head, profile: 'context' }, packet = await f.source.read(input)
  validatePacket(packet, 'context'); assert.equal(packet.evidence.files.length, 2); fs.writeFileSync(path.join(f.root, '.env'), 'excluded'); assert.equal((await f.source.read(input)).hash, packet.hash)
  await assert.rejects(f.source.read({ ...input, profile: '../.env' }), /invalid_request/)
  f.boot('a'.repeat(40)); await assert.rejects(f.source.read(input), /evidence_changed/); f.boot(f.head)
  fs.appendFileSync(path.join(f.root, FILE), '//dirty'); await assert.rejects(f.source.read(input), /source_dirty/)
  fs.writeFileSync(path.join(f.root, FILE), '-----BEGIN PRIVATE KEY-----'); f.git(['add', '--', FILE]); f.git(['commit', '-qm', 'sensitive']); const head = f.git(['rev-parse', 'HEAD']).trim(); f.boot(head); await assert.rejects(f.source.read({ ...input, bootCommit: head }), /source_sensitive/)
})
test('new execution recipe packages actual read-only dependency with a separate hash and rejects dependency drift', async t => {
  const f = fixture(t), p = await f.project.read(f.head, undefined, FAILURE_RECIPE)
  assert.deepEqual(p.order.editable, [GATEWAY]); assert.equal(p.evidence.sourceFiles.length, 1); assert.equal(p.evidence.dependencyFiles[0].path, FILE); assert.ok(p.order.files[FILE]); await f.project.verify(p)
  fs.appendFileSync(path.join(f.root, FILE), '// dependency changed'); await assert.rejects(f.project.verify(p), /source_dirty/)
})
test('remote source checks Owner and local read grant before sending a closed request', async () => {
  let called; const source = createRemoteSource({ bootCommit: 'a'.repeat(40), env: { READ_ACCESS: 'on' }, request: async (route, input) => { called = { route, input }; return {} } })
  const owner = { id: 'owner', role: 'owner' }; await source.read(owner, 'context'); assert.deepEqual(called, { route: '/task-plan-source', input: { bootCommit: 'a'.repeat(40), profile: 'context' } })
  await assert.rejects(source.read({ id: 'ivy', role: 'manager' }, 'context'), /permission_denied/)
  await assert.rejects(createRemoteSource({ env: {}, request: () => { throw Error('must not call') } }).read(owner, 'context'), /read_access_disabled/)
})

test('interface planning hashes supporting markup and bindings and rejects read-only dependency drift', async t => {
  const f = fixture(t, READ_PROFILES.interface), input = { bootCommit: f.head, profile: 'interface' }, packet = await f.source.read(input)
  validatePacket(packet, 'interface'); assert.deepEqual(packet.evidence.files.map(x => x.path), READ_PROFILES.interface)
  fs.appendFileSync(path.join(f.root, 'src/demo/assets/app.js'), '\n// dependency drift')
  await assert.rejects(f.source.read(input), /source_dirty/)
})
