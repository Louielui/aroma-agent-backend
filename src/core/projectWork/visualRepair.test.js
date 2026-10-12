'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { createProjectWork } = require('./service'), { createMemoryRunStore } = require('../operating/runStore')
const { definition, INTERFACE_FILES } = require('../projectTasks/contract')
const { digest } = require('../../workers/execution/windowsSandbox'), browser = require('../../workers/execution/browserEvidence')
const guide = require('../../design/uiDesign').forFiles(INTERFACE_FILES)
const OWNER = { id: 'owner', role: 'owner' }, HEAD = 'a'.repeat(40)
function fixture (options = {}) {
  const input = { bootCommit: HEAD, requestId: randomUUID(), goal: 'Move the navigation left', criteria: ['Retain mobile navigation'], editable: [...INTERFACE_FILES] }
  const d = definition(randomUUID(), input, { testCode: "const test=require('node:test'),assert=require('node:assert/strict');test('one',()=>assert.ok(true));", expectedTests: 3 })
  const originals = Object.fromEntries(INTERFACE_FILES.map(n => [n, 'original ' + n]))
  const order = { files: { ...originals, ...d.tests }, goal: d.workOrder.goal, editable: [...INTERFACE_FILES], tests: Object.keys(d.tests), expectedTests: 7, sourceRevision: HEAD, effort: 'high' }
  const proofs = browser.NAMES.map(name => ({ name, locale: name.includes('-zh-') ? 'zh' : 'en', width: name.includes('-1280') ? 1280 : 390, height: 900, failedReads: name === 'browser-zh-390.png', engine: 'edge-headless-offline-v1', browserVersion: 'Edg/154.0.1.1', pageHash: 'd'.repeat(64), screenshotHash: digest(name), screenshotBytes: 2000, routes: ['/demo'], checks: Object.fromEntries(['startup','labels','fiveDepths','mediumDefault','solDefault','layout','keyboard','picker','chatScope','explicitConfirmation','noPageErrors','onlyFixtureRequests'].map(k => [k, true])) }))
  let codes = 0, reviews = 0, changed = false
  const packets = [], store = createMemoryRunStore()
  const source = { read: async () => ({ order, hash: 'b'.repeat(64), evidence: { revision: HEAD, bootCommit: HEAD } }), verify: async () => { if (changed) throw Error('source_changed') } }
  const providers = { isolation: async () => ({ ready: true }), status: async () => ({ codex: { ready: true }, claude: { ready: true } }),
    codeOrder: async p => {
      packets.push(structuredClone({ order: p.order, reviewRepair: p.reviewRepair })); codes++; await p.verify()
      if (options.failCode && codes === 2) throw Error('subscription_limit_reached')
      const changes = INTERFACE_FILES.map(file => ({ file, before: originals[file], after: 'candidate ' + codes + ' ' + file, beforeHash: digest(originals[file]), afterHash: digest('candidate ' + codes + ' ' + file) }))
      return { model: 'gpt-6.1-sol', effort: 'high', billing: 'chatgpt-subscription', execution: 'windows_sandbox_offline', appliedToLive: false, changedFiles: [...INTERFACE_FILES], changes, patchHash: digest(JSON.stringify(changes)), baseline: { total: 7, failed: 1 }, tests: { total: 7, passed: 7, failed: 0, skipped: 0, cancelled: 0, exitCode: 0, browser: proofs }, design: guide.receipt, isolatedRunId: randomUUID() }
    },
    reviewOrder: async p => {
      reviews++
      if (options.reviewError) throw Error('claude_unavailable')
      const rejected = reviews === 1 || options.rejectBoth
      const visual = { verdict: rejected ? 'changes_requested' : 'pass', summary: rejected ? 'Align mobile menu rows' : 'Views approved', inspected: [...browser.NAMES], findings: rejected ? [{ screenshot: 'browser-en-390.png', message: 'Align wrapped rows and keep the header compact' }] : [], screenshots: proofs.map(row => ({ name: row.name, screenshotHash: row.screenshotHash })), patchHash: p.patchHash, design: guide.receipt, model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', reviewedAt: '2026-10-05T00:00:00Z' }
      if (options.drift && reviews === 1) changed = true
      const review = { verdict: rejected ? 'changes_requested' : 'pass', summary: visual.summary, findings: [], model: 'claude-sonnet-5', billing: 'claude-subscription', visual }
      if (options.mutateReview) options.mutateReview(review)
      if (options.cancelOnReview) flow.cancel(OWNER, store.all()[0].id)
      return review
    }
  }
  const flow = createProjectWork({ source, providers, store, enabled: () => true, resolveRecipe: id => { assert.equal(id, d.workOrder.recipe); return d } })
  return { flow, packets, calls: () => [codes, reviews], async run () { const p = await flow.prepare(OWNER, { bootCommit: HEAD, projectId: d.workOrder.projectId, recipe: d.workOrder.recipe, requestId: randomUUID() }); flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }); await flow.settled(); return flow.get(OWNER, p.run.id) } }
}
test('one pixel rejection continues inside the same approved immutable task and retains both reviews', async () => {
  const f = fixture(), r = await f.run()
  assert.equal(r.state, 'completed'); assert.deepEqual(f.calls(), [2, 2]); assert.equal(r.appliedToLive, false)
  assert.deepEqual(f.packets[1].order, f.packets[0].order)
  assert.equal(f.packets[1].reviewRepair.visual.verdict, 'changes_requested')
  assert.equal(f.packets[1].reviewRepair.changes[0].after, 'candidate 1 ' + INTERFACE_FILES[0])
  assert.equal(r.attempts.length, 2); assert.equal(r.attempts[0].review.visual.verdict, 'changes_requested'); assert.equal(r.attempts[1].review.visual.verdict, 'pass')
  assert.equal(r.steps.filter(s => s.stage === 'approved').length, 1)
})
test('a second pixel rejection stops without adoption, repeated dispatch or a passing verdict', async () => {
  const f = fixture({ rejectBoth: true }), r = await f.run()
  assert.equal(r.state, 'needs_attention'); assert.deepEqual(f.calls(), [2, 2]); assert.equal(r.review.verdict, 'changes_requested'); assert.equal(r.appliedToLive, false)
})
test('cancellation during review stops before any visual correction', async () => {
  const f = fixture({ cancelOnReview: true }), r = await f.run()
  assert.equal(r.state, 'cancelled'); assert.deepEqual(f.calls(), [1, 1]); assert.equal(r.appliedToLive, false)
})
test('source drift and provider errors do not enter a visual repair', async () => {
  for (const options of [{ drift: true }, { reviewError: true }]) {
    const f = fixture(options), r = await f.run(); assert.equal(r.state, 'failed'); assert.deepEqual(f.calls(), [1, 1])
  }
  const f = fixture({ failCode: true }), r = await f.run(); assert.equal(r.reason, 'subscription_limit_reached'); assert.deepEqual(f.calls(), [2, 1]); assert.equal(r.attempts[0].review.verdict, 'changes_requested')
})
test('unbound visual evidence and unsupported billing cannot authorize a correction', async () => {
  for (const mutateReview of [r => { r.visual.patchHash = '0'.repeat(64) }, r => { r.visual.screenshots[0].screenshotHash = '0'.repeat(64) }, r => { r.visual.billing = 'api' }, r => { r.billing = 'api' }, r => { r.visual.findings[0].screenshot = 'invented.png' }]) {
    const f = fixture({ mutateReview }), r = await f.run(); assert.equal(r.state, 'failed'); assert.deepEqual(f.calls(), [1, 1])
  }
})
test('the actual provider composition carries feedback to text-only coding without replacing original files or tests', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-visual-correction-'))
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); fs.rmSync(root, { recursive: true, force: true }) })
  const f = fixture(); await f.run(); const packet = f.packets[1]
  let calls = 0, executions = 0, rejectTests = false
  const executor = { readiness: async () => ({ ready: true }), isBusy: () => false, run: async value => {
    executions++; assert.deepEqual(value.tests, packet.order.tests)
    for (const name of packet.order.tests) assert.equal(value.files[name], packet.order.files[name])
    const red = executions % 2 === 1 || rejectTests
    if (executions % 2 === 1) assert.deepEqual(value.files, packet.order.files)
    return { exitCode: red ? 1 : 0, total: 7, passed: red ? 6 : 7, failed: red ? 1 : 0, skipped: 0, cancelled: 0, stdout: 'Measured fixture assertions', evidenceHash: 'a'.repeat(64) }
  } }
  const provider = { preflight: async () => {}, complete: async (text, options) => {
    calls++; const prompt = JSON.parse(text)
    assert.deepEqual(prompt.files, packet.order.files); assert.equal(prompt.repair.kind, 'verified_visual_rejection')
    assert.equal(prompt.repair.previousCandidate[0].content, packet.reviewRepair.changes[0].after)
    assert.equal(prompt.repair.visualReview.findings[0].screenshot, 'browser-en-390.png')
    assert.deepEqual(options.responseFormat.schema.properties.changes.items.properties.file.enum, packet.order.editable)
    return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ summary: 'Corrected the mobile rows', changes: packet.order.editable.map(file => ({ file, content: 'corrected ' + file })) }) }
  } }
  const result = await require('../workerFlow/providers').code({ root, order: packet.order, reviewRepair: packet.reviewRepair, executor, provider })
  assert.equal(calls, 1); assert.equal(executions, 2); assert.equal(result.changes[0].before, packet.order.files[packet.order.editable[0]])
  assert.equal(result.appliedToLive, false)
  const altered = structuredClone(packet.reviewRepair); altered.changes[0].before = 'different source'; altered.changes[0].beforeHash = digest('different source'); altered.patchHash = digest(JSON.stringify(altered.changes)); altered.visual.patchHash = altered.patchHash
  await assert.rejects(require('../workerFlow/providers').code({ root, order: packet.order, reviewRepair: altered, executor, provider }), /accepted_evidence_changed/)
  assert.equal(calls, 1); assert.equal(executions, 2)
  rejectTests = true
  await assert.rejects(require('../workerFlow/providers').code({ root, order: packet.order, reviewRepair: packet.reviewRepair, executor, provider }), /acceptance_failed/)
  assert.equal(calls, 2); assert.equal(executions, 4)
})
