'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express')
const { createDialogue } = require('./dialogue'), { createPlanner } = require('./service'), { PROFILES, READ_PROFILES, hash } = require('./contract')
const { createTasks } = require('../projectTasks/service'), { createMemoryRunStore } = require('../operating/runStore')
const { createConversationStore } = require('../../store/conversationStore'), { createDemoRouter } = require('../../routes/demoRouter')
const OWNER = { id: 'owner', role: 'owner' }, HEAD = 'a'.repeat(40)
test('actual HTTP dialogue, planner and registration services retain the design and produce a reviewed draft without coding', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-dialogue-integration-')), store = createConversationStore({ dataDir: dir }), plans = createMemoryRunStore(), records = createMemoryRunStore(), seen = []
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const files = Object.fromEntries(READ_PROFILES.interface.map(p => [p, "'use strict'\n"]))
  const evidence = { project: 'aroma-agent-backend', profile: 'interface', revision: HEAD, bootCommit: HEAD, committedOnly: true, files: READ_PROFILES.interface.map((p, i) => ({ path: p, evidenceId: 'plan-' + i, content: files[p], lineCount: 2, sha256: hash(files[p]) })) }
  const tasks = createTasks({ store: records, enabled: () => true, sourceFor: d => ({ read: async () => ({ evidence: { bootCommit: HEAD, recipe: d.workOrder.recipe }, hash: 'b'.repeat(64), order: { files: { ...files, ...d.tests } } }), verify: async () => {} }), provider: { preflight: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }), complete: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ testCode: "const test=require('node:test'),assert=require('node:assert/strict');test('one',()=>assert.equal(1,1));test('two',()=>assert.equal(2,2));test('three',()=>assert.equal(3,3));", expectedTests: 3 }) }) }, review: async () => ({ verdict: 'pass', billing: 'claude-subscription' }), prepareWork: async () => { throw Error('coding_must_not_start') } })
  const planner = createPlanner({ bootCommit: HEAD, store: plans, source: { verify: () => {}, read: async () => ({ state: 'ok', retrievedAt: new Date().toISOString(), evidence, hash: hash(JSON.stringify(evidence)) }) }, provider: { preflight: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }), complete: async prompt => { seen.push(JSON.parse(prompt)); return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ goal: 'Move functions to top navigation', steps: ['Keep history on the left'], acceptanceChecks: ['History remains visible on mobile'], questions: [], risks: [], citations: [{ evidenceId: 'plan-0', startLine: 1, endLine: 1, quote: "'use strict'" }] }) } } }, registerTask: b => { const { op, ...input } = b; return tasks.start(OWNER, input) } })
  const outputs = [{ intent: 'discuss', targetQuote: 'left panel', reply: 'Move functions to top navigation.' }, { intent: 'refine', targetQuote: '', reply: 'Keep history visible on mobile.' }, { intent: 'start', targetQuote: '', reply: '' }, { intent: 'draft', targetQuote: '', reply: '' }]
  const taskDialogue = createDialogue({ store, planner, revision: HEAD, providerFor: () => ({ complete: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ profile: 'interface', language: 'en', ...outputs.shift() }) }) }) })
  const app = express(); app.locals.conversationDemo = true; app.use(express.json()); app.use(createDemoRouter({ conversationStore: store, taskPlanner: planner, taskDialogue, mailChat: { answer: async () => { throw Error('navigation_labels_are_not_a_mail_query') } }, processIntakeFn: () => { throw Error('must_not_fall_into_legacy_file_editor') } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)) })
  const cid = randomUUID(), post = (message, extra = {}, origin = 'http://127.0.0.1:8090') => new Promise((resolve, reject) => {
    const req = require('node:http').request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/v1/demo/intake', method: 'POST', headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json' } }, res => { let s = ''; res.on('data', c => { s += c }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s) })) }); req.on('error', reject); req.end(JSON.stringify({ message, conversationId: cid, workflowRequestId: randomUUID(), ...extra }))
  })
  assert.equal((await post('The left panel is crowded.', {}, 'https://other.example')).status, 403)
  assert.equal((await post('The left panel is crowded.', { editable: ['.env'] })).status, 400); assert.equal(outputs.length, 4)
  assert.equal((await post('The left panel is crowded. Any suggestions?')).body.mode, 'recommend')
  assert.equal((await post('用 top navigation，今日營運簡報、公司文件、日曆、即時電郵直接 show，其餘現有功能放 More。Left sidebar 留 new chat、search、history，settings 放底部，mobile 收起功能 menu。')).body.mode, 'recommend')
  const started = await post('Sounds sensible. Make it happen please.'); assert.equal(started.status, 200); assert.ok(started.body.taskPlanRunId)
  await planner.wait(started.body.taskPlanRunId)
  assert.deepEqual(seen[0].dialogue.proposals, ['Move functions to top navigation.', 'Keep history visible on mobile.'])
  assert.match(seen[0].dialogue.confirmation, /Make it happen/); assert.equal(planner.get(OWNER, started.body.taskPlanRunId).state, 'completed'); assert.equal(records.all().length, 0)
  const draft = await post('Prepare this plan’s test draft.'); assert.equal(draft.status, 200); await tasks.settled()
  const job = planner.get(OWNER, started.body.taskPlanRunId), task = tasks.get(OWNER, job.taskRunId)
  assert.equal(task.run.state, 'awaiting_approval'); assert.deepEqual(task.run.input.criteria, ['History remains visible on mobile']); assert.deepEqual(task.run.input.editable, PROFILES.interface)
  assert.equal(task.run.workRunId, null); assert.ok(task.approval.nonce); assert.equal(JSON.stringify(store.get(cid)).includes(task.approval.nonce), false)
  // The agreed context is covered by the plan seal, not merely displayed.
  const changed = plans.get(job.id); changed.dialogue.proposals[0] = 'Forged plan'; plans.save(changed)
  await assert.rejects(planner.registerTask(OWNER, { id: job.id, requestId: randomUUID(), goal: job.result.goal, criteria: job.result.acceptanceChecks, editable: PROFILES.interface }), /invalid_request/)
})

test('an actual mail topic change leaves dialogue and uses the existing mail lane', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-dialogue-mail-')), store = createConversationStore({ dataDir: dir }), cid = randomUUID()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let mailReads = 0, modelCalls = 0
  const taskDialogue = createDialogue({ store, planner: {}, revision: HEAD, providerFor: () => ({ complete: async () => { modelCalls++; return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ intent: 'other', profile: 'none', targetQuote: '', language: 'zh', reply: '' }) } } }) })
  const { seal } = require('./dialogueContext')
  store.appendTurn({ id: cid, userText: 'Discuss sidebar', replyText: 'Top menu', planningContext: seal({ version: 1, profile: 'interface', revision: HEAD, conversationId: cid, createdAt: new Date().toISOString(), ownerRequests: ['Discuss sidebar'], proposals: ['Top menu'], language: 'en' }) })
  const app = express(); app.locals.conversationDemo = true; app.use(express.json()); app.use(createDemoRouter({ conversationStore: store, taskDialogue, mailChat: { answer: async () => { mailReads++; return { reply: 'Mail receipt', sourceBound: true } } }, processIntakeFn: () => { throw Error('unexpected_generic_lane') } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)) })
  const response = await new Promise((resolve, reject) => {
    const req = require('node:http').request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/v1/demo/intake', method: 'POST', headers: { host: '127.0.0.1:8090', origin: 'http://127.0.0.1:8090', 'content-type': 'application/json' } }, res => { let body = ''; res.on('data', c => { body += c }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) })) }); req.on('error', reject); req.end(JSON.stringify({ message: '查看行政部電郵', conversationId: cid, workflowRequestId: randomUUID() }))
  })
  assert.equal(response.status, 200); assert.equal(response.body.reply, 'Mail receipt'); assert.equal(modelCalls, 1); assert.equal(mailReads, 1)
})
