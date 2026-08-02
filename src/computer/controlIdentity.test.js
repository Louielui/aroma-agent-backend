'use strict'

/**
 * controlIdentity.test.js — the binding identifies A CONTROL, not a kind of control.
 *
 * ── WHAT WAS MEASURED, AND WHY THE OLD RULE HAD TO GO ─────────────────────
 * The packaged Notepad's document, on the Owner's machine, 2026-08-02:
 *
 *     ControlType  ControlType.Document
 *     AutomationId <empty>
 *     Name         'Text editor'
 *     ClassName    'RichEditD2DPT'
 *
 * The old binding required `uiaControlId` — that AutomationId — to be non-empty. Windows does
 * not supply one, so the canary would have refused EVERY run, after opening Notepad, for as long
 * as the rule stood. It was enforcing an invariant we did not create.
 *
 * ── AND WHY THE REPLACEMENT IS NOT "ANY DOCUMENT" ─────────────────────────
 * Two things we DO create:
 *   1. exactly one Document (or exactly one Edit) inside a window already pinned by pid+handle;
 *   2. UIA's own RuntimeId, recorded at open_app and compared on every later step.
 * Neither is a fallback to "whatever is focused" and neither picks among candidates.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const gate = require('./sealedOrderGate')
const { BIND_FIELDS, BIND_REQUIRED } = gate
const CANARY = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'computer', 'uiaCanary.ps1'), 'utf8')

/* ── the contract ─────────────────────────────────────────────────────────── */

test('*** uiaControlId is GONE from the binding contract, everywhere ***', () => {
  assert.equal(BIND_FIELDS.includes('uiaControlId'), false)
  assert.equal(BIND_REQUIRED.includes('uiaControlId'), false)
  assert.equal(CANARY.includes('uiaControlId'), false, 'the PowerShell side too')

  for (const f of ['src/computer/computerExecutor.js', 'src/computer/desktopAdapter.js']) {
    const s = fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8')
    assert.equal(s.includes('uiaControlId'), false, f + ' still references it')
  }
})

test('*** uiaAutomationId is CARRIED but never REQUIRED — it is legitimately empty here ***', () => {
  assert.ok(BIND_FIELDS.includes('uiaAutomationId'), 'allowed through, so it is recorded')
  assert.equal(BIND_REQUIRED.includes('uiaAutomationId'), false, 'and never required')
})

test('*** the required identity is runtime id + control type + class name ***', () => {
  for (const f of ['uiaRuntimeId', 'uiaControlType', 'uiaClassName']) {
    assert.ok(BIND_REQUIRED.includes(f), f + ' is required')
  }
})

/* ── the executor enforces exactly that ───────────────────────────────────── */

const { createComputerExecutor } = require('./computerExecutor')
const REAL_BIND = Object.freeze({
  processId: 4242,
  sessionId: 1,
  windowHandle: '0x9001',
  uiaRuntimeId: '42.1234567.4.1',
  uiaControlType: 'ControlType.Document',
  uiaClassName: 'RichEditD2DPT',
  uiaAutomationId: ''            // <-- the measured reality
})

function validate (bind, attested) {
  // The validator is not exported; drive it through the only public door that uses it.
  const ex = createComputerExecutor({ artifactStore: { write: async () => ({ ok: true }) } })
  return ex.__validateRuntimeBinding
    ? ex.__validateRuntimeBinding(bind, attested)
    : null
}

test('*** a binding whose AutomationId is EMPTY is accepted — that is the whole point ***', () => {
  const v = validate(REAL_BIND, 1)
  if (v === null) {
    // Not exported: assert the same property through the source, which is what the executor runs.
    const s = fs.readFileSync(path.join(__dirname, 'computerExecutor.js'), 'utf8')
    assert.match(s, /for \(const f of BIND_REQUIRED\)/, 'presence is checked against BIND_REQUIRED')
    assert.match(s, /uiaAutomationId.*must be a string when present/, 'and AutomationId is only type-checked')
    assert.equal(/for \(const f of \['windowHandle', 'uiaRuntimeId', 'uiaControlType', 'uiaClassName'\]\)/.test(s), true,
      'the non-empty string check covers the identity fields and NOT uiaAutomationId')
    return
  }
  assert.equal(v.ok, true)
})

/* ── the PowerShell side ──────────────────────────────────────────────────── */

test('*** the control is found by UNIQUENESS, never by "the first one" ***', () => {
  assert.match(CANARY, /function Get-SoleEditControl/, 'a sole-control lookup exists')
  assert.equal(/function Get-EditControl\b/.test(CANARY), false, 'the FindFirst version is gone')
  assert.match(CANARY, /uia_control_ambiguous/, 'more than one is a refusal')
  // FindAll + an explicit count, not FindFirst.
  const fn = CANARY.slice(CANARY.indexOf('function Get-SoleEditControl'))
  const body = fn.slice(0, fn.indexOf('\n}') + 2)
  assert.match(body, /FindAll/, 'it enumerates')
  assert.equal(/FindFirst/.test(body), false, 'and does not take the first')
  assert.match(body, /\$docs\.Count -eq 1/, 'exactly one Document')
  assert.match(body, /\$edits\.Count -eq 1/, 'or exactly one Edit')
})

test('*** open_app records the identity and refuses if UIA gives no RuntimeId ***', () => {
  assert.match(CANARY, /uiaRuntimeId = \$ctlId\.runtimeId/)
  assert.match(CANARY, /uiaControlType = \$ctlId\.controlType/)
  assert.match(CANARY, /uiaClassName = \$ctlId\.className/)
  assert.match(CANARY, /uiaAutomationId = \$ctlId\.automationId/, 'recorded')
  assert.match(CANARY, /uia_runtime_id_missing/, 'and an absent RuntimeId is a NAMED refusal, not a blank field')
})

test('*** every later step re-checks that it is the SAME control ***', () => {
  const rb = CANARY.slice(CANARY.indexOf('function Resolve-Binding'))
  const body = rb.slice(0, rb.indexOf('\n}\n') + 3)
  assert.match(body, /Get-SoleEditControl/, 'uniqueness is re-established')
  assert.match(body, /\$id\.runtimeId -ne \[string\] \$Bind\.uiaRuntimeId/, 'RuntimeId is compared')
  assert.match(body, /\$id\.controlType -ne \[string\] \$Bind\.uiaControlType/)
  assert.match(body, /\$id\.className -ne \[string\] \$Bind\.uiaClassName/)
  assert.match(body, /uia_control_changed/, 'a mismatch is a named refusal')

  // Resolve-Binding runs before every acting op — that is what makes the re-check meaningful.
  for (const op of ['type_text', 'save_as', 'verify_binding']) {
    const at = CANARY.indexOf("'" + op + "' {")
    assert.ok(at > 0, op + ' exists')
    const opBody = CANARY.slice(at, at + 400)
    assert.match(opBody, /Resolve-Binding/, op + ' re-resolves before acting')
  }
})

test('*** the filename field is found by AutomationId, with NO first-Edit fallback ***', () => {
  assert.match(CANARY, /System\.ItemNameDisplay/, 'the measured, non-localised AutomationId')
  const sa = CANARY.slice(CANARY.indexOf("'save_as' {"))
  const upToSave = sa.slice(0, sa.indexOf('$saveBtn'))
  // The old fallback took whatever Edit came first in tree order. Being first is an accident,
  // and the dialog also contains a search box and the file-type combo.
  assert.equal(/\$nameBox = \$dlg\.FindFirst\(\$SCOPE_DESC, \(New-PropCondition \$AUTO::ControlTypeProperty \(\[System\.Windows\.Automation\.ControlType\]::Edit\)\)\)/.test(upToSave), false,
    'the "first Edit in the dialog" fallback is removed, not merely reordered')
  assert.match(upToSave, /filename_field_not_found/, 'and not finding it refuses')
})

test('*** the Save button is NOT guessed at — it is recorded as unresolved ***', () => {
  // Measured: Name='Save' + ControlType=Button found nothing. What it really is has not been
  // determined, and inventing a lookup would mean the canary presses something nobody identified.
  const sa = CANARY.slice(CANARY.indexOf("'save_as' {"))
  assert.match(sa, /KNOWN UNRESOLVED/, 'the gap is stated in the code that has it')
  assert.match(sa, /save_button_not_found/, 'and it still refuses rather than pressing something else')
  assert.match(sa, /Operator-MeasureNotepadUia\.ps1/, 'pointing at what will answer it')
})

/* ── the measurement tool will answer the remaining question ──────────────── */

test('*** the measurement tool enumerates the dialog buttons and RuntimeId stability ***', () => {
  const tool = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'computer', 'Operator-MeasureNotepadUia.ps1'), 'utf8')
  assert.match(tool, /EVERY BUTTON-LIKE CONTROL IN THE DIALOG/, 'the unresolved Save button')
  assert.match(tool, /SplitButton/, 'including the type the Button lookup would have missed')
  assert.match(tool, /BUTTON-LIKE CONTROLS ANYWHERE IN THIS PROCESS/, 'and outside the dialog subtree')
  assert.match(tool, /RuntimeId SURVIVED/, 'RuntimeId stability across SetValue is measured')
  assert.match(tool, /System\.ItemNameDisplay/, 'and the new filename lookup is confirmed by the same run')
})
