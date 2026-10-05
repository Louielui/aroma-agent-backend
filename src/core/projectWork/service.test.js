'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { createProjectWork } = require('./service'), { createMemoryRunStore } = require('../operating/runStore'), { createOwnerApprovalStore } = require('../../agent/ownerApprovalStore')
const { PROJECT, RECIPE, FILE, TEST, TESTS } = require('./contract')
const OWNER = { id: 'owner', role: 'owner' }, HEAD = 'a'.repeat(40)
function fixture (options = {}) {
  let changed = false, codeCalls = 0, reviewCalls = 0
  const store = options.store || createMemoryRunStore(), events = []
  const source = { read: async () => ({ hash: 'b'.repeat(64), evidence: { bootCommit: HEAD, revision: HEAD }, order: { files: { [FILE]: 'source', [TEST]: TESTS }, editable: [FILE], tests: [TEST], expectedTests: 8, sourceRevision: HEAD } }), verify: async () => { if (changed) throw Error('source_changed') } }
  const providers = { isolation: async () => ({ ready: true }), status: async () => ({ codex: { ready: true }, claude: { ready: true } }),
    codeOrder: async value => { codeCalls++; await value.verify(); if (options.code) return options.code(value); return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', execution: 'windows_sandbox_offline', appliedToLive: false, changedFiles: [FILE], changes: [{ file: FILE, before: 'source', after: 'result' }], baseline: { total: 8, failed: 5 }, tests: { exitCode: 0, total: 8, passed: 8, failed: 0, skipped: 0, cancelled: 0 }, patchHash: 'c'.repeat(64) } },
    reviewOrder: async () => { reviewCalls++; if (options.review) return options.review(); return { verdict: 'pass' } } }
  const flow = createProjectWork({ source, providers, store, enabled: () => true, onEvent: event => events.push(event), ...options })
  const prepare = () => flow.prepare(OWNER, { bootCommit: HEAD, projectId: PROJECT, recipe: RECIPE, requestId: randomUUID() })
  return { flow, prepare, store, events, drift: () => { changed = true }, calls: () => [codeCalls, reviewCalls] }
}
test('current-source work order needs a bound single-use approval and returns one terminal result', async () => {
  const f = fixture(), p = await f.prepare(); assert.equal(p.run.state, 'awaiting_approval'); assert.deepEqual(f.calls(), [0, 0])
  f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }); await f.flow.settled()
  const r = f.flow.get(OWNER, p.run.id); assert.equal(r.state, 'completed'); assert.equal(r.appliedToLive, false)
  assert.equal(r.steps.filter(s => s.stage === 'completed').length, 1); assert.deepEqual(f.calls(), [1, 1])
  assert.throws(() => f.flow.approve(OWNER, p.approval), /invalid_request/)
  assert.throws(() => f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }), /approval_unavailable/)
})
test('source drift consumes approval but dispatches neither model', async () => {
  const f = fixture(), p = await f.prepare(); f.drift(); f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }); await f.flow.settled()
  assert.equal(f.flow.get(OWNER, p.run.id).reason, 'source_changed'); assert.deepEqual(f.calls(), [0, 0])
})

test('empty coding result remains a concrete terminal reason without review or repeated dispatch', async () => {
  const f = fixture({ code: async () => { throw Error('worker_no_changes') } }), p = await f.prepare()
  f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }); await f.flow.settled()
  assert.equal(f.flow.get(OWNER, p.run.id).reason, 'worker_no_changes')
  assert.equal(f.flow.get(OWNER, p.run.id).state, 'failed')
  assert.deepEqual(f.calls(), [1, 0])
})
test('incorrect displayed hash cannot later replay the nonce', async () => {
  const f = fixture(), p = await f.prepare(), args = { id: p.approval.id, hash: '0'.repeat(64), nonce: p.approval.nonce }
  assert.throws(() => f.flow.approve(OWNER, args), /approval_unavailable/); args.hash = p.approval.hash
  assert.throws(() => f.flow.approve(OWNER, args), /approval_unavailable/); assert.deepEqual(f.calls(), [0, 0])
})
test('expired approval and restart invalidate execution without auto-resume', async () => {
  let now = 0; const store = createMemoryRunStore(), f = fixture({ store, approvals: createOwnerApprovalStore({ now: () => now }) }), p = await f.prepare()
  now = 600001; assert.throws(() => f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }), /approval_unavailable/)
  const next = fixture({ store }); assert.equal(next.flow.get(OWNER, p.run.id).state, 'interrupted'); assert.deepEqual(next.calls(), [0, 0])
})
test('unknown project, paths, commands and non-Owner requests cannot reach source or execution', async () => {
  const f = fixture(), input = { bootCommit: HEAD, projectId: PROJECT, recipe: RECIPE, requestId: randomUUID() }
  for (const patch of [{ projectId: 'aroma-system' }, { path: '.env' }, { command: 'node anything' }, { model: 'other' }]) await assert.rejects(f.flow.prepare(OWNER, { ...input, ...patch }), /invalid_request/)
  await assert.rejects(f.flow.prepare({ id: 'ivy', role: 'manager' }, input), /permission_denied/); assert.deepEqual(f.calls(), [0, 0])
})
test('same request is idempotent and cannot issue a replacement nonce', async () => {
  const f = fixture(), input = { bootCommit: HEAD, projectId: PROJECT, recipe: RECIPE, requestId: randomUUID() }
  const a = await f.flow.prepare(OWNER, input), b = await f.flow.prepare(OWNER, input); assert.equal(a.run.id, b.run.id); assert.equal(b.approval, null)
  await assert.rejects(f.flow.prepare(OWNER, { ...input, bootCommit: 'b'.repeat(40) }), /request_conflict/)
})
test('cancellation stops the owned job and cannot trigger review or repeat execution', async () => {
  let entered; const started = new Promise(resolve => { entered = resolve })
  const f = fixture({ code: ({ signal }) => new Promise((resolve, reject) => { entered(); signal.addEventListener('abort', () => reject(Error('worker_cancelled')), { once: true }) }) })
  const p = await f.prepare(); f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }); await started
  assert.throws(() => f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }), /worker_busy/)
  f.flow.cancel(OWNER, p.run.id); await f.flow.settled(); assert.equal(f.flow.get(OWNER, p.run.id).state, 'cancelled'); assert.deepEqual(f.calls(), [1, 0])
})
test('invalid candidate cannot proceed to review or be marked completed', async () => {
  const f = fixture({ code: async () => ({ appliedToLive: true }) }), p = await f.prepare()
  f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }); await f.flow.settled()
  assert.equal(f.flow.get(OWNER, p.run.id).reason, 'invalid_worker_result'); assert.deepEqual(f.calls(), [1, 0])
})
test('failed audit persistence prevents all model dispatch', async () => {
  const store = createMemoryRunStore(), original = store.save; let fail = false
  store.save = row => { if (fail) throw Error('disk_unavailable'); return original(row) }
  const f = fixture({ store }), p = await f.prepare(); fail = true
  assert.throws(() => f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }), /disk_unavailable/)
  assert.deepEqual(f.calls(), [0, 0]); fail = false
  assert.throws(() => f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }), /approval_unavailable/)
})

test('formal review failure retains safe diagnostics and cannot approve adoption or repeat work', async () => {
  const f = fixture({ review: () => { const error = Error('claude_max_turns'); error.safeDiagnostics = { exitCode: 1, parsedJson: true, subtype: 'error_max_turns', stdoutBytes: 45, stderrBytes: 0, raw: 'secret' }; throw error } }), p = await f.prepare()
  f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }); await f.flow.settled()
  const r = f.flow.get(OWNER, p.run.id)
  assert.equal(r.state, 'failed'); assert.equal(r.reason, 'claude_max_turns'); assert.equal(r.result.tests.passed, 8); assert.equal(r.review, undefined)
  assert.equal(r.appliedToLive, false); assert.deepEqual(f.calls(), [1, 1]); assert.equal(r.steps.filter(x => x.stage === 'failed').length, 1)
  assert.equal(r.failureDiagnostic.subtype, 'error_max_turns'); assert.equal(JSON.stringify(r.failureDiagnostic).includes('secret'), false)
  assert.throws(() => f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }), /approval_unavailable/)
})

test('structured response exhaustion has a distinct safe terminal reason', async () => {
  const f = fixture({ review: () => { const error = Error('claude_invalid_structured_output'); error.safeDiagnostics = { exitCode: 1, parsedJson: true, subtype: 'error_max_structured_output_retries', stdoutBytes: 12, stderrBytes: 0 }; throw error } }), p = await f.prepare()
  f.flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }); await f.flow.settled()
  const r = f.flow.get(OWNER, p.run.id); assert.equal(r.reason, 'claude_invalid_structured_output'); assert.equal(r.failureDiagnostic.subtype, 'error_max_structured_output_retries'); assert.equal(r.state, 'failed'); assert.equal(r.appliedToLive, false); assert.deepEqual(f.calls(), [1, 1])
})
