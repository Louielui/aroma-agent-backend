'use strict'

/**
 * computerExecutor.test.js — the canary execution path.
 *
 * The whole point of these tests is ONE claim, and it is a claim about ORDERING rather than
 * about error handling: nothing irreversible happens before a durable record of the intent to
 * do it exists. So every audit-failure test asserts a COUNT OF DESKTOP ACTIONS, not a return
 * value. A refusal that arrives after the typing has happened is not fail-closed, and a test
 * that only reads `ok:false` cannot tell the two apart.
 *
 * The fake desktop counts every call it receives. That counter is the evidence.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  createComputerExecutor, computeOrderHash, validateOrder,
  ALLOWED_SAVE_DIR, LIMITS, ACTIONS
} = require('./computerExecutor')

/* ── fakes ────────────────────────────────────────────────────────────────── */

const BIND = { processId: 4242, sessionId: 1, windowHandle: '0x9001', uiaControlId: 'Edit1' }
const TEXT = 'Aroma Computer Operator canary. Round 1.'

/** Counts every desktop call. `calls` is the number the fail-closed tests assert on. */
function fakeDesktop (over = {}) {
  const d = {
    calls: 0,
    log: [],
    cleanedUp: 0,
    openApp ({ appId }) { d.calls++; d.log.push('open:' + appId); return { bind: Object.assign({}, BIND), detail: appId } },
    typeTextIntoControl ({ text }) { d.calls++; d.log.push('type:' + text); return { detail: text.length + ' chars' } },
    saveAsViaUi ({ dir, fileName }) { d.calls++; d.log.push('save:' + dir + fileName); return { detail: dir + fileName } },
    verifyBinding () { return { ok: true } },
    cleanup () { d.cleanedUp++ }
  }
  return Object.assign(d, over)
}

function fakeStore () {
  const written = []
  return { written, kinds: () => written.map((w) => w.kind), write: (t, r) => { written.push({ type: t, kind: r.kind, record: r }); return r } }
}

/** A sink that works until it is asked to write `failOn`, then throws. */
function storeFailingOn (failOn, opts = {}) {
  const written = []
  let seen = 0
  return {
    written,
    kinds: () => written.map((w) => w.kind),
    write: (t, r) => {
      if (r.kind === failOn) {
        seen++
        if (!opts.nth || seen === opts.nth) throw new Error('sink refused: ' + failOn)
      }
      written.push({ type: t, kind: r.kind, record: r })
      return r
    }
  }
}

function seal (over = {}) {
  const o = Object.assign({
    orderId: 'wo_canary_1',
    approvalId: 'appr_canary_1',
    sealed: true,
    sealedText: TEXT,
    steps: [
      { n: 1, action: 'open_app', appId: 'notepad' },
      { n: 2, action: 'type_text', text: TEXT, bind: Object.assign({}, BIND) },
      { n: 3, action: 'save', fileName: 'canary-1.txt', bind: Object.assign({}, BIND) }
    ]
  }, over)
  if (!o.orderHash) o.orderHash = computeOrderHash(o)
  return o
}

const ON = { flagOn: true }
const mk = (store, desktop, extra = {}) => createComputerExecutor(Object.assign({ artifactStore: store, desktop, now: () => 1, newId: () => 'cexec_test' }, extra))

/* ── 0. the supervisor stays inert ────────────────────────────────────────── */

test('*** the SUPERVISOR did not gain the ability to act ***', () => {
  const sup = require('./computerSupervisor')
  const s = sup.createComputerSupervisor({ artifactStore: fakeStore(), now: () => 1 })
  assert.equal(s.capabilities.execute, false, 'still false')
  assert.equal(s.capabilities.touchesDesktop, false, 'still false')
  for (const forbidden of ['execute', 'run', 'perform', 'act', 'apply', 'commit']) {
    assert.equal(typeof s[forbidden], 'undefined', 'supervisor must not expose: ' + forbidden)
  }
})

test('*** the supervisor imports nothing that can reach a desktop ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'computerSupervisor.js'), 'utf8')
  const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  const banned = /child_process|node:child_process|robotjs|nut-js|@nut-tree|ffi|koffi|edge-js|powershell|winax|node-window-manager|screenshot|automation/i
  for (const r of requires) {
    assert.ok(!banned.test(r), 'supervisor must not require an execution/desktop library: ' + r)
  }
  assert.ok(!/computerExecutor/.test(src), 'and must not reach the executor either')
})

/* ── 1. admission: the record comes before ANY action ─────────────────────── */

test('*** admission audit throws -> ZERO desktop actions ***', () => {
  const store = storeFailingOn('admission')
  const d = fakeDesktop()
  const res = mk(store, d).execute(seal(), ON)

  assert.equal(d.calls, 0, 'THE assertion: not one desktop call was attempted')
  assert.deepEqual(d.log, [])
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'audit_write_failed')
  assert.equal(res.phase, 'admission')
  assert.equal(res.desktopActions, 0)
})

test('an unconfigured sink is the same refusal — a missing sink is a failed sink', () => {
  const d = fakeDesktop()
  const res = createComputerExecutor({ artifactStore: null, desktop: d }).execute(seal(), ON)
  assert.equal(d.calls, 0)
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'audit_write_failed')
})

test('the admission record lands BEFORE the first step-start, in that order', () => {
  const store = fakeStore()
  mk(store, fakeDesktop()).execute(seal(), ON)
  assert.deepEqual(store.kinds(), [
    'admission',
    'step-start', 'step-outcome',
    'step-start', 'step-outcome',
    'step-start', 'step-outcome',
    'completed'
  ], 'the chain interleaves start/outcome per step and opens with admission')
})

/* ── 2. step-start: the record comes before EACH step ─────────────────────── */

test('*** step-start audit throws -> that step performs ZERO actions ***', () => {
  // Fail the step-start for step 2, so step 1 has genuinely happened first. If the guard were
  // after the action instead of before it, the count would read 2.
  const store = storeFailingOn('step-start', { nth: 2 })
  const d = fakeDesktop()
  const res = mk(store, d).execute(seal(), ON)

  assert.equal(d.calls, 1, 'step 1 ran; step 2 did not start')
  assert.deepEqual(d.log, ['open:notepad'], 'no typing was attempted')
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'audit_write_failed')
  assert.equal(res.phase, 'step-start')
  assert.equal(res.failedStep, 2)
  assert.equal(res.stepsRun, 1)
})

test('a step-start failure on the FIRST step leaves the desktop untouched', () => {
  const d = fakeDesktop()
  const res = mk(storeFailingOn('step-start'), d).execute(seal(), ON)
  assert.equal(d.calls, 0)
  assert.equal(res.failedStep, 1)
})

/* ── 3. outcome: a step we cannot record stops the run ────────────────────── */

test('*** step-outcome audit throws -> no FURTHER steps, and cleanup runs ***', () => {
  const store = storeFailingOn('step-outcome')
  const d = fakeDesktop()
  const res = mk(store, d).execute(seal(), ON)

  assert.equal(d.calls, 1, 'step 1 happened and cannot be undone — steps 2 and 3 never start')
  assert.deepEqual(d.log, ['open:notepad'])
  assert.equal(d.cleanedUp, 1, 'and the run cleans up rather than walking away')
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'audit_write_failed')
  assert.equal(res.phase, 'step-outcome')
  assert.equal(res.cleanup, 'attempted')
  assert.equal(res.auditChainComplete, false)
})

test('*** a PASS is only issued once the whole chain is on disk ***', () => {
  // The final record failing must not yield a PASS, even though every step succeeded.
  const d = fakeDesktop()
  const res = mk(storeFailingOn('completed'), d).execute(seal(), ON)
  assert.equal(d.calls, 3, 'all three steps did run')
  assert.equal(res.ok, false, 'but there is no PASS without the closing record')
  assert.equal(res.auditChainComplete, false)

  const good = mk(fakeStore(), fakeDesktop()).execute(seal(), ON)
  assert.equal(good.ok, true)
  assert.equal(good.auditChainComplete, true, 'a PASS carries the completed chain')
  assert.equal(good.stepsRun, 3)
})

/* ── 4. the closed enum ───────────────────────────────────────────────────── */

test('*** the action enum is closed — exactly three ***', () => {
  assert.deepEqual([...ACTIONS].sort(), ['open_app', 'save', 'type_text'])
})

test('*** an unknown action is refused, with zero actions ***', () => {
  for (const bad of ['click', 'run_command', 'open_browser', 'copy_file', 'sendkeys', '', null]) {
    const d = fakeDesktop()
    const o = seal({ steps: [{ n: 1, action: bad, appId: 'notepad' }] })
    const res = mk(fakeStore(), d).execute(o, ON)
    assert.equal(d.calls, 0, 'nothing ran for: ' + bad)
    assert.equal(res.refusal, 'unknown_action', 'refused: ' + bad)
  }
})

test('*** an EXTRA field is refused — the schema is exact, not a minimum ***', () => {
  const cases = [
    { n: 1, action: 'open_app', appId: 'notepad', path: 'C:\\Windows\\System32\\cmd.exe' },
    { n: 1, action: 'open_app', appId: 'notepad', arguments: '/c whoami' },
    { n: 1, action: 'open_app', appId: 'notepad', exe: 'notepad++.exe' }
  ]
  for (const step of cases) {
    const d = fakeDesktop()
    const res = mk(fakeStore(), d).execute(seal({ steps: [step] }), ON)
    assert.equal(d.calls, 0)
    assert.equal(res.refusal, 'unexpected_field', JSON.stringify(step))
    assert.match(res.reason, /unexpected field/)
  }
})

test('*** only Notepad, and only as an id — never an exe or a path ***', () => {
  for (const appId of ['notepad.exe', 'C:\\Windows\\notepad.exe', 'cmd', 'powershell', 'explorer', 'chrome', 'winword', '']) {
    const d = fakeDesktop()
    const res = mk(fakeStore(), d).execute(seal({ steps: [{ n: 1, action: 'open_app', appId }] }), ON)
    assert.equal(d.calls, 0)
    assert.equal(res.refusal, 'app_not_allowed', 'refused: ' + appId)
  }
})

test('*** the text is the SEALED text — anything else is refused ***', () => {
  const o = seal()
  o.steps[1].text = TEXT + ' and one more thing'
  o.orderHash = computeOrderHash(o) // re-seal the hash, so ONLY the text rule can catch it
  const d = fakeDesktop()
  const res = mk(fakeStore(), d).execute(o, ON)
  assert.equal(d.calls, 0)
  assert.equal(res.refusal, 'text_not_sealed')
})

/* ── 5. the save is a NEW file, inside one directory, via the UI ──────────── */

test('*** a filename that is a path, traversal or absolute is refused ***', () => {
  const bad = [
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
    '..\\..\\Windows\\evil.txt',
    'sub\\canary.txt',
    'sub/canary.txt',
    '..',
    'C:canary.txt',
    'canary txt.txt',
    ''
  ]
  for (const fileName of bad) {
    const d = fakeDesktop()
    const res = mk(fakeStore(), d).execute(seal({ steps: [{ n: 1, action: 'save', fileName, bind: Object.assign({}, BIND) }] }), ON)
    assert.equal(d.calls, 0, 'nothing ran for: ' + fileName)
    assert.equal(res.refusal, 'bad_filename', 'refused: ' + JSON.stringify(fileName))
  }
})

test('the save target is always inside the one allowed directory', () => {
  const d = fakeDesktop()
  mk(fakeStore(), d).execute(seal(), ON)
  assert.equal(ALLOWED_SAVE_DIR, 'C:\\Aroma\\ComputerOperator-Test\\')
  assert.deepEqual(d.log[2], 'save:C:\\Aroma\\ComputerOperator-Test\\canary-1.txt')
})

test('*** an existing file is never overwritten ***', () => {
  const d = fakeDesktop()
  const fsProbe = { exists: (p) => p === ALLOWED_SAVE_DIR + 'canary-1.txt' }
  const res = mk(fakeStore(), d, { fsProbe }).execute(seal(), ON)
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'step_failed')
  assert.match(res.reason, /refuse_overwrite/)
  assert.equal(d.log.filter((l) => l.startsWith('save')).length, 0, 'the save was never attempted')
})

/* ── 6. binding: stale identity is a refusal, never a re-bind ─────────────── */

test('*** a binding that does not match the opened app is refused ***', () => {
  for (const field of ['processId', 'sessionId', 'windowHandle', 'uiaControlId']) {
    const o = seal()
    o.steps[1].bind = Object.assign({}, BIND, { [field]: 'WRONG' })
    o.orderHash = computeOrderHash(o)
    const d = fakeDesktop()
    const res = mk(fakeStore(), d).execute(o, ON)
    assert.equal(res.refusal, 'stale_binding', 'refused on ' + field)
    assert.equal(d.calls, 1, 'only the open ran; the typing did not')
  }
})

test('*** a missing UIA control is a refusal, not a fallback ***', () => {
  // There is deliberately no "type into whatever has focus" path. If the control is gone the
  // run stops, because the alternative is typing into an unknown window.
  const d = fakeDesktop({ verifyBinding: () => ({ ok: false, reason: 'uia_control_missing' }) })
  const res = mk(fakeStore(), d).execute(seal(), ON)
  assert.equal(res.refusal, 'stale_binding')
  assert.equal(res.reason, 'uia_control_missing')
  assert.equal(d.calls, 1, 'no typing was attempted anywhere')
})

test('a step that binds without any open_app before it is refused', () => {
  const o = seal({ steps: [{ n: 1, action: 'type_text', text: TEXT, bind: Object.assign({}, BIND) }] })
  const d = fakeDesktop()
  const res = mk(fakeStore(), d).execute(o, ON)
  assert.equal(res.refusal, 'missing_binding')
  assert.equal(d.calls, 0)
})

test('type_text and save MUST carry a full binding', () => {
  for (const field of ['processId', 'sessionId', 'windowHandle', 'uiaControlId']) {
    const bind = Object.assign({}, BIND); delete bind[field]
    const res = validateOrder(seal({ steps: [{ n: 1, action: 'open_app', appId: 'notepad' }, { n: 2, action: 'type_text', text: TEXT, bind }] }), ON)
    assert.equal(res.refusal, 'missing_binding', 'required: ' + field)
  }
})

/* ── 7. the seal itself ───────────────────────────────────────────────────── */

test('*** a wrong hash is refused — with zero actions ***', () => {
  const d = fakeDesktop()
  const res = mk(fakeStore(), d).execute(seal({ orderHash: 'f'.repeat(64) }), ON)
  assert.equal(d.calls, 0)
  assert.equal(res.refusal, 'order_hash_mismatch')
})

test('*** editing a sealed step invalidates the hash ***', () => {
  // The seal has to bind the MEANING, or it protects nothing. Change any field the executor
  // acts on and the computed hash must move — asserted for every mutation below.
  //
  // Which GATE then refuses is a second question, and the answer is "whichever comes first".
  // The per-step rules run before the hash comparison, so a mutation that also breaks a
  // content rule is caught by that rule and never reaches the hash. That is defence in depth
  // working as intended, so each case records the gate that actually fires rather than
  // pretending the hash is the only one.
  const base = seal()
  const mutations = [
    ['appId -> cmd', (o) => { o.steps[0].appId = 'cmd' }, 'app_not_allowed'],
    ['text changed', (o) => { o.steps[1].text = 'something else' }, 'text_not_sealed'],
    ['fileName changed', (o) => { o.steps[2].fileName = 'other.txt' }, 'order_hash_mismatch'],
    ['step appended', (o) => { o.steps.push({ n: 4, action: 'save', fileName: 'extra.txt', bind: Object.assign({}, BIND) }) }, 'order_hash_mismatch'],
    ['approvalId swapped', (o) => { o.approvalId = 'appr_other' }, 'order_hash_mismatch']
  ]
  for (const [label, mutate, expected] of mutations) {
    const o = JSON.parse(JSON.stringify(base))
    mutate(o)
    assert.notEqual(computeOrderHash(o), base.orderHash, label + ': the hash must move')

    const d = fakeDesktop()
    const res = mk(fakeStore(), d).execute(Object.assign(o, { orderHash: base.orderHash }), ON)
    assert.equal(res.ok, false, label + ': refused')
    assert.equal(res.refusal, expected, label)
    assert.equal(d.calls, 0, label + ': and nothing ran')
  }
})

test('the hash gate is reachable on its own, not merely shadowed by the content rules', () => {
  // Without this, the case above could pass while the hash comparison was dead code.
  const o = seal()
  const untouchedButResealed = Object.assign({}, o, { orderHash: computeOrderHash(Object.assign({}, o, { orderId: 'other' })) })
  const d = fakeDesktop()
  const res = mk(fakeStore(), d).execute(untouchedButResealed, ON)
  assert.equal(res.refusal, 'order_hash_mismatch', 'every content rule passes; only the hash refuses')
  assert.equal(d.calls, 0)
})

test('an unsealed or unapproved order never runs', () => {
  for (const [over, refusal] of [
    [{ sealed: false }, 'order_not_sealed'],
    [{ sealed: undefined }, 'order_not_sealed'],
    [{ approvalId: null }, 'order_not_approved'],
    [{ approvalId: '' }, 'order_not_approved']
  ]) {
    const d = fakeDesktop()
    const res = mk(fakeStore(), d).execute(seal(over), ON)
    assert.equal(res.refusal, refusal)
    assert.equal(d.calls, 0)
  }
  const noHash = seal(); delete noHash.orderHash
  assert.equal(validateOrder(noHash, ON).refusal, 'order_not_sealed')
})

test('the step ceiling and the one-in-flight rule are in force', () => {
  assert.equal(LIMITS.maxSteps, 10)
  assert.equal(LIMITS.timeoutSec, 300)
  assert.equal(LIMITS.oneStepInFlight, true)
  const steps = Array.from({ length: 11 }, (_, i) => ({ n: i + 1, action: 'open_app', appId: 'notepad' }))
  assert.equal(validateOrder(seal({ steps }), ON).refusal, 'too_many_steps')
})

/* ── 8. the flag, and the absence of an adapter ───────────────────────────── */

test('*** COMPUTER_OPERATOR is OFF in this process, and the executor refuses while it is ***', () => {
  assert.notEqual(process.env.COMPUTER_OPERATOR, '1', 'the flag must not be set by the test run')
  assert.notEqual(process.env.COMPUTER_OPERATOR, 'on')

  const d = fakeDesktop()
  const res = mk(fakeStore(), d).execute(seal(), {}) // flagOn omitted
  assert.equal(d.calls, 0)
  assert.equal(res.refusal, 'flag_off')
})

test('*** with no adapter the path is assembled but INERT ***', () => {
  // This is the PREPARE-phase shape: everything is wired, the seal is checked, the admission
  // record lands — and there is still no route to a desktop.
  const store = fakeStore()
  const ex = createComputerExecutor({ artifactStore: store, now: () => 1, newId: () => 'x' })
  assert.equal(ex.capabilities.touchesDesktop, false, 'no adapter, no desktop')
  const res = ex.execute(seal(), ON)
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'no_desktop_adapter')
  assert.ok(store.kinds().includes('admission'), 'the attempt is recorded even so')
})

test('*** the executor module itself imports no execution library ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'computerExecutor.js'), 'utf8')
  const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  assert.deepEqual(requires, ['node:crypto'], 'crypto only — the desktop arrives by injection')
  for (const banned of ['clipboard', 'SendKeys', 'sendkeys', 'exec(', 'spawn(']) {
    assert.ok(!src.includes(banned), 'must not mention: ' + banned)
  }
})

/* ── 9. the happy path, stated once so the refusals are not vacuous ───────── */

test('*** the canary sequence, when everything is right ***', () => {
  const store = fakeStore()
  const d = fakeDesktop()
  const res = mk(store, d).execute(seal(), ON)

  assert.equal(res.ok, true)
  assert.equal(res.stepsRun, 3)
  assert.equal(res.desktopActions, 3)
  assert.deepEqual(d.log, [
    'open:notepad',
    'type:' + TEXT,
    'save:C:\\Aroma\\ComputerOperator-Test\\canary-1.txt'
  ])
  assert.equal(store.written.length, 8, 'admission + 3x(start,outcome) + completed')
  assert.ok(store.written.every((w) => w.type === 'computer-audit'), 'all under one audit kind')
})
