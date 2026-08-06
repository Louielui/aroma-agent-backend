'use strict'

/**
 * enquiryRoutes.test.js — opening one investigation, on request only.
 *
 * Owner: 「Not by default — that would recreate the relay — but a way to open one
 * investigation and read what actually happened.」
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const express = require('express')
const { createEnquiryRouter } = require('./enquiryRoutes')

function appWith (store) {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use(createEnquiryRouter({ enquiryStore: store }))
  return app
}

async function get (app, p) {
  const server = app.listen(0)
  try {
    const port = server.address().port
    const res = await fetch('http://127.0.0.1:' + port + p, { headers: { Accept: 'application/json' } })
    let json = null
    try { json = await res.json() } catch (_) {}
    return { status: res.status, body: json }
  } finally { server.close() }
}

const REC = {
  enquiryId: 'enq_abc12345',
  question: 'q',
  report: { outcome: 'CONCLUDED', text: 'r', rounds: 2, costUsd: 0.24 },
  turns: [{ goal: 'g', result: 'x', costUsd: 0.24, sessionId: 's', startedAt: 'a', finishedAt: 'b' }]
}
const fakeStore = {
  list: () => [{ enquiryId: REC.enquiryId, question: REC.question, report: REC.report, savedAt: 'z' }],
  get: (id) => (id === REC.enquiryId ? REC : null)
}

describe('enquiry routes', () => {
  test('the LIST carries reports and NOT turns', async () => {
    const res = await get(appWith(fakeStore), '/api/v1/demo/enquiries')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.enquiries.length, 1)
    assert.strictEqual(res.body.enquiries[0].turns, undefined,
      'turns in the list would be the relay again')
  })

  test('opening ONE enquiry by id returns the turns', async () => {
    const res = await get(appWith(fakeStore), '/api/v1/demo/enquiries/enq_abc12345')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.enquiry.turns.length, 1)
  })

  test('an unknown id is 404, not an empty enquiry', async () => {
    const res = await get(appWith(fakeStore), '/api/v1/demo/enquiries/enq_nope1234')
    assert.strictEqual(res.status, 404)
  })

  test('it sits under /api/v1/demo so it inherits the owner gate', () => {
    const src = require('fs').readFileSync(require.resolve('./enquiryRoutes'), 'utf8')
    assert.ok(/\/api\/v1\/demo\/enquiries', demoGuard/.test(src))
  })
})
