'use strict'

/**
 * nativeSaveActivation.test.js — the narrow helper, tested without a desktop.
 *
 * ── WHAT CAN AND CANNOT BE PROVEN HERE, SAID FIRST ────────────────────────
 * The helper's job ends in a Win32 call against a real Save dialog. No test in this file opens
 * Notepad, and none of them proves BM_CLICK activates that button — that is a hypothesis and
 * remains one until a measured run (DESIGN-001 §10.3).
 *
 * What IS proven here:
 *   . the structure of the file: one message, one call site, no parameterisation;
 *   . that every refusal returns BEFORE the send, by position in the source;
 *   . that the script really loads, really refuses, and reports sendCount 0 — executed for
 *     real against a binding that cannot resolve, which opens nothing and sends nothing.
 *
 * Every negative asserts ZERO SENDS rather than "a refusal happened". A refusal that sent the
 * message first is not a refusal.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const REPO = path.resolve(__dirname, '..', '..')
const HELPER = path.join(REPO, 'scripts', 'computer', 'nativeSaveActivation.ps1')
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

const raw = () => fs.readFileSync(HELPER, 'utf8')
const code = () => raw().replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '')

/* ── 1. the message is a constant, and there is exactly one send ──────────── */

test('*** BM_CLICK is a literal constant, never a parameter ***', () => {
  const c = code()
  assert.match(c, /public const uint BM_CLICK = 0x00F5;/, 'declared as a constant')
  // It must not be reachable as an argument, a setting, or a payload field.
  assert.equal(/\$BM_CLICK\s*=/.test(c), false, 'not a PowerShell variable that could be reassigned')
  assert.equal(/param\s*\([^)]*\bmsg\b/i.test(c), false, 'no function takes a message')
  assert.equal(/\$payload\.(msg|message)/i.test(c), false, 'never read from the payload')
  assert.equal(/uint\s+msg\s*[,)]/.test(c.replace('SendMessage(System.IntPtr h, uint msg', '')), false,
    'the only msg parameter is the private DllImport declaration itself')
})

test('*** SendMessage is PRIVATE and has exactly one call site ***', () => {
  const c = code()
  assert.match(c, /private static extern System\.IntPtr SendMessage/, 'the import is private to the type')
  // One call, inside the one exported wrapper.
  const calls = c.match(/SendMessage\s*\(/g) || []
  assert.equal(calls.length, 2, 'the declaration and exactly one call, nothing else: ' + calls.length)
  assert.match(c, /public static System\.IntPtr ClickButtonOnly\(System\.IntPtr h\) \{[\s\S]{0,120}SendMessage\(h, BM_CLICK, System\.IntPtr\.Zero, System\.IntPtr\.Zero\);/,
    'the wrapper takes a window and NOTHING else')
})

test('*** the exported wrapper cannot express another message ***', () => {
  const c = code()
  // A second overload, or any msg parameter on the public surface, is the degradation.
  const publics = c.match(/public static [^\n]*\(/g) || []
  for (const p of publics) {
    assert.equal(/uint\s+\w*msg/i.test(p), false, 'a public method takes a message: ' + p)
  }
  assert.equal((c.match(/ClickButtonOnly/g) || []).length >= 2, true, 'the wrapper is defined and used')
})

/* ── 2. every refusal precedes the send, positionally ─────────────────────── */

test('*** EVERY refusal returns before the single send — proven by position ***', () => {
  const src = raw()
  const sendAt = src.indexOf('ClickButtonOnly($btnHandle)')
  assert.ok(sendAt > 0, 'the send exists')

  // Every Deny in the activation function must appear earlier in the file than the send.
  const before = src.slice(0, sendAt)
  const after = src.slice(sendAt)
  const denysBefore = (before.match(/return \(Deny /g) || []).length
  const denysAfter = (after.match(/return \(Deny /g) || []).length
  assert.ok(denysBefore >= 15, 'the verification block refuses in many named ways: ' + denysBefore)
  assert.equal(denysAfter, 0, 'nothing refuses AFTER the send — there would be nothing to undo')

  // And the send is the last thing the function decides: only the result follows it.
  assert.match(after.slice(0, 400), /\$script:SendCount\+\+/, 'the counter is incremented at the send')
})

test('*** the send is counted, and the count is reported on EVERY outcome ***', () => {
  const c = code()
  assert.match(c, /\$script:SendCount = 0/, 'a counter exists')
  // Deny carries it, the success result carries it, and the catch-all carries it.
  assert.match(c, /function Deny[\s\S]{0,240}sendCount = \$script:SendCount/, 'refusals report it')
  assert.match(c, /ok = \$true[\s\S]{0,200}sendCount = \$script:SendCount/, 'success reports it')
  assert.match(c, /activation_threw[\s\S]{0,160}sendCount = \$script:SendCount/, 'even a throw reports it')
  // Dispatch-level refusals report zero explicitly rather than omitting the field.
  assert.equal((c.match(/sendCount = 0/g) || []).length >= 3, true, 'the early exits state zero')
})

test('*** one activation per process, enforced before the send ***', () => {
  const src = raw()
  const guardAt = src.indexOf("already_activated")
  const sendAt = src.indexOf('ClickButtonOnly($btnHandle)')
  assert.ok(guardAt > 0 && guardAt < sendAt, 'the single-use check precedes the send')
})

/* ── 3. the op set is closed and takes no target ──────────────────────────── */

test('*** exactly one op, and it accepts no window, message or selector ***', () => {
  const c = code()
  assert.match(c, /if \(\$op -ne 'activate_bound_save'\)/, 'one op')
  assert.match(c, /reason = 'unknown_op'/, 'anything else refuses')

  // The payload contract: a binding the Companion already holds, plus the approved destination.
  assert.match(c, /foreach \(\$f in @\('bind', 'dir', 'fileName'\)\)/, 'three fields, named')
  assert.match(c, /foreach \(\$bf in @\('processId', 'sessionId', 'windowHandle'\)\)/, 'and a three-field binding')

  // Nothing caller-supplied may select a control or a message.
  for (const f of ['hwnd', 'automationId', 'className', 'message', 'wParam', 'lParam', 'script']) {
    assert.equal(new RegExp('\\$payload\\.' + f, 'i').test(c), false, 'payload.' + f + ' must not be read')
  }
})

test('*** the fixed identities are constants, not payload fields ***', () => {
  const c = code()
  for (const [name, value] of [
    ['DIALOG_CLASS', "'#32770'"],
    ['SAVE_AUTOMATION_ID', "'1'"],
    ['SAVE_NATIVE_CLASS', "'Button'"],
    ['FILENAME_AUTOMATION_ID', "'System.ItemNameDisplay'"]
  ]) {
    assert.ok(c.includes('$' + name + ' = ' + value), name + ' is a constant')
    assert.equal(new RegExp('\\$payload[\\s\\S]{0,40}' + name).test(c), false, name + ' must not come from the payload')
  }
})

test('*** no dynamic code execution anywhere in the helper ***', () => {
  const c = code()
  for (const re of [/Invoke-Expression/i, /\biex\b/i, /\[scriptblock\]::Create/i, /Add-Type\s+-TypeDefinition\s+\$/i, /&\s*\$payload/i]) {
    assert.equal(re.test(c), false, 'dynamic execution: ' + re)
  }
  // Add-Type appears, but only with a here-string literal — never a variable.
  const addTypes = c.match(/Add-Type[^\n]*/g) || []
  for (const a of addTypes) {
    assert.equal(/\$/.test(a.replace(/-MemberDefinition @'/, '')), false, 'Add-Type must not take a variable: ' + a)
  }
})

/* ── 4. the destination is composed, never accepted ───────────────────────── */

test('*** the absolute path is BUILT from the approved folder and name ***', () => {
  const c = code()
  assert.match(c, /\$expectedPath = Join-Path \$dir \$fileName/, 'composed here')
  // There must be no payload field carrying a full path.
  assert.equal(/\$payload\.(path|targetPath|fullPath|absolutePath)/i.test(c), false, 'no path is accepted')
})

test('*** what pressing the button will DO is checked, not just which button ***', () => {
  const src = raw()
  const sendAt = src.indexOf('ClickButtonOnly($btnHandle)')
  const before = src.slice(0, sendAt)
  // The two checks that make this different from "press a verified button".
  assert.match(before, /filename_field_altered/, 'the field value is re-read')
  assert.match(before, /-cne \$expectedPath/, 'compared case-sensitively to the approved path')
  assert.match(before, /current_folder_altered/, 'and the folder is checked independently')
  assert.match(before, /refuse_overwrite/, 'and there is still nothing to overwrite')
})

/* ── 5. the refusal vocabulary is complete and named ──────────────────────── */

const REQUIRED_REFUSALS = [
  'process_gone', 'session_changed', 'window_changed', 'save_dialog_not_found',
  'dialog_process_mismatch', 'dialog_class_unexpected', 'save_control_not_found',
  'save_control_not_unique', 'save_control_id_mismatch', 'save_control_class_mismatch',
  'save_control_gone', 'save_control_disabled', 'save_control_offscreen',
  'save_control_not_in_dialog', 'filename_field_not_found', 'filename_field_altered',
  'current_folder_altered', 'refuse_overwrite', 'activation_window_expired', 'already_activated',
  'unknown_op', 'missing_field', 'activation_threw'
]

test('*** every refusal DESIGN-001 promised exists in the helper ***', () => {
  const c = code()
  const missing = REQUIRED_REFUSALS.filter((r) => !c.includes("'" + r + "'"))
  assert.deepEqual(missing, [], 'refusal codes missing from the helper: ' + missing.join(', '))
})

test('*** no refusal path can fall through to the send ***', () => {
  const src = raw()
  const fn = src.slice(src.indexOf('function Invoke-Activation'), src.indexOf('ClickButtonOnly($btnHandle)'))
  // Each Deny is returned, never merely constructed and discarded.
  const denys = fn.match(/Deny '[a-z_]+'/g) || []
  const returns = fn.match(/return \(Deny '[a-z_]+'/g) || []
  assert.equal(denys.length, returns.length, 'every Deny is RETURNED: ' + denys.length + ' vs ' + returns.length)
})

/* ── 6. it really runs, really refuses, and really sends nothing ──────────── */

test('*** EXECUTED: an unresolvable binding refuses with sendCount 0 ***', () => {
  // A real invocation. It opens nothing and sends nothing: the pid does not exist, so the very
  // first check refuses. This proves the file parses, the native type loads, the transport
  // works, and the zero-send contract holds on a path that actually ran.
  const payload = {
    op: 'activate_bound_save',
    dir: 'C:\\Aroma\\ComputerOperator-Test',
    fileName: 'never-created.txt',
    bind: { processId: 999999, sessionId: 1, windowHandle: '0x0' }
  }
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER],
    { encoding: 'utf8', input: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'), timeout: 60000 })

  const line = String(r.stdout).split(/\r?\n/).find((l) => l.startsWith('AROMA_JSON_B64:'))
  assert.ok(line, 'it emitted an envelope: ' + String(r.stdout).slice(0, 300) + String(r.stderr).slice(0, 300))
  const res = JSON.parse(Buffer.from(line.slice('AROMA_JSON_B64:'.length).trim(), 'base64').toString('utf8'))

  assert.equal(res.ok, false, 'it refused')
  assert.equal(res.reason, 'process_gone', 'at the first check, by name')
  assert.equal(res.sendCount, 0, 'ZERO SENDS')
  assert.equal(res.activated, false)
})

test('*** EXECUTED: an unknown op refuses with sendCount 0 ***', () => {
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER],
    { encoding: 'utf8', input: Buffer.from(JSON.stringify({ op: 'send_message' }), 'utf8').toString('base64'), timeout: 60000 })
  const line = String(r.stdout).split(/\r?\n/).find((l) => l.startsWith('AROMA_JSON_B64:'))
  assert.ok(line, 'envelope present')
  const res = JSON.parse(Buffer.from(line.slice('AROMA_JSON_B64:'.length).trim(), 'base64').toString('utf8'))
  assert.equal(res.reason, 'unknown_op')
  assert.equal(res.sendCount, 0, 'ZERO SENDS')
})

test('*** EXECUTED: a missing binding field refuses with sendCount 0 ***', () => {
  const payload = {
    op: 'activate_bound_save',
    dir: 'C:\\Aroma\\ComputerOperator-Test',
    fileName: 'x.txt',
    bind: { processId: 1 } // no sessionId, no windowHandle
  }
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER],
    { encoding: 'utf8', input: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'), timeout: 60000 })
  const line = String(r.stdout).split(/\r?\n/).find((l) => l.startsWith('AROMA_JSON_B64:'))
  assert.ok(line, 'envelope present')
  const res = JSON.parse(Buffer.from(line.slice('AROMA_JSON_B64:'.length).trim(), 'base64').toString('utf8'))
  assert.equal(res.reason, 'missing_field')
  assert.match(String(res.detail), /bind\./)
  assert.equal(res.sendCount, 0, 'ZERO SENDS')
})

/* ── 7. encoding and hazards, same rules as every other packaged script ───── */

test('*** the helper is UTF-8 with a BOM and clean under the PowerShell hazard rules ***', () => {
  const { findUnrollHazards, findIndexHazards, findAutomaticAssignments } = require('./powershellHazards')
  const src = raw()
  assert.deepEqual(findUnrollHazards(src), [])
  assert.deepEqual(findIndexHazards(src), [])
  assert.deepEqual(findAutomaticAssignments(src), [])
  const b = fs.readFileSync(HELPER)
  assert.ok(b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF, 'BOM present')
  let nonAscii = 0
  for (const x of b) if (x > 127) nonAscii++
  assert.equal(nonAscii, 3, 'ASCII body — only the BOM is non-ASCII')
})
