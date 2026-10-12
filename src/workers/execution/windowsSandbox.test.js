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
  assert.equal((await readiness({ platform: 'win32', run: async () => JSON.stringify({ featureInstalled: true, hypervisorPresent: true, cli: null }) })).ready, false)
  let calls = 0; const result = await readiness({ platform: 'win32', run: async () => ++calls === 1 ? JSON.stringify({ featureInstalled: true, hypervisorPresent: true, cli: process.execPath }) : 'start stop connect' })
  assert.equal(result.ready, true); assert.equal(result.boundaryVerified, false)
})

test('an active hypervisor and CLI are not blocked by unrelated global Windows Update reboot flags', async () => {
  let calls = 0
  const result = await readiness({ platform: 'win32', run: async () => ++calls === 1 ? JSON.stringify({ featureInstalled: true, hypervisorPresent: true, restartPending: true, cli: process.execPath }) : 'start stop connect' })
  assert.equal(result.ready, true); assert.equal(result.systemRestartPending, true); assert.equal(result.boundaryVerified, false)
  const pending = await readiness({ platform: 'win32', run: async () => JSON.stringify({ featureInstalled: true, hypervisorPresent: false, restartPending: true, cli: process.execPath }) })
  assert.equal(pending.ready, false); assert.equal(pending.reason, 'windows_restart_required')
  const absent = await readiness({ platform: 'win32', run: async () => JSON.stringify({ featureInstalled: true, hypervisorPresent: false, restartPending: false, cli: process.execPath }) })
  assert.equal(absent.ready, false); assert.equal(absent.reason, 'windows_virtualization_unavailable')
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

test('chat PNG artifacts are retained, hashed and refused when missing, altered or foreign', t => {
  const { TEST, screenshot } = require('./browserEvidence'), { digest } = require('./windowsSandbox')
  const root = temp(t), p = { ...pack, files: { ...pack.files, [TEST]: '/* fixed browser test fixture */' }, tests: [TEST] }
  const job = prepare({ root, pack: p }), browser = []
  for (const locale of ['zh', 'en']) for (const width of [1280, 390]) {
    const name = `browser-${locale}-${width}.png`, png = Buffer.alloc(1100)
    Buffer.from('89504e470d0a1a0a','hex').copy(png); png.writeUInt32BE(width,16); png.writeUInt32BE(900,20)
    fs.writeFileSync(path.join(job.output,name),png)
    browser.push({name,engine:'edge-headless-offline-v1',browserVersion:'Edg/154.0',locale,width,height:900,failedReads:locale==='zh'&&width===390,pageHash:'a'.repeat(64),screenshotHash:digest(png),screenshotBytes:png.length,checks:Object.fromEntries(['startup','labels','fiveDepths','mediumDefault','solDefault','layout','keyboard','picker','chatScope','explicitConfirmation','noPageErrors','onlyFixtureRequests'].map(k=>[k,true])),routes:['/demo']})
  }
  guest(job, { tests: { exitCode:0,total:2,passed:2,failed:0,cancelled:0,skipped:0,stdout:'unit mock',stderr:'',browser } })
  const result = evidence(job); assert.equal(result.browser.length,4); assert.equal(Buffer.from(screenshot(result,browser[0].name).content,'base64').length,1100)
  assert.throws(()=>screenshot(result,'../../.env'),/invalid_sandbox_evidence/)
  fs.appendFileSync(path.join(job.output,browser[0].name),'tamper'); assert.throws(()=>evidence(job),/invalid_sandbox_evidence/); assert.throws(()=>screenshot(result,browser[0].name),/invalid_sandbox_evidence/)
  fs.unlinkSync(path.join(job.output,browser[0].name)); assert.throws(()=>evidence(job),/invalid_sandbox_evidence/)
})
