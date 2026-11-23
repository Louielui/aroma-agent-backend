'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildDistillPrompt, SYSTEM_PROMPT } = require('./distillPrompt')

const draft = 'Rewrite the staff card in four lines, making the tray white and keeping everything else.'
const manualLocalChat = { localOnly: true, chatLane: true, manualLocalDialogue: true }

test('manual local chat defines text drafting, retained details, exact format and essential clarification', () => {
  const { system } = buildDistillPrompt(draft, [], manualLocalChat)
  assert.match(system, /只需在本則回覆交付文字/)
  assert.match(system, /「其他照舊」.*逐項寫出/)
  assert.match(system, /指定一句.*直接交付/)
  assert.match(system, /只問缺少的關鍵資料/)
  assert.match(system, /草稿兼要求實際寄送.*mode="commit"/)
  assert.doesNotMatch(system, /做\/建立\/改\/停\/查\/派工/)
})

test('proposal and other callers retain the existing classifier contract', () => {
  for (const options of [
    { localOnly: true, chatLane: false, manualLocalDialogue: true },
    { localOnly: false, chatLane: true, manualLocalDialogue: true },
    { localOnly: true, chatLane: true }
  ]) {
    assert.ok(buildDistillPrompt(draft, [], options).system.endsWith(SYSTEM_PROMPT))
  }
})

const { isDraftRequest } = require('./localChatDraft')

test('focused local writing recognizes a draft and explicit formatting revisions', () => {
  const prior = 'Draft a two-line notice here.'
  assert.equal(isDraftRequest(prior, [prior]), true)
  assert.equal(isDraftRequest('換咗房名，其他照舊，照原格式再寫。', [prior, '換咗房名，其他照舊，照原格式再寫。']), true)
  assert.equal(isDraftRequest('只改日期，其他照舊。', []), false)
  assert.equal(isDraftRequest('用一句覆述成個安排。', []), true)
})

test('focused local writing leaves actual reads, writes and mixed send requests on the original path', () => {
  for (const message of [
    '寫一句通知，然後寄畀員工。',
    'Update the production database and write the two-line summary.',
    '先查證今天的正式庫存，再寫一句通知。',
    '改寫通知，再儲存到桌面。',
    'Draft a two-line notice, then send it to the shift lead.',
    '把公告寫入 C:/Aroma/public/notice.txt，跟原格式。',
    '改掉工作單上的員工名。',
    '睇睇今日嘅庫存，再寫一句通知。',
    '幫我列出今朝 Pantry 有幾多存貨，用兩句寫。',
    '寫一句通知，順便幫我修改網站上嘅餐牌。',
    '用一句寫通知，然後放到官網。',
    '幫我覆述過去嘅通知，逐行列出。'
  ]) assert.equal(isDraftRequest(message, []), false, message)
})

test('real manual-chat commit still cannot create a proposal or dispatch', async t => {
  const { processIntake } = require('./intakeService')
  const overrides = { LOCAL_BRAIN_ONLY: '1', A4_KNOWLEDGE_ROUTING: 'off', TURN_ROUTER: 'off',
    MULTI_AI_ROUTER: 'off', GOAL_DECOMPOSER: 'off', READ_ACCESS: 'off', XIANGXIANG_MEMORY: 'off' }
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]))
  Object.assign(process.env, overrides)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const fake = { providerName: 'local', preflight: async () => {}, complete: async (_, options) => {
    assert.match(options.system, /草稿兼要求實際寄送/)
    return { model: 'local:test', text: JSON.stringify({ intent: 'task', mode: 'commit', reply: 'I have sent it.',
      decision: { statement: 'Send now' }, tasks: [{ title: 'Send the draft', capability: 'execution' }] }) }
  } }
  let promoted = 0
  for (const message of ['寫一句通知，然後寄畀員工。', '更新正式倉存系統的產品紀錄。']) {
    const result = await processIntake(message, fake, [], {
      demo: true, manualLocalDialogue: true, interactionMode: 'chat',
      promoteToProposal: async () => { promoted++ }
    })
    assert.match(result.reply, /我未有建立提案/)
    assert.equal(result.talkOnly, true)
    assert.equal(result.decision, null)
    assert.deepEqual(result.tasks, [])
    assert.equal(result.proposals, undefined)
  }
  assert.equal(promoted, 0)
})

test('draft formatting preserves validated lines and keeps commit replies on the action guard', () => {
  const { parseDistillResponse } = require('./distillPrompt')
  const reply = { intent: 'context', mode: 'chat', reply: 'I will write the card.',
    lines: ['Wood background', 'Label: rehearsal', 'Night staff only'] }
  assert.equal(parseDistillResponse(JSON.stringify(reply), {}, { lineCount: 3 }).reply,
    'Wood background\nLabel: rehearsal\nNight staff only')
  assert.equal(parseDistillResponse(JSON.stringify(reply), {}, { lineCount: 4 }).reply, reply.reply)
  assert.equal(parseDistillResponse(JSON.stringify({ ...reply, mode: 'commit' }), {}, { lineCount: 3 }).reply, reply.reply)
  assert.equal(parseDistillResponse(JSON.stringify({ ...reply, nextRead: { capability: 'aroma_system.inventory' } }),
    {}, { lineCount: 3 }).reply, reply.reply)
})

test('explicit draft constraints preserve the latest format and already specified start times', () => {
  const { requestedLineCount, needsStartTime, responseFormat, clarifyStartTime } = require('./localChatDraft')
  assert.equal(clarifyStartTime({ mode: 'chat', reply: '朝早開始。' }).reply, '幾點開始？')
  for (const reply of [{ mode: 'commit' }, { mode: 'chat', nextRead: { capability: 'aroma_system.inventory' } }]) {
    assert.equal(clarifyStartTime(reply), reply)
  }
  const question = '寫虛構通知，要有確實開始時間。星期三朝早，憑票入場。'
  assert.equal(needsStartTime(question, 0), true)
  for (const end of ['上午十點。', '朝早 9 點。', '11:45。', '10 am。', '正午。', '開始時間另行通知。', '然後寄畀同事。']) {
    assert.equal(needsStartTime(question + end, 0), false, end)
  }
  assert.equal(needsStartTime(question, 2), false)
  assert.equal(requestedLineCount('照頭先三行格式再寫。'), 3)
  assert.equal(requestedLineCount('用12行寫。'), 12)
  assert.equal(requestedLineCount('依家交完整一句通知。'), 1)
  assert.equal(requestedLineCount('用一行寫三句通知。'), 1)
  assert.equal(requestedLineCount('寫一行通知，內容係請大家排成兩行。'), 1)
  assert.equal(requestedLineCount('寫一句告示：「請排成兩行。」'), 1)
  assert.equal(requestedLineCount('用22行寫。'), null)
  assert.equal(requestedLineCount('原本寫三行通知，依家要四行。'), 4)
  assert.equal(isDraftRequest('草稿寫一句通知，必須寫確切開始時間；另外將早班改成朝十一至夜七。', []), false)
  const originalRead = { anyOf: [{ type: 'null' }, { type: 'object' }] }
  const format = responseFormat({ schema: { properties: { nextRead: originalRead } } }, { lineCount: 3, startTimeMissing: true })
  assert.equal(format.schema.properties.nextRead, originalRead)
  assert.ok(format.schema.properties.mode.enum.includes('commit'))
  const readMode = { type: 'string', enum: ['recommend', 'ask', 'chat'] }
  const readFormat = responseFormat({ schema: { properties: { nextRead: originalRead, mode: readMode } } },
    { lineCount: null, startTimeMissing: false })
  assert.equal(readFormat.schema.properties.mode, readMode)
})

test('draft format restores an exact exclusive audience without overriding a changed recipient', () => {
  const { requestedAudience, renderDraftLines } = require('./localChatDraft')
  const initial = '寫三行虛構卡。白紙；試用標籤；只供晚班同事睇。'
  const edit = '換綠紙，其餘照舊。照頭先三行格式再寫。'
  const render = (message, value) => renderDraftLines(['綠紙', '標籤：試用', value], requestedAudience(message, [initial, message]))
  assert.equal(render(edit, '對象：晚班同事'), ['綠紙', '標籤：試用', '只供晚班同事睇'].join(String.fromCharCode(10)))
  assert.match(render('改受眾為早班同事，其餘照舊。', '對象：早班同事'), /對象：早班同事$/u)
  assert.match(render(edit, '對象：早班及晚班同事'), /對象：早班及晚班同事$/u)
  assert.equal(requestedAudience('改做白檯卡，其餘照舊，今次早班同事都可以睇', [initial, '改做白檯卡，其餘照舊，今次早班同事都可以睇']), null)
})

// First formal PR228 turn. Retain the original punctuation and three fields.
const formalDraft = '幫我寫虛構活動提示卡，要分三行，每行一項。底紙淺黃色；標籤寫『排練』；只供幕後同事睇。'

test('the saved PR228 chat/task reply cannot cause a file clarification for inline writing', () => {
  const { explainOffer, WORK_REQUEST_STATE } = require('../routes/workRequestOffer')
  const receipt = { mode: 'chat', intent: 'task', reply: '這是提案，等待 Louie 批准。' }
  assert.equal(explainOffer({ message: formalDraft, response: receipt }).state, WORK_REQUEST_STATE.NOT_A_WORK_REQUEST)
  assert.equal(explainOffer({ message: formalDraft }).state, WORK_REQUEST_STATE.NOT_A_WORK_REQUEST)
  for (const message of [
    '幫我改個訂貨頁',
    '幫我改 docs/canary/agent-canary.md，第二行改成排練',
    formalDraft + '再幫我改 docs/canary/agent-canary.md。',
    formalDraft + '改埋嗰個檔。',
    formalDraft + '改埋個訂貨頁。',
    formalDraft + '個檔改埋佢。',
    formalDraft + '修改首頁校色。'
  ]) {
    assert.notEqual(explainOffer({ message, response: receipt }).state, WORK_REQUEST_STATE.NOT_A_WORK_REQUEST, message)
  }
})

test('only a complete inline drafting shape can skip historical and operational routing', () => {
  const { isInlineDraftRequest } = require('./localChatDraft')
  assert.equal(isInlineDraftRequest(formalDraft), true)
  assert.equal(isInlineDraftRequest('唔該幫我寫一張虛構展示卡，用三行。底色淡綠色；標籤寫「彩排」；只供晚班同事看。'), true)
  for (const tail of [
    '睇下今朝有幾多牛肉。',
    '排練完刪掉臨時檔。',
    '由舊資料補埋上個版本嘅標籤。',
    '標籤寫排練兼改首頁。',
    '然後寄畀員工。'
  ]) assert.equal(isInlineDraftRequest(formalDraft + tail), false, tail)
})

test('manual local production-shaped drafting keeps the three lines with memory enabled', async t => {
  const { processIntake } = require('./intakeService')
  const { fromSavedConversation } = require('./conversationEvidence')
  const { explainOffer, WORK_REQUEST_STATE } = require('../routes/workRequestOffer')
  const flags = { LOCAL_BRAIN_ONLY: '1', A4_KNOWLEDGE_ROUTING: 'on', TURN_ROUTER: 'on',
    MULTI_AI_ROUTER: 'on', GOAL_DECOMPOSER: 'off', READ_ACCESS: 'on', XIANGXIANG_MEMORY: 'on' }
  const previous = Object.fromEntries(Object.keys(flags).map(key => [key, process.env[key]]))
  Object.assign(process.env, flags)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const historical = 'Unrelated archived staging notes'
  let recallReads = 0
  const memoryClient = {
    preferences: async () => ({ state: 'ok', items: [], total: 0 }),
    recall: async () => {
      recallReads++
      return [{ documentId: 'xx-6105a355-4c9b-4ad1-a173-956452dd1abb', text: historical }]
    }
  }
  let answerSchema
  const lines = ['底紙：淺黃色', '標籤：排練', '只供幕後同事睇']
  const adapter = { providerName: 'local', preflight: async () => {}, complete: async (prompt, opts) => {
    assert.equal(opts.invocationPhase, 'answer')
    answerSchema = opts.responseFormat?.name
    const focused = answerSchema === 'local_chat_draft'
    if (focused) {
      assert.ok(prompt.includes(formalDraft))
      assert.ok(!prompt.includes(historical))
    }
    return { model: 'local:test', text: JSON.stringify({ mode: 'chat', intent: 'task', nextRead: null,
      reply: focused ? lines.join('\n') : '這是提案，等待 Louie 批准。', ...(focused && { lines }) }) }
  } }
  const result = await processIntake(formalDraft, adapter, [], {
    demo: true, manualLocalDialogue: true, interactionMode: 'chat',
    conversationEvidence: fromSavedConversation({ messages: [] }, formalDraft),
    memoryClient, readContextDeps: { sources: [] }, semanticCallModel: async () => '{"intent":"conversation"}'
  })
  assert.equal(answerSchema, 'local_chat_draft')
  assert.equal(recallReads, 0)
  assert.equal(result.reply, lines.join('\n'))
  assert.equal(explainOffer({ message: formalDraft, response: result }).state, WORK_REQUEST_STATE.NOT_A_WORK_REQUEST)
})
