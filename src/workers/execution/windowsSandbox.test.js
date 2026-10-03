'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createExecutor, readiness, validatePackage, prepare, configuration, verifyInputs, evidence, VERSION } = require('./windowsSandbox')
const pack = { files: { 'src/value.js': 'exports.value=1', 'src/value.test.js': '/* protected */' }, tests: ['src/value.test.js'], expectedTests: 2 }
function temp (t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-offline-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root }
function ready () { return Promise.resolve({ ready: true, cli: 'mock-wsb', engine: VERSION }) }
function guest (job, edits = {}) {
  fs.writeFileSync(path.join(job.output, 'evidence.json'), JSON.stringify({ id: job.id, engine: VERSION, boundary: { noExternalInterfaces: true, hostReadDenied: true, hostWriteDenied: true, readonlyInputDenied: true, readonlyToolsDenied: true, loopbackDenied: true, ipv6LoopbackDenied: true, internetDenied: true, cleanIdentity: true, secretsAbsent: true }, inputHashes: job.hashes, tests: { exitCode: 0, total: 2, passed: 2, failed: 0, cancelled: 0, skipped: 0, stdout: 'unit mock', stderr: '' }, at: new Date().toISOString(), ...edits }))
}
test('Windows dependency absence fails closed without executing code or installing anything', async t => {
  const root = temp(t); let called = 0
  const runner = createExecutor({ root, check: async () => ({ ready: false, reason: 'windows_sandbox_not_enabled' }), run: async () => { called++ } })
  await assert.rejects(runner.run(pack), /windows_sandbox_not_enabled/); assert.equal(called, 0); assert.equal(runner.isBusy(), false)
  assert.equal((await readiness({ platform: 'linux' })).reason, 'windows_required')
})
test('readiness requires an installed feature and supported CLI, not merely a permission flag', async () => {
  assert.equal((await readiness({ platform: 'win32', run: async () => JSON.stringify({ featureInstalled: false }) })).ready, false)
  assert.equal((await readiness({ platform: 'win32', run: async () => JSON.stringify({ featureInstalled: true, cli: null }) })).ready, false)
  let calls = 0; const result = await readiness({ platform: 'win32', run: async () => ++calls === 1 ? JSON.stringify({ featureInstalled: true, cli: process.execPath }) : 'start stop connect' })
  assert.equal(result.ready, true); assert.equal(result.boundaryVerified, false)
})
test('package denies traversal, ADS, case aliases, secrets, external commands and unbounded content', () => {
  for (const n of ['../other.js', '/outside.js', 'C:/other.js', 'src/a.js:evil', '.env', '.codex/auth.json', 'node_modules/x.js', 'data/x.json', 'src/a&b.js']) assert.throws(() => validatePackage({ ...pack, files: { ...pack.files, [n]: 'x' } }), /invalid_work_order/)
  assert.throws(() => validatePackage({ ...pack, files: { ...pack.files, 'src/Value.js': 'duplicate' } }), /invalid_work_order/)
  assert.throws(() => validatePackage({ ...pack, files: { ...pack.files, 'x.js': 'a'.repeat(100001) } }), /invalid_work_order/)
  assert.throws(() => validatePackage({ ...pack, tests: ['../x.test.js'] }), /invalid_work_order/)
})
test('configuration exposes only job copies and disables all host sharing and external networking', t => {
  const root = temp(t), job = prepare({ root, pack }); const config = configuration(job)
  for (const n of ['Networking', 'vGPU', 'AudioInput', 'VideoInput', 'PrinterRedirection', 'ClipboardRedirection']) assert.ok(config.includes(`<${n}>Disable</${n}>`))
  assert.ok(config.includes('<ProtectedClient>Enable</ProtectedClient>'))
  assert.equal((config.match(/<MappedFolder>/g) || []).length, 3)
  assert.equal((config.match(/<ReadOnly>true<\/ReadOnly>/g) || []).length, 2)
  assert.equal((config.match(/<ReadOnly>false<\/ReadOnly>/g) || []).length, 1)
  assert.ok(!config.includes('C:\\Aroma\\aroma-agent-backend'))
  verifyInputs(job); guest(job); assert.equal(evidence(job).engine, VERSION)
})
test('source/test/runner tampering, false isolation and forged cardinality cannot pass host checks', t => {
  const root = temp(t)
  const bad = prepare({ root, pack }); guest(bad, { tests: { exitCode: 0, total: 2, passed: 1.5, failed: 0.5, cancelled: 0, skipped: 0, stdout: '', stderr: '' } }); assert.throws(() => evidence(bad), /invalid_sandbox_evidence/)
  const network = prepare({ root, pack }); guest(network, { boundary: { noExternalInterfaces: false } }); assert.throws(() => evidence(network), /sandbox_failed/)
  const modified = prepare({ root, pack }); guest(modified); fs.appendFileSync(path.join(modified.input, 'src/value.test.js'), 'changed'); assert.throws(() => evidence(modified), /scope_changed/)
  const extra = prepare({ root, pack }); guest(extra); fs.writeFileSync(path.join(extra.output, 'extra.js'), 'x'); assert.throws(() => evidence(extra), /invalid_sandbox_evidence/)
})
test('owned VM stops after failure; a failed stop remains busy across restart until explicit recovery', async t => {
  const root = temp(t); const calls = []; let stopFails = true
  const run = async (_, args) => { calls.push(args); if (args[0] === 'start') throw Error('sandbox_unavailable'); if (args[0] === 'stop' && stopFails) throw Error('not stopped'); return '{}' }
  const runner = createExecutor({ root, check: ready, run })
  await assert.rejects(runner.run(pack), /sandbox_stop_unconfirmed/); assert.equal(runner.isBusy(), true)
  await assert.rejects(runner.run(pack), /worker_busy/)
  const restarted = createExecutor({ root, check: ready, run }); assert.equal(restarted.isBusy(), true)
  stopFails = false; const recovered = await restarted.recover(); assert.equal(recovered.resumed, false); assert.equal(restarted.isBusy(), false)
  assert.ok(calls.filter(a => a[0] === 'stop').every(a => a[2] === recovered.id)); assert.equal(calls.filter(a => a[0] === 'start').length, 1)
})
test('pre-cancelled work never starts a VM', async t => {
  const controller = new AbortController(); controller.abort(); let calls = 0
  const runner = createExecutor({ root: temp(t), check: ready, run: async () => { calls++ } })
  await assert.rejects(runner.run(pack, { signal: controller.signal }), /worker_cancelled/); assert.equal(calls, 0)
})
