'use strict'

/**
 * companionCanaryChain.test.js — the cross-session chain, with fakes everywhere.
 *
 * No real session, no real gate, no real adapter, no Notepad. Every refusal is asserted as a
 * COUNT OF DESKTOP ACTIONS on a fake executor, because a refusal that arrives after the typing
 * is not a refusal — and this whole round exists because a chain that looked correct was about
 * to act as the wrong identity.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const R = require('./companionCanaryRunner')
const RQ = require('./executeRequest')
const { REQUIRED } = require('./identityAttestation')

/* ── fakes ────────────────────────────────────────────────────────────────── */

const OP_SID = REQUIRED.sid

const snapshot = (over = {}) => Object.assign({
  account: 'AROMABRAIN\\AromaOperator',
  sid: OP_SID,
  sessionId: 2,
  desktop: 'WinSta0\\Default',
  isElevated: false,
  isInteractive: true,
  integrityLevel: 'Medium',
  groupSids: ['S-1-5-32-545', 'S-1-1-0'],
  administratorsPresent: false,
  administratorsEnabled: false,
  collectorVersion: 1,
  collectorSha256: 'a'.repeat(64),
  processId: 4242,
  attestedAt: '2026-07-31T23:30:00.000Z'
}, over)

const goodMachine = (over = {}) => Object.assign({
  readAcl: () => ({
    ok: true,
    protected: true,
    inheritedCount: 0,
    denyCount: 0,
    aces: { [OP_SID]: 0x1201BF, 'S-1-5-32-544': 0x1F01FF, 'S-1-5-18': 0x1F01FF }
  }),
  listDir: () => [],
  fileExists: () => false,
  probeWritable: () => [{ path: R.ALLOWED_DIR, writable: true }, { path: 'C:\\Aroma', writable: false }],
  stagedClosure: () => ({ ok: true }),
  notepadCount: () => 0,
  auditWritable: () => true
}, over)

function fakeExecutor (over = {}) {
  const spy = { calls: 0, orders: [], desktopActions: 0 }
  return {
    spy,
    executor: {
      execute: (order, opts) => {
        spy.calls++
        spy.orders.push(order)
        spy.optsSeen = opts
        if (over.result) return over.result
        spy.desktopActions += 3
        return { ok: true, stepsRun: 3, desktopActions: 3 }
      }
    }
  }
}

const fakeStore = () => { const w = []; return { w, write: (t, r) => { w.push({ t, kind: r.kind }); return r } } }

const receipt = (over = {}) => Object.assign({
  approvalId: 'appr_' + 'f'.repeat(32),
  workOrderHash: 'b'.repeat(64),
  executionPackageManifestHash: 'c'.repeat(64),
  approvedOrder: { orderId: 'wo_canary_notepad_1', approvalId: 'appr_' + 'f'.repeat(32), steps: [{ n: 1, action: 'open_app', appId: 'notepad' }] }
}, over)

function chain (over = {}) {
  const rec = over.receipt || receipt()
  const req = over.request || RQ.buildRequest(rec, { now: () => Date.parse('2026-07-31T23:00:00Z') })
  const ledger = over.ledger || RQ.createRequestLedger({ now: () => Date.parse('2026-07-31T23:05:00Z') })
  if (!over.skipSubmit) ledger.submit(req)
  const fx = over.fx || fakeExecutor()
  const deps = Object.assign({
    machine: goodMachine(),
    snapshot: snapshot(),
    ledger,
    executor: fx.executor,
    artifactStore: fakeStore(),
    receipt: rec,
    receiptVerified: true,
    currentPackageHash: rec.executionPackageManifestHash,
    now: () => Date.parse('2026-07-31T23:05:00Z')
  }, over.deps)
  return { req, rec, ledger, fx, deps }
}

/* ── 1-6. identity ────────────────────────────────────────────────────────── */

test('*** 1. louis SID is refused, 0 desktop actions ***', () => {
  const c = chain({ deps: { snapshot: snapshot({ account: 'AROMABRAIN\\louis', sid: 'S-1-5-21-2042659270-2029498691-2127769412-1002' }) } })
  const res = R.runCanaryAsCompanion(c.req, c.deps)
  assert.equal(res.refusal, 'wrong_identity')
  assert.equal(c.fx.spy.calls, 0)
  assert.equal(c.fx.spy.desktopActions, 0)
})

test('*** 2. the same NAME with a different SID is refused ***', () => {
  const c = chain({ deps: { snapshot: snapshot({ sid: 'S-1-5-21-2042659270-2029498691-2127769412-1099' }) } })
  const res = R.runCanaryAsCompanion(c.req, c.deps)
  assert.equal(res.refusal, 'wrong_identity', 'the name alone never carries it')
  assert.equal(c.fx.spy.calls, 0)
})

test('*** 3. an elevated token is refused ***', () => {
  const c = chain({ deps: { snapshot: snapshot({ isElevated: true }) } })
  assert.equal(R.runCanaryAsCompanion(c.req, c.deps).refusal, 'elevated_token')
  assert.equal(c.fx.spy.calls, 0)
})

test('*** 4. Administrators in the token is refused ***', () => {
  const c = chain({ deps: { snapshot: snapshot({ groupSids: ['S-1-5-32-545', 'S-1-5-32-544'], administratorsPresent: true }) } })
  const res = R.runCanaryAsCompanion(c.req, c.deps)
  assert.equal(res.refusal, 'privileged_group')
  assert.equal(c.fx.spy.calls, 0)

  // And the narrower gate exists for the enabled case, even though the broad rule reaches this
  // account first. Asserted directly so it is not mistaken for dead code.
  const { attest } = require('./identityAttestation')
  assert.equal(attest(snapshot({ administratorsEnabled: true, administratorsPresent: true, groupSids: ['S-1-5-32-545'] })).refusal,
    'administrators_enabled')
})

test('*** 5. an incomplete measurement is refused, never scored partially ***', () => {
  for (const field of ['sid', 'sessionId', 'desktop', 'integrityLevel', 'administratorsEnabled', 'collectorVersion']) {
    const snap = snapshot(); delete snap[field]
    const c = chain({ deps: { snapshot: snap } })
    const res = R.runCanaryAsCompanion(c.req, c.deps)
    assert.equal(res.refusal, 'incomplete_attestation', field)
    assert.equal(c.fx.spy.calls, 0, field)
  }
})

test('*** 6. the wrong session or desktop is refused ***', () => {
  for (const [over, refusal] of [
    [{ sessionId: 0 }, 'bad_session'],
    [{ isInteractive: false }, 'not_interactive'],
    [{ desktop: 'WinSta0\\Winlogon' }, 'wrong_desktop'],
    [{ desktop: 'Service-0x0-3e7$\\Default' }, 'wrong_desktop']
  ]) {
    const c = chain({ deps: { snapshot: snapshot(over) } })
    assert.equal(R.runCanaryAsCompanion(c.req, c.deps).refusal, refusal, JSON.stringify(over))
    assert.equal(c.fx.spy.calls, 0)
  }
})

/* ── 7-9. the request ─────────────────────────────────────────────────────── */

test('*** 7. a replayed request is refused ***', () => {
  const c = chain()
  assert.equal(R.runCanaryAsCompanion(c.req, c.deps).ok, true)
  assert.equal(c.fx.spy.calls, 1)

  const again = R.runCanaryAsCompanion(c.req, c.deps)
  assert.equal(again.ok, false)
  assert.match(String(again.refusal), /already_/)
  assert.equal(c.fx.spy.calls, 1, 'THE assertion: the replay executed nothing')
})

test('*** 8. an expired request is refused ***', () => {
  const rec = receipt()
  const req = RQ.buildRequest(rec, { now: () => Date.parse('2026-07-31T23:00:00Z') })
  const c = chain({ receipt: rec, request: req, deps: { now: () => Date.parse('2026-07-31T23:59:00Z') } })
  const res = R.runCanaryAsCompanion(req, c.deps)
  assert.equal(res.refusal, 'request_expired')
  assert.equal(c.fx.spy.calls, 0)
})

test('*** 9. request / order / package hash mismatches are all refused ***', () => {
  const rec = receipt()
  for (const [mutate, refusal] of [
    [(r) => { r.approvedOrderHash = 'd'.repeat(64) }, 'order_hash_mismatch'],
    [(r) => { r.executionPackageManifestHash = 'e'.repeat(64) }, 'package_hash_mismatch'],
    [(r) => { r.approvalId = 'appr_' + '9'.repeat(32) }, 'approval_mismatch']
  ]) {
    const base = RQ.buildRequest(rec, { now: () => Date.parse('2026-07-31T23:00:00Z') })
    const req = Object.assign({}, base); mutate(req)
    const c = chain({ receipt: rec, request: req })
    const res = R.runCanaryAsCompanion(req, c.deps)
    assert.equal(res.refusal, refusal)
    assert.equal(c.fx.spy.calls, 0)
  }
  // and the code on disk having moved since the request was made
  const c2 = chain({ receipt: rec, deps: { currentPackageHash: 'f'.repeat(64) } })
  assert.equal(R.runCanaryAsCompanion(c2.req, c2.deps).refusal, 'package_hash_mismatch')
})

test('*** a request may carry BINDINGS ONLY — an instruction field is refused ***', () => {
  const rec = receipt()
  for (const extra of ['text', 'fileName', 'path', 'command', 'arguments', 'modulePath', 'script']) {
    const req = Object.assign({}, RQ.buildRequest(rec, { now: () => 1 }), { [extra]: 'x' })
    const v = RQ.validateRequest(req)
    assert.equal(v.refusal, 'unexpected_field', extra)
    assert.equal(v.detail, extra)
  }
  assert.deepEqual([...RQ.REQUEST_FIELDS].sort(), [
    'approvalId', 'approvedOrderHash', 'canaryType', 'canaryVersion', 'createdAt',
    'executionPackageManifestHash', 'expiresAt', 'kind', 'receiptSha256', 'requestId'
  ], 'the shape is closed and carries no instructions')
})

test('a request is frozen at birth', () => {
  const req = RQ.buildRequest(receipt(), { now: () => 1 })
  assert.equal(Object.isFrozen(req), true)
  assert.throws(() => { 'use strict'; req.approvalId = 'appr_' + '0'.repeat(32) }, TypeError)
})

/* ── 10. no Owner bypass ──────────────────────────────────────────────────── */

test('*** 10. the Owner side has no path to the executor or the adapter ***', () => {
  const owner = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'computer', 'Owner-Execute.ps1'), 'utf8')
  const code = owner.replace(/^\s*#.*$/gm, '')
  for (const banned of ['computerExecutor', 'desktopAdapter', 'uiaCanary', 'executor.execute']) {
    assert.equal(code.includes(banned), false, 'Owner-Execute must not reach: ' + banned)
  }
  // The runner is the only holder, and it never imports the adapter itself.
  const runner = fs.readFileSync(path.join(__dirname, 'companionCanaryRunner.js'), 'utf8')
  const rc = runner.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.equal(/require\([^)]*desktopAdapter/.test(rc), false, 'the runner takes an executor by injection')
  assert.equal(/require\([^)]*computerExecutor/.test(rc), false)
})

/* ── 11-13. preflight, crash, durable outcome ─────────────────────────────── */

test('*** 11. every Companion preflight failure gives 0 desktop actions ***', () => {
  const cases = [
    [{ readAcl: () => ({ ok: false, reason: 'denied' }) }, 'acl_unreadable'],
    [{ readAcl: () => ({ ok: true, protected: false, inheritedCount: 0, denyCount: 0, aces: {} }) }, 'acl_not_protected'],
    [{ readAcl: () => ({ ok: true, protected: true, inheritedCount: 2, denyCount: 0, aces: {} }) }, 'acl_inherited'],
    [{ readAcl: () => ({ ok: true, protected: true, inheritedCount: 0, denyCount: 1, aces: {} }) }, 'acl_has_deny'],
    [{ readAcl: () => ({ ok: true, protected: true, inheritedCount: 0, denyCount: 0, aces: { [OP_SID]: 0x1201BF } }) }, 'acl_ace_set_mismatch'],
    [{ readAcl: () => ({ ok: true, protected: true, inheritedCount: 0, denyCount: 0, aces: { [OP_SID]: 0x1F01FF, 'S-1-5-32-544': 0x1F01FF, 'S-1-5-18': 0x1F01FF } }) }, 'acl_mask_mismatch'],
    [{ listDir: () => ['leftover.txt'] }, 'folder_not_empty'],
    [{ fileExists: () => true }, 'file_exists'],
    [{ probeWritable: () => [{ path: 'C:\\Windows', writable: true }] }, 'writable_outside_scope'],
    [{ stagedClosure: () => ({ ok: false, reason: 'hash mismatch' }) }, 'staging_unverified'],
    [{ notepadCount: () => 1 }, 'notepad_already_open'],
    [{ auditWritable: () => false }, 'audit_not_writable']
  ]
  for (const [over, refusal] of cases) {
    const c = chain({ deps: { machine: goodMachine(over) } })
    const res = R.runCanaryAsCompanion(c.req, c.deps)
    assert.equal(res.refusal, refusal, JSON.stringify(Object.keys(over)))
    assert.equal(c.fx.spy.calls, 0, refusal)
    assert.equal(res.desktopActions, 0, refusal)
  }
})

test('*** 12. a claimed request cannot be replayed after a crash ***', () => {
  const c = chain()
  // Claim, then "crash" — nothing settles it.
  assert.equal(c.ledger.claim(c.req.requestId, OP_SID).ok, true)
  assert.equal(c.ledger.stateOf(c.req.requestId), 'claimed')

  const res = R.runCanaryAsCompanion(c.req, c.deps)
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'request_already_claimed')
  assert.equal(c.fx.spy.calls, 0, 'a restart replays nothing')
})

test('*** 13. both success and failure write a durable outcome ***', () => {
  const okChain = chain()
  R.runCanaryAsCompanion(okChain.req, okChain.deps)
  assert.equal(okChain.ledger.stateOf(okChain.req.requestId), 'completed')
  assert.ok(okChain.deps.artifactStore.w.some((r) => r.kind === 'canary-outcome'))

  const badChain = chain({ fx: fakeExecutor({ result: { ok: false, refusal: 'step_failed' } }) })
  R.runCanaryAsCompanion(badChain.req, badChain.deps)
  assert.equal(badChain.ledger.stateOf(badChain.req.requestId), 'failed', 'a failure consumes it too')

  // A preflight refusal settles it as failed as well — no request is left dangling.
  const preChain = chain({ deps: { machine: goodMachine({ notepadCount: () => 1 }) } })
  preChain.ledger.claim(preChain.req.requestId, OP_SID)
  R.runCanaryAsCompanion(preChain.req, preChain.deps)
  assert.equal(preChain.ledger.stateOf(preChain.req.requestId), 'failed')
})

/* ── 14-16. the execution itself ──────────────────────────────────────────── */

test('*** 14+15. executor.execute exactly once, with the frozen approved order ***', () => {
  const c = chain()
  const res = R.runCanaryAsCompanion(c.req, c.deps)
  assert.equal(res.ok, true)
  assert.equal(c.fx.spy.calls, 1, 'exactly once')
  const passed = c.fx.spy.orders[0]
  assert.deepEqual(passed, c.rec.approvedOrder, 'field for field, the approved order')
  assert.equal(Object.isFrozen(passed), true, 'frozen — nothing downstream can decorate it')
  assert.equal(c.fx.spy.optsSeen.flagOn, true)
})

test('*** 16. the identity attestation is audited BEFORE anything else, pass or fail ***', () => {
  // The record must exist even when the attestation refuses — a refusal nobody can inspect
  // afterwards is an opinion.
  const bad = chain({ deps: { snapshot: snapshot({ isElevated: true }) } })
  R.runCanaryAsCompanion(bad.req, bad.deps)
  const kinds = bad.deps.artifactStore.w.map((r) => r.kind)
  assert.equal(kinds[0], 'identity-attestation', 'it is the FIRST thing recorded')

  const good = chain()
  R.runCanaryAsCompanion(good.req, good.deps)
  assert.equal(good.deps.artifactStore.w[0].kind, 'identity-attestation')
})

test('an unwritable audit sink stops the run before the identity is even trusted', () => {
  const c = chain({ deps: { artifactStore: { write: () => { throw new Error('disk full') } } } })
  const res = R.runCanaryAsCompanion(c.req, c.deps)
  assert.equal(res.refusal, 'audit_not_writable')
  assert.equal(c.fx.spy.calls, 0)
})

test('the whole chain performs ZERO real desktop actions in these tests', () => {
  // The instrument for every "0 actions" claim above: a fake executor. Asserted so the counts
  // are known to come from somewhere real rather than from nothing being wired.
  const c = chain()
  assert.equal(c.fx.spy.desktopActions, 0, 'before')
  R.runCanaryAsCompanion(c.req, c.deps)
  assert.equal(c.fx.spy.desktopActions, 3, 'the fake counted a successful run — the counter works')
})
