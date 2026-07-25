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

const SECRETS_DIR = 'C:\\Aroma\\secrets'
const CLIENT_FILE = path.join(SECRETS_DIR, 'google-oauth-client.json')
const TOKEN_FILE = path.join(SECRETS_DIR, 'google-refresh-token.json')

// READ-ONLY scopes ONLY. Adding a write scope here is a design violation.
const READONLY_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly'
])

function loadGoogleapis () { return require('googleapis').google } // lazy — only when live

function credsPresent () { return fs.existsSync(CLIENT_FILE) && fs.existsSync(TOKEN_FILE) }

function createOAuthClient () {
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

module.exports = { SECRETS_DIR, CLIENT_FILE, TOKEN_FILE, READONLY_SCOPES, credsPresent, createOAuthClient, service, loadGoogleapis }
