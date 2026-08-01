'use strict'

/**
 * strictModeRegression.test.js — the PowerShell hazards that have actually cost this project
 * runs, turned into guards that go red on a repeat.
 *
 * All three share a shape: they are fatal ONLY under Set-StrictMode -Version Latest, they pass
 * review, they pass a parse check, and each one failed in the direction that looks like a clean
 * measurement rather than an error. That last part is why they need tests rather than care.
 *
 *   1. [0] on a possibly-empty array   -> IndexOutOfRangeException. Killed the integrity
 *                                         measurement, and did it by making the fallback below
 *                                         it unreachable, so the whole branch was dead code
 *                                         that looked live.
 *   2. .Count on an unwrapped result   -> PropertyNotFound on 0 or 1 elements. Only 2+ worked,
 *                                         which is the shape that would have been WRONG.
 *   3. assigning to $PID               -> read-only automatic variable.
 *
 * A fallback also needs proof it is REACHED. A fallback that never runs is indistinguishable
 * from one that works, until the primary path fails for real.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SCRIPTS = path.resolve(__dirname, '..', '..', 'scripts', 'computer')
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

/** Every PowerShell script this project owns and runs. */
const OWNED = ['uiaCanary.ps1', 'probe-machine.ps1', 'collect-identity.ps1', 'aromaJsonTransport.ps1']

const src = (n) => fs.readFileSync(path.join(SCRIPTS, n), 'utf8')
const stripPs = (s) => s.replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '')

const runPs = (code) => spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', code], { encoding: 'utf8', timeout: 60000 })

/* ── 1. indexing a possibly-empty array ───────────────────────────────────── */

test('*** POSITIVE CONTROL — [0] on an empty array really does throw under StrictMode ***', () => {
  // Without this the guard below could be banning something harmless. Measured, not assumed:
  // this is the exact failure that made integrityLevel unmeasurable.
  const r = runPs("Set-StrictMode -Version Latest; $a=@(); try { $x=$a[0]; 'NO THROW' } catch { $_.Exception.GetType().Name }")
  assert.match(String(r.stdout).trim(), /IndexOutOfRangeException/, 'the hazard is real')

  const ok = runPs("Set-StrictMode -Version Latest; $a=@(); $x = $a | Select-Object -First 1; if ($null -eq $x) { 'NULL, NO THROW' }")
  assert.match(String(ok.stdout).trim(), /NULL, NO THROW/, 'and the fix genuinely avoids it')
})

test('*** no owned script indexes [0] into a pipeline or possibly-empty array ***', () => {
  const offenders = []
  for (const name of OWNED) {
    const code = stripPs(src(name))
    // @( ... )[0] and (pipeline)[0] are the shapes that bite. $array[0] after an explicit count
    // check is fine, and is not what this matches.
    for (const m of code.matchAll(/(@\([^)]*\)|\)\s*)\[\s*0\s*\]/g)) {
      offenders.push(name + ': ' + m[0])
    }
  }
  assert.deepEqual(offenders, [], 'use Select-Object -First 1:\n  ' + offenders.join('\n  '))
})

/* ── 2. .Count on an unwrapped result ─────────────────────────────────────── */

test('*** POSITIVE CONTROL — .Count on an unwrapped call throws for 0 and 1 elements ***', () => {
  const one = runPs("Set-StrictMode -Version Latest; function F { return @(1) }; try { (F).Count; 'NO THROW' } catch { 'THREW' }")
  assert.match(String(one.stdout).trim(), /THREW/, 'one element throws — the CORRECT case')
  const none = runPs("Set-StrictMode -Version Latest; function F { return @() }; try { (F).Count; 'NO THROW' } catch { 'THREW' }")
  assert.match(String(none.stdout).trim(), /THREW/, 'zero elements throws too')
  const fixed = runPs("Set-StrictMode -Version Latest; function F { return @(1) }; @(F).Count")
  assert.equal(String(fixed.stdout).trim(), '1', 'wrapping at the CALL SITE is what fixes it')
})

test('*** no owned script reads .Count off an unwrapped call ***', () => {
  const offenders = []
  for (const name of OWNED) {
    const code = stripPs(src(name))
    for (const m of code.matchAll(/(^|[^@\w])\(\s*([A-Za-z][\w-]*)\s[^()]*\)\s*\.Count\b/g)) {
      offenders.push(name + ': (' + m[2] + ' …).Count')
    }
  }
  assert.deepEqual(offenders, [], 'wrap the CALL SITE in @( ):\n  ' + offenders.join('\n  '))
})

/* ── 3. automatic variables ───────────────────────────────────────────────── */

test('*** no owned script assigns to an automatic variable ***', () => {
  const AUTOMATIC = ['PID', 'args', 'input', 'host', 'true', 'false', 'null', 'PSScriptRoot', 'PSCommandPath', 'Error']
  const offenders = []
  for (const name of OWNED) {
    const code = stripPs(src(name))
    for (const v of AUTOMATIC) {
      const re = new RegExp('\\$' + v + '\\s*=(?!=)', 'g')
      for (const m of code.matchAll(re)) offenders.push(name + ': $' + v + ' =')
    }
  }
  assert.deepEqual(offenders, [], 'automatic variables are read-only:\n  ' + offenders.join('\n  '))
})

/* ── the integrity fallback: proven REACHED, not merely present ───────────── */

/**
 * The fallback in collect-identity.ps1 exists because WindowsIdentity.Groups does not carry the
 * integrity SID on this machine. These three tests drive the exact expression the collector
 * uses, against fixtures, so that "the fallback works" is measured rather than hoped.
 */
const FALLBACK = (groupsExpr, whoamiExpr) => `
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$reached = $false
$sidList = ${groupsExpr}
$lvl = $sidList | Where-Object { $_ -like 'S-1-16-*' } | Select-Object -First 1
if (-not $lvl) {
  $reached = $true
  $lvl = ${whoamiExpr}
}
$level = switch ($lvl) {
  'S-1-16-8192'  { 'Medium' }
  'S-1-16-12288' { 'High' }
  default        { if ($lvl) { $lvl } else { $null } }
}
"reached=$reached level=$level"
`

test('*** FIXTURE: Groups without an integrity SID -> the whoami fallback IS reached ***', () => {
  // The fixture is the whole point: with no S-1-16-* in Groups, the primary path yields nothing
  // and the fallback must run. If it did not, this project would have shipped dead code that
  // looked live for the second time.
  // NOTE the doubled backslash: in a JS string "System32\whoami.exe" collapses to
  // "System32whoami.exe", which of course does not exist — so the fixture reported the fallback
  // as unreached and looked like the very bug it was written to catch.
  const WHOAMI = "@(& (Join-Path $env:SystemRoot 'System32\\whoami.exe') /groups /fo csv | ConvertFrom-Csv | Where-Object { $_.SID -like 'S-1-16-*' } | Select-Object -First 1).SID"
  const r = runPs(FALLBACK("@('S-1-1-0','S-1-5-32-545')", WHOAMI))
  const out = String(r.stdout).trim()
  assert.match(out, /reached=True/, 'the fallback was actually called')
  assert.match(out, /level=(Medium|High)/, 'and it produced a complete value')
})

test('*** FIXTURE: Groups WITH an integrity SID -> the fallback is not needed ***', () => {
  // The other direction, so "reached=True" above is known to mean something.
  const r = runPs(FALLBACK("@('S-1-1-0','S-1-16-8192')", "'UNREACHED'"))
  const out = String(r.stdout).trim()
  assert.match(out, /reached=False/, 'the primary path answered')
  assert.match(out, /level=Medium/)
})

test('*** FIXTURE: both paths fail -> null, which the judge refuses ***', () => {
  const r = runPs(FALLBACK("@('S-1-1-0')", '$null'))
  assert.match(String(r.stdout).trim(), /reached=True level=$/, 'no value is invented')

  // And the judge turns that into a refusal rather than a partial pass.
  const { attest } = require('./identityAttestation')
  const snap = {
    account: 'AROMABRAIN\\AromaOperator',
    sid: 'S-1-5-21-2042659270-2029498691-2127769412-1009',
    sessionId: 2,
    desktop: 'WinSta0\\Default',
    isElevated: false,
    isInteractive: true,
    integrityLevel: null,
    groupSids: ['S-1-5-32-545'],
    administratorsPresent: false,
    administratorsEnabled: false,
    collectorVersion: 1,
    collectorSha256: 'a'.repeat(64),
    processId: 1,
    attestedAt: '2026-08-01T00:00:00.000Z'
  }
  const v = attest(snap)
  assert.equal(v.ok, false)
  assert.equal(v.refusal, 'incomplete_attestation')
  assert.match(v.detail, /integrityLevel/)
})

test('the real collector measures integrity on this machine', () => {
  // End to end, as itself. It will refuse on identity — this session is louis — but every field
  // must be present, which is the thing that was broken.
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, 'collect-identity.ps1')],
    { encoding: 'utf8', input: Buffer.from('{}', 'utf8').toString('base64'), timeout: 60000 })
  const line = String(r.stdout).split(/\r?\n/).find((l) => l.startsWith('AROMA_JSON_B64:'))
  assert.ok(line, 'the collector emitted an envelope: ' + String(r.stdout).slice(0, 150))
  const snap = JSON.parse(Buffer.from(line.slice('AROMA_JSON_B64:'.length).trim(), 'base64').toString('utf8'))
  assert.ok(snap.integrityLevel, 'integrityLevel is measured, not null')
  const { REQUIRED_FIELDS } = require('./identityAttestation')
  const missing = REQUIRED_FIELDS.filter((f) => snap[f] === undefined || snap[f] === null)
  assert.deepEqual(missing, [], 'every required field measures')
})

/* ── validation before action ─────────────────────────────────────────────── */

test('*** uiaCanary validates required fields BEFORE touching any property ***', () => {
  const code = stripPs(src('uiaCanary.ps1'))
  const validateAt = code.indexOf('$REQUIRED_FIELDS')
  const dispatchAt = code.indexOf('switch ($op) {')
  assert.ok(validateAt > 0, 'the field table exists')
  assert.ok(dispatchAt > validateAt, 'validation runs BEFORE the op dispatch')
  assert.match(code, /Emit-Refusal 'missing_field'/, 'a missing field is a named refusal')
  // A binding is all four fields or none.
  for (const f of ['processId', 'sessionId', 'windowHandle', 'uiaControlId']) {
    assert.ok(code.includes(f), 'bind.' + f + ' is checked')
  }
})

test('*** transport-level refusals are STRUCTURED, and open no Notepad ***', () => {
  const { buildProductionRunner } = require('./powershellJsonRunner')
  const R = buildProductionRunner()
  const npCount = () => {
    const r = runPs('@(Get-Process -Name notepad -EA SilentlyContinue).Count')
    return String(r.stdout).trim()
  }
  const before = npCount()

  for (const [label, payload, reason] of [
    ['no op', {}, 'bad_payload'],
    ['unknown op', { op: 'not_a_real_op' }, 'unknown_op'],
    ['wrong app', { op: 'open_app', appId: 'cmd' }, 'app_not_allowed'],
    ['no bind', { op: 'type_text', text: 'x' }, 'missing_field'],
    ['partial bind', { op: 'type_text', text: 'x', bind: { processId: 1 } }, 'missing_field']
  ]) {
    const r = R.run('uia-canary', payload)
    assert.equal(r.ok, true, label + ': the transport itself succeeded')
    assert.equal(r.result.ok, false, label + ': the script refused')
    assert.equal(r.result.reason, reason, label)
  }
  assert.equal(npCount(), before, 'Notepad count unchanged')
  assert.equal(before, '0', 'and it was zero throughout')
})
