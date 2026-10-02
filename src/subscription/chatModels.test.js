'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { CHAT_MODELS } = require('./chatModels')
const { complete, preflight, listSubscriptionModels } = require('./codexClient')
const { createBridge } = require('./bridge')
const { CodexSubscriptionAdapter } = require('../adapters/CodexSubscriptionAdapter')

function fixture ({ available = CHAT_MODELS.map(m => m.model), returnedModel, effort = ['low', 'medium', 'high'], exhausted = false } = {}) {
  const events = new EventEmitter(); const calls = []
  return { events, calls, notify () {}, close () {}, async request (method, params) {
    calls.push({ method, params })
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'fixture' } }
    if (method === 'model/list') return { data: available.map(model => ({ model, supportedReasoningEfforts: effort.map(reasoningEffort => ({ reasoningEffort })) })) }
    if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: exhausted ? 100 : 10 } } }
    if (method === 'config/read') return { config: { mcp_servers: { unsafe: {} } } }
    if (method === 'thread/start') return { model: returnedModel || params.model, modelProvider: 'openai', thread: { id: 'test' } }
    if (method === 'mcpServerStatus/list') return { data: [] }
    if (method === 'turn/start') queueMicrotask(() => {
      events.emit('notification', { method: 'item/completed', params: { threadId: 'test', item: { type: 'agentMessage', text: 'fixture answer' } } })
      events.emit('notification', { method: 'turn/completed', params: { threadId: 'test', turn: { status: 'completed' } } })
    })
    return {}
  } }
}

test('account choices expose availability without spending quota or exposing account details', async () => {
  const rpc = fixture({ available: ['gpt-6-astra'], exhausted: true })
  const result = await listSubscriptionModels({ connect: () => rpc })
  assert.equal(result.defaultModel, 'gpt-6-astra')
  assert.deepEqual(result.models.map(m => [m.model, m.available]), CHAT_MODELS.map(m => [m.model, m.model === 'gpt-6-astra']))
  assert.deepEqual(result.models[0].efforts, [])
  assert.deepEqual(Object.keys(result).sort(), ['billing', 'defaultModel', 'models'])
  assert.equal(rpc.calls.some(c => ['thread/start', 'turn/start', 'account/rateLimits/read'].includes(c.method)), false)
})

test('every selectable model and effort reaches the exact isolated subscription turn', async () => {
  for (const { model } of CHAT_MODELS) {
    for (const effort of ['low', 'medium', 'high']) {
      const rpc = fixture()
      const result = await complete({ connect: () => rpc, cwd: 'empty' }, { prompt: 'fixture', model, effort })
      assert.equal(result.model, model); assert.equal(result.billing, 'chatgpt-subscription')
      const thread = rpc.calls.find(c => c.method === 'thread/start').params
      const turn = rpc.calls.find(c => c.method === 'turn/start').params
      assert.equal(thread.model, model); assert.equal(turn.model, model); assert.equal(turn.effort, effort)
      assert.equal(turn.serviceTierForTurn, 'default')
      assert.equal(thread.allowProviderModelFallback, false); assert.equal(thread.ephemeral, true)
      assert.equal(thread.config['mcp_servers.unsafe.enabled'], false)
      assert.deepEqual(thread.environments, [])
    }
  }
})

test('missing model, unsupported effort, exhausted capacity and provider substitution stop before a turn', async () => {
  for (const setting of [{ available: ['gpt-6-astra'] }, { effort: ['high'] }, { exhausted: true }, { returnedModel: 'gpt-6-astra' }]) {
    const rpc = fixture(setting)
    await assert.rejects(complete({ connect: () => rpc }, { prompt: 'fixture', model: 'gpt-6.1-sol', effort: 'low' }))
    assert.equal(rpc.calls.some(c => c.method === 'turn/start'), false)
  }
  const rpc = fixture()
  await assert.rejects(preflight(rpc, { model: 'other' }))
  assert.equal(rpc.calls.length, 0)
})

test('pagination checks exact requested model; incomplete catalogues cannot imply availability', async () => {
  const rpc = fixture(); const request = rpc.request.bind(rpc)
  rpc.request = async (method, params) => method === 'model/list'
    ? params.cursor ? { data: [{ model: 'gpt-6.1-sol' }] } : { data: [{ model: 'gpt-6-astra' }], nextCursor: 'next' }
    : request(method, params)
  assert.equal((await preflight(rpc, { model: 'gpt-6.1-sol' })).model, 'gpt-6.1-sol')
  rpc.request = async (method, params) => method === 'model/list' ? { data: [], nextCursor: 'forever' } : request(method, params)
  await assert.rejects(listSubscriptionModels({ connect: () => rpc }))
})

test('adapter preflight and completion bind selection and reject a mismatched response', async () => {
  const calls = []; let returned = 'gpt-6.1-sol'
  const adapter = new CodexSubscriptionAdapter({ model: returned, effort: 'medium', request: async (route, body) => {
    calls.push({ route, body }); return { text: 'ok', model: returned, billing: 'chatgpt-subscription', stopReason: 'end_turn' }
  } })
  await adapter.preflight(); await adapter.complete('fixture')
  assert.deepEqual(calls[0].body, { model: 'gpt-6.1-sol', effort: 'medium' })
  assert.equal(calls[1].body.model, 'gpt-6.1-sol'); assert.equal(calls[1].body.effort, 'medium')
  returned = 'gpt-6-astra'
  await assert.rejects(adapter.complete('fixture'), /subscription_invalid_output/)
})

test('authenticated bridge accepts only bounded chat choices and keeps credit policy host-owned', async t => {
  let selection; let calls = 0; let modelReads = 0
  const token = 'e'.repeat(64)
  const server = createBridge({ token, clientOptions: { allowCredits: true }, checkFn: async opts => { selection = opts; return { model: opts.model } },
    modelsFn: async () => { modelReads++; return { models: [] } }, completeFn: async (_, input) => { calls++; return { model: input.model } } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const send = (route, body, extra = {}) => fetch('http://127.0.0.1:' + server.address().port + route, { method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) })
  assert.equal((await send('/models', {}, { origin: 'https://invalid.test' })).status, 401)
  assert.equal(modelReads, 0)
  assert.equal((await send('/models', {})).status, 200); assert.equal(modelReads, 1)
  assert.equal((await send('/status', { model: 'gpt-6.1-sol', effort: 'high' })).status, 200)
  assert.equal(selection.model, 'gpt-6.1-sol'); assert.equal(selection.allowCredits, true)
  assert.equal((await send('/complete', { prompt: 'fixture', model: 'other' })).status, 503)
  assert.equal((await send('/complete', { prompt: 'fixture', model: 'gpt-6.1-sol', allowCredits: true })).status, 503)
  assert.equal(calls, 0)
  assert.equal((await send('/complete', { prompt: 'fixture', model: 'gpt-6.1-sol' })).status, 200)
})
