'use strict'

/**
 * bootstrap-google-token.js — ONE-TIME helper that LOUIE runs himself to obtain a
 * Google refresh token for READ-ONLY access. Claude Code must NEVER run this, never
 * supply credentials, and never print the client secret, the auth code, or the token.
 *
 * It reads the OAuth client file at C:\Aroma\secrets\google-oauth-client.json, builds
 * a consent URL requesting ONLY the three read-only scopes (drive.readonly,
 * gmail.readonly, calendar.readonly), captures the authorization code (loopback
 * callback, or manual paste), exchanges it, and writes ONLY the refresh token to
 * C:\Aroma\secrets\google-refresh-token.json.
 *
 * FIXED (2026-07-25) — "Error 400: invalid_request / Required parameter is missing:
 * response_type". The generated URL was correct, but it was handed to the browser via
 * `cmd /c start <url>`, and Windows cmd treats `&` as a COMMAND SEPARATOR: everything
 * after the first `&` was stripped, so Google received only `?access_type=offline`.
 * Now the URL is NEVER passed through a shell — it is printed for the operator to open,
 * and the optional auto-open uses spawn(..., {shell:false}) so argv reaches the OS
 * verbatim. response_type/access_type/prompt are also set explicitly, and the built URL
 * is self-validated (fail-closed) before it is shown.
 *
 * Usage (Louie, in his own terminal, from C:\Aroma\aroma-agent-backend):
 *   node scripts/bootstrap-google-token.js
 *       [--manual]        skip the loopback server and paste the code yourself
 *       [--no-open]       print the URL only, never try to open a browser
 */

const fs = require('node:fs')
const http = require('node:http')
const readline = require('node:readline')
const { URL } = require('node:url')
const { spawn } = require('node:child_process')

const { SECRETS_DIR, CLIENT_FILE, TOKEN_FILE, READONLY_SCOPES, loadGoogleapis } = require('../src/context/googleAuth')

const DEFAULT_LOOPBACK = 'http://localhost:5599/oauth2callback'
const OOB = 'urn:ietf:wg:oauth:2.0:oob'
const CODE_WAIT_MS = 5 * 60 * 1000 // 5 minutes to approve in the browser

/** Fail-closed: only *.readonly scopes may EVER be requested. */
function assertReadOnlyScopes (scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) throw new Error('refuse: no scopes')
  for (const s of scopes) {
    if (!/\.readonly$/.test(s)) throw new Error(`refuse: non-readonly scope requested (${s})`)
  }
  return scopes
}

/**
 * Choose the redirect URI from what the client actually declares — WITHOUT printing
 * the file. Desktop ("installed") clients accept any loopback port, so an empty
 * redirect_uris list is fine. Returns { uri, mode: 'loopback'|'manual', port|null }.
 */
function pickRedirectUri (w, opts = {}) {
  if (opts.manual) return { uri: OOB, mode: 'manual', port: null }
  const uris = Array.isArray(w && w.redirect_uris) ? w.redirect_uris : []
  const loopback = uris.find((u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(u))
  if (loopback) {
    const p = new URL(loopback).port
    return { uri: loopback, mode: 'loopback', port: p ? Number(p) : 80 }
  }
  if (uris.some((u) => u === OOB)) return { uri: OOB, mode: 'manual', port: null }
  if (uris.length === 0) return { uri: DEFAULT_LOOPBACK, mode: 'loopback', port: 5599 } // desktop client
  return { uri: uris[0], mode: 'manual', port: null } // custom scheme -> manual paste
}

/**
 * Build the consent URL with every required parameter EXPLICIT, then self-validate.
 * Throws if the result is missing response_type / access_type / prompt / the exact
 * three read-only scopes — so a malformed URL can never be handed to the operator.
 */
function buildAuthUrl (oauth, scopes, redirectUri) {
  assertReadOnlyScopes(scopes)
  const url = oauth.generateAuthUrl({
    response_type: 'code', // explicit: the missing-parameter error was about this
    access_type: 'offline', // required to receive a refresh_token
    prompt: 'consent', // force refresh_token issuance even on re-auth
    include_granted_scopes: false,
    scope: scopes,
    redirect_uri: redirectUri
  })
  assertAuthUrlValid(url, scopes)
  return url
}

/** Fail-closed validation of a built consent URL (regression guard for this bug). */
function assertAuthUrlValid (url, scopes) {
  const u = new URL(url)
  const q = u.searchParams
  if (q.get('response_type') !== 'code') throw new Error('refuse: auth URL missing response_type=code')
  if (q.get('access_type') !== 'offline') throw new Error('refuse: auth URL missing access_type=offline')
  if (q.get('prompt') !== 'consent') throw new Error('refuse: auth URL missing prompt=consent')
  if (!q.get('client_id')) throw new Error('refuse: auth URL missing client_id')
  if (!q.get('redirect_uri')) throw new Error('refuse: auth URL missing redirect_uri')
  const got = String(q.get('scope') || '').split(/[\s+]+/).filter(Boolean).sort()
  const want = [...scopes].sort()
  if (got.length !== want.length || got.some((s, i) => s !== want[i])) throw new Error('refuse: auth URL scope set does not match the three read-only scopes')
  assertReadOnlyScopes(got)
  return true
}

/**
 * Best-effort browser open that NEVER goes through a shell (this was the bug: cmd
 * splits the URL at `&`). argv is passed straight to the OS, so the URL stays intact.
 * Failure is non-fatal — the URL is always printed for manual opening.
 */
function tryOpenBrowser (url) {
  try {
    if (process.platform === 'win32') {
      // rundll32 receives argv directly; no cmd, no shell metacharacter parsing.
      spawn('rundll32', ['url.dll,FileProtocolHandler', url], { shell: false, stdio: 'ignore', detached: true }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { shell: false, stdio: 'ignore', detached: true }).unref()
    } else {
      spawn('xdg-open', [url], { shell: false, stdio: 'ignore', detached: true }).unref()
    }
  } catch (_) { /* non-fatal: the operator can copy the printed URL */ }
}

/** Wait for the loopback redirect and return the authorization code (never printed). */
function waitForLoopbackCode (port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let u
      try { u = new URL(req.url, `http://localhost:${port}`) } catch (_) { res.writeHead(400); res.end(); return }
      const code = u.searchParams.get('code')
      const err = u.searchParams.get('error')
      if (!code && !err) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(err ? `Authorization failed: ${err}. You can close this tab.` : '守燈 read-only access granted. You can close this tab.')
      server.close()
      clearTimeout(timer)
      if (err) reject(new Error(`consent denied or failed: ${err}`))
      else resolve(code)
    })
    const timer = setTimeout(() => { server.close(); reject(new Error('timed out waiting for the browser redirect (5 min)')) }, CODE_WAIT_MS)
    server.on('error', (e) => { clearTimeout(timer); reject(e) })
    server.listen(port)
  })
}

/** Manual fallback: paste the code shown by Google. Input is never echoed to logs. */
function promptForCode () {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question('\nPaste the authorization code here, then press Enter: ', (a) => { rl.close(); resolve(String(a || '').trim()) })
  })
}

async function main (argv = process.argv.slice(2)) {
  const manual = argv.includes('--manual')
  const noOpen = argv.includes('--no-open')

  if (!fs.existsSync(CLIENT_FILE)) {
    console.error(`[bootstrap] client file not found: ${CLIENT_FILE}\nPlace your Google OAuth client JSON there first (exact filename, no double extension).`)
    return 3
  }
  assertReadOnlyScopes(READONLY_SCOPES)

  const google = loadGoogleapis()
  const raw = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8')) // contents never printed
  const w = raw.installed || raw.web || raw
  if (!w || !w.client_id || !w.client_secret) {
    console.error('[bootstrap] client file is missing client_id/client_secret (expected an "installed"/Desktop OAuth client JSON).')
    return 3
  }

  const redirect = pickRedirectUri(w, { manual })
  const oauth = new google.auth.OAuth2(w.client_id, w.client_secret, redirect.uri)

  let authUrl
  try {
    authUrl = buildAuthUrl(oauth, READONLY_SCOPES, redirect.uri)
  } catch (e) {
    console.error(`[bootstrap] ${e.message}`)
    return 3
  }

  console.log('\n[bootstrap] Requesting READ-ONLY access only:')
  for (const s of READONLY_SCOPES) console.log('  - ' + s)
  console.log(`[bootstrap] redirect mode: ${redirect.mode}${redirect.port ? ` (loopback port ${redirect.port})` : ''}`)
  console.log('\n[bootstrap] Open this URL in your browser and approve (copy the WHOLE line):\n')
  console.log(authUrl + '\n')
  if (!noOpen) tryOpenBrowser(authUrl)

  let code
  if (redirect.mode === 'loopback') {
    try {
      code = await waitForLoopbackCode(redirect.port)
    } catch (e) {
      console.error(`[bootstrap] loopback capture failed (${e.message}). Falling back to manual paste.`)
      code = await promptForCode()
    }
  } else {
    code = await promptForCode()
  }
  if (!code) { console.error('[bootstrap] no authorization code received.'); return 3 }

  const { tokens } = await oauth.getToken(code) // code + tokens never printed
  if (!tokens || !tokens.refresh_token) {
    console.error('[bootstrap] no refresh_token returned. Revoke the prior grant at myaccount.google.com/permissions and re-run (prompt=consent is already set).')
    return 3
  }
  if (!fs.existsSync(SECRETS_DIR)) fs.mkdirSync(SECRETS_DIR, { recursive: true })
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: tokens.refresh_token, scopes: READONLY_SCOPES, obtainedAt: new Date().toISOString() }, null, 2))
  try { fs.chmodSync(TOKEN_FILE, 0o600) } catch (_) {}
  console.log(`[bootstrap] refresh token written to ${TOKEN_FILE} (value not printed). Read-only access is ready.`)
  return 0
}

if (require.main === module) {
  main().then((c) => process.exit(c || 0)).catch((e) => { console.error('[bootstrap] failed:', e && e.message ? e.message : String(e)); process.exit(1) })
}

module.exports = { assertReadOnlyScopes, assertAuthUrlValid, buildAuthUrl, pickRedirectUri, tryOpenBrowser, DEFAULT_LOOPBACK, OOB, READONLY_SCOPES }
