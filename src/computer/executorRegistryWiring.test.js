'use strict'

/**
 * executorRegistryWiring.test.js — the registry is now wired into the thing that ACTS.
 *
 * Until 2026-07-31 `orderRegistry` guarded the dry-run planner and nothing else: its
 * single-live-order rule, its per-step nonces and its expiry were real and reached no code that
 * could touch a desktop. The guarantee existed next to the risk rather than over it.
 *
 * Every test here asserts a COUNT OF DESKTOP ACTIONS wherever a refusal is claimed, for the same
 * reason the audit tests do: a refusal that arrives after the typing is not a refusal.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createComputerExecutor } = require('./computerExecutor')
const { createOrderRegistry } = require('./orderRegistry')
const { createComputerSupervisor } = require('./computerSupervisor')
const { computeOrderHash, ALLOWED_PATH } = require('./sealedOrderGate')

const BIND = { processId: 4242, sessionId: 1, windowHandle: '0x9001', uiaControlId: 'Edit1' }
const TEXT = 'Aroma Computer Operator canary. Round 1.'
const ON = { flagOn: true }

function fakeDesktop (over = {}) {
  const d = {
    calls: 0,
    log: [],
    openApp ({ appId }) { d.calls++; d.log.push('open'); return { bind: Object.assign({}, BIND) } },
    typeTextIntoControl () { d.calls++; d.log.push('type'); return {} },
    saveAsViaUi ({ dir, fileName }) { d.calls++; d.log.push('save'); return { detail: dir + fileName } },
    verifyBinding () { return { ok: true } },
    cleanup () {}
  }
  return Object.assign(d, over)
}

const fakeStore = () => ({ written: [], write (t, r) { this.written.push({ t, kind: r.kind }); return r } })

function seal (over = {}) {
  const o = Object.assign({
    orderId: 'wo_1',
    approvalId: 'appr_one',
    sealed: true,
    sealedText: TEXT,
    allowedPath: ALLOWED_PATH,
    maxSteps: 3,
    timeoutSec: 300,
    steps: [
      { n: 1, action: 'open_app', appId: 'notepad' },
      { n: 2, action: 'type_text', text: TEXT, bind: Object.assign({}, BIND) },
      { n: 3, action: 'save', fileName: 'canary-1.txt', bind: Object.assign({}, BIND) }
    ]
  }, over)
  if (!o.orderHash) o.orderHash = computeOrderHash(o)
  return o
}

/** A clock the test drives, so expiry is measured rather than waited for. */
function clock (start = 1000) {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

function build (over = {}) {
  const c = over.clock || clock()
  const registry = over.registry || createOrderRegistry({ now: c.now })
  const store = over.store || fakeStore()
  const desktop = over.desktop === null ? null : (over.desktop || fakeDesktop())
  const ex = createComputerExecutor({ artifactStore: store, desktop, orderRegistry: registry, now: c.now, newId: () => 'run_1' })
  return { ex, registry, store, desktop, clock: c }
}

/* ── 1. one live order ────────────────────────────────────────────────────── */

test('*** a SECOND live order is refused, with zero desktop actions ***', () => {
  const { ex, registry, desktop } = build()
  // Occupy the slot with a different order, as a concurrent run would.
  assert.equal(registry.admit({ approvalId: 'appr_other', workOrderHash: 'h', stepCount: 1, timeoutSec: 60 }).ok, true)

  const res = ex.execute(seal(), ON)
  assert.equal(desktop.calls, 0, 'nothing was attempted while another order held the slot')
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'another_order_is_live')
})

/* ── 2. single use ────────────────────────────────────────────────────────── */

test('*** the same approvalId cannot be used twice ***', () => {
  const { ex, desktop } = build()
  const first = ex.execute(seal(), ON)
  assert.equal(first.ok, true)
  assert.equal(desktop.calls, 3)

  // Byte-identical order, replayed.
  const second = ex.execute(seal(), ON)
  assert.equal(second.ok, false)
  assert.equal(second.refusal, 'approval_id_already_used')
  assert.equal(desktop.calls, 3, 'THE assertion: the replay performed no further action')
})

test('*** the same approvalId against DIFFERENT content is refused ***', () => {
  const { ex, desktop } = build()
  assert.equal(ex.execute(seal(), ON).ok, true)

  // Same approval, different work, correctly re-sealed so only the ledger can catch it.
  const other = seal({ orderId: 'wo_2', steps: [{ n: 1, action: 'open_app', appId: 'notepad' }], maxSteps: 1 })
  assert.notEqual(other.orderHash, seal().orderHash, 'the hashes really do differ')
  const res = ex.execute(other, ON)
  assert.equal(res.refusal, 'approval_id_already_used')
  assert.equal(desktop.calls, 3, 'no action ran under the reused approval')
})

/* ── 3. expiry ────────────────────────────────────────────────────────────── */

test('*** an expired order performs ZERO desktop actions ***', () => {
  const c = clock()
  const { ex, registry, desktop } = build({ clock: c })
  // Live, then time passes past its window, then the same id is presented.
  registry.admit({ approvalId: 'appr_one', workOrderHash: 'h', stepCount: 3, timeoutSec: 300 })
  c.advance(301 * 1000)

  const res = ex.execute(seal({ timeoutSec: 300 }), ON)
  assert.equal(desktop.calls, 0)
  assert.equal(res.ok, false)
  // Expiry retires the id, so the refusal is that it is spent — a timeout is not a retry.
  assert.equal(res.refusal, 'approval_id_already_used')
  assert.equal(registry.wasUsed('appr_one'), true)
})

/* ── 4. nonces ────────────────────────────────────────────────────────────── */

test('*** a replayed step nonce is refused ***', () => {
  const c = clock()
  const registry = createOrderRegistry({ now: c.now })
  const admitted = registry.admit({ approvalId: 'appr_x', workOrderHash: 'h', stepCount: 2, timeoutSec: 60 })
  const n0 = admitted.stepNonces[0]

  assert.equal(registry.consumeStep({ approvalId: 'appr_x', stepIndex: 0, stepNonce: n0 }).ok, true)
  assert.equal(registry.consumeStep({ approvalId: 'appr_x', stepIndex: 0, stepNonce: n0 }).reason, 'nonce_already_used')
  // and it cannot be moved to another position either
  assert.equal(registry.consumeStep({ approvalId: 'appr_x', stepIndex: 1, stepNonce: n0 }).ok, false)
})

test('*** a nonce consumed before a crash is NOT retryable ***', () => {
  // The Owner's rule: if the step-start audit landed and the process died before the action
  // began, the nonce is already spent. This simulates exactly that — burn the nonce, then
  // present the same order to a fresh executor sharing the registry, as a restart would.
  const c = clock()
  const registry = createOrderRegistry({ now: c.now })
  const order = seal({ approvalId: 'appr_crash' })
  const admitted = registry.admit({
    approvalId: order.approvalId, workOrderHash: order.orderHash, stepCount: 3, timeoutSec: 300
  })
  registry.consumeStep({ approvalId: order.approvalId, stepIndex: 0, stepNonce: admitted.stepNonces[0] })
  // ...crash here. Nothing closed the order.

  const { ex, desktop } = build({ registry, clock: c })
  const res = ex.execute(order, ON)
  assert.equal(desktop.calls, 0, 'THE assertion: the restart replays nothing')
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'another_order_is_live', 'the abandoned order still holds the slot')

  // Recovery is a NEW approval, exactly as specified — not a retry of the old one.
  registry.invalidate(order.approvalId, 'crash')
  const retried = ex.execute(order, ON)
  assert.equal(retried.refusal, 'approval_id_already_used')
  assert.equal(desktop.calls, 0)
})

/* ── 5. the two admissions, both before any action ────────────────────────── */

test('*** registry admission failure -> ZERO desktop actions AND no audit record ***', () => {
  const { ex, registry, desktop, store } = build()
  registry.admit({ approvalId: 'appr_blocker', workOrderHash: 'h', stepCount: 1, timeoutSec: 60 })

  const res = ex.execute(seal(), ON)
  assert.equal(desktop.calls, 0)
  assert.equal(res.refusal, 'another_order_is_live')
  assert.deepEqual(store.written, [], 'an order that will not be admitted generates no admission record')
})

test('*** audit admission failure -> ZERO desktop actions, and the approval is burnt ***', () => {
  const c = clock()
  const registry = createOrderRegistry({ now: c.now })
  const throwing = { write: () => { throw new Error('disk full') } }
  const desktop = fakeDesktop()
  const ex = createComputerExecutor({ artifactStore: throwing, desktop, orderRegistry: registry, now: c.now })

  const res = ex.execute(seal(), ON)
  assert.equal(desktop.calls, 0)
  assert.equal(res.refusal, 'audit_write_failed')
  assert.equal(res.phase, 'admission')
  // Admitted but unrecordable: the slot is released and the id is spent, so it cannot be
  // quietly retried under the same authorisation.
  assert.equal(registry.liveApprovalId(), null, 'the slot is not left occupied')
  assert.equal(registry.wasUsed('appr_one'), true, 'and the approval is spent')
})

test('an executor with NO registry refuses outright', () => {
  const desktop = fakeDesktop()
  const ex = createComputerExecutor({ artifactStore: fakeStore(), desktop })
  const res = ex.execute(seal(), ON)
  assert.equal(desktop.calls, 0)
  assert.equal(res.refusal, 'registry_not_configured')
})

/* ── 6. terminal states ───────────────────────────────────────────────────── */

test('*** after an abort, later steps are ZERO and the order is closed ***', () => {
  const c = clock()
  const registry = createOrderRegistry({ now: c.now })
  const desktop = fakeDesktop({ typeTextIntoControl: () => { throw new Error('boom') } })
  const store = fakeStore()
  const ex = createComputerExecutor({ artifactStore: store, desktop, orderRegistry: registry, now: c.now })

  const res = ex.execute(seal(), ON)
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'step_failed')
  assert.equal(desktop.log.filter((l) => l === 'save').length, 0, 'step 3 never ran')
  assert.equal(res.orderClosed, true)
  assert.equal(registry.liveApprovalId(), null, 'the slot is freed, not leaked')
})

test('*** cleanup does not reopen a closed order ***', () => {
  // The dangerous shape is a cleanup path that tidies up and, in doing so, leaves the order
  // admissible again. Here cleanup runs and the order stays terminally spent.
  const c = clock()
  const registry = createOrderRegistry({ now: c.now })
  let cleaned = 0
  const desktop = fakeDesktop({ cleanup: () => { cleaned++ }, saveAsViaUi: () => { throw new Error('save failed') } })
  const ex = createComputerExecutor({ artifactStore: fakeStore(), desktop, orderRegistry: registry, now: c.now })

  const res = ex.execute(seal(), ON)
  assert.equal(res.ok, false)
  assert.equal(cleaned, 1, 'cleanup did run')
  assert.equal(registry.wasUsed('appr_one'), true)
  assert.equal(registry.isLive('appr_one'), false)

  const again = ex.execute(seal(), ON)
  assert.equal(again.refusal, 'approval_id_already_used', 'cleanup did not make it runnable again')
  assert.equal(desktop.log.filter((l) => l === 'open').length, 1, 'and no second open_app happened')
})

test('a completed order closes and frees the slot', () => {
  const { ex, registry } = build()
  const res = ex.execute(seal(), ON)
  assert.equal(res.ok, true)
  assert.equal(res.orderClosed, true)
  assert.equal(registry.liveApprovalId(), null)
  // The slot is free for a DIFFERENT approval, which is the point of freeing it.
  assert.equal(registry.admit({ approvalId: 'appr_two', workOrderHash: 'h', stepCount: 1, timeoutSec: 60 }).ok, true)
})

/* ── 7. THE DESIGN DECISION: separate registries ──────────────────────────── */

test('*** dry-run and executor hold SEPARATE registries — decided, not incidental ***', () => {
  // THE DECISION, and the reasoning, because the Owner asked for it to be settled here rather
  // than left to whoever implements next.
  //
  // SEPARATE. Sharing one registry would mean a dry-run occupies the single live slot, so
  // planning an order would block executing it — a self-inflicted denial of service on the
  // only path that matters. Worse, a shared registry would let a dry-run CONSUME the real
  // order's step nonces, and the executor would then refuse its own steps as replays.
  //
  // The two registries govern DIFFERENT RESOURCES: the supervisor's governs a planning slot
  // that reaches nothing, the executor's governs THE desktop. Both being live at once is
  // therefore not a contradiction — it is two independent bookings of two different things,
  // and only one of them can cause anything to happen.
  const c = clock()
  const execRegistry = createOrderRegistry({ now: c.now })
  const sup = createComputerSupervisor({ artifactStore: fakeStore(), now: c.now })

  assert.notEqual(sup.orderRegistry, execRegistry, 'distinct instances')

  // A dry-run runs to completion and leaves the executor's slot untouched.
  assert.equal(execRegistry.liveApprovalId(), null)
  assert.equal(sup.dryRun({
    approvalId: 'appr_one',
    goal: 'plan',
    targetApp: null,
    allowedPaths: [ALLOWED_PATH],
    steps: [{ action: 'read_file', params: { path: ALLOWED_PATH + '\\x.txt' } }],
    maxSteps: 5,
    timeoutSec: 60,
    forbiddenActions: require('./computerWorkOrder').FORBIDDEN_ACTIONS.slice(),
    requiresEvidence: true
  }).ok !== undefined, true)

  assert.equal(execRegistry.liveApprovalId(), null, 'a dry-run never occupied the desktop slot')
  assert.equal(execRegistry.wasUsed('appr_one'), false, 'and never spent the approval')

  // So the real run still works under the very approvalId that was just planned.
  const { ex, desktop } = build({ registry: execRegistry, clock: c })
  const res = ex.execute(seal({ approvalId: 'appr_one' }), ON)
  assert.equal(res.ok, true, 'planning did not consume the authorisation')
  assert.equal(desktop.calls, 3)
})

test('*** the dry-run registry is NOT single-use, and the executor one IS ***', () => {
  // The asymmetry is deliberate and is the reason they cannot be the same object. Asserted
  // directly so nobody "tidies up" by giving them one shared policy.
  const planner = createOrderRegistry({ now: () => 1, singleUse: false })
  const actor = createOrderRegistry({ now: () => 1 })

  for (const r of [planner, actor]) {
    r.admit({ approvalId: 'appr_z', workOrderHash: 'h', stepCount: 1, timeoutSec: 60 })
    r.close('appr_z')
  }
  assert.equal(planner.admit({ approvalId: 'appr_z', workOrderHash: 'h', stepCount: 1, timeoutSec: 60 }).ok, true,
    'a plan can be re-run')
  assert.equal(actor.admit({ approvalId: 'appr_z', workOrderHash: 'h', stepCount: 1, timeoutSec: 60 }).reason,
    'approval_id_already_used', 'an execution cannot')

  // Fail-closed default: omitting the option gives the strict behaviour.
  assert.equal(createOrderRegistry({ now: () => 1 }).admit === undefined, false)
})

test('*** the production wiring builds exactly ONE executor registry, and it is not the supervisor\'s ***', () => {
  const { buildComputerOperator } = require('./computerOperatorWiring')
  const built = buildComputerOperator({
    env: { COMPUTER_OPERATOR: 'on' },
    artifactStore: fakeStore(),
    runner: { run: () => ({ ok: true }) }
  })
  assert.equal(built.enabled, true)
  assert.ok(built.executorRegistry, 'the executor registry is exposed so it can be asserted, not guessed at')

  const sup = createComputerSupervisor({ artifactStore: fakeStore(), now: () => 1 })
  assert.notEqual(built.executorRegistry, sup.orderRegistry)

  // Occupying the supervisor's slot must not close the desktop door.
  sup.orderRegistry.admit({ approvalId: 'appr_plan', workOrderHash: 'h', stepCount: 1, timeoutSec: 60 })
  assert.equal(built.executorRegistry.admit({ approvalId: 'appr_real', workOrderHash: 'h', stepCount: 1, timeoutSec: 60 }).ok,
    true, 'a live plan cannot block a real run')
})
