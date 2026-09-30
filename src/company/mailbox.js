'use strict'
const crypto = require('node:crypto')
const auth = require('../context/googleAuth')
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
function createMailbox ({ registry, clientFactory = auth.createAdminMailConsentClient,
  serviceFor = client => auth.serviceWithOAuth('gmail', 'v1', client),
  save = auth.saveAdminMailGrant, load = auth.loadAdminMailGrant, clear = auth.clearAdminMailGrant,
  present = auth.adminMailPresent, clock = () => Date.now() }) {
  const pending = new Map(); let epoch = 0
  const accessRevision = () => registry.mailRevision ? registry.mailRevision() : registry.revision()
  const expected = () => registry.source('admin-mail').mailbox
  function status () {
    const source = registry.source('admin-mail')
    return { mailbox: source.mailbox, state: present() ? source.state : 'not_connected', checkedAt: source.checkedAt || null }
  }
  function begin () {
    for (const [key, v] of pending) if (v.expires <= clock()) pending.delete(key)
    if (pending.size >= 4 || !expected()) throw Error('mail_oauth_unavailable')
    const { client, audience } = clientFactory()
    const state = crypto.randomBytes(32).toString('base64url'); const cookie = crypto.randomBytes(32).toString('base64url')
    const nonce = crypto.randomBytes(32).toString('base64url'); const verifier = crypto.randomBytes(48).toString('base64url')
    const url = client.generateAuthUrl({ response_type: 'code', access_type: 'offline', prompt: 'consent select_account',
      scope: ['openid', 'email', SCOPE], include_granted_scopes: false, login_hint: expected(),
      redirect_uri: auth.ADMIN_MAIL_REDIRECT, state, nonce, code_challenge_method: 'S256',
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') })
    if (new URL(url).origin !== 'https://accounts.google.com') throw Error('oauth_configuration')
    pending.set(state, { client, audience, cookie, nonce, verifier, epoch, expires: clock() + 600000 })
    return { url, cookie }
  }
  async function finish ({ state, cookie, code, error }) {
    const entry = typeof state === 'string' && pending.get(state)
    const a = Buffer.from(typeof cookie === 'string' ? cookie : ''); const b = Buffer.from(entry?.cookie || '')
    if (!entry || a.length !== b.length || !crypto.timingSafeEqual(a, b) || entry.expires <= clock() || entry.epoch !== epoch) throw Error('invalid_flow')
    pending.delete(state)
    if (error || typeof code !== 'string' || !code || code.length > 4096) throw Error('authorization_declined')
    const { tokens } = await entry.client.getToken({ code, codeVerifier: entry.verifier, redirect_uri: auth.ADMIN_MAIL_REDIRECT })
    if (!tokens?.id_token || !tokens.access_token || !tokens.refresh_token) throw Error('incomplete_grant')
    const claims = (await entry.client.verifyIdToken({ idToken: tokens.id_token, audience: entry.audience })).getPayload()
    if (!claims || claims.nonce !== entry.nonce || claims.email_verified !== true ||
        claims.email?.toLowerCase() !== expected() || claims.hd !== registry.snapshot().tenantDomain ||
        typeof claims.sub !== 'string' || !claims.sub) throw Error('wrong_mailbox')
    const info = await entry.client.getTokenInfo(tokens.access_token)
    if (!info.scopes?.includes(SCOPE)) throw Error('incomplete_grant')
    entry.client.setCredentials({ access_token: tokens.access_token })
    const profile = (await serviceFor(entry.client).users.getProfile({ userId: 'me' })).data
    if (profile.emailAddress?.toLowerCase() !== expected()) throw Error('wrong_mailbox')
    if (entry.expires <= clock() || entry.epoch !== epoch) throw Error('invalid_flow')
    save({ email: expected(), sub: claims.sub, refresh_token: tokens.refresh_token })
    registry.recordMailState('connected'); epoch++; pending.clear()
  }
  function disconnect () {
    epoch++; pending.clear()
    registry.recordMailState('not_connected')
    clear()
  }
  function allowed (actor) { return actor?.owner === true || registry.mailAllowed(actor?.sub) }
  function lease (actor) {
    const revision = accessRevision(); const startEpoch = epoch
    return () => {
      if (!allowed(actor) || !present() || registry.source('admin-mail').state === 'not_connected' || revision !== accessRevision() || startEpoch !== epoch) throw Error('mail_access_denied')
    }
  }
  async function guarded (actor, work) {
    if (!allowed(actor) || !present() || registry.source('admin-mail').state === 'not_connected') throw Error('mail_access_denied')
    const revision = accessRevision(); const startEpoch = epoch
    let output
    try {
      const grant = load()
      if (grant.email !== expected()) throw Error('wrong_mailbox')
      const gmail = serviceFor(grant.client)
      const profile = (await gmail.users.getProfile({ userId: 'me' })).data
      if (profile.emailAddress?.toLowerCase() !== expected()) throw Error('wrong_mailbox')
      output = await work(gmail)
    } catch (_) {
      if (startEpoch === epoch && revision === accessRevision()) registry.recordMailState('failed', actor.owner === true ? 'owner' : registry.identity(actor.sub).id)
      throw Error('mail_read_failed')
    }
    if (!allowed(actor) || revision !== accessRevision() || startEpoch !== epoch) throw Error('mail_access_denied')
    registry.recordMailState('connected', actor.owner === true ? 'owner' : registry.identity(actor.sub).id)
    return output
  }
  const validId = id => typeof id === 'string' && /^[a-f0-9]{1,100}$/i.test(id)
  function metadata (message, id) {
    if (message.id !== id) throw Error('invalid_message')
    const header = name => (message.payload?.headers || []).find(h => h.name?.toLowerCase() === name)?.value || null
    return { id, threadId: validId(message.threadId) ? message.threadId : null, internalDate: message.internalDate || null, subject: header('subject'), from: header('from'), date: header('date'), snippet: message.snippet || null,
      link: 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(expected()) + '#all/' + id }
  }
  async function search (actor, { q = '', inbox = false } = {}) {
    if (typeof q !== 'string' || q.length > 400 || /[\r\n\0]/.test(q) || typeof inbox !== 'boolean') throw Error('invalid_mail_query')
    return guarded(actor, async gmail => {
      const page = (await gmail.users.messages.list({ userId: 'me', ...(inbox ? { labelIds: ['INBOX'] } : {}), ...(q ? { q } : {}), maxResults: 10 })).data
      const messages = []
      for (const row of (page.messages || []).slice(0, 10)) {
        if (!validId(row.id)) throw Error('invalid_message')
        const message = (await gmail.users.messages.get({ userId: 'me', id: row.id, format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'], fields: 'id,snippet,payload/headers' })).data
        messages.push(metadata(message, row.id))
      }
      return { mailbox: expected(), messages, truncated: !!page.nextPageToken, readAt: new Date(clock()).toISOString(), query: q, scope: inbox ? 'inbox_metadata' : 'search_metadata' }
    })
  }
  function read (actor, id) {
    if (!validId(id)) return Promise.reject(Error('invalid_message'))
    return guarded(actor, async gmail => {
      const message = (await gmail.users.messages.get({ userId: 'me', id, format: 'full', fields: 'id,threadId,internalDate,snippet,payload' })).data
      return { ...metadata(message, id), ...require('./mailBody').decodeBody(message.payload), mailbox: expected(), readAt: new Date(clock()).toISOString() }
    })
  }
  function scan (actor, { q, pageToken } = {}) {
    if (typeof q !== 'string' || q.length > 400 || (pageToken && (typeof pageToken !== 'string' || pageToken.length > 4096))) throw Error('invalid_mail_query')
    return guarded(actor, async gmail => {
      const page = (await gmail.users.messages.list({ userId: 'me', q, maxResults: 10, ...(pageToken ? { pageToken } : {}) })).data
      if (!Array.isArray(page.messages || []) || (page.messages || []).some(r => !validId(r.id))) throw Error('invalid_message')
      return { messages: (page.messages || []).slice(0, 10).map(r => ({ id: r.id })), nextPageToken: page.nextPageToken || null }
    })
  }
  return { status, begin, finish, disconnect, preview: actor => search(actor, { inbox: true }), search, read, lease,
    scan, check: actor => guarded(actor, async () => ({ mailbox: expected() })) }
}
module.exports = { createMailbox }
