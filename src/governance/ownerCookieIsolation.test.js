'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const auth = require('./ownerAuth')
test('instance cookie reaches middleware internals without changing legacy defaults', () => {
  const sessions = auth.createSessionStore(), id = sessions.issue(), cookieName = 'aroma_independent_fixture'
  assert(auth.sessionCookie(id, 1000, cookieName).startsWith(cookieName + '='))
  assert(auth.clearedCookie(cookieName).startsWith(cookieName + '='))
  assert(auth.sessionCookie(id, 1000).startsWith(auth.SESSION_COOKIE + '='))
  const gate = auth.createRequireOwner({ sessions, isConfigured: () => true, cookieName })
  let admitted = 0, status
  const res = { status(n) { status = n; return this }, json() {} }
  gate({ headers: { cookie: auth.SESSION_COOKIE + '=' + id } }, res, () => admitted++)
  assert.equal(admitted, 0); assert.equal(status, 401)
  gate({ headers: { cookie: cookieName + '=' + id } }, res, () => admitted++)
  assert.equal(admitted, 1)
})
test('cookie identity rejects header injection at construction', () => {
  for (const cookieName of ['', 'bad; Path=/', 'bad\r\nSet-Cookie:x', 'x'.repeat(81)]) {
    assert.throws(() => auth.createRequireOwner({ sessions: auth.createSessionStore(), cookieName }))
  }
})

test('legacy cookie defaults reach actual login, Main middleware and logout clearing', async () => {
  const express = require('express'), { createOwnerAuthRouter } = require('../routes/ownerAuthRouter')
  const sessions = auth.createSessionStore(), app = express(), password = 'synthetic-default-password'
  app.locals.ownerSessions = sessions; app.locals.conversationDemo = true
  app.use(express.urlencoded({ extended: false })); app.use(express.json())
  app.use(createOwnerAuthRouter({ sessions, isConfigured: () => true, resolvePassword: () => password }))
  app.get('/guard', auth.createRequireOwner({ sessions, isConfigured: () => true }), (_q,r) => r.json({ ok: true }))
  app.use(require('../intake/unifiedRoutes').createRouter({ intake: { enabled: () => true } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  const origin = 'http://127.0.0.1:' + server.address().port
  try {
    const login = await fetch(origin + '/owner/login', { method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=' + password })
    assert.equal(login.status, 302); const cookie = login.headers.get('set-cookie').split(';')[0]
    assert(cookie.startsWith('aroma_owner_session=')); assert(auth.clearedCookie().startsWith('aroma_owner_session='))
    assert.equal((await fetch(origin + '/guard', { headers: { cookie } })).status, 200)
    assert.equal((await fetch(origin + '/api/v1/demo/task-intake/configuration', { headers: { cookie } })).status, 200)
    assert.equal((await fetch(origin + '/api/v1/demo/task-intake/configuration', { headers: { cookie, origin: 'http://foreign.invalid' } })).status, 403)
    const logout = await fetch(origin + '/owner/logout', { method: 'POST', headers: { cookie, origin } })
    assert.equal(logout.status, 200); assert(logout.headers.get('set-cookie').startsWith('aroma_owner_session=;'))
    assert.equal((await fetch(origin + '/guard', { headers: { cookie } })).status, 401)
    assert.equal((await fetch(origin + '/api/v1/demo/task-intake/configuration', { headers: { cookie } })).status, 403)
  } finally { await new Promise(r => server.close(r)) }
})
