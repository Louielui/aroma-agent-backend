'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const { validateImages, MAX_IMAGE_BYTES } = require('./imageAttachments')
const { processImageChat } = require('./imageChat')
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMsAAAAAASUVORK5CYII='
test('image validation rejects over-budget bodies and oversized dimensions before use', () => {
  const bytes = Buffer.from(PNG.slice(22), 'base64'); bytes.writeUInt32BE(4097, 16)
  for (const images of [null, [], Array(5).fill(PNG), ['data:image/png;base64,' + Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64')], ['data:image/png;base64,' + bytes.toString('base64')]]) assert.throws(() => validateImages(images))
  assert.equal(validateImages([PNG])[0].height, 1)
})
test('image chat uses bounded server history and rejects malformed provider replies', async () => {
  let captured
  const input = { message: 'Inspect', images: [PNG], history: Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: String(index) + 'x'.repeat(2500) })) }
  const result = await processImageChat(input, { complete: async (prompt, options) => { captured = { prompt: JSON.parse(prompt), options }; return { text: '{"reply":"Visible"}', model: 'gpt-6.1-sol' } } })
  assert.equal(result.reply, 'Visible'); assert.equal(captured.prompt.conversation.length, 8); assert.equal(captured.prompt.conversation[0].content[0], '4')
  assert.ok(captured.prompt.conversation.every(turn => turn.content.length === 2000)); assert.deepEqual(captured.options.images, [PNG])
  for (const text of ['plain text', '{"reply":""}', '{"reply":"ok","command":"execute"}']) await assert.rejects(processImageChat(input, { complete: async () => ({ text, model: 'gpt-6.1-sol' }) }), /invalid_image_reply/)
})
