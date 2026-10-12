'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process')
const { FILES, digest } = require('./contract'), { createCodeSource } = require('./source')
function fixture (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnosis-source-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=' + path.join(root, 'no-hooks'), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { windowsHide: true, encoding: 'utf8' }).trim()
  git(['init', '-q'])
  for (const file of FILES) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'module.exports = 1\n') }
  git(['add', '.']); git(['commit', '-qm', 'fixture'])
  const bootCommit = git(['rev-parse', 'HEAD']); return { root, git, source: createCodeSource({ root, env: { READ_ACCESS: 'on' }, bootCommit }) }
}
test('reads only exact committed fixed blobs; never uncommitted files, outside paths or credentials', async t => {
  const h = fixture(t); fs.writeFileSync(path.join(h.root, '.env'), 'PRIVATE_CREDENTIAL_CANARY'); fs.writeFileSync(path.join(h.root, FILES[0]), 'UNCOMMITTED_PRIVATE_CANARY')
  const packet = await h.source.read({ id: 'owner', role: 'owner' })
  assert.equal(packet.evidence.files.length, 8); assert.equal(packet.evidence.files[0].content, 'module.exports = 1\n'); assert.equal(packet.evidence.files[0].sha256, digest('module.exports = 1\n'))
  assert.equal(packet.hash, digest(JSON.stringify(packet.evidence))); assert.doesNotMatch(JSON.stringify(packet), /PRIVATE_CANARY|PRIVATE_CREDENTIAL/)
  assert.equal((await h.source.read({ id: 'owner', role: 'owner' })).hash, packet.hash)
})
test('Owner permission and read-access switch fail before Git is invoked', async () => {
  let reads = 0; const source = createCodeSource({ env: { READ_ACCESS: 'off' }, bootCommit: 'a'.repeat(40), readGit: async () => { reads++; throw Error() } })
  await assert.rejects(source.read({ id: 'owner', role: 'owner' }), /read_access_disabled/); await assert.rejects(source.read({ id: 'ivy', role: 'owner' }), /permission_denied/); assert.equal(reads, 0)
})
test('credential-looking committed content refuses the packet; it is not redacted into misleading evidence', async t => {
  const h = fixture(t); fs.writeFileSync(path.join(h.root, FILES[0]), 'const secret="sk-proj-' + 'x'.repeat(40) + '"\n'); h.git(['add', '.']); h.git(['commit', '-qm', 'secret fixture'])
  await assert.rejects(h.source.read({ id: 'owner', role: 'owner' }), /source_sensitive/)
})
test('oversized committed source and moving revisions fail closed', async t => {
  const h = fixture(t); fs.writeFileSync(path.join(h.root, FILES[0]), 'x'.repeat(70001)); h.git(['add', '.']); h.git(['commit', '-qm', 'large fixture'])
  await assert.rejects(h.source.read({ id: 'owner', role: 'owner' }), /context_unavailable/)
})
