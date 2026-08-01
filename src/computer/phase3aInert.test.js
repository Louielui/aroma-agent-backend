'use strict'

/**
 * phase3aInert.test.js — Computer Operator v0, Phase 3a. THE CAPABILITY PROOF.
 *
 * Phase 3a builds a process that can hold a conversation and do nothing else. Saying so
 * is worth nothing; this reads the Companion's source and fails if the ability to observe
 * or act ever appears in it.
 *
 * The Companion is the process that will one day sit in an interactive desktop session,
 * so this file is the one that matters most. If someone adds a capability here, these
 * tests fail before anything can use it.
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

/* ── the Companion cannot observe ─────────────────────────────────────────── */

test('*** the Companion cannot capture a screen or read a UI tree ***', () => {
  const code = codeOf('companion.js')
  for (const cap of [
    'screenshot', 'captureScreen', 'CaptureScreen', 'BitBlt', 'PrintWindow',
    'UIAutomation', 'IUIAutomation', 'AccessibleObjectFromWindow', 'EnumWindows',
    'GetForegroundWindow', 'GetWindowText', 'desktopCapturer'
  ]) {
    assert.equal(code.includes(cap), false, 'Companion must not be able to observe: ' + cap)
  }
})

/* ── the Companion cannot act ─────────────────────────────────────────────── */

test('*** the Companion cannot move a mouse, send a key, launch an app or write a file ***', () => {
  const code = codeOf('companion.js')

  // CALL-shaped: matched as `name(` or `.name(`. A plain substring check flagged the
  // message type 'execute_step' as the `exec` call — the same trap that bit the Phase 2
  // scanner. A name in a closed enum is not a call.
  for (const call of [
    'mouseMove', 'mouseClick', 'keyTap', 'sendKeys', 'SendKeys', 'SendInput', 'SetCursorPos',
    'spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'fork',
    'writeFile', 'writeFileSync', 'appendFile', 'unlink', 'mkdir', 'rename', 'copyFile'
  ]) {
    const re = new RegExp('(^|[^\\w$])\\.?' + call + '\\s*\\(')
    assert.equal(re.test(code), false, 'Companion must not call: ' + call)
  }

  // API NAMES that are never legitimate here in any form.
  for (const api of ['mouse_event', 'keybd_event', 'ShellExecute', 'CreateProcess', 'child_process']) {
    assert.equal(code.includes(api), false, 'Companion must not reference: ' + api)
  }
})

test('*** the Companion imports NOTHING that could reach a desktop or a disk ***', () => {
  const imports = [...codeOf('companion.js').matchAll(/require\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  // NARROWED FOR PHASE 3b — GOV-001, Owner GO 2026-07-28. Was ['./sessionBoundary'].
  // The Companion now DELEGATES observation to observation.js rather than performing it,
  // which is why this is the only assertion in this file that had to move: companion.js
  // itself still contains no observation code, so the banned-token scan above and the
  // capability register assertion below are both unchanged and still enforced.
  // Still a closed list, still no fs, no child_process, no native binding, no automation lib.
  // The allowlist grew by two on 2026-07-31, and both additions are things that CANNOT act:
  // the gate computes and compares, the flag resolver returns a string. computerExecutor and
  // desktopAdapter are deliberately absent — an executor reaches the Companion by injection,
  // so the Companion still has no way to build one.
  assert.deepEqual(imports, ['./sessionBoundary', './sealedOrderGate', './computerOperatorFlag', './observation'],
    'the Companion imports only the contract, the gate, the flag resolver and the observation boundary')
  for (const reachesADesktop of ['./computerExecutor', './desktopAdapter']) {
    assert.equal(imports.includes(reachesADesktop), false, 'the Companion must not import: ' + reachesADesktop)
  }
  for (const banned of ['node:fs', 'fs', 'node:child_process', 'child_process', 'robotjs',
    '@nut-tree', 'nut-js', 'screenshot-desktop', 'koffi', 'ffi-napi', 'edge-js', 'node-window-manager']) {
    assert.equal(imports.includes(banned), false, 'must not import: ' + banned)
  }
})

test('*** no capability is UNCONDITIONALLY enabled ***', () => {
  // CHANGED 2026-07-31 by Owner ruling, and the change is narrow enough to state exactly.
  // This test used to require every register value to be `false`, which encoded "absolute
  // prohibition". Four names — plus `save` — are now 'sealed_order_only': default deny, with
  // one unlock condition. What is asserted instead is the claim that actually matters and
  // that did NOT change: nothing is `true`.
  const { CAPABILITIES, anyCapabilityEnabled, sealedOrderOnlyCapabilities, CAP } = require('./companion')
  assert.equal(anyCapabilityEnabled(), false, 'nothing is enabled without an order')
  for (const [k, v] of Object.entries(CAPABILITIES)) {
    assert.notEqual(v, true, 'no capability may be unconditionally on: ' + k)
    assert.ok([false, CAP.SEALED_ORDER_ONLY, CAP.NEVER].includes(v), 'unknown state for ' + k + ': ' + v)
  }
  // The Phase 3b observation set is present-and-off rather than absent.
  for (const k of ['list_windows', 'read_ui_tree', 'capture_own_screen']) {
    assert.equal(CAPABILITIES[k], false, 'Phase 3b capability still off: ' + k)
  }
  // Exactly these are unlockable. A sixth appearing here is a capability change.
  assert.deepEqual(sealedOrderOnlyCapabilities().sort(),
    ['launch_app', 'open_app', 'save', 'send_keys', 'type_text'])
  // And these remain beyond any order at all.
  for (const k of ['move_mouse', 'write_file', 'read_file', 'network']) {
    assert.equal(CAPABILITIES[k], CAP.NEVER, 'no order may unlock: ' + k)
  }
})

test('the Companion refuses rather than partially complying', () => {
  // There is no "best effort" path: a partial action on a real desktop cannot be undone.
  const code = codeOf('companion.js')
  assert.equal(/bestEffort|partial|fallbackAction|tryAnyway/i.test(code), false)
  assert.ok(code.includes('NO_CAPABILITY'), 'the single refusal reason exists')
})

/* ── still not wired, still nothing enabled ───────────────────────────────── */

test('*** nothing in the application imports the Companion or the channel ***', () => {
  const importers = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (p !== DIR) walk(p); continue }
      if (!e.name.endsWith('.js')) continue
      if (/require\([^)]*computer\/(companion|ipcChannel|evidenceStore)/.test(fs.readFileSync(p, 'utf8'))) {
        importers.push(path.relative(SRC, p))
      }
    }
  }
  walk(SRC)
  assert.deepEqual(importers, [], 'unwired: no importer anywhere in src/')
})

test('*** the flag is still off and the launcher still does not mention it ***', () => {
  const { resolveComputerOperator } = require('./computerOperatorFlag')
  assert.equal(resolveComputerOperator(process.env), 'off', 'not enabled in this environment')
  const appCode = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8')
  assert.equal(appCode.includes('COMPUTER_OPERATOR'), false)
  assert.equal(appCode.includes('companion'), false)
})

test('*** Phase 3a cannot create the approved test folder ***', () => {
  // CHANGED 2026-07-31 for the same reason as its Phase 1 twin: the folder now exists,
  // created elevated by the Owner via scripts/computer/prepare-canary-testdir.ps1. Its
  // absence was never the guarantee — Phase 3a's inability to create it was, and that is
  // what is asserted now. Weakening would have been to delete the test; this replaces a
  // proxy with the real claim.
  const { ALLOWED_ROOT } = require('./computerWorkOrder')
  assert.equal(ALLOWED_ROOT, 'C:\\Aroma\\ComputerOperator-Test')
  // Narrow, and true: no module both knows this path and can create a directory.
  // evidenceStore.js does mkdir its own evidence folder, so a blanket ban on mkdir would
  // fail for a correct reason.
  const MAKERS = ['mkdir', 'mkdirSync', 'ensureDir', 'CreateDirectory']
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))) {
    const code = codeOf(f)
    assert.equal(code.includes('ComputerOperator-Test') && MAKERS.some((m) => code.includes(m)), false,
      f + ' both names the approved root and can create directories')
  }
})

/* ── the account is the Owner's step, and the code says so honestly ───────── */

test('*** the Companion account has NOT been created by this code ***', () => {
  const { COMPANION_ACCOUNT } = require('./sessionBoundary')
  assert.equal(COMPANION_ACCOUNT.created, false)
  // Nothing here can create an account. The `child_process` clause used to carry that on the
  // back of a broader claim — "no module can run a process at all" — which stopped being true
  // when the PowerShell transport was unified into one launcher. The narrower claim is the one
  // that was always the point, and it still holds for every file including the launcher: it can
  // start ONE interpreter against a frozen script map, and none of those scripts creates a user.
  const LAUNCHER = 'powershellJsonRunner.js'
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))) {
    const code = codeOf(f)
    for (const cap of ['New-LocalUser', 'net user', 'ShellExecute']) {
      assert.equal(code.includes(cap), false, f + ' must not be able to create an account: ' + cap)
    }
    if (f !== LAUNCHER) {
      assert.equal(code.includes('child_process'), false, f + ' must not be able to run a process at all')
    }
  }
  // And the exemption is exactly one file, named — not a category that can quietly grow.
  const spawners = fs.readdirSync(DIR)
    .filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))
    .filter((n) => codeOf(n).includes('child_process'))
  assert.deepEqual(spawners, [LAUNCHER], 'exactly one module may start a process')
})

test('the kill-switch register does not claim more than has been shown', () => {
  // INVERTED 2026-07-28. Held false while the account did not exist and then while three
  // successive demonstrations were green without proving anything. Now true, on evidence:
  // each binding demonstrated under AromaOperator against its own proven-live Companion.
  const { KILL_SWITCH_BINDINGS } = require('./killSwitch')
  assert.equal(KILL_SWITCH_BINDINGS.stopsAnythingRunningToday, true)
  assert.equal(KILL_SWITCH_BINDINGS.demonstratedUnderCompanionAccount, true)
  // and the claim is still bounded — it names WHEN and WHICH, so it cannot quietly grow
  assert.ok(KILL_SWITCH_BINDINGS.demonstratedOn)
  assert.equal(KILL_SWITCH_BINDINGS.demonstratedBindings.length, 3)
})

test('*** the Observer is a SECOND entry point and the 3a bindings do not reach it ***', () => {
  // Phase 3b. The three demonstrated bindings were all proven against the Companion. The
  // Observer runs in its own process, started by a scheduled task the Companion cannot
  // touch — so killing the Companion does not stop an observation already in flight.
  // This is asserted rather than described so the register cannot quietly imply coverage
  // it does not have.
  const { KILL_SWITCH_BINDINGS } = require('./killSwitch')
  assert.equal(KILL_SWITCH_BINDINGS.killingCompanionStopsObserver, false,
    'if this ever becomes true it must be because it was DEMONSTRATED, not assumed')
  assert.equal(KILL_SWITCH_BINDINGS.observerKill.implemented, false, 'Phase 3b: not built yet')
  assert.equal(KILL_SWITCH_BINDINGS.observerKillDemonstrated, false, 'and not demonstrated')
  // the three that ARE demonstrated must not silently grow to include the observer
  assert.equal(KILL_SWITCH_BINDINGS.demonstratedBindings.includes('observerKill'), false)
})
