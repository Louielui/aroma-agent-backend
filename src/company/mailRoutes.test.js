'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { createRouter } = require('./routes')
const { createRegistry } = require('./access')
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os')
test('only Owner can authorize/disconnect; member mail reads use verified session and grant', async t => {
  const registry = createRegistry({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mail-http-')), 'registry.json') })
  registry.bind({ sub: 'ivy-sub', email: 'ivy.chow@aromabistro741.com', email_verified: true, hd: 'aromabistro741.com' })
  const calls = []
  const mailbox = { status: () => ({ state: 'not_connected', mailbox: 'adm@aromabistro741.com' }),
    begin: () => { calls.push('begin'); return { url: 'https://accounts.google.com/auth', cookie: 'private-flow' } },
    finish: async () => { throw Error('invalid_flow') }, disconnect: () => calls.push('disconnect'),
    preview: async actor => { calls.push(actor); return { mailbox: 'adm@aromabistro741.com', messages: [{ subject: 'fixture' }] } },
    search: async (actor, query) => { calls.push({ actor, query }); return { messages: [] } },
    read: async (actor, id) => { calls.push({ actor, id }); return { body: 'Inline fixture' } } }
  const app = express(); app.use(express.json()); app.use(createRouter({ registry, mailbox, enabled: true, readers: {},
    requireOwner: (req, res, next) => req.headers.authorization === 'Bearer fixture-owner' ? next() : res.status(401).end(),
    flow: { get: id => id === 'member' ? { sub: 'ivy-sub' } : null } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const base = 'http://127.0.0.1:' + server.address().port
  const post = (op, origin, owner = true) => new Promise((resolve, reject) => {
    const req = require('node:http').request(base + '/api/v1/company-access', { method: 'POST', headers: {
      host: '127.0.0.1:8090', origin, ...(owner ? { authorization: 'Bearer fixture-owner' } : {}),
      cookie: 'xiangxiang_member_session=member', 'content-type': 'application/json'
    } }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, cookies: res.headers['set-cookie'] })) })
    req.on('error', reject); req.end(JSON.stringify({ op }))
  })
  assert.equal((await post('mail_authorize', 'https://evil.test')).status, 403)
  assert.equal((await post('mail_authorize', 'http://127.0.0.1:8090', false)).status, 401)
  assert.deepEqual(calls, [])
  const authorized = await post('mail_authorize', 'http://127.0.0.1:8090')
  assert.equal(authorized.status, 200)
  assert.ok(authorized.cookies[0].includes('Path=/company/mail/callback'))
  assert.equal((await fetch(base + '/api/v1/company-access/mail')).status, 401)
  const owner = await fetch(base + '/api/v1/company-access/mail', { headers: { authorization: 'Bearer fixture-owner' } })
  assert.equal(owner.status, 200); assert.deepEqual(calls.at(-1), { owner: true })
  const member = { headers: { cookie: 'xiangxiang_member_session=member' } }
  assert.equal((await fetch(base + '/api/v1/member/mail', member)).status, 200)
  assert.deepEqual(calls.at(-1), { sub: 'ivy-sub' })
  for (const suffix of ['/search?q=invoice', '/abc123']) {
    assert.equal((await fetch(base + '/api/v1/company-access/mail' + suffix, member)).status, 401)
  }
  const searched = await fetch(base + '/api/v1/company-access/mail/search?q=invoice', { headers: { authorization: 'Bearer fixture-owner' } })
  assert.equal(searched.status, 200); assert.equal(searched.headers.get('cache-control'), 'no-store')
  assert.deepEqual(calls.at(-1), { actor: { owner: true }, query: { q: 'invoice' } })
  const full = await fetch(base + '/api/v1/company-access/mail/abc123', { headers: { authorization: 'Bearer fixture-owner' } })
  assert.equal((await full.json()).body, 'Inline fixture'); assert.deepEqual(calls.at(-1), { actor: { owner: true }, id: 'abc123' })
  registry.setGrant('ivy', 'admin-mail', false)
  assert.equal((await fetch(base + '/api/v1/member/mail', member)).status, 403)
  assert.equal((await post('mail_disconnect', 'http://127.0.0.1:8090')).status, 200)
  assert.equal(calls.at(-1), 'disconnect')
  const callback = await fetch(base + '/company/mail/callback?state=bad&code=private', { redirect: 'manual' })
  assert.equal(callback.status, 303); assert.equal(callback.headers.get('location'), '/company-access?mail=failed')
})
