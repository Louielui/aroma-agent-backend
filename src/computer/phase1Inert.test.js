'use strict'

/**
 * phase1Inert.test.js — Computer Operator v0, Phase 1. THE EVIDENCE FILE.
 *
 * Phase 1 is allowed to describe a desktop operator and forbidden to be one. Saying so
 * in a comment is worth nothing, so this file proves it mechanically: it reads the
 * Phase 1 source and fails if any of it could reach a disk, a process, a network, a
 * screen, an input device or the rest of the application.
 *
 * If someone later wires this up, these tests fail first and loudly. That is the point.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const DIR = __dirname
const SRC = path.resolve(DIR, '..')
// PURE modules — no I/O of any kind, ever. Phase 2 adds two more to this tier.
const MODULES = [
  'computerWorkOrder.js', 'computerAudit.js', 'sessionBoundary.js', 'computerOperatorFlag.js',
  'killSwitch.js', 'orderRegistry.js'
]

// The Supervisor is the ONE module permitted to reach a disk, and ONLY to persist the
// audit record. It gets its own, narrower rules below: it may build an artifact store,
// and it must still be unable to spawn, connect, click, type or capture.
const SUPERVISOR = 'computerSupervisor.js'

const codeOf = (f) => {
  // Comments quote the very words being banned ("no child_process", "captures screen"),
  // so strip them before scanning — otherwise the file's own documentation trips its
  // own guard. That trap has bitten this repo repeatedly.
  return fs.readFileSync(path.join(DIR, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/* ── it cannot reach anything ─────────────────────────────────────────────── */

test('*** no Phase 1 module can touch a disk, a process, a network or a device ***', () => {
  const BANNED_REQUIRES = [
    'node:fs', 'node:child_process', 'node:net', 'node:http', 'node:https', 'node:dgram',
    'node:worker_threads', 'node:cluster', 'node:v8', 'node:vm', 'node:repl',
    'fs', 'child_process', 'net', 'http', 'https', 'puppeteer', 'playwright',
    'robotjs', 'nut-js', '@nut-tree', 'screenshot-desktop', 'ffi', 'koffi', 'edge-js'
  ]
  for (const f of MODULES) {
    const code = codeOf(f)
    for (const mod of BANNED_REQUIRES) {
      const re = new RegExp("require\\(\\s*['\"]" + mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "['\"]")
      assert.equal(re.test(code), false, f + ' must not require ' + mod)
    }
    // and no dynamic escape hatch
    for (const hatch of ['eval(', 'new Function', 'process.binding', 'import(']) {
      assert.equal(code.includes(hatch), false, f + ' must not use ' + hatch)
    }
  }
})

test('the pure modules import nothing but node:crypto and each other', () => {
  const external = new Set()
  const internal = new Set()
  for (const f of MODULES) {
    for (const m of codeOf(f).matchAll(/require\(\s*['"]([^'"]+)['"]/g)) {
      // A sibling in this folder is itself covered by every rule in this file, so it adds
      // no reach. Anything else is a genuine new dependency and must be justified.
      if (m[1].startsWith('./')) internal.add(m[1]); else external.add(m[1])
    }
  }
  assert.deepEqual([...external].sort(), ['node:crypto'], 'hashing only — no other outside dependency')
  for (const i of internal) {
    assert.ok(MODULES.includes(i.replace('./', '') + '.js'), 'sibling is itself a pure module: ' + i)
  }
})

test('*** nothing spawns, writes, connects, clicks, types or captures ***', () => {
  // Matched as CALLS, not as substrings. A plain `includes('exec')` flagged the message
  // name 'execute_step' — a string in a closed enum, not a call — so the scanner has to
  // look for call syntax or it fails on the design it is meant to protect.
  const FORBIDDEN_CALLS = [
    'spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'fork',
    'writeFile', 'writeFileSync', 'readFile', 'readFileSync', 'mkdir', 'mkdirSync',
    'rmdir', 'rm', 'unlink', 'rename', 'copyFile', 'createWriteStream', 'createReadStream',
    'fetch', 'listen', 'connect', 'createServer', 'request',
    'sendKeys', 'SendKeys', 'mouseMove', 'mouseClick', 'keyTap', 'screenshot', 'capture',
    'GetForegroundWindow', 'SetCursorPos', 'UIAutomation'
  ]
  for (const f of MODULES) {
    const code = codeOf(f)
    for (const call of FORBIDDEN_CALLS) {
      // `name(`  or  `.name(`  — a call site, in either form
      const re = new RegExp('(^|[^\\w$])\\.?' + call + '\\s*\\(')
      assert.equal(re.test(code), false, f + ' must not call ' + call)
    }
  }
})

/* ── it is not wired to anything ──────────────────────────────────────────── */

test('*** NOTHING in the application requires the Computer Operator modules ***', () => {
  // Walk the whole of src/ except this folder. If any file imports Phase 1, it is wired.
  const importers = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (p !== DIR) walk(p); continue }
      if (!e.name.endsWith('.js')) continue
      const code = fs.readFileSync(p, 'utf8')
      if (/require\([^)]*computer\/(computerWorkOrder|computerAudit|sessionBoundary|computerOperatorFlag|computerSupervisor|killSwitch|orderRegistry)/.test(code)) {
        importers.push(path.relative(SRC, p))
      }
    }
  }
  walk(SRC)
  assert.deepEqual(importers, [], 'Phase 1 is unwired: no importer anywhere in src/')
})

test('*** the flag is unread, so turning it on does nothing ***', () => {
  const { resolveComputerOperator } = require('./computerOperatorFlag')
  assert.equal(resolveComputerOperator({}), 'off')
  assert.equal(resolveComputerOperator({ COMPUTER_OPERATOR: '' }), 'off')
  assert.equal(resolveComputerOperator({ COMPUTER_OPERATOR: 'ON' }), 'off', 'strict: wrong case is off')
  assert.equal(resolveComputerOperator({ COMPUTER_OPERATOR: 'yes' }), 'off')
  assert.equal(resolveComputerOperator({ COMPUTER_OPERATOR: 'on' }), 'on', 'the resolver works…')
  // …and nobody calls it, so 'on' has no effect anywhere
  const appCode = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8')
  assert.equal(appCode.includes('COMPUTER_OPERATOR'), false, 'app.js does not know the flag exists')
  assert.equal(appCode.includes('computerOperatorFlag'), false)
})

test('*** INVERTED: the gate is now FOUR flags, mutually exclusive (Owner ruling) ***', () => {
  // Phase 1 asserted the opposite — that the gate had NOT been extended — because the
  // question was open. The Owner ruled on 2026-07-28: COMPUTER_OPERATOR joins the
  // existing gate as a peer, any two of four ⇒ configuration_conflict. Inverted here
  // rather than deleted, so the file records a decision instead of losing the history.
  const { authorizeExecution } = require('../agent/agentAuthorization')
  const conflict = authorizeExecution({
    worker: 'on', computer: 'on', develop: 'off', agent: 'off',
    computerSupervisorConfigured: true
  })
  assert.equal(conflict.status, 'configuration_conflict', 'the fourth flag is inside the matrix')
  assert.equal(conflict.computerOperatorAuthorized, false)
  // and it still authorizes nothing on its own without a configured supervisor
  assert.equal(authorizeExecution({ worker: 'off', develop: 'off', agent: 'off', computer: 'on' }).status, 'not_authorized')
})

/* ── the Supervisor: allowed a disk, for the audit, and nothing else ──────── */

test('*** the Supervisor cannot spawn, connect, click, type or capture ***', () => {
  const code = codeOf(SUPERVISOR)
  for (const call of ['spawn', 'exec', 'execSync', 'execFile', 'fork', 'fetch', 'listen',
    'connect', 'createServer', 'request', 'sendKeys', 'SendKeys', 'mouseMove', 'mouseClick',
    'keyTap', 'screenshot', 'capture', 'GetForegroundWindow', 'SetCursorPos', 'UIAutomation']) {
    const re = new RegExp('(^|[^\\w$])\\.?' + call + '\\s*\\(')
    assert.equal(re.test(code), false, 'Supervisor must not call ' + call)
  }
  for (const hatch of ['eval(', 'new Function', 'process.binding', 'import(']) {
    assert.equal(code.includes(hatch), false, 'Supervisor must not use ' + hatch)
  }
})

test('the Supervisor reaches a disk ONLY through the artifact store', () => {
  const code = codeOf(SUPERVISOR)
  // it must not touch fs directly — the audit goes through the same store as every other
  // artifact, so it inherits that store's kind allowlist and layout
  for (const direct of ['node:fs', "'fs'", 'writeFileSync', 'readFileSync', 'mkdirSync', 'unlinkSync']) {
    assert.equal(code.includes(direct), false, 'no direct filesystem access: ' + direct)
  }
  assert.ok(code.includes('artifactStore'), 'persistence is via the artifact store')
})

test('*** no Supervisor exists in the running application — it is constructed by nobody ***', () => {
  // Phase 2 must not wire into app.js. The importer scan above already covers src/;
  // this states the specific claim for the one module that could act if it were wired.
  const appCode = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8')
  assert.equal(appCode.includes('computerSupervisor'), false)
  assert.equal(appCode.includes('createComputerSupervisor'), false)
  assert.equal(appCode.includes('computerSupervisorConfigured'), false,
    'the app never tells the gate a supervisor is configured')
})

test('the computer-audit artifact kind is registered BEFORE anything can act', () => {
  // Writing an unknown kind throws. Without this entry the first real desktop run would
  // have acted and then failed to leave a record — the Agent Bridge failure, repeated.
  const { createArtifactStore } = require('../store/artifactStore')
  const storeSrc = fs.readFileSync(path.join(SRC, 'store', 'artifactStore.js'), 'utf8')
  assert.ok(storeSrc.includes("'computer-audit'"), 'the kind is in the allowlist')
  assert.equal(typeof createArtifactStore, 'function')
})

/* ── Phase 1 created nothing on the machine ───────────────────────────────── */

test('*** the allowedPath folder was NOT created, and nothing here would create it ***', () => {
  const { ALLOWED_ROOT } = require('./computerWorkOrder')
  assert.equal(ALLOWED_ROOT, 'C:\\Aroma\\ComputerOperator-Test')
  // The constant exists to validate against. Phase 1 must not create the folder — and
  // cannot, since no module imports fs at all (asserted above).
  assert.equal(fs.existsSync(ALLOWED_ROOT), false, 'Phase 1 did not create the test folder')
})

test('*** no Windows account was created, and the definition says so as data ***', () => {
  const { COMPANION_ACCOUNT } = require('./sessionBoundary')
  assert.equal(COMPANION_ACCOUNT.name, 'AromaOperator')
  assert.equal(COMPANION_ACCOUNT.created, false, 'Phase 1 creates no account')
  assert.equal(COMPANION_ACCOUNT.mustBeAdmin, false)
  assert.equal(COMPANION_ACCOUNT.mustBeSeparateFromOwner, true)
  assert.equal(COMPANION_ACCOUNT.browserProfile, 'new')
  assert.equal(COMPANION_ACCOUNT.mayHoldSavedCredentials, false)
  assert.equal(COMPANION_ACCOUNT.mayHoldBankOrPayrollSession, false)
})
