'use strict'

/**
 * companionProductionFactory.test.js — G1 wiring, and the no-bypass claim.
 *
 * The claim these tests exist for is a claim about the MODULE GRAPH, not about behaviour: the
 * executor and the adapter must be reachable only from the Companion side. Behaviour tests can
 * pass while a second door exists; only a graph check finds the door.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { buildCompanionExecution } = require('./companionProductionFactory')

const SRC = path.resolve(__dirname, '..')
const REPO = path.resolve(__dirname, '..', '..')
const SCRIPTS = path.join(REPO, 'scripts', 'computer')

const fakeStore = () => ({ w: [], write (t, r) { this.w.push({ t, kind: r.kind }); return r } })
const fakeRunner = () => ({ calls: [], run (id, payload) { this.calls.push({ id, payload }); return { ok: true, result: { ok: true } } } })

/* ── one runner, shared ───────────────────────────────────────────────────── */

test('*** the machine probe and the desktop adapter share ONE runner instance ***', () => {
  // Two launchers had already drifted apart once, and both were broken in ways only a real run
  // exposed. Sharing is the fix, so it is asserted rather than assumed: the same fake receives
  // calls from both consumers.
  const runner = fakeRunner()
  const built = buildCompanionExecution({ artifactStore: fakeStore(), runner })
  assert.equal(built.ok, true)

  built.machine.notepadCount()
  assert.equal(runner.calls.length, 1)
  assert.equal(runner.calls[0].id, 'machine-probe', 'the probe uses a script ID, never a path')

  try { built.desktop.openApp({ appId: 'notepad' }) } catch (_) { /* the fake returns no binding */ }
  assert.equal(runner.calls.length, 2, 'the SAME runner received the adapter call')
  assert.equal(runner.calls[1].id, 'uia-canary', 'the adapter uses a script ID, never a path')
})

test('*** no audit sink, no build ***', () => {
  for (const deps of [{}, { artifactStore: null }, { artifactStore: {} }, { artifactStore: { write: 'no' } }]) {
    const b = buildCompanionExecution(deps)
    assert.equal(b.ok, false)
    assert.equal(b.reason, 'audit_not_configured')
    assert.equal(b.executor, undefined, 'nothing capable is returned')
  }
})

test('the executor it returns is a real one, holding the shared adapter', () => {
  const built = buildCompanionExecution({ artifactStore: fakeStore(), runner: fakeRunner() })
  assert.equal(typeof built.executor.execute, 'function')
  assert.equal(built.executor.capabilities.touchesDesktop, true, 'it has an adapter')
  assert.ok(built.registry, 'and its own registry — not the planner\'s')
})

/* ── no bypass: the module graph, not the behaviour ───────────────────────── */

function importersOf (moduleName) {
  const hits = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!e.name.endsWith('.js') || e.name.endsWith('.test.js')) continue
      const code = fs.readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      if (new RegExp("require\\(['\"][^'\"]*" + moduleName + "['\"]\\)").test(code)) {
        hits.push(path.relative(REPO, p).split(path.sep).join('/'))
      }
    }
  }
  walk(SRC)
  walk(SCRIPTS)
  return hits.sort()
}

test('*** the desktop adapter has exactly ONE production importer ***', () => {
  assert.deepEqual(importersOf('desktopAdapter'), ['src/computer/companionProductionFactory.js'],
    'one door in, and it is on the Companion side')
})

test('*** the executor has exactly ONE production importer ***', () => {
  assert.deepEqual(importersOf('computerExecutor'), ['src/computer/companionProductionFactory.js'],
    'the executor is created on the Companion side and nowhere else')
})

test('*** the PowerShell transport has exactly ONE production importer ***', () => {
  assert.deepEqual(importersOf('powershellJsonRunner'), ['src/computer/companionProductionFactory.js'])
})

test('*** the Owner screen reaches none of it ***', () => {
  const owner = fs.readFileSync(path.join(SCRIPTS, 'Owner-Execute.ps1'), 'utf8').replace(/^\s*#.*$/gm, '')
  for (const banned of [
    'computerExecutor', 'desktopAdapter', 'uiaCanary', 'executor.execute',
    'powershellJsonRunner', 'companionProductionFactory', 'machineProbe'
  ]) {
    assert.equal(owner.includes(banned), false, 'Owner-Execute must not reach: ' + banned)
  }
})

test('*** the factory itself is Companion-only — it never reads the Owner path ***', () => {
  const code = fs.readFileSync(path.join(__dirname, 'companionProductionFactory.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const banned of ['ownerApproval', 'Owner-Execute', 'Owner-Approve', 'readline', 'process.stdin']) {
    assert.equal(code.includes(banned), false, 'the factory must not touch the Owner side: ' + banned)
  }
})

/* ── the shape of the assembly ────────────────────────────────────────────── */

test('*** buildCompanionExecution creates its parts exactly once per call ***', () => {
  const runner = fakeRunner()
  const built = buildCompanionExecution({ artifactStore: fakeStore(), runner })
  const again = buildCompanionExecution({ artifactStore: fakeStore(), runner })
  assert.notEqual(built.executor, again.executor, 'each call is its own assembly')
  assert.notEqual(built.registry, again.registry, 'and its own registry — no shared live slot')
  // But WITHIN one assembly the runner is the single shared object.
  assert.equal(built.machine !== undefined && built.desktop !== undefined, true)
})

test('the registry is the executor\'s own, not the planner\'s', () => {
  const { createComputerSupervisor } = require('./computerSupervisor')
  const sup = createComputerSupervisor({ artifactStore: fakeStore(), now: () => 1 })
  const built = buildCompanionExecution({ artifactStore: fakeStore(), runner: fakeRunner() })
  assert.notEqual(built.registry, sup.orderRegistry, 'a dry-run must not occupy the desktop slot')

  // A live plan cannot block a real run.
  sup.orderRegistry.admit({ approvalId: 'appr_plan', workOrderHash: 'h', stepCount: 1, timeoutSec: 60 })
  assert.equal(built.registry.admit({ approvalId: 'appr_real', workOrderHash: 'h', stepCount: 1, timeoutSec: 60 }).ok, true)
})
