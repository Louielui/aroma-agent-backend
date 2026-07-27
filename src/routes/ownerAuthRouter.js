'use strict'

/**
 * ownerAuthRouter.js — the login surface. Three routes and nothing else:
 *
 *   GET  /owner/login   the form (self-contained page, no external anything)
 *   POST /owner/login   verify the password, issue the session cookie
 *   POST /owner/logout  revoke it
 *
 * THE PASSWORD IS NEVER ECHOED. It is not written into the page, not put in a log line,
 * not included in any error, and not reflected in any response — a wrong attempt gets a
 * fixed message with no detail about what was wrong. The input field is never given a
 * `value`, so a failed submit returns an empty form rather than one holding the secret.
 */

const express = require('express')

const {
  SESSION_COOKIE, readCookie, passwordMatches, readOwnerPassword,
  ownerPasswordConfigured, sessionCookie, clearedCookie
} = require('../api/ownerAuth')

/** Minimal same-origin check for the login POST itself. Sec-Fetch-Site is sent by every
 *  current browser; when present it must not be cross-site. It is NOT required to be
 *  present, because a non-browser client (curl, a script) legitimately omits it. */
function crossSiteSubmit (req) {
  const sfs = req.headers['sec-fetch-site']
  return typeof sfs === 'string' && sfs === 'cross-site'
}

/**
 * Constrain `next` to a same-origin path. ONE definition, used by both the form and the
 * redirect, so they can never disagree.
 *
 * The leading `//` and `/\` cases are the whole point: `//evil.example` IS a valid URL —
 * a protocol-relative one — and a naive "starts with a slash" check waves it straight
 * through into an open redirect. (Written the naive way first; the test caught it.)
 */
function safePath (v, fallback = '/demo') {
  if (typeof v !== 'string') return fallback
  if (v.startsWith('//') || v.startsWith('/\\')) return fallback
  return /^\/[A-Za-z0-9/_.-]*$/.test(v) ? v : fallback
}

function escapeHtml (s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/**
 * The login page. Hardcoded warm palette to match the app; no font, no image, no script
 * from anywhere. `next` is echoed into a hidden field, so it is escaped and constrained
 * to a same-origin path before it is ever written.
 */
function loginPage ({ next = '/demo', error = null, configured = true } = {}) {
  const safeNext = safePath(next)
  const notice = !configured
    ? '<p class="err">尚未設定登入密碼。請在 .env 設定 AROMA_OWNER_PASSWORD 後重啟。</p>'
    : (error ? `<p class="err">${escapeHtml(error)}</p>` : '')
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>守燈</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:#faf7f2;color:#2c2a26;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){body{background:#1c1b19;color:#ece7df}
  .card{background:#262422;border-color:#383430}}
.card{background:#fff;border:1px solid #ece6da;border-radius:14px;padding:28px 26px;width:min(360px,90vw)}
h1{margin:0 0 4px;font-size:19px;font-weight:600}
p.sub{margin:0 0 18px;color:#8a857c;font-size:13px}
label{display:block;font-size:13px;color:#6b665d;margin-bottom:6px}
input{width:100%;box-sizing:border-box;padding:11px 12px;font-size:16px;border-radius:10px;
  border:1px solid #ece6da;background:transparent;color:inherit}
input:focus{outline:2px solid #d97757;outline-offset:1px;border-color:#d97757}
button{width:100%;margin-top:14px;padding:11px;font-size:15px;font-weight:600;color:#fff;
  background:#d97757;border:0;border-radius:10px;cursor:pointer}
button:hover{background:#c96a47}
.err{margin:0 0 14px;padding:9px 11px;border-radius:9px;font-size:13px;
  background:#f5e3e0;color:#a8493f}
</style></head><body>
<form class="card" method="post" action="/owner/login">
  <h1>守燈</h1>
  <p class="sub">請輸入密碼</p>
  ${notice}
  <label for="p">密碼</label>
  <input id="p" name="password" type="password" autocomplete="current-password" autofocus required>
  <input type="hidden" name="next" value="${escapeHtml(safeNext)}">
  <button type="submit">登入</button>
</form>
</body></html>`
}

function createOwnerAuthRouter ({ sessions, isConfigured = ownerPasswordConfigured, resolvePassword = readOwnerPassword } = {}) {
  if (!sessions) throw new Error('createOwnerAuthRouter: a session store is required')
  const router = express.Router()

  router.get('/owner/login', (req, res) => {
    // Already signed in → straight through, no need to type it again.
    if (isConfigured() && sessions.valid(readCookie(req, SESSION_COOKIE))) {
      return res.redirect(302, '/demo')
    }
    res.status(isConfigured() ? 200 : 503).type('html')
      .send(loginPage({ next: req.query && req.query.next, configured: isConfigured() }))
  })

  router.post('/owner/login', (req, res) => {
    // FAIL CLOSED: an unconfigured server cannot be logged into at all.
    if (!isConfigured()) {
      return res.status(503).type('html').send(loginPage({ configured: false }))
    }
    if (crossSiteSubmit(req)) {
      return res.status(403).json({ error: 'owner_auth_refused', reason: 'cross_site' })
    }
    const body = req.body || {}
    const presented = typeof body.password === 'string' ? body.password : ''
    if (!passwordMatches(presented, resolvePassword() || '')) {
      // One fixed message. No hint about length, prefix, or how close it was — and the
      // attempted value is not echoed back into the form.
      return res.status(401).type('html').send(loginPage({ next: body.next, error: '密碼不正確。' }))
    }
    const sid = sessions.issue()
    res.setHeader('Set-Cookie', sessionCookie(sid, sessions.TTL_MS))
    const next = safePath(body.next)
    return res.redirect(302, next)
  })

  router.post('/owner/logout', (req, res) => {
    sessions.revoke(readCookie(req, SESSION_COOKIE))
    res.setHeader('Set-Cookie', clearedCookie())
    return res.status(200).json({ ok: true })
  })

  return router
}

module.exports = { createOwnerAuthRouter, loginPage }
