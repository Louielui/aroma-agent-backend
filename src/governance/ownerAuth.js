'use strict'

/**
 * ownerAuth.js — one Owner, one password, one long-lived session.
 *
 * WHAT THIS CLOSES. Until now the only thing protecting the Owner's data was the
 * loopback bind. GET /api/v1/context/recent returned ~6,000 characters of live Gmail,
 * Drive, Calendar and GitHub excerpts to anyone who asked — no credential, no cost, no
 * delay — and POST /api/v1/demo/intake and POST /api/v1/intake would both spend money on
 * a model call for an anonymous caller. This layer sits in front of all of them.
 *
 * IT SITS OUTSIDE THE APPROVAL DEFENCES, IT DOES NOT REPLACE THEM. The approval path
 * keeps every proof it already had — exact Origin, exact Host, loopback socket peer,
 * Sec-Fetch-Site, its own server-issued session, a one-time nonce bound to
 * (approvalId, hash, session), and the typed EXECUTE. Nothing here relaxes any of that;
 * this only decides whether a caller gets to reach those routes at all. The two session
 * cookies are deliberately separate names so neither can stand in for the other.
 *
 * SHAPE, AND WHY. No accounts, no user table, no password reset: there is exactly one
 * person. The secret lives in .env, set by the Owner, and is never read into any log,
 * page, error or response by this module — only compared. Comparison is timing-safe over
 * fixed-length digests, so a wrong password reveals nothing about how wrong it was.
 *
 * MACHINE CALLERS. A valid service token is accepted as an alternative credential. The
 * proposal bridge at /api/v1/intake/tasks is already token-guarded and is not a browser;
 * forcing it through a login form would break it for no security gain. Both are secrets
 * of the same standing — this widens who may call, not what an anonymous caller may do.
 *
 * FAIL CLOSED. With no password configured, every guarded route answers 503 and login is
 * refused. An unconfigured server serves nothing; it never falls back to open.
 */

const crypto = require('node:crypto')

const SESSION_COOKIE = 'aroma_owner_session' // deliberately NOT the approval router's cookie
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days — a phone should not re-login weekly
// OWNER'S DECISION, 2026-07-27: 8, not 12. The 12 was mine, not asked for; it exists only
// to stop a placeholder like "x" counting as "configured" and silently leaving the door
// open. The Owner was told a shorter password is a weaker lock on his Gmail and Drive and
// chose 8 anyway, which is his call to make. The floor still does its actual job: empty
// and one-character values are still refused, so fail-closed cannot be defeated by a stub.
const MIN_PASSWORD_CHARS = 8

/** The Owner's password, from the environment only. Never logged, never returned. */
function readOwnerPassword (env = process.env) {
  const v = env.AROMA_OWNER_PASSWORD
  return (typeof v === 'string' && v.length > 0) ? v : null
}

/** Is a usable password configured? Length is checked so a stub like "x" cannot pass. */
function ownerPasswordConfigured (env = process.env) {
  const p = readOwnerPassword(env)
  return p !== null && p.length >= MIN_PASSWORD_CHARS
}

/**
 * Constant-time comparison. Both sides are hashed to a fixed 32 bytes FIRST, so
 * timingSafeEqual never sees different lengths (which would throw, and the throw itself
 * would leak the length).
 */
function passwordMatches (presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false
  if (presented.length === 0 || expected.length === 0) return false
  const a = crypto.createHash('sha256').update(presented, 'utf8').digest()
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest()
  return crypto.timingSafeEqual(a, b)
}

/** Read one cookie by name. Same parser shape as the approval router. */
function readCookie (req, name) {
  const raw = req && req.headers && req.headers.cookie
  if (typeof raw !== 'string') return null
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}

/**
 * In-memory sessions. They do not survive a restart, which is the correct trade here:
 * a restart is rare, logging in again is one step, and nothing about the Owner's
 * credential is written to disk.
 */
function createSessionStore ({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  const sessions = new Map() // id -> expiresAt
  return {
    TTL_MS: ttlMs,
    issue () {
      const id = crypto.randomBytes(32).toString('base64url')
      sessions.set(id, now() + ttlMs)
      return id
    },
    valid (id) {
      if (typeof id !== 'string' || id === '') return false
      const exp = sessions.get(id)
      if (exp === undefined) return false
      if (exp <= now()) { sessions.delete(id); return false }
      return true
    },
    revoke (id) { if (typeof id === 'string') sessions.delete(id) },
    size () { return sessions.size }
  }
}

/**
 * The Set-Cookie value. httpOnly so script cannot read it; Strict so it never rides a
 * cross-site request; Secure so it is never sent over a plaintext connection.
 *
 * SECURE IS ALWAYS SET, AND THAT WAS MEASURED, NOT ASSUMED. The worry was that adding it
 * would break desktop access, because a Secure cookie is normally only stored over HTTPS
 * and the desktop reaches this server as plain `http://127.0.0.1:8090`. Browsers treat
 * loopback as a trustworthy origin, but "browsers treat" is not evidence, so it was tested
 * against a throwaway listener on 127.0.0.1: a Secure cookie was stored and returned
 * (`secure_cookie_came_back: true`), alongside a plain cookie as a control to prove the
 * probe itself worked. Chromium, which is what Chrome and the installed app both use.
 *
 * So both real access paths keep working: plain http on loopback (desktop) and HTTPS via
 * `tailscale serve` (phone). The ONE configuration this would break is serving plain http
 * on a NON-loopback address — the browser would silently drop the cookie and login would
 * loop with no error shown. That configuration is precisely the one the Tailscale approach
 * exists to avoid: the server stays loopback-only and TLS is terminated in front of it.
 * If a non-loopback plain-http bind is ever considered, this flag has to be revisited
 * FIRST, and the failure will look like "login does nothing", not like a cookie problem.
 */
function sessionCookie (id, ttlMs) {
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${Math.floor(ttlMs / 1000)}`
}
function clearedCookie () {
  // Must carry the SAME attributes as the cookie it clears, or the browser treats it as a
  // different cookie and the original quietly survives — i.e. logout would not log out.
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`
}

/**
 * The gate. Admits a caller holding EITHER a valid Owner session cookie OR the service
 * token. Refuses everything else, and refuses everyone when no password is configured.
 *
 * @param {object} deps
 * @param {object} deps.sessions               a session store
 * @param {function} [deps.isConfigured]       () => boolean
 * @param {function} [deps.serviceTokenOk]     (req) => boolean
 * @param {function} [deps.onUnauthenticated]  (req,res) => void — e.g. redirect a page to /owner/login
 */
function createRequireOwner ({ sessions, isConfigured = ownerPasswordConfigured, serviceTokenOk = null, onUnauthenticated = null } = {}) {
  if (!sessions) throw new Error('createRequireOwner: a session store is required')

  return function requireOwner (req, res, next) {
    // An Owner session is only possible if a password was configured to create it, so
    // this needs no separate configured-check.
    if (sessions.valid(readCookie(req, SESSION_COOKIE))) return next()

    // THE SERVICE TOKEN IS CHECKED BEFORE THE FAIL-CLOSED BRANCH, DELIBERATELY. It is an
    // independent credential with its own fail-closed startup check (the server refuses
    // to start without HUB_TOKEN), and the proposal bridge that presents it is a machine
    // integration with nothing to do with the Owner's browser password. Ordering the
    // config check first coupled them: forgetting to set the Owner password silently
    // killed the machine integration too. Admitting a caller who presented a valid secret
    // is not "serving openly", which is what fail-closed exists to prevent.
    if (typeof serviceTokenOk === 'function' && serviceTokenOk(req)) return next()

    // FAIL CLOSED — no credential presented, and no password configured to check one
    // against. Refuse everyone; never fall back to open.
    if (!isConfigured()) {
      return res.status(503).json({ error: 'owner_auth_not_configured' })
    }
    if (typeof onUnauthenticated === 'function') return onUnauthenticated(req, res)
    return res.status(401).json({ error: 'owner_auth_required' })
  }
}

module.exports = {
  SESSION_COOKIE,
  DEFAULT_TTL_MS,
  MIN_PASSWORD_CHARS,
  readOwnerPassword,
  ownerPasswordConfigured,
  passwordMatches,
  readCookie,
  createSessionStore,
  createRequireOwner,
  sessionCookie,
  clearedCookie
}
