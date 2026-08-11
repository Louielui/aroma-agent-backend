'use strict'
/**
 * perCallServedBy.test.js — one turn can involve more than one model, so the turn reports a LIST.
 *
 * ⛔ NO NETWORK. Fake adapter, fake engine seam.
 *
 * Precondition for the route/author split: a second live model string with a turn-level label
 * is HR-62 rebuilt on purpose.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { createDemoRouter } = require('./demoRouter')

function appWith (calls) {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use('/', createDemoRouter({
    getAdapterFn: () => ({ complete: async () => ({ text: 'ok', usage: {}, model: 'm' }) }),
    processIntakeFn: async (message, adapter, history, opts) => {
      if (opts && opts.telemetry) {
        opts.telemetry.provider = 'claude'
        opts.telemetry.model = 'claude-opus-5'
        opts.telemetry.calls = calls
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
  const s = app.listen(0); await new Promise((r) => s.once('listening', r)); app.__port = s.address().port
  try { return await fn() } finally { s.close() }
}

const ROUTE = { role: 'route', deterministic: true, model: null, route: 'ACTION', confidence: 'high' }
const ANSWER = { role: 'answer', deterministic: false, provider: 'claude', model: 'claude-opus-5', ms: 46803 }

test('*** ⛔ a two-model turn reports BOTH calls, not one label ***', async () => {
  const app = appWith([ROUTE, ANSWER])
  await withServer(app, async () => {
    const r = await post(app, { message: '幫我改 X', interactionMode: 'chat' })
    assert.equal(r.json.calls.length, 2)
    assert.deepEqual(r.json.calls.map((c) => c.role), ['route', 'answer'])
    assert.equal(r.json.calls[1].model, 'claude-opus-5', 'the Owner can see whose judgement he is reading')
  })
})

test('*** ⛔ the deterministic step is PRESENT with model:null — not omitted ***', async () => {
  const app = appWith([ROUTE, ANSWER])
  await withServer(app, async () => {
    const r = await post(app, { message: 'x', interactionMode: 'chat' })
    const route = r.json.calls.find((c) => c.role === 'route')
    assert.ok(route, '⛔ omitting it reads as 「we do not know」 rather than 「nothing was asked」')
    assert.equal(route.deterministic, true)
    assert.equal(route.model, null)
  })
})

test('*** ⛔ two kinds of null are told apart by `deterministic`, never by absence ***', async () => {
  // route:null   = no model was asked            (a fact)
  // answer:null  = a model was asked, unknown    (a gap)
  const UNKNOWN = { role: 'answer', deterministic: false, provider: 'claude', model: null, ms: null }
  const app = appWith([ROUTE, UNKNOWN])
  await withServer(app, async () => {
    const r = await post(app, { message: 'x', interactionMode: 'chat' })
    const [route, answer] = r.json.calls
    assert.equal(route.model, null); assert.equal(answer.model, null)
    assert.notEqual(route.deterministic, answer.deterministic,
      'identical nulls, different meanings — the flag is the only thing that separates them')
  })
})

test('*** an engine that reports no calls yields [] — never a fabricated entry ***', async () => {
  const app = appWith(undefined)
  await withServer(app, async () => {
    const r = await post(app, { message: 'x', interactionMode: 'chat' })
    assert.deepEqual(r.json.calls, [])
  })
})
