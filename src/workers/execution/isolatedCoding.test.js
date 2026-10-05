'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createIsolatedCoding, order, replacements, MODEL } = require('./isolatedCoding')
const workOrder = { goal: 'Solve a newly packaged problem', files: { 'issue.js': 'exports.value=0', 'issue.test.js': '/* immutable */' }, editable: ['issue.js'], tests: ['issue.test.js'], expectedTests: 2, sourceRevision: 'fixture-v2' }
function setup (t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-generic-coding-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let executions = 0, modelCalls = 0
  const executor = { readiness: async () => ({ ready: true }), isBusy: () => false, run: async p => { executions++; assert.equal(p.files['issue.test.js'], workOrder.files['issue.test.js']); return { exitCode: executions === 1 ? 1 : 0, total: 2, passed: executions === 1 ? 1 : 2, failed: executions === 1 ? 1 : 0, skipped: 0, cancelled: 0, stdout: 'mock tests', evidenceHash: String(executions) } }, ...overrides.executor }
  const provider = { preflight: async () => {}, complete: async (_, options) => { modelCalls++; assert.deepEqual(options.responseFormat.schema.properties.changes.items.properties.file.enum, ['issue.js']); return { model: MODEL, billing: 'chatgpt-subscription', text: JSON.stringify({ changes: [{ file: 'issue.js', content: 'exports.value=42' }], summary: 'changed' }) } }, ...overrides.provider }
  return { root, worker: createIsolatedCoding({ root, executor, provider }), counts: () => ({ executions, modelCalls }) }
}
test('generic contract is bound to source, tests, goal and execution boundary', () => {
  const base = order(workOrder)
  for (const v of [{ ...workOrder, goal: 'different' }, { ...workOrder, files: { ...workOrder.files, 'issue.test.js': 'different' } }, { ...workOrder, sourceRevision: 'other' }]) assert.notEqual(order(v).approvalHash, base.approvalHash)
  assert.throws(() => order({ ...workOrder, command: 'powershell' }), /invalid_work_order/)
  assert.throws(() => order({ ...workOrder, editable: ['issue.test.js'] }), /invalid_work_order/)
})
test('non-Owner, altered approval, protected file edits and extra commands are refused', async t => {
  const { worker, counts } = setup(t), approval = worker.prepare(workOrder, 'owner')
  await assert.rejects(worker.execute({ approval, actor: 'ivy' }), /approval_required/)
  await assert.rejects(worker.execute({ approval: { ...approval, hash: '0'.repeat(64) }, actor: 'owner' }), /approval_unavailable/)
  await assert.rejects(worker.execute({ approval, actor: 'owner' }), /approval_unavailable/)
  assert.deepEqual(counts(), { executions: 0, modelCalls: 0 })
  assert.throws(() => replacements(order(workOrder), { changes: [{ file: 'issue.test.js', content: 'forged' }], summary: '' }), /invalid_worker_result/)
  assert.throws(() => replacements(order(workOrder), { changes: [{ file: 'issue.js', content: 'x', command: 'bad' }], summary: '' }), /invalid_worker_result/)
})
test('a new packaged issue uses baseline, text-only coding, fresh after execution and retained evidence', async t => {
  const { worker, root, counts } = setup(t)
  const approval = worker.prepare(workOrder, 'owner')
  const result = await worker.execute({ approval, actor: 'owner' })
  await assert.rejects(worker.execute({ approval, actor: 'owner' }), /approval_unavailable/)
  assert.deepEqual(counts(), { executions: 2, modelCalls: 1 }); assert.equal(result.state, 'accepted_isolated'); assert.equal(result.appliedToLive, false); assert.equal(result.tests.failed, 0); assert.equal(result.changes[0].before, 'exports.value=0')
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, result.id + '.json'))).patchHash, result.patchHash)
})
test('missing OS boundary, quota rejection and unexpected provider never retry or fall back', async t => {
  for (const overrides of [
    { executor: { readiness: async () => ({ ready: false, reason: 'windows_sandbox_not_enabled' }) } },
    { provider: { preflight: async () => { throw Error('subscription_limit_reached') } } },
    { provider: { complete: async () => ({ model: 'other', billing: 'api' }) } }
  ]) {
    const { worker, root } = setup(t, overrides)
    await assert.rejects(worker.execute({ approval: worker.prepare(workOrder, 'owner'), actor: 'owner' }))
    const records = fs.readdirSync(root).filter(n => n.endsWith('.json')); assert.equal(records.length, 1); assert.equal(JSON.parse(fs.readFileSync(path.join(root, records[0]))).state, 'failed')
  }
})

test('failed candidate receives one evidence-bound repair with immutable tests and both attempts retained', async t => {
  let runs = 0, calls = 0
  const { worker } = setup(t, {
    executor: { run: async pack => { runs++; assert.equal(pack.files['issue.test.js'], workOrder.files['issue.test.js']); return { exitCode: runs < 3 ? 1 : 0, total: 2, passed: runs < 3 ? 1 : 2, failed: runs < 3 ? 1 : 0, skipped: 0, cancelled: 0, stdout: 'measured assertion value must be 42', evidenceHash: String(runs) } } },
    provider: { complete: async prompt => { const input = JSON.parse(prompt); calls++; if (calls === 2) { assert.equal(input.files['issue.js'], 'exports.value=41'); assert.match(input.repair.stdout, /measured assertion/); assert.equal(input.repair.failed, 1); assert.equal(input.files['issue.test.js'], workOrder.files['issue.test.js']) }; return { model: MODEL, billing: 'chatgpt-subscription', text: JSON.stringify({ changes: [{ file: 'issue.js', content: 'exports.value=' + (calls === 1 ? 41 : 42) }], summary: 'candidate' }) } } }
  })
  const result = await worker.execute({ approval: worker.prepare(workOrder, 'owner'), actor: 'owner' })
  assert.equal(calls, 2); assert.equal(runs, 3); assert.equal(result.state, 'accepted_isolated')
  assert.equal(result.attempts.length, 2); assert.equal(result.attempts[0].tests.failed, 1); assert.equal(result.attempts[1].tests.failed, 0)
  assert.equal(result.attempts[0].changes[0].after, 'exports.value=41'); assert.equal(result.changes[0].before, workOrder.files['issue.js']); assert.equal(result.changes[0].after, 'exports.value=42')
  assert.ok(result.events.some(e => e.stage === 'repairing_code'))
})

test('repair is bounded and never retries incomplete evidence, cancellation or a provider error', async t => {
  for (const fault of ['still_failing', 'incomplete', 'cancelled', 'quota']) {
    let runs = 0, calls = 0; const controller = new AbortController()
    const { worker, root } = setup(t, {
      executor: { run: async () => { runs++; if (runs === 2 && fault === 'cancelled') controller.abort(); return { exitCode: 1, total: fault === 'incomplete' && runs === 2 ? 1 : 2, passed: 0, failed: 2, skipped: 0, cancelled: 0, stdout: 'failed', evidenceHash: String(runs) } } },
      provider: { complete: async () => { calls++; if (fault === 'quota') throw Error('subscription_limit_reached'); return { model: MODEL, billing: 'chatgpt-subscription', text: JSON.stringify({ changes: [{ file: 'issue.js', content: 'exports.value=' + calls }], summary: 'candidate' }) } } }
    })
    await assert.rejects(worker.execute({ approval: worker.prepare(workOrder, 'owner'), actor: 'owner', signal: controller.signal }))
    assert.equal(calls, fault === 'still_failing' ? 2 : 1, fault)
    const record = JSON.parse(fs.readFileSync(path.join(root, fs.readdirSync(root).find(n => n.endsWith('.json')))))
    assert.equal(record.state, 'failed'); assert.equal(record.appliedToLive, false)
    if (fault === 'still_failing') assert.equal(record.attempts.length, 2)
  }
})
