'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { processIntake } = require('./intakeService')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

for (const outcome of ['none', 'business', 'failed']) {
  test(`goal planning overlaps independent intent work, but neither answer nor source read escapes the join: ${outcome}`, async t => {
    const before = { ...process.env }
    t.after(() => { for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before) })
    Object.assign(process.env, { CHAT_BACKEND: 'codex-subscription', TURN_ROUTER: 'on', READ_ACCESS: 'on', GOAL_DECOMPOSER: 'on',
      XIANGXIANG_MEMORY: 'off', XIANGXIANG_WEBSITE_FLOW: 'off', DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off', A4_KNOWLEDGE_ROUTING: 'off', MULTI_AI_ROUTER: 'off' })
    const gate = deferred(), planner = deferred(); let opinions = 0, answers = 0, reads = 0
    const adapter = { preflight: async () => {}, complete: async (_prompt, options) => {
      if (options.invocationPhase === 'goal_understanding') {
        planner.resolve()
        return { text: JSON.stringify({ question_restated: 'Discuss the current request.', facts: [], joins: [] }) }
      }
      answers++
      return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: 'An offline answer.', nextRead: null }), model: 'offline' }
    } }
    const pending = processIntake('How should I approach this?', adapter, [], { demo: true, interactionMode: 'chat', openaiAdapter: adapter,
      semanticCallModel: async () => { opinions++; await gate.promise; if (outcome === 'failed') throw Error('offline'); return JSON.stringify({ intent: outcome === 'business' ? 'inventory' : 'NONE', confidence: 'HIGH' }) },
      readContextDeps: { sources: ['aroma_system'], connector: { read: async () => { reads++; throw Error('no fixture data') } } }
    })
    const started = await Promise.race([planner.promise.then(() => true), new Promise(r => setTimeout(() => r(false), 1500))])
    assert.equal(answers, 0); assert.equal(reads, 0); assert.equal(opinions, 2)
    gate.resolve()
    const result = await pending
    assert.equal(started, true, 'the planner must start while intent opinions are still pending')
    assert.equal(answers, outcome === 'business' ? 2 : 1); assert.deepEqual(result.tasks, []); assert.equal(result.decision, null)
  })
}

test('settled intent cannot release answer or business reads while goal preparation is pending', async t => {
  const before = { ...process.env }
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before) })
  Object.assign(process.env, { CHAT_BACKEND: 'codex-subscription', TURN_ROUTER: 'on', READ_ACCESS: 'on', GOAL_DECOMPOSER: 'on',
    XIANGXIANG_MEMORY: 'off', XIANGXIANG_WEBSITE_FLOW: 'off', DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off', A4_KNOWLEDGE_ROUTING: 'off', MULTI_AI_ROUTER: 'off' })
  const gate = deferred(), planner = deferred(); let opinions = 0, goals = 0, answers = 0, reads = 0
  const adapter = { preflight: async () => {}, complete: async (_prompt, options) => {
    if (options.invocationPhase === 'goal_understanding') {
      goals++; planner.resolve(); await gate.promise
      throw Error('offline goal preparation unavailable')
    }
    answers++
    return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: 'An offline answer.', nextRead: null }), model: 'offline' }
  } }
  const pending = processIntake('How should I approach this?', adapter, [], { demo: true, interactionMode: 'chat', openaiAdapter: adapter,
    semanticCallModel: async () => { opinions++; return JSON.stringify({ intent: 'NONE', confidence: 'HIGH' }) },
    readContextDeps: { connector: { read: async () => { reads++; throw Error('no fixture data') } } }
  })
  await planner.promise
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(opinions, 2); assert.equal(goals, 1); assert.equal(answers, 0); assert.equal(reads, 0)
  gate.resolve()
  const result = await pending
  assert.equal(goals, 1); assert.equal(answers, 1); assert.equal(reads, 0)
  assert.deepEqual(result.tasks, []); assert.equal(result.decision, null)
})
