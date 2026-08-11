'use strict'
/**
 * claudeBlocks.test.js — every block is read, and an unreadable response is an ERROR.
 *
 * ⛔ NO NETWORK. The transport is a fake returning the shapes the API really produces.
 *
 * HR-68: `content[0].text || ''` yielded '' on a thinking model, and five layers turned that
 * silence into a week of conclusions about the model.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { ClaudeAdapter } = require('./ClaudeAdapter')

const ENV = { CLAUDE_MODEL: 'claude-opus-5', ANTHROPIC_API_KEY: 'k' }
async function withEnv (fn) {
  const saved = {}
  for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}
const returns = (data) => async () => ({ data })
const base = { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }

test('*** ⛔ a thinking-only response THROWS, and names the budget as the cause ***', async () => {
  await withEnv(async () => {
    // The measured shape: opus-5, max_tokens 2048, one thinking block, no text.
    const t = returns(Object.assign({}, base, {
      stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '…' }]
    }))
    const e = await new ClaudeAdapter({ transport: t }).complete('hi').then(() => null, (x) => x)
    assert.ok(e, '⛔ this must NOT come back as an empty string')
    assert.equal(e.unreadableResponse, true)
    assert.equal(e.spentOnThinking, true, 'the caller can tell this from a malformed response')
    assert.match(e.message, /spent thinking/)
    assert.match(e.message, /max_tokens/, 'and the stop_reason is in the message')
  })
})

test('*** text is read from EVERY block, not just the first ***', async () => {
  await withEnv(async () => {
    const t = returns(Object.assign({}, base, {
      content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }]
    }))
    const r = await new ClaudeAdapter({ transport: t }).complete('hi')
    // ⛔ THE OLD CODE RETURNED '' HERE — the first block is thinking. A JSON envelope split
    // across two text blocks would also have arrived truncated and unparseable.
    assert.equal(r.text, '{"a":1}')
  })
})

test('*** ⛔ an unknown block type is an ERROR that names what it saw ***', async () => {
  await withEnv(async () => {
    const t = returns(Object.assign({}, base, { content: [{ type: 'tool_use', id: 'x' }] }))
    const e = await new ClaudeAdapter({ transport: t }).complete('hi').then(() => null, (x) => x)
    assert.equal(e.unreadableResponse, true)
    assert.equal(e.spentOnThinking, false)
    assert.match(e.message, /tool_use/, 'the shape it could not read is in the message')
    assert.deepEqual(e.blockKinds, ['tool_use'])
  })
})

test('*** ⛔ a missing content array is an error, not silence ***', async () => {
  await withEnv(async () => {
    const e = await new ClaudeAdapter({ transport: returns(Object.assign({}, base, { content: undefined })) })
      .complete('hi').then(() => null, (x) => x)
    assert.equal(e.unreadableResponse, true)
    // `|| ''` is the same shape as `|| []` and a silent NO_EVIDENCE: silence where the truth
    // was "I could not read this".
    assert.match(e.message, /no content array/)
  })
})

test('*** an ordinary text response is unchanged ***', async () => {
  await withEnv(async () => {
    const t = returns(Object.assign({}, base, { content: [{ type: 'text', text: 'hello' }] }))
    const r = await new ClaudeAdapter({ transport: t }).complete('hi')
    assert.equal(r.text, 'hello')
    assert.equal(r.stopReason, 'end_turn')
  })
})
