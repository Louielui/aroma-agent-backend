'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { createRouter } = require('./routes')
test('automation controls require Owner and same-origin; public callback leaks no provider errors', async t => {
  let controls = 0; let callbacks = 0
  const app = express(); app.use(express.json())
  app.use(createRouter({ requireOwner: (req, res, next) => req.headers.authorization === 'Owner fixture' ? next() : res.sendStatus(401),
    registry: {}, flow: {}, readers: {}, mailbox: {},
    mailScheduler: { status: async () => ({ paused: false }), control: async (actor, input) => { assert.equal(actor.owner, true); controls++; return input } },
    mailPubsub: { status: () => ({ configured: false }), finish: async () => { callbacks++; throw Error('private-provider-error') } } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const base = 'http://127.0.0.1:' + server.address().port
  const route = '/api/v1/company-access/mail-automation'
  assert.equal((await fetch(base + route)).status, 401)
  const request = (url, method, headers, body) => new Promise((resolve, reject) => {
    const req = require('node:http').request(base + url, { method, headers: { host: '127.0.0.1:8090', ...headers } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
    }); req.on('error', reject); req.end(body)
  })
  const post = (origin, body) => request(route, 'POST', { authorization: 'Owner fixture', origin, 'content-type': 'application/json' }, JSON.stringify(body))
  assert.equal((await post('https://evil.test', {op:'scheduler',paused:true,mode:'catchup'})).status, 403)
  assert.equal((await post('http://127.0.0.1:8090', {op:'scheduler',paused:true,mode:'catchup'})).status, 200)
  assert.equal(controls, 1)
  assert.equal((await post('http://127.0.0.1:8090', {op:'scheduler',paused:true,mode:'catchup',token:'untrusted'})).status, 400)
  const callback = await request('/company/mail-notifications/callback?state=bad&code=secret', 'GET', {})
  assert.equal(callback.status, 303); assert.equal(callback.headers['cache-control'], 'no-store')
  assert.match(callback.headers.location, /notifications=failed/); assert.equal(callbacks, 1)
  assert.equal(callback.text.includes('private-provider-error'), false)
})
