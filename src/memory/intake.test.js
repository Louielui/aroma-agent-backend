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

for (const state of ['found', 'empty', 'unavailable', 'business']) test(`memory final obligation uses recall state: ${state}`, async () => {
  const saved = { ...process.env }; let calls = 0; let resolutions = 0
  Object.assign(process.env, { XIANGXIANG_MEMORY: 'on', CHAT_BACKEND: 'codex-subscription', READ_ACCESS: 'on', CONTEXT_DECISIONS_OPENAI: 'on', CONTEXT_AROMA_SYSTEM: 'on', GOAL_DECOMPOSER: 'off', TURN_ROUTER: 'on', A4_KNOWLEDGE_ROUTING: 'on', DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off' })
  const reply = '測試代號是藍狐581；來源日期：2026-09-20，文件 doc-test。'
  const gpt = { preflight: async () => {}, complete: async () => { calls++; return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply, nextRead: null }), model: 'gpt-6-astra' } } }
  try {
    const out = await processIntake('Find the test code I told you in an earlier conversation.', gpt, [], { demo: true, interactionMode: 'chat', openaiAdapter: gpt, controlAdapter: gpt,
      memoryClient: { recall: async () => { if (state === 'unavailable') throw Error('offline'); return state === 'empty' ? [] : [{ documentId: 'doc-test', text: 'Test code: 藍狐581', date: '2026-09-20' }] } },
      readContextDeps: { sources: ['aroma_system', 'public_knowledge'], finalVerifier: async () => ({ decision: state === 'business' ? 'require_internal' : 'require_memory', question: null }),
        sourceIntentResolver: async () => { resolutions++; return { intent: 'internal' } }, connector: { read: async () => { throw Error('memory must not trigger business reads') } } }
    })
    if (state === 'business') {
      assert.ok(calls > 1); assert.equal(resolutions, 1)
      assert.ok(!out.reply.includes('藍狐581'), 'a memory hit cannot satisfy a live business obligation')
      return
    }
    assert.equal(calls, 1); assert.equal(resolutions, 0)
    if (state === 'found') assert.equal(out.reply, reply)
    else {
      assert.ok(!out.reply.includes('藍狐581'), 'an unverified memory answer must not survive')
      assert.match(out.reply, state === 'empty' ? /未找到|找不到/ : /無法讀取/)
    }
  } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved) }
})
