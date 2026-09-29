'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createFlow } = require('./oauth')
test('member consent uses the shared live-Google fence before reading application credentials', () => {
  assert.throws(() => require('../context/googleAuth').createMemberConsentClient(), e => e.googleLiveAuthBlocked === true)
})
test('member OAuth verifies audience, nonce, PKCE and one-use browser state; tokens remain private', async () => {
  let auth; let verified; let exchanged; let credentials; let binds = 0; let now = 1000
  const client = {
    generateAuthUrl: args => { auth = args; return 'https://accounts.google.com/o/oauth2/v2/auth' },
    getToken: async args => { exchanged = args; return { tokens: { access_token: 'private-token', id_token: 'private-id', expiry_date: 50000 } } },
    verifyIdToken: async args => { verified = args; return { getPayload: () => ({ sub: 'verified-sub', nonce: auth.nonce }) } },
    getTokenInfo: async () => ({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] }),
    setCredentials: args => { credentials = args }
  }
  const flow = createFlow({ registry: { bind: () => { binds++ }, identity: () => ({ id: 'ivy' }) }, clientFactory: () => ({ client, audience: 'configured-client' }), clock: () => now })
  const start = flow.begin()
  assert.deepEqual(auth.scope, ['openid', 'email', 'https://www.googleapis.com/auth/drive.readonly'])
  assert.equal(auth.access_type, 'online')
  await assert.rejects(flow.finish({ state: auth.state, cookie: 'wrong', code: 'code' }))
  const sessionId = await flow.finish({ state: auth.state, cookie: start.cookie, code: 'code' })
  assert.equal(verified.audience, 'configured-client')
  assert.equal(verified.idToken, 'private-id')
  assert.ok(exchanged.codeVerifier)
  assert.equal(credentials.access_token, 'private-token')
  assert.equal(credentials.id_token, undefined)
  assert.equal(binds, 1)
  assert.equal(flow.get(sessionId).sub, 'verified-sub')
  await assert.rejects(flow.finish({ state: auth.state, cookie: start.cookie, code: 'code' }))
  now = 50001
  assert.equal(flow.get(sessionId), null)
})
test('forged nonce cannot bind an identity', async () => {
  let args; let binds = 0
  const flow = createFlow({ registry: { bind: () => binds++ }, clientFactory: () => ({
    audience: 'client', client: {
      generateAuthUrl: x => { args = x; return 'https://accounts.google.com/auth' },
      getToken: async () => ({ tokens: { access_token: 'private', id_token: 'private' } }),
      verifyIdToken: async () => ({ getPayload: () => ({ nonce: 'forged' }) })
    }
  }) })
  const start = flow.begin()
  await assert.rejects(flow.finish({ state: args.state, cookie: start.cookie, code: 'code' }))
  assert.equal(binds, 0)
})
