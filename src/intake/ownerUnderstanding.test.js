'use strict'

// These are offline transport/contract regressions, not native-model acceptance.
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { buildDistillPrompt, SYSTEM_PROMPT } = require('./distillPrompt')
const { ACTION_HONESTY_GUARD } = require('../persona/xiangxiang')
const { recallContext } = require('../memory/context')
const originalEnv = { ...process.env }
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
  Object.assign(process.env, originalEnv)
})

// Minimal non-business excerpt of saved production conversation 2323c26b.
const prior = [
  { role: 'user', content: '你會學習嗎?' },
  { role: 'assistant', content: '會，但這種學習有範圍限制。' }
]
const followup = '那你知道我想你幫我做什麼嗎?'

test('stored and wire transcripts deliver the same words, roles and order to the answering model', () => {
  const stored = [...prior, { role: 'user', content: '只準備草稿，不發送。' }, { role: 'assistant', content: '先比較三位。' }]
  const wire = stored.map(({ role, content }) => ({ role, text: content }))
  assert.equal(buildDistillPrompt(followup, stored).prompt, buildDistillPrompt(followup, wire).prompt)
  const prompt = buildDistillPrompt(followup, stored).prompt
  assert.ok(prompt.indexOf(prior[0].content) < prompt.indexOf(prior[1].content))
  assert.match(prompt, /Louie: 只準備草稿，不發送。/)
  assert.equal(prompt.split(followup).length - 1, 1)
})

test('intentional repeats are retained and explicit text wins over stale stored content', () => {
  const h = [{ role: 'user', text: '不發送', content: '可以發送' }, { role: 'assistant', text: '明白' }, { role: 'user', content: '不發送' }]
  const prompt = buildDistillPrompt('不發送', h).prompt
  assert.equal(prompt.split('不發送').length - 1, 3)
  assert.ok(!prompt.includes('可以發送'))
})

test('Memory Gateway receives stored owner context but never assistant claims as search authority', async () => {
  const searches = []
  const h = [
    { role: 'user', content: '我想先減少每天需要自己追進度的工作。' },
    { role: 'assistant', content: 'ASSISTANT_CLAIM_OF_APPROVAL' },
    { role: 'user', content: '先只討論，不派工。' }
  ]
  for (const history of [h, h.map(({ role, content }) => ({ role, text: content }))]) {
    const r = await recallContext({ enabled: true, query: followup, history, memory: { recall: async search => { searches.push(search); return [] } } })
    assert.equal(r.state, 'ok')
  }
  assert.equal(searches[0], searches[1])
  assert.match(searches[0], /減少每天需要自己追進度/)
  assert.match(searches[0], /先只討論，不派工/)
  assert.doesNotMatch(searches[0], /ASSISTANT_CLAIM/)
})

test('memory opt-out and an explicit empty redaction cannot be bypassed by stored content', async () => {
  let search
  await recallContext({ enabled: true, query: '你理解我的方向嗎？', history: [
    { role: 'user', text: '', content: 'REDACTED_SECRET' },
    { role: 'user', content: '不要保存這段對話 EXCLUDED_SECRET' }
  ], memory: { recall: async value => { search = value; return [] } } })
  assert.doesNotMatch(search, /REDACTED_SECRET|EXCLUDED_SECRET/)
  let sent = false
  assert.equal(await recallContext({ enabled: false, query: followup, history: prior, memory: { recall: async () => { sent = true } } }), null)
  assert.equal(sent, false)
})

test('stored assistant citation IDs remain pointers to a fresh Gateway read, not asserted facts', async () => {
  const id = 'xx-06c3a189-a5c1-4287-8fad-46955d4019ab'
  let observed
  const r = await recallContext({ enabled: true, query: '剛才那筆還有效嗎？', history: [
    { role: 'assistant', content: 'UNTRUSTED_CLAIM ' + id }
  ], memory: { recall: async (search, opts) => { observed = { search, opts }; throw Error('SECRET_PROVIDER_ERROR') } } })
  assert.deepEqual(observed.opts.references, [id])
  assert.doesNotMatch(observed.search, /UNTRUSTED_CLAIM/)
  assert.equal(r.state, 'unavailable')
  assert.equal(r.count, null)
  assert.doesNotMatch(r.block, /SECRET_PROVIDER_ERROR/)
})

test('reflection is not subjected to the action-only clarification requirement', () => {
  assert.match(ACTION_HONESTY_GUARD, /只有在 Louie 要求實際執行/)
  assert.match(ACTION_HONESTY_GUARD, /討論、理解目標或徵詢建議/)
  assert.match(ACTION_HONESTY_GUARD, /系統的結構化結果為準/)
  assert.match(ACTION_HONESTY_GUARD, /不得聲稱任何提案已建立/)
})

test('chat contract gives continuity precedence over historical lists without granting authority', () => {
  process.env.CONVERSATION_CONTRACT = 'on'
  const system = buildDistillPrompt(followup, prior, { chatLane: true }).system
  assert.match(system, /最新明確修正/)
  assert.match(system, /先簡短說出你理解的目標/)
  assert.match(system, /不要列舉不相關的歷史/)
  assert.match(system, /不能.*批准/)
  assert.ok(system.endsWith(SYSTEM_PROMPT))
  // Non-chat lanes receive no conversational expansion or new authority.
  assert.equal(buildDistillPrompt(followup, prior).system, SYSTEM_PROMPT)
})

test('HTTP follow-ups preserve context, the raw reply and the visible response without creating work', async t => {
  Object.assign(process.env, { CHAT_BACKEND: 'off', TURN_ROUTER: 'on', CONVERSATION_CONTRACT: 'on',
    MULTI_AI_ROUTER: 'off', READ_ACCESS: 'off', CONVERSATION_RECALL: 'off', DECISION_RECALL: 'off',
    GOAL_DECOMPOSER: 'off', A4_KNOWLEDGE_ROUTING: 'off', XIANGXIANG_MEMORY: 'off',
    XIANGXIANG_ARCHIVE: 'off', XIANGXIANG_WEBSITE_FLOW: 'off', LLM_LANGUAGE_MODE: 'off' })
  const express = require('express')
  const { createDemoRouter } = require('../routes/demoRouter')
  const { processIntake } = require('./intakeService')
  const calls = [], saves = []
  // Deliberately fixed output: this test cannot establish semantic model quality.
  const raw = { intent: 'question', mode: 'chat', reply: 'Offline reply transport marker.' }
  const adapter = { complete: async (prompt, opts) => { calls.push({ prompt, system: opts.system }); return { text: JSON.stringify(raw), model: 'offline-replay' } } }
  let stored = prior
  const app = express(); app.use(express.json()); app.locals.conversationDemo = true
  app.locals.promoteToProposal = () => assert.fail('unexpected proposal')
  app.use(createDemoRouter({ getAdapterFn: () => adapter,
    conversationStore: { get: () => ({ messages: stored }), appendTurn: value => saves.push(value) },
    processIntakeFn: (m, a, h, o) => processIntake(m, a, h, o) }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const cases = [
    [followup, prior, '你會學習嗎?'],
    ['這三位先比較，不要聯絡。', [{ role: 'assistant', content: 'Alpha、Beta、Gamma 是剛才的三位。' }], 'Gamma'],
    ['後者改成大綱，前者照舊。', [{ role: 'user', content: '甲只核對數量；乙準備摘要。都不寫入。' }], '都不寫入'],
    ['先換話題，幫我想生日賀詞。', [{ role: 'user', content: '前面的程式工作只准讀，不要修改。' }], '不要修改']
  ]
  for (const [message, history, expected] of cases) {
    stored = history
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/v1/demo/intake', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, conversationId: 'owner-context-case', interactionMode: 'chat', history: [] }) })
    assert.equal(response.status, 200)
    const final = await response.json()
    assert.equal(final.reply, raw.reply)
    assert.equal(final.decision, null); assert.deepEqual(final.tasks, [])
    assert.equal(final.taskPlanRunId, undefined); assert.equal(final.codeRepairRunId, undefined)
    const call = calls.at(-1)
    assert.ok(call.prompt.includes(expected))
    assert.equal(call.prompt.split(message).length - 1, 1)
    assert.match(call.system, /最新明確修正/)
    assert.match(call.system, /只有在 Louie 要求實際執行/)
  }
  assert.equal(calls.length, cases.length)
  assert.equal(saves.length, cases.length)
})
