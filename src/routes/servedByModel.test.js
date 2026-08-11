'use strict'
/**
 * servedByModel.test.js — `servedBy` reports the MODEL, not the provider family.
 *
 * ⛔ NO NETWORK, NO MODEL CALL. The adapter is a fake that returns a model id, which is the
 *    whole point: the id has to travel from the adapter's own result to the wire untouched.
 *
 * HR-62 is why this exists. For a fortnight every reply was labelled 「Claude」, which was true
 * and useless: the Claude behind it was claude-haiku-4-5-20251001 and no screen said so.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { createDemoRouter } = require('./demoRouter')

function appWith (modelId) {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use('/', createDemoRouter({
    getAdapterFn: () => ({ complete: async () => ({ text: 'ok', usage: {}, model: modelId }) }),
    // The engine seam: fill the telemetry the way the real pipeline does, from the
    // adapter's returned id, then answer.
    processIntakeFn: async (message, adapter, history, opts) => {
      const res = await adapter.complete(message, {})
      if (opts && opts.telemetry) {
        opts.telemetry.provider = 'claude'
        opts.telemetry.model = res.model
      }
      return { reply: 'ok', requestId: opts.requestId }
    }
  }))
  return app
}

function post (app, body) {
  return new Promise((resolve) => {
    const req = require('http').request({ method: 'POST', path: '/api/v1/demo/intake', port: app.__port, headers: { 'Content-Type': 'application/json' } },
      (res) => { let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b || '{}') })) })
    req.end(JSON.stringify(body))
  })
}

async function withServer (app, fn) {
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  app.__port = server.address().port
  try { return await fn() } finally { server.close() }
}

test('*** ⛔ servedBy carries the MODEL ID the adapter actually returned ***', async () => {
  const app = appWith('claude-haiku-4-5-20251001')
  await withServer(app, async () => {
    const r = await post(app, { message: '你好', interactionMode: 'chat' })
    assert.equal(r.status, 200)
    // ⛔ NOT 'claude'. The family name was the thing that hid the model for a fortnight.
    assert.equal(r.json.servedBy, 'claude-haiku-4-5-20251001')
    assert.notEqual(r.json.servedBy, 'claude')
  })
})

test('*** a different model on the same provider is visibly different ***', async () => {
  const app = appWith('claude-opus-5')
  await withServer(app, async () => {
    const r = await post(app, { message: '你好', interactionMode: 'chat' })
    assert.equal(r.json.servedBy, 'claude-opus-5')
  })
})

test('*** ⛔ an absent model is NULL, never backfilled with the provider name ***', async () => {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use('/', createDemoRouter({
    getAdapterFn: () => ({ complete: async () => ({ text: 'ok', usage: {} }) }), // no model field
    processIntakeFn: async (message, adapter, history, opts) => {
      if (opts && opts.telemetry) { opts.telemetry.provider = 'claude'; opts.telemetry.model = null }
      return { reply: 'ok', requestId: opts.requestId }
    }
  }))
  await withServer(app, async () => {
    const r = await post(app, { message: '你好', interactionMode: 'chat' })
    // Absent stays absent. 'claude' in a field that now means 「which model」 would be the
    // plausible substitute this change exists to remove.
    assert.equal(r.json.servedBy, null)
  })
})
