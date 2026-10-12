'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), express = require('express'), { randomUUID } = require('node:crypto')
const { createApp } = require('../app'), { createDemoRouter } = require('../routes/demoRouter')
let api = {}; try { api = require('./gmailContextService') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
const pack = { state: 'ok', source: 'gmail', sourceId: 'admin_mailbox', resource: 'gmail.admin_mail', operation: 'get', count: 1, retrievedAt: '2026-10-01T18:00:00Z', content: [{ sourceId: 'abc123', title: 'Supplier quote', originalDate: '2026-10-01T15:00:00Z', content: 'Private source original', link: 'https://mail.google.com/mail/?authuser=adm%40example.test#all/abc123', fields: { from: 'supplier@example.test', mailbox: 'admin', unread: true, bodyState: 'available', originalBodyComplete: true, attachmentsExcluded: false } }], coverage: { scope: 'admin message abc123', complete: true, truncated: false } }
function post (server, body, { path = '/api/v1/demo/intake', token, origin = 'http://127.0.0.1:8090' } = {}) {
  return new Promise((resolve, reject) => { const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method: 'POST', headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) } }, res => { let raw = ''; res.on('data', c => { raw += c }); res.on('end', () => resolve({ status: res.statusCode, value: JSON.parse(raw) })) }); r.on('error', reject); r.end(JSON.stringify(body)) })
}
async function serve (t, app) { const s = app.listen(0, '127.0.0.1'); await new Promise(r => s.once('listening', r)); t.after(() => new Promise(r => { s.closeAllConnections(); s.close(r) })); return s }
test('Gmail intent selects a fixed mailbox and refuses quoted, negative and compound actions', () => {
  assert.deepEqual(api.gmailIntent('香香，查看今天我的電郵'), { resource: 'gmail.owner_mail', operation: 'list', input: { window: 'today' } })
  assert.deepEqual(api.gmailIntent('查看行政部未讀電郵'), { resource: 'gmail.admin_mail', operation: 'list', input: { window: 'unread' } })
  assert.deepEqual(api.gmailIntent('搜尋我的電郵主題：quote'), { resource: 'gmail.owner_mail', operation: 'search', input: { field: 'subject', query: 'quote' } })
  assert.deepEqual(api.gmailIntent('查看行政部電郵原文 abc123'), { resource: 'gmail.admin_mail', operation: 'get', input: { messageId: 'abc123' } })
  for (const m of ['不要查看行政部未讀電郵', '「查看今天我的電郵」', '查看行政部未讀電郵並寄給 Ivy', '搜尋我的電郵：in:anywhere']) assert.equal(api.gmailIntent(m), null)
})
test('Live Gmail page/API require Owner, same origin and a closed resource contract', async t => {
  let reads = 0
  const app = createApp({ ownerPassword: 'fixture', serviceToken: 'fixture-service', runPersistence: false, proposalPersistence: false, workerDeps: { artifactStore: null, runner: null }, liveContext: { capabilities: () => [], activity: () => [], gmail: { read: async () => { reads++; return { pack } } } } })
  const s = await serve(t, app), opts = { path: '/api/v1/live-context/gmail', token: 'fixture-service' }, body = { resource: 'gmail.admin_mail', operation: 'get', input: { messageId: 'abc123' } }
  assert.equal((await fetch('http://127.0.0.1:' + s.address().port + '/gmail-context')).status, 401)
  assert.equal((await post(s, body, { path: opts.path })).status, 401)
  assert.equal((await post(s, body, { ...opts, origin: 'https://evil.test' })).status, 403)
  for (const b of [{ ...body, resource: 'gmail.other' }, { ...body, operation: 'send' }, { ...body, input: { messageId: 'abc123', url: 'https://evil.test' } }]) assert.equal((await post(s, b, opts)).status, 400)
  assert.equal(reads, 0); assert.equal((await post(s, body, opts)).value.pack.count, 1)
})
test('Gmail chat bypasses legacy mail/model lanes and never journals or saves raw source content', async t => {
  let reads = 0, allowed = true, models = 0, legacy = 0, journals = 0; const saved = []
  const verify = () => { if (!allowed) throw Error('source_access_changed') }
  const app = express(); app.locals.conversationDemo = true; app.use(express.json()); app.use(createDemoRouter({ liveContext: { gmail: { captureAccess: () => verify, read: async () => { reads++; return { pack, modelCalls: 0, mailbox: 'admin' } } } },
    mailChat: { answer: () => { legacy++; throw Error('legacy_must_not_run') } }, memoryJournal: { event: () => { journals++; throw Error('must_not_capture') } }, conversationStore: { appendTurn: v => saved.push(v) }, getAdapterFn: () => { models++; throw Error('model_must_not_run') } }))
  const s = await serve(t, app), body = { message: '查看行政部電郵原文 abc123', conversationId: 'gmail-fixture', workflowRequestId: randomUUID() }
  const result = await post(s, body); assert.equal(result.status, 200); assert.equal(result.value.sourceBound, true); assert.match(result.value.reply, /Private source original/); assert.match(result.value.reply, /abc123/)
  assert.equal(models + legacy + journals, 0); assert.equal(saved.length, 1); assert.ok(!JSON.stringify(saved).includes('Private source original'))
  assert.equal((await post(s, body)).status, 200); assert.equal(reads, 1)
  allowed = false; assert.equal((await post(s, body)).status, 503); assert.equal(reads, 1)
})
