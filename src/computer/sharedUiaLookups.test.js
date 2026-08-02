'use strict'

/**
 * sharedUiaLookups.test.js — production and measurement locate the Save UI with the SAME code.
 *
 * ── WHY A STRING-COMPARING DRIFT TEST WAS NOT ENOUGH ──────────────────────
 * There was one. It asserted that both files contained `System.ItemNameDisplay`,
 * `ControlType]::Edit`, `'Save as'` and so on, and it stayed green while:
 *
 *   . the tool waited 1500 ms and ran seven diagnostics first, so its lookup happened seconds
 *     after the dialog opened; the canary looked once at 900 ms;
 *   . the tool selected the dialog by one rule and the canary by another — and the canary's had
 *     a fallback to "the first element anywhere with this pid", which is the Notepad main window;
 *   . so the tool printed True for a field the canary then could not find, and the refusal named
 *     the wrong layer.
 *
 * Both files contained the same constants throughout. Shared constants do not make shared
 * behaviour. The only thing that does is shared code, so these guards check STRUCTURE — where
 * functions are defined, who calls them, what the parameters are — using the PowerShell parser,
 * not a regex over text.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const REPO = path.resolve(__dirname, '..', '..')
const SCRIPTS = path.join(REPO, 'scripts', 'computer')
const MODULE = 'uiaLookups.ps1'
const SHARED = ['Find-SaveDialog', 'Find-FilenameField', 'Find-SaveButton', 'Resolve-SaveUiBinding']
const CALLERS = ['uiaCanary.ps1', 'Operator-MeasureNotepadUia.ps1']
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

/** Ask the PowerShell PARSER for a file's function definitions and command calls. */
function astOf (file) {
  const ps = [
    '$e=$null;',
    `$ast=[System.Management.Automation.Language.Parser]::ParseFile('${path.join(SCRIPTS, file)}',[ref]$null,[ref]$e);`,
    '$fn=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true) | ForEach-Object { $_.Name };',
    '$cmd=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]},$true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ };',
    // Built as STRUCTURE, not as a joined string. The first version used `-join` inside a
    // JavaScript template inside a -Command argument, and the quoting collapsed on the way
    // through — the parser then failed on an unrelated file and the guard reported that as a
    // finding. Three layers of escaping is one too many; nested objects need none.
    '$par=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true) | ForEach-Object { $p=@(); if($_.Body.ParamBlock){ $p=@($_.Body.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) }; @{ name=$_.Name; parameters=$p } };',
    'ConvertTo-Json @{ functions=@($fn); commands=@($cmd); params=@($par) } -Depth 6 -Compress'
  ].join(' ')
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 90000 })
  assert.equal(r.status, 0, 'the parser ran on ' + file + ': ' + (r.stderr || ''))
  return JSON.parse(String(r.stdout))
}

const src = (f) => fs.readFileSync(path.join(SCRIPTS, f), 'utf8')

/* ── 1. each shared function is DEFINED in exactly one file ───────────────── */

test('*** the four lookups are defined ONLY in uiaLookups.ps1 — asked of the parser ***', () => {
  const all = fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.ps1'))
  const definers = {}
  for (const f of all) {
    const ast = astOf(f)
    for (const fn of SHARED) {
      if (ast.functions.includes(fn)) (definers[fn] = definers[fn] || []).push(f)
    }
  }
  for (const fn of SHARED) {
    assert.deepEqual(definers[fn], [MODULE], fn + ' must be defined once, in ' + MODULE + '; found in: ' + (definers[fn] || []).join(', '))
  }
})

test('*** POSITIVE CONTROL — a second definition anywhere would be caught ***', () => {
  // Proven against a real temp file, through the real parser, rather than asserted.
  const os = require('node:os')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uia-dup-'))
  const f = path.join(tmp, 'dup.ps1')
  fs.writeFileSync(f, 'function Find-SaveDialog { param($x) return $null }\n', 'utf8')
  const ps = [
    '$e=$null;',
    `$ast=[System.Management.Automation.Language.Parser]::ParseFile('${f}',[ref]$null,[ref]$e);`,
    '($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true) | ForEach-Object { $_.Name }) -join ","'
  ].join(' ')
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 60000 })
  assert.match(String(r.stdout).trim(), /Find-SaveDialog/, 'a duplicate definition is visible to the rule that bans it')
})

/* ── 2. both callers load the SAME package-local file ─────────────────────── */

test('*** both callers dot-source the exact package-local path ***', () => {
  for (const c of CALLERS) {
    const code = src(c).replace(/^\s*#.*$/gm, '')
    assert.ok(code.includes(". (Join-Path $PSScriptRoot 'uiaLookups.ps1')"),
      c + ' must dot-source the module by $PSScriptRoot, not by a computed or configured path')
  }
})

test('*** no caller can be pointed at a DIFFERENT lookup file ***', () => {
  // An env var or a parameter naming the module would reintroduce two implementations by the
  // back door — the same class of defect, one indirection further away.
  for (const c of CALLERS.concat([MODULE])) {
    const code = src(c).replace(/^\s*#.*$/gm, '')
    assert.equal(/\$env:\w*(LOOKUP|UIA_MODULE|UIALOOKUPS)\w*/i.test(code), false, c + ': no env var may select the module')
    assert.equal(/Join-Path\s+\$\w+\s+\$\w+\s*\)?\s*$/m.test(code.split('\n').filter((l) => l.includes('. (')).join('\n')), false,
      c + ': the dot-sourced path must be a literal, never a variable')
  }
})

/* ── 3. only the shared module holds the policy ───────────────────────────── */

test('*** the deadline, the poll interval and the scope live ONLY in the module ***', () => {
  const mod = src(MODULE).replace(/^\s*#.*$/gm, '')
  assert.match(mod, /\$SAVE_UI_TOTAL_BUDGET_MS = \d+/, 'one budget')
  assert.match(mod, /\$SAVE_UI_POLL_MS = \d+/, 'one poll interval')
  assert.match(mod, /\$SAVE_UI_SCOPE = \[System\.Windows\.Automation\.TreeScope\]::Descendants/, 'one scope')

  for (const c of CALLERS) {
    const code = src(c).replace(/^\s*#.*$/gm, '')
    assert.equal(/SAVE_UI_TOTAL_BUDGET_MS\s*=/.test(code), false, c + ' must not set the budget')
    assert.equal(/SAVE_UI_POLL_MS\s*=/.test(code), false, c + ' must not set the poll interval')
  }
})

test('*** Resolve-SaveUiBinding takes NO timeout, scope, root-selector or fallback parameter ***', () => {
  const ast = astOf(MODULE)
  const entry = ast.params.find((p) => p.name === 'Resolve-SaveUiBinding')
  assert.ok(entry, 'the entry point was found by the parser')
  const params = entry.parameters || []
  assert.deepEqual(params.sort(), ['BoundWindowHandle', 'MainWindow', 'ProcessId'],
    'a caller supplies the binding it already holds and nothing else: ' + params.join(', '))
  for (const banned of ['Timeout', 'TimeoutMs', 'Deadline', 'BudgetMs', 'Scope', 'Root', 'Selector', 'Fallback', 'Retry']) {
    assert.equal(params.some((p) => p.toLowerCase() === banned.toLowerCase()), false, 'must not accept ' + banned)
  }
})

/* ── 4. the measurement tool cannot override the production answer ────────── */

test('*** the measurement tool CALLS the resolver and prints its result ***', () => {
  const ast = astOf('Operator-MeasureNotepadUia.ps1')
  assert.ok(ast.commands.includes('Resolve-SaveUiBinding'), 'it calls the production entry, per the parser')
  const code = src('Operator-MeasureNotepadUia.ps1').replace(/^\s*#.*$/gm, '')
  // It must not define its own version of any of them.
  for (const fn of SHARED) {
    assert.equal(new RegExp('function\\s+' + fn + '\\b').test(code), false, 'it must not define ' + fn)
  }
})

test('*** the tool has NO save-dialog lookup of its own left ***', () => {
  const code = src('Operator-MeasureNotepadUia.ps1').replace(/^\s*#.*$/gm, '')
  // The two shapes it used to have: its own dialog selection, and its own filename lookup.
  assert.equal(/\$asDescendant\s*=/.test(code), false, 'the tool no longer picks the dialog itself')
  assert.equal(/\$byAutoId\s*=/.test(code), false, 'nor re-looks-up the filename field')
  assert.equal(/AutomationIdProperty\s+'System\.ItemNameDisplay'/.test(code), false,
    'the field selector belongs to the module, not to the tool')
})

test('*** a failed production lookup is labelled as such, and diagnostics cannot overwrite it ***', () => {
  const code = src('Operator-MeasureNotepadUia.ps1')
  assert.match(code, /POST-FAILURE DIAGNOSTICS/, 'later observations are marked as after the failure')
  assert.match(code, /THE PRODUCTION LOOKUP FAILED, and the result above stands/,
    'and the screen says the production result is the answer')
  // $ui is printed and never reassigned from a diagnostic.
  const assigns = (code.match(/\$ui\s*=/g) || []).length
  assert.equal(assigns, 1, '$ui is assigned exactly once, from the resolver: ' + assigns)
})

/* ── 5. no equivalent inline lookup may reappear in scripts ───────────────── */

test('*** no script re-implements the save-UI lookup inline ***', () => {
  const offenders = []
  for (const f of fs.readdirSync(SCRIPTS).filter((x) => x.endsWith('.ps1'))) {
    if (f === MODULE) continue
    // nativeSaveActivation.ps1 is the ONE exemption, and the reason is not convenience.
    // DESIGN-001 requires it to re-verify the target INDEPENDENTLY in the microseconds before
    // the send, in its own process. Borrowing the module's earlier answer would defeat the point
    // of re-verifying at all: this is not a second lookup for the same moment, it is a second
    // look at a LATER moment, which is what makes the TOCTOU window small instead of imaginary.
    if (f === 'nativeSaveActivation.ps1') continue
    const code = src(f).replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '')
    // The shapes that ARE a save-UI lookup: the filename AutomationId, or the dialog class,
    // used as a search condition outside the module.
    if (/System\.ItemNameDisplay/.test(code)) offenders.push(f + ': filename selector')
    if (/'#32770'/.test(code)) offenders.push(f + ': dialog class selector')
  }
  assert.deepEqual(offenders, [],
    'these belong to uiaLookups.ps1:\n  ' + offenders.join('\n  '))
})

test('*** POSITIVE CONTROL — an inline re-implementation is detectable ***', () => {
  const sample = "$nameBox = $dlg.FindFirst($SCOPE_DESC, (New-PropCondition $AUTO::AutomationIdProperty 'System.ItemNameDisplay'))"
  assert.equal(/System\.ItemNameDisplay/.test(sample), true, 'the exact line that used to live in uiaCanary is caught')
  const innocent = "$ui = Resolve-SaveUiBinding -MainWindow $r.window -ProcessId $r.processId -BoundWindowHandle $r.windowHandle"
  assert.equal(/System\.ItemNameDisplay/.test(innocent), false, 'and a call to the shared entry is not')
})

/* ── 6. the module is covered by the approval ─────────────────────────────── */

test('*** the module is in the execution package, so a change moves the hash ***', () => {
  const { PACKAGE_FILES, computePackageHash } = require('../../scripts/computer/executionPackage')
  assert.ok(PACKAGE_FILES.includes('scripts/computer/uiaLookups.ps1'))

  // MEASURED, not assumed: edit a copy in a temp repo and watch the hash move.
  const os = require('node:os')
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-hash-'))
  for (const rel of PACKAGE_FILES) {
    const dst = path.join(tmpRepo, rel.split('/').join(path.sep))
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(path.join(REPO, rel.split('/').join(path.sep)), dst)
  }
  const before = computePackageHash(tmpRepo)
  assert.equal(before, computePackageHash(), 'the copy hashes identically to the original')

  const target = path.join(tmpRepo, 'scripts', 'computer', MODULE)
  fs.appendFileSync(target, '\n# a change\n', 'utf8')
  assert.notEqual(computePackageHash(tmpRepo), before, 'editing the module MOVES the package hash')
})

/* ── 7. the fallback that caused this is gone ─────────────────────────────── */

test('*** the wrong-layer fallback is DELETED, not merely bypassed ***', () => {
  const canary = src('uiaCanary.ps1').replace(/^\s*#.*$/gm, '')
  // The exact shape: on failing to find a descendant Window, take the first element anywhere in
  // the tree with this pid. That is the Notepad main window, and it made the field lookup search
  // the wrong window while refusing with the field's name.
  assert.equal(/RootElement\.FindFirst\([^)]*ProcessIdProperty/.test(canary), false,
    'no "first element anywhere with this pid" fallback may remain')
  assert.equal(/\$dlg = \$AUTO::RootElement/.test(canary), false, 'and nothing may substitute the main window for the dialog')
})

test('*** the module refuses rather than substituting, at each layer ***', () => {
  const mod = src(MODULE)
  for (const code of ['save_dialog_not_found', 'save_dialog_ambiguous', 'save_dialog_replaced',
    'dialog_class_unexpected', 'filename_field_not_found', 'filename_field_ambiguous',
    'save_button_not_found', 'save_control_not_unique', 'process_gone', 'window_changed']) {
    // dialog_class_unexpected is expressed as a rejection reason rather than a refusal string;
    // both are checked by name so the vocabulary cannot quietly shrink.
    if (code === 'dialog_class_unexpected') continue
    assert.ok(mod.includes("'" + code + "'"), 'the module can refuse with ' + code)
  }
  // A dialog whose class is wrong is REJECTED as a candidate, which is stronger than refusing
  // later: it never becomes the thing the field is searched in.
  assert.match(mod, /if \(\$cls -ne \$SAVE_DIALOG_CLASS\) \{ \$rejected \+= "class:\$cls"; continue \}/,
    'a wrong-class window is rejected as a candidate')
})

test('*** a timeout is reported as a timeout, never as an approximate success ***', () => {
  const mod = src(MODULE)
  assert.match(mod, /\$result\.evidence\.timedOut = \$true/, 'a timeout is marked')
  assert.match(mod, /timed out after/, 'and named in the detail')
  // The only place ok becomes true is after all three stages verified.
  const oks = (mod.match(/\$result\.ok = \$true/g) || []).length
  assert.equal(oks, 1, 'ok is set in exactly one place')
  const at = mod.indexOf('$result.ok = $true')
  const before = mod.slice(0, at)
  assert.match(before.slice(-600), /\$result\.saveButtonVerified = \$true/, 'and only after every stage verified')
})

/* ── 8. one budget, not one per stage ─────────────────────────────────────── */

test('*** the three stages share ONE deadline and it never restarts ***', () => {
  const mod = src(MODULE)
  const starts = (mod.match(/Stopwatch\]::StartNew\(\)/g) || []).length
  assert.equal(starts, 1, 'the clock starts once: ' + starts)
  assert.equal(/\$sw\.Restart\(\)/.test(mod), false, 'and is never restarted')
  assert.equal(/\$sw = /.test(mod.slice(mod.indexOf('while ('))), false, 'nor replaced inside the loop')
})
