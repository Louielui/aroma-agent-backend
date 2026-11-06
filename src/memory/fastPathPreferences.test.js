'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { processIntake } = require('../intake/intakeService')

// Host integration tests: the model is deliberately inert. These prove delivery
// and isolation, not that a real model follows the preference.
for (const message of ['你好香香', '翻譯成英文：請明天回覆。']) {
  for (const state of ['approved', 'unavailable', 'invalid', 'disabled', 'read_denied', 'withheld', 'wrong_scope', 'wrong_actor']) {
    test(`fast chat preserves approved preference delivery: ${message} / ${state}`, async () => {
      const before = { ...process.env }
      Object.assign(process.env, {
        CHAT_BACKEND: 'codex-subscription', TURN_ROUTER: 'on', READ_ACCESS: state === 'read_denied' ? 'off' : 'on',
        XIANGXIANG_MEMORY: state === 'disabled' ? 'off' : 'on',
        CONTEXT_DECISIONS_OPENAI: state === 'withheld' ? 'off' : 'on',
        XIANGXIANG_WEBSITE_FLOW: 'off', GOAL_DECOMPOSER: 'on', A4_KNOWLEDGE_ROUTING: 'on',
        DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off'
      })
      let preferences = 0; let answers = 0; let prompt = ''; const telemetry = {}
      const text = 'Use a concise conclusion and no more than three short points.'
      const forbidden = async () => assert.fail('fast chat must not query history, business sources or auxiliary models')
      const adapter = { preflight: async () => {}, complete: async value => {
        answers++; prompt = value
        return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: 'Fixture response.', nextRead: null }), model: 'offline-fixture', billing: 'chatgpt-subscription' }
      } }
      try {
        const result = await processIntake(message, adapter, [], {
          demo: true, interactionMode: 'chat', openaiAdapter: adapter, telemetry,
          controlAdapter: { complete: forbidden }, semanticCallModel: forbidden,
          memoryClient: { recall: forbidden, preferences: async () => {
            preferences++
            if (state === 'unavailable') throw Error('private-provider-error')
            return { state: 'ok', total: 1, items: [{ documentId: 'xx-preference-fixture', type: 'preference', scope: state === 'wrong_scope' ? 'public' : 'private:owner', text,
              approval: { kind: 'owner', actor: state === 'wrong_actor' ? 'assistant' : 'owner', contentHash: state === 'invalid' ? 'invalid' : createHash('sha256').update(text).digest('hex') } }] }
          } },
          decisionRecallDeps: { listDecisionsFn: forbidden, listTasksFn: forbidden },
          readContextDeps: { finalVerifier: forbidden, connector: { read: forbidden } }
        })
        assert.equal(answers, 1)
        assert.deepEqual(result.tasks, [])
        assert.equal(result.decision, null)
        assert.equal(preferences, ['disabled', 'read_denied', 'withheld'].includes(state) ? 0 : 1)
        if (state === 'approved') {
          assert.ok(prompt.includes(text), 'approved communication preference must reach the real answer call')
          assert.match(prompt, /not execution approval/)
          assert.equal(telemetry.replyCitesContext, true, 'preference-derived output retains the existing privacy marker')
        } else {
          assert.ok(!prompt.includes(text))
          if (['unavailable', 'invalid', 'wrong_scope', 'wrong_actor'].includes(state)) assert.match(prompt, /preferences are unavailable/)
        }
        assert.ok(!prompt.includes('private-provider-error'))
      } finally {
        for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]
        Object.assign(process.env, before)
      }
    })
  }
}

test('fast chat re-reads the real gateway after an approved preference correction', async t => {
  const before = { ...process.env }
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before) })
  Object.assign(process.env, { CHAT_BACKEND: 'codex-subscription', TURN_ROUTER: 'on', READ_ACCESS: 'on', XIANGXIANG_MEMORY: 'on', CONTEXT_DECISIONS_OPENAI: 'on', GOAL_DECOMPOSER: 'on', A4_KNOWLEDGE_ROUTING: 'on', XIANGXIANG_WEBSITE_FLOW: 'off' })
  const { createGateway, OWNER } = require('./governed')
  const gateway = createGateway({ store: require('./structuredStore').createTestStore() })
  const first = await gateway.propose(OWNER, { type: 'preference', subject: 'Answer format', text: 'Prefer a concise paragraph.', scope: 'private:owner', source: { kind: 'owner', id: 'offline-fixture', at: '2026-11-06T00:00:00Z', attribution: 'owner_statement' } })
  await gateway.transition(OWNER, first.id, first.version, 'approve')
  const prompts = []; let reads = 0
  const adapter = { preflight: async () => {}, complete: async prompt => { prompts.push(prompt); return { text: JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: 'Fixture.', nextRead: null }), model: 'offline-fixture', billing: 'chatgpt-subscription' } } }
  const options = { demo: true, interactionMode: 'chat', openaiAdapter: adapter, memoryClient: { preferences: () => { reads++; return gateway.preferences(OWNER) }, recall: async () => assert.fail('no topic search') } }
  await processIntake('Hello!', adapter, [], { ...options })
  assert.ok(prompts[0].includes(first.text))
  const current = await gateway.preferences(OWNER)
  await gateway.transition(OWNER, first.id, current.items[0].version, 'archive')
  const second = await gateway.propose(OWNER, { type: 'preference', subject: 'Answer format', text: 'Prefer two brief bullet points.', scope: 'private:owner', source: { kind: 'owner', id: 'offline-correction', at: '2026-11-06T00:01:00Z', attribution: 'owner_statement' } })
  await gateway.transition(OWNER, second.id, second.version, 'approve')
  await processIntake('Hello!', adapter, [], { ...options })
  assert.equal(reads, 2); assert.equal(prompts.length, 2)
  assert.ok(prompts[1].includes(second.text)); assert.ok(!prompts[1].includes(first.text))
})
