'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { createAdoption, validateAccepted } = require('./adoption'), { createMemoryRunStore } = require('../operating/runStore'), { createOwnerApprovalStore } = require('../../agent/ownerApprovalStore')
const { digest } = require('../../workers/execution/windowsSandbox'), { FILE, TEST, TESTS, WORK_ORDER } = require('./contract')
const OWNER = { id: 'owner', role: 'owner' }, HEAD = 'a'.repeat(40), COMMIT = 'b'.repeat(40)
const evidence = (passed = 8) => ({ total: 8, passed, failed: 8 - passed, skipped: 0, cancelled: 0, exitCode: passed === 8 ? 0 : 1, engine: 'windows-sandbox-offline-v1', boundary: Object.fromEntries(['noExternalInterfaces', 'hostReadDenied', 'hostWriteDenied', 'readonlyInputDenied', 'readonlyToolsDenied', 'loopbackDenied', 'ipv6LoopbackDenied', 'internetDenied', 'cleanIdentity', 'secretsAbsent'].map(k => [k, true])) })
function fixture (options = {}) {
  const changes = [{ file: FILE, before: 'original', after: 'candidate', beforeHash: digest('original'), afterHash: digest('candidate') }]
  const receipt = { id: randomUUID(), state: 'accepted_isolated', changes, patchHash: digest(JSON.stringify(changes)), tests: evidence(), workOrder: { files: { [FILE]: 'original', [TEST]: TESTS }, sourceRevision: HEAD } }
  const work = { id: randomUUID(), state: 'completed', workOrder: WORK_ORDER, appliedToLive: false, source: { evidence: { revision: HEAD, sourceFiles: [{ path: FILE, sha256: digest('original') }], acceptanceFiles: [{ path: TEST, sha256: digest(TESTS) }] } }, review: { verdict: 'pass', billing: 'claude-subscription' }, result: { changes, isolatedRunId: receipt.id, patchHash: receipt.patchHash, tests: evidence(), model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', appliedToLive: false } }
  let current = 'original', version = HEAD, loaded = false, changed = false, tests = 0, writes = 0, reloads = 0
  const store = options.store || createMemoryRunStore(), events = []
  const source = { read: async boot => { if (boot !== version) throw Error('source_changed'); return { hash: digest(current), evidence: { revision: version, bootCommit: version }, order: { files: { [FILE]: current, [TEST]: TESTS } } } }, verify: async snapshot => { if (changed || snapshot.evidence.revision !== version || snapshot.order.files[FILE] !== current) throw Error('source_changed') } }
  const repository = { apply: async ({ before, after }) => { writes++; assert.equal(current, before); current = after; version = COMMIT; return { commit: COMMIT, afterHash: digest(after) } }, verifyLoaded: async r => { if (!loaded || version !== r.commit || current !== r.after) throw Error('source_changed'); return { bootCommit: r.commit } } }
  const executor = { isBusy: () => false, run: async pack => { tests++; return options.testRun ? options.testRun(pack) : evidence(pack.files[FILE] === 'candidate' ? 8 : 3) } }
  const flow = createAdoption({ source, repository, executor, work: { get: () => structuredClone(work) }, isolated: async () => structuredClone(receipt), store, loader: async () => { reloads++; if (options.reloadFails) throw Error('administrator_reload_required') }, enabled: () => true, onEvent: e => events.push(e), ...options })
  const prepare = (action = 'adopt', requestId = randomUUID()) => flow.prepare(OWNER, { action, runId: work.id, requestId, bootCommit: version })
  const approve = p => flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce })
  return { flow, store, work, receipt, prepare, approve, events, loaded: () => { loaded = true }, drift: () => { changed = true }, calls: () => ({ tests, writes, reloads }) }
}
test('approved adoption tests once, preserves original evidence and completes only on verified boot', async () => {
  const f = fixture(), original = JSON.stringify(f.work), p = await f.prepare(); assert.deepEqual(f.calls(), { tests: 0, writes: 0, reloads: 0 })
  f.approve(p); await f.flow.settled(); assert.equal(f.flow.get(OWNER, p.run.id).state, 'awaiting_restart'); await f.flow.refresh(); assert.equal(f.flow.get(OWNER, p.run.id).state, 'awaiting_restart')
  f.loaded(); await Promise.all([f.flow.refresh(), f.flow.refresh()]); const r = f.flow.get(OWNER, p.run.id)
  assert.equal(r.state, 'completed'); assert.equal(r.loaded.bootCommit, COMMIT); assert.equal(r.steps.filter(s => s.stage === 'completed').length, 1)
  assert.deepEqual(f.calls(), { tests: 1, writes: 1, reloads: 1 }); assert.equal(JSON.stringify(f.work), original)
  assert.throws(() => f.approve(p), /approval_unavailable/)
})
test('adoption refuses tampered source, tests, review and independent receipts', async () => {
  const mutations = [f => { f.work.review.verdict = 'fail' }, f => { f.work.result.patchHash = '0'.repeat(64) }, f => { f.work.source.evidence.sourceFiles = [] }, f => { f.receipt.workOrder.files[TEST] = 'weaker' }, f => { f.receipt.workOrder.sourceRevision = COMMIT }, f => { f.work.result.tests.boundary.hostWriteDenied = false }, f => { f.work.result.changes[0].file = '.env' }, f => { f.receipt.workOrder = null }]
  for (const mutate of mutations) { const f = fixture(); mutate(f); await assert.rejects(f.prepare(), /accepted_evidence_changed/); assert.equal(f.calls().writes, 0) }
  for (const value of [null, {}, { source: {} }]) assert.throws(() => validateAccepted(value, {}), /accepted_evidence_changed/)
})
test('drift before testing or after testing never writes', async () => {
  const before = fixture(), p = await before.prepare(); before.drift(); before.approve(p); await before.flow.settled(); assert.equal(before.calls().tests, 0); assert.equal(before.calls().writes, 0)
  let after; after = fixture({ testRun: async () => { after.drift(); return evidence() } }); const q = await after.prepare(); after.approve(q); await after.flow.settled(); assert.equal(after.calls().tests, 1); assert.equal(after.calls().writes, 0)
})
test('failed tests and failed boundary stop before commit', async () => {
  for (const result of [evidence(7), { ...evidence(), boundary: {} }, { ...evidence(), skipped: 1 }]) { const f = fixture({ testRun: async () => result }), p = await f.prepare(); f.approve(p); await f.flow.settled(); assert.equal(f.flow.get(OWNER, p.run.id).reason, 'acceptance_failed'); assert.equal(f.calls().writes, 0) }
})
test('evidence change after approval stops before testing', async () => {
  const f = fixture(), p = await f.prepare(); f.work.review.summary = 'modified'; f.approve(p); await f.flow.settled(); assert.equal(f.flow.get(OWNER, p.run.id).reason, 'accepted_evidence_changed'); assert.equal(f.calls().tests, 0)
})
test('record tampering and incorrect displayed approval consume nonce without commit', async () => {
  for (const tamper of [false, true]) { const f = fixture(), p = await f.prepare(); if (tamper) { const r = f.store.get(p.run.id); r.after = 'other'; f.store.save(r) }
    assert.throws(() => f.flow.approve(OWNER, { id: p.run.id, hash: tamper ? p.approval.hash : '0'.repeat(64), nonce: p.approval.nonce }), /approval_unavailable/)
    assert.throws(() => f.approve(p), /approval_unavailable/); assert.equal(f.calls().writes, 0) }
})
test('expiry, cancellation and process restart never resume writes', async () => {
  let now = 0; const f = fixture({ approvals: createOwnerApprovalStore({ now: () => now }) }), p = await f.prepare(); now = 600001; assert.throws(() => f.approve(p), /approval_unavailable/)
  const next = fixture({ store: f.store }); assert.equal(next.flow.get(OWNER, p.run.id).state, 'interrupted'); assert.equal(next.calls().writes, 0)
  const other = fixture(), q = await other.prepare(); other.flow.cancel(OWNER, q.run.id); assert.throws(() => other.approve(q), /approval_unavailable/)
})
test('audit persistence failure before write authorization stops application', async () => {
  const store = createMemoryRunStore(), save = store.save; store.save = r => { if (r.steps.at(-1).stage === 'write_authorized') throw Error('disk'); return save(r) }
  const f = fixture({ store }), p = await f.prepare(); f.approve(p); await f.flow.settled(); assert.equal(f.calls().writes, 0)
})
test('pending reload blocks another approval; reload retry cannot repeat application', async () => {
  const f = fixture({ reloadFails: true }), p = await f.prepare(), q = await f.prepare(); f.approve(p); await f.flow.settled()
  assert.throws(() => f.approve(q), /reload_pending/); await assert.rejects(f.prepare(), /reload_pending/)
  f.flow.reload(OWNER, p.run.id); await f.flow.settled(); assert.deepEqual(f.calls(), { tests: 1, writes: 1, reloads: 2 }); assert.equal(f.flow.get(OWNER, p.run.id).state, 'awaiting_restart')
})
test('rollback needs independent approval, restores original behavior and requires reload', async () => {
  const f = fixture(); await assert.rejects(f.prepare('rollback'), /source_changed/); const p = await f.prepare(); f.approve(p); await f.flow.settled(); f.loaded(); await f.flow.refresh()
  const rollback = await f.prepare('rollback'); assert.equal(rollback.run.before, 'candidate'); assert.equal(rollback.run.after, 'original'); f.approve(rollback); await f.flow.settled(); await f.flow.refresh()
  const r = f.flow.get(OWNER, rollback.run.id); assert.equal(r.state, 'completed'); assert.equal(r.appliedToLive, false); assert.deepEqual([r.tests.passed, r.tests.failed], [3, 5]); assert.equal(f.calls().writes, 2)
})
test('Owner and exact shapes only; idempotency never reissues approval', async () => {
  const f = fixture(), input = { action: 'adopt', bootCommit: HEAD, requestId: randomUUID(), runId: f.work.id }
  await assert.rejects(f.flow.prepare({ id: 'ivy', role: 'manager' }, input), /permission_denied/)
  for (const extra of [{ path: '.env' }, { model: 'other' }, { command: 'anything' }]) await assert.rejects(f.flow.prepare(OWNER, { ...input, ...extra }), /invalid_request/)
  const a = await f.flow.prepare(OWNER, input), b = await f.flow.prepare(OWNER, input); assert.equal(b.run.id, a.run.id); assert.equal(b.approval, null)
})
