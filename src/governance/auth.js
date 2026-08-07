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
 *
 * B2-15 FAIL-CLOSED: there is NO built-in fallback token. When HUB_TOKEN is
 * unset/empty, no token is "configured" and every privileged route is REFUSED
 * (request-time 401) — the server never authenticates against a shared literal.
 * A fixed token for dev/test must be provided EXPLICITLY (via an injected
 * resolver, see createRequireServiceToken) — never implicitly by this module.
 */

// The scheme every Authorization header must use — the literal word "Bearer"
// followed by a single space, then the token.
const BEARER_PREFIX = 'Bearer '

/**
 * Read the expected service token from the environment.
 *
 * Returns process.env.HUB_TOKEN when it is set to a non-empty string, otherwise
 * `null` — the "no token configured" sentinel (B2-15: no stub fallback). Read at
 * call time (not module load) so a reloaded environment always sees the current
 * value.
 *
 * @returns {string|null} the token an incoming request must present, or null
 *   when none is configured
 */
function readExpectedToken () {
  const fromEnv = process.env.HUB_TOKEN
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return null
}

/**
 * Build the service-token middleware around an EXPLICIT token resolver.
 *
 * @param {{ resolveToken?: () => (string|null) }} [options]
 *   resolveToken — returns the currently-configured expected token, or null when
 *   none is configured. Defaults to readExpectedToken (the production resolver,
 *   fail-closed on unset HUB_TOKEN). Tests inject a resolver that returns an
 *   explicit token, so the expected token is configured deliberately, never by a
 *   hidden fallback.
 * @returns {import('express').RequestHandler}
 */
function createRequireServiceToken (options = {}) {
  const resolveToken = typeof options.resolveToken === 'function'
    ? options.resolveToken
    : readExpectedToken

  /**
   * Express middleware that admits a request only when it carries the expected
   * service token. On any failure it responds 401 with a short, token-free
   * message and does NOT call next; on success it calls next and nothing else.
   * The presented token is never placed in a log line or a response body.
   */
  return function requireServiceToken (req, res, next) {
    const header = req.headers.authorization

    if (typeof header !== 'string' || header.length === 0) {
      return res.status(401).json({ error: 'Missing Authorization header' })
    }

    if (!header.startsWith(BEARER_PREFIX)) {
      return res.status(401).json({ error: 'Authorization header must use the Bearer scheme' })
    }

    // B2-15 FAIL-CLOSED GUARD — resolve the expected token BEFORE any equality
    // check. If none is configured, refuse EVERY caller: never fall back to a
    // shared literal, never compare against an absent token (so no Bearer value
    // can ever match an unconfigured server).
    const expected = resolveToken()
    if (typeof expected !== 'string' || expected.length === 0) {
      return res.status(401).json({ error: 'Service token not configured' })
    }

    const token = header.slice(BEARER_PREFIX.length)
    if (token !== expected) {
      return res.status(401).json({ error: 'Invalid service token' })
    }

    return next()
  }
}

// Default module-level middleware — the production resolver (fail-closed when
// HUB_TOKEN is unset). Preserved for existing import sites.
const requireServiceToken = createRequireServiceToken()

module.exports = { requireServiceToken, createRequireServiceToken, readExpectedToken }
