'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

test('service identity seals the bound repository while unrelated ownership remains untrusted and dirty targets are refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiangxiang-service-revision-'))
  const emptyConfig = path.join(root, 'empty-git-config'); fs.writeFileSync(emptyConfig, '')
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig }
  const git = (...args) => execFileSync('git', args, { cwd: root, env, windowsHide: true, encoding: 'utf8' })
  try {
    git('init', '--quiet'); fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/example.js'), 'module.exports = 1\n')
    git('add', '--', 'src/example.js'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture')
    const head = git('rev-parse', 'HEAD').trim()
    const foreign = { ...env, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' }
    const raw = () => spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, env: foreign, windowsHide: true, encoding: 'utf8' })
    assert.notEqual(raw().status, 0, 'The fixture must reproduce the service ownership refusal')
    const child = spawnSync(process.execPath, ['-e', `
      const fs = require('node:fs'), path = require('node:path')
      const { proposeWorkOrder } = require(process.argv[1])
      const input = { repoRoot: process.argv[2], repositoryIdentity: { projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' }, proposal: { goal: 'Read the approved source', candidateFile: 'src/example.js', taskKind: 'read_only_enquiry' }, conversation: ['src/example.js'] }
      const clean = proposeWorkOrder(input)
      fs.appendFileSync(path.join(input.repoRoot, 'src/example.js'), String.fromCharCode(10) + '// uncommitted')
      const dirty = proposeWorkOrder(input)
      process.stdout.write(JSON.stringify({ clean, dirty }))
    `, require.resolve('./workOrderProducer'), root], { env: foreign, windowsHide: true, encoding: 'utf8' })
    assert.equal(child.status, 0, child.stderr)
    const result = JSON.parse(child.stdout)
    assert.equal(result.clean.ok, true, JSON.stringify(result.clean.errors))
    assert.equal(result.clean.workOrder.expectedSha, head)
    assert.equal(result.clean.workOrder.taskKind, 'read_only_enquiry')
    assert.equal(result.dirty.ok, false); assert.ok(result.dirty.errors.length)
    assert.notEqual(raw().status, 0, 'No persistent or global trust setting may be changed')
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
    fs.rmSync(root, { recursive: true, force: true })
  }
})
