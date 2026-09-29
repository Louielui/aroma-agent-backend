'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createRegistry } = require('./access')
const { createMailbox } = require('./mailbox')
function fixture () {
  const registry = createRegistry({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'admin-mail-')), 'registry.json') })
  registry.bind({ sub: 'ivy-sub', email: 'ivy.chow@aromabistro741.com', email_verified: true, hd: 'aromabistro741.com' })
  let consent; let stored = null; let email = 'adm@aromabistro741.com'; let nonce; let live = true; let readHook = () => {}
  const client = { generateAuthUrl: args => { consent = args; nonce = args.nonce; return 'https://accounts.google.com/auth' },
    getToken: async () => ({ tokens: { access_token: 'private-access', id_token: 'private-id', refresh_token: 'private-refresh' } }),
    verifyIdToken: async () => ({ getPayload: () => ({ sub: 'admin-source-sub', email, email_verified: true, hd: 'aromabistro741.com', nonce }) }),
    getTokenInfo: async () => ({ scopes: ['https://www.googleapis.com/auth/gmail.readonly'] }),
    setCredentials: () => {} }
  const gmail = { users: { getProfile: async () => { if (!live) throw Error('Google denied'); return { data: { emailAddress: email } } },
    messages: {
      list: async () => { readHook(); return { data: { messages: [{ id: 'abc123' }], nextPageToken: 'private-page' } } },
      get: async () => ({ data: { id: 'abc123', snippet: 'Preview', payload: { headers: [{ name: 'Subject', value: '<script>secret</script>' }] } } })
    } } }
  const mailbox = createMailbox({ registry, clientFactory: () => ({ client, audience: 'expected-audience' }),
    serviceFor: () => gmail, load: () => { if (!stored) throw Error('missing'); return { client, email: stored.email, sub: stored.sub } },
    present: () => !!stored, save: grant => { stored = grant }, clear: () => { stored = null } })
  return { registry, mailbox, consent: () => consent, stored: () => stored,
    setEmail: value => { email = value }, setNonce: value => { nonce = value }, denyGoogle: () => { live = false }, onRead: fn => { readHook = fn } }
}
async function connect (f) {
  const start = f.mailbox.begin()
  await f.mailbox.finish({ state: f.consent().state, cookie: start.cookie, code: 'code' })
}
test('mailbox is registered but unconnected before its own Google consent', async () => {
  const f = fixture()
  assert.equal(f.registry.source('admin-mail').mailbox, 'adm@aromabistro741.com')
  assert.equal(f.mailbox.status().state, 'not_connected')
  await assert.rejects(f.mailbox.preview({ owner: true }))
  assert.equal(f.stored(), null)
})
test('wrong Google mailbox and forged nonce never persist a source credential', async () => {
  for (const kind of ['email', 'nonce']) {
    const f = fixture(); const start = f.mailbox.begin()
    if (kind === 'email') f.setEmail('louie@aromabistro741.com'); else f.setNonce('forged')
    await assert.rejects(f.mailbox.finish({ state: f.consent().state, cookie: start.cookie, code: 'code' }))
    assert.equal(f.stored(), null)
  }
})
test('only dedicated Gmail consent can connect; Owner and granted verified member read metadata', async () => {
  const f = fixture(); await connect(f)
  assert.deepEqual(f.consent().scope, ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'])
  assert.equal(f.consent().access_type, 'offline')
  assert.equal(f.mailbox.status().state, 'connected')
  assert.equal(f.stored().email, 'adm@aromabistro741.com')
  const result = await f.mailbox.preview({ sub: 'ivy-sub' })
  assert.equal(result.messages[0].subject, '<script>secret</script>')
  assert.equal(result.truncated, true)
  assert.equal(JSON.stringify(result).includes('private-'), false)
  await assert.rejects(f.mailbox.preview({ sub: 'unknown' }))
  f.registry.setGrant('ivy', 'admin-mail', false)
  await assert.rejects(f.mailbox.preview({ sub: 'ivy-sub' }))
  assert.equal((await f.mailbox.preview({ owner: true })).mailbox, 'adm@aromabistro741.com')
})
test('revocation during a read, provider rejection and disconnect fail closed', async () => {
  const f = fixture(); await connect(f)
  f.onRead(() => f.registry.setGrant('ivy', 'admin-mail', false))
  await assert.rejects(f.mailbox.preview({ sub: 'ivy-sub' }))
  f.onRead(() => {})
  f.denyGoogle()
  await assert.rejects(f.mailbox.preview({ owner: true }))
  assert.equal(f.mailbox.status().state, 'failed')
  f.mailbox.disconnect()
  assert.equal(f.stored(), null)
  assert.equal(f.mailbox.status().state, 'not_connected')
})
test('disconnect invalidates outstanding authorization, including replay', async () => {
  const f = fixture(); const start = f.mailbox.begin()
  f.mailbox.disconnect()
  await assert.rejects(f.mailbox.finish({ state: f.consent().state, cookie: start.cookie, code: 'code' }))
  assert.equal(f.stored(), null)
})
