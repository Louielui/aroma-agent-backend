'use strict'

/**
 * ownerAuth.test.js — every endpoint that was open is now shut.
 *
 * THE THING BEING FIXED, stated plainly so it is never re-opened by accident: before this
 * layer, `GET /api/v1/context/recent` returned ~6,000 characters of live Gmail, Drive,
 * Calendar and GitHub excerpts to ANY caller — no credential, no cost, no delay — and both
 * intake routes would spend real money on a model call for an anonymous one. The only
 * thing standing in the way was the loopback bind, which is exactly what the next step
 * wants to relax. So each of those endpoints gets its own named test here.
 *
 * No paid call: nothing in this file reaches an adapter — every assertion is about being
 * refused BEFORE the route runs.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const {
  SESSION_COOKIE, createSessionStore, createRequireOwner,
  passwordMatches, ownerPasswordConfigured, readOwnerPassword, sessionCookie, MIN_PASSWORD_CHARS
} = require('./ownerAuth')
const { createOwnerAuthRouter, loginPage } = require('../routes/ownerAuthRouter')

const GOOD = 'a-real-owner-password-2026'

/* ── helpers: a real listener, real fetch, no new dependency ──────────────── */

function makeApp ({ configured = true, password = GOOD, sessions = createSessionStore(), serviceTokenOk = null } = {}) {
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: false }))
  const isConfigured = () => configured
  app.use(createOwnerAuthRouter({ sessions, isConfigured, resolvePassword: () => password }))
  const requireOwner = createRequireOwner({
    sessions,
    isConfigured,
    serviceTokenOk,
    onUnauthenticated: (req, res) => {
      const wantsHtml = typeof req.headers.accept === 'string' && req.headers.accept.includes('text/html')
      if (wantsHtml && req.method === 'GET') return res.redirect(302, '/owner/login?next=' + encodeURIComponent(req.originalUrl))
      return res.status(401).json({ error: 'owner_auth_required' })
    }
  })
  // Stand-ins for the four real surfaces. If the gate lets a caller through, these
  // respond with the sentinel — so a leak is visible as content, not just a status code.
  app.get('/demo', requireOwner, (req, res) => res.type('html').send('<h1>SECRET_PAGE</h1>'))
  app.get('/api/v1/context/recent', requireOwner, (req, res) => res.json({ block: 'SECRET_GMAIL_AND_DRIVE' }))
  app.get('/api/v1/context/health', requireOwner, (req, res) => res.json({ enabled: ['gmail'] }))
  app.post('/api/v1/demo/intake', requireOwner, (req, res) => res.json({ reply: 'SECRET_PAID_CALL' }))
  app.post('/api/v1/intake', requireOwner, (req, res) => res.json({ reply: 'SECRET_PAID_CALL' }))
  app.use((req, res) => res.status(404).json({ error: 'Not found' }))
  return { app, sessions }
}

async function call (app, method, path, { cookie, headers = {}, body, redirect = 'manual' } = {}) {
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  try {
    const h = Object.assign({}, headers)
    if (cookie) h.cookie = cookie
    if (body !== undefined) h['content-type'] = 'application/x-www-form-urlencoded'
    const res = await fetch('http://127.0.0.1:' + server.address().port + path, {
      method, headers: h, body, redirect
    })
    return { status: res.status, location: res.headers.get('location'), setCookie: res.headers.get('set-cookie'), text: await res.text() }
  } finally {
    await new Promise((r) => server.close(r))
  }
}

async function login (app, password = GOOD) {
  const res = await call(app, 'POST', '/owner/login', { body: 'password=' + encodeURIComponent(password) })
  const raw = res.setCookie || ''
  return { res, cookie: raw.split(';')[0] }
}

/* ── THE FOUR ENDPOINTS THAT WERE OPEN ────────────────────────────────────── */

test('*** GET /api/v1/context/recent — the Gmail/Drive leak — is refused without auth ***', async () => {
  const { app } = makeApp()
  const res = await call(app, 'GET', '/api/v1/context/recent')
  assert.equal(res.status, 401)
  assert.equal(res.text.includes('SECRET_GMAIL_AND_DRIVE'), false, 'not one byte of the read block escapes')
})

test('*** GET /api/v1/context/health is refused without auth ***', async () => {
  const res = await call(makeApp().app, 'GET', '/api/v1/context/health')
  assert.equal(res.status, 401)
  assert.equal(res.text.includes('gmail'), false, 'not even which sources are connected')
})

test('*** POST /api/v1/demo/intake is refused without auth (it spends money) ***', async () => {
  const res = await call(makeApp().app, 'POST', '/api/v1/demo/intake')
  assert.equal(res.status, 401)
  assert.equal(res.text.includes('SECRET_PAID_CALL'), false)
})

test('*** POST /api/v1/intake is refused without auth (it spends money too) ***', async () => {
  const res = await call(makeApp().app, 'POST', '/api/v1/intake')
  assert.equal(res.status, 401)
  assert.equal(res.text.includes('SECRET_PAID_CALL'), false)
})

test('*** GET /demo is refused, and a browser is sent to the login form ***', async () => {
  const { app } = makeApp()
  const res = await call(app, 'GET', '/demo', { headers: { accept: 'text/html' } })
  assert.equal(res.status, 302)
  assert.match(res.location, /^\/owner\/login\?next=/)
  assert.equal(res.text.includes('SECRET_PAGE'), false)
})

test('a non-browser caller gets a plain 401 it can act on, not a redirect', async () => {
  const res = await call(makeApp().app, 'GET', '/demo', { headers: { accept: 'application/json' } })
  assert.equal(res.status, 401)
  assert.deepEqual(JSON.parse(res.text), { error: 'owner_auth_required' })
})

/* ── a forged or stale cookie is not a session ────────────────────────────── */

test('an invented session cookie is refused', async () => {
  const res = await call(makeApp().app, 'GET', '/api/v1/context/recent', { cookie: SESSION_COOKIE + '=made-up-value' })
  assert.equal(res.status, 401)
})

test('a session revoked by logout stops working immediately', async () => {
  const { app } = makeApp()
  const { cookie } = await login(app)
  assert.equal((await call(app, 'GET', '/api/v1/context/recent', { cookie })).status, 200)
  await call(app, 'POST', '/owner/logout', { cookie })
  assert.equal((await call(app, 'GET', '/api/v1/context/recent', { cookie })).status, 401, 'revoked at once')
})

test('an expired session is refused', () => {
  let t = 1000
  const sessions = createSessionStore({ ttlMs: 500, now: () => t })
  const id = sessions.issue()
  assert.equal(sessions.valid(id), true)
  t += 501
  assert.equal(sessions.valid(id), false)
})

/* ── logging in ───────────────────────────────────────────────────────────── */

test('*** the right password opens everything that was refused ***', async () => {
  const { app } = makeApp()
  const { res, cookie } = await login(app)
  assert.equal(res.status, 302)
  assert.match(res.location, /^\/demo$/)
  for (const [m, p] of [['GET', '/demo'], ['GET', '/api/v1/context/recent'], ['GET', '/api/v1/context/health'], ['POST', '/api/v1/demo/intake'], ['POST', '/api/v1/intake']]) {
    assert.equal((await call(app, m, p, { cookie })).status, 200, 'admitted: ' + m + ' ' + p)
  }
})

test('the cookie is httpOnly, SameSite=Strict and long-lived', async () => {
  const { res } = await login(makeApp().app)
  const c = res.setCookie
  assert.match(c, /HttpOnly/, 'script must not be able to read it')
  assert.match(c, /SameSite=Strict/, 'it must never ride a cross-site request')
  assert.match(c, /Path=\//)
  const maxAge = Number((c.match(/Max-Age=(\d+)/) || [])[1])
  assert.ok(maxAge > 7 * 24 * 3600, 'long-lived: a phone should not have to re-login weekly')
  // Secure is deliberately absent while the service is plain http — see ownerAuth.js.
  assert.equal(/;\s*Secure/i.test(c), false)
})

test('a wrong password is refused and tells the caller nothing', async () => {
  const { app } = makeApp()
  const res = await call(app, 'POST', '/owner/login', { body: 'password=' + encodeURIComponent('wrong-but-long-enough') })
  assert.equal(res.status, 401)
  assert.equal(res.setCookie, null, 'no session is issued')
  assert.equal(res.text.includes('wrong-but-long-enough'), false, 'the attempt is not echoed back')
  assert.equal(res.text.includes(GOOD), false, 'and certainly not the real one')
})

test('an empty password never matches, even against an empty expected value', () => {
  assert.equal(passwordMatches('', ''), false)
  assert.equal(passwordMatches('x', ''), false)
  assert.equal(passwordMatches('', 'x'), false)
  assert.equal(passwordMatches(null, 'x'), false)
  assert.equal(passwordMatches('x', undefined), false)
})

test('comparison is over fixed-length digests, so a length mismatch cannot throw', () => {
  assert.equal(passwordMatches('a', 'a-much-much-longer-password'), false)
  assert.equal(passwordMatches('a-much-much-longer-password', 'a'), false)
  assert.equal(passwordMatches(GOOD, GOOD), true)
})

/* ── fail closed ──────────────────────────────────────────────────────────── */

test('*** no password configured ⇒ everything is refused, nothing is served openly ***', async () => {
  const { app } = makeApp({ configured: false })
  for (const [m, p] of [['GET', '/demo'], ['GET', '/api/v1/context/recent'], ['GET', '/api/v1/context/health'], ['POST', '/api/v1/demo/intake'], ['POST', '/api/v1/intake']]) {
    const res = await call(app, m, p, { headers: { accept: 'text/html' } })
    assert.equal(res.status, 503, 'refused while unconfigured: ' + m + ' ' + p)
    assert.deepEqual(JSON.parse(res.text), { error: 'owner_auth_not_configured' })
  }
})

test('*** an unconfigured server cannot be logged into at all ***', async () => {
  const { app } = makeApp({ configured: false })
  const res = await call(app, 'POST', '/owner/login', { body: 'password=' + encodeURIComponent(GOOD) })
  assert.equal(res.status, 503)
  assert.equal(res.setCookie, null, 'no session, even with what would be the right password')
})

test('the configured check requires a real password, not a stub', () => {
  assert.equal(ownerPasswordConfigured({}), false)
  assert.equal(ownerPasswordConfigured({ AROMA_OWNER_PASSWORD: '' }), false)
  assert.equal(ownerPasswordConfigured({ AROMA_OWNER_PASSWORD: 'x' }), false, 'too short to be a password')
  assert.equal(ownerPasswordConfigured({ AROMA_OWNER_PASSWORD: 'x'.repeat(MIN_PASSWORD_CHARS) }), true)
  assert.equal(readOwnerPassword({}), null)
})

/* ── the password never appears anywhere a person or a log can see ────────── */

test('*** the password is never in the login page, in either state ***', () => {
  for (const page of [loginPage(), loginPage({ error: '密碼不正確。' }), loginPage({ configured: false })]) {
    assert.equal(page.includes(GOOD), false)
    assert.equal(/<input[^>]+type="password"[^>]+value=/.test(page), false, 'the field never carries a value')
  }
})

test('the "not configured" page says what to set, but never a value', () => {
  const page = loginPage({ configured: false })
  assert.ok(page.includes('AROMA_OWNER_PASSWORD'), 'it names the variable so the Owner can act')
  assert.equal(page.includes(GOOD), false)
})

test('the login page is self-contained — no external anything', () => {
  const page = loginPage()
  assert.equal(page.includes('http://'), false)
  assert.equal(page.includes('https://'), false)
  assert.equal(/<script/.test(page), false, 'no script at all on the credential page')
  assert.equal(/<link/.test(page), false)
  assert.equal(/<img/.test(page), false)
})

test('the `next` parameter cannot be turned into an off-site redirect', async () => {
  const { app } = makeApp()
  for (const evil of ['https://evil.example', '//evil.example', 'javascript:alert(1)', 'http://x']) {
    const res = await call(app, 'POST', '/owner/login', { body: 'password=' + encodeURIComponent(GOOD) + '&next=' + encodeURIComponent(evil) })
    assert.equal(res.location, '/demo', 'falls back to /demo instead of: ' + evil)
  }
  const ok = await call(app, 'POST', '/owner/login', { body: 'password=' + encodeURIComponent(GOOD) + '&next=%2Fdemo%2Fthing' })
  assert.equal(ok.location, '/demo/thing', 'a same-origin path is honoured')
})

test('a cross-site login submission is refused outright', async () => {
  const res = await call(makeApp().app, 'POST', '/owner/login', {
    headers: { 'sec-fetch-site': 'cross-site' },
    body: 'password=' + encodeURIComponent(GOOD)
  })
  assert.equal(res.status, 403)
  assert.equal(res.setCookie, null)
})

/* ── machine callers ──────────────────────────────────────────────────────── */

test('a valid service token is accepted as an alternative credential', async () => {
  const { app } = makeApp({ serviceTokenOk: (req) => req.headers.authorization === 'Bearer machine-token' })
  assert.equal((await call(app, 'POST', '/api/v1/intake', { headers: { authorization: 'Bearer machine-token' } })).status, 200)
  assert.equal((await call(app, 'POST', '/api/v1/intake', { headers: { authorization: 'Bearer wrong' } })).status, 401)
})

test('*** a valid service token IS admitted even when no Owner password is set ***', async () => {
  // INVERTED from what this first asserted, deliberately. Ordering the configured-check
  // before the token check coupled two independent credentials: forgetting to set the
  // Owner password silently killed the machine integration as well. The service token has
  // its own fail-closed check — the server refuses to START without HUB_TOKEN — and a
  // caller who presented a valid secret is not the "open" case fail-closed guards against.
  const { app } = makeApp({ configured: false, serviceTokenOk: (req) => req.headers.authorization === 'Bearer machine-token' })
  assert.equal((await call(app, 'POST', '/api/v1/intake', { headers: { authorization: 'Bearer machine-token' } })).status, 200)
  // …but presenting nothing, or the wrong token, is still refused outright.
  assert.equal((await call(app, 'POST', '/api/v1/intake')).status, 503)
  assert.equal((await call(app, 'POST', '/api/v1/intake', { headers: { authorization: 'Bearer wrong' } })).status, 503)
})

/* ── the two sessions are separate ────────────────────────────────────────── */

test('*** the Owner session cookie is NOT the approval router\'s session cookie ***', () => {
  const { SESSION_COOKIE: APPROVAL_COOKIE } = require('../routes/ownerApprovalRouter')
  assert.notEqual(SESSION_COOKIE, APPROVAL_COOKIE,
    'separate names, so neither session can ever stand in for the other')
})

test('holding an Owner session grants nothing on the approval path', async () => {
  // The gate decides who REACHES a route. It cannot satisfy Origin, Host, loopback peer,
  // Sec-Fetch-Site, the bound nonce or the typed EXECUTE — those are unchanged.
  const sessions = createSessionStore()
  const id = sessions.issue()
  const cookie = sessionCookie(id, sessions.TTL_MS)
  assert.ok(cookie.includes(SESSION_COOKIE))
  assert.equal(cookie.includes('aroma_owner_sid='), false, 'it does not set the approval cookie')
})

/* ── THE GATE MUST NOT SPILL ONTO ROUTES IT DOES NOT OWN ──────────────────── */

test('*** the gate is path-scoped: the approval routes are NOT behind it ***', async () => {
  // Mounted pathless the first time — `app.use(requireOwner, router)` runs on EVERY
  // request that reaches it, so with no password configured it answered 503 for the
  // approval routes too. That is the one thing this change was required not to do, and
  // 35 approval tests failed at once. Scoping is asserted here, not assumed.
  const express2 = require('express')
  const app = express2()
  const sessions = createSessionStore()
  const requireOwner = createRequireOwner({ sessions, isConfigured: () => false }) // worst case: 503 for all it owns
  app.use('/demo', requireOwner)
  app.use('/api/v1/demo', requireOwner)
  app.use('/api/v1/context', requireOwner)
  app.get('/demo', (req, res) => res.send('page'))
  app.get('/api/v1/context/recent', (req, res) => res.json({ block: 'SECRET' }))
  app.post('/api/v1/owner/approve', (req, res) => res.status(403).json({ error: 'approval_refused' }))
  app.get('/manifest.webmanifest', (req, res) => res.json({ name: '守燈' }))
  app.get('/health', (req, res) => res.json({ status: 'ok' }))

  // what the gate owns → refused
  assert.equal((await call(app, 'GET', '/demo')).status, 503)
  assert.equal((await call(app, 'GET', '/api/v1/context/recent')).status, 503)
  // what it does NOT own → reaches its own route, with its own defences intact
  const appr = await call(app, 'POST', '/api/v1/owner/approve')
  assert.equal(appr.status, 403, 'the approval route answers for itself, not 503 from this gate')
  assert.deepEqual(JSON.parse(appr.text), { error: 'approval_refused' })
  assert.equal((await call(app, 'GET', '/health')).status, 200, '/health stays open — the apply script uses it')
  assert.equal((await call(app, 'GET', '/manifest.webmanifest')).status, 200, 'Chrome fetches this without credentials')
})
