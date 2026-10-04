'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const contract = require('./contract'), { classify, PROFILES } = require('../taskPlanner/contract')
const CHAT = ['src/demo/assets/index.html', 'src/demo/assets/app.js', 'src/demo/assets/app.css']
const input = editable => ({ bootCommit: 'a'.repeat(40), requestId: randomUUID(), goal: 'Improve the chat composer', criteria: ['Composer keeps five effort choices'], editable })
test('chat page is a distinct bounded profile with three selectable committed files', () => {
  assert.deepEqual(contract.CHAT_FILES, CHAT); assert.deepEqual(PROFILES.chat, CHAT)
  assert.equal(contract.profileFor(contract.request(input(CHAT))), 'chat')
  for (const file of CHAT) assert.equal(contract.profileFor(contract.request(input([file]))), 'chat')
  for (const names of [[CHAT[0], contract.FILES[0]], [CHAT[1], contract.INTERFACE_FILES[0]], ['src/app.js'], ['../demo/app.js']]) assert.throws(() => contract.request(input(names)), /invalid_request/)
})
test('chat plans classify explicit requests without making ambiguous or production requests executable', () => {
  for (const message of ['香香，幫我改善聊天頁面的模型選單', 'plan xiangxiang chat composer buttons']) assert.equal(classify(message).profile, 'chat')
  assert.equal(classify('幫我改善聊天頁面及即時資料快照').clarification, true)
  assert.equal(classify('幫我改善production聊天頁面').clarification, true)
})
test('chat registration always protects four real-browser checks and all rendering dependencies', () => {
  const generated = { testCode: "const test=require('node:test'),assert=require('node:assert/strict');", expectedTests: 3 }, d = contract.definition(randomUUID(), input([CHAT[2]]), generated)
  assert.deepEqual(d.workOrder.allowedFiles, [CHAT[2]]); assert.equal(d.workOrder.expectedTests, 7)
  assert.ok(d.workOrder.readonlyFiles.includes(CHAT[1])); assert.ok(d.workOrder.readonlyFiles.includes('src/workers/execution/chatBrowser.cjs'))
  assert.ok(d.workOrder.protectedFiles.includes('acceptance/chat-browser.test.cjs')); assert.match(d.tests['acceptance/chat-browser.test.cjs'], /real offline browser/)
  assert.match(contract.systemFor(input([CHAT[2]])), /chat page/)
})
