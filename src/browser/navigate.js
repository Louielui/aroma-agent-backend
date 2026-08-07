'use strict'

/**
 * navigate.js — the first verb, and the first place the stop is structural.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 「第一版嘅成功案例係一次停低，唔係一次完成。」
 *
 * This is not 「go to a URL」. It is 「go to a URL THE ORDER NAMED」. An origin the order did
 * not name is not an error to retry — it is a HALT, reported as `BLOCKED_NEEDS_YOU`, an
 * outcome that already exists and already leads the report's first line.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ALLOWLIST, NEVER DENYLIST ────────────────────────────────────────────────
 * Same discipline as the sealed order: **the default is stop**, and proceeding is the
 * exception that was written down before she started. A denylist requires someone to have
 * imagined the bad case; an allowlist requires someone to have intended the good one.
 *
 * ── AND THERE IS NO WILDCARD ─────────────────────────────────────────────────
 * `'*'` is deliberately NOT honoured. An allowlist with an escape hatch is a denylist wearing
 * a costume, and the escape hatch is what gets used on the day someone is in a hurry. If a
 * dispatch needs a new origin, the origin goes in the order.
 */

const { checkOriginPolicy, POLICY } = require('./originPolicy')

const NAV = Object.freeze({
  ALLOWED: 'ALLOWED',
  BLOCKED: 'BLOCKED'
})

/** Only these can carry a page. `file:`, `data:`, `javascript:` and `chrome:` are not pages
 *  the Owner asked her to visit — they are ways to reach the machine she runs on. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

function blocked (reason, extra) { return { verdict: NAV.BLOCKED, reason, ...(extra || {}) } }

/**
 * @param {string} url
 * @param {{allowedOrigins?: string[]}} [order] the sealed order for THIS dispatch
 * @returns {{verdict: string, origin?: string, reason?: string}}
 */
function checkNavigation (url, order) {
  // ⛔ THE GOVERNMENT BLOCK RUNS FIRST AND AN ORDER CANNOT TURN IT OFF.
  // The allowlist below protects against an origin nobody named; this protects against one
  // someone NAMED BY MISTAKE — a future order author, including a future me. It is checked
  // before the allowlist so that naming it in an order changes nothing.
  const policy = checkOriginPolicy(url)
  if (policy.verdict !== POLICY.ALLOWED) {
    return blocked(policy.reason, { governmentBlock: true, host: policy.host })
  }

  // An ABSENT fence is not an open one. A missing order is the most likely way this gets
  // called wrongly, so it is the first thing refused.
  const allowed = order && Array.isArray(order.allowedOrigins) ? order.allowedOrigins : null
  if (!allowed || allowed.length === 0) {
    return blocked('the order names no allowed origins — the default is stop')
  }

  let u
  try { u = new URL(String(url)) } catch (_) {
    return blocked('not a parsable absolute URL: ' + JSON.stringify(String(url).slice(0, 80)))
  }

  if (!ALLOWED_SCHEMES.has(u.protocol)) {
    return blocked('scheme ' + u.protocol + ' is not a web page')
  }

  // ORIGIN EQUALITY, not prefix matching. `https://www.costco.ca.evil.com` starts with the
  // allowed string, and a startsWith() check would have let it through — which is the whole
  // reason this compares parsed origins instead of strings.
  const origin = u.origin
  for (const a of allowed) {
    if (a === '*') continue // see the header: no wildcard, and it is skipped silently rather than honoured
    let allowedOrigin
    try { allowedOrigin = new URL(String(a)).origin } catch (_) { continue }
    if (allowedOrigin === origin) return { verdict: NAV.ALLOWED, origin }
  }

  return blocked('origin ' + origin + ' is not named in the order')
}

module.exports = { checkNavigation, NAV, ALLOWED_SCHEMES }
