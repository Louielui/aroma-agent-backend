'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createDraftProvider } = require('./provider')
test('draft generation uses medium effort consistently and preserves cancellation and subscription errors without retries', async () => {
  const calls = [], signal = new AbortController().signal
  const client = { checkSubscription: async o => { calls.push(o); return { model: o.model, billing: 'chatgpt-subscription' } }, complete: async (o, i) => { calls.push({ ...o, ...i }); throw Error('subscription_limit_reached') } }
  const p = createDraftProvider({ client, options: { executable: 'fixed-cli', cwd: 'fixed-empty', allowCredits: true } })
  assert.equal((await p.preflight({ signal })).effort, 'medium')
  await assert.rejects(p.complete('bounded request', { system: 'tests only', schema: { type: 'object' }, signal }), /subscription_limit_reached/)
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.model === 'gpt-6.1-sol' && c.effort === 'medium' && c.signal === signal && c.allowCredits === true))
  assert.equal(calls[1].timeoutMs, 240000); assert.equal(calls[1].prompt, 'bounded request')
})
