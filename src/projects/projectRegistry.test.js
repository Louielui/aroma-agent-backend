'use strict'

/**
 * projectRegistry.test.js — which projects exist, and that knowing is not permission.
 *
 * ⛔ THE PROPERTY THAT MATTERS MOST HERE IS A NEGATIVE ONE: this registry must not be able to
 * cause execution. Aroma System appearing in it is a fact about the world, not a grant. The
 * Agent Bridge is bound to one repository by app.js at construction, and these tests pin that
 * this file is nowhere near that decision.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const registry = require('./projectRegistry')

/**
 * ⛔ CODE ONLY. Scanning the raw file made three of these tests fail on their own subject's
 * COMMENTS — the header explains that it holds no local path and is not `targetProject`, and
 * naming a thing to forbid it counted as doing it. A check that reads prose instead of
 * behaviour is the failure mode this repository keeps finding; it is fixed here rather than
 * loosened by dropping the assertions.
 */
const codeOf = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

const SRC = codeOf(fs.readFileSync(path.join(__dirname, 'projectRegistry.js'), 'utf8'))

test('*** the two known projects resolve exactly ***', () => {
  const backend = registry.getProject('aroma-agent-backend')
  assert.equal(backend.repoFullName, 'Louielui/aroma-agent-backend')
  assert.equal(backend.defaultBranch, 'main')
  assert.equal(backend.status, registry.REGISTRATION.REGISTERED)

  const system = registry.getProject('aroma-system')
  assert.equal(system.repoFullName, 'Louielui/aroma-system')
  assert.equal(system.label, 'Aroma System')
  assert.equal(registry.listProjects().length, 2)
})

test('*** ⛔ AN UNKNOWN projectId IS NULL — NEVER A FALLBACK ***', () => {
  /**
   * ⛔ The dangerous failure is not throwing, it is answering. If an unknown id quietly
   * resolved to the first project, every later 「which repo?」 question would be answered
   * 「the backend」 — confidently, and wrongly.
   */
  for (const bad of ['nope', '', null, undefined, 0, {}, [], 'AROMA-SYSTEM', ' aroma-system']) {
    assert.equal(registry.getProject(bad), null, '⛔ resolved: ' + JSON.stringify(bad))
    assert.equal(registry.isKnownProject(bad), false)
  }
})

test('*** ⛔ NO RUNTIME REGISTRATION — A CALLER CANNOT ADD A PROJECT ***', () => {
  assert.deepEqual(Object.keys(registry).sort(),
    ['REGISTRATION', 'getProject', 'isKnownProject', 'listProjects'].sort(),
    '⛔ the module gained an export — check it is not a mutator')
  for (const name of ['register', 'add', 'set', 'upsert', 'define', 'load']) {
    assert.equal(name in registry, false, '⛔ a runtime registration seam appeared: ' + name)
  }
  // Frozen all the way down, so a caller cannot mutate what it was handed.
  const list = registry.listProjects()
  assert.equal(Object.isFrozen(list), true)
  assert.equal(Object.isFrozen(list[0]), true)
  assert.throws(() => { list.push({ projectId: 'x' }) }, 'the list itself cannot be extended')
  const before = registry.getProject('aroma-system').repoFullName
  try { registry.getProject('aroma-system').repoFullName = 'attacker/repo' } catch (_) { /* frozen */ }
  assert.equal(registry.getProject('aroma-system').repoFullName, before, '⛔ a record was mutable')
})

test('*** ⛔ NO LOCAL PATH IS RECORDED — IT CANNOT BECOME AN EXECUTION ROOT ***', () => {
  /**
   * ⛔ A checked-in developer path is one refactor from being passed to a workspace. It is
   * also a production dependency on one machine's folders. Neither is acceptable in a tranche
   * whose whole promise is 「truth, no new authority」.
   */
  for (const banned of ['C:\\\\Users', 'C:/Users', 'localRoot', 'repoRoot', 'Projects\\\\aroma-system', 'homedir', '__dirname']) {
    assert.equal(new RegExp(banned).test(SRC), false, '⛔ the registry names a local path or root: ' + banned)
  }
  for (const p of registry.listProjects()) {
    assert.deepEqual(Object.keys(p).sort(),
      ['defaultBranch', 'label', 'projectId', 'repoFullName', 'status'].sort(),
      '⛔ a field appeared on a project record: ' + JSON.stringify(Object.keys(p)))
  }
})

/**
 * ⛔ RB1 NARROWED THIS FENCE ON PURPOSE — AND THE NARROWING IS THE WHOLE TRANCHE.
 *
 * b2a asserted that NO execution-path file may import `projects/`, because at that point
 * the registry carried no meaning and any consumption of it would have been the beginning
 * of an authority it was not supposed to have.
 *
 * RB1 gives it exactly one meaning and takes it deliberately: the execution path now reads
 * repository IDENTITY (a projectId and an owner/name) so that the repository the Owner
 * approved is inside the hash, on his card, on the Run and in the audit. Before RB1 the
 * card named no repository at all, and 「改 aroma-system 個 README.md」 sealed against the
 * backend's own README.md — a wrong-repository execution the Owner could not have caught
 * by reading carefully.
 *
 * What the fence protects has therefore MOVED, not weakened. Identity may cross; a ROOT may
 * not. The registry still cannot reach the world, still holds no path, and nothing in
 * `projects/` may hand execution a place on this machine — which is now asserted for the
 * whole directory rather than for one file, because RB1 added a second module to it.
 */
test('*** ⛔ THE REGISTRY CANNOT REACH THE WORLD, AND projects/ CANNOT HAND OUT A ROOT ***', () => {
  const requires = [...SRC.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  assert.deepEqual(requires, [], '⛔ the registry gained an import: ' + JSON.stringify(requires))
  assert.equal(/process\.env/.test(SRC), false, '⛔ the registry reads an environment flag')
  assert.equal(/require\(|child_process|fs\.|fetch\(/.test(SRC), false, '⛔ the registry can reach the world')

  // EVERY module in projects/ — the new identity policy included — must be root-free and
  // unable to touch a filesystem, a process or a network.
  for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))) {
    const s = codeOf(fs.readFileSync(path.join(__dirname, f), 'utf8'))
    for (const banned of ['repoRoot', 'localRoot', '__dirname', 'homedir', 'process\\.cwd', 'child_process', 'fetch\\(', 'fs\\.']) {
      assert.equal(new RegExp(banned).test(s), false, '⛔ projects/' + f + ' can reach a machine: ' + banned)
    }
    assert.equal(/[A-Za-z]:[\\/]/.test(s), false, '⛔ projects/' + f + ' contains a Windows path')
    assert.equal(/function (register|addProject|setProject)\b/.test(s), false,
      '⛔ projects/' + f + ' gained a runtime registration API')
  }

  // The execution path may consume IDENTITY. It must never obtain a ROOT from projects/.
  const root = path.join(__dirname, '..')
  for (const f of [
    'app.js', 'agent/agentRunner.js', 'agent/featureBranchWorkspace.js', 'agent/confirmService.js',
    'agent/workOrder.js', 'agent/workOrderProducer.js', 'agent/agentBridgeWorker.js',
    'agent/agentAuthorization.js', 'run/store.js', 'capability/dispatcher.js'
  ]) {
    const s = codeOf(fs.readFileSync(path.join(root, f), 'utf8'))
    assert.equal(/repoRoot\s*[:=]\s*[^,)\n]*projects\//.test(s), false,
      '⛔ AN EXECUTION ROOT NOW COMES FROM projects/: ' + f)
    assert.equal(/require\(['"][^'"]*projects\/targetCatalogue['"]\)/.test(s), false,
      '⛔ the execution path consumes the target CATALOGUE: ' + f)
  }

  // Two files still have no business knowing a repository exists at all: the isolation
  // brake and the bounded worker take what they are given and decide nothing.
  for (const f of ['agent/featureBranchWorkspace.js', 'agent/agentBridgeWorker.js']) {
    const s = codeOf(fs.readFileSync(path.join(root, f), 'utf8'))
    assert.equal(/projects\//.test(s), false, '⛔ ' + f + ' started consulting projects/')
  }
})

test('*** ⛔ IT IS NOT THE LANE-1 targetProject CONCEPT ***', () => {
  // 'backend'/'frontend' selects a develop script inside one project. Overloading it as a
  // repository identity would merge two different authority paths into one ambiguous word.
  const ids = registry.listProjects().map((p) => p.projectId)
  assert.equal(ids.includes('backend'), false)
  assert.equal(ids.includes('frontend'), false)
  assert.equal(/targetProject/.test(SRC), false, '⛔ the registry references targetProject')
})
