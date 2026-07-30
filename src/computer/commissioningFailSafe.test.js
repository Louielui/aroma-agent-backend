'use strict'

/**
 * commissioningFailSafe.test.js — THE GUARANTEE LOUIE IS OWED, ENFORCED RATHER THAN CLAIMED.
 *
 * There is ONE person at this machine. Every step written as "the executor does this first"
 * is a step Louie performs cold, on a path nobody has run — which is how the original problem
 * reappeared after it had supposedly been solved.
 *
 * So the promise is narrow and absolute:
 *
 *   WHATEVER GOES WRONG, LOUIE SEES ONE SCREEN. It says it stopped safely, that it has been
 *   recorded, and to take a photo and stop. It never asks him to choose, retry, diagnose,
 *   type, or read a stack trace.
 *
 * A promise like that cannot rest on the author having been careful — he has now written the
 * same class of defect four times in this phase. It rests on these tests.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const DIR = path.resolve(__dirname, '..', '..', 'scripts', 'commissioning')
const stripPs = (s) => s.split(/\r?\n/).map((l) => l.replace(/^\s*#.*$/, '')).join('\n')
const files = () => fs.readdirSync(DIR).filter((n) => n.endsWith('.ps1'))
const code = (f) => stripPs(fs.readFileSync(path.join(DIR, f), 'utf8'))

test('the commissioning scripts exist and are the expected set', () => {
  const set = files().sort()
  for (const need of ['commissioningCore.ps1', 'commissioningSelfCheck.ps1', 'commissioningPrepare.ps1',
                      'commissioningLock5.ps1', 'commissioningLock5Operator.ps1',
                      'Owner-Sentinel-Launcher.ps1', 'Operator-Verification-Launcher.ps1',
                      'install-commissioning.ps1']) {
    assert.ok(set.includes(need), 'missing: ' + need)
  }
})

test('*** NOTHING in the commissioning path can ask Louie a question ***', () => {
  // Every construct here would put a decision in front of him. None may appear anywhere,
  // including in a failure path — a failure path is EXACTLY where one would show up.
  const FORBIDDEN = [
    [/Read-Host/, 'Read-Host would ask him to type something'],
    [/PromptForChoice/, 'PromptForChoice would ask him to choose'],
    [/\[Console\]::ReadLine/, 'ReadLine would make him press Enter to continue'],
    [/\[Console\]::ReadKey/, 'ReadKey would make him press a key to continue'],
    [/Get-Credential/, 'Get-Credential would ask him for a password'],
    [/-Confirm:\s*\$true/, 'an explicit confirm prompt'],
    [/MessageBox\]::Show\([^)]*'(YesNo|YesNoCancel|OKCancel|RetryCancel|AbortRetryIgnore)'/, 'a dialog with a choice']
  ]
  for (const f of files()) {
    const c = code(f)
    for (const [re, why] of FORBIDDEN) {
      assert.equal(re.test(c), false, f + ' contains something that asks Louie to decide: ' + why)
    }
  }
})

test('*** every failure routes through the ONE fail-safe screen ***', () => {
  const core = code('commissioningCore.ps1')
  // the three lines, fixed, in the core and nowhere improvised
  assert.match(core, /CX_FAILSAFE_LINE1\s*=\s*'STOPPED - and it stopped safely\.'/)
  assert.match(core, /CX_FAILSAFE_LINE2\s*=\s*'It has been recorded\. There is nothing for you to fix\.'/)
  assert.match(core, /CX_FAILSAFE_LINE3\s*=\s*'Take a photo of this window, then stop\.'/)
  // the banner uses all three, and the written report repeats them
  assert.match(core, /function CX-FailSafeBanner/)
  for (const n of ['CX_FAILSAFE_LINE1', 'CX_FAILSAFE_LINE2', 'CX_FAILSAFE_LINE3']) {
    assert.ok((core.match(new RegExp(n, 'g')) || []).length >= 3, n + ' must reach the banner and the report')
  }
})

test('*** every catch block in a launcher ends in CX-Fail ***', () => {
  // A catch that merely logs, or one that lets execution continue, would leave Louie looking
  // at a half-finished screen with no instruction. Both launchers wrap everything.
  for (const f of ['Owner-Sentinel-Launcher.ps1', 'Operator-Verification-Launcher.ps1']) {
    const c = code(f)
    const catches = (c.match(/\bcatch\s*\{/g) || []).length
    assert.ok(catches >= 1, f + ' has a top-level catch')
    // the outermost catch is the last one and must call CX-Fail
    const tail = c.slice(c.lastIndexOf('catch'))
    assert.match(tail, /CX-Fail/, f + ' outermost catch must produce the fail-safe report')
  }
})

test('*** no failure path leaves the other session waiting forever ***', () => {
  // If the operator side dies, it still writes OPERATOR-DONE so the owner side stops waiting
  // and reports, rather than sitting on a wait banner until its timeout.
  const op = code('Operator-Verification-Launcher.ps1')
  assert.match(op, /OPERATOR-DONE\.json[\s\S]{0,400}verdict='FAIL'/,
    'a failing operator run still reports back')
  // and every wait is bounded
  const core = code('commissioningCore.ps1')
  assert.match(core, /\$deadline = \(Get-Date\)\.AddSeconds\(\$TimeoutSeconds\)/)
  for (const f of files()) {
    const c = code(f)
    // Join PowerShell backtick continuations first: these calls wrap across lines, so a
    // per-line scan would read half a statement and report a bound that is simply on the
    // next line. Then take CALL SITES only — the core's definition line is `function ... {`.
    const joined = c.replace(/`\r?\n\s*/g, ' ')
    for (const m of joined.matchAll(/CX-WaitForMarker(?!\s*\{)[^\n]*/g)) {
      assert.match(m[0], /-TimeoutSeconds/, f + ': every wait must be bounded — ' + m[0].slice(0, 70))
    }
  }
})

test('*** the launcher installs itself — there is no separate "executor" step ***', () => {
  // The earlier draft told Louie the installer and the dry run were somebody else's job. On a
  // machine with one human that sentence hands him the untested path it claimed to spare him.
  const own = code('Owner-Sentinel-Launcher.ps1')
  assert.match(own, /install-commissioning\.ps1'\)\s*-Quiet/, 'launcher 1 installs itself')
  assert.match(own, /commissioningSelfCheck\.ps1/, 'and self-checks before touching the machine')
  assert.match(own, /Verb RunAs/, 'and elevates itself rather than asking for right-click')
  // and the installer no longer claims to be someone else's job
  assert.equal(/EXECUTOR work/.test(fs.readFileSync(path.join(DIR, 'install-commissioning.ps1'), 'utf8')), false,
    'the installer must not describe itself as a separate person\'s step')
})

test('*** every &-invoked helper dot-sources the core ***', () => {
  // $script: variables set in the LAUNCHER's scope are not visible in a script invoked with &.
  // The self-check caught this at build time; this keeps it caught.
  for (const f of ['commissioningSelfCheck.ps1', 'commissioningPrepare.ps1',
                   'commissioningLock5.ps1', 'commissioningLock5Operator.ps1']) {
    assert.match(code(f), /\.\s*\(Join-Path \$PSScriptRoot 'commissioningCore\.ps1'\)/, f + ' must dot-source the core')
  }
})

test('*** the core declares no param block, so it cannot clobber a caller ***', () => {
  // Dot-sourcing runs the other script's param() in the CALLER's scope. That is how a bound
  // -SelfTest became $false and ran a real measurement in the Owner's session, twice.
  assert.equal(/^param\s*\(/m.test(code('commissioningCore.ps1')), false)
})

test('*** Part B is sealed before Lock 5 can open ***', () => {
  // Owner ruling: a Lock 5 failure may not invalidate a Part B pass.
  const own = code('Owner-Sentinel-Launcher.ps1')
  const sealAt = own.indexOf('PARTB-SEALED')
  const lock5At = own.indexOf('commissioningLock5.ps1')
  assert.ok(sealAt > 0 && lock5At > 0, 'both stages are present')
  assert.ok(sealAt < lock5At, 'the seal must be written before Lock 5 is invoked')
  assert.match(own, /partB = \[ordered\]@\{[\s\S]{0,200}sealedSha256/, 'the report carries the sealed hash')
  assert.match(own, /lock5 = \[ordered\]@\{/, 'and Lock 5 is a separate column')
})

test('*** the operator launcher never tries to elevate ***', () => {
  // MEASURED: AromaOperator is not in Administrators. A UAC prompt there would demand
  // credentials Louie must not type.
  const op = code('Operator-Verification-Launcher.ps1')
  assert.equal(/Verb RunAs/.test(op), false, 'launcher 2 must not attempt elevation')
  assert.equal(/CX-IsElevated/.test(op), false, 'and must not branch on elevation at all')
  // it checks IDENTITY instead — the thing that actually matters here
  assert.match(op, /\$sam -ne \$script:CX_Account/, 'launcher 2 refuses unless it is the Companion account')
})
