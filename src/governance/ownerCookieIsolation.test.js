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
