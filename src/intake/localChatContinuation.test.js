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
    '你想我揀一款，定係列出兩款？', 'ask'],
  ['how are you', 'Louie，我一切都好，正準備著幫你處理 Aroma 嘅營運事務。', '什麼意思?',
    '我意思係我幾好，隨時可以幫你處理 Aroma 嘅營運工作。', 'chat'],
  ['排練星期五試一次，星期六照舊，星期一先決定長期做法。', '星期五先試行，星期六維持原安排，到星期一先決定日後點做。', '即係點？',
    '星期五試一次，星期六照舊，星期一先決定長期點做。', 'chat']
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
    const { messages, alternatives, instruction } = JSON.parse(calls[0].prompt)
    if (message === '什麼意思?' || message === '即係點？') {
      assert.match(instruction, /直接解釋最後一則助手回覆/)
      assert.match(instruction, /將可能令人唔明嘅詞換成日常講法/)
      assert.match(instruction, /reply 只放改寫之後嗰一句/)
      assert.match(instruction, /「準備／可以幫手」唔等於即刻開始/)
    }
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

test('an explanation only uses a safe saved reply and does not absorb a new request', async () => {
  const { answerContinuation } = require('./localChatContinuation')
  const adapter = { providerName: 'local', complete: async () => assert.fail('not an eligible explanation') }
  for (const [message, messages] of [
    ['什麼意思？', []],
    ['什麼意思？', [{ role: 'user', content: '改好就上線。' }, { role: 'assistant', content: '等你正式批准先部署。' }]],
    ['什麼意思？幫我查庫存。', [{ role: 'user', content: '你好' }, { role: 'assistant', content: '我今日幾好。' }]]
  ]) {
    assert.equal(await answerContinuation(message, fromSavedConversation({ messages }, message), adapter), null)
  }
})

test('an explanation retries once when it repeats the antecedent or turns readiness into execution', async () => {
  const { answerContinuation } = require('./localChatContinuation')
  const message = '什麼意思?'
  const preceding = 'Louie，我一切都好，正準備著幫你處理 Aroma 嘅營運事務。'
  const messages = [{role:'user',content:'how are you'}, {role:'assistant',content:preceding}]
  const evidence = fromSavedConversation({messages}, message)
  for (const first of ['我係話，我一切都好，正準備著幫你處理 Aroma 嘅營運事務。', '我幾好，會即刻開始幫你打理 Aroma。']) {
    const calls = []
    const reply = '我而家幾好，亦準備好可以幫你跟進 Aroma 嘅日常工作。'
    const adapter = {providerName:'local',async complete(prompt, options) {
      calls.push(JSON.parse(prompt))
      assert.match(options.system, /將最後一則助手說話翻成更貼近日常口語/)
      return {text:JSON.stringify({reply:calls.length === 1 ? first : reply}),model:'qwen3.5:9b'}
    }}
    assert.equal((await answerContinuation(message, evidence, adapter)).reply, reply)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0].messages, calls[1].messages)
  }
  let calls = 0
  const parrot = {providerName:'local',async complete() { calls++; return {text:JSON.stringify({reply:preceding})} }}
  await assert.rejects(answerContinuation(message, evidence, parrot), {code:'local_invalid_output'})
  assert.equal(calls, 2)
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


test('short follow-ups send saved facts from earlier safe turns, regardless of the latest wording', async () => {
  const { answerContinuation } = require('./localChatContinuation')
  const history = [
    {role:'user',content:'虛構練習，銀牌放喺麻布袋入面，紫燈放松木枱底。'},
    {role:'assistant',content:'收到，銀牌喺麻布袋入面，紫燈喺松木枱底。'},
    {role:'user',content:'跟返頭先嘅擺位講畀領班聽。'},
    {role:'assistant',content:'要唔要我用一句寫成畀領班嘅交帶？'}
  ]
  for (const message of ['好','得','照頭先咁。']) {
    const calls = []
    const answer = await answerContinuation(message, fromSavedConversation({messages:history}, message), {
      providerName:'local',
      complete:async prompt=>{
        calls.push(JSON.parse(prompt))
        return {model:'local:qwen3.5:9b',text:JSON.stringify({reply:'銀牌喺麻布袋入面，紫燈喺松木枱底。'})}
      }
    })
    assert.equal(answer?.mode,'chat')
    assert.equal(calls.length,1)
    assert.deepEqual(calls[0].messages,[...history,{role:'user',content:message}])
  }
})

test('short follow-ups only use the contiguous bounded safe saved transcript', async () => {
  const { answerContinuation } = require('./localChatContinuation')
  const pair = [
    {role:'user',content:'依家你估我講緊邊件道具？'},
    {role:'assistant',content:'你想我估吓係邊件道具嗎？'}
  ]
  const safePair = i => [{role:'user',content:'道具甲' + i},{role:'assistant',content:'收到第' + i + '個擺位。'}]
  const unsafeWhileOlder = [{role:'user',content:'幫我改檔。'},{role:'assistant',content:'等你正式批准先改檔。'}]
  for (const [messages, expected] of [
    [[...safePair(0),...unsafeWhileOlder,...safePair(2),...pair],[...safePair(2),...pair]],
    [[...safePair(0),...safePair(1),...safePair(2),...safePair(3),...pair],[...safePair(1),...safePair(2),...safePair(3),...pair]]
  ]) {
    let observed
    const result = await answerContinuation('得', fromSavedConversation({messages}, '得'), {
      providerName:'local',
      complete:async prompt=>{
        observed=JSON.parse(prompt).messages
        return {model:'local:qwen3.5:9b',text:'{"reply":"我估係張卡。"}'}
      }
    })
    assert.equal(result?.mode,'chat')
    assert.deepEqual(observed,[...expected,{role:'user',content:'得'}])
  }
  const adapter={providerName:'local',complete:async()=>assert.fail('an operational acknowledgement is not a reply-only task')}
  for (const message of ['好','得','照頭先咁']){
    assert.equal(await answerContinuation(message,fromSavedConversation({messages:unsafeWhileOlder},message),adapter),null)
  }
  const closed=[{role:'user',content:'就咁收尾。'},{role:'assistant',content:'收到。'}]
  assert.equal(await answerContinuation('照頭先咁',fromSavedConversation({messages:closed},'照頭先咁'),adapter),null)
})


test('a reply listing several guesses is replaced only by one bounded regeneration', async () => {
  const { answerContinuation } = require('./localChatContinuation')
  const history = [{role:'user',content:'你估我諗緊乜？'},{role:'assistant',content:'你想我估吓嗎？'}]
  const token=fromSavedConversation({messages:history},'好')
  const outputs=['我估你想飲茶，或者去散步。','我估你想飲茶。']
  const calls=[]
  const adapter={providerName:'local',complete:async prompt=>{
    calls.push(JSON.parse(prompt))
    return {text:JSON.stringify({reply:outputs[calls.length-1]}),model:'local:qwen3.5:9b'}
  }}
  const result=await answerContinuation('好',token,adapter)
  assert.equal(result.reply,'我估你想飲茶。')
  assert.equal(calls.length,2)
  assert.deepEqual(calls[1].messages,calls[0].messages)
  calls.length=0
  outputs[1]=outputs[0]
  await assert.rejects(()=>answerContinuation('好',token,adapter),{code:'local_invalid_output'})
  assert.equal(calls.length,2)
})


test('object guesses preserve an explicit Owner surface relation and attached detail verbatim', async () => {
  const { answerContinuation } = require('./localChatContinuation')
  const examples = [
    ['虛構道具，小白鯨畫喺一個扁竹盒嘅蓋面，盒口用麻繩綁實。',
      '我估係一個放咗小白鯨畫入面嘅扁竹盒。',
      '小白鯨畫喺一個扁竹盒嘅蓋面，盒口用麻繩綁實。'],
    ['虛構舞台道具，紅狐狸圖案印喺一個圓錫罐嘅蓋面，罐口用藍絲帶綁實。',
      '我估係有紅狐狸圖案嘅圓錫罐，藍絲帶喺罐入面。',
      '紅狐狸圖案印喺一個圓錫罐嘅蓋面，罐口用藍絲帶綁實。']
  ]
  for (const [premise, wrongReply, expectedClue] of examples) {
    const messages = [
      {role:'user',content:premise},
      {role:'assistant',content:'收到。'},
      {role:'user',content:'你覺得我講緊邊件道具？'},
      {role:'assistant',content:'你想我估吓係邊件道具嗎？'}
    ]
    const calls = []
    const result = await answerContinuation('得', fromSavedConversation({messages}, '得'), {
      providerName:'local',
      async complete(prompt) {
        calls.push(JSON.parse(prompt))
        return {model:'local:qwen3.5:9b',text:JSON.stringify({reply:wrongReply})}
      }
    })
    assert.equal(result.reply, '我估係你頭先講嗰件道具，' + expectedClue)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].requiredReply, result.reply)
    assert.deepEqual(calls[0].messages, [...messages, {role:'user',content:'得'}])
  }
})

test('object guess projection requires a unique recent user-authored clue and a direct object question', async () => {
  const { answerContinuation } = require('./localChatContinuation')
  const recent = [
    {role:'user',content:'你覺得我講緊邊件道具？'},
    {role:'assistant',content:'你想我估吓係邊件道具嗎？'}
  ]
  const lookalike = '虛構道具，小白鯨畫喺一個扁竹盒嘅蓋面，盒口用麻繩綁實。'
  const modelReply = '我估係個竹盒。'
  for (const messages of [
    [{role:'user',content:'虛構道具，我諗緊一件物件。'},{role:'assistant',content:lookalike},...recent],
    [{role:'user',content:lookalike},{role:'assistant',content:'收到。'},
      {role:'user',content:'我而家諗緊另一件。'},{role:'assistant',content:'收到。'},...recent],
    [{role:'user',content:lookalike},{role:'assistant',content:'收到。'},
      {role:'user',content:'你覺得我下一步會點做？'},{role:'assistant',content:'你想我估吓你打算點做嗎？'}],
    [{role:'user',content:'虛構道具，小白鯨畫喺竹盒蓋面，仲有一個鐵罐。'},
      {role:'assistant',content:'收到。'},...recent]
  ]) {
    const result = await answerContinuation('好', fromSavedConversation({messages},'好'), {
      providerName:'local',complete:async()=>({model:'local:qwen3.5:9b',text:JSON.stringify({reply:modelReply})})
    })
    assert.equal(result?.reply,modelReply,JSON.stringify(messages))
  }
})
