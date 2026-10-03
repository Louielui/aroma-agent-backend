'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process'), { randomUUID } = require('node:crypto')
const { createTasks } = require('./service'), { FILES, TEST, createRegistry } = require('./contract'), { createMemoryRunStore } = require('../operating/runStore')
const { createSource } = require('../projectWork/source'), { createProjectWork } = require('../projectWork/service'), { createRepository } = require('../projectWork/adoptionRepository'), { validateAccepted } = require('../projectWork/adoption')
const { digest } = require('../../workers/execution/windowsSandbox')
const OWNER = { id: 'owner', role: 'owner' }
test('dynamic registration uses real committed source and readonly dependencies throughout work, adoption and rollback', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registered-task-')), git = a => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', windowsHide: true })
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); fs.rmSync(root, { recursive: true, force: true }) })
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'core.autocrlf', 'false'])
  const before = 'module.exports={value:1}\n', after = 'module.exports={value:2}\n', readonly = 'module.exports={}\n'
  for (const [n, s] of [[FILES[0], readonly], [FILES[1], before], ['unrelated.txt', 'keep']]) { fs.mkdirSync(path.dirname(path.join(root, n)), { recursive: true }); fs.writeFileSync(path.join(root, n), s) }
  git(['add', '.']); git(['commit', '-qm', 'fixture']); const head = () => git(['rev-parse', 'HEAD']).trim(); let boot = head()
  const taskStore = createMemoryRunStore(), workStore = createMemoryRunStore(), registry = createRegistry(taskStore), health = async () => ({ status: 'ok', bootCommit: boot })
  const source = createSource({ root, health, resolveRecipe: registry.resolve }), boundary = Object.fromEntries(['noExternalInterfaces', 'hostReadDenied', 'hostWriteDenied', 'readonlyInputDenied', 'readonlyToolsDenied', 'loopbackDenied', 'ipv6LoopbackDenied', 'internetDenied', 'cleanIdentity', 'secretsAbsent'].map(k => [k, true]))
  const tests = passed => ({ total: 3, passed, failed: 3 - passed, skipped: 0, cancelled: 0, exitCode: passed === 3 ? 0 : 1, engine: 'windows-sandbox-offline-v1', boundary })
  let isolated, invoked = 0
  const providers = { isolation: async () => ({ ready: true }), status: async () => ({ codex: { ready: true }, claude: { ready: true } }), codeOrder: async ({ order }) => {
    invoked++; const changes = [{ file: FILES[1], before, after, beforeHash: digest(before), afterHash: digest(after) }], result = { model: 'gpt-6.1-sol', effort: 'high', billing: 'chatgpt-subscription', execution: 'windows_sandbox_offline', changedFiles: [FILES[1]], changes, patchHash: digest(JSON.stringify(changes)), baseline: tests(1), tests: tests(3), isolatedRunId: randomUUID(), appliedToLive: false }
    isolated = { id: result.isolatedRunId, state: 'accepted_isolated', workOrder: order, changes, patchHash: result.patchHash, baseline: result.baseline, tests: result.tests, effort: 'high' }; return result
  }, reviewOrder: async () => ({ verdict: 'pass', billing: 'claude-subscription' }) }
  const work = createProjectWork({ source, providers, store: workStore, enabled: () => true, resolveRecipe: registry.resolve, catalogueRecipes: registry.catalogue })
  const generated = { testCode: "const test=require('node:test'),assert=require('node:assert/strict');test('new behavior',()=>assert.equal(require('../src/context/toolGateway.js').value,2));test('dependency',()=>assert.deepEqual(require('../src/context/contextResult.js'),{}));test('preserved',()=>assert.ok(true));", expectedTests: 3 }
  const tasks = createTasks({ store: taskStore, enabled: () => true, sourceFor: d => createSource({ root, health, resolveRecipe: () => d }), provider: { preflight: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }), complete: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify(generated) }) }, review: async () => ({ verdict: 'pass', billing: 'claude-subscription' }), prepareWork: input => work.prepare(OWNER, input) })
  const input = { bootCommit: boot, requestId: randomUUID(), goal: 'Expose new value', criteria: ['value equals 2'], editable: [FILES[1]] }
  const d = tasks.start(OWNER, input); await tasks.settled(); const v = tasks.get(OWNER, d.run.id)
  const recipe = v.run.registration.workOrder.recipe
  await assert.rejects(work.prepare(OWNER, { projectId: 'aroma-agent-backend', bootCommit: boot, recipe, requestId: randomUUID() }), /invalid_request/)
  await tasks.approve(OWNER, { id: v.run.id, hash: v.approval.hash, nonce: v.approval.nonce }); const p = await tasks.prepare(OWNER, { id: v.run.id, requestId: randomUUID() })
  assert.equal(invoked, 0); assert.deepEqual(p.work.run.workOrder.readonlyFiles, [FILES[0]])
  work.approve(OWNER, { id: p.work.approval.id, hash: p.work.approval.hash, nonce: p.work.approval.nonce }); await work.settled(); const acceptedRun = work.get(OWNER, p.work.run.id)
  assert.equal(acceptedRun.state, 'completed'); const accepted = validateAccepted(acceptedRun, isolated, registry.resolve)
  assert.deepEqual(accepted.dependencies, { [FILES[0]]: readonly })
  const changed = structuredClone(isolated); changed.workOrder.files[TEST] += ' '; assert.throws(() => validateAccepted(acceptedRun, changed, registry.resolve), /accepted_evidence_changed/)
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'pending outside'); fs.writeFileSync(path.join(root, 'untracked.txt'), 'pending untracked')
  const repository = createRepository({ root, source, resolveRecipe: registry.resolve })
  const snapshot = await source.read(boot, undefined, recipe); await repository.apply({ snapshot, before: accepted.before, after: accepted.after, id: randomUUID(), action: 'adopt' }); boot = head()
  assert.equal(fs.readFileSync(path.join(root, FILES[1]), 'utf8'), after); assert.equal(fs.readFileSync(path.join(root, FILES[0]), 'utf8'), readonly)
  await assert.rejects(work.prepare(OWNER, { projectId: 'aroma-agent-backend', bootCommit: boot, recipe, requestId: randomUUID() }), /source_changed/)
  await repository.apply({ snapshot: await source.read(boot, undefined, recipe), before: accepted.after, after: accepted.before, id: randomUUID(), action: 'rollback' }); boot = head()
  assert.equal(fs.readFileSync(path.join(root, FILES[1]), 'utf8'), before); assert.equal(fs.readFileSync(path.join(root, 'unrelated.txt'), 'utf8'), 'pending outside'); assert.equal(fs.readFileSync(path.join(root, 'untracked.txt'), 'utf8'), 'pending untracked')
})
