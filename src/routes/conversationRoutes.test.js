'use strict'

/**
 * conversationRoutes.test.js — the three calls the sidebar makes, over real HTTP.
 *
 * list → load → delete, plus the append that happens as a side effect of a completed turn.
 * Hermetic: an injected store and an injected processIntake spy, so no paid call and no
 * write outside a temp directory.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createDemoRouter } = require('./demoRouter')
const { createConversationStore } = require('../store/conversationStore')

const ID = '11111111-2222-4333-8444-555555555555'
const ID2 = '99999999-2222-4333-8444-555555555555'

function tmpStore () {
  return createConversationStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-convroute-')) })
}

function makeApp ({ demoOn = true, store, processIntakeFn } = {}) {
  const app = express()
  app.use(express.json())
  if (demoOn) app.locals.conversationDemo = true
  app.use(createDemoRouter({
    conversationStore: store,
    getAdapterFn: () => ({ providerName: 'spy' }),
    processIntakeFn: processIntakeFn || (async () => ({ reply: '答咗。', mode: 'chat' }))
  }))
  app.use((req, res) => res.status(404).json({ error: 'Not found' }))
  return app
}

async function req (app, method, p, body) {
  const server = app.listen(0)
  try {
    const port = server.address().port
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    })
    let json = null
    try { json = await res.json() } catch (_) {}
    return { status: res.status, body: json }
  } finally { server.close() }
}

/* ── list / load / delete ────────────────────────────────────────────────── */

test('*** the sidebar lists conversations newest-first, without transcripts ***', async () => {
  const store = tmpStore()
  store.appendTurn({ id: ID, userText: '舊', replyText: 'x', now: '2026-08-01T00:00:00.000Z' })
  store.appendTurn({ id: ID2, userText: '新', replyText: 'SECRET_BODY', now: '2026-08-03T00:00:00.000Z' })

  const res = await req(makeApp({ store }), 'GET', '/api/v1/conversations')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.conversations.map((c) => c.id), [ID2, ID])
  assert.equal(JSON.stringify(res.body).includes('SECRET_BODY'), false, 'a list is not a transcript')
})

test('*** clicking one loads the FULL transcript ***', async () => {
  const store = tmpStore()
  store.appendTurn({ id: ID, userText: '第一句', replyText: '第一答', servedBy: 'claude' })
  store.appendTurn({ id: ID, userText: '第二句', replyText: '第二答', servedBy: 'openai' })

  const res = await req(makeApp({ store }), 'GET', '/api/v1/conversations/' + ID)
  assert.equal(res.status, 200)
  assert.equal(res.body.conversation.messages.length, 4, 'everything, not the last few the page happened to hold')
  assert.equal(res.body.conversation.messages[0].content, '第一句')
  assert.equal(res.body.conversation.messages[3].servedBy, 'openai')
})

test('an unknown conversation is 404, not an empty one', async () => {
  const res = await req(makeApp({ store: tmpStore() }), 'GET', '/api/v1/conversations/' + ID)
  assert.equal(res.status, 404)
})

test('*** delete removes it, and deleting twice is not an error the Owner sees ***', async () => {
  const store = tmpStore()
  store.appendTurn({ id: ID, userText: 'a', replyText: 'b' })
  const app = makeApp({ store })
  assert.equal((await req(app, 'DELETE', '/api/v1/conversations/' + ID)).status, 200)
  assert.deepEqual(store.list(), [])
  assert.equal((await req(app, 'DELETE', '/api/v1/conversations/' + ID)).status, 404)
})

/* ── the id arrives from a browser ───────────────────────────────────────── */

test('*** a traversing id is refused by the route, not just by the store ***', async () => {
  const store = tmpStore()
  const app = makeApp({ store })
  for (const bad of ['..%2Faroma-truth', '..', 'a.b', 'A-UPPER-CASE-ID-11111111', 'short']) {
    const g = await req(app, 'GET', '/api/v1/conversations/' + bad)
    assert.ok(g.status === 400 || g.status === 404, `GET ${bad} → ${g.status}`)
    const d = await req(app, 'DELETE', '/api/v1/conversations/' + bad)
    assert.ok(d.status === 400 || d.status === 404, `DELETE ${bad} → ${d.status}`)
  }
})

/* ── the guard ───────────────────────────────────────────────────────────── */

test('*** with the demo flag off, every conversation route is 403 ***', async () => {
  const app = makeApp({ demoOn: false, store: tmpStore() })
  assert.equal((await req(app, 'GET', '/api/v1/conversations')).status, 403)
  assert.equal((await req(app, 'GET', '/api/v1/conversations/' + ID)).status, 403)
  assert.equal((await req(app, 'DELETE', '/api/v1/conversations/' + ID)).status, 403)
})

/* ── the append happens on a completed turn ──────────────────────────────── */

test('*** a completed chat turn is appended to its conversation ***', async () => {
  const store = tmpStore()
  const app = makeApp({ store, processIntakeFn: async () => ({ reply: '餐廳系統有 199 項。', mode: 'chat' }) })
  const res = await req(app, 'POST', '/api/v1/demo/intake', { message: '而家倉存入面有咩？', conversationId: ID })
  assert.equal(res.status, 200)

  const saved = store.get(ID)
  assert.equal(saved.messages.length, 2)
  assert.equal(saved.messages[0].content, '而家倉存入面有咩？')
  assert.equal(saved.messages[1].content, '餐廳系統有 199 項。')
  assert.equal(saved.title, '而家倉存入面有咩？')
})

test('*** the response envelope is unchanged by persistence ***', async () => {
  // Nothing downstream may gain a field because the sidebar learned to remember.
  const store = tmpStore()
  const app = makeApp({ store, processIntakeFn: async () => ({ reply: 'ok', mode: 'chat' }) })
  const res = await req(app, 'POST', '/api/v1/demo/intake', { message: 'hi', conversationId: ID })
  assert.equal(res.body.conversationSaved, undefined, 'no new key')
  assert.equal(res.body.reply, 'ok')
})

test('a turn with no conversationId still answers, and writes nothing', async () => {
  const store = tmpStore()
  const app = makeApp({ store, processIntakeFn: async () => ({ reply: 'ok', mode: 'chat' }) })
  const res = await req(app, 'POST', '/api/v1/demo/intake', { message: 'hi' })
  assert.equal(res.status, 200)
  assert.deepEqual(store.list(), [])
})

test('*** a store failure never takes the answer away ***', async () => {
  // The reply already exists. Losing it because a write failed would be the worst possible
  // trade, so persistence fails open — exactly like the Lab archive hook beside it.
  const broken = { appendTurn () { throw new Error('disk on fire') }, list: () => [], get: () => null, remove: () => false }
  const app = makeApp({ store: broken, processIntakeFn: async () => ({ reply: '照樣答到', mode: 'chat' }) })
  const res = await req(app, 'POST', '/api/v1/demo/intake', { message: 'hi', conversationId: ID })
  assert.equal(res.status, 200)
  assert.equal(res.body.reply, '照樣答到')
})

test('a failed turn leaves no half-conversation behind', async () => {
  const store = tmpStore()
  const app = makeApp({ store, processIntakeFn: async () => { throw new Error('upstream died') } })
  const res = await req(app, 'POST', '/api/v1/demo/intake', { message: 'hi', conversationId: ID })
  assert.ok(res.status >= 400)
  assert.equal(store.get(ID), null, 'nothing is written until there is an answer')
})
