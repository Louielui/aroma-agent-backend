'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createConversationStore } = require('../../store/conversationStore')
const { createDialogue } = require('./dialogue')
const REV = 'a'.repeat(40), OWNER = { id: 'owner', role: 'owner' }
const decision = (intent, reply, extra = {}) => ({ intent, profile: 'interface', targetQuote: '', language: 'en', reply, ...extra })
function fixture(t, outputs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-dialogue-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createConversationStore({ dataDir: dir }), calls = [], starts = [], runs = new Map(), drafts = [], cancels = []
  const planner = { start(actor, input) { const r = { id: randomUUID(), ...input, state: 'queued', profile: 'interface' }; starts.push(input); runs.set(r.id, r); return r },
    get(actor, id) { return runs.get(id) }, cancel(actor, id) { cancels.push(id); runs.get(id).state = 'cancelled'; return runs.get(id) },
    async registerTask(actor, input) { drafts.push(input); const r = runs.get(input.id); r.taskRunId = randomUUID(); return { run: r } } }
  const providerFor = () => ({ complete: async (prompt, opts) => { calls.push({ body: JSON.parse(prompt), opts }); const v = outputs.shift(); return typeof v === 'function' ? v() : { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify(v) } } })
  const service = createDialogue({ store, planner, revision: REV, providerFor })
  const cid = randomUUID(), send = (message, extra = {}, actor = OWNER) => service.handle(actor, { message, conversationId: cid, requestId: randomUUID(), effort: 'medium', model: 'gpt-6.1-sol', ...extra })
  return { service, store, planner, calls, starts, runs, drafts, cancels, cid, send }
}

test('displayed plan confirmations use the bound job without another model interpretation', async t => {
  for (const message of ['好，可以開始', '好，開始吧', '好，照這個方案做', 'Okay, go ahead', 'Yes, please proceed']) {
    const f = fixture(t, [decision('start', '', { targetQuote: 'sidebar' })])
    const first = await f.send('Improve sidebar'), run = f.runs.get(first.taskPlanRunId)
    Object.assign(run, { state: 'completed', executionAvailable: true, planHash: 'b'.repeat(64), result: { goal: 'Move navigation', questions: [] } })
    let executions = 0
    f.planner.executeConfirmed = async (actor, input) => { assert.equal(input.planHash, run.planHash); executions++; run.execution = { state: 'drafting' }; return { run } }
    const response = await f.send(message)
    assert.equal(executions, 1); assert.equal(f.calls.length, 1); assert.equal(response.taskPlanRunId, run.id)
    const repeated = await f.send(message)
    assert.equal(executions, 1); assert.equal(f.calls.length, 1); assert.equal(repeated.taskPlanRunId, run.id)
  }
})

test('confirmation after a stopped job reports its recorded failure without retry or interpretation', async t => {
  const f = fixture(t, [decision('start', '', { targetQuote: 'sidebar' })])
  const first = await f.send('Improve sidebar'), run = f.runs.get(first.taskPlanRunId)
  Object.assign(run, { state: 'completed', execution: { state: 'needs_attention', reason: 'worker_timeout' } })
  const response = await f.send('好，開始')
  assert.match(response.reply, /timed out|超時/); assert.equal(response.taskPlanRunId, run.id)
  assert.equal(f.calls.length, 1); assert.equal(f.starts.length, 1)
})

test('a stored plan remains readable after dialogue context expires, and cross-conversation jobs stay closed', async t => {
  const f = fixture(t, [decision('start', '', { targetQuote: 'sidebar' })])
  const first = await f.send('Improve sidebar'), run = f.runs.get(first.taskPlanRunId)
  Object.assign(run, { state: 'completed', executionAvailable: true, executionStale: true })
  f.store.appendTurn({ id: f.cid, userText: 'Status', replyText: 'Plan ready', taskPlanRunId: run.id })
  const response = await f.send('Go ahead')
  assert.equal(response.taskPlanRunId, run.id); assert.match(response.reply, /changed|更新|變更/)
  assert.equal(f.calls.length, 1)
  run.conversationId = randomUUID()
  await assert.rejects(f.send('Go ahead'), /invalid_request/)
  assert.equal(f.starts.length, 1)
})

test('an unsupported request can be narrowed into a new plan without starting its old work', async t => {
  const f = fixture(t, [decision('start', '', { targetQuote: 'sidebar' }), decision('refine', 'Only adjust the sidebar spacing.')])
  const first = await f.send('Improve sidebar'), run = f.runs.get(first.taskPlanRunId)
  Object.assign(run, { state: 'out_of_scope', result: { capability: { status: 'unsupported', explanation: 'Backend storage is unavailable.' } } })
  await f.send('好，開始')
  assert.equal(f.calls.length, 1); assert.equal(f.starts.length, 1)
  const next = await f.send('Only adjust the spacing; leave topic storage for later.')
  assert.notEqual(next.taskPlanRunId, run.id); assert.equal(f.starts.length, 2)
  assert.match(f.starts[1].dialogue.ownerRequests.at(-1), /Only adjust/)
  assert.equal(f.drafts.length, 0)
})

test('a current plain confirmation of a completed plan starts its bounded execution in Chinese and English', async t => {
  for (const message of ['好，開始', '確認並開始', '很好,開始改良', 'Confirm and start', 'Go ahead']) {
    const f = fixture(t, [decision('start', '', { targetQuote: 'sidebar' }), decision('start', '')])
    const first = await f.send('Improve the sidebar'), run = f.runs.get(first.taskPlanRunId), calls = []
    Object.assign(run, { state: 'completed', executionAvailable: true, planHash: 'b'.repeat(64), result: { goal: 'Top navigation', questions: [] } })
    f.planner.executeConfirmed = async (a, input) => { calls.push(input); run.execution = { state: 'queued' }; return { run } }
    const response = await f.send(message)
    assert.equal(calls.length, 1); assert.equal(calls[0].planHash, run.planHash); assert.equal(response.taskPlanRunId, run.id); assert.equal(f.starts.length, 1)
  }
})

test('a model start classification cannot turn negated, quoted or changed instructions into execution consent', async t => {
  for (const message of ['不要開始', '"Go ahead"', 'If I say go ahead, what happens?', 'Go ahead and change the login too']) {
    const f = fixture(t, [decision('start', '', { targetQuote: 'sidebar' }), decision('start', '')])
    const first = await f.send('Improve the sidebar'), run = f.runs.get(first.taskPlanRunId)
    Object.assign(run, { state: 'completed', executionAvailable: true, planHash: 'b'.repeat(64), result: { goal: 'Top navigation', questions: [] } })
    let executions = 0; f.planner.executeConfirmed = async () => { executions++ }
    await f.send(message); assert.equal(executions, 0)
  }
})
test('multilingual discussion carries the actual proposal and Owner refinements into planning', async t => {
  const f = fixture(t, [decision('discuss', 'Move functions to the top; keep history on the left.', { targetQuote: 'left panel' }), decision('refine', 'Use a compact top menu on mobile.'), decision('start', '')])
  const advice = await f.send('The left panel is crowded. Any suggestions?'); assert.equal(advice.servedBy, 'gpt-6.1-sol')
  await f.send('手機上收起，keep the history visible please.')
  const response = await f.send('Sounds sensible. Please take it forward.')
  assert.ok(response.taskPlanRunId); assert.equal(f.starts.length, 1)
  const context = f.starts[0].dialogue
  assert.deepEqual(context.ownerRequests, ['The left panel is crowded. Any suggestions?', '手機上收起，keep the history visible please.'])
  assert.match(context.proposals.join('\n'), /Move functions to the top/)
  assert.equal(context.confirmation, 'Sounds sensible. Please take it forward.')
  assert.equal(f.calls[2].body.context.profile, 'interface'); assert.equal(f.drafts.length, 0)
  const saved = f.store.get(f.cid); assert.equal(saved.messages.at(-1).taskPlanRunId, response.taskPlanRunId)
  assert.equal(saved.messages.at(-1).planningContext.digest, context.contextDigest)
})
test('English, Chinese and mixed follow-ups use semantic decisions, not confirmation keywords', async t => {
  for (const [question, confirmation, language] of [['Can you rethink the sidebar?', 'Make that happen please', 'en'], ['側欄太擠，怎樣安排？', '就用你剛才那個安排', 'zh'], ['sidebar 太擠了，有咩 suggestion?', 'Okay，照這個 layout 做', 'zh']]) {
    const f = fixture(t, [decision('discuss', 'A compact navigation layout.', { targetQuote: question.includes('sidebar') ? 'sidebar' : '側欄', language }), decision('start', '', { language })])
    await f.send(question); const r = await f.send(confirmation)
    assert.ok(r.taskPlanRunId); assert.equal(f.starts[0].dialogue.language, language)
  }
})
test('negation and discussion never dispatch; cancellation clears the continuation', async t => {
  const f = fixture(t, [decision('discuss', 'Top navigation.', { targetQuote: 'sidebar' }), decision('discuss', 'We can discuss alternatives.'), decision('cancel', ''), decision('start', '')])
  await f.send('Discuss the sidebar'); await f.send('Do not start yet; what are the alternatives?')
  assert.equal(f.starts.length, 0)
  await f.send('Forget this change'); const r = await f.send('Please improve the sidebar now')
  assert.equal(r.taskPlanRunId, undefined); assert.equal(f.starts.length, 0)
})
test('forged target, expanded scope, extra schema authority and another actor cannot start work', async t => {
  const f = fixture(t, [decision('start', '', { targetQuote: 'sidebar' }), { ...decision('start', '', { targetQuote: 'sidebar' }), approval: true }])
  const r = await f.send('Change the chat page')
  assert.equal(r.taskPlanRunId, undefined); assert.equal(f.starts.length, 0)
  await assert.rejects(f.send('Improve sidebar'), /invalid_worker_result/)
  await assert.rejects(f.send('Improve sidebar', {}, { id: 'ivy', role: 'manager' }), /permission_denied/)
  assert.equal(f.calls.length, 2)
})
test('HTTP replay uses one interpretation and one job; repeat start reads back that same job', async t => {
  const f = fixture(t, [decision('start', '', { targetQuote: 'sidebar' }), decision('start', '')])
  const requestId = randomUUID(), first = await f.send('Please redesign the sidebar', { requestId })
  const replay = await f.send('Please redesign the sidebar', { requestId })
  assert.deepEqual(replay, first); assert.equal(f.calls.length, 1); assert.equal(f.starts.length, 1)
  const repeat = await f.send('Go ahead please'); assert.equal(repeat.taskPlanRunId, first.taskPlanRunId); assert.equal(f.starts.length, 1)
  await assert.rejects(f.send('Different request', { requestId }), /request_conflict/)
})
test('completed plan hands off its criteria and fixed files only on explicit draft intent', async t => {
  const f = fixture(t, [decision('start', '', { targetQuote: 'sidebar' }), decision('status', ''), decision('draft', '')])
  const r = await f.send('Improve the sidebar'), plan = f.runs.get(r.taskPlanRunId)
  Object.assign(plan, { state: 'completed', result: { goal: 'Top navigation', acceptanceChecks: ['History has the full sidebar height'], questions: [] } })
  await f.send('How far along are you?'); assert.equal(f.drafts.length, 0)
  const draft = await f.send('Prepare the tests for this plan, please')
  assert.equal(f.drafts.length, 1); assert.equal(f.drafts[0].goal, 'Top navigation')
  assert.deepEqual(f.drafts[0].editable, ['src/demo/assets/sidebar.js', 'src/demo/assets/sidebar.css'])
  assert.deepEqual(f.drafts[0].criteria, ['History has the full sidebar height']); assert.ok(draft.taskPlanRunId)
})
test('conversation changes during interpretation invalidate the result before starting work', async t => {
  let release
  const f = fixture(t, [() => new Promise(resolve => { release = resolve })])
  const pending = f.send('Improve sidebar')
  while (!release) await new Promise(r => setImmediate(r))
  f.store.appendTurn({ id: f.cid, userText: 'Stop', replyText: 'Stopped' })
  release({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify(decision('start', '', { targetQuote: 'sidebar' })) })
  await assert.rejects(pending, /conversation_changed/); assert.equal(f.starts.length, 0)
})

test('context is revision, age, conversation and content bound; a copied receipt cannot authorize another conversation', async t => {
  const { validContext, seal } = require('./dialogueContext')
  const f = fixture(t, [decision('discuss', 'Top menu.', { targetQuote: 'sidebar' })])
  await f.send('Suggest a sidebar layout')
  const c = f.store.get(f.cid).messages.at(-1).planningContext
  assert.equal(validContext(c, REV, f.cid), true)
  assert.equal(validContext(c, 'b'.repeat(40), f.cid), false)
  assert.equal(validContext(c, REV, randomUUID()), false)
  assert.equal(validContext({ ...c, proposals: ['Forged approval'] }, REV, f.cid), false)
  assert.equal(validContext(seal({ ...c, createdAt: new Date(Date.now() - 31 * 60000).toISOString() }), REV, f.cid), false)
  const other = randomUUID()
  f.store.appendTurn({ id: other, userText: 'hello', replyText: 'hello', planningContext: c })
  assert.equal(f.store.get(other).messages.at(-1).planningContext, undefined)
})

test('durable receipts prevent replay across service restart, including uncertain draft dispatch', async t => {
  const { createRunStore } = require('../operating/runStore')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-dialogue-receipts-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createConversationStore({ dataDir: dir }), receipts = createRunStore({ dir: path.join(dir, 'receipts'), workflow: 'dialogue_request' })
  let calls = 0
  const options = { store, receipts, revision: REV, planner: {}, providerFor: () => ({ complete: async () => { calls++; return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify(decision('discuss', 'Top navigation.', { targetQuote: 'sidebar' })) } } }) }
  const input = { message: 'Discuss sidebar', conversationId: randomUUID(), requestId: randomUUID() }
  const first = await createDialogue(options).handle(OWNER, input)
  assert.deepEqual(await createDialogue(options).handle(OWNER, input), first); assert.equal(calls, 1)
  const row = receipts.get(input.requestId); delete row.response; row.state = 'draft_requested'; receipts.save(row)
  await assert.rejects(createDialogue(options).handle(OWNER, input), /request_conflict/); assert.equal(calls, 1)
})

test('clarification answers replan with retained requirements instead of asking again', async t => {
  const f = fixture(t, [decision('start', '', { targetQuote: 'sidebar' }), decision('refine', 'Use top navigation and keep history visible.')])
  const first = await f.send('Improve sidebar')
  Object.assign(f.runs.get(first.taskPlanRunId), { state: 'needs_clarification', result: { questions: ['Where should functions go?'] } })
  const next = await f.send('Move functions to the top; keep history on the left.')
  assert.notEqual(next.taskPlanRunId, first.taskPlanRunId)
  assert.deepEqual(f.starts[1].dialogue.ownerRequests, ['Improve sidebar', 'Move functions to the top; keep history on the left.'])
})

test('request language is isolated from other concurrent dialogue replies', async () => {
  const { t } = require('../../i18n/t')
  assert.match(t('dialogue.notStarted', undefined, 'en'), /no job has started/)
  assert.match(t('dialogue.notStarted', undefined, 'zh'), /尚未建立/)
  assert.match(t('dialogue.notStarted', undefined, 'en'), /no job has started/)
})

test('refinements after a completed plan cannot silently draft its obsolete criteria', async t => {
  const f = fixture(t, [decision('start', '', { targetQuote: 'sidebar' }), decision('refine', 'Use only Calendar at the top.'), decision('draft', '')])
  const r = await f.send('Improve sidebar'), plan = f.runs.get(r.taskPlanRunId)
  Object.assign(plan, { state: 'completed', result: { goal: 'Top navigation', acceptanceChecks: ['Show four functions'], questions: [] } })
  await f.send('Change that: show only Calendar at the top.')
  const updated = await f.send('Prepare the tests for this updated design')
  assert.equal(f.drafts.length, 0); assert.equal(f.starts.length, 2); assert.notEqual(updated.taskPlanRunId, plan.id)
  assert.equal(f.starts[1].dialogue.ownerRequests.at(-1), 'Change that: show only Calendar at the top.')
})
