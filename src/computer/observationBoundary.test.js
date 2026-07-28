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
  // input synthesis by name, whatever the forbidden list happens to contain
  for (const bad of ['click', 'type_text', 'send_key', 'move_mouse', 'open_app']) {
    assert.equal(FORBIDDEN_ACTIONS.includes(bad), true, 'forbidden list must name: ' + bad)
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
  for (const a of ['click', 'type_text', 'open_app', 'write_file', null, 42]) {
    const r = o.observe({ action: a })
    assert.equal(r.ok, false)
    assert.equal(r.refusal, 'action_not_in_observation_set', 'out of scope: ' + String(a))
  }
})

/* ── LOCK 1a — no path from observation to any model surface ──────────────── */

test('*** LOCK 1a — observation.js requires nothing, so it reaches no LLM surface ***', () => {
  const imports = [...codeOf('observation.js').matchAll(/require\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual(imports, [], 'the observation boundary imports nothing at all')
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

test('*** the Companion delegates observation and performs none of it ***', () => {
  const code = codeOf('companion.js')
  for (const cap of [
    'screenshot', 'captureScreen', 'BitBlt', 'PrintWindow',
    'UIAutomation', 'IUIAutomation', 'EnumWindows', 'GetForegroundWindow', 'desktopCapturer'
  ]) {
    assert.equal(code.includes(cap), false, 'companion.js still performs no observation: ' + cap)
  }
  assert.ok(code.includes('OBSERVATION_ACTIONS'), 'it routes by the closed set')
})

test('an observation request through the Companion is refused in stage 1', () => {
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
