'use strict'

/**
 * computerOperatorWiring.test.js — "structurally unreachable" is a claim about the module
 * graph, so it is tested against the module graph.
 *
 * A test that only checked `enabled === false` would prove the caller says no. The Owner asked
 * for something stronger: with the flag OFF, the code that can act must not be reachable at
 * all. That is checkable — `require.cache` says whether a module was ever loaded — and the
 * first test below deletes the relevant entries, builds the disabled path, and asserts they
 * are still absent afterwards.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { buildComputerOperator } = require('./computerOperatorWiring')

const ADAPTER = require.resolve('./desktopAdapter')
const EXECUTOR = require.resolve('./computerExecutor')

const fakeStore = () => ({ written: [], write (t, r) { this.written.push({ t, r }); return r } })
const fakeRunner = () => ({ run: () => ({ ok: true }) })

/** Forget the acting modules, so "was it loaded?" is a question about THIS build. */
function forgetActingModules () {
  delete require.cache[ADAPTER]
  delete require.cache[EXECUTOR]
}

/* ── flag OFF ─────────────────────────────────────────────────────────────── */

test('*** flag OFF — the acting modules are never loaded into the process ***', () => {
  forgetActingModules()
  const built = buildComputerOperator({ env: {}, artifactStore: fakeStore(), runner: fakeRunner() })

  assert.equal(built.enabled, false)
  assert.equal(built.reason, 'flag_off')
  assert.equal(built.executor, null, 'there is no executor object at all')

  // THE assertion: not "it refused", but "it was never there".
  assert.equal(require.cache[ADAPTER], undefined, 'desktopAdapter must not be loaded with the flag off')
  assert.equal(require.cache[EXECUTOR], undefined, 'computerExecutor must not be loaded with the flag off')
})

test('*** flag OFF — and every invalid flag value is off ***', () => {
  for (const COMPUTER_OPERATOR of [undefined, '', 'off', 'ON', 'On', 'yes', '1', 'true', ' on']) {
    forgetActingModules()
    const built = buildComputerOperator({ env: { COMPUTER_OPERATOR }, artifactStore: fakeStore(), runner: fakeRunner() })
    assert.equal(built.enabled, false, String(COMPUTER_OPERATOR))
    assert.equal(require.cache[ADAPTER], undefined, 'stayed unloaded for: ' + String(COMPUTER_OPERATOR))
  }
})

test('*** flag OFF — the Companion it hands back is the 3a-inert one ***', () => {
  forgetActingModules()
  const { companion } = buildComputerOperator({ env: {} })
  const res = companion.handle({
    from: 'service', to: 'companion', type: 'execute_step', approvalId: 'a', stepIndex: 0,
    stepNonce: 'nonce-wiring-flagoff-01', step: { action: 'type_text' }
  })
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'flag_off', 'refused at the gate, by a Companion holding no executor')
  assert.equal(require.cache[ADAPTER], undefined, 'and the refusal did not load anything either')
})

/* ── flag ON ──────────────────────────────────────────────────────────────── */

test('*** flag ON builds the path — and still authorises nothing ***', () => {
  const built = buildComputerOperator({
    env: { COMPUTER_OPERATOR: 'on' }, artifactStore: fakeStore(), runner: fakeRunner()
  })
  assert.equal(built.enabled, true)
  assert.ok(built.executor, 'now there is an executor')
  assert.equal(require.cache[ADAPTER] !== undefined, true, 'and the adapter is loaded — the positive control')

  // Turning the flag on is NOT permission: with an executor in hand and no order presented,
  // the Companion still refuses. Note WHICH refusal — see the next test for why it is this one
  // and not `sealed_order_required`.
  const res = built.companion.handle({
    from: 'service', to: 'companion', type: 'execute_step', approvalId: 'a', stepIndex: 0,
    stepNonce: 'nonce-wiring-flagon-002', step: { action: 'type_text' }
  })
  assert.equal(res.ok, false, 'an executor in hand is not permission to use it')
  assert.equal(built.executor.capabilities.touchesDesktop, true, 'and this one really could act')
})

test('*** the Companion reads the REAL environment — a caller cannot tell it the flag is on ***', () => {
  // Discovered by a failing test rather than designed in, and then kept: buildComputerOperator
  // takes an `env` for testability, but the Companion calls resolveComputerOperator() with no
  // argument, so it consults process.env and nothing else. That means a caller who assembles a
  // Companion with a fabricated `{ COMPUTER_OPERATOR: 'on' }` does NOT get an unlocked one.
  //
  // In production the two agree, because production's env IS process.env. The gap only exists
  // for a caller trying to fake it, which is precisely the caller who should fail.
  //
  // This test deliberately does not set process.env.COMPUTER_OPERATOR. The flag stays off for
  // the whole suite; the gate's own behaviour with flag:'on' is proven in sealedOrderGate.test.js
  // by passing the resolved value directly, with no environment involved.
  assert.notEqual(process.env.COMPUTER_OPERATOR, 'on', 'the suite runs with the flag off')

  const built = buildComputerOperator({
    env: { COMPUTER_OPERATOR: 'on' }, artifactStore: fakeStore(), runner: fakeRunner()
  })
  const res = built.companion.handle({
    from: 'service', to: 'companion', type: 'execute_step', approvalId: 'a', stepIndex: 0,
    stepNonce: 'nonce-wiring-fakeenv-01', step: { action: 'type_text' }
  })
  assert.equal(res.refusal, 'flag_off', 'the fabricated env did not reach the Companion')
})

test('*** flag ON with no audit sink refuses to build at all ***', () => {
  // Fail-closed at composition. A build with no way to record must not exist, because every
  // later stage assumes a record can be written.
  const built = buildComputerOperator({ env: { COMPUTER_OPERATOR: 'on' }, runner: fakeRunner() })
  assert.equal(built.enabled, false)
  assert.equal(built.reason, 'audit_not_configured')
  assert.equal(built.executor, null)
})

test('flag ON with no runner refuses to build', () => {
  const built = buildComputerOperator({ env: { COMPUTER_OPERATOR: 'on' }, artifactStore: fakeStore() })
  assert.equal(built.enabled, false)
  assert.equal(built.reason, 'no_runner')
  assert.equal(built.executor, null)
})

/* ── the shape of the file itself ─────────────────────────────────────────── */

test('*** the acting modules are required INSIDE the enabled branch, not at the top ***', () => {
  // The behaviour above depends on this, so it is asserted directly rather than inferred: a
  // future edit that hoists these requires to the top would keep every other test green while
  // silently loading a desktop-capable module on the disabled path.
  const src = fs.readFileSync(path.join(__dirname, 'computerOperatorWiring.js'), 'utf8')
  const lines = src.split(/\r?\n/)
  const flagReturn = lines.findIndex((l) => l.includes("reason: 'flag_off'"))
  const adapterRequire = lines.findIndex((l) => l.includes("require('./desktopAdapter')"))
  const executorRequire = lines.findIndex((l) => l.includes("require('./computerExecutor')"))

  assert.ok(flagReturn > 0, 'the disabled path exists')
  assert.ok(adapterRequire > flagReturn, 'the adapter is required AFTER the flag-off return')
  assert.ok(executorRequire > flagReturn, 'the executor is required AFTER the flag-off return')
})

test('the wiring module is the only importer of the adapter in src/', () => {
  const SRC = path.resolve(__dirname, '..')
  const importers = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!e.name.endsWith('.js') || e.name.endsWith('.test.js')) continue
      if (/require\(['"][^'"]*desktopAdapter['"]\)/.test(fs.readFileSync(p, 'utf8'))) {
        importers.push(path.relative(SRC, p).replace(/\\/g, '/'))
      }
    }
  }
  walk(SRC)
  assert.deepEqual(importers, ['computer/computerOperatorWiring.js'],
    'one door in, and it is behind the flag')
})
