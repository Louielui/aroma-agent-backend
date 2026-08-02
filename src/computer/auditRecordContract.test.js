'use strict'

/**
 * auditRecordContract.test.js — every audit record, against the REAL store.
 *
 * ── WHAT HAPPENED ──────────────────────────────────────────────────────────
 * The Companion started, claimed a request, passed identity, machine, approval and package —
 * and died on:
 *
 *     IT DID NOT RUN.
 *     The identity check could not be recorded. Nothing will run.
 *
 * That reads as a disk or permission failure. It was neither. artifactStore.write() requires
 * `id` and `createdAt` and throws TypeError without them, BEFORE touching the filesystem, and
 * not one audit record on the Companion path carried either field. It failed identically on any
 * machine, as any user, with any ACL — including in a wide-open temp directory.
 *
 * All SEVEN record shapes failed, not just the one that surfaced. The next would have been the
 * executor's `admission` write, with the operator flag already on.
 *
 * ── WHY NOTHING CAUGHT IT ──────────────────────────────────────────────────
 * The tests used a fake store:
 *
 *     write: (t, r) => { w.push({ t, kind: r.kind }); return r }
 *
 * It accepted anything. So "the run was recorded" meant "write() was called", never "the record
 * was acceptable". The fake and the real store disagreed about the contract, and only the fake
 * was ever consulted.
 *
 * The fake is gone. artifactStore is pure filesystem, so the tests use it directly over a temp
 * directory — a stricter fake would have been another hand-maintained copy of the contract, and
 * hand-maintained copies agree with their author and with nothing else.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createArtifactStore } = require('../store/artifactStore')
const { createComputerExecutor } = require('./computerExecutor')
const { createOrderRegistry } = require('./orderRegistry')
const { runCanaryAsCompanion } = require('./companionCanaryRunner')
const { toAuditRecord, REQUIRED } = require('./identityAttestation')
const RQ = require('./executeRequestStore')
const R = require('./companionCanaryRunner')

const { computeOrderHash } = require('./sealedOrderGate')

/**
 * A real sealed order, built the way computerExecutor.test.js builds one.
 *
 * It has to be REAL: the executor refuses a malformed order before the admission audit, so a
 * throwaway fixture never reaches the code this file is about.
 */
const SEALED_TEXT = 'Aroma Computer Operator canary. Approved by Louie. Do not edit.'
function sealedOrder (approvalId) {
  const o = {
    orderId: 'wo_audit_contract',
    approvalId,
    sealed: true,
    sealedText: SEALED_TEXT,
    allowedPath: R.ALLOWED_DIR,
    maxSteps: 3,
    timeoutSec: 300,
    steps: [{ n: 1, action: 'open_app', appId: 'notepad' }]
  }
    // allowedPath bounds a SAVE. An order without one must not carry it (verifySeal refuses
    // it as unexpected_field), so overrides that drop the save drop the path with it.
    if (!o.steps.some((s) => s && s.action === 'save')) delete o.allowedPath
  o.orderHash = computeOrderHash(o)
  return o
}

const tmpStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-auditc-'))
  return { dir, store: createArtifactStore({ baseDir: dir }) }
}

/* ── the seven record shapes ──────────────────────────────────────────────── */

test('*** all SEVEN audit record shapes write successfully to the REAL store ***', () => {
  const { dir, store } = tmpStore()
  const at = '2026-08-01T14:00:00.000Z'

  // Exactly the shapes the two helpers now build, including the two fields that were missing.
  const shapes = {
    'identity-attestation': Object.assign({ kind: 'identity-attestation', id: 'ccr_001_req_x', createdAt: at },
      toAuditRecord({ account: REQUIRED.account, sid: REQUIRED.sid, sessionId: 4 }, { ok: true })),
    'canary-outcome': { kind: 'canary-outcome', id: 'ccr_002_req_x', createdAt: at, requestId: 'req_x', ok: true },
    admission: { kind: 'admission', id: 'cexec_a1', createdAt: at, at, runId: 'cexec_a1' },
    'step-start': { kind: 'step-start', id: 'cexec_a2', createdAt: at, at, runId: 'cexec_a1', n: 1 },
    'step-outcome': { kind: 'step-outcome', id: 'cexec_a3', createdAt: at, at, runId: 'cexec_a1', n: 1, outcome: 'ok' },
    completed: { kind: 'completed', id: 'cexec_a4', createdAt: at, at, runId: 'cexec_a1', stepsRun: 3 },
    aborted: { kind: 'aborted', id: 'cexec_a5', createdAt: at, at, runId: 'cexec_a1', reason: 'x' }
  }

  const failures = []
  for (const [name, rec] of Object.entries(shapes)) {
    try { store.write('computer-audit', rec) } catch (e) { failures.push(name + ': ' + e.message) }
  }
  assert.deepEqual(failures, [], 'these record shapes cannot be written')

  // And they are really on disk, as files, readable back.
  const back = store.list('computer-audit')
  assert.equal(back.length, 7, 'seven records on disk')
  assert.deepEqual(back.map((r) => r.kind).sort(), Object.keys(shapes).sort())
  assert.equal(fs.readdirSync(path.join(dir, 'computer-audit')).length, 7)
})

test('*** POSITIVE CONTROL — the pre-fix shapes still fail ***', () => {
  // Without this, the test above could pass because the store stopped checking.
  const { store } = tmpStore()
  const at = '2026-08-01T14:00:00.000Z'
  const before = {
    'identity-attestation (as shipped)': Object.assign({ kind: 'identity-attestation' },
      toAuditRecord({ account: 'x', sid: 'y' }, { ok: true })),
    'admission (as shipped)': { kind: 'admission', at, runId: 'cexec_a1' }
  }
  for (const [name, rec] of Object.entries(before)) {
    assert.throws(() => store.write('computer-audit', rec), /record\.id is required/, name)
  }
  // createdAt alone is not enough either.
  assert.throws(() => store.write('computer-audit', { kind: 'k', id: 'i' }), /record\.createdAt is required/)
})

/* ── the helpers themselves, driven for real ──────────────────────────────── */

test('*** the runner writes a real, readable identity attestation ***', () => {
  const { store } = tmpStore()
  const snapshot = {
    account: REQUIRED.account,
    sid: REQUIRED.sid,
    sessionId: 4,
    desktop: REQUIRED.desktop,
    isElevated: false,
    isInteractive: true,
    integrityLevel: 'Medium',
    groupSids: ['S-1-5-32-545'],
    administratorsPresent: false,
    administratorsEnabled: false,
    collectorVersion: 1,
    collectorSha256: 'a'.repeat(64),
    processId: 10,
    attestedAt: '2026-08-01T13:59:00.000Z'
  }
  // A deliberately BROKEN chain after the attestation, so this test is only about the record.
  const res = runCanaryAsCompanion({ requestId: 'req_' + 'a'.repeat(24) }, {
    snapshot,
    artifactStore: store,
    machine: null,
    ledger: { stateOf: () => null, transition: () => ({ ok: true }) },
    now: () => Date.parse('2026-08-01T14:00:00Z')
  })
  assert.notEqual(res.refusal, 'audit_not_writable',
    'the attestation must be recordable — this was the failure on the operator machine')

  const written = store.list('computer-audit')
  assert.equal(written.length, 1, 'exactly one record so far')
  const rec = written[0]
  assert.equal(rec.kind, 'identity-attestation')
  assert.match(rec.id, /^ccr_\d{3}_req_a+$/, 'the id groups records by request')
  assert.equal(rec.createdAt, '2026-08-01T14:00:00.000Z', 'and uses the injected clock, not wall time')
  assert.equal(rec.account, REQUIRED.account, 'the measured identity is in the record')
})

test('*** the executor writes a real, readable admission record ***', () => {
  const { store } = tmpStore()
  const executor = createComputerExecutor({
    artifactStore: store,
    desktop: { capabilities: { touchesDesktop: true }, openApp: () => ({ ok: false, refusal: 'stopped_here' }) },
    orderRegistry: createOrderRegistry({ now: () => 1 }),
    now: () => Date.parse('2026-08-01T14:00:00Z')
  })
  // A REAL sealed order. The first version of this test passed `{ steps: [] }`, which the
  // executor refuses as malformed BEFORE the admission audit — so it recorded nothing and the
  // test failed for a reason that had nothing to do with audit records. A fixture that does not
  // reach the code under test proves nothing about it.
  executor.execute(sealedOrder('appr_' + 'f'.repeat(32)), { flagOn: true })

  const written = store.list('computer-audit')
  assert.ok(written.length >= 1, 'something was recorded')
  for (const r of written) {
    assert.ok(typeof r.id === 'string' && r.id.length > 0, r.kind + ' has an id')
    assert.ok(typeof r.createdAt === 'string' && r.createdAt.length > 0, r.kind + ' has a createdAt')
    assert.equal(r.createdAt, '2026-08-01T14:00:00.000Z', r.kind + ' uses the injected clock')
  }
})

test('*** ids are unique — two records never collide on a filename ***', () => {
  // The filename is <createdAt>-<id>.json. With a fixed clock, a repeated id would silently
  // overwrite the earlier record, and an audit trail that can lose an entry is not one.
  const { dir, store } = tmpStore()
  const executor = createComputerExecutor({
    artifactStore: store,
    desktop: { capabilities: { touchesDesktop: true }, openApp: () => ({ ok: false, refusal: 'stopped_here' }) },
    orderRegistry: createOrderRegistry({ now: () => 1 }),
    now: () => Date.parse('2026-08-01T14:00:00Z') // FIXED clock: only the id separates them
  })
  executor.execute(sealedOrder('appr_' + 'e'.repeat(32)), { flagOn: true })
  const files = fs.readdirSync(path.join(dir, 'computer-audit'))
  assert.ok(files.length >= 2, 'more than one record, or there is no collision to test: ' + files.length)
  const records = store.list('computer-audit')
  assert.equal(files.length, records.length, 'no record was overwritten by another')
  assert.equal(new Set(records.map((r) => r.id)).size, records.length, 'every id is distinct')
})

/* ── no fake stores left on this path ─────────────────────────────────────── */

test('*** the Companion test path uses the real store, not a stand-in ***', () => {
  // The fake accepted records the real store rejects. Asserted structurally so it cannot come
  // back as a "stricter fake", which would be the same hand-maintained copy one revision later.
  for (const f of ['companionCanaryChain.test.js', 'companionProductionFactory.test.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
    assert.match(src, /createArtifactStore/, f + ' builds a real store')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    assert.doesNotMatch(code, /write:\s*\(\s*t\s*,\s*r\s*\)\s*=>\s*\{[^}]*push/,
      f + ' must not push into an array instead of writing')
  }
})
