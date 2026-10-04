'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createSession, complete } = require('./codexClient')
const { validateInput } = require('./bridge')
const { CodexSubscriptionAdapter } = require('../adapters/CodexSubscriptionAdapter')

function fakeClient () {
  const calls = []; const events = new EventEmitter()
  let nextThread = 0; let closed = false
  return { calls, events, get closed () { return closed }, notify () {}, close () { closed = true; events.emit('failure', Error('closed')) },
    async request (method, params) {
      calls.push({ method, params })
      if (method === 'account/read') return { account: { type: 'chatgpt' } }
      if (method === 'model/list') return { data: [{ model: 'gpt-6-astra' }] }
      if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: 10 } } }
      if (method === 'config/read') return { config: {} }
      if (method === 'thread/start') return { model: 'gpt-6-astra', modelProvider: 'openai', thread: { id: String(++nextThread) } }
      if (method === 'mcpServerStatus/list') return { data: [] }
      if (method === 'turn/start') queueMicrotask(() => {
        events.emit('notification', { method: 'item/completed', params: { threadId: params.threadId, item: { type: 'agentMessage', text: 'ok' } } })
        events.emit('notification', { method: 'turn/completed', params: { threadId: params.threadId, turn: { status: 'completed' } } })
      })
      return {}
    } }
}

test('warm transport is reused but every answer has a fresh isolated thread and requested effort', async () => {
  const client = fakeClient(); let connects = 0
  const session = createSession({ connect: () => { connects++; return client } })
  try {
    for (const effort of ['low', 'medium', 'high']) await complete({ session, cwd: 'empty' }, { prompt: 'hello', effort })
    assert.equal(connects, 1)
    assert.equal(client.calls.filter(c => c.method === 'initialize').length, 1)
    assert.deepEqual(client.calls.filter(c => c.method === 'turn/start').map(c => c.params.effort), ['low', 'medium', 'high'])
    assert.equal(new Set(client.calls.filter(c => c.method === 'turn/start').map(c => c.params.threadId)).size, 3)
    assert.equal(client.calls.filter(c => c.method === 'account/rateLimits/read').length, 3)
    assert.equal(client.events.listenerCount('notification'), 0)
    assert.equal(client.closed, false)
  } finally { session.close() }
})

test('aborted or failed sessions close and the next request reconnects; no automatic replay', async () => {
  const clients = []
  const session = createSession({ connect: () => { const c = fakeClient(); clients.push(c); return c } })
  try {
    await assert.rejects(session.run(async () => { throw Error('failed') }), /failed/)
    assert.equal(clients[0].closed, true)
    await session.run(async () => 'ready')
    assert.equal(clients.length, 2)
    const controller = new AbortController()
    const run = session.run(() => new Promise(() => {}), controller.signal)
    controller.abort()
    await assert.rejects(run)
    assert.equal(clients[1].closed, true)
  } finally { session.close() }
})

test('concurrent use is refused and a timeout discards the connection', async () => {
  const client = fakeClient(); const session = createSession({ connect: () => client, timeoutMs: 20 })
  try {
    const run = session.run(() => new Promise(() => {}))
    await assert.rejects(session.run(async () => {}))
    await assert.rejects(run)
    assert.equal(client.closed, true)
  } finally { session.close() }
})

test('only five explicit effort levels can cross the bridge; adapter binds them', async () => {
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) assert.equal(validateInput({ prompt: 'x', effort }).effort, effort)
  for (const effort of ['ultra', '', null, {}, 'LOW']) assert.throws(() => validateInput({ prompt: 'x', effort }))
  let input
  const adapter = new CodexSubscriptionAdapter({ model: 'gpt-6-astra', effort: 'high', request: async (_, body) => { input = body; return { text: 'ok', model: 'gpt-6-astra', billing: 'chatgpt-subscription', stopReason: 'end_turn' } } })
  await adapter.complete('hello')
  assert.equal(input.effort, 'high')
})
