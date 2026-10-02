'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'subscription-test-'))
process.env.A4_KNOWLEDGE_ROUTING = 'off'
const { selectPrimaryProvider } = require('../routing/modelRouter')
const { processIntake } = require('../intake/intakeService')
const { SubscriptionError } = require('./codexClient')
const { CodexSubscriptionAdapter } = require('../adapters/CodexSubscriptionAdapter')
const { handleIntakeError } = require('../utils/intakeDiagnostics')

test('subscription setting overrides stale chat hints, not other lanes', () => {
  const env = { CHAT_BACKEND: 'codex-subscription' }
  assert.equal(selectPrimaryProvider(env, { interactionMode: 'chat', providerHint: 'claude' }), 'openai')
  assert.equal(selectPrimaryProvider(env, { interactionMode: 'proposal', providerHint: 'openai' }), 'claude')
})
test('chat preserves context and never calls Claude when subscription fails or output is invalid', async () => {
  process.env.CHAT_BACKEND = 'codex-subscription'
  let claudeCalls = 0
  const claude = { complete: async () => { claudeCalls++; throw new Error('must not run') } }
  try {
    for (const scenario of ['preflight', 'complete', 'parse', 'success']) {
      let seen = null
      const gpt = {
        preflight: async () => { if (scenario === 'preflight') throw new SubscriptionError('subscription_limit_reached') },
        complete: async (prompt, opts) => {
          seen = { prompt, system: opts.system }
          if (scenario === 'complete') throw new SubscriptionError()
          return { text: scenario === 'parse' ? 'not json' : JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: 'ready' }), model: 'gpt-6-astra', billing: 'chatgpt-subscription' }
        }
      }
      const run = () => processIntake('hello', claude, [{ role: 'user', text: 'HISTORY_SENTINEL' }], { demo: true, interactionMode: 'chat', providerHint: 'claude', openaiAdapter: gpt })
      if (scenario === 'success') { await run(); assert.match(seen.prompt, /HISTORY_SENTINEL/); assert.ok(seen.system.length > 50) }
      else await assert.rejects(run, SubscriptionError)
      assert.equal(claudeCalls, 0)
    }
  } finally { delete process.env.CHAT_BACKEND }
})
test('subscription adapter forwards schema and refuses other billing/model', async () => {
  let seen
  const response = { text: '{}', model: 'gpt-6-astra', billing: 'chatgpt-subscription', stopReason: 'end_turn' }
  const adapter = new CodexSubscriptionAdapter({ request: async (route, input) => { seen = input; return response } })
  const schema = { type: 'object' }
  await adapter.complete('prompt', { system: 'persona', responseFormat: { type: 'json_schema', name: 'answer', schema } })
  assert.deepEqual(seen, { prompt: 'prompt', model: 'gpt-6-astra', system: 'persona', effort: 'low', schema })
  response.billing = 'api'
  await assert.rejects(adapter.complete('prompt'), SubscriptionError)
})
test('subscription errors have safe serialized user messages', () => {
  for (const code of ['subscription_limit_reached', 'subscription_login_required', 'subscription_unavailable', 'subscription_model_unavailable', 'subscription_invalid_output']) {
    const result = handleIntakeError(new SubscriptionError(code), {}, { sink: () => {} })
    const wire = JSON.parse(JSON.stringify(result))
    assert.equal(wire.body.error.code, code)
    assert.ok(wire.body.error.message.length > 5)
    assert.ok(wire.status >= 400)
  }
})
