'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { complete, checkSubscription, listModels } = require('./claudeClient')
const envelope = text => ({ type: 'result', subtype: 'success', is_error: false, result: text, modelUsage: { 'claude-sonnet-4-6': {} } })
test('Claude uses subscription auth, bounded stdin, disabled tools and the selected effort', async () => {
  const calls = [], run = async (args, options) => { calls.push({ args, options }); return args.includes('status') ? { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' } : envelope('Hello') }
  const r = await complete({ run }, { model: 'claude-sonnet', effort: 'medium', prompt: 'Hello', system: 'Answer in English.' })
  assert.equal(r.billing, 'claude-subscription'); assert.equal(r.model, 'claude-sonnet'); assert.equal(r.actualModel, 'claude-sonnet-4-6')
  assert.equal(calls.length, 2); assert.ok(calls[1].args.includes('--restricted'))
  assert.equal(calls[1].args[calls[1].args.indexOf('--tools') + 1], '')
  assert.equal(calls[1].args[calls[1].args.indexOf('--effort') + 1], 'medium')
  assert.ok(calls[1].options.input.includes('Hello')); assert.ok(!calls[1].args.includes('Answer in English.'))
})
test('Claude refuses API auth, failed or substituted results; no fallback calls', async () => {
  await assert.rejects(checkSubscription({ run: async () => ({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }) }), /subscription_login_required/)
  for (const bad of [{ ...envelope('x'), is_error: true }, { ...envelope('x'), modelUsage: { 'claude-opus-4-6': {} } }, envelope('')]) {
    let n = 0
    await assert.rejects(complete({ run: async args => { n++; return args.includes('status') ? { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' } : bad } }, { model: 'claude-sonnet', prompt: 'hi' }))
    assert.equal(n, 2)
  }
})
test('Claude availability read never generates a completion and unavailable auth stays visible', async () => {
  let n = 0; const r = await listModels({ run: async args => { n++; assert.ok(args.includes('status')); throw Error('offline') } })
  assert.equal(n, 1); assert.equal(r.models[0].available, false)
})
test('selected Claude adapter checks provider billing as well as selected model', async () => {
  const { CodexSubscriptionAdapter } = require('../adapters/CodexSubscriptionAdapter')
  let billing = 'claude-subscription'
  const a = new CodexSubscriptionAdapter({ model: 'claude-sonnet', request: async () => ({ model: 'claude-sonnet', billing, text: 'ok', stopReason: 'end_turn' }) })
  await a.preflight(); assert.equal((await a.complete('hi')).text, 'ok')
  billing = 'chatgpt-subscription'; await assert.rejects(a.complete('hi'))
})
test('structured image content uses stdin and retains only verified Claude model provenance', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMsAAAAAASUVORK5CYII='
  let wire, args
  const r = await complete({ run: async (a, o) => {
    if (a.includes('status')) return { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }
    args = a; wire = JSON.parse(o.input)
    return { ...envelope(''), structured_output: { reply: 'Image inspected' }, modelUsage: { 'claude-haiku-4-5': {}, 'claude-sonnet-5': {} } }
  } }, { model: 'claude-sonnet', prompt: 'Inspect', images: [png], schema: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] } })
  assert.equal(JSON.parse(r.text).reply, 'Image inspected'); assert.equal(r.actualModel, 'claude-sonnet-5')
  assert.equal(args[args.indexOf('--input-format') + 1], 'stream-json')
  assert.equal(wire.message.content[1].source.data, png.slice(22))
  assert.equal(args.some(v => v.includes(png.slice(22))), false)
})
test('authenticated bridge routes Claude chat and background memory independently of GPT availability', async t => {
  const { createBridge } = require('./bridge')
  let gptCalls = 0, claudeCalls = 0
  const token = 'f'.repeat(64), server = createBridge({ token, memoryEnabled: true, backgroundModel: 'claude-sonnet',
    completeFn: async () => { gptCalls++; throw Error('GPT exhausted') }, modelsFn: async () => { throw Error('GPT offline') },
    claudeModelsFn: async () => ({ models: [{ model: 'claude-sonnet', available: true }] }),
    claudeCheckFn: async o => ({ model: o.model, billing: 'claude-subscription' }),
    claudeFn: async (_, input) => { claudeCalls++; assert.equal(input.model, 'claude-sonnet'); return { text: 'ok', model: 'claude-sonnet', billing: 'claude-subscription', stopReason: 'end_turn' } }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const post = (route, body) => fetch('http://127.0.0.1:' + server.address().port + route, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await (await post('/complete', { model: 'claude-sonnet', prompt: 'hi' })).json()).billing, 'claude-subscription')
  const catalogue = await (await post('/models', {})).json(); assert.equal(catalogue.models[0].available, true); assert.equal(catalogue.models[1].available, false)
  const memory = await (await post('/v1/chat/completions', { model: 'gpt-6-astra', messages: [{ role: 'user', content: 'fixture' }] })).json()
  assert.equal(memory.model, 'claude-sonnet'); assert.equal(claudeCalls, 2); assert.equal(gptCalls, 0)
  assert.equal((await post('/complete', { model: 'claude-sonnet', prompt: 'hi', allowCredits: true })).status, 503)
  assert.equal(claudeCalls, 2)
  assert.equal((await post('/complete', { model: 'gpt-6.1-sol', prompt: 'hi' })).status, 503)
  assert.equal(gptCalls, 1); assert.equal(claudeCalls, 2)
})
