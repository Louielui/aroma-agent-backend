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
  // THE THREE LINES ARE IN TRADITIONAL CHINESE, and pinned here exactly.
  // Louie reads them at the machine with nobody to help; every other communication with him is
  // in Chinese, so an English failure screen is a failure screen he cannot use. Pinned so a
  // later edit cannot quietly soften or re-word them.
  assert.match(core, /CX_FAILSAFE_LINE1\s*=\s*'已經停止 —— 而且係安全咁停低咗。'/)
  assert.match(core, /CX_FAILSAFE_LINE2\s*=\s*'已經記錄低咗。冇任何嘢需要你去修。'/)
  assert.match(core, /CX_FAILSAFE_LINE3\s*=\s*'影一張相，然後就可以停手。'/)
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

test('*** any script with Chinese in it is UTF-8 WITH BOM ***', () => {
  // PowerShell 5.1 reads a BOM-LESS .ps1 as ANSI. Every Chinese string would render as
  // mojibake — at the machine, on the failure screen, with nobody there to recognise it. The
  // encoding is therefore part of the guarantee, not a formatting preference.
  for (const f of files()) {
    const raw = fs.readFileSync(path.join(DIR, f))
    const hasChinese = /[一-鿿]/.test(raw.toString('utf8'))
    if (!hasChinese) continue
    assert.ok(raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF,
      f + ' contains Chinese and MUST be UTF-8 with BOM, or PowerShell 5.1 will mangle it')
  }
})

test('*** what Louie can SEE is in Chinese, not English ***', () => {
  // Step labels and banners are the screen. A stray English label is not cosmetic: it is a
  // line he cannot act on. (Technical report files stay English by ruling — they are the
  // handoff artefact, not the screen.)
  for (const f of ['Owner-Sentinel-Launcher.ps1', 'Operator-Verification-Launcher.ps1']) {
    const c = code(f)
    for (const m of c.matchAll(/@\('(\w+)',\s*'([^']+)'\)/g)) {
      assert.ok(/[一-鿿]/.test(m[2]), f + ' step label is not in Chinese: ' + m[2])
    }
    assert.match(c, /-Title 'Aroma 第[一二]步/, f + ' window title is in Chinese')
  }
})

test('*** no character from the rare CJK Extension-A block appears anywhere ***', () => {
  // 䇄 (U+41C4) was written for 雙 (U+96D9) three times in the guide. It is a TYPO, not a
  // corruption: those are unrelated codepoints with no shared bytes, and corruption yields
  // U+FFFD or Latin-1 garbage, never a different VALID ideograph.
  //
  // But eyeballing Cantonese for a wrong-but-valid character is exactly what fails when one
  // person reads it alone at a machine. Ordinary Traditional Chinese lives in U+4E00-U+9FFF;
  // anything from Extension A (U+3400-U+4DBF) in this material is a mistyped character.
  const all = files().map((f) => path.join(DIR, f))
  all.push(path.resolve(__dirname, '..', '..', 'docs', 'governance', 'COMMISSIONING-ONE-PAGE.md'))
  for (const f of all) {
    const txt = fs.readFileSync(f, 'utf8')
    for (const ch of txt) {
      const c = ch.codePointAt(0)
      assert.ok(!(c >= 0x3400 && c <= 0x4DBF),
        path.basename(f) + ' contains a rare Extension-A character ' + ch +
        ' (U+' + c.toString(16).toUpperCase() + ') — almost certainly a mistyped ideograph')
    }
  }
})

test('*** nothing Louie reads is mojibake or lossy ***', () => {
  // Round-trip the bytes: invalid UTF-8 would not reproduce them. Then look for the two
  // signatures of a bad decode — U+FFFD, and UTF-8 bytes read as Latin-1/CP1252.
  const all = files().map((f) => path.join(DIR, f))
  all.push(path.resolve(__dirname, '..', '..', 'docs', 'governance', 'COMMISSIONING-ONE-PAGE.md'))
  for (const f of all) {
    const raw = fs.readFileSync(f)
    const txt = raw.toString('utf8')
    assert.ok(Buffer.from(txt, 'utf8').equals(raw), path.basename(f) + ' is not valid UTF-8')
    assert.equal(/�/.test(txt), false, path.basename(f) + ' contains U+FFFD (a lossy decode)')
    assert.equal(/[Â-Ã][-¿]/.test(txt), false,
      path.basename(f) + ' contains a UTF-8-read-as-Latin-1 mojibake sequence')
  }
})

test('*** Chinese text uses fullwidth punctuation, not halfwidth ***', () => {
  // Mixed , : ; among 。、 reads as broken to the person it is written for, even though it is
  // not corruption. Checked only where an ideograph is immediately adjacent, which is what
  // keeps code punctuation out of scope.
  for (const f of files()) {
    const txt = fs.readFileSync(path.join(DIR, f), 'utf8')
    for (let i = 0; i < txt.length; i++) {
      if (!',:;'.includes(txt[i])) continue
      const adjacent = /[一-鿿]/.test(txt[i - 1] || '') || /[一-鿿]/.test(txt[i + 1] || '')
      assert.ok(!adjacent, f + ' uses halfwidth "' + txt[i] + '" next to Chinese: ...' +
        txt.slice(Math.max(0, i - 12), i + 12).replace(/\r?\n/g, ' ') + '...')
    }
  }
})

test('*** the two desktop icon names match what the guide tells Louie to look for ***', () => {
  // Launcher 1 checks for the operator icon BY NAME. If the installer and the launcher drift
  // apart, launcher 1 reports "the second icon could not be placed" while it is sitting there.
  const inst = fs.readFileSync(path.join(DIR, 'install-commissioning.ps1'), 'utf8')
  const own = fs.readFileSync(path.join(DIR, 'Owner-Sentinel-Launcher.ps1'), 'utf8')
  assert.match(inst, /-Name 'Aroma 第一步 —— 擁有者標記'/)
  assert.match(inst, /-Name 'Aroma 第二步 —— 操作員檢查'/)
  assert.match(own, /'Aroma 第二步 —— 操作員檢查\.lnk'/,
    'launcher 1 must look for exactly the name the installer creates')
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
