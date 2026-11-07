'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const id = 'xx-10000000-0000-4000-8000-000000000001'
const raw = `The latter code is Violet. The correction is recorded in your earlier note [memory:${id}]; retrieval coverage is partial.`
const history = [{ role: 'user', text: 'Recall the first test code and the final corrected second test code.' }, { role: 'assistant', text: 'The first was Amber; the second was Violet.' }]
const message = 'Only check the latter correction now; leave the former aside. Give the result and basis in two sentences; save nothing and take no other action.'

async function exercise(t, options = {}) {
  const before = { ...process.env }
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k]; Object.assign(process.env, before) })
  Object.assign(process.env, { CHAT_BACKEND: 'codex-subscription', TURN_ROUTER: 'on', READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on',
    CONTEXT_DECISIONS_OPENAI: 'on', GOAL_DECOMPOSER: 'on', A4_KNOWLEDGE_ROUTING: 'on', XIANGXIANG_WEBSITE_FLOW: 'off',
    XIANGXIANG_MEMORY: 'on', CONVERSATION_RECALL: 'off', DECISION_RECALL: 'off', MULTI_AI_ROUTER: 'off', XIANGXIANG_ARCHIVE: 'off' })
  let forbiddenCalls = 0
  const denied = async () => { forbiddenCalls++; assert.fail('No API, connector read or business write is permitted by this memory-only test') }
  const calls = [], verifierInputs = [], events = [], originalLog = console.log
  console.log = (...args) => { events.push(args.map(String).join(' ')) }
  t.after(() => { console.log = originalLog })
  const adapter = { providerName: 'claude', preflight: async () => {}, complete: async (prompt, opts = {}) => {
    calls.push({ prompt, opts })
    const plan = { question_restated: 'Recall only the latter corrected code.', requested_capability: 'conversation_recall', facts: [], joins: [],
      executive_frame: { taskType: 'retrieve', decisionNeeded: false, successDefinition: 'Answer in two sentences.', answerPosture: 'direct' } }
    return { text: JSON.stringify(opts.responseFormat?.name === 'goal_plan' ? plan :
      { intent: 'question', mode: options.mode || 'chat', reply: options.reply || raw, nextRead: options.nextRead || null }), model: 'offline-fixture', billing: 'offline' }
  } }
  const result = await require('./intakeService').processIntake(options.message || message, { complete: denied }, options.history || history, {
    demo: true, interactionMode: 'chat', openaiAdapter: adapter, controlAdapter: { complete: denied },
    semanticCallModel: async () => JSON.stringify({ intent: 'daily_count', confidence: 'MEDIUM' }),
    memoryClient: { preferences: async () => ({ state: 'ok', items: [], total: 0 }), recall: async () => {
      if (options.memory === 'unavailable') throw Error('offline_memory_unavailable')
      return options.memory === 'empty' ? [] : [{ documentId: id, source: 'memory_gateway', scope: 'private:owner', status: 'active', version: 4, text: 'The corrected second test code is Violet; the old code is obsolete.', date: '2026-01-02T00:00:00Z' }]
    } },
    readContextDeps: { connector: { read: denied }, sources: ['aroma_system'], finalVerifier: async args => {
      verifierInputs.push(args)
      if (options.verdict === 'unavailable') throw Error('offline_verifier_unavailable')
      return { decision: options.verdict || 'require_memory', question: options.verdict === 'clarify' ? 'Which source do you mean?' : null }
    }, sourceIntentResolver: async () => JSON.stringify({ intent: 'ambiguous', question: 'Which live business source do you mean?' }) }
  })
  assert.equal(result.decision, null); assert.deepEqual(result.tasks, [])
  assert.equal(calls.filter(c => c.opts.responseFormat?.name !== 'goal_plan').length, 1, 'arbitration adds no answer or polishing call')
  assert.equal(verifierInputs.length, 1)
  assert.equal(forbiddenCalls, 0, 'no forbidden request may be hidden by an error handler')
  return { result, events, verifierInputs, calls }
}

test('context-confirmed memory answer survives an unrelated MEDIUM business clarification', async t => {
  const { result, events, calls } = await exercise(t)
  assert.equal(result.reply, raw.replace(`[memory:${id}]`, ''))
  assert.equal(result.replyForArchive, result.reply)
  assert.equal(result.mode, 'chat')
  assert.equal(result.memorySources.items[0].version, 4)
  assert.ok(calls.find(c => c.opts.responseFormat?.name !== 'goal_plan').prompt.includes(history[0].text))
  assert.ok(events.some(s => s.includes('memory_clarification_superseded')))
})

for (const text of ['改一下，只要後者最後更正的代號，前者先不用；兩句說明，不保存、不執行。',
  'Use the corrected one from our previous exchange, with its basis. This is recall only.']) {
  test(`memory arbitration is independent of the wording: ${text}`, async t => {
    const { result } = await exercise(t, { message: text })
    assert.equal(result.reply, raw.replace(`[memory:${id}]`, ''))
    assert.equal(result.memorySources.claimsVerified, false)
  })
}

for (const memory of ['empty', 'unavailable']) test(`memory ${memory} retains its specific failure instead of the business clarification`, async t => {
  const { result } = await exercise(t, { memory })
  assert.match(result.reply, /記憶|記錄|memory/i)
  assert.ok(!result.reply.includes('你想睇邊方面'))
  assert.ok(!result.reply.includes('Violet'))
})

test('a genuine model-authored memory clarification remains a question', async t => {
  const { result } = await exercise(t, { mode: 'ask', reply: 'Which of the two previous corrections do you mean?' })
  assert.equal(result.reply, 'Which of the two previous corrections do you mean?'); assert.equal(result.mode, 'ask')
})

for (const verdict of ['allow_final', 'clarify', 'require_internal', 'require_public', 'require_mixed', 'unavailable']) {
  test(`${verdict} does not release a memory answer over the business clarification`, async t => {
    const { result, events } = await exercise(t, { verdict })
    assert.notEqual(result.reply, raw.replace(`[memory:${id}]`, ''))
    assert.ok(!events.some(s => s.includes('memory_clarification_superseded')))
  })
}

test('a proposed business read cannot be revived by the memory verdict', async t => {
  const { result } = await exercise(t, { nextRead: { capability: 'aroma_system.replenishment' } })
  assert.ok(!result.reply.includes('Violet'))
  assert.equal(result.mode, 'ask')
})

test('an unloaded citation is not promoted into a canonical source receipt', async t => {
  const reply = 'The corrected code is Violet. [memory:xx-99999999-9999-4999-8999-999999999999]'
  const { result } = await exercise(t, { reply })
  assert.equal(result.reply, reply, 'existing source presentation leaves unmatched markers visible')
  assert.equal(result.memorySources, undefined)
})
