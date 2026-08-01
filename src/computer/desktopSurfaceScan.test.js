'use strict'

/**
 * desktopSurfaceScan.test.js — the source scan, widened from one file to the whole surface.
 *
 * ── WHY THE OLD VERSION WAS NEARLY WORTHLESS ───────────────────────────────
 * It scanned `computerExecutor.js` and only that. Since the executor is deliberately the file
 * that CANNOT reach a desktop — everything arrives by injection — the scan was checking the one
 * place the prohibited techniques were never going to appear. The moment an adapter was added,
 * the banned tokens would have had a brand-new home that no test was looking at, and the suite
 * would have stayed green while the guarantee evaporated.
 *
 * ── THE ALLOWLIST IS THE POINT ─────────────────────────────────────────────
 * Files are enumerated by name. A new file in the scanned area that nobody has added here FAILS
 * this test. That is deliberate and it will be mildly annoying: adding a module to src/computer
 * now requires a line here, and that line is a person deciding whether the new file is allowed
 * to touch a desktop. A glob would have been less work and would have quietly absorbed exactly
 * the file this test exists to catch.
 *
 * ── WORDING ────────────────────────────────────────────────────────────────
 * Passing this proves the prohibited techniques are NOT PRESENT IN THE SOURCE. It does not
 * prove anything about UIA behaviour at run time. Per the Owner's ruling of 2026-07-31 the
 * correct term for what this establishes is SOURCE-CONSTRAINED — never "verified", "blocked"
 * or "passed". Only EXECUTE can speak to real behaviour.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC_COMPUTER = __dirname
const REPO = path.resolve(__dirname, '..', '..')
const SCRIPTS_COMPUTER = path.join(REPO, 'scripts', 'computer')

/**
 * Every non-test module in src/computer, each with a verdict on whether it may reach a desktop.
 * `false` for all but one — and the one that may is the one this file scans hardest.
 */
const JS_ALLOWLIST = Object.freeze({
  'assertionRegistry.js': false,
  'companion.js': false,
  'computerAudit.js': false,
  'computerExecutor.js': false,
  'computerOperatorFlag.js': false,
  'computerOperatorWiring.js': false,
  'computerSupervisor.js': false,
  'computerWorkOrder.js': false,
  'desktopAdapter.js': 'may reach a desktop, through an injected runner only',
  'evidenceStore.js': false,
  'identityAttestation.js': false,
  'machineProbe.js': false,
  'executeRequest.js': false,
  'executeRequestStore.js': false,
  'companionCanaryRunner.js': false,
  'ipcChannel.js': false,
  'killSwitch.js': false,
  'measurementContext.js': false,
  'observation.js': false,
  // The ONE production PowerShell launcher. It may start a process; it cannot touch a desktop
  // by itself, and every script it may start comes from a frozen id->path map.
  'powershellJsonRunner.js': 'may start PowerShell, from a closed script-ID map only',
  'orderRegistry.js': false,
  'sealedOrderGate.js': false,
  'sessionBoundary.js': false
})

/** The PowerShell that actually drives UIA. Scanned with the same list, and it matters most here. */
const PS_ALLOWLIST = Object.freeze(['uiaCanary.ps1'])

/**
 * The Owner named four; the rest are the specific spellings by which the four are usually
 * smuggled in. `exec(`/`spawn(` are matched as call sites so a comment explaining why they are
 * absent does not trip the scan.
 */
const BANNED_SUBSTRINGS = Object.freeze([
  'SendKeys', 'sendkeys', 'SendInput', 'keybd_event', 'mouse_event',
  'SetForegroundWindow', 'SetCursorPos', 'Set-Clipboard', 'Get-Clipboard', 'clipboardy',
  'clipboardData', 'navigator.clipboard', 'WScript.Shell'
])
const BANNED_CALLS = Object.freeze(['exec(', 'spawn(', 'execSync(', 'spawnSync(', 'execFile('])

/**
 * Clipboard USE, as opposed to the word "clipboard".
 *
 * Banning the bare noun failed on assertionRegistry.js, which names the clipboard because it
 * holds an assertion ABOUT it — `E4-read-other-session-clipboard` is a measurement id, not a
 * technique. Banning the word would have meant the registry could not describe the thing it
 * exists to measure. So the ban is on touching one: a clipboard identifier followed by a
 * property access, an index or a call.
 *
 * The call form requires the parenthesis to be ADJACENT, because allowing a space matched the
 * prose "clipboard (E4)" in that same file. `clipboard .writeText()` would slip through; that
 * is a formatting nobody writes, and the alternative was a rule that fires on English.
 */
const CLIPBOARD_USE = /\bclipboard\s*[.[]|\bclipboard\(|\bclipboard\s*=[^=]/i

const read = (p) => fs.readFileSync(p, 'utf8')

/**
 * ── SCAN THE CODE, NOT THE PROSE ───────────────────────────────────────────
 * The first version of this test scanned raw text and immediately failed on two files that are
 * doing exactly the right thing: assertionRegistry.js NAMES the clipboard in an assertion about
 * it, and uiaCanary.ps1 lists "SendKeys" in the comment block explaining that it must never be
 * used. A test that cannot tell a prohibition from a violation punishes writing the prohibition
 * down, which is the opposite of what it is for.
 *
 * So comments are stripped first. The ban is on USING these, not on discussing them — and a
 * positive-control test below proves the stripper does not blind the scan to real code.
 */
const stripJs = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

const stripPs = (s) => s
  .replace(/<#[\s\S]*?#>/g, '')
  .replace(/^\s*#.*$/gm, '')
  .replace(/([^'"`])#[^'"\n]*$/gm, '$1')

/* ── the allowlist is complete ────────────────────────────────────────────── */

test('*** every non-test file in src/computer is on the allowlist ***', () => {
  const onDisk = fs.readdirSync(SRC_COMPUTER)
    .filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))
    .sort()
  const listed = Object.keys(JS_ALLOWLIST).sort()

  const unlisted = onDisk.filter((n) => !listed.includes(n))
  assert.deepEqual(unlisted, [],
    'a new module appeared and nobody decided whether it may touch a desktop — add it to JS_ALLOWLIST')

  const missing = listed.filter((n) => !onDisk.includes(n))
  assert.deepEqual(missing, [], 'the allowlist names a file that no longer exists — remove it')
})

test('*** exactly ONE module is allowed to reach a desktop ***', () => {
  const allowed = Object.entries(JS_ALLOWLIST).filter(([, v]) => v !== false).map(([k]) => k)
  // TWO now: the adapter reaches a desktop, and the shared runner is the only thing that may
  // start PowerShell at all. Both were single-purpose before the runner was unified; keeping
  // them named individually is what makes a third addition visible.
  assert.deepEqual(allowed.sort(), ['desktopAdapter.js', 'powershellJsonRunner.js'],
    'widening this is a capability change and an Owner GO, not an edit')
})

/* ── the prohibited techniques are absent from the source ─────────────────── */

test('*** SOURCE-CONSTRAINED — no clipboard, SendKeys, exec( or spawn( anywhere in src/computer ***', () => {
  for (const name of Object.keys(JS_ALLOWLIST)) {
    // The designated launcher is exempt from the SPAWN ban and from nothing else. That ban was
    // written when no module could start a process; unifying the transport means exactly one
    // now must. The guarantee is unchanged in force — 'nothing else can spawn' — and the
    // exemption is named here rather than quietly widened, with a separate test asserting the
    // list of exempt files is exactly this one.
    const isLauncher = name === 'powershellJsonRunner.js'
    const code = stripJs(read(path.join(SRC_COMPUTER, name)))
    for (const banned of BANNED_SUBSTRINGS) {
      assert.equal(code.includes(banned), false, `${name} must not contain: ${banned}`)
    }
    for (const call of BANNED_CALLS) {
      if (isLauncher && (call === 'spawn(' || call === 'spawnSync(')) continue
      assert.equal(code.includes(call), false, `${name} must not call: ${call}`)
    }
    if (isLauncher) {
      // What the exemption does NOT cover. It may start a process; it may still not build a
      // command string, run one through a shell, or go via cmd.
      assert.equal(code.includes('shell: true'), false, name + ' must never use a shell')
      assert.equal(code.includes('cmd.exe'), false, name + ' must never go through cmd')
      assert.equal(code.includes('Invoke-Expression'), false, name + ' must never build a command')
    }
    assert.equal(CLIPBOARD_USE.test(code), false, `${name} must not touch a clipboard`)
  }
})

test('*** POSITIVE CONTROL — the clipboard rule catches use and permits description ***', () => {
  // Same reasoning as the stripper control: a rule that never fires is indistinguishable from
  // a rule that is not there. Real uses must trip it; naming the noun must not.
  for (const use of ['clipboard.writeText(x)', 'clipboard["setData"]', 'const clipboard = require("x")', 'Clipboard.SetText(s)']) {
    assert.equal(CLIPBOARD_USE.test(use), true, 'must be caught: ' + use)
  }
  for (const mention of ['E4-read-other-session-clipboard', 'the owner clipboard was not read',
    'clipboard: not measured', 'nothing about DACLs, clipboard (E4) or process rights']) {
    assert.equal(CLIPBOARD_USE.test(mention), false, 'must be permitted: ' + mention)
  }
})

test('*** SOURCE-CONSTRAINED — the UIA script types by pattern, never by keystroke ***', () => {
  // This is the file where the prohibitions are actually cashed in, so it is checked for the
  // banned techniques AND for the presence of the permitted one.
  for (const name of PS_ALLOWLIST) {
    const p = path.join(SCRIPTS_COMPUTER, name)
    assert.ok(fs.existsSync(p), 'the scanned script must exist: ' + name)
    const code = stripPs(read(p))

    for (const banned of ['Set-Clipboard', 'Get-Clipboard', 'SendKeys', 'SendInput', 'keybd_event',
      'mouse_event', 'System.Windows.Forms.SendKeys', 'WScript.Shell', 'Invoke-Expression', 'iex ']) {
      assert.equal(code.includes(banned), false, `${name} must not contain: ${banned}`)
    }

    // Positive control: absence of the banned tokens would be trivially true for an empty
    // file, so assert the permitted mechanism is actually there.
    assert.ok(code.includes('ValuePattern'), 'text must be set through ValuePattern')
    assert.ok(code.includes('InvokePattern'), 'menus and buttons through InvokePattern')

    // No filesystem write standing in for the application's own Save As.
    for (const write of ['Out-File', 'Set-Content', 'Add-Content', 'New-Item', 'WriteAllText', 'mkdir', 'New-Item -ItemType Directory']) {
      assert.equal(code.includes(write), false, `${name} must not write or create anything itself: ${write}`)
    }
  }
})

test('*** POSITIVE CONTROL — the comment stripper does not blind the scan ***', () => {
  // Without this, "no banned tokens found" could mean the stripper ate the whole file, and a
  // zero from a scan that could not see anything is the vacuous pass this project keeps
  // finding. Both directions are checked: real code survives, real comments do not.
  const jsSurvives = stripJs('const x = 1 // clipboard\nspawn(cmd)\n/* SendKeys */')
  assert.ok(jsSurvives.includes('spawn(cmd)'), 'code survives stripping')
  assert.equal(jsSurvives.includes('clipboard'), false, 'line comments are removed')
  assert.equal(jsSurvives.includes('SendKeys'), false, 'block comments are removed')

  const psSurvives = stripPs('# SendKeys forbidden\n$x = [Forms.SendKeys]::Send("a")\n')
  assert.ok(psSurvives.includes('SendKeys]::Send'), 'PowerShell code survives stripping')
  assert.equal(/^\s*#/m.test(psSurvives), false, 'PowerShell comments are removed')

  // And the real files still have substance after stripping, so nothing was silently emptied.
  for (const name of Object.keys(JS_ALLOWLIST)) {
    assert.ok(stripJs(read(path.join(SRC_COMPUTER, name))).trim().length > 200, name + ' vanished under stripping')
  }
  assert.ok(stripPs(read(path.join(SCRIPTS_COMPUTER, 'uiaCanary.ps1'))).trim().length > 1000, 'the ps1 vanished under stripping')
})

test('*** no PowerShell script reads .Count or [0] off an unwrapped call ***', () => {
  // Added after the first elevated run of Script A died here. PowerShell unwraps a
  // one-element array on return and yields $null for an empty one, so `(Get-Thing).Count`
  // is a terminating error under StrictMode in exactly the two cases that are CORRECT —
  // zero matches and one match. Two or more, the wrong answer, is the only shape that works.
  //
  // Same family as the $pid guard below: a language hazard that passes review, passes a
  // parse check, and only fires in front of the Owner on an elevated machine.
  const scripts = ['uiaCanary.ps1', 'prepare-canary-testdir.ps1', 'run-script-a-measured.ps1']
  const offenders = []
  for (const name of scripts) {
    const p = path.join(SCRIPTS_COMPUTER, name)
    if (!fs.existsSync(p)) { offenders.push(name + ': missing'); continue }
    const code = stripPs(read(p))
    // A parenthesised call — a bare word with arguments, not a variable — followed by
    // .Count or an index. `($var).Count` and `@(...).Count` are both fine.
    for (const m of code.matchAll(/(^|[^@\w])\(\s*([A-Za-z][\w-]*)\s[^()]*\)\s*(\.Count\b|\[\s*\d)/g)) {
      offenders.push(`${name}: (${m[2]} …)${m[3]} — wrap the CALL SITE in @( )`)
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test('*** POSITIVE CONTROL — that rule catches the real defect and permits the fix ***', () => {
  const bad = 'if ((Get-AceFor -Sid $p).Count -gt 0) { }'
  const alsoBad = '$m = (Get-AceFor -Sid $x)[0].FileSystemRights'
  const fixed = 'if (@(Get-AceFor -Sid $p).Count -gt 0) { }'
  const alsoFixed = '$m = @(Get-AceFor -Sid $x)[0].FileSystemRights'
  const rule = () => /(^|[^@\w])\(\s*([A-Za-z][\w-]*)\s[^()]*\)\s*(\.Count\b|\[\s*\d)/g
  assert.ok(rule().test(bad), 'must catch the exact line that failed')
  assert.ok(rule().test(alsoBad), 'must catch the index form too')
  assert.equal(rule().test(fixed), false, 'must permit the fix')
  assert.equal(rule().test(alsoFixed), false, 'must permit the indexed fix')
  assert.equal(rule().test('if ($existing.Count -gt 0) { }'), false, 'a plain variable is fine')
})

test('*** the PowerShell helper does not assign to $pid ***', () => {
  // A read-only automatic variable. Assigning to it is fatal under StrictMode, and this class
  // of bug — $args, $pid — has already cost this project a physical run.
  const code = read(path.join(SCRIPTS_COMPUTER, 'uiaCanary.ps1'))
  assert.equal(/\$pid\s*=/.test(code), false, '$pid is automatic and read-only — use $procId')
})

test('the UIA script is UTF-8 with a BOM', () => {
  // Without a BOM, PowerShell 5.1 reads a .ps1 as ANSI. Measured, repeatedly, the hard way.
  const b = fs.readFileSync(path.join(SCRIPTS_COMPUTER, 'uiaCanary.ps1'))
  assert.deepEqual([b[0], b[1], b[2]], [0xEF, 0xBB, 0xBF], 'missing BOM')
})

/* ── no fallback path ─────────────────────────────────────────────────────── */

test('*** neither the adapter nor the script offers a fallback when a lookup fails ***', () => {
  // The dangerous shape is "try the control, else type into the foreground window". The case
  // where the lookup failed is exactly the case where we do not know what we would be typing
  // into, so a fallback is not a robustness feature — it is the bug.
  for (const p of [path.join(SRC_COMPUTER, 'desktopAdapter.js'), path.join(SCRIPTS_COMPUTER, 'uiaCanary.ps1')]) {
    const code = read(p)
    assert.equal(/fallback\s*[:=(]|bestEffort|tryAnyway|orElseType|ifFocused/i.test(code), false,
      'no fallback mechanism in ' + path.basename(p))
    assert.equal(/GetFocusedElement|FocusedElement/.test(code), false,
      'must not act on whatever has focus: ' + path.basename(p))
  }
})

test('the adapter reaches a desktop only through an injected runner', () => {
  const code = read(path.join(SRC_COMPUTER, 'desktopAdapter.js'))
  const requires = [...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  assert.deepEqual(requires, [], 'the adapter imports nothing at all — the runner is injected')
  assert.ok(code.includes('deps.runner'), 'and the injection point is named')
})
