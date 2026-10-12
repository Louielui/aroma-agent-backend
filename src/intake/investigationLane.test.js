'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { routeLane } = require('./laneRouter')
const { createDemoRouter } = require('../routes/demoRouter')
const questions = [
  '請查已記錄的電郵分析及記憶處理工作：哪個工作、哪次執行、用了哪個模型及多少 token？請分開模型回覆與主程序保存結果，沒有扣款證據就說未確認，不要修改設定。',
  '香香，幫我查明昨天回覆電郵的工作為什麼失敗。',
  'Investigate the recorded email reply failures and report the evidence.',
  'Please check which draft email jobs actually ran; do not send anything.'
]
test('a primary investigation request does not become correspondence because it mentions replies', () => {
  for (const text of questions) assert.equal(routeLane(text).lane, 'chat', text)
  for (const text of ['請回覆這封電郵，先查訂單狀態', 'Reply to Rob after checking the work records', '幫我回覆營運團隊', 'draft an email to Rob']) assert.equal(routeLane(text).lane, 'email_draft', text)
})
test('the unforced intake route carries a mail-work investigation into the read-only chat lane', async () => {
  const app = express(), seen = []
  app.use(express.json()); app.locals.conversationDemo = true
  app.use(createDemoRouter({ getAdapterFn: () => ({}), processIntakeFn: async (m, a, h, opts) => {
    seen.push(opts); return { mode: 'chat', talkOnly: true, reply: 'ok' }
  } }))
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve))
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/v1/demo/intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: questions[0] }) })
    assert.equal(response.status, 200); assert.equal(seen.length, 1)
    assert.equal(seen[0].interactionMode, 'chat'); assert.equal(seen[0].ownerInvestigation, true)
    assert.equal('u1DraftShadow' in seen[0], false)
    for (const key of ['agentExecute', 'workOrder', 'promoteToProposal']) assert.equal(key in seen[0], false)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
