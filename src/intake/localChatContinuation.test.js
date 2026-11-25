'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { randomUUID } = require('node:crypto')
const { fromSavedConversation } = require('./conversationEvidence')
const { processIntake } = require('./intakeService')

const cases = [
  ['你知道我在想什麼嗎?', '我唔知你而家諗緊咩，不過你想我估吓嗎？', '好',
    '我估你想睇吓我識唔識接住上一句。', 'chat'],
  ['假設我拎住把遮，出面烏雲密布，我企喺門口未行出去。', '你想我估吓你而家打算點做嗎？', '好呀。',
    '我估你諗住帶埋把遮出門。', 'chat'],
  ['虛構排練用兩塊牌，米白牌放窗邊，青牌放門口。', '要唔要我將呢兩個擺位寫成一句畀領班嘅交帶？', '好。',
    '米白牌放窗邊，青牌放門口。', 'chat'],
  ['虛構排練嘅安排係下晝三點喺海桐室集合。', '收到，排練係下晝三點喺海桐室集合。', '好。',
    '好呀，收到。', 'chat'],
  ['虛構展覽要準備色牌，藍牌同黃牌都可以。', '你想我幫你揀一款，定係想我將兩款照原樣列出？', '好。',
    '你想我揀一款，定係列出兩款？', 'ask']
]

test('manual local short replies follow the saved assistant turn through a single reply-only answer', async t => {
  t.mock.method(console, 'log', () => {})
  const env = { LOCAL_BRAIN_ONLY: '1', TURN_ROUTER: 'on', A4_KNOWLEDGE_ROUTING: 'off', READ_ACCESS: 'off' }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  for (const [earlier, preceding, message, reply, mode] of cases) {
    const history = [{ role: 'user', text: earlier }, { role: 'assistant', text: preceding }]
    const calls = []
    const result = await processIntake(message, {
      providerName: 'local',
      preflight: async () => {},
      complete: async (prompt, options) => {
        calls.push({ prompt, options })
        const answer = options.responseFormat?.name === 'local_chat_continuation'
          ? { reply } : { mode: 'chat', intent: 'context', reply: '好，你想傾啲咩？' }
        return { model: 'local:qwen3.5:9b', text: JSON.stringify(answer) }
      }
    }, history, {
      requestId: randomUUID(), demo: true, interactionMode: 'chat', manualLocalDialogue: true,
      conversationEvidence: fromSavedConversation({ messages: history }, message)
    })
    assert.deepEqual([result.reply, result.mode, result.talkOnly, result.tasks], [reply, mode, true, []])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].options.invocationPhase, 'answer')
    assert.equal(calls[0].options.responseFormat.name, 'local_chat_continuation')
    const { messages, alternatives } = JSON.parse(calls[0].prompt)
    if (mode === 'ask') assert.deepEqual(alternatives, ['你想我幫你揀一款', '想我將兩款照原樣列出'])
    else assert.equal(alternatives, undefined)
    assert.deepEqual(messages, [
      { role: 'user', content: earlier }, { role: 'assistant', content: preceding },
      { role: 'user', content: message }
    ])
  }
})

test('continuation does not activate on unverified contexts, real actions, or a different latest user input', async () => {
  const { answerContinuation } = require('./localChatContinuation')
  const adapter = { providerName: 'local', complete: async () => assert.fail('not a reply-only continuation') }
  const token = (first, reply) => fromSavedConversation({ messages: [
    { role: 'user', content: first }, { role: 'assistant', content: reply }
  ] }, '好')
  const benign = token('你知唔知我諗緊咩？', '你想我估吓嗎？')
  for (const [reply, evidence] of [
    ['好', null], ['好', { ...benign }], ['好。', benign], ['好，順便查吓', benign],
    ['好', token('我想核對今日正式庫存。', '你想我幫你查今日，定係噚日嘅庫存？')],
    ['好', token('草擬一下對外電郵。', '要唔要我將內容寫成一封信，再寄出去？')],
    ['好', token('等我批准再部署。', '收到，等你批准先部署。')],
    ['好', token('我有三種色卡。', '你想我揀紅、定係黃、定係綠？')]
  ]) assert.equal(await answerContinuation(reply, evidence, adapter), null)
})

test('reply-only generation rejects an execution-shaped model response', async () => {
  const { answerContinuation } = require('./localChatContinuation')
  const messages = [{ role: 'user', content: '你知唔知我諗緊咩？' }, { role: 'assistant', content: '你想我估吓嗎？' }]
  const evidence = fromSavedConversation({ messages }, '好')
  const adapter = { providerName: 'local', complete: async () => ({
    model: 'local:qwen3.5:9b', text: '{"reply":"我估你想試下我。","tasks":[{"title":"send"}]}'
  }) }
  await assert.rejects(answerContinuation('好', evidence, adapter), { code: 'local_invalid_output' })
})

test('saved parenthesized replies still accept a local acknowledgement without changing model history', async () => {
  const { answerContinuation } = require('./localChatContinuation')
  const cases = [
    [
      '虛構排練用兩塊牌，米白牌放窗邊，青牌放門口。請只答括號入面一句，連標點照跟：（要唔要我將呢兩個擺位寫成一句畀領班嘅交帶？）',
      '（要唔要我將呢兩個擺位寫成一句畀領班嘅交帶？）',
      '米白牌放窗邊，青牌放門口。', 'chat', undefined
    ],
    ['虛構排練喺下晝三點海桐室集合。', '( 收到，排練係下晝三點喺海桐室集合。 )',
      '得嘅。', 'chat', undefined],
    ['虛構展覽用藍牌或黃牌。', '（你想我幫你揀一款，定係想我將兩款照原樣列出？）',
      '你想我揀一款，定係列出兩款？', 'ask', ['你想我幫你揀一款', '想我將兩款照原樣列出']]
  ]
  for (const [earlier, preceding, reply, mode, alternatives] of cases) {
    const messages = [{ role: 'user', content: earlier }, { role: 'assistant', content: preceding }]
    const calls = []
    const result = await answerContinuation('好', fromSavedConversation({ messages }, '好'), {
      providerName: 'local',
      async complete (prompt, options) {
        calls.push({ prompt: JSON.parse(prompt), options })
        return { model: 'local:qwen3.5:9b', text: JSON.stringify({ reply }) }
      }
    })
    assert.deepEqual(result, { reply, mode, model: 'local:qwen3.5:9b' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].options.invocationPhase, 'answer')
    assert.deepEqual(calls[0].prompt.messages, [...messages, { role: 'user', content: '好' }])
    assert.deepEqual(calls[0].prompt.alternatives, alternatives)
    if (preceding.includes('寫成')) assert.match(calls[0].prompt.instruction, /只適用於嗰一則。今次直接交付/)
  }
})

test('parentheses do not make malformed, mixed or operational replies eligible', async () => {
  const { answerContinuation } = require('./localChatContinuation')
  const adapter = { providerName: 'local', complete: async () => assert.fail('reply-only answer not eligible') }
  for (const [earlier, preceding] of [
    ['虛構排練用兩塊牌。', '(要唔要我寫成一句交帶？）'],
    ['虛構排練用兩塊牌。', '（要唔要我寫成一句交帶？）（補充背景）'],
    ['虛構排練用兩塊牌。', '（要唔要我寫成一句交帶？）額外內容'],
    ['虛構文案。', '（要唔要我將內容寫成一封信，再寄出去？）'],
    ['等我批准再部署。', '（收到，等你批准先部署。）']
  ]) {
    const messages = [{ role: 'user', content: earlier }, { role: 'assistant', content: preceding }]
    assert.equal(await answerContinuation('好', fromSavedConversation({ messages }, '好'), adapter), null)
  }
})
