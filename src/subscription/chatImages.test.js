'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const { CodexSubscriptionAdapter } = require('../adapters/CodexSubscriptionAdapter')
const { validateInput } = require('./bridge')
const { createBridge } = require('./bridge')
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMsAAAAAASUVORK5CYII='
test('image service composes with the real subscription adapter structured-response contract', async () => {
  let captured
  const adapter = new CodexSubscriptionAdapter({ request: async (route, input) => {
    captured = validateInput(input)
    return { text: '{"reply":"Visible pixels"}', model: input.model, billing: 'chatgpt-subscription', stopReason: 'end_turn' }
  } })
  const reply = await require('../chat/imageChat').processImageChat({ message: 'Inspect', images: [PNG] }, adapter)
  assert.equal(reply.reply, 'Visible pixels'); assert.deepEqual(captured.images, [PNG])
  assert.equal(captured.schema.required[0], 'reply'); assert.equal(captured.schema.additionalProperties, false)
})
test('subscription adapter and bridge retain image pixels without allowing path or tool settings', async () => {
  let captured
  const a = new CodexSubscriptionAdapter({ request: async (route, input) => { captured = validateInput(input); return { text: 'ok', model: input.model, billing: 'chatgpt-subscription', stopReason: 'end_turn' } } })
  await a.complete('Inspect the attachment', { images: [PNG] })
  assert.deepEqual(captured.images, [PNG]); assert.equal(captured.model, 'gpt-6.1-sol'); assert.equal(captured.effort, 'medium')
  for (const extra of [{ images: ['https://example.com/p.png'] }, { tools: [] }, { path: 'C:/secret' }]) assert.throws(() => validateInput({ prompt: 'Inspect', ...extra }))
})

test('authenticated bridge transports a real PNG larger than the previous one megabyte body cap', async t => {
  const { randomBytes } = require('node:crypto'), { deflateSync } = require('node:zlib')
  function chunk(type, content) {
    const body = Buffer.concat([Buffer.from(type), content]), result = Buffer.alloc(content.length + 12)
    let crc = 0xffffffff
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
    result.writeUInt32BE(content.length); body.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
    return result
  }
  const width = 640, height = 600, header = Buffer.alloc(13), rows = Buffer.alloc(height * (width * 3 + 1))
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  for (let y = 0; y < height; y++) randomBytes(width * 3).copy(rows, y * (width * 3 + 1) + 1)
  const pixels = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
  const body = { prompt: 'Inspect pixels', images: [pixels], model: 'gpt-6.1-sol', effort: 'medium' }
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 1024 * 1024)
  let captured, calls = 0
  const token = 'e'.repeat(64), server = createBridge({ token, completeFn: async (options, input) => { calls++; captured = input; return { text: 'ok' } } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const send = (body, authorization = 'Bearer ' + token) => fetch('http://127.0.0.1:' + server.address().port + '/complete', { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await send(body, 'bad')).status, 401); assert.equal(calls, 0)
  const response = await send(body)
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal(captured.images.length, 1); assert.ok(captured.images[0] === pixels)
  assert.equal(captured.model, 'gpt-6.1-sol'); assert.equal(captured.effort, 'medium')
})
