'use strict'
/**
 * claudeTimeout.test.js — a timeout says it is a timeout.
 *
 * ⛔ NO NETWORK. The transport is a fake that throws the way axios throws.
 *
 * > **Owner: 「『佢仲喺度諗』 is a different fact from 『失敗咗』 and only one of them is true.」**
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { ClaudeAdapter } = require('./ClaudeAdapter')

const ENV = { CLAUDE_MODEL: 'claude-haiku-4-5-20251001', ANTHROPIC_API_KEY: 'k' }
async function withEnv (fn) {
  const saved = {}
  for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}
const thrower = (err) => async () => { throw err }

test('*** ⛔ a timeout is FLAGGED as a timeout, not filed as a network failure ***', async () => {
  await withEnv(async () => {
    const axiosTimeout = Object.assign(new Error('timeout of 120000ms exceeded'), { code: 'ECONNABORTED' })
    const a = new ClaudeAdapter({ transport: thrower(axiosTimeout) })
    const e = await a.complete('hi').then(() => null, (x) => x)
    assert.ok(e, 'it still throws — this is not a silent success')
    assert.equal(e.isTimeout, true, '⛔ the caller can tell 「she was still working」 from 「it failed」')
    assert.equal(e.timeoutMs, 120000, 'and the number it waited is quotable to the Owner')
  })
})

test('*** the socket-level spelling counts too ***', async () => {
  await withEnv(async () => {
    const a = new ClaudeAdapter({ transport: thrower(Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' })) })
    const e = await a.complete('hi').then(() => null, (x) => x)
    assert.equal(e.isTimeout, true)
  })
})

test('*** ⛔ a real failure is NOT dressed up as patience ***', async () => {
  await withEnv(async () => {
    // A refused schema is the model producing nothing. Flagging it as a timeout would tell the
    // Owner to wait for an answer that is never coming — the same untruth in the other
    // direction, and the more expensive one.
    const refused = { response: { status: 400, data: { error: { message: 'Invalid schema' } } } }
    const a = new ClaudeAdapter({ transport: thrower(Object.assign(new Error('Request failed'), refused)) })
    const e = await a.complete('hi').then(() => null, (x) => x)
    assert.equal(e.isTimeout, undefined, 'a 400 is not a timeout')
    assert.match(e.message, /Claude API error 400/)

    const dropped = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const b = new ClaudeAdapter({ transport: thrower(dropped) })
    const e2 = await b.complete('hi').then(() => null, (x) => x)
    assert.equal(e2.isTimeout, undefined, 'a dropped connection is not a timeout either')
  })
})

test('*** the key never appears in a timeout error ***', async () => {
  await withEnv(async () => {
    const a = new ClaudeAdapter({ transport: thrower(Object.assign(new Error('timeout of 120000ms exceeded'), { code: 'ECONNABORTED' })) })
    const e = await a.complete('hi').then(() => null, (x) => x)
    assert.equal(/\bk\b/.test(e.message.replace(/timeout|exceeded|Claude|API|network|error|of|ms/gi, '')), false)
  })
})
