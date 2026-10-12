'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createFlow } = require('./oauth')
const { READONLY_SCOPES } = require('../context/googleAuth')
test('Google authorization binds callback to browser, one-use state and PKCE; partial scopes never replace existing credentials', async () => {
  let requested; let exchange; let saves = 0; let scopes = READONLY_SCOPES; let now = 1000
  const flow = createFlow({ clock: () => now, clientFactory: () => ({
    generateAuthUrl: opts => { requested = opts; return 'https://accounts.google.com/o/oauth2/v2/auth?state=' + opts.state },
    getToken: async input => { exchange = input; return { tokens: { access_token: 'fake-access', refresh_token: 'fake-refresh' } } },
    getTokenInfo: async () => ({ scopes })
  }), saveToken: () => { saves++ } })
  const first = flow.begin(); assert.deepEqual(requested.scope, READONLY_SCOPES); assert.equal(requested.code_challenge_method, 'S256')
  await assert.rejects(flow.finish({ state: requested.state, code: 'code', cookie: 'wrong' }), /invalid_flow/); assert.equal(saves, 0)
  const second = flow.begin(); const state = requested.state
  await flow.finish({ state, code: 'code', cookie: second.cookie }); assert.equal(saves, 1); assert.ok(exchange.codeVerifier.length >= 43)
  await assert.rejects(flow.finish({ state, code: 'code', cookie: second.cookie }), /invalid_flow/)
  const third = flow.begin(); scopes = [READONLY_SCOPES[0]]
  await assert.rejects(flow.finish({ state: requested.state, code: 'code', cookie: third.cookie }), /incomplete_grant/); assert.equal(saves, 1)
  const fourth = flow.begin(); now += 600001
  await assert.rejects(flow.finish({ state: requested.state, code: 'code', cookie: fourth.cookie }), /invalid_flow/)
  assert.ok(first.url.startsWith('https://accounts.google.com/'))
})
