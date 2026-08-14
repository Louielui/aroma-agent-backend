'use strict'

/**
 * observationBoundary.test.js — Phase 3b, Lock 1 and the observation guard.
 *
 * phase3aInert.test.js governs the Companion. This file governs the module the Companion
 * now delegates to, so the ground given up there is taken back here: observation.js may
 * look, and must remain structurally incapable of acting or of handing raw content to
 * anything that could put it in a prompt.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const DIR = __dirname
const SRC = path.resolve(DIR, '..')

const codeOf = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

/* ── the observer cannot act ──────────────────────────────────────────────── */

test('*** observation.js cannot synthesise input, touch disk, or start a process ***', () => {
  const code = codeOf('observation.js')

  // CALL-shaped, matched as `name(` or `.name(` — a name inside a closed enum is not a call.
  for (const call of [
    'mouseMove', 'mouseClick', 'keyTap', 'sendKeys', 'SendKeys', 'SendInput', 'SetCursorPos',
    'spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'fork',
    'writeFile', 'writeFileSync', 'appendFile', 'unlink', 'mkdir', 'rename', 'copyFile'
  ]) {
    const re = new RegExp('(^|[^\\w$])\\.?' + call + '\\s*\\(')
    assert.equal(re.test(code), false, 'observation must not call: ' + call)
  }

  for (const api of ['mouse_event', 'keybd_event', 'ShellExecute', 'CreateProcess', 'child_process']) {
    assert.equal(code.includes(api), false, 'observation must not reference: ' + api)
  }
})

test('*** the observation action set is closed, and input actions are not in it ***', () => {
  const { OBSERVATION_ACTIONS, FORBIDDEN_ACTIONS } = require('./observation')
  assert.deepEqual([...OBSERVATION_ACTIONS], ['list_windows', 'read_uia_tree', 'capture_screen'])
  for (const bad of FORBIDDEN_ACTIONS) {
    assert.equal(OBSERVATION_ACTIONS.includes(bad), false, 'must never become an observation action: ' + bad)
  }
  // input synthesis by name, whatever the forbidden list happens to contain. `send_key`
  // became `send_keys` when the register and the gate were unified onto one spelling.
  for (const bad of ['click', 'type_text', 'send_keys', 'move_mouse', 'open_app']) {
    assert.equal(FORBIDDEN_ACTIONS.includes(bad), true, 'forbidden list must name: ' + bad)
  }

  // And the split is the right way round: the never-list is not quietly empty, and no name
  // appears on both sides of it.
  const { NEVER_ACTIONS, SEALED_ORDER_ACTIONS } = require('./observation')
  assert.ok(NEVER_ACTIONS.length >= 10, 'the never-list still has teeth')
  for (const a of SEALED_ORDER_ACTIONS) {
    assert.equal(NEVER_ACTIONS.includes(a), false, 'a name cannot be both unlockable and never: ' + a)
  }
  for (const mustNeverBeUnlockable of ['move_mouse', 'click', 'set_clipboard', 'write_file', 'network']) {
    assert.equal(NEVER_ACTIONS.includes(mustNeverBeUnlockable), true, 'must stay absolute: ' + mustNeverBeUnlockable)
    assert.equal(SEALED_ORDER_ACTIONS.includes(mustNeverBeUnlockable), false)
  }
})

/* ── stage 1: still zero capability ───────────────────────────────────────── */

test('*** stage 1 — every observation capability is declared and OFF ***', () => {
  const { OBSERVATION_CAPABILITIES, anyObservationEnabled, createObserver } = require('./observation')
  assert.equal(anyObservationEnabled(), false, 'stage 1: nothing is enabled')
  for (const k of ['list_windows', 'read_uia_tree', 'capture_screen']) {
    assert.equal(OBSERVATION_CAPABILITIES[k], false, 'still off: ' + k)
  }
  // and a caller cannot switch one on from outside
  const o = createObserver({ capabilities: { list_windows: true, read_uia_tree: true, capture_screen: true } })
  assert.equal(o.capabilities.list_windows, false, 'capabilities cannot be widened by a caller')
  for (const a of ['list_windows', 'read_uia_tree', 'capture_screen']) {
    const r = o.observe({ action: a })
    assert.equal(r.ok, false)
    assert.equal(r.refusal, 'no_capability_enabled', a + ' refuses, naming the missing capability')
  }
})

test('anything outside the closed set is refused as out of scope, not attempted', () => {
  const { createObserver } = require('./observation')
  const o = createObserver()
  for (const a of ['click', 'write_file', null, 42]) {
    const r = o.observe({ action: a })
    assert.equal(r.ok, false)
    assert.equal(r.refusal, 'action_not_in_observation_set', 'out of scope: ' + String(a))
  }
})

test('*** a gated action reaching the OBSERVER is refused, order or no order ***', () => {
  // The four names became unlockable on 2026-07-31 — but not here. Observation reads; it has
  // no way to act and never acquires one. A sealed order does not change that, and this test
  // exists so nobody later "completes" the unlock by teaching the observer to type.
  const { createObserver, SEALED_ORDER_ACTIONS, NOT_OBSERVATION } = require('./observation')
  const o = createObserver()
  assert.ok(SEALED_ORDER_ACTIONS.includes('type_text'))
  assert.ok(SEALED_ORDER_ACTIONS.includes('open_app'))
  for (const a of SEALED_ORDER_ACTIONS) {
    const r = o.observe({ action: a })
    assert.equal(r.ok, false, 'refused: ' + a)
    assert.equal(r.refusal, NOT_OBSERVATION, 'and named as a routing error, not a permission one')
  }
})

/* ── LOCK 1a — no path from observation to any model surface ──────────────── */

test('*** LOCK 1a — observation.js imports one inert sibling, and nothing else ***', () => {
  // Was `[]`. It is now exactly one entry, and the entry is the gate: a module whose only
  // import is node:crypto and which computes and compares without acting. Asserted as an
  // exact list rather than a maximum, so a second import is a failing test.
  const imports = [...codeOf('observation.js').matchAll(/require\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual(imports, ['./sealedOrderGate'], 'the observation boundary imports only the gate')

  const gateImports = [...codeOf('sealedOrderGate.js').matchAll(/require\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual(gateImports, ['node:crypto'], 'and the gate itself reaches nothing')
})

test('*** LOCK 1b — the observation return path never calls prompt assembly ***', () => {
  // Reverse direction: names that only exist on the model side must not appear in the
  // observation module or in the Companion that returns its results.
  const surfaces = [
    'intakeService', 'distillPrompt', 'contextCard', 'readContext', 'modelRouter',
    'recordLLMUsage', 'buildPrompt', 'assemblePrompt', 'persona', 'adapters'
  ]
  for (const f of ['observation.js', 'companion.js']) {
    const code = codeOf(f)
    for (const s of surfaces) {
      assert.equal(code.includes(s), false, f + ' must not reference the model surface: ' + s)
    }
  }
})

test('*** LOCK 1 — a result can only carry declared, non-raw fields ***', () => {
  const { RESULT_FIELDS, createObserver } = require('./observation')
  // The shape is the guarantee: there is no field for pixels or UI text to travel in.
  for (const banned of ['imageBytes', 'buffer', 'pixels', 'screenshot', 'uiaText', 'text', 'nodes', 'innerText']) {
    assert.equal(RESULT_FIELDS.includes(banned), false, 'result must have no field for raw content: ' + banned)
  }
  assert.equal(RESULT_FIELDS.includes('evidenceSha256'), true, 'images come back as a hash')
  assert.equal(RESULT_FIELDS.includes('nodeCount'), true, 'UIA comes back as a count')

  // and what is actually returned stays inside that declared set
  const r = createObserver().observe({ action: 'capture_screen' })
  for (const k of Object.keys(r)) {
    assert.equal(RESULT_FIELDS.includes(k), true, 'undeclared field escaped: ' + k)
  }
})

/* ── the Companion delegates rather than growing its own eyes ─────────────── */

/**
 * ⛔ TWO CASES DEFERRED TO COMMIT C, WHICH PORTS `companion.js`.
 * They assert the Companion routes observation by the closed set and performs none of it.
 * The 3a Companion on main does not route observation at all, so asserting it here would
 * fail against a module this commit deliberately does not touch. They return with it.
 */
test.skip('*** the Companion delegates observation and performs none of it ***', () => {
  const code = codeOf('companion.js')
  for (const cap of [
    'screenshot', 'captureScreen', 'BitBlt', 'PrintWindow',
    'UIAutomation', 'IUIAutomation', 'EnumWindows', 'GetForegroundWindow', 'desktopCapturer'
  ]) {
    assert.equal(code.includes(cap), false, 'companion.js still performs no observation: ' + cap)
  }
  assert.ok(code.includes('OBSERVATION_ACTIONS'), 'it routes by the closed set')
})

test.skip('an observation request through the Companion is refused in stage 1', () => {
  const { createCompanion } = require('./companion')
  const audits = []
  const c = createCompanion({ onAudit: (a) => audits.push(a) })
  const res = c.handle({
    from: 'service', to: 'companion', type: 'execute_step',
    approvalId: 'appr_obs', stepIndex: 0,
    stepNonce: 'nonce-observation-stage1-0001',
    step: { action: 'list_windows' }
  })
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'no_capability_enabled')
  assert.equal(audits.length, 1, 'the refusal is audited')
  assert.equal(audits[0].action, 'list_windows')
  assert.equal(audits[0].outcome, 'refused')
})

/* ── still unwired ────────────────────────────────────────────────────────── */

test('*** nothing in the application imports the observation boundary ***', () => {
  const importers = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (p !== DIR) walk(p); continue }
      if (!e.name.endsWith('.js')) continue
      if (/require\([^)]*computer\/observation/.test(fs.readFileSync(p, 'utf8'))) {
        importers.push(path.relative(SRC, p))
      }
    }
  }
  walk(SRC)
  assert.deepEqual(importers, [], 'unwired: no importer anywhere in src/')
})
