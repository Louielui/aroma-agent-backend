'use strict'

/**
 * uiaMeasurementBoundary.test.js — the second measurement tool stays a measurement.
 *
 * Operator-MeasureNotepadUia.ps1 exists to answer two blockers that would otherwise be found
 * the expensive way: after the canary has opened Notepad, with an approval already spent. To be
 * worth running it has to do real things — open the app, set text, open the Save As dialog — and
 * that is exactly the shape of a tool that could quietly become a canary that nobody approved.
 *
 * So the boundary is asserted rather than described:
 *
 *   . it refuses any session that is not AromaOperator
 *   . it never writes a byte, anywhere
 *   . the canary's sealed text does not appear in it at all
 *   . it opens the Save As dialog and CANCELS it; it never invokes Save
 *   . it is clean under the PowerShell hazard rules that cost this project four rounds
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')
const TOOL = path.join(REPO, 'scripts', 'computer', 'Operator-MeasureNotepadUia.ps1')
const { findUnrollHazards, findIndexHazards, findAutomaticAssignments, blankComments } = require('./powershellHazards')
const { PACKAGE_FILES } = require('../../scripts/computer/executionPackage')

const raw = () => fs.readFileSync(TOOL, 'utf8')
const code = () => blankComments(raw()).join('\n')

test('*** it refuses any session that is not AromaOperator, before measuring anything ***', () => {
  const c = code()
  const sid = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
  assert.ok(c.includes(sid), 'the expected SID is pinned')
  // By SID, not by name: an account can be renamed, a SID cannot.
  assert.match(c, /\$me\.User\.Value -ne \$EXPECTED_SID/, 'compared by SID')
  assert.match(c, /exit 1/, 'and it exits')

  // The gate must come BEFORE anything is launched, or a wrong session still opens Notepad.
  const gateAt = c.indexOf('$me.User.Value -ne $EXPECTED_SID')
  const launchAt = c.indexOf('Start-Process')
  assert.ok(gateAt > 0 && launchAt > gateAt, 'the identity gate precedes the launch')
})

test('*** it writes nothing, anywhere ***', () => {
  const c = code()
  // Any shape that puts bytes on disk. `>>` is included because a redirect is the easiest way
  // for a "measurement" to start leaving artefacts behind.
  for (const re of [/Out-File/, /Set-Content/, /Add-Content/, /New-Item/, /Copy-Item/, /Move-Item/, /Remove-Item/, /\[IO\.File\]::Write/, /\bExport-\w+/, />>/]) {
    assert.equal(re.test(c), false, 'writes to disk: ' + re)
  }
})

test('*** ComputerOperator-Test is READ and never written ***', () => {
  const c = code()
  const lines = c.split('\n').filter((l) => l.includes('ComputerOperator-Test') || l.includes('$testDir'))
  assert.ok(lines.length > 0, 'the directory is referenced')
  for (const l of lines) {
    assert.match(l, /Test-Path|Get-ChildItem|\$testDir = |Say |\+ \$inTest|files in/, 'read-only reference: ' + l.trim())
  }
})

test('*** the canary sealed text does not appear in the tool at all ***', () => {
  const wo = require('../../docs/governance/canary-work-order.draft.json')
  const sealed = wo.sealedText
  assert.ok(typeof sealed === 'string' && sealed.length > 0)
  assert.equal(raw().includes(sealed), false, 'the sealed text must not appear, even in a comment')

  // And what it DOES type is a probe that could not be mistaken for the canary.
  const m = raw().match(/\$PROBE_TEXT = '([^']+)'/)
  assert.ok(m, '$PROBE_TEXT is a literal')
  assert.notEqual(m[1], sealed)
  assert.equal(m[1], 'UIA probe 12345')

  // The only thing ever handed to SetValue on the document is that probe.
  const setValues = code().match(/\.SetValue\([^)]*\)/g) || []
  assert.deepEqual(setValues, ['.SetValue($PROBE_TEXT)'], 'exactly one SetValue, and it is the probe')
})

test('*** the Save As dialog is opened, inspected and CANCELLED — never saved ***', () => {
  const c = code()
  assert.match(c, /Name 'Cancel'/, 'it looks for Cancel')
  assert.match(c, /WindowPattern.*\n?.*Close\(\)|\$wp\.Close\(\)/, 'with a Close() fallback')

  // The Save button is located so its Name and AutomationId can be reported — and must not be
  // invoked. Invoke-Element/Invoke() calls are enumerated and checked one by one.
  assert.match(c, /\$saveBtn = Get-ByName/, 'the Save button is found')
  const saveBtnUse = c.slice(c.indexOf('$saveBtn = Get-ByName'))
  const upToCancel = saveBtnUse.slice(0, saveBtnUse.indexOf('Name \'Cancel\''))
  assert.equal(/\$saveBtn[\s\S]{0,80}Invoke\(\)/.test(upToCancel), false, 'the Save button is never invoked')

  // The filename field is inspected, never filled: filling it is what would create a file.
  assert.match(c, /\$nameBox = /, 'the filename field is found')
  assert.equal(/\$nvp\.pattern\.SetValue|\$nameBox[\s\S]{0,120}SetValue/.test(c), false, 'the filename field is never set')
})

test('*** clean under every PowerShell hazard rule ***', () => {
  const source = raw()
  assert.deepEqual(findUnrollHazards(source), [], 'no assign-then-.Count hazard')
  assert.deepEqual(findIndexHazards(source), [], 'no [0] into a pipeline')
  assert.deepEqual(findAutomaticAssignments(source), [], 'no read-only automatic assigned')

  // UTF-8 with a BOM: without it PowerShell 5.1 reads the file as ANSI, and this repo has
  // already lost a run to a dash that decoded into a quote character.
  const bytes = fs.readFileSync(TOOL)
  assert.ok(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF, 'BOM present')
})

test('*** it is in the execution package, because staging copies only that list ***', () => {
  // stage-canary-closure.ps1 copies exactly PACKAGE_FILES. A tool that is not listed cannot
  // reach the operator account at all, so "prepared but unstageable" would look like a working
  // deliverable and be nothing of the kind.
  assert.ok(PACKAGE_FILES.includes('scripts/computer/Operator-MeasureNotepadUia.ps1'),
    'the tool is packaged, and the package hash therefore moves')
})

test('*** it measures the canary\'s OWN logic, not a paraphrase of it ***', () => {
  // The whole value of the measurement is that it exercises what uiaCanary will do. If the two
  // drift, the tool reports on a program that does not exist.
  const canary = blankComments(fs.readFileSync(path.join(REPO, 'scripts', 'computer', 'uiaCanary.ps1'), 'utf8')).join('\n')
  const c = code()
  for (const shared of [
    'ControlType]::Document',                 // Get-EditControl tries Document first
    'ControlType]::Edit',                     // then Edit
    'System.ItemNameDisplay',                 // the filename field, by AutomationId
    'ProcessIdProperty'                       // Get-SoleWindowForProcess's condition
  ]) {
    assert.ok(canary.includes(shared), 'canary uses: ' + shared)
    assert.ok(c.includes(shared), 'the measurement uses the same: ' + shared)
  }
  // Both spellings of the menu item, because the canary tries both and a third would refuse.
  for (const spelling of ["'Save as'", "'Save As'"]) {
    assert.ok(canary.includes(spelling), 'canary tries ' + spelling)
    assert.ok(c.includes(spelling), 'the measurement tries ' + spelling)
  }
})

/* ── the seven-point diagnostic stays a diagnostic ────────────────────────── */

test('*** the ONLY things ever invoked are File, Save as, and Cancel ***', () => {
  // The diagnostic prints candidates including anything Save- or OK-shaped. Printing them is
  // the job; pressing one would turn a measurement into an unapproved canary that writes a file.
  const c = code()
  const calls = []
  c.split('\n').forEach((l, i) => {
    // Quoted text is stripped first. A CALL and a STRING THAT NAMES A CALL are different
    // things, and the branch label the Owner reads — "WindowPattern.Close() on the DIALOG" —
    // is one of the latter. Conflating them would force the output to be written worse to
    // keep a test quiet, which is how a rule starts costing more than it protects. Nothing is
    // hidden by this: a real call cannot be inside quotes.
    const bare = l.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    if (/\.Invoke\(\)|\.Close\(\)|DoDefaultAction\(\)/.test(bare)) calls.push({ line: i + 1, text: l.trim() })
  })
  assert.equal(calls.length, 4, 'exactly four: File menu, Save as item, Cancel button, window Close — got:\n' +
    calls.map((x) => '  ' + x.line + ': ' + x.text).join('\n'))

  // And none of them is reached from a Save/OK candidate.
  for (const bad of [/\$saveBtn[\s\S]{0,120}\.Invoke\(\)/, /\$c\.element[\s\S]{0,120}\.Invoke\(\)/, /Candidates[\s\S]{0,200}\.Invoke\(\)/]) {
    assert.equal(bad.test(c), false, 'a candidate is invoked: ' + bad)
  }
  // DefaultAction is read and printed, never executed.
  assert.equal(/DoDefaultAction\(\)/.test(c), false, 'LegacyIAccessible DefaultAction must not be executed')
  assert.match(c, /DefaultAction is NOT executed here/, 'and that is stated where it is read')
})

test('*** the cancel branch is reported, not merely the outcome ***', () => {
  // Three rounds could not answer "was Cancel findable as a Button" because both branches
  // printed the same line. That single fact decides whether the dialog's bottom bar is visible.
  const c = code()
  assert.match(c, /CANCEL BRANCH TAKEN/, 'the branch is printed')
  assert.match(c, /InvokePattern on the Cancel BUTTON/, 'branch 1 is named')
  assert.match(c, /WindowPattern\.Close\(\) on the DIALOG/, 'branch 2 is named')
  assert.match(c, /Cancel found as Name=Cancel \+ ControlType=Button/, 'and the lookup result itself is printed')
})

test('*** all seven diagnostic points are present ***', () => {
  const c = code()
  for (const [label, re] of [
    ['6.1 raw view, unfiltered', /RAW VIEW of the dialog subtree - EVERY element, unfiltered/],
    ['6.2 control view comparison', /CONTROL VIEW of the same subtree/],
    ['6.3 by AutomationId, no type filter', /BY AutomationId, with NO ControlType filter/],
    ['6.4 candidates + patterns', /EVERY CANDIDATE FOUND, AND WHAT IT SUPPORTS/],
    ['6.5 the dialog itself', /THE DIALOG ELEMENT ITSELF/],
    ['6.6 filename field patterns', /THE FILENAME FIELD - EVERY PATTERN IT SUPPORTS/],
    ['6.7 native handles', /native window handles are printed inline/]
  ]) {
    assert.match(c, re, 'missing diagnostic: ' + label)
  }
  // Both tree views are really walked, not just described.
  assert.match(c, /TreeWalker\]::RawViewWalker/, 'raw walker used')
  assert.match(c, /TreeWalker\]::ControlViewWalker/, 'control walker used')
  // Truncation is announced rather than silent.
  assert.match(c, /CAP REACHED - OUTPUT TRUNCATED/, 'a truncated walk says so')
})

test('*** candidates are always printed in full, never summarised away ***', () => {
  const c = code()
  // "found: true" with no detail is what made the last three rounds unresolvable.
  assert.match(c, /candidates collected during the walks/, 'the count is shown')
  assert.match(c, /Show-Patterns -El \$c\.element/, 'and every candidate gets its pattern list')
  assert.match(c, /Show-LegacyInfo -El \$c\.element/, 'and its legacy info')
  // Empty AutomationId must never render as blank.
  assert.match(c, /function Fmt/, 'the <empty> formatter exists')
  assert.equal(/AutoId ' \+ \$ai\b/.test(c) && !/AutoId ' \+ \(Fmt \$ai\)/.test(c), false,
    'AutomationId is always printed through Fmt')
})
