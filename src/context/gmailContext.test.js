'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
let api = {}; try { api = require('./gmailContext') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
const { createReadConnector } = require('./readConnector'), { createToolGateway } = require('./toolGateway')
const RO = 'https://www.googleapis.com/auth/gmail.readonly'
function fixture (overrides = {}) {
  const owner = { id: 'owner', role: 'owner', email: 'chef@example.test', suspended: false, grants: ['admin-mail'] }
  const admin = { id: 'admin-mail', mailbox: 'adm@example.test', state: 'connected' }
  let revision = 'v1'
  const env = { READ_ACCESS: 'on', CONTEXT_GMAIL: 'on' }, calls = [], audits = []
  const scope = api.createGmailScope({ registry: { snapshot: () => ({ users: [owner], sources: [admin] }) }, env,
    credentials: () => ({ client: true, token: true, revision }) })
  const message = { id: 'abc123', internalDate: String(Date.parse('2026-10-01T15:00:00Z')), labelIds: ['INBOX', 'UNREAD'], payload: { headers: [{ name: 'Subject', value: 'Supplier quote' }, { name: 'From', value: 'supplier@example.test' }], mimeType: 'text/plain', body: { data: Buffer.from('Untrusted original').toString('base64url') } } }
  const readerFactory = mailbox => ({ identity: async () => ({ scopes: [RO] }), metadata: async () => ({ emailAddress: mailbox === 'owner' ? owner.email : admin.mailbox, messagesTotal: 51, threadsTotal: 40 }),
    listMessages: async args => { calls.push(args); return { messages: [{ id: message.id }], resultSizeEstimate: 1 } }, getMessage: async (id, full) => ({ ...message, id }), ...overrides })
  const adapter = api.createGmailContextAdapter({ scope, readerFactory, clock: () => '2026-10-01T18:00:00Z' })
  const connector = createReadConnector({ env }); connector.register(adapter)
  const gateway = createToolGateway({ connector, resources: api.gmailResources(), audit: { append: e => audits.push(e) } })
  return { scope, gateway, adapter, message, owner, admin, env, calls, audits, change: () => { revision = 'v2' } }
}
test('Gmail resources keep personal and department identities apart in one read-only gateway', async () => {
  const f = fixture()
  for (const resource of ['gmail.owner_mail', 'gmail.admin_mail']) {
    const p = await f.gateway.list({ role: 'owner' }, resource, { window: 'today' })
    assert.equal(p.state, 'ok'); assert.equal(p.count, 1); assert.equal(p.layer, 'truth'); assert.equal(p.source, 'gmail')
    assert.equal(p.content[0].originalDate, '2026-10-01T15:00:00.000Z'); assert.equal(p.coverage.sourceTotal, null)
    assert.match(p.content[0].link, /authuser=/); assert.equal(p.content[0].fields.mailbox, resource === 'gmail.owner_mail' ? 'owner' : 'admin')
    assert.equal(p.coverage.complete, true); assert.equal(p.content[0].fields.bodyState, 'not_requested')
  }
  assert.match(f.calls[0].q, /after:1790830799 before:1790917200/)
  assert.ok(f.audits.every(e => !JSON.stringify(e).includes('Supplier quote') && !JSON.stringify(e).includes('supplier@example.test')))
  await assert.rejects(f.gateway.list({ role: 'member' }, 'gmail.owner_mail', {}), /permission_denied/)
})
test('Readonly scope, mailbox identity and credential/source revocation fail before data can escape', async () => {
  for (const options of [{ identity: async () => ({ scopes: [RO, 'https://www.googleapis.com/auth/gmail.modify'] }) }, { identity: async () => ({ scopes: [RO, 'https://mail.google.com/'] }) }, { metadata: async () => ({ emailAddress: 'other@example.test' }) }]) {
    const f = fixture(options); const p = await f.gateway.list({ role: 'owner' }, 'gmail.owner_mail', {}); assert.equal(p.state, 'unavailable'); assert.equal(p.count, null); assert.equal(f.calls.length, 0)
  }
  const f = fixture(), lease = f.scope.lease('admin'); f.admin.state = 'not_connected'; assert.throws(() => lease.verify(), /source_access_changed/)
  const g = fixture(), held = g.scope.lease('owner'); g.change(); assert.throws(() => held.verify(), /source_access_changed/)
  const h = fixture(); h.owner.grants = []; assert.throws(() => h.scope.lease('admin'), /source_access_unavailable/)
  const j = fixture(); j.env.CONTEXT_GMAIL = 'off'; assert.throws(() => j.scope.lease('owner'), /source_access_unavailable/)
})
test('Capped pages are declared incomplete and provider estimates never become measured totals', async () => {
  const f = fixture({ listMessages: async () => ({ messages: [{ id: 'abc123' }], nextPageToken: 'more', resultSizeEstimate: 120 }) })
  const p = await f.gateway.list({ role: 'owner' }, 'gmail.admin_mail', { window: 'unread' })
  assert.equal(p.coverage.complete, false); assert.equal(p.coverage.truncated, true); assert.equal(p.coverage.sourceTotal, null)
  assert.equal(p.coverage.queryScope.resultSizeEstimate, 120)
  for (const data of [{}, { resultSizeEstimate: 3 }, { messages: [{ id: 'abc123' }, { id: 'abc123' }] }]) {
    const g = fixture({ listMessages: async () => data }); const failed = await g.gateway.list({ role: 'owner' }, 'gmail.admin_mail', {}); assert.equal(failed.state, 'unavailable'); assert.equal(failed.count, null)
  }
  const zero = fixture({ listMessages: async () => ({ resultSizeEstimate: 0 }) }); assert.equal((await zero.gateway.list({ role: 'owner' }, 'gmail.owner_mail', {})).count, 0)
})
test('Bounded original reads preserve unknown dates, mark UTF8/body/attachment limits, and never return executable HTML', async () => {
  const f = fixture(); delete f.message.internalDate
  f.message.payload = { mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/html', body: { data: Buffer.from('<script>steal()</script><p>' + '香'.repeat(9000) + '</p>').toString('base64url') } }, { filename: 'invoice.pdf', mimeType: 'application/pdf', body: { attachmentId: 'private-attachment' } }] }
  const p = await f.gateway.get({ role: 'owner' }, 'gmail.owner_mail', { messageId: 'abc123' })
  assert.equal(p.content[0].originalDate, null); assert.ok(Buffer.byteLength(p.content[0].content) <= 16000)
  assert.equal(p.content[0].truncated, true); assert.equal(p.coverage.complete, false); assert.equal(p.content[0].fields.attachmentsExcluded, true)
  assert.ok(!p.content[0].content.includes('steal')); assert.ok(!p.content[0].content.includes('\uFFFD'))
})
test('Only fixed read inputs and literal sender/subject/keyword searches are accepted', async () => {
  for (const [op, input] of [['send', {}], ['list', { window: 'all' }], ['get', { messageId: '../../other' }], ['search', { query: 'in:anywhere', field: 'keyword' }], ['search', { query: 'quote', field: 'url' }], ['list', { mailbox: 'other' }], ['readMetadata', { token: 'secret' }]]) assert.throws(() => api.validateGmailRequest(op, input), /invalid_request/)
  const f = fixture(); await f.gateway.search({ role: 'owner' }, 'gmail.admin_mail', { query: 'quote', field: 'subject' }); assert.equal(f.calls[0].q, 'subject:"quote"')
})
test('Access changing during provider I/O makes the whole result unavailable', async () => {
  const f = fixture({ listMessages: async () => { f.change(); return { messages: [{ id: 'abc123' }] } } })
  assert.equal((await f.gateway.list({ role: 'owner' }, 'gmail.owner_mail', {})).state, 'unavailable')
})
