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
