'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createApp } = require('../app')
const { createRegistry } = require('./access')
test('company boundary denies all legacy owner paths, including anonymous callers and direct IDs', async t => {
  const registry = createRegistry({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'company-http-')), 'access.json') })
  registry.bind({ sub: 'ivy-sub', email: 'ivy.chow@aromabistro741.com', email_verified: true, hd: 'aromabistro741.com' })
  const flow = { get: id => id === 'member-session' ? { sub: 'ivy-sub' } : null, revoke: () => {}, begin: () => ({ url: 'https://accounts.google.com/auth', cookie: 'private-flow' }) }
  const app = createApp({ companyAccessEnabled: true, companyOptions: { registry, flow, readers: {} },
    ownerPassword: 'fixture-owner', serviceToken: 'fixture-service', runPersistence: false, proposalPersistence: false, workerDeps: { artifactStore: null, runner: null } })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(r => server.once('listening', r))
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const base = 'http://127.0.0.1:' + server.address().port
  const paths = ['/api/v1/tasks', '/api/v1/events', '/api/v1/decisions', '/api/v1/dispatches', '/api/v1/workers',
    '/api/v1/llm-usage/summary', '/api/v1/demo/conversations/secret', '/api/v1/conversations/secret',
    '/api/v1/memory/catalog', '/api/v1/memory/records/secret', '/api/v1/manager/runs/secret',
    '/api/v1/context/recent', '/api/v1/company-access', '/company-access', '/proposals', '/runs',
    '/api/v1/dispatch/secret', '/demo', '/memory', '/connections', '/architecture', '/arbitrary-future-data-route']
  for (const url of paths) {
    for (const cookie of ['', 'xiangxiang_member_session=member-session']) {
      assert.equal((await fetch(base + url, { headers: { cookie }, redirect: 'manual' })).status, 401, url)
    }
  }
  assert.equal((await fetch(base + '/health')).status, 200)
  const member = await fetch(base + '/api/v1/member', { headers: { cookie: 'xiangxiang_member_session=member-session' } })
  assert.equal(member.status, 200)
  const data = await member.json()
  assert.equal(data.identity.id, 'ivy')
  assert.deepEqual(data.sources.map(s => s.id), ['admin-drive'])
  assert.equal(data.memory, 'not_connected')
  assert.equal((await fetch(base + '/api/v1/member', { headers: { authorization: 'Bearer fixture-service' } })).status, 401)
  const owner = await fetch(base + '/api/v1/company-access', { headers: { authorization: 'Bearer fixture-service' } })
  assert.equal(owner.status, 200)
  assert.equal((await owner.json()).enabled, true)
  assert.equal((await fetch(base + '/company-access', { headers: { authorization: 'Bearer fixture-service' } })).status, 200)
  const post = (body, origin) => new Promise((resolve, reject) => {
    const req = require('node:http').request(base + '/api/v1/company-access', { method: 'POST', headers: {
      host: '127.0.0.1:8090', origin, authorization: 'Bearer fixture-service', 'content-type': 'application/json'
    } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', reject); req.end(JSON.stringify(body))
  })
  assert.equal(await post({ op: 'grant', userId: 'ivy', sourceId: 'admin-drive', enabled: false }, 'https://evil.test'), 403)
  assert.equal(registry.allowed('ivy-sub', 'admin-drive'), true)
  assert.equal(await post({ op: 'grant', userId: 'ivy', sourceId: 'admin-drive', enabled: false }, 'http://127.0.0.1:8090'), 200)
  assert.equal(registry.allowed('ivy-sub', 'admin-drive'), false)
  assert.equal(await post({ op: 'grant', userId: 'ivy', sourceId: 'company-drive', enabled: true }, 'http://127.0.0.1:8090'), 400)
  const ownerId = app.locals.ownerSessions.issue()
  assert.equal(app.locals.ownerSessions.valid(ownerId), true)
  const login = await new Promise((resolve, reject) => {
    const req = require('node:http').request(base + '/member/login', { method: 'POST', headers: {
      host: '127.0.0.1:8090', origin: 'http://127.0.0.1:8090', cookie: 'aroma_owner_session=' + ownerId, 'content-type': 'application/json'
    } }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, cookies: res.headers['set-cookie'] })) })
    req.on('error', reject); req.end('{}')
  })
  assert.equal(login.status, 200)
  assert.equal(app.locals.ownerSessions.valid(ownerId), false)
  assert.ok(login.cookies.some(c => c.startsWith('aroma_owner_session=;') && c.includes('Max-Age=0')))
})
