'use strict'
const crypto = require('node:crypto')
const googleAuth = require('../context/googleAuth')
const REDIRECT = googleAuth.MEMBER_REDIRECT
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
function createFlow ({ registry, clientFactory = googleAuth.createMemberConsentClient, clock = () => Date.now() }) {
  const pending = new Map(); const sessions = new Map()
  function sweep () {
    for (const [id, entry] of pending) if (entry.expires <= clock()) pending.delete(id)
    for (const [id, entry] of sessions) if (entry.expires <= clock()) sessions.delete(id)
  }
  function begin () {
    sweep()
    if (pending.size >= 8 || sessions.size >= 50) throw Error('oauth_busy')
    const { client, audience } = clientFactory()
    const state = crypto.randomBytes(32).toString('base64url'); const cookie = crypto.randomBytes(32).toString('base64url')
    const verifier = crypto.randomBytes(48).toString('base64url'); const nonce = crypto.randomBytes(32).toString('base64url')
    const url = client.generateAuthUrl({ response_type: 'code', access_type: 'online', prompt: 'select_account', include_granted_scopes: false,
      scope: ['openid', 'email', DRIVE_SCOPE], redirect_uri: REDIRECT, state, nonce,
      code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') })
    if (new URL(url).origin !== 'https://accounts.google.com') throw Error('oauth_configuration')
    pending.set(state, { client, audience, cookie, verifier, nonce, expires: clock() + 600000 })
    return { url, cookie }
  }
  async function finish ({ state, code, cookie, error }) {
    sweep()
    const entry = typeof state === 'string' && pending.get(state)
    const a = Buffer.from(typeof cookie === 'string' ? cookie : ''); const b = Buffer.from(entry?.cookie || '')
    if (!entry || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw Error('invalid_flow')
    pending.delete(state)
    if (error || typeof code !== 'string' || !code || code.length > 4096) throw Error('authorization_declined')
    const { tokens } = await entry.client.getToken({ code, codeVerifier: entry.verifier, redirect_uri: REDIRECT })
    if (!tokens?.access_token || !tokens.id_token) throw Error('incomplete_grant')
    const ticket = await entry.client.verifyIdToken({ idToken: tokens.id_token, audience: entry.audience })
    const claims = ticket.getPayload()
    if (!claims || claims.nonce !== entry.nonce) throw Error('invalid_identity')
    const info = await entry.client.getTokenInfo(tokens.access_token)
    if (!info.scopes?.includes(DRIVE_SCOPE) || entry.expires <= clock()) throw Error('incomplete_grant')
    const expires = Math.min(clock() + 3600000, tokens.expiry_date || clock() + 3600000)
    if (expires <= clock() || sessions.size >= 50) throw Error('invalid_flow')
    registry.bind(claims)
    entry.client.setCredentials({ access_token: tokens.access_token, expiry_date: expires })
    const id = crypto.randomBytes(32).toString('base64url')
    sessions.set(id, { sub: claims.sub, client: entry.client, expires })
    return id
  }
  function get (id) {
    sweep(); const session = sessions.get(id)
    if (!session || !registry.identity(session.sub)) return null
    return session
  }
  return { begin, finish, get, revoke: id => sessions.delete(id) }
}
function googleReaders () {
  function drive (session) { return googleAuth.serviceWithOAuth('drive', 'v3', session.client) }
  return {
    getFile: async (session, id) => (await drive(session).files.get({ fileId: id, supportsAllDrives: true,
      fields: 'id,name,mimeType,parents,driveId,trashed,modifiedTime' })).data,
    listFiles: async (session, id, driveId) => (await drive(session).files.list({
      q: "'" + id + "' in parents and trashed = false", corpora: 'drive', driveId, supportsAllDrives: true, includeItemsFromAllDrives: true,
      pageSize: 25, orderBy: 'folder,name', fields: 'files(id,mimeType),nextPageToken,incompleteSearch'
    })).data
  }
}
module.exports = { createFlow, googleReaders, REDIRECT }
