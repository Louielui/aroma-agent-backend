'use strict'

/**
 * twoStepCanaryScope.test.js — the canary is open_app + type_text, and says so.
 *
 * ── WHY THE SCOPE SHRANK (Owner decision, 2026-08-02) ─────────────────────
 * Four measured rounds established that the Save As dialog's Save control is identifiable —
 * AutomationId '1', native class Button, a real HWND — and unpressable by anything this project
 * permits: the managed UIA client offers no InvokePattern on it and LegacyIAccessible is not
 * available. Keyboard synthesis, focus inference and writing the file directly are all ruled out
 * by standing principle.
 *
 * A step that cannot execute does not belong in an order. It would fail after Notepad is open,
 * with an approval spent — which is the exact failure this project keeps paying for.
 *
 * So `save` leaves the order. It is NOT deleted from the system: it stays in RESTRICTED_ACTIONS,
 * the executor still knows it, and BACKLOG-002 carries the work. What changes is what the Owner
 * is being asked to approve.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')
const gate = require('./sealedOrderGate')
const { computeOrderHash, verifySeal, ALLOWED_PATH } = gate

const ORDER = JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'governance', 'canary-work-order-2step.draft.json'), 'utf8'))
const OLD = JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'governance', 'canary-work-order.draft.json'), 'utf8'))
const CANARY = fs.readFileSync(path.join(REPO, 'scripts', 'computer', 'uiaCanary.ps1'), 'utf8')

/* ── 1. the order itself ──────────────────────────────────────────────────── */

test('*** the new order is TWO steps, and neither of them saves ***', () => {
  assert.equal(ORDER.steps.length, 2)
  assert.deepEqual(ORDER.steps.map((s) => s.action), ['open_app', 'type_text'])
  assert.equal(ORDER.maxSteps, 2, 'maxSteps tracks the scope, it is not left at 3')
  assert.equal(ORDER.steps.some((s) => s.action === 'save'), false)
})

test('*** fields that no longer apply are ABSENT, not merely unused ***', () => {
  assert.equal(ORDER.allowedPath, undefined, 'no save, so nothing to bound')
  for (const s of ORDER.steps) assert.equal(s.fileName, undefined)
  // A stale field would make a two-step order look scoped when it was not.
  assert.equal(JSON.stringify(ORDER).includes('fileName'), false)
  assert.equal(JSON.stringify(ORDER).includes('allowedPath'), false)
})

test('*** the seal REFUSES an order that carries allowedPath without a save ***', () => {
  // Both directions, because "optional" would have been the weak version of this rule.
  const strayPath = Object.assign({}, ORDER, { allowedPath: ALLOWED_PATH, approvalId: 'appr_x' })
  strayPath.orderHash = computeOrderHash(strayPath)
  const v = verifySeal(strayPath)
  assert.equal(v.ok, false)
  assert.equal(v.refusal, 'unexpected_field')
  assert.match(v.reason, /no step saves/)
})

test('*** and still REQUIRES allowedPath when a save IS declared ***', () => {
  const withSave = Object.assign({}, ORDER, {
    approvalId: 'appr_x',
    maxSteps: 3,
    steps: ORDER.steps.concat([{ n: 3, action: 'save', fileName: 'x.txt' }])
  })
  withSave.orderHash = computeOrderHash(withSave)
  const v = verifySeal(withSave)
  assert.equal(v.ok, false)
  assert.equal(v.refusal, 'allowed_path_mismatch', 'a save without its bound path is still refused')
})

test('*** it is a NEW order — not the old one edited ***', () => {
  assert.notEqual(ORDER.orderId, OLD.orderId, 'a different order id')
  assert.notEqual(ORDER.sealedText, OLD.sealedText,
    'a different sealed text, so no receipt or audit line is ambiguous about which scope it came from')
  assert.notEqual(computeOrderHash(ORDER), computeOrderHash(OLD), 'and a different hash')
  assert.equal(ORDER.approvalId, '', 'it carries NO approval — a fresh one is required')
})

test('*** the old three-step order is untouched and recorded as superseded ***', () => {
  // Not modified, not reused, and not quietly deleted either: it is the evidence of what was
  // approved before, and an approval that no longer applies must still be findable.
  assert.equal(OLD.steps.length, 3, 'the old order still says what it always said')
  assert.equal(OLD.steps[2].action, 'save')
  const note = fs.readFileSync(path.join(REPO, 'docs', 'governance', 'canary-work-order.SUPERSEDED.md'), 'utf8')
  assert.match(note, /SUPERSEDED, NEVER EXECUTED/)
  assert.match(note, /Do not reuse any approval taken against it/)
  assert.match(note, new RegExp(computeOrderHash(OLD).slice(0, 8)), 'the superseded hash is named')
})

/* ── 2. what a pass may and may not be called ─────────────────────────────── */

test('*** the permitted wording is fixed, and the forbidden claims are named ***', () => {
  const note = fs.readFileSync(path.join(REPO, 'docs', 'governance', 'canary-work-order.SUPERSEDED.md'), 'utf8')
  assert.match(note, /UI INTERACTION CANARY PASSED — OPEN_APP AND TYPE_TEXT PROVEN; SAVE CAPABILITY NOT PROVEN/)
  for (const forbidden of ['Computer Operator complete', 'full workflow proven', 'file output proven', 'save path verified']) {
    assert.ok(note.includes(forbidden), 'the forbidden phrase is written down so it can be recognised: ' + forbidden)
  }
})

/* ── 3. cleanup is MEASURED, which type_text makes necessary ──────────────── */

test('*** cleanup no longer claims closed:true without looking ***', () => {
  const op = CANARY.slice(CANARY.indexOf("'cleanup' {"))
  const body = op.slice(0, op.indexOf('\n  }') + 4)

  // The old code called CloseMainWindow and reported success. Measured: on a DIRTY document
  // that raises a confirmation dialog and the process does not exit — and type_text is what
  // makes the document dirty, so in this canary that is the normal path.
  assert.match(body, /processExited/, 'exit is reported as a measured fact')
  assert.match(body, /notepadWindowsAfter/, 'and the window count after')
  assert.match(body, /notepadProcessesAfter/)
  assert.match(body, /ok = \(\$exited -and \$winsAfter -eq 0\)/, 'ok is DERIVED from the measurements')
  assert.match(body, /Stop-Process -Id \$procId -Force/, 'with a bounded guarantee when it does not exit')
  assert.match(body, /forced/, 'and it says when it had to')

  // It must not press its way out of the confirmation dialog: a "Don't save" button is exactly
  // as unreachable as Save was, and guessing at one would repeat the mistake.
  assert.equal(/Invoke\(\)/.test(body), false, 'cleanup invokes nothing')
  assert.equal(/Don't save|Do not save/i.test(body.replace(/#.*$/gm, '')), false, 'and does not hunt for a dismiss button')

  // Session is checked on BOTH paths — before closing and before forcing.
  const sessionChecks = (body.match(/session_changed/g) || []).length
  assert.ok(sessionChecks >= 2, 'session is re-checked before the forced kill, not only before the polite one')
})

/* ── 4. the acceptance properties the Owner listed ────────────────────────── */

test('*** the binding is established once and reused — never re-derived per step ***', () => {
  const ex = fs.readFileSync(path.join(__dirname, 'computerExecutor.js'), 'utf8')
  // open_app produces it; later steps receive the frozen object.
  assert.match(ex, /Object\.freeze\(\{[\s\S]{0,400}uiaRuntimeId: bind\.uiaRuntimeId/, 'the binding is frozen')
  // and the canary re-resolves that SAME binding rather than looking for a window again
  const tt = CANARY.slice(CANARY.indexOf("'type_text' {"))
  assert.match(tt.slice(0, 300), /Resolve-Binding -Bind \$payload\.bind/, 'type_text resolves the handed binding')
})

test('*** no focus inference, no keyboard, no "any Notepad window" fallback ***', () => {
  const code = CANARY.replace(/^\s*#.*$/gm, '')
  for (const [what, re] of [
    ['focus', /GetFocusedElement|FocusedElement|SetFocus/],
    ['keyboard', /SendKeys|SendInput|keybd_event|\[System\.Windows\.Forms\]/],
    ['activation', /AppActivate/]
  ]) {
    assert.equal(re.test(code), false, 'must not use ' + what)
  }
  // The window is the one that appeared between our own measurement and our own launch.
  assert.match(code, /notepad_already_open/, 'a pre-existing window is refused, not adopted')
  assert.match(code, /window_ambiguous/, 'more than one is refused, never chosen between')
  assert.match(code, /uia_control_ambiguous/, 'and so is more than one control')
})

test('*** type_text reads back and refuses on any mismatch ***', () => {
  const tt = CANARY.slice(CANARY.indexOf("'type_text' {"))
  const body = tt.slice(0, tt.indexOf("\n  'save_as'"))
  assert.match(body, /ValuePattern/, 'set by pattern, not keystroke')
  assert.match(body, /\$readBack = \[string\] \$vp\.Current\.Value/, 'it reads back')
  assert.match(body, /text_not_set/, 'and a mismatch is a refusal')
})

test('*** save remains a KNOWN action that this order simply does not use ***', () => {
  // Deleting it would be the wrong fix: the executor would stop refusing a save order coherently,
  // and the capability question would become invisible instead of open.
  assert.ok(gate.RESTRICTED_ACTIONS.includes('save'), 'still gated')
  const ex = fs.readFileSync(path.join(__dirname, 'computerExecutor.js'), 'utf8')
  assert.match(ex, /'open_app', 'type_text', 'save'/, 'still a known action')
  const backlog = fs.readFileSync(path.join(REPO, 'docs', 'governance', 'BACKLOG-002-targeted-native-save-activation.md'), 'utf8')
  assert.match(backlog, /BM_CLICK/, 'and the work is carried, not dropped')
  assert.match(backlog, /never become an arbitrary `SendMessage` capability/i)
})
