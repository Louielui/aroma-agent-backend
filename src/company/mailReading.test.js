'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createMailbox } = require('./mailbox')
function fixture () {
  let revision = 0; let state = 'connected'; let reads = 0; let hook = () => {}
  const calls = []; const email = 'adm@example.test'
  const registry = { source: () => ({ mailbox: email, state }), revision: () => revision,
    recordMailState: s => { state = s }, mailAllowed: () => false }
  const payload = { mimeType: 'multipart/mixed', parts: [
    { mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('Please confirm delivery.').toString('base64url') } },
      { mimeType: 'text/html', body: { data: Buffer.from('<p>Duplicate</p>').toString('base64url') } }] },
    { mimeType: 'text/plain', filename: 'secret.txt', body: { attachmentId: 'private', data: Buffer.from('ATTACHMENT').toString('base64url') } }] }
  const mailbox = createMailbox({ registry, present: () => true, load: () => ({ email, client: {} }),
    serviceFor: () => ({ users: { getProfile: async () => ({ data: { emailAddress: email } }), messages: {
      list: async params => { calls.push(params); return { data: { messages: [{ id: 'abc123' }], nextPageToken: 'private' } } },
      get: async params => { reads++; hook(); calls.push(params); return { data: { id: 'abc123', payload, snippet: 'Preview' } } }
    } } }) })
  return { mailbox, calls, payload, reads: () => reads, revoke: () => { revision++; state = 'not_connected' }, onRead: f => { hook = f } }
}
test('search is bounded and returns mailbox-specific links, not the personal inbox', async () => {
  const f = fixture(); const result = await f.mailbox.search({ owner: true }, { q: 'invoice' })
  assert.equal(f.calls[0].q, 'invoice'); assert.equal(f.calls[0].maxResults, 10)
  assert.equal(result.truncated, true); assert.equal(result.messages[0].link.includes('authuser=adm%40example.test'), true)
  assert.equal(JSON.stringify(result).includes('private'), false)
  await assert.rejects(f.mailbox.search({ owner: true }, { q: 'x'.repeat(401) }), /invalid_mail_query/)
})
test('full text prefers plain alternative and excludes attached files', async () => {
  const f = fixture(); const r = await f.mailbox.read({ owner: true }, 'abc123')
  assert.equal(r.body, 'Please confirm delivery.'); assert.equal(r.attachmentsExcluded, true)
  assert.equal(r.bodyTruncated, false); assert.equal(f.calls[0].format, 'full')
  await assert.rejects(f.mailbox.read({ sub: 'forged' }, 'abc123')); assert.equal(f.reads(), 1)
  await assert.rejects(f.mailbox.read({ owner: true }, '../secret')); assert.equal(f.reads(), 1)
})
test('HTML is converted to inert text; oversized and unsupported bodies are visible', async () => {
  const f = fixture(); f.payload.mimeType = 'text/html'; delete f.payload.parts
  f.payload.body = { data: Buffer.from('<style>hidden</style><script>steal()</script><p>Hello &amp; goodbye</p>').toString('base64url') }
  assert.match((await f.mailbox.read({ owner: true }, 'abc123')).body, /Hello & goodbye/)
  f.payload.mimeType = 'text/plain'; f.payload.body.data = Buffer.from('x'.repeat(60000)).toString('base64url')
  const large = await f.mailbox.read({ owner: true }, 'abc123')
  assert.equal(large.bodyTruncated, true); assert.equal(large.body.length, 48000)
  f.payload.mimeType = 'application/pdf'
  assert.equal((await f.mailbox.read({ owner: true }, 'abc123')).bodyState, 'unavailable')
})
test('revocation while fetching a full message discards it', async () => {
  const f = fixture(); f.onRead(f.revoke)
  await assert.rejects(f.mailbox.read({ owner: true }, 'abc123'), /mail_access_denied/)
})
test('concurrent source checks do not revoke each other, while an actual grant change does', async t => {
  const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-concurrency-'))
  t.after(() => { assert.ok(path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()), 'mail-concurrency-'))); fs.rmSync(dir, { recursive: true, force: true }) })
  const registry = require('./access').createRegistry({ file: path.join(dir, 'access.json') })
  registry.recordMailState('connected')
  const email = registry.source('admin-mail').mailbox
  const mailbox = createMailbox({ registry, present: () => true, load: () => ({ email, client: {} }),
    serviceFor: () => ({ users: { getProfile: async () => ({ data: { emailAddress: email } }) } }) })
  await Promise.all([mailbox.check({ owner: true }), mailbox.check({ owner: true })])
  const verify = mailbox.lease({ owner: true }); await mailbox.check({ owner: true }); verify()
  registry.setGrant('ivy', 'admin-mail', false)
  assert.throws(verify, /mail_access_denied/)
})
