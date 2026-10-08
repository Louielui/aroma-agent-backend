'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createA4RuntimeDependencies } = require('./a4Runtime')
test('all subscription investigation helper roles stay on the selected subscription without API keys', async () => {
  const calls = [], phases = []
  const composed = createA4RuntimeDependencies({ env: { CHAT_BACKEND: 'codex-subscription', A4_KNOWLEDGE_ROUTING: 'on' },
    subscriptionAdapterFactory: () => ({ complete: async (prompt, options) => { calls.push(options.responseFormat.name); phases.push(options.invocationPhase); return { text: '{}' } } }),
    verifierAdapterFactory: () => { throw Error('paid API selected') }, recoveryAdapterFactory: () => { throw Error('paid API recovery selected') } })
  assert.equal(composed.skipped.length, 0)
  assert.equal(composed.roles.finalVerifier.provider, 'selected_subscription')
  await composed.deps.sourceIntentResolver({ ownerMessages: ['Why?'] })
  await composed.deps.finalVerifier({ ownerMessages: ['Why?'], availableWorlds: { internal: true, public: false }, schema: {} })
  await composed.deps.publicQueryPlanner({ ownerMessages: ['Why?'], schema: {} })
  await composed.deps.recoveryWorker({ ownerMessages: ['Why?'], requiredWorld: 'internal', completedWorlds: {}, capabilities: [], schema: {} })
  assert.deepEqual(calls, ['owner_source_intent', 'final_knowledge_requirement', 'public_query_plan', 'recovery_decision'])
  assert.deepEqual(phases, ['source_intent', 'final_verification', 'public_query_plan', 'recovery_decision'])
})

test('subscription composition without a selected adapter cannot fall back to configured paid API keys', () => {
  const composed = createA4RuntimeDependencies({ env: { CHAT_BACKEND: 'codex-subscription', A4_KNOWLEDGE_ROUTING: 'on', OPENAI_API_KEY: 'present' } })
  assert.equal(composed.deps, null)
  assert.equal(composed.built.length, 0)
})
