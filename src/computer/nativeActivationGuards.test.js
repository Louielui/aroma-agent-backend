'use strict'

/**
 * nativeActivationGuards.test.js — the structural guarantees DESIGN-001 rests on.
 *
 * Written BEFORE the helper, on the Owner's instruction, because a guard authored after the
 * thing it guards tends to describe what was built rather than what was promised.
 *
 * The promise being guarded is exactly one sentence: **an untrusted caller cannot name a window
 * and cannot name a message.** Not "is prevented from" — cannot express it. Everything below is
 * a way for that sentence to go false, turned into a red test.
 *
 * The one thing NOT guarded here, deliberately and on the Owner's own ruling: a Companion
 * process already running attacker code can call user32 directly. No test can prevent that and a
 * suite pretending otherwise would be worse than one that says so.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')
const SCRIPTS = path.join(REPO, 'scripts', 'computer')
const SRC = path.join(REPO, 'src')

/** The ONE file permitted to hold a native primitive. Everything else is a violation. */
const NATIVE_HELPER = 'nativeSaveActivation.ps1'

const stripPs = (s) => s.replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '')
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function walk (dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (n !== 'node_modules' && n !== '.git') walk(p, out) } else out.push(p)
  }
  return out
}

/* ── 1. JavaScript must remain unable to call Win32 at all ────────────────── */

/**
 * A generic FFI library in the Node process IS an arbitrary-syscall capability by construction.
 * With koffi or ffi-napi loaded, `SendMessage(anyHwnd, anyMsg, ...)` is reachable from any line
 * of JavaScript in the process, and every rule below it becomes decoration.
 *
 * This is the single load-bearing dependency check in the repo.
 */
const FFI_PATTERNS = [/^ffi-napi$/i, /^ffi$/i, /^koffi$/i, /^node-gyp/i, /^ref-/i, /^node-ffi/i, /^win32-api$/i, /^edge-js$/i, /native.*addon/i]

test('*** no FFI or native-binding dependency exists ***', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  const all = Object.keys(Object.assign({}, pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies))
  const bad = all.filter((d) => FFI_PATTERNS.some((re) => re.test(d)))
  assert.deepEqual(bad, [], 'JavaScript must stay unable to call Win32: ' + bad.join(', '))
})

test('*** and none is in the lockfile either — a transitive one counts ***', () => {
  const lockPath = path.join(REPO, 'package-lock.json')
  assert.ok(fs.existsSync(lockPath), 'the lockfile is the thing that says what is really installed')
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  const names = new Set()
  for (const key of Object.keys(lock.packages || {})) {
    const n = key.replace(/^node_modules\//, '').split('/node_modules/').pop()
    if (n) names.add(n)
  }
  for (const n of Object.keys(lock.dependencies || {})) names.add(n)
  const bad = [...names].filter((d) => FFI_PATTERNS.some((re) => re.test(d)))
  assert.deepEqual(bad, [], 'a transitive FFI package is the same capability: ' + bad.join(', '))
})

test('*** POSITIVE CONTROL — the dependency rule catches the real package names ***', () => {
  // Without this, "no offenders" could mean the patterns match nothing at all.
  for (const bad of ['ffi-napi', 'koffi', 'node-gyp', 'ref-napi', 'edge-js']) {
    assert.equal(FFI_PATTERNS.some((re) => re.test(bad)), true, 'must be caught: ' + bad)
  }
  for (const good of ['express', 'axios', 'uuid', 'googleapis', 'dotenv', 'express-validator']) {
    assert.equal(FFI_PATTERNS.some((re) => re.test(good)), false, 'must be permitted: ' + good)
  }
})

test('*** no JavaScript file loads a native module or a DLL ***', () => {
  const offenders = []
  for (const f of walk(SRC).concat(walk(SCRIPTS))) {
    if (!f.endsWith('.js') || f.endsWith('.test.js')) continue
    const code = stripJs(fs.readFileSync(f, 'utf8'))
    for (const re of [/require\(['"]ffi/i, /require\(['"]koffi/i, /\.node['"]\)/, /process\.dlopen/, /require\(['"]ref/i]) {
      if (re.test(code)) offenders.push(path.relative(REPO, f) + ' :: ' + re)
    }
  }
  assert.deepEqual(offenders, [], 'no JS may reach a native binding:\n  ' + offenders.join('\n  '))
})

/* ── 2. exactly one file may hold the native primitive ────────────────────── */

test('*** SendMessage appears in exactly ONE file, and it is the designated helper ***', () => {
  const found = []
  for (const f of walk(SCRIPTS).concat(walk(SRC))) {
    if (!/\.(ps1|js)$/.test(f) || f.endsWith('.test.js')) continue
    const code = /\.ps1$/.test(f) ? stripPs(fs.readFileSync(f, 'utf8')) : stripJs(fs.readFileSync(f, 'utf8'))
    if (/\bSendMessage\b|\bPostMessage\b|\bSendNotifyMessage\b|\bSendMessageTimeout\b/.test(code)) {
      found.push(path.basename(f))
    }
  }
  assert.deepEqual(found, [NATIVE_HELPER],
    'the message primitive lives in one named file and nowhere else; found in: ' + found.join(', '))
})

test('*** POSITIVE CONTROL — the location rule would catch a stray copy ***', () => {
  const sample = 'public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);'
  assert.equal(/\bSendMessage\b/.test(stripPs(sample)), true, 'a real declaration is detected')
  // And a mention inside a comment is NOT an occurrence — otherwise this file, and every design
  // note, would count as a violation and the rule would have to be switched off.
  assert.equal(/\bSendMessage\b/.test(stripPs('# we do not use SendMessage here')), false)
})

/* ── 3. nothing exports a generic message-sending function ────────────────── */

test('*** no generic sendMessage(hwnd, message, ...) is defined or exported anywhere ***', () => {
  const offenders = []
  for (const f of walk(SCRIPTS).concat(walk(SRC))) {
    if (!/\.(ps1|js)$/.test(f) || f.endsWith('.test.js')) continue
    const code = /\.ps1$/.test(f) ? stripPs(fs.readFileSync(f, 'utf8')) : stripJs(fs.readFileSync(f, 'utf8'))
    // A function whose parameters include BOTH a window and a message is a remote control,
    // whatever it is called.
    for (const re of [
      /function\s+\w*[Ss]end\w*\s*\([^)]*hwnd[^)]*(message|msg)[^)]*\)/i,
      /function\s+\w*[Ss]end\w*\s*\([^)]*(message|msg)[^)]*hwnd[^)]*\)/i,
      /param\s*\([^)]*\$hwnd[^)]*\$(message|msg)\b/i,
      /param\s*\([^)]*\$(message|msg)\b[^)]*\$hwnd/i
    ]) {
      if (re.test(code)) offenders.push(path.relative(REPO, f))
    }
  }
  assert.deepEqual(offenders, [], 'a function taking a window AND a message is a remote control:\n  ' + offenders.join('\n  '))
})

/* ── 4. the schemas cannot express a target or a message ──────────────────── */

const TARGET_NAMES = ['hwnd', 'parentHwnd', 'windowHandleSelector', 'message', 'messageId', 'wParam', 'lParam', 'automationId', 'className', 'script', 'nativeOperation']

test('*** no schema allowlist admits a window or a message ***', () => {
  const gate = require('./sealedOrderGate')
  const req = require('./executeRequestSchema')

  const allow = []
  for (const list of Object.values(gate.ACTION_FIELDS)) allow.push(...list)
  allow.push(...gate.BIND_FIELDS, ...req.REQUEST_FIELDS)

  for (const bad of TARGET_NAMES) {
    assert.equal(allow.some((f) => f.toLowerCase() === bad.toLowerCase()), false,
      'an allowlist admits "' + bad + '"')
  }
  // The public verb is unchanged: a save says WHAT, never WHERE or HOW.
  assert.deepEqual(gate.ACTION_FIELDS.save, ['action', 'n', 'fileName'])
})

test('*** the request denylist names them too — two rules, so widening one is argued with ***', () => {
  const { FORBIDDEN_FIELDS } = require('./executeRequestSchema')
  for (const bad of ['hwnd', 'message', 'wParam', 'lParam', 'nativeOperation']) {
    assert.ok(FORBIDDEN_FIELDS.includes(bad), 'FORBIDDEN_FIELDS must name ' + bad)
  }
})

test('*** a request carrying a window or a message is REFUSED, not ignored ***', () => {
  const S = require('./executeRequestSchema')
  // Built literally from REQUEST_FIELDS rather than through the producer, so the test states the
  // shape it is testing instead of inheriting it.
  const base = {
    schemaVersion: S.SCHEMA_VERSION,
    messageType: S.MESSAGE_TYPE,
    requestId: 'req_' + 'a'.repeat(24),
    approvalId: 'appr_' + 'b'.repeat(32),
    approvedOrderHash: 'c'.repeat(64),
    executionPackageManifestHash: 'd'.repeat(64),
    receiptHash: 'e'.repeat(64),
    canaryType: S.CANARY_TYPE,
    createdAt: '2026-08-02T12:00:00.000Z',
    expiresAt: '2026-08-02T12:30:00.000Z'
  }
  const { validateRequest } = S
  assert.equal(validateRequest(base).ok, true,
    'the base request must be VALID, or every refusal below could be for the wrong reason: ' + JSON.stringify(validateRequest(base)))
  for (const bad of ['hwnd', 'message', 'wParam', 'lParam', 'nativeOperation']) {
    const v = validateRequest(Object.assign({}, base, { [bad]: 1234 }))
    assert.equal(v.ok, false, bad + ' must be refused')
    // `refusal` is the CODE; `reason` is the human sentence. Checking the sentence would have
    // accepted any refusal at all, which is how a guard passes while guarding nothing.
    assert.ok(['forbidden_field', 'unexpected_field'].includes(v.refusal),
      bad + ' must be refused BY NAME, got ' + JSON.stringify(v))
    assert.equal(v.detail, bad, 'and the refusal names the offending field')
  }
})

/* ── 5. an order may not carry a target either ────────────────────────────── */

test('*** an order step carrying a window or a message is refused before anything runs ***', () => {
  const { createComputerExecutor } = require('./computerExecutor')
  const { computeOrderHash } = require('./sealedOrderGate')
  const ex = createComputerExecutor({ artifactStore: { write: () => ({ ok: true }) } })

  for (const bad of ['hwnd', 'message', 'wParam', 'lParam', 'automationId', 'className']) {
    const o = {
      orderId: 'wo_x',
      approvalId: 'appr_' + 'f'.repeat(32),
      sealed: true,
      sealedText: 'x',
      allowedPath: 'C:\\Aroma\\ComputerOperator-Test',
      maxSteps: 3,
      timeoutSec: 300,
      steps: [
        { n: 1, action: 'open_app', appId: 'notepad' },
        { n: 2, action: 'type_text', text: 'x' },
        { n: 3, action: 'save', fileName: 'a.txt', [bad]: 999 }
      ]
    }
    o.orderHash = computeOrderHash(o)
    const res = ex.execute(o, { flagOn: true })
    assert.equal(res.ok, false, bad + ' must not be executable')
    assert.equal(res.refusal, 'unexpected_field', bad + ' -> ' + res.refusal)
    assert.equal(res.desktopActions, 0, 'and ZERO desktop actions occurred')
  }
})

/* ── 6. the capability is INERT until a deliberate act wires it ───────────── */

/**
 * v0.1 ends at a review checkpoint. The helper exists, is reviewable and is tested — and cannot
 * be reached by anything: it is absent from the runner's script-id map (so `run()` refuses
 * `unknown_script_id`), absent from the execution package (so staging cannot copy it to the
 * operator account), and referenced by no production JavaScript.
 *
 * Asserted rather than described, because "nothing calls it yet" is a fact about today that
 * quietly stops being true. Wiring it turns these three red, which is the point: it becomes a
 * visible, deliberate act with an Owner approval attached, not a side effect of some other change.
 */
test('*** the native helper is UNREACHABLE — not in the runner script map ***', () => {
  const { SCRIPTS } = require('./powershellJsonRunner')
  const values = Object.values(SCRIPTS)
  assert.equal(values.includes('scripts/computer/nativeSaveActivation.ps1'), false,
    'wiring this is a separate act needing its own Owner GO — see DESIGN-001 §11')
})

test('*** the native helper is NOT in the execution package ***', () => {
  const { PACKAGE_FILES } = require('../../scripts/computer/executionPackage')
  assert.equal(PACKAGE_FILES.includes('scripts/computer/nativeSaveActivation.ps1'), false,
    'staging copies exactly PACKAGE_FILES, so an unpackaged helper cannot reach the operator account')
})

test('*** no production JavaScript references the helper or its op ***', () => {
  const offenders = []
  for (const f of walk(SRC).concat(walk(SCRIPTS))) {
    if (!f.endsWith('.js') || f.endsWith('.test.js')) continue
    const code = stripJs(fs.readFileSync(f, 'utf8'))
    if (/nativeSaveActivation|activate_bound_save|activateBoundSave/.test(code)) offenders.push(path.relative(REPO, f))
  }
  assert.deepEqual(offenders, [], 'nothing calls it yet, and that is the v0.1 end state:\n  ' + offenders.join('\n  '))
})

test('*** and the save action still cannot run — the live order has no save step ***', () => {
  const order = require('../../docs/governance/canary-work-order-2step.draft.json')
  assert.equal(order.steps.some((s) => s.action === 'save'), false,
    'a real save needs a new order, a new hash and a fresh Owner approval')
})
