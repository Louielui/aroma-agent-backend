'use strict'

/**
 * auth.js — service-token authentication for the Aroma OS backend.
 *
 * The frontend dev server proxies only paths beginning with /api to this
 * backend and injects an `Authorization: Bearer <service token>` header on
 * every request. That token is the ONLY thing this middleware checks: it proves
 * the caller reached us through the trusted proxy rather than from an arbitrary
 * web page open on localhost.
 *
 * The token is NOT an identity. It never names the caller: `approvedBy`,
 * `confirmedBy`, and `owner` are always supplied by the server from its trusted
 * context. A valid token grants the right to invoke a state-changing route — it
 * is never treated as a value a client may use to name itself.
 *
 * The token is a secret: it is never logged, never echoed back in a response
 * body, and never written into a Run, a Proposal, an Event, or a Timeline stage.
 */

// The development stub used when HUB_TOKEN is not configured in the environment.
// Production always sets HUB_TOKEN; this fallback only exists so a local dev
// server (and its tests) can run without extra setup.
const DEV_STUB_TOKEN = 'svc-token-aroma-os'

// The scheme every Authorization header must use — the literal word "Bearer"
// followed by a single space, then the token.
const BEARER_PREFIX = 'Bearer '

/**
 * Read the expected service token from the environment.
 *
 * Returns process.env.HUB_TOKEN when it is set to a non-empty string, otherwise
 * the development stub. Read at call time (not module load) so tests and a
 * reloaded environment always see the current value.
 *
 * @returns {string} the token an incoming request must present
 */
function readExpectedToken () {
  const fromEnv = process.env.HUB_TOKEN
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return DEV_STUB_TOKEN
}

/**
 * Express middleware that admits a request only when it carries the expected
 * service token. On any failure it responds 401 with a short, token-free
 * message and does NOT call next; on success it calls next and nothing else.
 *
 * The comparison is a plain string equality check against readExpectedToken().
 * The presented token is never placed in a log line or a response body.
 */
function requireServiceToken (req, res, next) {
  const header = req.headers.authorization

  if (typeof header !== 'string' || header.length === 0) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  if (!header.startsWith(BEARER_PREFIX)) {
    return res.status(401).json({ error: 'Authorization header must use the Bearer scheme' })
  }

  const token = header.slice(BEARER_PREFIX.length)
  if (token !== readExpectedToken()) {
    return res.status(401).json({ error: 'Invalid service token' })
  }

  return next()
}

module.exports = { requireServiceToken, readExpectedToken }
