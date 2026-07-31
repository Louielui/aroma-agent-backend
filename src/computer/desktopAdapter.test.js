'use strict'

/**
 * desktopAdapter.test.js — the adapter, driven through a fake runner.
 *
 * ── WHAT THESE TESTS CAN AND CANNOT SETTLE ─────────────────────────────────
 * They settle the adapter's CONTRACT: which op it asks for, what it refuses, and that it never
 * substitutes one mechanism for another. They settle nothing about real UI Automation, because
 * no desktop is involved — the runner is a stub.
 *
 * Per the Owner's wording rule of 2026-07-31, what a green run here licenses is the term
 * SOURCE-CONSTRAINED. Not verified, not blocked, not passed. Whether a ValuePattern actually
 * exists on this machine's Notepad is a question only EXECUTE can answer.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createDesktopAdapter, OPS } = require('./desktopAdapter')

const BIND = { processId: 4242, sessionId: 1, windowHandle: '0x9001', uiaControlId: 'Edit1' }

/** Records every call, and answers whatever the test tells it to. */
function fakeRunner (answers = {}) {
  const calls = []
  return {
    calls,
    run (scriptPath, payload) {
      calls.push({ scriptPath, payload })
      const a = answers[payload.op]
      if (typeof a === 'function') return a(payload)
      if (a) return a
      return { ok: true }
    }
  }
}

const OPEN_OK = { ok: true, processId: 4242, sessionId: 1, windowHandle: '0x9001', uiaControlId: 'Edit1' }

const mk = (answers, over = {}) => createDesktopAdapter(Object.assign({ runner: fakeRunner(answers) }, over))

/* ── it cannot exist without an injected runner ───────────────────────────── */

test('*** no runner, no adapter — it refuses to be constructed ***', () => {
  for (const deps of [{}, { runner: null }, { runner: {} }, { runner: { run: 'nope' } }]) {
    assert.throws(() => createDesktopAdapter(deps), /no_runner/)
  }
})

test('the op set is closed', () => {
  assert.deepEqual([...OPS].sort(), ['cleanup', 'open_app', 'save_as', 'type_text', 'verify_binding'])
})

/* ── open_app ─────────────────────────────────────────────────────────────── */

test('*** only notepad, and it is launched by NAME, never by path ***', () => {
  const runner = fakeRunner({ open_app: OPEN_OK })
  const a = createDesktopAdapter({ runner })
  a.openApp({ appId: 'notepad' })
  assert.equal(runner.calls[0].payload.appId, 'notepad', 'a bare id, not an executable')

  for (const appId of ['notepad.exe', 'C:\\Windows\\notepad.exe', 'cmd', 'powershell', '', null]) {
    assert.throws(() => mk({ open_app: OPEN_OK }).openApp({ appId }), /app_not_allowed/, String(appId))
  }
})

test('*** an incomplete binding is refused — a partial identity is not an identity ***', () => {
  for (const field of ['processId', 'sessionId', 'windowHandle', 'uiaControlId']) {
    const res = Object.assign({}, OPEN_OK); delete res[field]
    assert.throws(() => mk({ open_app: res }).openApp({ appId: 'notepad' }), /incomplete_binding/, field)
  }
})

test('*** an ambiguous window is a refusal, not a choice ***', () => {
  // The unverified Notepad question lands exactly here: if a launch produces more than one
  // candidate, picking one would be guessing which window is ours.
  assert.throws(
    () => mk({ open_app: { ok: false, reason: 'window_ambiguous' } }).openApp({ appId: 'notepad' }),
    /window_ambiguous/)
})

/* ── type_text: one mechanism, no alternatives ────────────────────────────── */

test('*** text is only ever accepted as having gone through ValuePattern ***', () => {
  const a = mk({ type_text: { ok: true, method: 'ValuePattern' } })
  const r = a.typeTextIntoControl({ bind: BIND, text: 'hello' })
  assert.match(r.detail, /ValuePattern/)

  // Any other reported mechanism is rejected AFTER the fact as well — if the helper ever
  // returned "SendKeys", the adapter refuses to call that a success.
  for (const method of ['SendKeys', 'keystrokes', 'clipboard', 'focus', undefined, null]) {
    assert.throws(() => mk({ type_text: { ok: true, method } }).typeTextIntoControl({ bind: BIND, text: 'x' }),
      /wrong_input_method/, String(method))
  }
})

test('*** a missing binding refuses before anything is sent ***', () => {
  const runner = fakeRunner({ type_text: { ok: true, method: 'ValuePattern' } })
  const a = createDesktopAdapter({ runner })
  assert.throws(() => a.typeTextIntoControl({ bind: null, text: 'x' }), /missing_binding/)
  assert.equal(runner.calls.length, 0, 'the runner was never called')
})

test('a stale binding surfaces as the refusal the helper gave, not as a retry', () => {
  assert.throws(() => mk({ type_text: { ok: false, reason: 'stale_binding', detail: 'window_changed' } })
    .typeTextIntoControl({ bind: BIND, text: 'x' }), /stale_binding/)
})

test('there is no parameter that could ask for a different input method', () => {
  // A caller cannot request keystrokes, because the shape to request them does not exist.
  const runner = fakeRunner({ type_text: { ok: true, method: 'ValuePattern' } })
  const a = createDesktopAdapter({ runner })
  a.typeTextIntoControl({ bind: BIND, text: 'x', method: 'SendKeys', fallback: true })
  const sent = runner.calls[0].payload
  assert.deepEqual(Object.keys(sent).sort(), ['bind', 'op', 'text', 'timeoutSec'],
    'the extra keys were never forwarded — the payload shape is fixed')
})

/* ── save: the application saves, we do not ───────────────────────────────── */

test('*** a save is only a success if the helper says SaveAsDialog AND created ***', () => {
  const a = mk({ save_as: { ok: true, method: 'SaveAsDialog', created: true, path: 'C:\\Aroma\\ComputerOperator-Test\\c.txt' } })
  assert.match(a.saveAsViaUi({ bind: BIND, dir: 'C:\\Aroma\\ComputerOperator-Test\\', fileName: 'c.txt' }).detail, /c\.txt/)

  for (const res of [
    { ok: true, method: 'WriteAllText', created: true },
    { ok: true, method: 'fs', created: true },
    { ok: true, method: 'SaveAsDialog', created: false },
    { ok: true, method: 'SaveAsDialog' }
  ]) {
    assert.throws(() => mk({ save_as: res }).saveAsViaUi({ bind: BIND, dir: 'd', fileName: 'f' }),
      /wrong_save_method|save_not_confirmed/, JSON.stringify(res))
  }
})

test('*** a missing directory is a refusal — the adapter never creates one ***', () => {
  assert.throws(() => mk({ save_as: { ok: false, reason: 'allowed_dir_missing', detail: 'C:\\Aroma\\ComputerOperator-Test' } })
    .saveAsViaUi({ bind: BIND, dir: 'C:\\Aroma\\ComputerOperator-Test\\', fileName: 'c.txt' }), /allowed_dir_missing/)
})

test('*** an existing file is a refusal, never an overwrite ***', () => {
  assert.throws(() => mk({ save_as: { ok: false, reason: 'refuse_overwrite' } })
    .saveAsViaUi({ bind: BIND, dir: 'd\\', fileName: 'c.txt' }), /refuse_overwrite/)
})

/* ── verifyBinding: any doubt answers no ──────────────────────────────────── */

test('*** every mismatch answers no, and says which one ***', () => {
  const cases = [
    [{ ok: true, processId: 9999, sessionId: 1, windowHandle: '0x9001', uiaControlPresent: true }, 'process_identity_changed'],
    [{ ok: true, processId: 4242, sessionId: 2, windowHandle: '0x9001', uiaControlPresent: true }, 'session_changed'],
    [{ ok: true, processId: 4242, sessionId: 1, windowHandle: '0xBEEF', uiaControlPresent: true }, 'window_changed'],
    [{ ok: true, processId: 4242, sessionId: 1, windowHandle: '0x9001', uiaControlPresent: false }, 'uia_control_missing']
  ]
  for (const [res, reason] of cases) {
    assert.deepEqual(mk({ verify_binding: res }).verifyBinding(BIND), { ok: false, reason }, reason)
  }
  const good = { ok: true, processId: 4242, sessionId: 1, windowHandle: '0x9001', uiaControlPresent: true }
  assert.deepEqual(mk({ verify_binding: good }).verifyBinding(BIND), { ok: true })
})

test('a helper failure during verification answers no, rather than throwing into the run', () => {
  assert.deepEqual(mk({ verify_binding: { ok: false, reason: 'process_gone' } }).verifyBinding(BIND),
    { ok: false, reason: 'process_gone' })
  assert.deepEqual(mk({}).verifyBinding(null), { ok: false, reason: 'missing_binding' })
})

/* ── cleanup: bounded, and never louder than the failure it follows ───────── */

test('*** cleanup never throws — it must not replace the original failure ***', () => {
  const a = mk({ cleanup: () => { throw new Error('boom') } })
  assert.deepEqual(a.cleanup({ bind: BIND }), { ok: false, reason: 'cleanup_failed' })
  assert.deepEqual(mk({}).cleanup({ bind: null }), { ok: false, reason: 'nothing_to_clean' })
})

test('cleanup is bounded to the recorded binding', () => {
  const runner = fakeRunner({ cleanup: { ok: true } })
  createDesktopAdapter({ runner }).cleanup({ bind: BIND })
  assert.deepEqual(runner.calls[0].payload.bind, BIND, 'it can only name what it opened')
})

/* ── the script path is fixed, never composed ─────────────────────────────── */

test('*** every call goes to the same fixed script, with data as a payload ***', () => {
  const runner = fakeRunner({ open_app: OPEN_OK, type_text: { ok: true, method: 'ValuePattern' } })
  const a = createDesktopAdapter({ runner })
  a.openApp({ appId: 'notepad' })
  a.typeTextIntoControl({ bind: BIND, text: 'x' })
  for (const c of runner.calls) {
    assert.equal(c.scriptPath, 'scripts/computer/uiaCanary.ps1', 'one script, fixed at construction')
    assert.equal(typeof c.payload, 'object', 'arguments travel as data, never as a command string')
  }
})

test('an unknown op cannot be reached through the public surface', () => {
  const a = mk({})
  assert.deepEqual(Object.keys(a).sort(), ['cleanup', 'openApp', 'saveAsViaUi', 'typeTextIntoControl', 'verifyBinding'])
})
