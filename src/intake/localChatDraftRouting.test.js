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

test('same-thread colour correction delivers the three card lines from saved Owner text', async t => {
  const { processIntake } = require('./intakeService')
  const { fromSavedConversation } = require('./conversationEvidence')
  const { explainOffer, WORK_REQUEST_STATE } = require('../routes/workRequestOffer')
  const previous = process.env.LOCAL_BRAIN_ONLY
  process.env.LOCAL_BRAIN_ONLY = '1'
  t.after(() => {
    if (previous === undefined) delete process.env.LOCAL_BRAIN_ONLY
    else process.env.LOCAL_BRAIN_ONLY = previous
  })
  const message = '換做淺灰色底紙，其餘照舊。照頭先三行格式再寫。'
  const saved = { messages: [
    { role: 'user', content: formalDraft },
    { role: 'assistant', content: '底紙採用淺黃色設計。\n標籤寫上『排練』字樣。\n內容僅供幕後同事參考。' }
  ] }
  const adapter = { preflight: async () => assert.fail('a supplied card correction needs no model') }
  const result = await processIntake(message, adapter, [], {
    demo: true, interactionMode: 'chat', manualLocalDialogue: true,
    conversationEvidence: fromSavedConversation(saved, message)
  })
  assert.equal(result.reply, '底紙淺灰色\n標籤寫『排練』\n只供幕後同事睇')
  assert.equal(result.mode, 'chat')
  assert.equal(result.decision, null)
  assert.deepEqual(result.tasks, [])
  assert.equal(explainOffer({ message, response: result }).state, WORK_REQUEST_STATE.NOT_A_WORK_REQUEST)
})

test('a fictional card revision requires a complete immediate draft and a colour-only request', () => {
  const { reviseInlineCard } = require('./localChatDraft')
  const { explainOffer, WORK_REQUEST_STATE } = require('../routes/workRequestOffer')
  const change = '改成淡綠色底紙，其他照舊。照返原本3行格式再寫。'
  const prior = '寫一張虛構展示卡，用三行。標籤寫「彩排」；底紙白色；只供夜班同事看。'
  assert.equal(reviseInlineCard(change, [prior, change]), '標籤寫「彩排」\n底紙淡綠色\n只供夜班同事看')
  for (const ownerMessages of [
    [change],
    [prior, '第二個話題', change],
    [prior.replace('；只供夜班同事看', ''), change],
    [prior.replace('底紙白色', '底紙白色；底紙黑色'), change],
    [prior.replace('用三行', '用四行，用三行'), change],
    [prior.replace('虛構', '正式'), change]
  ]) assert.equal(reviseInlineCard(change, ownerMessages), null, ownerMessages.join(' / '))
  for (const operation of [
    '幫我改 docs/canary/agent-canary.md。',
    '個檔改埋佢。',
    '修改首頁顏色。',
    '再查今日庫存。',
    '發送這張卡。'
  ]) {
    const mixed = change + operation
    assert.equal(reviseInlineCard(mixed, [prior, mixed]), null, mixed)
  }
  const mixedFile = change + ' 幫我改 docs/canary/agent-canary.md。'
  const offer = explainOffer({ message: mixedFile, response: { mode: 'chat', intent: 'task' } })
  assert.equal(offer.state, WORK_REQUEST_STATE.COMPLETE)
  assert.equal(offer.offer.file, 'docs/canary/agent-canary.md')
})

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

const failedNotice = "幫我寫一句虛構讀書會通知，必須寫日期、房名、確實開始時間同入場方式。星期四朝早喺海桐室，憑紫色卡入場。"
const completeNotice = '朝早十點十五分。其他照舊，依家交完整一句通知。'
const noticeQuestion = '幾點開始？'

test('the saved PR231 notice asks only for the start time and completes from the same conversation', async t => {
  const { processIntake } = require('./intakeService')
  const { fromSavedConversation } = require('./conversationEvidence')
  const { explainOffer, WORK_REQUEST_STATE } = require('../routes/workRequestOffer')
  const original = process.env.LOCAL_BRAIN_ONLY
  process.env.LOCAL_BRAIN_ONLY = '1'
  t.after(() => {
    if (original === undefined) delete process.env.LOCAL_BRAIN_ONLY
    else process.env.LOCAL_BRAIN_ONLY = original
  })
  const adapter = { preflight: async () => assert.fail('a bounded fictional notice needs no model') }
  const input = (message, messages) => processIntake(message, adapter, messages, {
    demo: true, interactionMode: 'chat', manualLocalDialogue: true,
    conversationEvidence: fromSavedConversation({ messages }, message)
  })
  const question = await input(failedNotice, [])
  assert.deepEqual([question.mode, question.reply, question.decision, question.tasks], ['ask', noticeQuestion, null, []])
  assert.equal(explainOffer({ message: failedNotice, response: question }).state, WORK_REQUEST_STATE.NOT_A_WORK_REQUEST)
  const history = [{ role: 'user', text: failedNotice }, { role: 'assistant', text: question.reply }]
  const notice = await input(completeNotice, history)
  assert.deepEqual([notice.mode, notice.reply, notice.decision, notice.tasks], [
    'chat', '星期四朝早十點十五分喺海桐室舉行讀書會，請憑紫色卡入場。', null, []
  ])
  assert.equal(explainOffer({ message: completeNotice, response: notice }).state, WORK_REQUEST_STATE.NOT_A_WORK_REQUEST)
})

test('the saved PR231 reply reproduces the file form on the original route', () => {
  const { explainOffer, WORK_REQUEST_STATE } = require('../routes/workRequestOffer')
  const response = { mode: 'chat', intent: 'task', reply: "**結論：** 已為你草擬好符合要求的虛構讀書會通知。\n\n- **內容：** 「星期四朝早，海桐室，憑紫色卡入場。」\n- **限制：** 此為純文字生成，尚未儲存至任何系統或發送。\n   " }
  const result = explainOffer({ message: failedNotice, response })
  assert.equal(result.state, WORK_REQUEST_STATE.INCOMPLETE)
  assert.equal(result.clarification.question, '你想改哪個檔？')
})


test('fictional notice completion uses only immediate supplied details and a valid clock', () => {
  const { replyToFictionalNotice } = require('./localChatDraft')
  const example = '請寫一句虛構畫畫班通知，要寫日期、房名、確切開始時間及入場方式。星期六下午喺紫藤室，憑藍色卡入場。'
  const followup = '下午三點半。其餘照舊，而家交完整一句通知。'
  const saved = [{ role: 'user', text: example }, { role: 'assistant', text: noticeQuestion }]
  assert.equal(replyToFictionalNotice(example, [], [example]).reply, noticeQuestion)
  assert.equal(replyToFictionalNotice(followup, saved, [example, followup]).reply,
    '星期六下午三點半喺紫藤室舉行畫畫班，請憑藍色卡入場。')
  assert.equal(replyToFictionalNotice(followup, saved, [followup]), null)
  assert.equal(replyToFictionalNotice(followup, [saved[0], { ...saved[1], text: '請提供日期。' }], [example, followup]), null)
  for (const message of [
    followup.replace('三點半', '十三點'),
    followup.replace('三點半', '三點六十分'),
    followup.replace('三點半', '三點九九分'),
    followup.replace('下午', '上午'),
    followup + '改埋個首頁。'
  ]) assert.equal(replyToFictionalNotice(message, saved, [example, message]), null, message)
  assert.equal(replyToFictionalNotice(example.replace('星期六下午', '星期六下午三點半'), [], [example]), null)
})

test('real changes mixed into a fictional notice still reach work-order approval', () => {
  const { replyToFictionalNotice } = require('./localChatDraft')
  const { explainOffer, WORK_REQUEST_STATE } = require('../routes/workRequestOffer')
  for (const message of [
    failedNotice + '幫我改 docs/canary/agent-canary.md。',
    completeNotice + '幫我改 docs/canary/agent-canary.md。'
  ]) {
    assert.equal(replyToFictionalNotice(message, [], [message]), null)
    const offer = explainOffer({ message, response: { mode: 'chat', intent: 'task' } })
    assert.equal(offer.state, WORK_REQUEST_STATE.COMPLETE)
    assert.equal(offer.offer.file, 'docs/canary/agent-canary.md')
  }
})

test('PR235 reply-only structural drafting is bound to the authenticated current thread', () => {
  const { exerciseDraftLayout } = require('./localChatDraft')
  const first = '虛構 Aroma 練習：小禾提早十分鐘返嚟，因為要同新同事試咪。將件事講成一句畀帶班聽，交代邊個、早幾耐同原因。'
  const next = '時間講錯，係早廿分鐘。試嘅係投影機，頭先講嗰兩位照舊。成句講多次畀帶班聽。'
  const rename = '新同事改做阿芷，其他照舊。成句講返最新嗰個安排畀帶班聽。'
  const card = '虛構 Aroma 演練：第一行用「做法」起頭，叫人先揭起白布，再拎走空碟。第二行用「原因」起頭，解釋係怕空碟勾住布。只畀我嗰兩行。'
  const edit = '白布改做藍布，兩個動作嘅先後同原本原因都照舊。依返頭先兩行，寫晒畀我。'
  for (const [msg, history, count] of [[first, [], 1], [next, [first], 1], [rename, [first, next], 1], [card, [], 2], [edit, [card], 2]]) {
    assert.equal(exerciseDraftLayout(msg, [...history, msg]), count, msg)
    assert.equal(exerciseDraftLayout(msg, null), null)
  }
  for (const [msg, history] of [
    [next, []], [rename, [first, '轉個話題']], [edit, [first]], [edit, [card, '轉個話題']],
    [edit + '改埋 docs/canary/agent-canary.md。', [card]],
    [edit + '寄畀帶班。', [card]],
    [edit.replace('白布', '首頁'), [card]],
    [first.replace('同新同事試咪', '讀今日倉存'), []],
    [card.replace('再拎走空碟', '改埋首頁'), []]
  ]) assert.equal(exerciseDraftLayout(msg, [...history, msg]), null, msg)
})

test('PR235 focused drafts cannot turn a model commit or a colour change into file work', async t => {
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
  const card = '虛構 Aroma 排練：第一行用「手勢」起頭，先揭起紅布，再拎走空盒。第二行用「用意」起頭，避免空盒勾住布。只俾我呢兩行。'
  const edit = '紅布換成紫布，其他照舊。照返頭先兩行，寫晒俾我。'
  const expected = ['手勢：先揭起紫布，再拎走空盒。', '用意：避免空盒勾住布。']
  const history = [{ role: 'user', text: card }, { role: 'assistant', text: '手勢：先揭起紅布。\n用意：避免空盒勾住布。' }]
  const options = {
    demo: true, manualLocalDialogue: true, interactionMode: 'chat',
    conversationEvidence: fromSavedConversation({ messages: history }, edit),
    memoryClient: {
      preferences: async () => assert.fail('a proved exercise needs no stored preferences'),
      recall: async () => assert.fail('a proved exercise needs no recall')
    },
    readContextDeps: { sources: [], finalVerifier: async () => ({ decision: 'allow_final', question: null }) },
    semanticCallModel: async () => assert.fail('a proved exercise is not a source question'),
    promoteToProposal: async () => assert.fail('a proved exercise cannot promote')
  }
  const adapter = (answer) => ({ providerName: 'local', preflight: async () => {}, complete: async (prompt, opts) => {
    const response = opts.invocationPhase === 'final_verification' ? { decision: 'allow_final', question: null } : answer
    if (opts.invocationPhase === 'answer') {
      assert.ok(prompt.includes(card) && prompt.includes(edit))
      assert.equal(opts.responseFormat?.name, 'local_chat_draft')
      assert.deepEqual(opts.responseFormat.schema.properties.mode.enum, ['chat', 'ask'])
      assert.equal(opts.responseFormat.schema.properties.lines.anyOf[1].maxItems, 2)
    }
    return { model: 'local:test', text: JSON.stringify(response) }
  } })
  for (const [response, reply] of [
    [{ mode: 'chat', intent: 'task', reply: expected.join('\n') }, expected.join('\n')],
    [{ mode: 'chat', intent: 'context', reply: '這是草稿', lines: expected }, expected.join('\n')],
    [{ mode: 'commit', intent: 'task', reply: '等待你批准後執行。', tasks: [{ title: '派工' }] }, '呢段文案未能按你指定格式完成。']
  ]) {
    const result = await processIntake(edit, adapter(response), history, { ...options })
    assert.equal(result.reply, reply)
    assert.equal(result.replyOnlyDraft, true)
    assert.equal(result.decision, null)
    assert.deepEqual(result.tasks, [])
    assert.equal(explainOffer({ message: edit, response: result }).state, WORK_REQUEST_STATE.NOT_A_WORK_REQUEST)
  }
  const schedule = '虛構 Aroma 排練：阿彤提早八分鐘返嚟，因為要同阿榮試咪。將個安排講成一句俾小隊長聽，交代邊個、早幾耐同原因。'
  const notify = '阿彤會提早八分鐘返嚟，因為要同阿榮試咪。'
  const scheduleResult = await processIntake(schedule, {
    providerName: 'local', preflight: async () => {}, complete: async (_, opts) => {
      if (opts.invocationPhase === 'final_verification') return { model: 'local:test', text: '{"decision":"allow_final","question":null}' }
      assert.equal(opts.responseFormat?.name, 'local_chat_draft')
      return { model: 'local:test', text: JSON.stringify({ mode: 'chat', intent: 'context', reply: notify, lines: [notify] }) }
    }
  }, [], { ...options, conversationEvidence: fromSavedConversation({ messages: [] }, schedule) })
  assert.equal(scheduleResult.replyOnlyDraft, true)
  assert.equal(scheduleResult.reply, notify)
  const real = edit + '幫我改 docs/canary/agent-canary.md。'
  const offer = explainOffer({ message: real, response: { replyOnlyDraft: true, mode: 'chat', intent: 'context' } })
  assert.equal(offer.offer?.file, 'docs/canary/agent-canary.md')
})
