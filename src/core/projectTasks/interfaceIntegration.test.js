'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process'), { randomUUID } = require('node:crypto')
const { createTasks } = require('./service'), { INTERFACE_FILES: FILES, TEST, createRegistry } = require('./contract'), { createMemoryRunStore } = require('../operating/runStore')
const { createSource } = require('../projectWork/source'), { createProjectWork } = require('../projectWork/service'), { createRepository } = require('../projectWork/adoptionRepository'), { validateAccepted } = require('../projectWork/adoption')
const { createIsolatedCoding } = require('../../workers/execution/isolatedCoding'), { digest, validatePackage } = require('../../workers/execution/windowsSandbox')
const OWNER = { id: 'owner', role: 'owner' }
test('CSS task carries immutable JS and protected tests through registration, isolated coding, adoption and rollback', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'interface-task-')), git = a => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', windowsHide: true })
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); fs.rmSync(root, { recursive: true, force: true }) })
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'core.autocrlf', 'false'])
  const readonly = fs.readFileSync(path.join(__dirname, '../../demo/assets/sidebar.js'), 'utf8').replace(/\r\n/g, '\n'), before = '.sidebar-group { color: red; }\n', after = '.sidebar-group { color: var(--ink); }\n'
  for (const [name, content] of [[FILES[0], readonly], [FILES[1], before], ['outside.txt', 'preserve']]) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), content) }
  git(['add', '.']); git(['commit', '-qm', 'fixture']); const head = () => git(['rev-parse', 'HEAD']).trim(); let boot = head()
  const taskStore = createMemoryRunStore(), workStore = createMemoryRunStore(), registry = createRegistry(taskStore), health = async () => ({ status: 'ok', bootCommit: boot })
  const source = createSource({ root, health, resolveRecipe: registry.resolve }), boundary = Object.fromEntries(['noExternalInterfaces', 'hostReadDenied', 'hostWriteDenied', 'readonlyInputDenied', 'readonlyToolsDenied', 'loopbackDenied', 'ipv6LoopbackDenied', 'internetDenied', 'cleanIdentity', 'secretsAbsent'].map(k => [k, true]))
  const receipt = passed => ({ total: 3, passed, failed: 3 - passed, skipped: 0, cancelled: 0, exitCode: passed === 3 ? 0 : 1, engine: 'windows-sandbox-offline-v1', boundary })
  const generated = { testCode: "const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');test('theme',()=>assert.match(fs.readFileSync(require('node:path').join(__dirname,'../src/demo/assets/sidebar.css'),'utf8'),/var\\(--ink\\)/));test('JS contract',()=>assert.equal(typeof require('../src/demo/assets/sidebar').mount,'function'));test('preserved CSS selector',()=>assert.ok(true));", expectedTests: 3 }
  let isolated, drafts = 0, coding = 0, reviews = 0; const packs = []
  // This executor is a deterministic fixture, never reported as OS evidence.
  const executor = { isBusy: () => false, readiness: async () => ({ ready: true }), run: async p => { validatePackage(p); packs.push(structuredClone(p)); return receipt(p.files[FILES[1]] === after ? 3 : 2) } }
  const coder = createIsolatedCoding({ root: path.join(root, 'receipts'), executor, provider: {
    preflight: async () => {},
    complete: async () => { coding++; return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ changes: [{ file: FILES[1], content: after }], summary: 'Theme tokens' }) } }
  } })
  const providers = { isolation: executor.readiness, status: async () => ({ codex: { ready: true }, claude: { ready: true } }), codeOrder: async ({ order }) => {
    isolated = await coder.execute({ actor: 'owner', approval: coder.prepare(order, 'owner') })
    return { ...isolated, execution: 'windows_sandbox_offline', changedFiles: isolated.changes.map(c => c.file), isolatedRunId: isolated.id }
  }, reviewOrder: async () => { reviews++; return { verdict: 'pass', billing: 'claude-subscription' } } }
  const work = createProjectWork({ source, providers, store: workStore, enabled: () => true, resolveRecipe: registry.resolve, catalogueRecipes: registry.catalogue })
  const tasks = createTasks({ store: taskStore, enabled: () => true, sourceFor: d => createSource({ root, health, resolveRecipe: () => d }), provider: { preflight: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }), complete: async (prompt, options) => { drafts++; assert.match(options.system, /sidebar/); assert.deepEqual(Object.keys(JSON.parse(prompt).files), FILES); return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify(generated) } } }, review: async () => ({ verdict: 'pass', billing: 'claude-subscription' }), prepareWork: i => work.prepare(OWNER, i) })
  const input = { bootCommit: boot, requestId: randomUUID(), goal: 'Use theme tokens', criteria: ['Sidebar CSS uses the ink token'], editable: [FILES[1]] }, started = tasks.start(OWNER, input)
  await tasks.settled(); const v = tasks.get(OWNER, started.run.id); assert.equal(v.run.state, 'awaiting_approval'); assert.equal(drafts, 1); assert.equal(coding, 0)
  await assert.rejects(work.prepare(OWNER, { projectId: 'aroma-agent-backend', recipe: v.run.registration.workOrder.recipe, bootCommit: boot, requestId: randomUUID() }), /invalid_request/)
  await tasks.approve(OWNER, { id: v.run.id, hash: v.approval.hash, nonce: v.approval.nonce })
  const p = await tasks.prepare(OWNER, { id: v.run.id, requestId: randomUUID() }); assert.equal(coding, 0)
  work.approve(OWNER, { id: p.work.run.id, hash: p.work.approval.hash, nonce: p.work.approval.nonce }); await work.settled()
  const r = work.get(OWNER, p.work.run.id); assert.equal(r.state, 'completed'); assert.equal(coding, 1); assert.equal(reviews, 1)
  assert.equal(packs.length, 2); assert.equal(packs[0].files[FILES[0]], readonly); assert.equal(packs[1].files[FILES[0]], readonly); assert.equal(packs[0].files[TEST], packs[1].files[TEST])
  const accepted = validateAccepted(r, isolated, registry.resolve); assert.deepEqual(accepted.dependencies, { [FILES[0]]: readonly })
  fs.writeFileSync(path.join(root, 'outside.txt'), 'pending outside')
  const repository = createRepository({ root, source, resolveRecipe: registry.resolve }), recipe = r.workOrder.recipe
  const change = await repository.apply({ snapshot: await source.read(boot, undefined, recipe), before: accepted.before, after: accepted.after, id: randomUUID(), action: 'adopt' }); boot = head()
  assert.equal(change.files[0].file, FILES[1]); assert.equal(change.files[0].afterHash, digest(after)); assert.equal(fs.readFileSync(path.join(root, FILES[0]), 'utf8'), readonly)
  await repository.verifyLoaded({ source: r.source, commit: boot, after: accepted.after, change })
  await repository.apply({ snapshot: await source.read(boot, undefined, recipe), before: accepted.after, after: accepted.before, id: randomUUID(), action: 'rollback' }); boot = head()
  assert.equal(fs.readFileSync(path.join(root, FILES[1]), 'utf8'), before); assert.equal(fs.readFileSync(path.join(root, 'outside.txt'), 'utf8'), 'pending outside')
})
