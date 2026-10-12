'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const express = require('express')
const { createDemoRouter } = require('./demoRouter')
const { createConversationStore } = require('../store/conversationStore')
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMsAAAAAASUVORK5CYII='
async function fixture(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-image-chat-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const store = createConversationStore({ dataDir }), calls = []
  let ordinary = 0
  const app = express(); app.use(express.json({ limit: '9mb' })); app.locals.conversationDemo = options.demoOn !== false
  // The ephemeral fixture represents the fixed loopback application origin.
  app.use((req, res, next) => { req.headers.host = '127.0.0.1:8090'; next() })
  app.use(createDemoRouter({ conversationStore: store, processIntakeFn: async () => { ordinary++; throw Error('ordinary intake must not run') },
    imageAdapterFn: selection => ({ async complete(prompt, opts) {
      calls.push({ selection, prompt, opts })
      if (options.fail) throw Error('provider failure containing private data')
      return { text: JSON.stringify({ reply: '這張圖片只有一個像素。' }), model: selection.model, billing: 'chatgpt-subscription', stopReason: 'end_turn' }
    } }) }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const send = async (body, headers = {}) => {
    const r = await fetch('http://127.0.0.1:' + server.address().port + '/api/v1/demo/image-intake', { method: 'POST', headers: { 'content-type': 'application/json', host: '127.0.0.1:8090', origin: 'http://127.0.0.1:8090', ...headers }, body: JSON.stringify(body) })
    return { status: r.status, body: await r.json() }
  }
  return { store, calls, send, ordinary: () => ordinary }
}
const request = () => ({ message: '這是什麼？', conversationId: 'image-chat-fixture', images: [PNG], chatModel: 'gpt-6.1-sol', chatLevel: 'medium' })
test('image chat sends actual pixels to the selected subscription model and persists a refreshable attachment', async t => {
  const f = await fixture(t), r = await f.send(request())
  assert.equal(r.status, 200); assert.equal(r.body.reply, '這張圖片只有一個像素。'); assert.equal(r.body.servedBy, 'gpt-6.1-sol')
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].selection, { model: 'gpt-6.1-sol', effort: 'medium' })
  assert.deepEqual(f.calls[0].opts.images, [PNG]); assert.equal(f.ordinary(), 0)
  const user = f.store.get('image-chat-fixture').messages[0]
  assert.equal(user.images[0].dataUrl, PNG); assert.equal(user.images[0].width, 1); assert.match(user.images[0].sha256, /^[a-f0-9]{64}$/)
  assert.equal(r.body.historySaved, true)
})
test('invalid images, external destinations and execution-shaped fields stop before any provider or store call', async t => {
  const f = await fixture(t)
  for (const input of [[], Array(5).fill(PNG), ['https://example.com/a.png'], ['C:/private.png'], ['data:image/svg+xml;base64,PHN2Zz4='], [PNG.slice(0, -12)]]) {
    assert.equal((await f.send({ ...request(), images: input })).status, 400)
  }
  for (const extra of [{ interactionMode: 'proposal' }, { attachSection: 'invoices' }, { command: 'delete' }, { approval: true }, { chatModel: 'unknown' }]) assert.equal((await f.send({ ...request(), ...extra })).status, 400)
  assert.equal((await f.send(request(), { origin: 'http://untrusted.example' })).status, 403)
  assert.equal(f.calls.length, 0); assert.deepEqual(f.store.list(), [])
})
test('disabled demo and provider failure are explicit and preserve existing conversation bytes', async t => {
  const off = await fixture(t, { demoOn: false }); assert.equal((await off.send(request())).status, 403); assert.equal(off.calls.length, 0)
  const f = await fixture(t, { fail: true }); f.store.appendTurn({ id: request().conversationId, userText: 'Existing turn', replyText: 'Kept' })
  const before = JSON.stringify(f.store.get(request().conversationId)), r = await f.send(request())
  assert.equal(r.status, 503); assert.ok(r.body.error.message); assert.equal(JSON.stringify(r.body).includes('private data'), false)
  assert.equal(JSON.stringify(f.store.get(request().conversationId)), before)
})
