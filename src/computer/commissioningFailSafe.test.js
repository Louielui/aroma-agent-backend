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
                      'Report-Reader-Launcher.ps1', 'Retention-Check-Launcher.ps1', 'bootstrap-owner-icon.ps1',
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
  for (const f of ['Owner-Sentinel-Launcher.ps1', 'Operator-Verification-Launcher.ps1',
                   'Report-Reader-Launcher.ps1', 'Retention-Check-Launcher.ps1']) {
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

  // The report reader is a THIRD icon, pressed after the visit rather than during it. It is
  // owner-side, so the bootstrap can place it without elevation - and must, for the same
  // reason icon 1 must: nothing else runs before it.
  const boot = fs.readFileSync(path.join(DIR, 'bootstrap-owner-icon.ps1'), 'utf8')
  assert.match(inst, /-Name 'Aroma 報告 —— 攞返驗收報告'/)
  assert.match(boot, /-Name 'Aroma 報告 —— 攞返驗收報告' -Script 'Report-Reader-Launcher\.ps1'/)
  assert.match(boot, /-Name 'Aroma 第一步 —— 擁有者標記' -Script 'Owner-Sentinel-Launcher\.ps1'/)
})

test('*** the report reader can retrieve every round, and never writes to the evidence ***', () => {
  // WHY IT EXISTS: the commissioning reports live under the evidence root, which needs
  // elevation to read (handoff §10). Round 1e80253806ce was therefore diagnosed from source
  // alone - sound, but inference is not reading. This is what makes the reports readable.
  const rd = code('Report-Reader-Launcher.ps1')

  // It must elevate itself. Louie answers UAC; he is never told to right-click.
  assert.match(rd, /Verb RunAs/, 'the reader must self-elevate')

  // EVERY round, not the latest one: the point is that any future report is retrievable too.
  assert.match(rd, /Get-ChildItem -LiteralPath \$script:CX_CommissionRoot -Directory/,
    'it must enumerate all rounds, not a single named one')

  // READ-ONLY on the evidence. A reader that can damage the record is not a reader. Nothing
  // may remove, move or overwrite anything under the evidence root.
  for (const m of rd.matchAll(/(Remove-Item|Move-Item|Set-Content|Out-File)[^\n]*/g)) {
    assert.equal(/CX_CommissionRoot|CX_EvidenceRoot|\$srcDir|\$f\.FullName/.test(m[0]), false,
      'the reader must never write to the evidence: ' + m[0].slice(0, 70))
  }
  // and the copy direction is out of the evidence, never into it
  assert.match(rd, /Copy-Item -LiteralPath \$f\.FullName -Destination \$target/,
    'copies must go from the evidence to the destination')
})

test('*** the FIRST icon has a named creator and is never assumed to exist ***', () => {
  // THE BUG THIS PINS: install-commissioning.ps1 creates both icons, but it only ever runs
  // FROM launcher 1 - which is started by pressing icon 1. Icon 1 could therefore only be
  // created by something that could not run until icon 1 already existed. It silently did not
  // exist, and the single icon Louie must press to begin was missing when he went to look.
  // Every other guarantee here is worthless if there is nothing to press.
  const boot = path.join(DIR, 'bootstrap-owner-icon.ps1')
  assert.equal(fs.existsSync(boot), true,
    'bootstrap-owner-icon.ps1 must exist: something outside the launcher must create icon 1')
  const src = fs.readFileSync(boot, 'utf8')
  assert.match(src, /Aroma 第一步 —— 擁有者標記/, 'and it must create exactly that icon name')
  assert.match(src, /Owner-Sentinel-Launcher\.ps1/, 'pointing at launcher 1')

  // It must run as Louie WITHOUT elevation - an elevation prompt is one more thing that can
  // block the only path in, and writing into his own profile does not need it.
  assert.equal(/Verb RunAs|Requires -RunAsAdministrator/.test(stripPs(src)), false,
    'the bootstrap must not require elevation to write into the owner profile')

  // It must VERIFY the file landed. "I created it" is not evidence, and on these paths the
  // shortcut COM object blanks instead of failing.
  assert.match(stripPs(src), /Test-Path -LiteralPath \$lnk|\$got\.Length -eq \$srcLen/,
    'the bootstrap must verify the icon is really on disk after writing it')
  assert.match(stripPs(src), /exit 1/, 'and must exit non-zero if no icon was placed')
})

test('*** desktop locations are resolved, never hardcoded to \\Users\\<name>\\Desktop ***', () => {
  // MEASURED on this machine: the desktop can be OneDrive-redirected to a LOCALISED folder
  // (C:\Users\louis\OneDrive\桌面) while C:\Users\louis\Desktop ALSO exists with items in it.
  // A hardcoded guess puts the icon where Louie cannot see it - indistinguishable, to him,
  // from the icon not existing.
  for (const f of ['install-commissioning.ps1', 'bootstrap-owner-icon.ps1']) {
    const src = stripPs(fs.readFileSync(path.join(DIR, f), 'utf8'))
    assert.equal(/Join-Path 'C:\\Users'/.test(src), false,
      `${f} must not assume the profile folder is named after the account`)
    assert.match(src, /OneDrive\\桌面/,
      `${f} must consider the localised OneDrive desktop`)
  }
  const inst = stripPs(fs.readFileSync(path.join(DIR, 'install-commissioning.ps1'), 'utf8'))
  // and a desktop it cannot find must be a hard stop, not a yellow warning: a skipped operator
  // icon is only discovered by Louie, mid-run, in the other account, with nothing to press.
  assert.match(inst, /throw \("no desktop folder could be found for/,
    'a missing desktop must throw, so the fail-safe screen reports it')
  assert.equal(/SKIPPED \(no desktop\)/.test(inst), false,
    'the old warn-and-continue path must be gone')

  // MEASURED in PowerShell 5.1: a function ending `return ,$arr`, read back through the
  // caller's @(...), yields a 1-element array holding the array - count=1 EVEN WHEN EMPTY.
  // That makes the throw above unreachable and hands Join-Path an array instead of a path,
  // i.e. it silently converts "no desktop" into "icon written somewhere meaningless".
  assert.equal(/return ,\$out\.ToArray\(\)/.test(inst), false,
    'Resolve-DesktopPaths must not use a leading comma: the caller re-wraps with @()')
  assert.match(inst, /\$desktops = @\(Resolve-DesktopPaths/,
    'and the caller must wrap with @() so the empty case is really count 0')

  // MEASURED during round 1e80253806ce: the OPERATOR's icon was placed on LOUIS's desktop.
  // Cause: User Shell Folders values are REG_EXPAND_SZ, and Get-ItemProperty expands them
  // against the CURRENT PROCESS environment - so reading another account's
  // "%USERPROFILE%\Desktop" returns *this* user's desktop, which then passes Test-Path and
  // looks like a perfectly good answer.
  assert.equal(/Get-ItemProperty -Path \$k -Name 'Desktop'/.test(inst), false,
    "another account's shell folders must not be read through the expanding API")
  assert.match(inst, /DoNotExpandEnvironmentNames/,
    'the raw value must be read and substituted manually')
  // and the belt that makes the whole class impossible, not just this instance
  assert.match(inst, /\$out \| Where-Object \{ \$_ -notlike \(\$root \+ '\\\*'\) \}/,
    "any desktop outside that account's own profile must be discarded")
})

test('*** shortcut names in Chinese are built via an ASCII path, not saved directly ***', () => {
  // MEASURED: WScript.Shell.CreateShortcut saves through an ANSI code path. With a non-Chinese
  // system locale it wrote "Aroma ??? —— ?????.lnk" and threw; inside OneDrive\桌面 it failed
  // even for an ASCII filename, because the FOLDER name cannot be encoded either. Worse, on
  // read-back it returns a BLANK shortcut rather than erroring - so a naive verification of a
  // never-written icon reports success. Both icon names are Chinese, so this would have taken
  // out the operator icon too, discovered only at step 3 in the other account.
  for (const f of ['install-commissioning.ps1', 'bootstrap-owner-icon.ps1']) {
    const src = stripPs(fs.readFileSync(path.join(DIR, f), 'utf8'))
    assert.match(src, /\$asciiTemp/, `${f} must build the .lnk at an ASCII path`)
    assert.match(src, /\[\^\\u0000-\\u007F\]/, `${f} must check that temp path is really ASCII`)
    assert.match(src, /Copy-Item -LiteralPath \$src/, `${f} must copy the finished bytes into place`)
    // the Save() must target the temp path, never the Chinese destination
    assert.equal(/CreateShortcut\(\$lnkPath\)|CreateShortcut\(\$lnk\b/.test(src), false,
      `${f} must not CreateShortcut directly on the destination path`)
  }
})

test('*** the commissioning round mints the manifest the HARNESS reads, every round ***', () => {
  // THE BUG THIS PINS: round 1e80253806ce died at stage3-harness.ps1 exit 11, "nonce already
  // burned". Two unrelated nonce systems, never joined: commissioning minted
  // <round>\MANIFEST.json for its own handoff, while the harness reads Part A's
  // stage3-manifest.json in the evidence root - minted by stage3-manifest.ps1, a script the
  // commissioning path never called. It therefore read the leftover manifest from the earlier
  // manual run, found consumed=true, and refused exactly as designed.
  const prep = code('commissioningPrepare.ps1')
  assert.match(prep, /stage3-manifest\.ps1/,
    'preparation must mint the manifest the harness actually reads')
  assert.match(prep, /\[switch\]\$ManifestOnly/, 'and expose it as a per-round step')

  // The one-shot nonce must be preserved, not bypassed. A blanket -Force would silently
  // discard a live manual Part A run - the precise thing the one-shot nonce exists to stop.
  assert.match(prep, /if \(\$existing -and \$existing\.consumed -eq \$false\) \{ \$needMint = \$false \}/,
    'an existing UNCONSUMED manifest must be reused, never minted over')
  assert.match(prep, /if \(\$forceMint\) \{ \$mintArgs \+= '-Force' \}/,
    '-Force must be conditional on the previous run being finished')

  // Per ROUND, not once. Minting in phase 2 would leave a round-2 retry running against a
  // manifest round 1 already burned: the same failure one round later, which defeats the
  // retry cap entirely.
  const own = code('Owner-Sentinel-Launcher.ps1')
  const loopAt = own.indexOf('for ($round = 1')
  const callAt = own.indexOf('-ManifestOnly')
  assert.ok(loopAt > 0, 'the round loop must exist')
  assert.ok(callAt > loopAt,
    'the manifest step must run INSIDE the round loop, so each retry gets a fresh nonce')
})

test('*** a remote session is refused BEFORE the machine is touched ***', () => {
  // MEASURED 2026-07-30: the Owner ran this from rdp-tcp#0. Fast user switching is a CONSOLE
  // feature - from inside RDP, Ctrl+Alt+Del goes to the local machine and the security screen
  // offers no other session on the host. So step 2 of the guide has no button at all, and
  // without this check the Owner finds that out only after the machine has been prepared and
  // the launcher is sitting on a handoff nobody can answer.
  const core = code('commissioningCore.ps1')
  assert.match(core, /function CX-IsRemoteSession/, 'the core must be able to detect a remote session')
  // TWO independent signals: either alone can be wrong.
  assert.match(core, /TerminalServerSession/, 'the documented .NET property')
  assert.match(core, /SESSIONNAME -like 'RDP-\*'/, 'and what the session reports about itself')

  const own = code('Owner-Sentinel-Launcher.ps1')
  assert.match(own, /CX-IsRemoteSession/, 'launcher 1 must check it')
  assert.match(own, /Stage 'preflight\/remote'/, 'and stop through the fail-safe screen')

  // ORDER MATTERS: it must refuse before the machine is prepared, and before the
  // operator-session check, because it invalidates the run earlier than either.
  const remoteAt = own.indexOf('CX-IsRemoteSession')
  const sessAt = own.indexOf('CX-OperatorSession')
  const prepAt = own.indexOf('commissioningPrepare.ps1')
  assert.ok(remoteAt > 0 && sessAt > 0 && prepAt > 0, 'all three stages present')
  assert.ok(remoteAt < sessAt, 'the remote check must precede the operator-session check')
  assert.ok(remoteAt < prepAt, 'and must precede preparation - nothing may be changed first')

  // and the guide says it too, since the guide is read before the launcher runs
  const guide = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'docs', 'governance', 'COMMISSIONING-ONE-PAGE.md'), 'utf8')
  assert.match(guide, /遙距連線（RDP）/, 'the guide must warn about RDP up front')
})

test('*** RDP is refused BEFORE any nonce, sentinel, manifest or evidence exists ***', () => {
  // Owner requirement, prepare-only round: the remote check must stop the run before ANYTHING
  // is created. Not merely before "preparation" — before the first artefact of any kind, so a
  // refused run leaves no round directory, no burned nonce and no partial evidence to reason
  // about later. Ordering is asserted against every mutation site by name, because a check
  // that is merely "early" drifts down the file one edit at a time.
  const own = code('Owner-Sentinel-Launcher.ps1')
  const at = (s) => own.indexOf(s)
  const remoteAt = at('CX-IsRemoteSession')
  assert.ok(remoteAt > 0, 'the remote check must be present')

  const MUTATIONS = [
    ['round nonce', '$NONCE = [guid]::NewGuid()'],
    ['round directory', 'New-Item -ItemType Directory -Force -Path $dir'],
    ['commissioning manifest', "'MANIFEST.json'"],
    ['Part A run manifest', '-ManifestOnly'],
    ['owner sentinel', 'stage3-sentinel.ps1'],
    ['READY handoff', "'READY.json'"],
    ['machine preparation', 'commissioningPrepare.ps1']
  ]
  for (const [what, needle] of MUTATIONS) {
    const idx = at(needle)
    assert.ok(idx > 0, `expected to find the ${what} site (${needle})`)
    assert.ok(remoteAt < idx,
      `the remote check must precede ${what}: a refused run must leave nothing behind`)
  }

  // and the refusal itself must not create a round directory — CX-Fail with a null nonce
  // writes into the commissioning root rather than minting one.
  const joined = own.replace(/`\r?\n\s*/g, ' ')
  const refusal = joined.slice(joined.indexOf('CX-IsRemoteSession'))
  const call = refusal.slice(0, refusal.indexOf('exit 1'))
  assert.match(call, /CX-Fail -UI \$UI -Nonce \$null/,
    'the RDP refusal must not mint a round nonce to report against')
})

test('*** launcher 4 runs Lock 3 without turning Louie back into the executor ***', () => {
  // Owner ruling: without this, the visit ends with him opening PowerShell and pasting a
  // command — the exact role the two-press design exists to remove, arriving at the last step.
  const rc = code('Retention-Check-Launcher.ps1')
  assert.match(rc, /Verb RunAs/, 'it must self-elevate rather than ask for right-click')

  // It must call the TESTED sweep, not a second implementation. A PowerShell reimplementation
  // of the classifier would drift from evidenceStore.js exactly as the assertion ids and the
  // observer SHA pin did.
  assert.match(rc, /lock3-sweep\.js/, 'the sweep must be the JS one that has tests')
  assert.equal(/RETENTION_DAYS|classify\s*\(/.test(rc), false,
    'the retention rule and the classifier must not be duplicated in PowerShell')

  // Context first, and it must be able to refuse.
  const ctxAt = rc.indexOf('New-MeasurementContext')
  const sweepAt = rc.indexOf('lock3-sweep.js')
  assert.ok(ctxAt > 0 && sweepAt > 0 && ctxAt < sweepAt,
    'the measurement context must be captured before the sweep runs')
  assert.match(rc, /if \(-not \$ctx\.usable\)/, 'and an unusable context must stop the run')

  // Lock 3's own result and the context verdict are separate columns. A clean sweep inside a
  // mixed-condition record is a passed Lock 3 that still cannot be accepted, and the report
  // has to be able to say exactly that rather than collapsing to one word.
  assert.match(rc, /chainVerdict\s*=/, 'the report must carry the chain verdict separately')
  assert.match(rc, /verdict\s*=\s*\$\(if \(\$res\.ok\)/, 'and the sweep verdict separately')
})

test('*** pressing an icon that does not apply is HARMLESS, and says so in its own words ***', () => {
  // THE GAP THE OWNER FOUND: if Part B fails, should he still press the retention icon? The
  // guide did not say — so he would have stood at the machine, in front of a red screen,
  // DECIDING. That is the single thing this design exists to spare him, arriving at the last
  // step. The icon decides instead.
  const core = code('commissioningCore.ps1')
  assert.match(core, /CX_NA_LINE1\s*=\s*'Part B 未通過 —— 呢一步唔適用。'/)
  assert.match(core, /CX_NA_LINE2\s*=\s*'冇做過任何嘢，亦冇刪過任何嘢。'/)
  assert.match(core, /CX_NA_LINE3\s*=\s*'影一張相，然後就可以停手。'/)
  assert.match(core, /function CX-NotApplicable\b/)

  // It must NOT reuse the failure screen. Nothing broke, and telling him something stopped
  // unsafely when it merely does not apply teaches him to distrust the red screen that does
  // matter — so the amber outcome is a separate one, and stays separate.
  const na = core.slice(core.indexOf('function CX-NotApplicable'))
  assert.equal(/CX_FAILSAFE_LINE/.test(na.slice(0, na.indexOf('function CX-WaitForMarker'))), false,
    'the not-applicable screen must not borrow the failure wording')
  assert.match(na, /'wait'/, 'and must be amber, not the red failure banner')
})

test('*** launcher 4 refuses itself when Part B did not pass — before touching anything ***', () => {
  const rc = code('Retention-Check-Launcher.ps1')
  assert.match(rc, /CX-NotApplicable/, 'it must have a not-applicable path')
  assert.match(rc, /PARTB-SEALED\.json/, 'keyed on the sealed Part B verdict')
  assert.match(rc, /\$partBVerdict -ne 'PASS'/, 'and only PASS may proceed')

  // "no seal" and "sealed as FAIL" are different situations and must be reported as such.
  assert.match(rc, /elseif \(-not \$seal\)/, 'an unsealed round must be distinguished from a failed one')

  // ORDER: the gate must precede the context capture, the sweep and the DoD seal, so pressing
  // it after a failed Part B leaves the round exactly as Part B left it.
  const gateAt = rc.indexOf('$partBVerdict -ne')
  for (const [what, needle] of [
    ['the measurement context', 'New-MeasurementContext'],
    ['the sweep', 'lock3-sweep.js'],
    ['the DoD seal', 'CONTEXT-dod.json']
  ]) {
    const i = rc.indexOf(needle)
    assert.ok(i > 0 && gateAt < i, `the Part B gate must precede ${what}`)
  }
  // and it is not a failure: nothing went wrong, so it must not exit non-zero
  const tail = rc.slice(gateAt, rc.indexOf('$UI.SetStep(\'gate\', \'ok\''))
  assert.match(tail, /exit 0/, 'a not-applicable exit is not a failure exit')
})

test('*** the report icon is safe to press at ANY time ***', () => {
  // Owner requirement: it must be safe whenever, and KNOWN to be rather than assumed.
  const rd = code('Report-Reader-Launcher.ps1')

  // An empty store is not a failure. A red stop screen for an empty folder teaches the red
  // screen to mean nothing, and it has to keep meaning something.
  assert.match(rd, /CX-NotApplicable[\s\S]{0,400}exit 0/,
    'nothing-to-copy must be an amber not-applicable, exiting 0')
  assert.equal(/Stage 'source'/.test(rd), false, 'the old red-stop path for an empty store must be gone')

  // It must not depend on a run having finished, or on any run state at all.
  assert.equal(/PARTB-SEALED|OPERATOR-DONE|LOCK3-DONE/.test(rd), false,
    'the reader must not gate on run state — it copies whatever exists')

  // and still never writes into the evidence (re-asserted here because "safe at any time" is
  // exactly the claim that would be broken by a later convenience feature)
  for (const m of rd.matchAll(/(Remove-Item|Move-Item|Set-Content|Out-File)[^\n]*/g)) {
    assert.equal(/CX_CommissionRoot|CX_EvidenceRoot|\$srcDir|\$f\.FullName/.test(m[0]), false,
      'the reader must never write to the evidence: ' + m[0].slice(0, 70))
  }
})

test('*** the guide answers the Part B failure question in one sentence ***', () => {
  // The Owner asked for a definitive answer written down, because he reads this alone with
  // nobody to ask. Pinned so it cannot soften into "it depends".
  const guide = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'docs', 'governance', 'COMMISSIONING-ONE-PAGE.md'), 'utf8')
  assert.match(guide, /如果 Part B 冇通過，仲使唔使撳保留期檢查？/)
  assert.match(guide, /\*\*照撳。撳咗都唔會出事。\*\*/, 'the answer must be one unambiguous sentence')
  assert.match(guide, /呢個圖示幾時撳都安全|幾時撳都得/, 'and the report icon must be stated as always-safe')
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
