'use strict'

/**
 * credentialHealth.js — is the agent's login going to work, and for how much longer?
 *
 * The Owner's requirement: he must never hit a mysterious failure three days from now
 * because a token quietly lapsed. So the state is checked BEFORE a run is handed off, and
 * an expired login is a refusal with the exact command to fix it — not a spawn that dies
 * with an opaque error.
 *
 * ── WHICH FIELD ACTUALLY GOVERNS THIS (a correction, made deliberately) ────
 * The brief said: read `expiresAt`, warn under 7 days, refuse when expired. Measured on
 * this machine right after a fresh `/login`:
 *
 *     expiresAt              2026-08-03T10:16Z    +8 HOURS
 *     refreshTokenExpiresAt  2026-08-30T05:08Z    +27 days
 *
 * `expiresAt` is the ACCESS token, which lives about half a day and which the CLI renews
 * by itself from the refresh token. Applying the 7-day rule to it would warn on every
 * single run and refuse every morning — a check that cries wolf constantly is one the
 * Owner learns to click past, which is worse than no check.
 *
 * What actually requires the Owner to type `/login` again is the REFRESH token expiring.
 * That is the field the refusal and the 7-day warning are keyed to. The access token is
 * still reported, because "expired but renewable" is a real state worth seeing, and it is
 * NEVER on its own a reason to refuse.
 *
 * ── WHAT THIS FILE MAY READ ───────────────────────────────────────────────
 * Two timestamps, a subscription label, and whether the token strings are non-empty. The
 * token VALUES are never read into a variable, never returned, never logged. There is no
 * code path here that can put one anywhere.
 */

const fs = require('node:fs')
const { t } = require('../i18n/t')
const os = require('node:os')
const path = require('node:path')

/** Under this many days left on the REFRESH token, the card carries a warning. */
const WARN_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

const STATE = Object.freeze({
  OK: 'ok',
  EXPIRING_SOON: 'expiring_soon',
  EXPIRED: 'expired',
  ABSENT: 'absent',
  UNREADABLE: 'unreadable'
})

function credentialsPath (env = process.env) {
  const home = env.USERPROFILE || env.HOME || os.homedir()
  return path.join(home, '.claude', '.credentials.json')
}

/** The exact command that fixes it. */
function loginHint (cliPath) {
  const p = cliPath || 'C:\\Users\\louis\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
  return t('cred.loginHint', { path: p })
}

/**
 * @param {{ env?, now?, readFileFn?, cliPath? }} opts
 * @returns {{ state, canRun, refusal, warning, accessTokenValid, accessExpiresAt,
 *             refreshExpiresAt, daysLeft, subscription }}
 *   refusal/warning are Owner-facing sentences, or null. Nothing here is a token.
 */
function checkCredentialHealth (opts = {}) {
  const env = opts.env || process.env
  const now = typeof opts.now === 'function' ? opts.now() : Date.now()
  const file = opts.path || credentialsPath(env)
  const readFileFn = opts.readFileFn || ((p) => fs.readFileSync(p, 'utf8'))

  const base = {
    accessTokenValid: null,
    accessExpiresAt: null,
    refreshExpiresAt: null,
    daysLeft: null,
    subscription: null
  }

  let raw
  try {
    raw = readFileFn(file)
  } catch (err) {
    // FAIL-SAFE. "We could not tell" is never "it is probably fine" — the Owner's rule.
    const missing = err && err.code === 'ENOENT'
    return Object.assign({}, base, {
      state: missing ? STATE.ABSENT : STATE.UNREADABLE,
      canRun: false,
      refusal: missing
        ? t('cred.notFound', { hint: loginHint(opts.cliPath) })
        : t('cred.unreadable', { hint: loginHint(opts.cliPath) }),
      warning: null
    })
  }

  let o
  try {
    const j = JSON.parse(raw)
    o = (j && j.claudeAiOauth) || null
  } catch (_) { o = null }

  if (!o || typeof o !== 'object') {
    return Object.assign({}, base, {
      state: STATE.UNREADABLE,
      canRun: false,
      refusal: t('cred.badFormat', { hint: loginHint(opts.cliPath) }),
      warning: null
    })
  }

  // Presence only. The strings themselves are never bound to a name.
  const hasAccess = typeof o.accessToken === 'string' && o.accessToken.length > 0
  const hasRefresh = typeof o.refreshToken === 'string' && o.refreshToken.length > 0

  const accessExp = Number.isFinite(o.expiresAt) ? o.expiresAt : null
  const refreshExp = Number.isFinite(o.refreshTokenExpiresAt) ? o.refreshTokenExpiresAt : null
  const subscription = typeof o.subscriptionType === 'string' ? o.subscriptionType : null

  const facts = {
    accessTokenValid: accessExp === null ? null : accessExp > now,
    accessExpiresAt: accessExp === null ? null : new Date(accessExp).toISOString(),
    refreshExpiresAt: refreshExp === null ? null : new Date(refreshExp).toISOString(),
    daysLeft: refreshExp === null ? null : Math.round(((refreshExp - now) / DAY_MS) * 10) / 10,
    subscription
  }

  if (!hasAccess || !hasRefresh) {
    return Object.assign({}, facts, {
      state: STATE.UNREADABLE,
      canRun: false,
      refusal: t('cred.incomplete', { hint: loginHint(opts.cliPath) }),
      warning: null
    })
  }

  // No refresh expiry recorded → we cannot say how long this login lasts. Unknown is not usable.
  if (refreshExp === null) {
    return Object.assign({}, facts, {
      state: STATE.UNREADABLE,
      canRun: false,
      refusal: t('cred.noExpiry', { hint: loginHint(opts.cliPath) }),
      warning: null
    })
  }

  if (refreshExp <= now) {
    return Object.assign({}, facts, {
      state: STATE.EXPIRED,
      canRun: false,
      refusal: t('cred.expired', { hint: loginHint(opts.cliPath) }),
      warning: null
    })
  }

  if (refreshExp - now < WARN_DAYS * DAY_MS) {
    return Object.assign({}, facts, {
      state: STATE.EXPIRING_SOON,
      canRun: true, // still runs — this is a heads-up, not a gate
      refusal: null,
      warning: t('cred.expiringSoon', { days: facts.daysLeft, hint: loginHint(opts.cliPath) })
    })
  }

  // The access token being stale here is normal and NOT a problem: the CLI renews it from
  // the refresh token. It is reported, never acted on.
  return Object.assign({}, facts, { state: STATE.OK, canRun: true, refusal: null, warning: null })
}

module.exports = { checkCredentialHealth, credentialsPath, loginHint, STATE, WARN_DAYS }
