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
  // Only the IPC contract. No fs, no child_process, no native binding, no automation lib.
  assert.deepEqual(imports, ['./sessionBoundary'], 'the Companion imports only the contract')
  for (const banned of ['node:fs', 'fs', 'node:child_process', 'child_process', 'robotjs',
    '@nut-tree', 'nut-js', 'screenshot-desktop', 'koffi', 'ffi-napi', 'edge-js', 'node-window-manager']) {
    assert.equal(imports.includes(banned), false, 'must not import: ' + banned)
  }
})

test('*** every capability in the register is declared and OFF ***', () => {
  const { CAPABILITIES, anyCapabilityEnabled } = require('./companion')
  assert.equal(anyCapabilityEnabled(), false, 'Phase 3a: zero capability')
  const off = Object.entries(CAPABILITIES).filter(([, v]) => v === false).map(([k]) => k)
  assert.equal(off.length, Object.keys(CAPABILITIES).length, 'all of them are off')
  // The Phase 3b set is present-and-off rather than absent, so enabling one is an edit to
  // a value a test watches — not a new name nobody is checking.
  for (const k of ['list_windows', 'read_ui_tree', 'capture_own_screen']) {
    assert.equal(CAPABILITIES[k], false, 'Phase 3b capability still off: ' + k)
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

test('*** the approved test folder still does not exist ***', () => {
  const { ALLOWED_ROOT } = require('./computerWorkOrder')
  assert.equal(fs.existsSync(ALLOWED_ROOT), false, 'Phase 3a must not create it')
})

/* ── the account is the Owner's step, and the code says so honestly ───────── */

test('*** the Companion account has NOT been created by this code ***', () => {
  const { COMPANION_ACCOUNT } = require('./sessionBoundary')
  assert.equal(COMPANION_ACCOUNT.created, false)
  // and nothing in this folder could create one: no module can run a process at all
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))) {
    const code = codeOf(f)
    for (const cap of ['New-LocalUser', 'net user', 'child_process', 'ShellExecute']) {
      assert.equal(code.includes(cap), false, f + ' must not be able to create an account: ' + cap)
    }
  }
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
