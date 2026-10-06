'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { randomUUID } = require('node:crypto'), express = require('express')
const { createModelCenter } = require('./service'), { createTopicStore } = require('../topics/workspaces'), { createDemoRouter } = require('../routes/demoRouter')
const catalog = { billing: 'subscriptions', models: [{ model: 'claude-sonnet', available: true, efforts: ['low', 'medium', 'high'] }, { model: 'gpt-6.1-sol', available: true, efforts: ['medium', 'high'] }] }
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMsAAAAAASUVORK5CYII='
test('intake captures authoritative central/topic selection once; image and dialogue use it; corrupt settings call no provider', async t => {
  const before = process.env.CHAT_BACKEND; process.env.CHAT_BACKEND = 'codex-subscription'
  t.after(() => { if (before === undefined) delete process.env.CHAT_BACKEND; else process.env.CHAT_BACKEND = before })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-intake-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const topics = createTopicStore({ dataDir: dir }), center = createModelCenter({ dataDir: dir, catalogue: async () => catalog, topicForConversation: topics.topicForConversation })
  const cid = randomUUID(), emailId = randomUUID(); topics.link('email', emailId)
  await center.saveSelection('topic', 'email', { revision: 0, mode: 'custom', model: 'claude-sonnet', effort: 'low' })
  const choices = [], imageChoices = [], dialogueChoices = []
  let enter, release; const entered = new Promise(r => { enter = r }), held = new Promise(r => { release = r })
  const app = express(); app.locals.conversationDemo = true; app.use(express.json())
  app.use(createDemoRouter({ modelCenter: center, modelsFn: async () => catalog, getAdapterFn: () => ({}), conversationStore: { get: () => null, appendTurn: () => {} },
    processIntakeFn: async (message, adapter, history, opts) => { choices.push({ ...opts }); if (message === 'Hello held') { enter(); await held }; return { intent: 'chit_chat', mode: 'chat', reply: 'Fixture' } },
    taskDialogue: { candidate: message => message === 'Fixture dialogue', handle: async (actor, input) => { dialogueChoices.push(input); return { lane: 'chat', reply: 'Fixture' } } },
    imageAdapterFn: choice => { imageChoices.push(choice); return { complete: async () => ({ text: '{"reply":"Fixture"}', model: choice.model }) } }
  }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => server.close())
  const base = 'http://127.0.0.1:' + server.address().port
  const post = (endpoint, body) => new Promise((resolve, reject) => {
    const request = require('node:http').request(base + '/api/v1/demo/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', host: '127.0.0.1:8090', origin: 'http://127.0.0.1:8090' } }, response => { response.resume(); response.on('end', () => resolve({ status: response.statusCode })) })
    request.on('error', reject); request.end(JSON.stringify(body))
  })
  const input = { message: 'Hello held', conversationId: cid, workflowRequestId: randomUUID(), interactionMode: 'chat', chatModel: 'gpt-6.1-sol', chatLevel: 'high' }
  const first = post('intake', input); await entered
  await center.saveBrain({ revision: 0, model: 'gpt-6.1-sol', effort: 'high' }); release()
  assert.equal((await first).status, 200); assert.equal(choices[0].chatModel, 'claude-sonnet'); assert.equal(choices[0].chatLevel, 'medium')
  assert.equal((await post('intake', { ...input, message: 'Hello next' })).status, 200); assert.equal(choices[1].chatModel, 'gpt-6.1-sol'); assert.equal(choices[1].chatLevel, 'high')
  assert.equal((await post('intake', { ...input, conversationId: emailId, message: 'Fixture dialogue' })).status, 200)
  assert.equal(dialogueChoices[0].model, 'claude-sonnet'); assert.equal(dialogueChoices[0].effort, 'low')
  assert.equal((await post('image-intake', { message: 'Inspect', conversationId: emailId, images: [PNG], chatModel: 'gpt-6.1-sol', chatLevel: 'high' })).status, 200)
  assert.deepEqual(imageChoices, [{ model: 'claude-sonnet', effort: 'low' }])
  fs.writeFileSync(path.join(dir, 'model-center.json'), 'broken')
  assert.equal((await post('intake', { ...input, message: 'Hello blocked' })).status, 503)
  assert.equal(choices.length, 2); assert.equal(dialogueChoices.length, 1); assert.equal(imageChoices.length, 1)
})
