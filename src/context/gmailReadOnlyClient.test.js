'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
let api = {}; try { api = require('./gmailReadOnlyClient') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
test('Administrative retrieval constructs OAuth from a fixture grant without any consent probe or credential writes', t => {
  const fs = require('node:fs'), auth = require('./googleAuth'), read = fs.readFileSync, old = process.env.RUN_LIVE_GOOGLE_E2E
  process.env.RUN_LIVE_GOOGLE_E2E = '1'; t.after(() => { if (old === undefined) delete process.env.RUN_LIVE_GOOGLE_E2E; else process.env.RUN_LIVE_GOOGLE_E2E = old })
  let credentialReads = 0, writes = 0
  t.mock.method(fs, 'readFileSync', (path, ...args) => {
    if (path === auth.CLIENT_FILE) { credentialReads++; return JSON.stringify({ installed: { client_id: 'fixture-id', client_secret: 'fixture-secret' } }) }
    if (String(path).endsWith('google-admin-mail-token.json')) { credentialReads++; return JSON.stringify({ email: 'adm@example.test', sub: 'fixture-sub', refresh_token: 'fixture-refresh' }) }
    return read(path, ...args)
  })
  t.mock.method(fs, 'writeFileSync', () => { writes++; throw Error('write_forbidden') })
  t.mock.method(fs, 'unlinkSync', () => { writes++; throw Error('write_forbidden') })
  const grant = auth.loadAdminMailReadOnlyGrant()
  assert.equal(grant.email, 'adm@example.test'); assert.equal(grant.client.credentials.refresh_token, 'fixture-refresh'); assert.equal(credentialReads, 2); assert.equal(writes, 0)
})
test('Only fixed me profile/list/get reads escape the Gmail SDK closure; neither watch nor send is reachable', async () => {
  const calls = [], oauth = { transporter: { defaults: {} }, getAccessToken: async () => ({ token: 'fixture-secret' }), getTokenInfo: async () => ({ scopes: ['https://www.googleapis.com/auth/gmail.readonly'] }) }
  const client = { users: { getProfile: async (args, opts) => { calls.push({ args, opts }); return { data: { emailAddress: 'chef@example.test' } } }, messages: {
    list: async (args, opts) => { calls.push({ args, opts }); return { data: { messages: [] } } }, get: async (args, opts) => { calls.push({ args, opts }); return { data: { id: args.id } } }, send: () => assert.fail('send must not run') } } }
  for (const mailbox of ['owner', 'admin']) {
    const reader = api.createGmailReader(mailbox, { ownerOAuth: () => oauth, adminOAuth: () => ({ client: oauth }), serviceFactory: (name, version) => { assert.equal(name, 'gmail'); assert.equal(version, 'v1'); return client } })
    assert.deepEqual(Object.keys(reader), ['identity', 'metadata', 'listMessages', 'getMessage']); assert.ok(Object.isFrozen(reader))
    assert.ok(!JSON.stringify(await reader.identity()).includes('fixture-secret'))
    await reader.metadata(); await reader.listMessages({ q: 'is:unread', userId: 'other', url: 'https://evil.test' }); await reader.getMessage('abc123', true)
  }
  assert.ok(calls.every(c => c.args.userId === 'me' && c.opts.retry === false && c.opts.maxRedirects === 0 && c.opts.signal))
  assert.equal(calls[1].args.maxResults, 10); assert.deepEqual(calls[1].args.labelIds, ['INBOX']); assert.equal(calls[1].args.includeSpamTrash, false); assert.equal(calls[1].args.url, undefined)
  assert.equal(calls[2].args.format, 'full'); assert.match(calls[2].args.fields, /internalDate/)
  assert.throws(() => api.createGmailReader('other'), /invalid_mailbox/)
})
