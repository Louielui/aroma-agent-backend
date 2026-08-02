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

const { allScripts, scanAll, findUnrollHazards, findIndexHazards, blankComments, AUTOMATIC } = require('./powershellHazards')
const { PACKAGE_FILES } = require('../../scripts/computer/executionPackage')

/**
 * EVERY .ps1 IN THE DIRECTORY. Enumerated, never listed.
 *
 * This used to be four hand-written filenames under a comment claiming it was "every PowerShell
 * script this project owns and runs". There are fifty. Operator-MeasureNotepadLaunch.ps1 was
 * written after the list and nobody remembered to add it, so it was never scanned once — and it
 * then died on the exact hazard this file exists to prevent, at line 65, on the Owner's machine.
 *
 * A list somebody must remember to update is a list that is wrong the first busy day. The
 * meta-test below pins that this is derived from the filesystem, so a new script is covered by
 * existing rather than by being remembered.
 */
const OWNED = allScripts(SCRIPTS)

/** The subset that a canary actually runs — a hazard here is a hazard in an approved run. */
const PACKAGED = new Set(PACKAGE_FILES.filter((f) => f.endsWith('.ps1')).map((f) => f.split('/').pop()))

const src = (n) => fs.readFileSync(path.join(SCRIPTS, n), 'utf8')
const stripPs = (s) => s.replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '')

const runPs = (code) => spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', code], { encoding: 'utf8', timeout: 60000 })

/* ── 0. THE GUARD'S OWN COVERAGE ──────────────────────────────────────────── */

test('*** coverage is DERIVED from the directory — a new script cannot escape it ***', () => {
  // The failure this file is now written against is not a missing rule. It is a rule that was
  // never pointed at the file. So the first thing proven is the pointing.
  const onDisk = fs.readdirSync(SCRIPTS).filter((f) => f.toLowerCase().endsWith('.ps1')).sort()
  assert.deepEqual(OWNED, onDisk, 'OWNED must be the directory, not a copy of it')
  assert.ok(OWNED.length >= 40, 'sanity: this repo has dozens of scripts, not four — got ' + OWNED.length)

  // And the file that actually broke is in scope, by name, so this cannot regress quietly.
  assert.ok(OWNED.includes('Operator-MeasureNotepadLaunch.ps1'), 'the script that failed is scanned')
  for (const p of PACKAGED) {
    assert.ok(OWNED.includes(p), 'every packaged .ps1 is scanned: ' + p)
  }
})

test('*** POSITIVE CONTROL — a brand-new unscanned script WOULD be caught ***', () => {
  // Without this, "OWNED equals the directory" could be true of a scan that finds nothing.
  // A temp file with the exact failing shape must be reported, with the right line number.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-haz-'))
  const body = [
    '# a comment',
    '<# a block',
    '   spanning three',
    '   lines #>',
    'function F { @(Get-Process | Where-Object { $false }) }',
    '$x = F',
    'Write-Host $x.Count'
  ].join('\n')
  fs.writeFileSync(path.join(tmp, 'brand-new.ps1'), body, 'utf8')

  const found = scanAll(tmp)
  assert.ok(found['brand-new.ps1'], 'a new file is scanned without being registered anywhere')
  const hit = found['brand-new.ps1'].unroll[0]
  assert.equal(hit.variable, 'x')
  assert.equal(hit.operation, 'Count')
  // Line 7 of the file, counted in the FILE — the earlier scanner collapsed <# #> blocks and
  // reported line 4, which is a comment. A guard that names the wrong line teaches people to
  // distrust the guard.
  assert.equal(hit.line, 7, 'the reported line is the line in the file')
  assert.equal(hit.assignedAtLine, 6)
})

test('*** blankComments keeps a strict 1:1 line mapping ***', () => {
  const src = ['a', '<# one', 'two', 'three #>', 'b', 'c # trailing', "d = 'has # inside'"].join('\n')
  const out = blankComments(src)
  assert.equal(out.length, 7, 'line count is preserved exactly')
  assert.equal(out[0], 'a')
  assert.equal(out[4], 'b')
  assert.match(out[5], /^c\s*$/, 'a trailing comment is removed, its line is not')
  assert.match(out[6], /has # inside/, 'a # inside a string is not a comment')
})

/* ── 1. indexing a possibly-empty array ───────────────────────────────────── */

test('*** POSITIVE CONTROL — [0] on an empty array really does throw under StrictMode ***', () => {
  // Without this the guard below could be banning something harmless. Measured, not assumed:
  // this is the exact failure that made integrityLevel unmeasurable.
  const r = runPs("Set-StrictMode -Version Latest; $a=@(); try { $x=$a[0]; 'NO THROW' } catch { $_.Exception.GetType().Name }")
  assert.match(String(r.stdout).trim(), /IndexOutOfRangeException/, 'the hazard is real')

  const ok = runPs("Set-StrictMode -Version Latest; $a=@(); $x = $a | Select-Object -First 1; if ($null -eq $x) { 'NULL, NO THROW' }")
  assert.match(String(ok.stdout).trim(), /NULL, NO THROW/, 'and the fix genuinely avoids it')
})

test('*** no PACKAGED script indexes [0] into a pipeline or possibly-empty array ***', () => {
  const offenders = []
  for (const name of OWNED) {
    const code = stripPs(src(name))
    // @( ... )[0] and (pipeline)[0] are the shapes that bite. $array[0] after an explicit count
    // check is fine, and is not what this matches.
    for (const m of code.matchAll(/(@\([^)]*\)|\)\s*)\[\s*0\s*\]/g)) {
      if (PACKAGED.has(name)) offenders.push(name + ': ' + m[0])
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

/* ── 2b. THE SHAPE THAT ACTUALLY BIT: assign first, read .Count later ─────── */

test('*** POSITIVE CONTROL — @() INSIDE a function does not survive the return ***', () => {
  // This is the belief that made the bug invisible for four rounds. Get-NotepadProcs wrapped its
  // result in @() and was still returning $null, because PowerShell unrolls a function's output
  // on the way out. Measured here so nobody has to take it on faith again.
  const script = [
    'Set-StrictMode -Version Latest',
    'function Zero { @(Get-Process | Where-Object { $false }) }',   // @() INSIDE
    '$x = Zero',
    "if ($null -eq $x) { 'NULL' } else { 'NOT-NULL' }",
    "try { $null = $x.Count; 'COUNT-OK' } catch { 'COUNT-THROWS' }",
    "'WRAPPED=' + @($x).Count"
  ].join('; ')
  const out = String(runPs(script).stdout)
  assert.match(out, /NULL/, 'the @() inside the function did not survive the return')
  assert.match(out, /COUNT-THROWS/, 'so .Count is fatal under StrictMode')
  assert.match(out, /WRAPPED=0/, 'and @() at the USE site is what actually works')
})

test('*** no PACKAGED script assigns from a call and then reads .Count or indexes it ***', () => {
  // The rule the old guard did not have. It only matched `(Cmdlet arg).Count` — a parenthesised
  // call. The line that failed was `$pre.Count`, a plain variable, assigned two lines earlier.
  // Same family, different shape, and the shape nobody had written down.
  //
  // PACKAGED files only, as a HARD failure: these are the thirteen .ps1 a canary actually runs,
  // so a hazard here is a hazard inside an approved execution. Everything else is held to the
  // baseline below, which can shrink but not grow.
  const offenders = []
  for (const name of OWNED) {
    if (!PACKAGED.has(name)) continue
    for (const h of findUnrollHazards(src(name))) {
      offenders.push(name + ':' + h.line + '  $' + h.variable + (h.operation === 'index' ? '[…]' : '.Count') +
        '  (assigned at line ' + h.assignedAtLine + ')')
    }
  }
  assert.deepEqual(offenders, [],
    'wrap at the assignment — $x = @(Call):\n  ' + offenders.join('\n  '))
})

/* ── the rest of the repo: a baseline that can shrink and never grow ──────── */

const BASELINE = require('./powershellHazards.baseline.json')

function currentNonPackageFindings () {
  const out = {}
  for (const name of OWNED) {
    if (PACKAGED.has(name)) continue
    const source = src(name)
    const keys = []
    for (const h of findUnrollHazards(source)) keys.push('unroll:' + h.line + ':' + h.variable + ':' + h.operation)
    for (const h of findIndexHazards(source)) keys.push('index0:' + h.line)
    blankComments(source).forEach((l, i) => {
      for (const re of BARE_LAUNCH) { re.lastIndex = 0; if (re.test(l)) keys.push('bare:' + (i + 1)) }
    })
    if (keys.length) out[name] = [...new Set(keys)].sort()
  }
  return out
}

test('*** the non-package baseline can SHRINK but never GROW ***', () => {
  // Widening coverage from four files to fifty surfaced twelve pre-existing findings in staging
  // and provisioning scripts. They are recorded rather than silently fixed: they live in scripts
  // the Owner runs by hand, one at a time, and editing them was not what this round was for.
  //
  // Recording them is not the same as tolerating them. A NEW one fails this test immediately,
  // and none of them can be in a packaged file — asserted separately below.
  const current = currentNonPackageFindings()
  const added = []
  for (const [file, keys] of Object.entries(current)) {
    const known = BASELINE.findings[file] || []
    for (const k of keys) if (!known.includes(k)) added.push(file + ' ' + k)
  }
  assert.deepEqual(added, [],
    'new PowerShell hazards outside the execution package — fix them, do not add them to the baseline:\n  ' +
    added.join('\n  '))
})

test('*** the baseline can never cover a packaged script ***', () => {
  // The escape hatch must not reach the files that matter. If somebody ever adds a packaged
  // script here to make a build green, this goes red instead.
  for (const file of Object.keys(BASELINE.findings)) {
    assert.equal(PACKAGED.has(file), false, 'a packaged script must never be baselined: ' + file)
  }
})

test('*** the exact line that failed on the Owner\'s machine is now clean ***', () => {
  // Named explicitly, because this is the fourth member of this family and a general rule that
  // silently stops covering the specific case is how the third one came back.
  const code = src('Operator-MeasureNotepadLaunch.ps1')
  assert.deepEqual(findUnrollHazards(code), [], 'no unroll hazard remains in the measurement tool')
  assert.match(code, /\$pre = @\(Get-NotepadProcs\)/, 'line 63 wraps at the call site')
  assert.match(code, /\$preWins = @\(Get-NotepadWins\)/)
  // Every call site, not just the two that were reported.
  const calls = code.match(/\$\w+ = @?\(?Get-Notepad\w+/g) || []
  assert.ok(calls.length >= 6, 'all call sites present: ' + calls.length)
  for (const c of calls) assert.match(c, /= @\(Get-Notepad/, 'unwrapped call site: ' + c)
})

/* ── 3. automatic variables ───────────────────────────────────────────────── */

test('*** POSITIVE CONTROL — the automatic list is what really throws, measured ***', () => {
  // The old list banned ten names. SEVEN of them are assignable, including `$null =`, which is
  // the ordinary PowerShell null sink and appears all over this repo. That rule was invisible
  // only because the guard scanned four files; pointing it at fifty produced 14 instant false
  // failures. A rule that fires on correct code gets suppressed, and takes the real rules with it.
  for (const v of AUTOMATIC) {
    const out = String(runPs("Set-StrictMode -Version Latest; try { $" + v + " = 1; 'ALLOWED' } catch { 'THROWS' }").stdout).trim()
    assert.equal(out, 'THROWS', '$' + v + ' must really be read-only')
  }
  for (const v of ['null', 'args', 'input', 'PSScriptRoot', 'PSCommandPath', 'MyInvocation']) {
    const out = String(runPs("Set-StrictMode -Version Latest; try { $" + v + " = 1; 'ALLOWED' } catch { 'THROWS' }").stdout).trim()
    assert.equal(out, 'ALLOWED', '$' + v + ' is assignable and must NOT be banned')
    assert.ok(!AUTOMATIC.includes(v), '$' + v + ' must not be in the ban list')
  }
})

test('*** no owned script assigns to a read-only automatic variable ***', () => {
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
  for (const f of ['processId', 'sessionId', 'windowHandle', 'uiaRuntimeId', 'uiaControlType', 'uiaClassName']) {
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

/* ── bare-name external launches ──────────────────────────────────────────── */

/**
 * A bare program name is not "no path" — it is a path chosen by PATH, and PATH belongs to
 * whoever started the process. Measured for real: a bare `whoami` resolved to Git's Unix whoami
 * and returned nothing, so the identity attestation refused every snapshot.
 *
 * In uiaCanary the consequence would have been worse than a null field. A different `notepad`
 * earlier on PATH would be LAUNCHED, and every check upstream would still pass — the order, the
 * hashes and the attestation all describe the INTENT to open Notepad, and none of them describes
 * WHICH notepad.
 */
const BARE_LAUNCH = [
  // Start-Process -FilePath with a quoted literal that is not a rooted path
  /Start-Process\s+(-FilePath\s+)?'(?![A-Za-z]:|\\)[^'\/]+'/g,
  /Start-Process\s+(-FilePath\s+)?"(?![A-Za-z]:|\\)[^"\/]+"/g,
  // & 'name' or & name — the call operator against something unrooted and unvariabled
  /&\s+'(?![A-Za-z]:|\\|\$)[^'\/]+\.exe'/g,
  /&\s+(?!\$|\()[A-Za-z][\w.-]*\.exe\b/g,
  // a bare native command sitting at the start of a statement
  /(^|[;{]\s*)(whoami|net|reg|sc|cmd|tasklist|taskkill|icacls|schtasks)\s/gm
]

test('*** no PACKAGED PowerShell script launches an external program by bare name ***', () => {
  const offenders = []
  for (const name of OWNED) {
    if (!PACKAGED.has(name)) continue
    const code = stripPs(src(name))
    for (const re of BARE_LAUNCH) {
      for (const m of code.matchAll(re)) {
        offenders.push(name + ': ' + m[0].trim().slice(0, 60))
      }
    }
  }
  assert.deepEqual(offenders, [],
    'build the path from $env:SystemRoot and Test-Path it:\n  ' + offenders.join('\n  '))
})

test('*** POSITIVE CONTROL — the bare-name rule catches real samples and permits absolute ones ***', () => {
  // Without this, "no offenders" could mean the patterns match nothing at all. Each caught
  // sample is a shape that has actually appeared in this repo.
  const caught = (s) => BARE_LAUNCH.some((re) => { re.lastIndex = 0; return re.test(s) })

  for (const bad of [
    "$proc = Start-Process -FilePath 'notepad' -PassThru",   // the exact line just fixed
    'Start-Process -FilePath "calc" -PassThru',
    "$r = & 'whoami.exe' /groups",
    '$x = & tasklist.exe /fo csv',
    'whoami /groups /fo csv | ConvertFrom-Csv'                // the exact shape that returned null
  ]) {
    assert.equal(caught(bad), true, 'must be caught: ' + bad)
  }

  for (const good of [
    "$exe = Join-Path $env:SystemRoot 'System32\notepad.exe'",
    '$proc = Start-Process -FilePath $notepadExe -PassThru',
    "$rows = @(& $whoamiExe /groups /fo csv)",
    "Start-Process -FilePath 'C:\Windows\System32\notepad.exe'"
  ]) {
    assert.equal(caught(good), false, 'must be permitted: ' + good)
  }
})

test('*** uiaCanary resolves Notepad absolutely, and refuses rather than falling back ***', () => {
  const code = stripPs(src('uiaCanary.ps1'))
  // `\\n` here, not `\n`: in a regex literal `\notepad` is a NEWLINE followed by "otepad", so
  // the first version searched for something that could never appear. Fourth backslash-eaten-by-
  // a-layer bug this round — the transport had it, the fixture had it, and now the assertion.
  assert.match(code, /Join-Path \$env:SystemRoot 'System32\\notepad\.exe'/, 'built from SystemRoot')
  assert.match(code, /Test-Path -LiteralPath \$notepadExe/, 'existence is verified')
  assert.match(code, /Emit-Refusal 'app_binary_missing'/, 'a missing binary is a structured refusal')
  assert.doesNotMatch(code, /Start-Process\s+-FilePath\s+'notepad'/, 'no bare-name launch remains')
  // And the path cannot be influenced by the payload.
  const launchBlock = code.slice(code.indexOf('$notepadExe'), code.indexOf('-PassThru'))
  assert.doesNotMatch(launchBlock, /\$payload/, 'the path is never derived from caller data')
})
