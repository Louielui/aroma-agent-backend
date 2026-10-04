'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { DEFAULT_MODEL } = require('./chatModels'), { MODEL, complete, listSubscriptionModels } = require('./codexClient')
const { CodexSubscriptionAdapter } = require('../adapters/CodexSubscriptionAdapter'), { PROFILES, profileFor } = require('../intake/chatSpeed')
const { validateInput, createBridge } = require('./bridge'), { EventEmitter } = require('node:events')
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
function rpcFixture (efforts = LEVELS) {
  const calls = [], events = new EventEmitter()
  return { calls, events, notify () {}, close () {}, async request (method, params) {
    calls.push({ method, params })
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'fixture' } }
    if (method === 'model/list') return { data: [{ model: 'gpt-6.1-sol', supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort })) }] }
    if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: 1 } } }
    if (method === 'config/read') return { config: {} }
    if (method === 'thread/start') return { model: params.model, modelProvider: 'openai', thread: { id: 'fixture' } }
    if (method === 'mcpServerStatus/list') return { data: [] }
    if (method === 'turn/start') queueMicrotask(() => {
      events.emit('notification', { method: 'item/completed', params: { threadId: params.threadId, item: { type: 'agentMessage', text: 'fixture answer' } } })
      events.emit('notification', { method: 'turn/completed', params: { threadId: params.threadId, turn: { status: 'completed' } } })
    })
    return {}
  } }
}
test('chat defaults are Sol 6.1 and Medium without migrating non-chat transport workloads', async () => {
  assert.equal(DEFAULT_MODEL, 'gpt-6.1-sol'); assert.equal(MODEL, 'gpt-6-astra')
  assert.deepEqual(profileFor(), { level: 'medium', effort: 'medium' })
  const calls = [], adapter = new CodexSubscriptionAdapter({ request: async (route, input) => { calls.push({ route, input }); return { model: input.model, text: 'fixture', stopReason: 'end_turn', billing: 'chatgpt-subscription' } } })
  await adapter.preflight(); await adapter.complete('hello')
  assert.deepEqual(calls[0].input, { model: 'gpt-6.1-sol', effort: 'medium' }); assert.equal(calls[1].input.model, 'gpt-6.1-sol'); assert.equal(calls[1].input.effort, 'medium')
})
test('all five canonical choices and legacy aliases preserve the exact requested effort across adapter, bridge and turn', async () => {
  assert.deepEqual(Object.keys(PROFILES), LEVELS)
  for (const level of LEVELS) {
    const rpc = rpcFixture()
    const adapter = new CodexSubscriptionAdapter({ effort: profileFor(level).effort, request: async (route, input) => complete({ connect: () => rpc, cwd: 'fixture' }, validateInput(input)) })
    const result = await adapter.complete('fixture'); assert.equal(result.model, 'gpt-6.1-sol')
    const turn = rpc.calls.find(c => c.method === 'turn/start').params
    assert.equal(turn.effort, level); assert.equal(turn.model, 'gpt-6.1-sol'); assert.deepEqual(turn.environments, [])
  }
  for (const [old, effort] of [['fast', 'low'], ['standard', 'medium'], ['deep', 'high']]) assert.deepEqual(profileFor(old), { level: effort, effort })
  for (const value of ['none', 'minimal', 'ultra', 'constructor', {}, null]) assert.throws(() => profileFor(value))
})
test('catalogue exposes five supported levels but unavailable efforts cannot silently become another level', async () => {
  const rpc = rpcFixture(), catalog = await listSubscriptionModels({ connect: () => rpc })
  assert.equal(catalog.defaultModel, 'gpt-6.1-sol'); assert.deepEqual(catalog.models[0].efforts, LEVELS)
  assert.equal(rpc.calls.some(c => c.method === 'turn/start'), false)
  const limited = rpcFixture(['low', 'medium', 'high'])
  await assert.rejects(complete({ connect: () => limited }, { prompt: 'fixture', model: DEFAULT_MODEL, effort: 'max' }), /subscription_model_unavailable/)
  assert.equal(limited.calls.some(c => c.method === 'turn/start'), false)
})
test('composer exposes exactly five localized options with Medium selected and a Sol 6.1 initial model', () => {
  const { buildDemoHtml } = require('../demo/demoHtml'), html = buildDemoHtml(), { CATALOGUE } = require('../i18n/catalogue')
  const select = html.match(/<select id="chat-level"[^>]*>([\s\S]*?)<\/select>/)[1]
  assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map(m => m[1]), LEVELS)
  assert.match(select, /value="medium" selected/); assert.match(html, /var chatModel = 'gpt-6\.1-sol'/)
  for (const key of ['chat.low', 'chat.medium', 'chat.high', 'chat.xhigh', 'chat.max']) { assert.ok(CATALOGUE[key]?.zh); assert.ok(CATALOGUE[key]?.en) }
  for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1])
  const source = fs.readFileSync(path.join(__dirname, '../demo/assets/app.js'), 'utf8')
  for (const level of LEVELS) assert.ok(source.includes("['chat-level-" + level + "', 'text'"))
})
test('authenticated status accepts all five efforts before completion and rejects values outside the closed set', async t => {
  const token = 'b'.repeat(64), seen = [], server = createBridge({ token, checkFn: async input => { seen.push(input.effort); return { model: input.model, billing: 'chatgpt-subscription' } } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  for (const effort of LEVELS) {
    const r = await fetch('http://127.0.0.1:' + server.address().port + '/status', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-6.1-sol', effort }) })
    assert.equal(r.status, 200); assert.equal((await r.json()).model, 'gpt-6.1-sol')
  }
  for (const effort of ['ultra', 'none', 'minimal', '', null, {}]) {
    const r = await fetch('http://127.0.0.1:' + server.address().port + '/status', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-6.1-sol', effort }) })
    assert.equal(r.status, 400)
  }
  assert.deepEqual(seen, LEVELS)
})
