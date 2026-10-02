'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { preflight, threadParams, cleanEnvironment, SubscriptionError, complete, checkSubscription } = require('./codexClient')

function rpc (overrides = {}) {
  const calls = []
  const replies = {
    'account/read': { account: { type: 'chatgpt', planType: 'pro' } },
    'model/list': { data: [{ model: 'gpt-6-astra' }], nextCursor: null },
    'account/rateLimits/read': { rateLimits: { primary: { usedPercent: 12 } } },
    ...overrides
  }
  return { calls, request: async (name) => { calls.push(name); return replies[name] } }
}
test('subscription preflight accepts a ChatGPT account and the exact available model', async () => {
  const r = rpc()
  assert.deepEqual(await preflight(r), { model: 'gpt-6-astra', billing: 'chatgpt-subscription', planType: 'pro' })
  assert.equal(r.calls.includes('turn/start'), false)
})
test('API-key authentication is refused before a model can run', async () => {
  const r = rpc({ 'account/read': { account: { type: 'apiKey' } } })
  await assert.rejects(preflight(r), e => e instanceof SubscriptionError && e.code === 'subscription_login_required')
  assert.deepEqual(r.calls, ['account/read'])
})
test('exhausted and unknown quota stop; no paid fallback', async () => {
  for (const limits of [{ rateLimits: { primary: { usedPercent: 100 } } }, {}]) {
    const r = rpc({ 'account/rateLimits/read': limits })
    await assert.rejects(preflight(r), SubscriptionError)
    assert.equal(r.calls.includes('turn/start'), false)
  }
})
test('available purchased credits require explicit Owner opt-in and preserve ChatGPT billing', async () => {
  const limits = { rateLimits: { primary: { usedPercent: 100 }, credits: { hasCredits: true, unlimited: false, balance: null }, spendControlReached: false, rateLimitReachedType: null } }
  await assert.rejects(preflight(rpc({ 'account/rateLimits/read': limits })), /subscription_limit_reached/)
  const r = rpc({ 'account/rateLimits/read': limits })
  assert.deepEqual(await preflight(r, { allowCredits: true }), { model: 'gpt-6-astra', billing: 'chatgpt-subscription', planType: 'pro', usageMode: 'credits_available' })
  assert.equal(r.calls.includes('turn/start'), false)
  assert.equal(r.calls.includes('account/rateLimitResetCredit/consume'), false)
})
test('credits never override actual spend controls, depleted balance, individual caps or unknown state', async () => {
  const base = { primary: { usedPercent: 100 }, credits: { hasCredits: true, unlimited: false, balance: '20' }, spendControlReached: false, rateLimitReachedType: null }
  for (const patch of [
    { spendControlReached: true }, { spendControlReached: null }, { spendControlReached: undefined },
    { credits: null }, { credits: { hasCredits: false, unlimited: false, balance: null } },
    { credits: { hasCredits: true, unlimited: false, balance: '0' } },
    { credits: { hasCredits: true, unlimited: false, balance: 'unknown' } },
    { individualLimit: { remainingPercent: 0 } }, { individualLimit: {} },
    ...['workspace_owner_credits_depleted', 'workspace_member_credits_depleted', 'workspace_owner_usage_limit_reached', 'workspace_member_usage_limit_reached', 'unknown_limit'].map(rateLimitReachedType => ({ rateLimitReachedType }))
  ]) {
    const r = rpc({ 'account/rateLimits/read': { rateLimits: { ...base, ...patch } } })
    await assert.rejects(preflight(r, { allowCredits: true }), SubscriptionError)
    assert.equal(r.calls.includes('turn/start'), false)
  }
  await assert.rejects(preflight(rpc({ 'account/rateLimits/read': { rateLimits: { ...base, primary: null } } }), { allowCredits: true }), SubscriptionError)
  await assert.rejects(preflight(rpc({ 'account/rateLimits/read': { rateLimits: base, rateLimitsByLimitId: { another: base } } }), { allowCredits: true }), SubscriptionError)
  await assert.rejects(preflight(rpc({ 'account/rateLimits/read': { rateLimits: base } }), { allowCredits: 'true' }), SubscriptionError)
  for (const patch of [{ spendControlReached: true }, { individualLimit: { remainingPercent: 0 } }, { rateLimitReachedType: 'workspace_owner_usage_limit_reached' }]) {
    await assert.rejects(preflight(rpc({ 'account/rateLimits/read': { rateLimits: { ...base, ...patch, primary: { usedPercent: 10 } } } }), { allowCredits: true }), SubscriptionError)
  }
})
test('fresh codex bucket wins over legacy credits and no-credit ordinary quota still works', async () => {
  const available = { primary: { usedPercent: 100 }, credits: { hasCredits: true, unlimited: false, balance: '10' }, spendControlReached: false }
  const blocked = { ...available, spendControlReached: true }
  await assert.rejects(preflight(rpc({ 'account/rateLimits/read': { rateLimits: available, rateLimitsByLimitId: { codex: blocked } } }), { allowCredits: true }), SubscriptionError)
  assert.equal((await preflight(rpc(), { allowCredits: true })).billing, 'chatgpt-subscription')
  const result = await preflight(rpc({ 'account/rateLimits/read': { rateLimits: { ...available, individualLimit: { remainingPercent: 25 }, rateLimitReachedType: 'rate_limit_reached' } } }), { allowCredits: true })
  assert.equal(result.usageMode, 'credits_available')
})
test('missing requested model never silently substitutes another model', async () => {
  await assert.rejects(preflight(rpc({ 'model/list': { data: [{ model: 'gpt-6-sol' }] } })), /subscription_model_unavailable/)
})
test('each completion is ephemeral and has no execution environment or dynamic tools', () => {
  const p = threadParams('C:\\empty', 'persona')
  assert.equal(p.model, 'gpt-6-astra')
  assert.equal(p.modelProvider, 'openai')
  assert.equal(p.allowProviderModelFallback, false)
  assert.equal(p.ephemeral, true)
  assert.deepEqual(p.environments, [])
  assert.deepEqual(p.selectedCapabilityRoots, [])
  assert.deepEqual(p.dynamicTools, [])
  assert.equal(p.config['features.shell_tool'], false)
  assert.equal(p.config['features.hooks'], false)
})
test('child environment has no provider API keys, inherited Node hooks or alternate endpoint', () => {
  const result = cleanEnvironment({ SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\User', OPENAI_API_KEY: 'secret', ANTHROPIC_API_KEY: 'secret', OPENAI_BASE_URL: 'http://other', NODE_OPTIONS: '--require hostile', PATH: 'path' })
  assert.deepEqual(result, { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\User', PATH: 'path' })
})

test('completion disables configured MCPs and returns only the final answer', async () => {
  const base = rpc()
  const events = new EventEmitter()
  const calls = []
  let closed = false
  const client = { events, notify () {}, close () { closed = true }, async request (method, params) {
    calls.push({ method, params })
    if (method === 'config/read') return { config: { mcp_servers: { local: {} } } }
    if (method === 'thread/start') return { model: 'gpt-6-astra', modelProvider: 'openai', thread: { id: 'thread' } }
    if (method === 'mcpServerStatus/list') return { data: [] }
    if (method === 'turn/start') {
      queueMicrotask(() => {
        events.emit('notification', { method: 'item/completed', params: { threadId: 'thread', item: { type: 'agentMessage', phase: 'final_answer', text: '{"reply":"ok"}' } } })
        events.emit('notification', { method: 'turn/completed', params: { threadId: 'thread', turn: { status: 'completed' } } })
      })
      return {}
    }
    return base.request(method)
  } }
  const schema = { type: 'object' }
  const result = await complete({ cwd: 'empty', connect: () => client }, { prompt: 'context', system: 'persona', schema })
  assert.equal(result.billing, 'chatgpt-subscription')
  assert.equal(result.text, '{"reply":"ok"}')
  assert.equal(calls.find(c => c.method === 'thread/start').params.config['mcp_servers.local.enabled'], false)
  assert.equal(calls.find(c => c.method === 'mcpServerStatus/list').params.threadId, 'thread')
  assert.deepEqual(calls.find(c => c.method === 'turn/start').params.outputSchema, schema)
  assert.equal(closed, true)
})

test('an advertised execution tool prevents any model turn', async () => {
  const base = rpc()
  let turns = 0
  let closed = false
  const client = { events: new EventEmitter(), notify () {}, close () { closed = true }, async request (method) {
    if (method === 'config/read') return { config: {} }
    if (method === 'thread/start') return { model: 'gpt-6-astra', modelProvider: 'openai', thread: { id: 'thread' } }
    if (method === 'mcpServerStatus/list') return { data: [{ tools: { run: {} } }] }
    if (method === 'turn/start') turns++
    return base.request(method)
  } }
  await assert.rejects(complete({ cwd: 'empty', connect: () => client }, { prompt: 'x' }), SubscriptionError)
  assert.equal(turns, 0)
  assert.equal(closed, true)
})

test('status and completion use the host credit policy, and recheck depleted credits before any turn', async () => {
  let hasCredits = true; let turns = 0
  const options = { cwd: 'empty', allowCredits: true, connect: () => {
    const events = new EventEmitter()
    return { events, notify () {}, close () {}, async request (method) {
      if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: 100 }, credits: { hasCredits, unlimited: false, balance: null }, spendControlReached: false } }
      if (method === 'config/read') return { config: {} }
      if (method === 'thread/start') return { model: 'gpt-6-astra', modelProvider: 'openai', thread: { id: 'credit-thread' } }
      if (method === 'mcpServerStatus/list') return { data: [] }
      if (method === 'turn/start') {
        turns++
        queueMicrotask(() => {
          events.emit('notification', { method: 'item/completed', params: { threadId: 'credit-thread', item: { type: 'agentMessage', phase: 'final_answer', text: 'ok' } } })
          events.emit('notification', { method: 'turn/completed', params: { threadId: 'credit-thread', turn: { status: 'completed' } } })
        })
        return {}
      }
      return rpc().request(method)
    } }
  } }
  assert.equal((await checkSubscription(options)).usageMode, 'credits_available'); assert.equal(turns, 0)
  const result = await complete(options, { prompt: 'fixture' })
  assert.equal(result.billing, 'chatgpt-subscription'); assert.equal(result.usageMode, 'credits_available'); assert.equal(turns, 1)
  hasCredits = false
  await assert.rejects(complete(options, { prompt: 'fixture' }), /subscription_limit_reached/); assert.equal(turns, 1)
})
