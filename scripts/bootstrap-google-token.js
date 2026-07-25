'use strict'

/**
 * bootstrap-google-token.js — ONE-TIME helper that LOUIE runs himself to obtain a
 * Google refresh token for READ-ONLY access. Claude Code must NEVER run this, never
 * supply credentials, and never print the token.
 *
 * It reads the OAuth client file at C:\Aroma\secrets\google-oauth-client.json,
 * prints a consent URL requesting ONLY the three read-only scopes (drive.readonly,
 * gmail.readonly, calendar.readonly), waits on a tiny loopback server for the
 * redirect, exchanges the code, and writes ONLY the refresh token to
 * C:\Aroma\secrets\google-refresh-token.json (chmod-restricted where supported).
 * The token value is never printed to the console.
 *
 * Usage (Louie, in his own terminal):
 *   node scripts/bootstrap-google-token.js
 * then approve in the browser window that opens.
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { URL } = require('node:url')
const { spawn } = require('node:child_process')

const { SECRETS_DIR, CLIENT_FILE, TOKEN_FILE, READONLY_SCOPES, loadGoogleapis } = require('../src/context/googleAuth')
const REDIRECT_PORT = 5599
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`

function assertReadOnlyScopes (scopes) {
  for (const s of scopes) {
    if (!/\.readonly$/.test(s)) throw new Error(`refuse: non-readonly scope requested (${s})`)
  }
}

async function main () {
  if (!fs.existsSync(CLIENT_FILE)) {
    console.error(`[bootstrap] client file not found: ${CLIENT_FILE}\nPlace your Google OAuth client JSON there first.`)
    return 3
  }
  assertReadOnlyScopes(READONLY_SCOPES) // hard guard: only *.readonly may ever be requested

  const google = loadGoogleapis()
  const raw = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8'))
  const w = raw.installed || raw.web || raw
  const oauth = new google.auth.OAuth2(w.client_id, w.client_secret, REDIRECT_URI)

  const authUrl = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: READONLY_SCOPES })
  console.log('\n[bootstrap] Approve READ-ONLY access (drive/gmail/calendar) in your browser:')
  console.log(authUrl + '\n')
  try { spawn(process.platform === 'win32' ? 'cmd' : 'open', process.platform === 'win32' ? ['/c', 'start', '', authUrl] : [authUrl], { stdio: 'ignore', detached: true }).unref() } catch (_) {}

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, REDIRECT_URI)
        if (u.pathname !== '/oauth2callback') { res.writeHead(404); res.end(); return }
        const c = u.searchParams.get('code')
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('香香 read-only access granted. You can close this tab.')
        server.close()
        if (c) resolve(c); else reject(new Error('no code in redirect'))
      } catch (e) { reject(e) }
    })
    server.on('error', reject)
    server.listen(REDIRECT_PORT)
  })

  const { tokens } = await oauth.getToken(code)
  if (!tokens || !tokens.refresh_token) {
    console.error('[bootstrap] no refresh_token returned (revoke prior grant and retry with prompt=consent).')
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

module.exports = { assertReadOnlyScopes, REDIRECT_URI, READONLY_SCOPES }
