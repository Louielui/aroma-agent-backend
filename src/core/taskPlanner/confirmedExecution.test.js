'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { createPlanner } = require('./service'), { READ_PROFILES, hash, PROFILES } = require('./contract')
const { createMemoryRunStore } = require('../operating/runStore')
const { createTasks } = require('../projectTasks/service'), { definition } = require('../projectTasks/contract')
const OWNER = { id: 'owner', role: 'owner' }, HEAD = 'a'.repeat(40)
async function fixture (options = {}) {
 const browser=['zh','en'].flatMap(locale=>[1280,390].map(width=>({name:`browser-${locale}-${width}.png`,engine:'edge-headless-offline-v1',browserVersion:'Edg/154.0',locale,width,height:900,failedReads:locale==='zh'&&width===390,pageHash:'a'.repeat(64),screenshotHash:'b'.repeat(64),screenshotBytes:2000,checks:Object.fromEntries(['startup','labels','fiveDepths','mediumDefault','solDefault','layout','keyboard','picker','chatScope','explicitConfirmation','noPageErrors','onlyFixtureRequests'].map(k=>[k,true])),routes:['/demo']})))

  const store = createMemoryRunStore(), tasks = createMemoryRunStore(), calls = [], workId = randomUUID()
  const evidence = { project: 'aroma-agent-backend', profile: 'interface', revision: HEAD, bootCommit: HEAD, committedOnly: true, files: READ_PROFILES.interface.map((path, i) => ({ path, evidenceId: 'plan-' + i, content: "'use strict'\n", lineCount: 2, sha256: hash("'use strict'\n") })) }
  const packet = () => ({ state: 'ok', retrievedAt: new Date().toISOString(), evidence, hash: hash(JSON.stringify(evidence)) })
  const generated = { testCode: "const test=require('node:test'),assert=require('node:assert/strict');", expectedTests: 3 }
  let work = null, definitionValue, workService
  const taskService = createTasks({ store: tasks, enabled: () => true, sourceFor: d => ({ read: async () => ({ evidence: { revision: HEAD }, hash: 'b'.repeat(64), order: { files: Object.fromEntries(READ_PROFILES.interface.map(f => [f, "'use strict'\n"])) } }), verify: async () => {} }),
    provider: { preflight: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }), complete: async () => { if (options.draft) await options.draft(); return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify(generated) } } },
    review: async () => ({ verdict: options.rejectReview ? 'changes_requested' : 'pass', billing: 'claude-subscription' }),
    prepareWork: async input => {
      if (workService) return workService.prepare(OWNER, input)
      definitionValue = definition(taskService.find(OWNER, { requestId: tasks.all()[0].requestId }).run.id, tasks.all()[0].input, generated)
      work = { id: workId, workflow: 'project_work', requestId: input.requestId, state: 'awaiting_approval', workOrder: definitionValue.workOrder, source: { evidence: { revision: HEAD } }, approvalHash: 'c'.repeat(64), steps: [], startedAt: new Date().toISOString() }
      return { run: structuredClone(work), approval: { id: workId, hash: work.approvalHash, nonce: 'secret-once', expiresAt: new Date(Date.now() + 60000).toISOString() } }
    } })
  const taskRpc = async b => { calls.push('task:' + b.op); const { op, ...input } = b; if (options.rpc) await options.rpc(b); const v = op === 'get' ? taskService.get(OWNER, b.id) : op === 'cancel' ? taskService.cancel(OWNER, b.id) : await taskService[op](OWNER, input); if (op === 'start') await taskService.settled(); return v }
  if (options.realWorkService) {
    const registry = require('../projectTasks/contract').createRegistry(tasks)
    workService = require('../projectWork/service').createProjectWork({ store: createMemoryRunStore(), enabled: () => true, resolveRecipe: registry.resolve,
      source: { read: async (revision, signal, recipe) => ({ evidence: { revision: HEAD, bootCommit: HEAD }, hash: 'e'.repeat(64), order: { ...registry.resolve(recipe).workOrder, files: Object.fromEntries(PROFILES.interface.map(f => [f, 'old'])) } }), verify: async () => {} },
      providers: { isolation: async () => ({ ready: true }), status: async () => ({ codex: { ready: true }, claude: { ready: true } }),
        codeOrder: async ({ order }) => {
          const changes = order.allowedFiles.map(file => ({ file, before: 'old', after: 'new', beforeHash: hash('old'), afterHash: hash('new') }))
          return { changes, changedFiles: order.allowedFiles, patchHash: hash(JSON.stringify(changes)), model: 'gpt-6.1-sol', effort: 'high', billing: 'chatgpt-subscription', execution: 'windows_sandbox_offline', appliedToLive: false, baseline: { total: 7, failed: 1 }, tests: { total: 7, passed: 7, failed: 0, skipped: 0, cancelled: 0, exitCode: 0, browser } }
        }, reviewOrder: async () => ({ verdict: 'pass', billing: 'claude-subscription' }) }
    })
  }
  const workRpc = async b => {
    calls.push('work:' + b.op)
    if (workService) { const { op, ...input } = b; return { run: op === 'approve' ? workService.approve(OWNER, input) : op === 'cancel' ? workService.cancel(OWNER, b.id) : workService.get(OWNER, b.id) } }
    if (b.op === 'approve') { assert.equal(b.nonce, 'secret-once'); work.state = 'coding'; if (options.onCode) options.onCode(); if (!options.keepCoding) { work.state = 'completed'; work.result = { changes: [], tests: { total: 7, passed: 7, failed: 0, skipped: 0, cancelled: 0 } }; work.review = { verdict: 'pass', billing: 'claude-subscription' } } }
    if (b.op === 'cancel') work.state = 'cancelled'; return { run: structuredClone(work) }
  }
  const args = { bootCommit: HEAD, store, executionRpc: { task: taskRpc, work: workRpc }, executionPollMs: 1,
    source: { verify: () => {}, read: async () => packet() }, registerTask: taskRpc,
    provider: { preflight: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }), complete: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ goal: options.goal || 'Put navigation above chat; preserve history', steps: ['Move navigation'], acceptanceChecks: ['History retains its own scroll region'], questions: [], risks: [], citations: [{ evidenceId: 'plan-0', startLine: 1, endLine: 1, quote: "'use strict'" }] }) }) } }
  const service = createPlanner(args), run = service.start(OWNER, { message: 'plan Xiangxiang sidebar', requestId: randomUUID(), conversationId: 'chat-' + randomUUID() }); await service.wait(run.id)
  const input = { id: run.id, requestId: randomUUID(), planHash: service.get(OWNER, run.id).planHash }
  return { service, store, tasks, calls, evidence, input, rebuild: () => createPlanner(args), taskService }
}
test('one explicit plan confirmation runs real task approval and coding; reading or planning alone never executes', async () => {
  const f = await fixture(); assert.deepEqual(f.calls, [])
  assert.equal(f.service.get(OWNER, f.input.id).executionAvailable, true)
  const started = await f.service.executeConfirmed(OWNER, f.input)
  assert.equal(started.run.execution.consent.scope, 'isolated_development_and_tests')
  await f.service.waitExecution(f.input.id)
  const r = f.service.get(OWNER, f.input.id)
  assert.equal(r.execution.state, 'completed', JSON.stringify(r.execution)); assert.equal(r.execution.appliedToLive, false)
  assert.deepEqual(f.tasks.all()[0].input.editable, PROFILES.interface)
  assert.deepEqual(f.tasks.all()[0].input.criteria, r.result.acceptanceChecks)
  assert.equal(f.tasks.all()[0].state, 'registered')
  assert.equal(f.calls.filter(c => c === 'work:approve').length, 1)
  assert.equal(JSON.stringify(f.store.all()).includes('secret-once'), false)
  assert.ok(r.execution.steps.some(s => s.stage === 'coding_authorized'))
  assert.ok(r.execution.previousChildSteps.some(s => s.stage === 'drafting'))
  assert.ok(r.execution.previousChildSteps.some(s => s.stage === 'reviewing'))
  await f.service.executeConfirmed(OWNER, f.input)
  assert.equal(f.calls.filter(c => c === 'task:start').length, 1)
  await assert.rejects(f.service.executeConfirmed(OWNER, { ...f.input, requestId: randomUUID() }), /request_conflict/)
})
test('the exact Owner top-functions request crosses HTTP into a visible plan and one confirmed sealed work chain', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express')
  const message = '我想把頂端的功能由右上搬到左上', goal = 'Move top functions from right to left; preserve their order and history'
  const f = await fixture({ realWorkService: true, goal }), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-navigation-http-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const conversationStore = require('../../store/conversationStore').createConversationStore({ dataDir: dir }), cid = randomUUID()
  const outputs = [{ intent: 'start', targetQuote: '頂端的功能' }, { intent: 'start', targetQuote: '' }]
  const taskDialogue = require('./dialogue').createDialogue({ store: conversationStore, planner: f.service, revision: HEAD, providerFor: () => ({ complete: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ profile: 'interface', language: 'zh', reply: '', ...outputs.shift() }) }) }) })
  const app = express(); app.locals.conversationDemo = true; app.use(express.json()); app.use(require('../../routes/demoRouter').createDemoRouter({ conversationStore, taskPlanner: f.service, taskDialogue, processIntakeFn: () => { throw Error('must_not_enter_plain_chat_or_file_editor') } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)) })
  const post = text => new Promise((resolve, reject) => {
    const req = require('node:http').request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/v1/demo/intake', method: 'POST', headers: { host: '127.0.0.1:8090', origin: 'http://127.0.0.1:8090', 'content-type': 'application/json' } }, res => {
      let body = ''; res.on('data', c => { body += c }); res.on('end', () => { try { assert.equal(res.statusCode, 200); resolve(JSON.parse(body)) } catch (e) { reject(e) } })
    }); req.on('error', reject); req.end(JSON.stringify({ message: text, conversationId: cid, workflowRequestId: randomUUID() }))
  })
  const first = await post(message); assert.ok(first.taskPlanRunId)
  await f.service.wait(first.taskPlanRunId)
  const plan = f.service.get(OWNER, first.taskPlanRunId)
  assert.equal(plan.state, 'completed'); assert.equal(plan.result.goal, goal); assert.deepEqual(plan.dialogue.ownerRequests, [message]); assert.equal(plan.executionAvailable, true)
  assert.deepEqual(f.calls, []); assert.equal(conversationStore.get(cid).messages.at(-1).taskPlanRunId, plan.id)
  const started = await post('好，開始'); assert.equal(started.taskPlanRunId, plan.id)
  await f.service.waitExecution(plan.id)
  const completed = f.service.get(OWNER, plan.id)
  assert.equal(completed.execution.state, 'completed'); assert.equal(completed.execution.child.result.changes.length, 2)
  assert.equal(f.calls.filter(c => c === 'work:approve').length, 1); assert.deepEqual(f.tasks.all()[0].input.editable, PROFILES.interface)
  assert.equal(completed.execution.appliedToLive, false)
})
test('foreign actors, altered plan hash, injected fields and source drift never reach workers', async () => {
  const f = await fixture()
  await assert.rejects(f.service.executeConfirmed({ id: 'ivy', role: 'member' }, f.input), /permission_denied/)
  await assert.rejects(f.service.executeConfirmed(OWNER, { ...f.input, planHash: '0'.repeat(64) }), /evidence_changed/)
  await assert.rejects(f.service.executeConfirmed(OWNER, { ...f.input, editable: ['.env'] }), /invalid_request/)
  f.evidence.revision = 'b'.repeat(40); f.evidence.bootCommit = 'b'.repeat(40)
  await assert.rejects(f.service.executeConfirmed(OWNER, f.input), /evidence_changed/)
  assert.deepEqual(f.calls, [])
})
test('review rejection stops the chain without coding or automatic retry', async () => {
  const f = await fixture({ rejectReview: true }); await f.service.executeConfirmed(OWNER, f.input); await f.service.waitExecution(f.input.id)
  assert.equal(f.service.get(OWNER, f.input.id).execution.state, 'needs_attention')
  assert.equal(f.calls.includes('task:approve'), false); assert.equal(f.calls.includes('work:approve'), false)
})
test('concurrent confirmations cannot issue two starts; uncertain dispatch is not replayed', async () => {
  const f = await fixture({ rpc: async b => { if (b.op === 'start') throw Error('connection lost') } })
  const results = await Promise.allSettled([f.service.executeConfirmed(OWNER, f.input), f.service.executeConfirmed(OWNER, f.input)])
  assert.ok(results.some(v => v.status === 'fulfilled')); await f.service.waitExecution(f.input.id)
  const r = f.service.get(OWNER, f.input.id); assert.equal(r.execution.state, 'needs_attention')
  assert.equal(r.execution.reason, 'outcome_unconfirmed')
  await f.service.executeConfirmed(OWNER, f.input); assert.equal(f.calls.filter(c => c === 'task:start').length, 1)
})
test('cancel reaches the active worker and restart never resumes delegated consent', async () => {
  let codeStarted; const coding = new Promise(r => { codeStarted = r })
  const f = await fixture({ keepCoding: true, onCode: codeStarted }); await f.service.executeConfirmed(OWNER, f.input); await coding
  await f.service.cancelExecution(OWNER, f.input.id); await f.service.waitExecution(f.input.id)
  assert.equal(f.service.get(OWNER, f.input.id).execution.state, 'cancelled'); assert.equal(f.calls.includes('work:cancel'), true)
  const saved = f.store.get(f.input.id); saved.execution.state = 'coding'; f.store.save(saved)
  const before = f.calls.length; const next = f.rebuild(); assert.equal(next.get(OWNER, f.input.id).execution.state, 'interrupted'); assert.equal(f.calls.length, before)
})

test('planner, test registration, registry, sealed work approvals and development compose with controlled providers', async () => {
  const f = await fixture({ realWorkService: true })
  await f.service.executeConfirmed(OWNER, f.input); await f.service.waitExecution(f.input.id)
  const r = f.service.get(OWNER, f.input.id)
  assert.equal(r.execution.state, 'completed', JSON.stringify(r.execution))
  assert.equal(r.execution.child.result.changes.length, 2)
  assert.equal(r.execution.child.result.tests.passed, 7)
  assert.equal(r.execution.child.steps.filter(s => s.stage === 'approved').length, 1)
  assert.equal(r.execution.child.steps.find(s => s.stage === 'approved').facts.actor, 'owner')
  assert.equal(r.execution.appliedToLive, false)
})

test('refreshing an old plan preserves the goal context and requires new confirmation', async () => {
  const f = await fixture(), old = f.store.get(f.input.id)
  old.evidence.bootCommit = 'b'.repeat(40); f.store.save(old)
  assert.equal(f.service.get(OWNER, old.id).executionStale, true)
  const next = f.service.replan(OWNER, { id: old.id, requestId: randomUUID() }); await f.service.wait(next.run.id)
  assert.notEqual(next.run.id, old.id); assert.equal(f.store.get(old.id).updatedPlanRunId, next.run.id)
  assert.equal(f.service.get(OWNER, next.run.id).executionStale, false); assert.deepEqual(f.calls, [])
  assert.equal(f.service.replan(OWNER, { id: old.id, requestId: randomUUID() }).run.id, next.run.id)
})
