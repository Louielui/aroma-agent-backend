'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { PassThrough } = require('node:stream')
const { readUtf8 } = require('./structuredStore')
test('PostgreSQL transport preserves Chinese split across pipe chunks', async () => {
  const expected = { text: 'Owner source: 結論、資料來源與記憶。', details: { goal: '我偏好先顯示結論' } }
  const stream = new PassThrough(); let result = ''
  readUtf8(stream, chunk => { result += chunk })
  const ended = new Promise(resolve => stream.on('end', resolve))
  for (const byte of Buffer.from(JSON.stringify(expected))) stream.write(Buffer.from([byte]))
  stream.end(); await ended
  assert.deepEqual(JSON.parse(result), expected)
  assert.equal(result.includes('\uFFFD'), false)
})
