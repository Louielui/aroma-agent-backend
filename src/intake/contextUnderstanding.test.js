'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { runWebsiteFlow } = require('./websiteFlow')

test('a narrow website classifier cannot terminate unresolved self or contextual requests', async () => {
  for (const message of ['給我你的網址', '在browser也能看的網址', '照上次，給我連結', '這三位的網站呢？']) {
    const events = []
    const out = await runWebsiteFlow({ message, classify: async () => ({ intent: 'clarify', target: '', requestedOutput: 'website_url' }), search: () => assert.fail('unexpected public search'), record: e => events.push(e) })
    assert.equal(out, null, message)
    if (require('./websiteIntent').candidate(message)) {
      assert.equal(events.at(-1).state, 'not_applicable')
      assert.equal(events.at(-1).reason, 'requires_full_understanding')
    }
  }
})

test('website interpretation preserves several owner turns without using assistant claims as targets', async () => {
  const history = [{ role: 'user', content: 'Compare Costco Business Centre and Wholesale Club' }, { role: 'assistant', content: 'Invented Merchant SECRET' }, { role: 'user', content: 'Use the first one' }]
  const out = await runWebsiteFlow({ message: '給我剛才那個的網址', history,
    classify: async prompt => { assert.match(prompt, /Costco Business Centre/); assert.match(prompt, /Use the first one/); assert.doesNotMatch(prompt, /SECRET/); return { intent: 'navigate', target: 'Costco Business Centre', requestedOutput: 'website_url' } },
    search: async target => { assert.equal(target, 'Costco Business Centre'); return { status: 'found', url: 'https://www.costcobusinesscentre.ca/', searchCalls: 1 } } })
  assert.equal(out.website.state, 'completed')
})

test('self location uses the observed socket, with explicit unknown remote access', () => {
  const { runtimeSelfBlock } = require('../governance/selfDescription')
  const block = runtimeSelfBlock({ address: '127.0.0.1', port: 19451 })
  assert.match(block, /http:\/\/127\.0\.0\.1:19451\/demo/)
  assert.match(block, /same device only/i)
  assert.match(block, /remote.*unknown/i)
  assert.doesNotMatch(runtimeSelfBlock({ address: 'evil.test', port: 8090 }), /http/)
  assert.doesNotMatch(runtimeSelfBlock(), /8090|8081/)
})

async function withChat(t, options = {}) {
  const saved = { ...process.env }
  Object.assign(process.env, { CHAT_BACKEND: 'codex-subscription', XIANGXIANG_WEBSITE_FLOW: 'on', READ_ACCESS: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on', TURN_ROUTER: 'on', A4_KNOWLEDGE_ROUTING: 'off', GOAL_DECOMPOSER: 'off', DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off', XIANGXIANG_MEMORY: 'off', LLM_LANGUAGE_MODE: 'off' })
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved) })
  const express = require('express'), { createDemoRouter } = require('../routes/demoRouter'), { processIntake } = require('./intakeService')
  const app = express(); app.use(express.json()); app.locals.conversationDemo = true
  const calls = []
  const adapter = { preflight: async () => {}, complete: async (prompt, opts) => {
    calls.push({ prompt, opts })
    if (opts.responseFormat?.name === 'website_intent') return { text: JSON.stringify({ intent: 'clarify', target: '', requestedOutput: 'website_url' }), model: 'fixture' }
    return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: 'Fixture answer', nextRead: null }), model: 'fixture', billing: 'chatgpt-subscription' }
  } }
  app.use(createDemoRouter({ getAdapterFn: () => ({ complete: () => assert.fail('legacy provider') }), conversationStore: options.conversationStore,
    processIntakeFn: (m, a, h, o) => options.process ? options.process(m, a, h, o) : processIntake(m, a, h, { ...o, openaiAdapter: adapter, ...options.intake }) }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const root = 'http://127.0.0.1:' + server.address().port
  return { calls, root, send: body => fetch(root + '/api/v1/demo/intake', { method: 'POST', headers: { 'content-type': 'application/json', host: 'forged.example', 'x-forwarded-host': 'forged.example' }, body: JSON.stringify(body) }) }
}

test('HTTP self follow-up reaches the ordinary brain with persisted context and observed deployment', async t => {
  const messages = [{ role: 'user', content: '給我你的網址' }, { role: 'assistant', content: '你想開啟哪個網站？' }]
  const chat = await withChat(t, { conversationStore: { get: () => ({ messages }), appendTurn: () => {} } })
  const response = await chat.send({ message: '在browser也能看的網址', conversationId: 'context-case-001', history: [] })
  assert.equal(response.status, 200)
  const result = await response.json(); assert.equal(result.reply, 'Fixture answer'); assert.equal(result.website, undefined)
  const answer = chat.calls.find(c => c.opts.invocationPhase === 'answer')
  assert.ok(answer); assert.match(answer.prompt, /給我你的網址/); assert.match(answer.prompt, new RegExp(chat.root.replaceAll('.', '\\.') + '/demo'))
  assert.doesNotMatch(answer.prompt, /forged\.example/)
})

test('HTTP prior history retains intentional repetitions and appends the current turn once', async t => {
  const message = 'repeat-owner-turn-marker'
  const history = [{ role: 'user', text: message }, { role: 'assistant', text: 'first acknowledgement' }, { role: 'user', text: message }, { role: 'assistant', text: 'second acknowledgement' }]
  const chat = await withChat(t, { conversationStore: { get: () => null, appendTurn: () => {} } })
  const response = await chat.send({ message, conversationId: 'repeat-history-case', history })
  assert.equal(response.status, 200)
  const prompt = chat.calls.find(c => c.opts.invocationPhase === 'answer').prompt
  assert.equal(prompt.split(message).length - 1, 3)
  assert.ok(prompt.indexOf('first acknowledgement') < prompt.indexOf('second acknowledgement'))
})

test('HTTP completed website result owns topic-switch rendering without a file clarification', async t => {
  const fixture = require('./fixtures/contextIntegrationReplay.json').topicSwitch
  const { workRequestClarification, ...response } = fixture.response
  assert.ok(workRequestClarification, 'the retained failing envelope includes the masking card')
  const chat = await withChat(t, { process: async () => response })
  const result = await (await chat.send({ message: fixture.message })).json()
  assert.equal(result.website.url, response.website.url)
  assert.ok(result.reply.includes(response.website.url))
  assert.equal(result.workRequestClarification, undefined)
  assert.equal(result.workRequestOffer, undefined)
})

test('unreadable persisted context is a visible failure before models, not fabricated empty history', async t => {
  const chat = await withChat(t, { conversationStore: { get: () => { throw Error('private-path-secret') } } })
  const response = await chat.send({ message: '這三位呢？', conversationId: 'context-case-002' })
  assert.equal(response.status, 503); assert.match(JSON.stringify(await response.json()), /conversation_context_unavailable/)
  assert.equal(chat.calls.length, 0)
})

test('memory failures remain owner-visible even when the model ignores the advisory', async t => {
  const chat = await withChat(t, { intake: { memoryClient: { recall: async () => { throw Error('private-provider-secret') } } } })
  process.env.XIANGXIANG_MEMORY = 'on'; process.env.CONTEXT_DECISIONS_OPENAI = 'on'
  const response = await chat.send({ message: '照上次的偏好回答' })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.ok(result.contextFailures.includes('memory_unavailable')); assert.notEqual(result.reply, 'Fixture answer')
  assert.doesNotMatch(JSON.stringify(result), /private-provider-secret/)
})

test('HTTP references retain assistant-listed entities, owner corrections and prior scope without dispatch', async t => {
  for (const [message, messages, expected] of [
    ['給我你的網址', [], 'SELF DEPLOYMENT'],
    ['這三位，先比較經驗', [{ role: 'user', content: 'Compare the shortlisted applicants' }, { role: 'assistant', content: 'Candidate Alpha, Candidate Beta, Candidate Gamma' }], 'Candidate Gamma'],
    ['照上次格式，先準備', [{ role: 'user', content: 'Use a two-column comparison and do not send anything' }, { role: 'assistant', content: 'Understood' }], 'do not send anything'],
    ['剛才第二位，改成星期五', [{ role: 'user', content: 'Candidate Alpha and Candidate Beta' }, { role: 'assistant', content: 'Both proposed Thursday' }], 'Candidate Beta']
  ]) {
    const chat = await withChat(t, { conversationStore: { get: () => ({ messages }), appendTurn: () => {} } })
    const response = await chat.send({ message, conversationId: 'context-case-003', history: [{ role: 'user', text: 'browser history must not replace saved scope' }] })
    assert.equal(response.status, 200)
    const answer = chat.calls.find(c => c.opts.invocationPhase === 'answer')
    assert.ok(answer); assert.ok(answer.prompt.includes(expected), message)
    assert.doesNotMatch(answer.prompt, /browser history must not replace/)
  }
})

test('legacy decision memory failure is reported without exposing exception text', async t => {
  const denied = () => { throw Error('private-store-secret') }
  const chat = await withChat(t, { intake: { decisionRecallDeps: { listDecisionsFn: denied, listTasksFn: denied }, conversationRecallDeps: { dir: 'unused', readFileSync: denied } } })
  process.env.DECISION_RECALL = 'on'; process.env.CONTEXT_DECISIONS_OPENAI = 'on'
  const response = await chat.send({ message: '照上次決定的格式' })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.ok(result.contextFailures.includes('decision_memory_unavailable'))
  assert.doesNotMatch(JSON.stringify(result), /private-store-secret/)
})

test('website model and tool errors identify their failed stage without generic questions or secrets', async () => {
  const base = { message: 'Open Costco website', search: () => assert.fail('unexpected search') }
  const modelFailure = await runWebsiteFlow({ ...base, classify: () => { throw Error('private-model-secret') } })
  assert.equal(modelFailure.website.reason, 'classification_failed'); assert.equal(modelFailure.website.stage, 'classification')
  assert.doesNotMatch(JSON.stringify(modelFailure), /private-model-secret|哪個網站/)
  const toolFailure = await runWebsiteFlow({ ...base, classify: () => ({ intent: 'navigate', target: 'Costco', requestedOutput: 'website_url' }), search: () => { throw Error('private-tool-secret') } })
  assert.equal(toolFailure.website.reason, 'website_lookup_failed'); assert.equal(toolFailure.website.stage, 'search')
  assert.doesNotMatch(JSON.stringify(toolFailure), /private-tool-secret|哪個網站/)
})

test('an unreadable legacy archive is unavailable rather than an empty memory', () => {
  assert.throws(() => require('../lab/conversationRecall').readRecords(__dirname), /conversation_archive_unavailable/)
})

test('legacy conversation memory failure reaches the owner without exception text', async t => {
  const chat = await withChat(t, { intake: { conversationRecallDeps: { readRecordsFn: () => { throw Error('private-archive-secret') } } } })
  process.env.CONVERSATION_RECALL = 'on'
  const response = await chat.send({ message: '剛才之前的對話呢？' })
  assert.equal(response.status, 200)
  const result = await response.json(); assert.ok(result.contextFailures.includes('conversation_memory_unavailable'))
  assert.doesNotMatch(JSON.stringify(result), /private-archive-secret/)
})
