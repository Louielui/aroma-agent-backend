'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { code, claudeArgs, readReview } = require('./providers')
const { SOURCE, TESTS } = require('./fixture')
test('registered workbench delegates executable bytes only to the offline executor and protects tests', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiang-provider-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const calls = []; let models = 0
  const executor = { readiness: async () => ({ ready: true }), isBusy: () => false, run: async pack => {
    calls.push(pack); assert.equal(pack.files['duration.test.js'], TESTS)
    return { exitCode: calls.length === 1 ? 1 : 0, total: 5, passed: calls.length === 1 ? 0 : 5, failed: calls.length === 1 ? 5 : 0, skipped: 0, cancelled: 0, stdout: 'unit mock', stderr: '', engine: 'windows-sandbox-offline-v1' }
  } }
  const provider = { preflight: async o => assert.equal(o.model, 'gpt-6.1-sol'), complete: async (prompt, o) => {
    models++; const packet = JSON.parse(prompt); assert.deepEqual(packet.editable, ['duration.js']); assert.equal(packet.files['duration.js'], SOURCE)
    assert.deepEqual(o.responseFormat.schema.properties.changes.items.properties.file.enum, ['duration.js'])
    return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ changes: [{ file: 'duration.js', content: 'module.exports = { formatDuration: () => "0:00" }' }], summary: 'unit mock' }) }
  } }
  const result = await code({ root, executor, provider, emit () {} })
  assert.equal(models, 1); assert.equal(calls.length, 2); assert.equal(calls[0].files['duration.js'], SOURCE)
  assert.equal(result.tests.passed, 5); assert.equal(result.tests.exitCode, 0); assert.equal(result.baseline.exitCode, 1)
  assert.deepEqual(result.changedFiles, ['duration.js']); assert.equal(result.execution, 'windows_sandbox_offline'); assert.equal(result.appliedToLive, false)
})
test('an unavailable OS boundary refuses workbench coding before subscription use', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiang-provider-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let calls = 0
  await assert.rejects(code({ root, executor: { readiness: async () => ({ ready: false, reason: 'windows_restart_required' }), isBusy: () => false, run: async () => { calls++ } }, provider: { preflight: async () => { calls++ }, complete: async () => { calls++ } } }), /windows_restart_required/)
  assert.equal(calls, 0)
})
test('reviewer has no tools, no discovery and no API-key authentication fallback', () => {
  const args = claudeArgs()
  assert.equal(args[args.indexOf('--tools') + 1], ''); assert.ok(args.includes('--restricted')); assert.ok(args.includes('--strict-mcp-config')); assert.ok(!args.includes('--dangerously-skip-permissions'))
  assert.throws(() => readReview({ type: 'result', subtype: 'success', is_error: false, result: 'looks done' }), /invalid_worker_result/)
  assert.throws(() => readReview({ type: 'result', subtype: 'success', structured_output: { verdict: 'pass', summary: 'x', findings: ['bad'] } }), /invalid_worker_result/)
})
