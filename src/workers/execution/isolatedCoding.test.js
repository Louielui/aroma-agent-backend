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
test('missing OS boundary, quota rejection, unexpected provider and failed acceptance never retry or fall back', async t => {
  for (const overrides of [
    { executor: { readiness: async () => ({ ready: false, reason: 'windows_sandbox_not_enabled' }) } },
    { provider: { preflight: async () => { throw Error('subscription_limit_reached') } } },
    { provider: { complete: async () => ({ model: 'other', billing: 'api' }) } },
    { executor: { run: async () => ({ exitCode: 1, total: 2, passed: 0, failed: 2, cancelled: 0, skipped: 0 }) } }
  ]) {
    const { worker, root } = setup(t, overrides)
    await assert.rejects(worker.execute({ approval: worker.prepare(workOrder, 'owner'), actor: 'owner' }))
    const records = fs.readdirSync(root).filter(n => n.endsWith('.json')); assert.equal(records.length, 1); assert.equal(JSON.parse(fs.readFileSync(path.join(root, records[0]))).state, 'failed')
  }
})
