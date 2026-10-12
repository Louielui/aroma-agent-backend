'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createGoogleProvider, SCOPE } = require('./googleProvider')
const { SOURCE_FLAG } = require('../context/flags')
test('every Google probe uses the existing bounded read connector, selected source only, and returns no content', async () => {
  for (const source of Object.keys(SCOPE)) {
    const reads = []; const selected = []
    const client = {
      users: { getProfile: async () => ({ data: { emailAddress: 'owner@example.test' } }) },
      about: { get: async () => ({ data: { user: { emailAddress: 'owner@example.test' } } }) },
      calendars: { get: async () => ({ data: { id: 'owner@example.test' } }) }
    }
    const oauth = { transporter: { defaults: {} }, getAccessToken: async () => ({ token: 'secret-token' }), getTokenInfo: async () => ({ scopes: Object.values(SCOPE) }) }
    const provider = createGoogleProvider({
      env: { READ_ACCESS: 'on', CONTEXT_GMAIL: 'on', CONTEXT_DRIVE: 'on', CONTEXT_CALENDAR: 'on', CONTEXT_GITHUB: 'on' },
      oauthFactory: () => oauth,
      serviceFactory: s => { selected.push(s); return client },
      buildConnector: options => {
        assert.equal(options.caps.maxResults, 1)
        assert.equal(options.caps.timeoutMs, 8000)
        for (const [s, flag] of Object.entries(SOURCE_FLAG)) assert.equal(options.env[flag], s === source ? 'on' : 'off')
        return { connector: { read: async (...args) => { reads.push(args); return { results: [{ trust: 'live', content: 'private-content', sourceId: 'private-id' }] } } } }
      }
    })
    const result = await provider.probe(source)
    assert.deepEqual(selected, [source]); assert.equal(reads.length, 1); assert.equal(reads[0][0], source)
    assert.equal(reads[0][2][source === 'drive' ? 'pageSize' : 'maxResults'], 1)
    if (source === 'calendar') assert.equal(Date.parse(reads[0][2].timeMax) - Date.parse(reads[0][2].timeMin), 86400000)
    assert.deepEqual(result, { account: 'owner@example.test', scopes: Object.values(SCOPE), count: 1 })
    assert.equal(oauth.transporter.defaults.timeout, 8000)
    assert.ok(!JSON.stringify(result).includes('private'))
  }
})
test('missing Google scope fails before data access and hides token errors', async () => {
  const provider = createGoogleProvider({
    oauthFactory: () => ({ transporter: { defaults: {} }, getAccessToken: async () => ({ token: 'secret' }), getTokenInfo: async () => ({ scopes: [] }) }),
    serviceFactory: () => { throw Error('must not access') }
  })
  await assert.rejects(provider.probe('gmail'), e => e.connectionCode === 'permission' && !e.message.includes('secret'))
})
