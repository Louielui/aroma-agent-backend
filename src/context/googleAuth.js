'use strict'

/**
 * googleAuth.js — runtime loader for Google read-only credentials. It reads the
 * OAuth client file (placed by Louie) + the refresh token (written by the bootstrap
 * helper Louie runs) from C:\Aroma\secrets\ and builds an authorized googleapis
 * service. WALL 2: only the three READ-ONLY scopes are ever requested/used; there
 * is no write scope anywhere in this file.
 *
 * Fail-closed: if either file is missing it throws (the adapter turns that into a
 * trust:'unavailable' result), never blocking startup. It NEVER logs, prints, or
 * returns the token value. `googleapis` is lazy-required so the module loads even
 * before the dependency is installed (tests inject fake service clients).
 */

const fs = require('node:fs')
const path = require('node:path')
const { isTestProcess } = require('../testProcess')

const SECRETS_DIR = 'C:\\Aroma\\secrets'
const CLIENT_FILE = path.join(SECRETS_DIR, 'google-oauth-client.json')
const TOKEN_FILE = path.join(SECRETS_DIR, 'google-refresh-token.json')

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ A TEST MAY NOT USE THE OWNER'S GOOGLE IDENTITY.
 *
 * MEASURED, NOT SUSPECTED. An instrumented canonical run made **30 live authenticated
 * requests to `oauth2.googleapis.com` per run**, with the real refresh token on this machine,
 * and it happened whether or not any model credential was present. Worse, one test's OUTCOME
 * was decided by it: blocking the traffic flipped `chatBrainAuthoritySeparation.test.js:213`
 * from `distill_with_answer_plan` to `null`. A role-separation test had quietly become a
 * Google-connectivity test, and the canonical suite was only green because these two files
 * happen to sit on this disk.
 *
 * The path ran through the automatic read-context layer, which builds its own connector when
 * a test injects none (`intake/intakeService.js:1238`) — so `context/liveClients.js` asked
 * this module for a live Drive/Gmail/Calendar service, and this module handed one over.
 *
 * ── WHY THE GUARD IS THE FIRST STATEMENT OF createOAuthClient, NOT MERELY BEFORE THE READ ──
 * Two separate things had to stop: the refresh token being READ into a test process, and the
 * request LEAVING. Blocking only the socket would still pull the token into memory, where a
 * later edit could log or serialise it. **A token that was never read cannot leak.** So the
 * guard runs ahead of the existence checks, the SDK load, both `readFileSync` calls, the
 * OAuth2 construction and `setCredentials` — and a survey test asserts that ORDERING, because
 * a guard in the right file at the wrong line is a guard that reads like one.
 *
 * ⛔ GOOGLE HAS ITS OWN AUTHORITY, AND `RUN_PAID_E2E` IS NOT IT. Permission to spend money on
 * a model provider is not permission to act as Louie on his own Google account. Two different
 * risks, two different switches, and neither one implies the other.
 *
 * ⛔ OPT-IN, NEVER OPT-OUT, AND LITERAL. `'0'`, `'true'`, `'yes'` and `' 1'` are all NOT
 * consent. Live work fails toward OFF — the ruling `governance/startupSmokeOptIn.test.js`
 * already settled for paid model work, applied here to identity.
 *
 * ⛔ IT CHANGES NOTHING IN PRODUCTION. The resident service matches none of the three test
 * signals, so `googleLiveAuthAllowed` returns on its FIRST branch and `createOAuthClient`
 * proceeds byte-for-byte as before. Same scopes, same client, same reads.
 *
 * ⛔ AND `credsPresent()` IS DELIBERATELY NOT GUARDED. It is `existsSync` only: no content, no
 * network. Guarding it would change what `connectionState` reports in hundreds of tests for no
 * safety gained. Its machine-dependence is recorded separately, not fixed here.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const GOOGLE_LIVE_OPT_IN = 'RUN_LIVE_GOOGLE_E2E'
const GOOGLE_OPT_IN_VALUE = '1'
const GOOGLE_BLOCKED_MARKER = '[AROMA-GOOGLE-LIVE-AUTH-BLOCKED]'

/**
 * May this process build a LIVE Google client from the machine credentials?
 *
 * @param {object} [env]
 * @param {string[]} [argv]
 * @param {string|null} [mainFile]
 * @returns {boolean}
 */
function googleLiveAuthAllowed (env = process.env, argv = process.argv, mainFile) {
  const main = mainFile === undefined ? ((require.main && require.main.filename) || null) : mainFile
  // ⛔ ORDINARY RUNTIME FIRST, AND IT RETURNS BEFORE THE OPT-IN IS EVEN READ.
  if (!isTestProcess(env, argv, main)) return true
  // A test process. Fail closed unless someone deliberately asked for the Owner's identity.
  return !!env && env[GOOGLE_LIVE_OPT_IN] === GOOGLE_OPT_IN_VALUE
}

/**
 * Refuse a live Google client in a test process — loudly, and before anything is opened.
 *
 * ⛔ THE MARKER CARRIES ONE FIELD: THE NAME OF THE AUTHORITY. No path, no file name, no client
 * id, no token, no Owner content. `liveClients` catches this throw fail-soft and records the
 * source as skipped, so without the marker a withheld call would be a silent drop — the
 * standing defect class in this repository.
 *
 * @throws {Error} with `googleLiveAuthBlocked === true`
 */
function assertGoogleLiveAuthAllowed () {
  if (googleLiveAuthAllowed()) return
  try {
    console.error(GOOGLE_BLOCKED_MARKER, JSON.stringify({ optIn: GOOGLE_LIVE_OPT_IN }))
  } catch (_) { /* a diagnostic may never be the reason a refusal fails */ }
  const e = new Error(
    'googleAuth: a test process may not use the machine Google credentials. ' +
    'Inject a fake connector or client, or set ' + GOOGLE_LIVE_OPT_IN + '=' + GOOGLE_OPT_IN_VALUE + '.')
  e.googleLiveAuthBlocked = true
  throw e
}

// READ-ONLY scopes ONLY. Adding a write scope here is a design violation.
const READONLY_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly'
])

function loadGoogleapis () { return require('googleapis').google } // lazy — only when live

function credsPresent () { return fs.existsSync(CLIENT_FILE) && fs.existsSync(TOKEN_FILE) }

function createOAuthClient () {
  // ⛔ FIRST EXECUTABLE ACTION. Nothing may precede it — not an existence check, not the SDK
  // load, and above all not a read. See the block above; a survey test pins this ordering.
  assertGoogleLiveAuthAllowed()
  if (!fs.existsSync(CLIENT_FILE)) throw new Error('google client file missing (C:\\Aroma\\secrets\\google-oauth-client.json)')
  if (!fs.existsSync(TOKEN_FILE)) throw new Error('google refresh token missing — run scripts/bootstrap-google-token.js')
  const google = loadGoogleapis()
  const raw = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8'))
  const w = raw.installed || raw.web || raw
  const redirect = (w.redirect_uris && w.redirect_uris[0]) || 'http://localhost:5599/oauth2callback'
  const oauth = new google.auth.OAuth2(w.client_id, w.client_secret, redirect)
  const tok = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
  oauth.setCredentials({ refresh_token: tok.refresh_token })
  return oauth
}

/** Build an authorized read-only service (drive|gmail|calendar). Throws if creds absent. */
function service (name, version) {
  const google = loadGoogleapis()
  return google[name]({ version, auth: createOAuthClient() })
}

module.exports = {
  SECRETS_DIR,
  CLIENT_FILE,
  TOKEN_FILE,
  READONLY_SCOPES,
  credsPresent,
  createOAuthClient,
  service,
  loadGoogleapis,
  googleLiveAuthAllowed,
  assertGoogleLiveAuthAllowed,
  GOOGLE_LIVE_OPT_IN,
  GOOGLE_OPT_IN_VALUE,
  GOOGLE_BLOCKED_MARKER
}
