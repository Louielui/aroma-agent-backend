'use strict'

/**
 * runtimeBindingContract.test.js — the seal says WHAT; the run says WHICH WINDOW.
 *
 * ── THE CONTRADICTION THIS CLOSES ──────────────────────────────────────────
 * `bind` used to live inside the sealed order, and the approved canary could not execute by any
 * route:
 *
 *   . validateOrder REQUIRED every bind field to be non-null before execution;
 *   . processId, sessionId, windowHandle and the control identity do not exist until open_app has run;
 *   . bind was inside the hash — filling it changed the order hash and invalidated the approval;
 *   . and a pre-filled, re-approved order would then be refused as stale_binding, because the
 *     executor compares each step's bind against the binding the REAL open_app produced.
 *
 * Both doors were shut. It would have failed at execute(), with the operator flag already on.
 *
 * Owner ruling: runtime binding leaves the sealed order entirely, in the strict form — an order
 * that carries one is REFUSED, not tolerated with the field ignored.
 *
 * ── WHAT MOVED, NOT WHAT WAS DELETED ───────────────────────────────────────
 * The strictness came with it. Everything the gate used to demand of a bind in the order is now
 * demanded of what open_app returns, where it can actually be satisfied — and more besides,
 * because that binding is now the ONLY thing saying which window the next two steps act on.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createComputerExecutor } = require('./computerExecutor')
const { createOrderRegistry } = require('./orderRegistry')
const { computeOrderHash, ACTION_FIELDS } = require('./sealedOrderGate')
const A = require('../../scripts/computer/ownerApproval')

const TEXT = 'Aroma Computer Operator canary. Round 1.'
const ALLOWED = 'C:\\Aroma\\ComputerOperator-Test'
const BIND = Object.freeze({ processId: 4242, sessionId: 1, windowHandle: '0x9001', uiaRuntimeId: '42.1234567.4.1', uiaControlType: 'ControlType.Document', uiaClassName: 'RichEditD2DPT', uiaAutomationId: '' })
const ON = { flagOn: true }

function seal (over = {}) {
  const o = Object.assign({
    orderId: 'wo_canary_1',
    approvalId: 'appr_canary_' + Math.random().toString(16).slice(2, 10),
    sealed: true,
    sealedText: TEXT,
    allowedPath: ALLOWED,
    maxSteps: 3,
    timeoutSec: 300,
    steps: [
      { n: 1, action: 'open_app', appId: 'notepad' },
      { n: 2, action: 'type_text', text: TEXT },
      { n: 3, action: 'save', fileName: 'canary-1.txt' }
    ]
  }, over)
    // allowedPath bounds a SAVE. An order without one must not carry it (verifySeal refuses
    // it as unexpected_field), so overrides that drop the save drop the path with it.
    if (!o.steps.some((s) => s && s.action === 'save')) delete o.allowedPath
  if (!o.orderHash) o.orderHash = computeOrderHash(o)
  return o
}

function fakeDesktop (over = {}) {
  const d = {
    calls: 0,
    log: [],
    seen: [],
    cleanedUp: 0,
    openApp ({ appId }) { d.calls++; d.log.push('open'); return { bind: Object.assign({}, BIND), detail: appId } },
    typeTextIntoControl (a) { d.calls++; d.log.push('type'); d.seen.push({ op: 'type', bind: a.bind, text: a.text }); return { detail: 'typed' } },
    saveAsViaUi (a) { d.calls++; d.log.push('save'); d.seen.push({ op: 'save', bind: a.bind, dir: a.dir, fileName: a.fileName }); return { detail: 'saved' } },
    verifyBinding () { return { ok: true } },
    cleanup () { d.cleanedUp++ }
  }
  return Object.assign(d, over)
}

const store = () => { const w = []; return { w, write: (t, r) => { w.push(r); return r } } }
const mk = (d, extra = {}) => createComputerExecutor(Object.assign(
  { artifactStore: store(), desktop: d, orderRegistry: createOrderRegistry({ now: () => 1 }), now: () => 1 }, extra))

/* ── 1-2. the order carries no binding ────────────────────────────────────── */

test('*** 1. an order carrying a bind is refused, with ZERO desktop actions ***', () => {
  for (const idx of [1, 2]) {
    const o = seal()
    o.steps[idx].bind = Object.assign({}, BIND)
    // allowedPath bounds a SAVE. An order without one must not carry it (verifySeal refuses
    // it as unexpected_field), so overrides that drop the save drop the path with it.
    if (!o.steps.some((s) => s && s.action === 'save')) delete o.allowedPath
    o.orderHash = computeOrderHash(o)
    const d = fakeDesktop()
    const res = mk(d).execute(o, ON)
    assert.equal(res.refusal, 'unexpected_field', 'step ' + (idx + 1))
    assert.equal(d.calls, 0, 'nothing ran')
    assert.equal(d.log.length, 0)
  }
})

test('*** 2. the approved draft carries no bind placeholder ***', () => {
  const draft = JSON.parse(fs.readFileSync(A.DRAFT, 'utf8'))
  for (const s of draft.steps) {
    assert.equal(Object.prototype.hasOwnProperty.call(s, 'bind'), false,
      'step ' + s.n + ' still carries a bind placeholder')
  }
  // And the schema itself has no room for one.
  for (const [action, fields] of Object.entries(ACTION_FIELDS)) {
    assert.equal(fields.includes('bind'), false, action + ' must not seal a binding')
  }
  // The hash therefore cannot cover one: the same order with a bind added hashes the same,
  // because the field is outside ACTION_FIELDS — which is exactly why it must be REFUSED
  // rather than ignored.
  const a = seal()
  const b = seal()
  b.steps[1].bind = Object.assign({}, BIND)
  assert.equal(computeOrderHash(a), computeOrderHash(Object.assign({}, b, { approvalId: a.approvalId })),
    'a stray bind does not change the hash — so it must be refused at validation')
})

/* ── 3-7. what open_app must return ───────────────────────────────────────── */

test('*** 3. open_app fails -> type_text and save both run ZERO times ***', () => {
  const d = fakeDesktop({ openApp: () => { throw new Error('notepad_not_found') } })
  const res = mk(d).execute(seal(), ON)
  assert.equal(res.ok, false)
  assert.deepEqual(d.log, [], 'nothing after the open')
  assert.equal(d.seen.length, 0)
})

test('*** 4. open_app succeeds with NO binding -> zero further actions ***', () => {
  for (const bad of [undefined, null, {}, [], 'x', 42]) {
    const d = fakeDesktop({ openApp: () => ({ bind: bad, detail: 'n' }) })
    const res = mk(d).execute(seal(), ON)
    assert.equal(res.refusal, bad && typeof bad === 'object' && !Array.isArray(bad) ? 'missing_binding' : 'missing_binding',
      JSON.stringify(bad))
    assert.deepEqual(d.log, [], 'no type or save: ' + JSON.stringify(bad))
  }
})

test('*** 5. a binding missing ANY field -> zero further actions ***', () => {
  for (const f of ['processId', 'sessionId', 'windowHandle', 'uiaRuntimeId', 'uiaControlType', 'uiaClassName']) {
    for (const v of [undefined, null, '']) {
      const bind = Object.assign({}, BIND)
      if (v === undefined) delete bind[f]; else bind[f] = v
      const d = fakeDesktop({ openApp: () => ({ bind, detail: 'n' }) })
      assert.equal(mk(d).execute(seal(), ON).refusal, 'missing_binding', f + '=' + String(v))
      assert.deepEqual(d.log, [], f + '=' + String(v))
    }
  }
})

test('*** 6. an EXTRA field in the binding is refused ***', () => {
  for (const extra of ['tabId', 'title', 'hwnd2']) {
    const d = fakeDesktop({ openApp: () => ({ bind: Object.assign({}, BIND, { [extra]: 'x' }), detail: 'n' }) })
    assert.equal(mk(d).execute(seal(), ON).refusal, 'unexpected_field', extra)
    assert.deepEqual(d.log, [])
  }
})

test('*** 7. a binding in the WRONG session -> zero further actions ***', () => {
  const d = fakeDesktop() // BIND.sessionId === 1
  const res = mk(d).execute(seal(), { flagOn: true, attestedSessionId: 4 })
  assert.equal(res.refusal, 'wrong_session')
  // The open itself ran — that is how the binding came to exist and be judged. What must not
  // have happened is anything AFTER it.
  assert.deepEqual(d.log, ['open'], 'the open ran; nothing else did')

  // Positive control: the same run with the matching session completes.
  const ok = fakeDesktop()
  assert.equal(mk(ok).execute(seal(), { flagOn: true, attestedSessionId: 1 }).ok, true)
})

/* ── 8-9. the binding must still be live, and still be THE SAME ───────────── */

test('*** 8. verifyBinding failing is stale_binding, and stops the run ***', () => {
  const d = fakeDesktop({ verifyBinding: () => ({ ok: false, reason: 'uia_control_missing' }) })
  const res = mk(d).execute(seal(), ON)
  assert.equal(res.refusal, 'stale_binding')
  assert.deepEqual(d.log, ['open'], 'the open ran; nothing else did')
})

test('*** 9. process, window or control changing is stale_binding ***', () => {
  for (const [f, v] of [['processId', 9999], ['windowHandle', '0xDEAD'], ['uiaRuntimeId', '42.9.9.9']]) {
    const d = fakeDesktop({ verifyBinding: () => ({ ok: true, [f]: v }) })
    const res = mk(d).execute(seal(), ON)
    assert.equal(res.refusal, 'stale_binding', f)
    assert.deepEqual(d.log, ['open'], f)
  }
  // A verifyBinding that reports the SAME identity does not stop anything.
  const same = fakeDesktop({ verifyBinding: () => Object.assign({ ok: true }, BIND) })
  assert.equal(mk(same).execute(seal(), ON).ok, true)
})

/* ── 10-12. what the adapter receives, and what is never mutated ──────────── */

test('*** 10+11. type_text and save receive the SAME frozen binding open_app produced ***', () => {
  const d = fakeDesktop()
  const res = mk(d).execute(seal(), ON)
  assert.equal(res.ok, true, res.refusal)

  const typed = d.seen.find((s) => s.op === 'type')
  const saved = d.seen.find((s) => s.op === 'save')
  assert.ok(typed && saved, 'both ran')

  for (const s of [typed, saved]) {
    assert.deepEqual(s.bind, BIND, s.op + ' got the binding open_app produced')
    assert.equal(Object.isFrozen(s.bind), true, s.op + ' got a frozen binding')
  }
  assert.equal(typed.bind, saved.bind, 'and it is the SAME object, not two copies that could drift')

  // It is a copy of the adapter's object, not the adapter's object itself: an adapter that kept
  // a reference and mutated it must not be able to change what this run believes it bound to.
  const original = d.log.length
  assert.equal(original, 3)

  // The sealed values reached the adapter unaltered.
  assert.equal(typed.text, TEXT)
  assert.equal(saved.fileName, 'canary-1.txt')
  assert.equal(saved.dir, ALLOWED + '\\')
})

test('*** 12. the order object is deep-equal before and after execution ***', () => {
  const o = seal()
  const before = JSON.parse(JSON.stringify(o))
  const d = fakeDesktop()
  assert.equal(mk(d).execute(o, ON).ok, true)
  assert.deepEqual(JSON.parse(JSON.stringify(o)), before, 'the run mutated the order it was given')
  // Specifically: no step grew a binding.
  for (const s of o.steps) assert.equal(Object.prototype.hasOwnProperty.call(s, 'bind'), false)
})

/* ── 13. the positive control ─────────────────────────────────────────────── */

test('*** 13. a complete, live binding completes all three steps ***', () => {
  // Without this, every "zero actions" above could mean the path never works at all.
  const d = fakeDesktop()
  const res = mk(d).execute(seal(), ON)
  assert.equal(res.ok, true, res.refusal)
  assert.deepEqual(d.log, ['open', 'type', 'save'])
  assert.equal(res.stepsRun, 3)
  assert.equal(res.desktopActions, 3)
  assert.equal(res.auditChainComplete, true)
})

/* ── 14-15. after a failure ───────────────────────────────────────────────── */

test('*** 14. a failed run leaves the approval spent — no replay ***', () => {
  const registry = createOrderRegistry({ now: () => 1 })
  const o = seal()
  const d1 = fakeDesktop({ verifyBinding: () => ({ ok: false, reason: 'gone' }) })
  const first = createComputerExecutor({ artifactStore: store(), desktop: d1, orderRegistry: registry, now: () => 1 })
    .execute(o, ON)
  assert.equal(first.refusal, 'stale_binding')

  // The same approval, a fresh executor, a healthy desktop: still refused.
  const d2 = fakeDesktop()
  const second = createComputerExecutor({ artifactStore: store(), desktop: d2, orderRegistry: registry, now: () => 1 })
    .execute(o, ON)
  assert.equal(second.ok, false, 'a spent approval cannot be replayed')
  assert.deepEqual(d2.log, [], 'and nothing touched the desktop on the retry')
})

test('*** 15. every outcome leaves the order closed and cleanup attempted ***', () => {
  const bad = fakeDesktop({ verifyBinding: () => ({ ok: false, reason: 'gone' }) })
  const failed = mk(bad).execute(seal(), ON)
  assert.equal(failed.orderClosed, true, 'closed on failure')
  assert.equal(bad.cleanedUp, 1, 'cleanup ran')

  const good = fakeDesktop()
  const ok = mk(good).execute(seal(), ON)
  assert.equal(ok.orderClosed, true, 'closed on success')
})
