'use strict'

/**
 * appendFailureIsLoud.test.js — a persistence failure costs the Owner nothing, and says so.
 *
 * The conversation append was wrapped in `catch (_) {}` with the comment "fail-open: never
 * lose a reply to a disk problem". The fail-open half is right and stays: the answer has
 * already been produced and a disk problem must not be allowed to take it away.
 *
 * The SILENT half was the defect. With a bare catch, a store that is unwired, out of disk,
 * or refusing writes is indistinguishable from one that saved perfectly — and the inert
 * store's appendTurn now throws precisely so that a wiring regression is detectable, which
 * a bare catch would have thrown away again one line later.
 *
 * So: the reply still returns 200, and exactly one allowlisted line is emitted — an enum
 * reason and the conversation id, never the message, never the reply, never the error text
 * (an error string is not a closed vocabulary and can carry whatever it was handed).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { createDemoRouter } = require('./demoRouter')

const ID = 'append-failure-probe-01'
const SECRET_Q = 'SENSITIVE_QUESTION_TEXT'
const SECRET_A = 'SENSITIVE_REPLY_TEXT'

function appWith (store) {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use(createDemoRouter({
    conversationStore: store,
    getAdapterFn: () => ({ providerName: 'spy' }),
    processIntakeFn: async () => ({ reply: SECRET_A, mode: 'chat' })
  }))
  return app
}

async function post (app, body) {
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  try {
    const port = server.address().port
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/demo/intake`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  } finally { await new Promise((r) => server.close(r)) }
}

/** Capture [AROMA-CONVERSATION] lines from the real default sink. */
async function withLogCapture (fn) {
  const lines = []
  const original = console.log
  console.log = (...args) => {
    if (args[0] === '[AROMA-CONVERSATION]') { try { lines.push(JSON.parse(args[1])) } catch (_) {} }
  }
  try { return { result: await fn(), lines } } finally { console.log = original }
}

const throwingStore = (message) => ({
  list: () => [], get: () => null, remove: () => false,
  appendTurn: () => { throw new Error(message) }
})

/* ── the reply survives ──────────────────────────────────────────────────── */

test('*** a failed append never costs the Owner his reply ***', async () => {
  const { result } = await withLogCapture(() =>
    post(appWith(throwingStore('disk on fire')), { message: SECRET_Q, conversationId: ID }))
  assert.equal(result.status, 200)
  assert.equal(result.body.reply, SECRET_A, 'fail-open is the correct half and stays')
})

/* ── and it is never silent ──────────────────────────────────────────────── */

test('*** a failed append emits exactly one allowlisted line ***', async () => {
  const { lines } = await withLogCapture(() =>
    post(appWith(throwingStore('disk on fire')), { message: SECRET_Q, conversationId: ID }))
  assert.equal(lines.length, 1, 'THE DEFECT: a bare catch emitted nothing at all')
  assert.equal(lines[0].event, 'CONVERSATION_APPEND_FAILED')
  assert.equal(lines[0].conversationId, ID)
  assert.equal(typeof lines[0].timestamp, 'string')
})

test('*** the reason is a closed enum, not the error text ***', async () => {
  const cases = [
    ['conversation_store_not_wired', 'store_not_wired'],
    ['invalid_conversation_id', 'invalid_id'],
    ['ENOSPC: no space left on device', 'write_failed'],
    ['something nobody predicted', 'write_failed']
  ]
  for (const [thrown, expected] of cases) {
    const { lines } = await withLogCapture(() =>
      post(appWith(throwingStore(thrown)), { message: SECRET_Q, conversationId: ID }))
    assert.equal(lines[0].reason, expected, `${thrown} → ${expected}`)
  }
})

test('*** no message, reply, or raw error text reaches the log ***', async () => {
  const { lines } = await withLogCapture(() =>
    post(appWith(throwingStore('ENOSPC while writing ' + SECRET_A)), { message: SECRET_Q, conversationId: ID }))
  const serialized = JSON.stringify(lines)
  assert.equal(serialized.includes(SECRET_Q), false, 'the question must not be logged')
  assert.equal(serialized.includes(SECRET_A), false, 'nor the reply')
  assert.equal(serialized.includes('ENOSPC'), false, 'nor the raw error, which is not a closed vocabulary')
})

/* ── the unwired case, which is the one that would hide a regression ─────── */

test('*** an UNWIRED store is reported, not mistaken for a save ***', async () => {
  const { INERT_CONVERSATION_STORE } = require('../store/conversationStore')
  const { result, lines } = await withLogCapture(() =>
    post(appWith(INERT_CONVERSATION_STORE), { message: SECRET_Q, conversationId: ID }))
  assert.equal(result.status, 200, 'the Owner still gets his answer')
  assert.equal(lines.length, 1, 'and the missing wiring is on the record')
  assert.equal(lines[0].reason, 'store_not_wired')
})

test('a successful append stays quiet — the line means something went wrong', async () => {
  const ok = { list: () => [], get: () => null, remove: () => false, appendTurn: () => ({ id: ID, messageCount: 2 }) }
  const { lines } = await withLogCapture(() => post(appWith(ok), { message: SECRET_Q, conversationId: ID }))
  assert.deepEqual(lines, [], 'no failure line on the happy path')
})
