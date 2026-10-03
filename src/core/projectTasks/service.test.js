'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { createTasks } = require('./service'), { createRegistry, FILES, TEST, draft, definition } = require('./contract')
const { createMemoryRunStore } = require('../operating/runStore'), { createOwnerApprovalStore } = require('../../agent/ownerApprovalStore')
const OWNER = { id: 'owner', role: 'owner' }, HEAD = 'a'.repeat(40)
const generated = { testCode: "const test=require('node:test'),assert=require('node:assert/strict');test('first',()=>assert.equal(1,1));test('second',()=>assert.equal(2,2));test('third',()=>assert.equal(3,3));", expectedTests: 3 }
function fixture (opts = {}) {
  const store = opts.store || createMemoryRunStore(), calls = []; let drift = false
  const sourceFor = d => ({ read: async () => { calls.push('read'); return { evidence: { bootCommit: HEAD, recipe: d.workOrder.recipe }, hash: 'b'.repeat(64), order: { files: { [FILES[0]]: 'original1', [FILES[1]]: 'original2', ...d.tests } } } }, verify: async () => { calls.push('verify'); if (drift) throw Error('source_changed') } })
  const service = createTasks({ store, sourceFor, provider: { preflight: async () => { calls.push('preflight'); return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' } }, complete: async () => { calls.push('draft'); return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify(generated) } } },
    review: async () => { calls.push('review'); return { verdict: 'pass', billing: 'claude-subscription' } }, enabled: () => true,
    prepareWork: async i => { calls.push('prepare'); return { run: { id: randomUUID(), workOrder: createRegistry(store).resolve(i.recipe).workOrder }, approval: { id: randomUUID() } } }, ...opts })
  const input = { bootCommit: HEAD, requestId: randomUUID(), goal: 'Support a new criterion', criteria: ['New behavior', 'Preserve existing behavior'], editable: [FILES[1]] }
  return { service, store, calls, input, sourceFor, drift: () => { drift = true }, async ready () { const { run } = service.start(OWNER, input); await service.settled(); return service.get(OWNER, run.id) } }
}
test('new task draft is not executable; registration, coding preparation and adoption have distinct authority', async () => {
  const f = fixture(), v = await f.ready(), registry = createRegistry(f.store)
  assert.equal(v.run.state, 'awaiting_approval'); assert.equal(f.calls.includes('prepare'), false)
  assert.deepEqual(v.run.registration.workOrder.readonlyFiles, [FILES[0]])
  assert.throws(() => registry.resolve(v.run.registration.workOrder.recipe), /invalid_request/)
  const r = await f.service.approve(OWNER, { id: v.run.id, hash: v.approval.hash, nonce: v.approval.nonce })
  assert.equal(r.run.state, 'registered'); assert.equal(r.run.workRunId, null)
  assert.deepEqual(registry.resolve(r.run.registration.workOrder.recipe).tests, { [TEST]: generated.testCode })
  assert.equal(f.service.list(OWNER).runs.some(r => Object.hasOwn(r, 'nonce')), false)
  const req = { id: r.run.id, requestId: randomUUID() }, w = await f.service.prepare(OWNER, req)
  assert.ok(w.work.approval); assert.equal((await f.service.prepare(OWNER, req)).work.approval, null); assert.equal(f.calls.filter(c => c === 'prepare').length, 1)
  await assert.rejects(f.service.approve(OWNER, { id: v.run.id, hash: v.approval.hash, nonce: v.approval.nonce }), /approval_unavailable/)
})
test('approved task definition, tests, source and audit cannot silently change', async () => {
  const f = fixture(), v = await f.ready(); await f.service.approve(OWNER, { id: v.run.id, hash: v.approval.hash, nonce: v.approval.nonce })
  for (const mutate of [r => { r.generated.testCode += '//changed' }, r => { r.input.editable.push('.env') }, r => { r.registration.workOrder.expectedTests++ }, r => { r.snapshot.hash = 'x' }, r => { r.steps = [] }]) {
    const original = f.store.get(v.run.id), changed = structuredClone(original); mutate(changed); f.store.save(changed)
    assert.throws(() => createRegistry(f.store).resolve(original.registration.workOrder.recipe), /invalid_request/); f.store.save(original)
  }
})
test('exact input denies caller project roots, extra authority, traversal, duplicate paths and non-Owner', () => {
  for (const mutate of [i => { i.root = 'production' }, i => { i.editable = ['.env'] }, i => { i.editable = ['../production'] }, i => { i.editable = [FILES[0], FILES[0]] }, i => { i.criteria = [] }, i => { i.model = 'other' }]) { const f = fixture(); mutate(f.input); assert.throws(() => f.service.start(OWNER, f.input), /invalid_request/); assert.deepEqual(f.calls, []) }
  const f = fixture(); assert.throws(() => f.service.start({ id: 'ivy', role: 'manager' }, f.input), /permission_denied/)
  assert.throws(() => draft({ ...generated, commands: [] }), /invalid_worker_result/)
  assert.throws(() => draft({ ...generated, testCode: 'throw;' }), /invalid_worker_result/)
})
test('source drift blocks registration and prevents coding preparation', async () => {
  const f = fixture(), v = await f.ready(); f.drift()
  await assert.rejects(f.service.approve(OWNER, { id: v.run.id, hash: v.approval.hash, nonce: v.approval.nonce }), /source_changed/)
  await assert.rejects(f.service.prepare(OWNER, { id: v.run.id, requestId: randomUUID() }), /invalid_request/)
  assert.equal(f.calls.includes('prepare'), false)
})
test('expiry, cancellation, restart and duplicate requests do not reissue authorization', async () => {
  let now = 0; const f = fixture({ approvals: createOwnerApprovalStore({ now: () => now }) }), v = await f.ready()
  assert.equal(f.service.start(OWNER, f.input).approval, null); assert.equal(f.service.start(OWNER, f.input).run.id, v.run.id)
  assert.throws(() => f.service.start(OWNER, { ...f.input, goal: 'changed' }), /request_conflict/)
  now = 9000000; await assert.rejects(f.service.approve(OWNER, { id: v.run.id, hash: v.approval.hash, nonce: v.approval.nonce }), /approval_unavailable/)
  const second = fixture(), s = await second.ready(); second.service.cancel(OWNER, s.run.id); assert.equal(second.service.get(OWNER, s.run.id).approval, null)
  const third = fixture(), t = await third.ready(); const reboot = fixture({ store: third.store }); assert.equal(reboot.service.get(OWNER, t.run.id).run.state, 'interrupted'); assert.equal(reboot.service.get(OWNER, t.run.id).approval, null)
})
test('approved registration persists across restart but never resumes a coding request', async () => {
  const f = fixture(), v = await f.ready(); await f.service.approve(OWNER, { id: v.run.id, hash: v.approval.hash, nonce: v.approval.nonce })
  const reboot = fixture({ store: f.store }); assert.equal(reboot.service.get(OWNER, v.run.id).run.state, 'registered'); assert.ok(createRegistry(f.store).resolve(v.run.registration.workOrder.recipe)); assert.deepEqual(reboot.calls, [])
})
test('failed persistence before dispatch prevents both models; review refusal grants no approval', async () => {
  const store = createMemoryRunStore(); store.save = () => { throw Error('run_store_unavailable') }; const f = fixture({ store }); assert.throws(() => f.service.start(OWNER, f.input), /run_store_unavailable/); assert.deepEqual(f.calls, [])
  const g = fixture({ review: async () => ({ verdict: 'changes_requested', billing: 'claude-subscription' }) }), v = await g.ready(); assert.equal(v.run.state, 'needs_attention'); assert.equal(v.approval, null)
})
test('uncertain coding preparation records intent before issuing authority and is never replayed', async () => {
  let calls = 0; const f = fixture({ prepareWork: async () => { calls++; throw Error('uncertain') } }), v = await f.ready(); await f.service.approve(OWNER, { id: v.run.id, hash: v.approval.hash, nonce: v.approval.nonce })
  const input = { id: v.run.id, requestId: randomUUID() }; await assert.rejects(f.service.prepare(OWNER, input), /uncertain/); await assert.rejects(f.service.prepare(OWNER, input), /request_conflict/); assert.equal(calls, 1)
})
test('timeout and cancellation do not free the provider lane before inflight work settles', async () => {
  for (const timeout of [false, true]) {
    let release, started; const barrier = new Promise(r => { started = r })
    const f = fixture({ timeoutMs: timeout ? 20 : 5000, provider: { preflight: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }), complete: () => { started(); return new Promise(r => { release = r }) } } })
    const v = f.service.start(OWNER, f.input); await barrier; if (!timeout) f.service.cancel(OWNER, v.run.id); await f.service.settled()
    assert.equal(f.service.get(OWNER, v.run.id).run.state, timeout ? 'timed_out' : 'cancelled'); assert.equal(f.service.isActive(), true)
    assert.throws(() => f.service.start(OWNER, { ...f.input, requestId: randomUUID() }), /worker_busy/)
    release({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify(generated) }); await new Promise(r => setImmediate(r)); assert.equal(f.service.isActive(), false); assert.equal(f.calls.includes('review'), false)
  }
})

test('review timeout and provider failure retain only safe diagnostics and never grant task authority', async () => {
  for (const reason of ['worker_timeout', 'claude_invalid_structured_output', 'secret-provider-error']) {
    const error = Error(reason); error.safeDiagnostics = { exitCode: 1, parsedJson: true, subtype: 'private-value', stdoutBytes: 123, stderrBytes: -1, stdout: 'private source', token: 'secret' }
    const f = fixture({ review: async () => { throw error } }), v = await f.ready()
    assert.equal(v.run.state, 'failed'); assert.equal(v.run.reason, reason === 'secret-provider-error' ? 'registration_unavailable' : reason); assert.equal(v.approval, null)
    assert.deepEqual(v.run.failureDiagnostic, { exitCode: 1, parsedJson: true, subtype: 'unknown', stdoutBytes: 123, stderrBytes: null })
    assert.equal(v.run.steps.at(-1).facts.reason, v.run.reason); assert.equal(f.calls.includes('prepare'), false)
    assert.throws(() => createRegistry(f.store).resolve(v.run.registration.workOrder.recipe), /invalid_request/)
    assert.doesNotMatch(JSON.stringify(v.run), /private source|private-value|secret-provider-error/)
  }
})
