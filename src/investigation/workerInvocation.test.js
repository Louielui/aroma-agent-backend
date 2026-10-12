'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events'), { PassThrough, Writable } = require('node:stream')
const { createInvocationLedger } = require('./invocations')
const { withWorkerRun, withWorkerPhase, observeWorkerCall, validWorkerTrace } = require('./workerInvocation')
const { runClaude, claudeArgs } = require('../core/workerFlow/providers')
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-receipts-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'ledger.json'), ledger = createInvocationLedger({ file }), record = { id: randomUUID(), state: 'queued' }
  const save = r => fs.writeFileSync(path.join(dir, r.id + '.json'), JSON.stringify(r))
  return { dir, file, ledger, record, save, kind: 'project-runs' }
}
const receipt = { model: 'claude-sonnet-5-5', billing: 'claude-subscription', usageBasis: 'provider_result_model_usage', usage: { inputTokens: 7, outputTokens: 2 }, text: 'PRIVATE SOURCE', total_cost_usd: 100 }
function spawnResult(result, exitCode = 0) {
  return () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {}
    child.stdin = new Writable({ write(chunk, enc, done) { done() }, final(done) { done(); process.nextTick(() => { child.emit('spawn'); child.stdout.end(JSON.stringify(result)); child.emit('close', exitCode) }) } })
    return child
  }
}
const cliOptions = (value, exit = 0) => ({ input: 'PRIVATE SOURCE', cwd: 'empty', resolveCommand: () => ({ ok: true, command: 'fake' }), spawnImpl: spawnResult(value, exit) })
const envelope = { type: 'result', subtype: 'success', modelUsage: { 'claude-sonnet-5-5': { inputTokens: 7, outputTokens: 2 }, 'claude-haiku-4-5': { inputTokens: 1, outputTokens: 1 } }, total_cost_usd: 99, result: 'PRIVATE SOURCE' }
test('canonical run binds phases and formatting calls without inventing retries or billing', async t => {
  const f = fixture(t)
  await withWorkerRun(f, async () => {
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, f.record.id + '.json'))).workerRuns.length, 1)
    await withWorkerPhase('development', 1, () => observeWorkerCall({ model: 'claude-sonnet', effort: 'medium' }, async dispatch => { dispatch(); return receipt }))
    await withWorkerPhase('review', 1, () => runClaude(claudeArgs(), cliOptions(envelope)))
    await withWorkerPhase('review', 1, () => runClaude(claudeArgs(), cliOptions(envelope)))
    f.record.state = 'needs_attention'
  })
  const rows = createInvocationLedger({ file: f.file }).read().records
  assert.equal(rows.length, 3); assert.equal(new Set(rows.map(r => r.workerTrace.runId)).size, 1)
  assert.ok(rows.every(r => r.workerOutcome.state === 'needs_attention' && r.actualModel === 'claude-sonnet-5-5'))
  assert.ok(rows.every(r => r.workerTrace.recordId === f.record.id && r.workerTrace.attempt === 1))
  assert.deepEqual(rows[0].usageByModel.map(x => x.model), ['claude-sonnet-5-5', 'claude-haiku-4-5'])
  assert.doesNotMatch(fs.readFileSync(f.file, 'utf8'), /PRIVATE SOURCE|cost_usd/)
  await withWorkerRun(f, async () => { await observeWorkerCall({ model: 'claude-sonnet' }, async () => receipt); f.record.state = 'completed' })
  const latest = f.ledger.read().records[0]
  assert.equal(latest.workerTrace.attempt, 2); assert.equal(latest.workerTrace.workId, rows[0].workerTrace.workId)
  assert.notEqual(latest.workerTrace.runId, rows[0].workerTrace.runId)
  assert.equal(f.record.workerRuns[0].state, 'needs_attention')
})
test('auth checks and normal chat create no worker receipt, even inside worker context', async t => {
  const f = fixture(t)
  await runClaude(claudeArgs(), cliOptions(envelope))
  await withWorkerRun(f, () => runClaude(['auth', 'status', '--json'], cliOptions({ loggedIn: true })))
  assert.equal(f.ledger.read().records.length, 0)
})
test('failed CLI process start has unknown model and usage rather than zero or a proven provider dispatch', async t => {
  const f = fixture(t)
  await withWorkerRun(f, async () => {
    await assert.rejects(runClaude(claudeArgs(), cliOptions({ type: 'result', subtype: 'error_during_execution', result: 'PRIVATE SOURCE' }, 1)), /claude_unavailable/)
    f.record.state = 'failed'
  })
  const row = f.ledger.read().records[0]
  assert.equal(row.dispatchBasis, 'cli_process_started'); assert.ok(row.dispatchedAt)
  assert.equal(row.actualModel, null); assert.equal(row.usage, null); assert.equal(row.failureCode, 'claude_unavailable')
  const r = require('./executionUsage').buildExecutionUsage({ sections: [{ section: 'execution', state: 'partial', sourceId: 'execution:test', records: [row] }] })
  assert.equal(r.chains[0].executionState, 'UNKNOWN'); assert.equal(r.chains[0].unknownUsageCalls, 1)
  assert.equal(r.subscriptionCreditUsed, null); assert.equal(r.billingConfirmed, false)
})
test('unavailable ledger or unsaved run prevents paid dispatch, never retries it', async t => {
  const f = fixture(t); let calls = 0
  fs.writeFileSync(f.file, 'broken')
  await assert.rejects(withWorkerRun({ ...f, ledger: createInvocationLedger({ file: f.file }) }, () => observeWorkerCall({ model: 'claude-sonnet' }, () => { calls++; return receipt })), /worker_evidence_unavailable/)
  await assert.rejects(withWorkerRun({ ...f, save: () => { throw Error('disk_failed') } }, () => { calls++ }), /disk_failed/)
  assert.equal(calls, 0)
})
test('host completion waits for dispatched cancellation to settle and blocks late provider calls', async t => {
  const f = fixture(t); let release, late, settled = false, lateResult
  const pending = withWorkerRun(f, async () => {
    withWorkerPhase('review', 1, () => {
      lateResult = new Promise(resolve => { late = () => setImmediate(() => observeWorkerCall({ model: 'claude-sonnet' }, () => receipt).then(resolve, resolve)) })
      observeWorkerCall({ model: 'claude-sonnet' }, () => new Promise(resolve => { release = resolve }))
      // Register the deferred callback inside this context, after host closure.
      setTimeout(() => late(), 25)
    })
    f.record.state = 'cancelled'
  }).then(() => { settled = true })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false)
  release(receipt); await pending
  assert.equal(f.ledger.read().records[0].workerOutcome.state, 'cancelled')
  assert.match((await lateResult).message, /worker_evidence_unavailable/)
  assert.equal(f.ledger.read().records.length, 1)
})
test('parallel host contexts do not cross-link calls or allow prompt-supplied identities', async t => {
  const f = fixture(t), other = { ...f, record: { id: randomUUID(), state: 'queued' }, kind: 'project-tasks' }
  await Promise.all([f, other].map(x => withWorkerRun(x, async () => { await new Promise(resolve => setImmediate(resolve)); await observeWorkerCall({ model: 'claude-sonnet', workerTrace: { recordId: 'fake' } }, async () => receipt); x.record.state = 'completed' })))
  const rows = f.ledger.read().records
  assert.equal(new Set(rows.map(x => x.workerTrace.recordId)).size, 2)
  assert.ok(rows.every(x => validWorkerTrace(x.workerTrace)))
  assert.equal(validWorkerTrace({ ...rows[0].workerTrace, kind: '../secrets' }), false)
  assert.equal(validWorkerTrace({ ...rows[0].workerTrace, recordId: randomUUID() }), false)
})
test('real Codex completion hook captures last-turn counters once and leaves auth calls uncounted', async t => {
  const f = fixture(t), events = new EventEmitter(); let turns = 0, hooks = 0
  const rpc = { events, notify() {}, close() {}, async request(method) {
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'pro' } }
    if (method === 'model/list') return { data: [{ model: 'gpt-6.1-sol' }], nextCursor: null }
    if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: 1 } } }
    if (method === 'config/read') return { config: {} }
    if (method === 'thread/start') return { model: 'gpt-6.1-sol', modelProvider: 'openai', thread: { id: 'fixture' } }
    if (method === 'mcpServerStatus/list') return { data: [] }
    if (method === 'turn/start') { turns++; queueMicrotask(() => {
      events.emit('notification', { method: 'thread/tokenUsage/updated', params: { threadId: 'fixture', tokenUsage: { last: { inputTokens: 5, outputTokens: 2 } } } })
      events.emit('notification', { method: 'item/completed', params: { threadId: 'fixture', item: { type: 'agentMessage', text: 'PRIVATE SOURCE' } } })
      events.emit('notification', { method: 'turn/completed', params: { threadId: 'fixture', turn: { status: 'completed' } } })
    }) }
    return {}
  } }
  const client = require('../subscription/codexClient'), options = { connect: () => rpc, cwd: 'empty', model: 'gpt-6.1-sol', effort: 'medium', onDispatch: () => hooks++ }
  await withWorkerRun(f, async () => {
    await client.checkSubscription(options)
    await client.complete(options, { prompt: 'PRIVATE SOURCE', model: 'gpt-6.1-sol', effort: 'medium' })
    f.record.state = 'completed'
  })
  const rows = f.ledger.read().records
  assert.equal(rows.length, 1); assert.equal(turns, 1); assert.equal(hooks, 1)
  assert.equal(rows[0].actualModel, 'gpt-6.1-sol'); assert.deepEqual(rows[0].usage, { inputTokens: 5, outputTokens: 2 })
  const chain = require('./executionUsage').buildExecutionUsage({ sections: [{ section: 'execution', state: 'partial', sourceId: 'execution:test', records: rows }] }).chains[0]
  assert.equal(chain.usageState, 'SUPPORTED'); assert.equal(chain.usageModels[0].subtotal, null)
})
test('actual workflow saves canonical run, bounded review retry and independent provider outcomes', async t => {
  const f = fixture(t), dir = path.join(f.dir, 'runs'); let reviews = 0
  const flow = require('../core/workerFlow/workflow').createWorkflow({ dir, enabled: () => true, invocationLedger: f.ledger, providers: {
    status: async () => ({ codex: { ready: true }, claude: { ready: true } }),
    code: async () => { await observeWorkerCall({ model: 'claude-sonnet' }, async dispatch => { dispatch(); return receipt }); return { after: 'new', tests: { exitCode: 0 } } },
    review: async () => { await runClaude(claudeArgs(), cliOptions(envelope)); reviews++; return { verdict: reviews === 1 ? 'changes_requested' : 'pass', findings: [] } }
  } })
  const started = flow.start({ recipe: 'duration-v1', approved: true }); await flow.settled()
  assert.equal(flow.get(started.id).state, 'needs_attention')
  flow.reviewAgain({ id: started.id, approved: true }); await flow.settled()
  const record = flow.get(started.id); assert.equal(record.state, 'completed'); assert.equal(record.workerRuns.length, 2)
  const work = require('./workEvidence').projectWorkRecord(record, { kind: 'worker/runs', recordId: started.id })
  const rows = f.ledger.read().records
  const report = { focus: 'cost', readOnly: true, sections: [{ section: 'execution', sourceId: 'execution:test', state: 'partial', records: rows }, { section: 'work', sourceId: 'work:test', state: 'partial', records: [{ sourceId: started.id, ...work }] }] }
  report.executionUsage = require('./executionUsage').buildExecutionUsage(report)
  const chain = report.executionUsage.chains.find(c => c.kind === 'worker_work')
  assert.equal(chain.observedRuns, 2); assert.equal(chain.observedRetryRuns, 1); assert.equal(chain.observedAttempts, 3)
  assert.equal(chain.canonicalRecordState, 'completed'); assert.equal(chain.canonicalRecordObserved, true)
  assert.equal(chain.runs.find(x => x.attempt === 1).hostOutcome.state, 'needs_attention')
  assert.equal(work.appliedToLive, null); assert.equal(work.loadedCommit, null)
  assert.equal(require('./workEvidence').projectWorkRecord(record, { kind: 'worker/runs', recordId: randomUUID() }).workerRuns.length, 0)
  for (const message of ['查用量', 'Show usage']) {
    const view = require('./executionUsageView').renderExecutionUsage(report, { message })
    assert.match(view.text, /development|開發工作/); assert.doesNotMatch(view.text, /PRIVATE SOURCE|\[missing/)
    assert.ok(view.references.some(r => r.recordId === started.id))
  }
})
test('architecture reports partial worker coverage and retains explicit unconnected billing', () => {
  const html = require('../core/operating/architectureView').buildArchitectureHtml()
  assert.match(html, /workerInvocation/); assert.match(html, /CLI/); assert.match(html, /WORKER-EXECUTION-EVIDENCE-V1/)
})
test('registered read adapter carries worker receipts into bilingual investigation without dispatch', async t => {
  const f = fixture(t), workerRoot = path.join(f.dir, 'worker-flow'), recordDir = path.join(workerRoot, 'project-runs')
  fs.mkdirSync(recordDir, { recursive: true })
  await withWorkerRun({ ...f, save: r => fs.writeFileSync(path.join(recordDir, r.id + '.json'), JSON.stringify(r)) }, async () => {
    await observeWorkerCall({ model: 'claude-sonnet' }, async dispatch => { dispatch(); return receipt }); f.record.state = 'failed'
  })
  const reader = require('./workRecords').createWorkReader({ workerRoot, repoRoot: f.dir })
  const adapter = require('../context/adapters/xiangxiangOperationsRead').createXiangxiangOperationsReadAdapter({ dataDir: f.dir, invocationReader: async () => f.ledger.read(), executionReader: async () => ({ state: 'ok', records: [] }), workReader: () => reader.read() })
  const snapshot = await adapter.methods.readInvestigation({ sections: ['execution', 'work', 'billing'] })
  const report = require('./intelligence').evaluateInvestigation({ focus: 'cost', sections: snapshot.results.map(x => ({ sourceId: x.sourceId, retrievedAt: x.retrievedAt, ...x.fields })) })
  const chain = report.executionUsage.chains.find(c => c.kind === 'worker_work')
  assert.ok(chain); assert.equal(chain.canonicalRecordState, 'failed'); assert.equal(chain.successfulResults, 1)
  assert.equal(chain.billingState, 'UNAVAILABLE'); assert.equal(chain.runs[0].hostOutcome.state, 'failed')
  for (const message of ['開發工作用了什麼模型及用量？', 'What model and usage did the development work report?']) {
    const view = require('./executionUsageView').renderExecutionUsage(report, { message })
    assert.ok(view.references.some(x => x.recordId === f.record.id)); assert.ok(view.references.some(x => x.fields.workerTrace))
    assert.doesNotMatch(view.text, /PRIVATE SOURCE/)
  }
  assert.equal(f.ledger.read().records.length, 1)
  const source=report.sections.find(s=>s.section==='work'), row=source.records.find(r=>r.sourceId===f.record.id)
  const original=structuredClone(row.workerRuns)
  row.workerRuns[0].state='completed'
  assert.equal(require('./executionUsage').buildExecutionUsage(report).chains.find(c=>c.kind==='worker_work').canonicalEvidenceState,'CONTRADICTED')
  row.workerRuns=original;row.sourceId=randomUUID()
  assert.equal(require('./executionUsage').buildExecutionUsage(report).chains.find(c=>c.kind==='worker_work').canonicalEvidenceState,'UNKNOWN')
})
