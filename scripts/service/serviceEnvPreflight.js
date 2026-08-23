'use strict'
/**
 * serviceEnvPreflight.js — DOES THIS PROCESS HAVE WHAT IT NEEDS, AND WHICH THING IS MISSING?
 *
 * ⛔ NAMES AND BOOLEANS ONLY. It reports that HUB_TOKEN is absent; it never reports what
 * HUB_TOKEN is, never logs a prefix, never logs a length. A preflight that helpfully prints
 * "starts with sk-" has published the secret it was written to protect.
 *
 * ⛔ AND IT FAILS CLOSED. A service that starts without a credential does not fail — it comes
 * up healthy and answers every question wrongly, which is worse than not starting. The
 * launcher already refuses on an empty key (xiangxiang-body.ps1:95); this is the same rule on
 * the service path, so changing the owner does not quietly relax it.
 */

const { INSTALL_TIME_REQUIRED } = require('./runtimeContract')

/** PRESENT / ABSENT per required key. `env` is injectable so a test never touches process.env. */
function checkInstallTimeEnv (env = process.env, required = INSTALL_TIME_REQUIRED) {
  const status = {}
  const missing = []
  for (const key of required) {
    const v = env ? env[key] : undefined
    const present = typeof v === 'string' && v.trim() !== ''
    status[key] = present ? 'PRESENT' : 'ABSENT'
    if (!present) missing.push(key)
  }
  return { ok: missing.length === 0, missing, status }
}

/**
 * The one line a human reads in the service log. Names keys, never values, and it is the whole
 * reason a headless failure stays diagnosable.
 */
function preflightReport (result) {
  const pairs = Object.keys(result.status).map((k) => k + '=' + result.status[k]).join(' ')
  return '[AROMA-SERVICE] preflight ' + (result.ok ? 'OK' : 'FAILED') + ' ' + pairs
}

module.exports = { checkInstallTimeEnv, preflightReport }
