'use strict'
const crypto = require('node:crypto')
const auth = require('../context/googleAuth')
const REDIRECT = auth.CONSENT_REDIRECT
function createFlow ({ clientFactory: makeClient = auth.createConsentClient, saveToken: persist = auth.persistRefreshToken, clock = () => Date.now() } = {}) {
  const pending = new Map()
  function begin () {
    for (const [key, entry] of pending) if (entry.expires <= clock()) pending.delete(key)
    if (pending.size >= 8) throw Error('oauth_busy')
    const client = makeClient(); const state = crypto.randomBytes(32).toString('base64url')
    const cookie = crypto.randomBytes(32).toString('base64url'); const verifier = crypto.randomBytes(48).toString('base64url')
    const url = client.generateAuthUrl({ response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: false,
      scope: auth.READONLY_SCOPES, redirect_uri: REDIRECT, state, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') })
    if (new URL(url).origin !== 'https://accounts.google.com') throw Error('oauth_configuration')
    pending.set(state, { client, cookie, verifier, expires: clock() + 600000 })
    return { url, cookie }
  }
  async function finish ({ state, code, cookie, error }) {
    const entry = typeof state === 'string' && pending.get(state)
    if (!entry || entry.expires <= clock() || typeof cookie !== 'string' || cookie.length !== entry.cookie.length || !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(entry.cookie))) throw Error('invalid_flow')
    pending.delete(state)
    if (error || typeof code !== 'string' || !code || code.length > 4096) throw Error('authorization_declined')
    const { tokens } = await entry.client.getToken({ code, codeVerifier: entry.verifier, redirect_uri: REDIRECT })
    if (!tokens || !tokens.access_token || !tokens.refresh_token) throw Error('incomplete_grant')
    const info = await entry.client.getTokenInfo(tokens.access_token)
    if (!Array.isArray(info.scopes) || auth.READONLY_SCOPES.some(s => !info.scopes.includes(s))) throw Error('incomplete_grant')
    if (entry.expires <= clock()) throw Error('invalid_flow')
    persist(tokens.refresh_token)
  }
  return { begin, finish }
}
module.exports = { createFlow, REDIRECT }
