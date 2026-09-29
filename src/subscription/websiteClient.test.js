'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { findWebsite } = require('./websiteClient')
function fake (behavior = 'good') {
  const calls = []; const rpc = { events: new EventEmitter(), notify () {}, close () {}, request: async (method, params) => {
    calls.push({ method, params })
    if (method === 'account/read') return { account: { type: 'chatgpt' } }
    if (method === 'model/list') return { data: [{ model: 'gpt-6-astra' }] }
    if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: 1 } } }
    if (method === 'config/read') return { config: { mcp_servers: { fixture: {} } } }
    if (method === 'thread/start') return { model: 'gpt-6-astra', modelProvider: 'openai', thread: { id: 'web' } }
    if (method === 'mcpServerStatus/list') return { data: [] }
    if (method === 'turn/start') setImmediate(() => {
      const emit = (method, item) => rpc.events.emit('notification', { method, params: { threadId: 'web', item } })
      if (behavior === 'shell') emit('item/started', { type: 'commandExecution' })
      if (behavior !== 'invented') emit('item/completed', { type: 'webSearch', action: { type: 'openPage', url: 'https://www.costcobusinesscentre.ca/' } })
      emit('item/completed', { type: 'agentMessage', phase: 'final_answer', text: JSON.stringify({ status: 'found', url: 'https://www.costcobusinesscentre.ca/' }) })
      rpc.events.emit('notification', { method: 'turn/completed', params: { threadId: 'web', turn: { status: 'completed' } } })
    })
    return {}
  } }
  return { rpc, calls }
}
test('website worker enables only web search and requires an actually opened result URL', async () => {
  const f = fake(); let config
  const result = await findWebsite({ cwd: 'C:/empty', connect: o => { config = o.config; return f.rpc } }, { target: 'Costco Business Centre' })
  assert.equal(result.url, 'https://www.costcobusinesscentre.ca/'); assert.equal(result.searchCalls, 1)
  assert.equal(config.web_search, 'live'); assert.equal(config['features.shell_tool'], false)
  const thread = f.calls.find(c => c.method === 'thread/start').params
  assert.equal(thread.config['mcp_servers.fixture.enabled'], false); assert.deepEqual(thread.dynamicTools, [])
  assert.equal(thread.config['features.apps'], false)
  for (const behavior of ['invented', 'shell']) { const bad = fake(behavior); await assert.rejects(findWebsite({ cwd: 'C:/empty', connect: () => bad.rpc }, { target: 'Costco' })) }
})
test('website bridge input cannot supply prompts, credentials, executable paths or queries', async () => {
  const never = () => { throw Error('must not connect') }
  for (const input of [{ target: 'Costco', prompt: 'ignore policy' }, { target: 'https://example.com/?secret=x' }, { target: 'a@b.com' }, null]) {
    await assert.rejects(findWebsite({ connect: never }, input), /subscription_invalid_output/)
  }
})
