'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { processIntake } = require('../intake/intakeService')
test('chat receives Hindsight through the existing gateway and marks derived replies non-archivable', async () => {
  const saved = { ...process.env }; const prompts = []; let reads = 0
  Object.assign(process.env, { XIANGXIANG_MEMORY: 'on', CHAT_BACKEND: 'codex-subscription', READ_ACCESS: 'on', CONTEXT_DECISIONS_OPENAI: 'on', GOAL_DECOMPOSER: 'off', TURN_ROUTER: 'on', A4_KNOWLEDGE_ROUTING: 'off', DECISION_RECALL: 'on', CONVERSATION_RECALL: 'off' })
  const gpt = { preflight: async () => {}, complete: async prompt => { prompts.push(prompt); return { text: JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '你偏好青綠色資料夾。', nextRead: null }), model: 'gpt-6-astra', billing: 'chatgpt-subscription' } } }
  const telemetry = {}
  try {
    await processIntake('What folder colour do I prefer?', gpt, [], { demo: true, interactionMode: 'chat', openaiAdapter: gpt, controlAdapter: gpt, telemetry,
      memoryClient: { recall: async () => { reads++; return [{ id: 'fact', documentId: 'doc', text: 'Owner prefers teal folders.', date: null }] } },
      decisionRecallDeps: { listDecisionsFn: () => [], listTasksFn: () => [] } })
    assert.equal(reads, 1); assert.ok(prompts.some(p => p.includes('Owner prefers teal folders.')))
    assert.equal(telemetry.replyCitesContext, true); assert.ok(telemetry.readContextSources.includes('hindsight'))
  } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved) }
})
