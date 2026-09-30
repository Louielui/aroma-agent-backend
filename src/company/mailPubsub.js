'use strict'
const crypto = require('node:crypto')
const auth = require('../context/googleAuth')
const REDIRECT = 'http://127.0.0.1:8090/company/mail-notifications/callback'
const SCOPE = 'https://www.googleapis.com/auth/pubsub'
const PUBLISHER = 'serviceAccount:gmail-api-push@system.gserviceaccount.com'
function createMailPubsub ({ registry, factory = auth.createPubsubConsentClient, secrets = auth.pubsubGrantStore, service = auth.pubsubWithOAuth, clock = () => Date.now() }) {
  const pending = new Map(); let epoch = 0; let connection = null; let preparing = null
  const owner = () => registry.snapshot().users.find(u => u.role === 'owner')?.email
  const topic = project => 'projects/' + project + '/topics/xiangxiang-admin-mail'
  const subscription = project => 'projects/' + project + '/subscriptions/xiangxiang-admin-mail-local'
  function status () { return { configured: secrets.present(), state: connection ? 'ready' : secrets.present() ? 'setup_required' : 'not_connected',
    project: connection?.project || null, topic: connection ? topic(connection.project) : null } }
  function begin () {
    for (const [k, v] of pending) if (v.expires <= clock()) pending.delete(k)
    if (pending.size >= 4 || !owner()) throw Error('oauth_unavailable')
    const config = factory(); const state = crypto.randomBytes(32).toString('base64url'); const cookie = crypto.randomBytes(32).toString('base64url')
    const nonce = crypto.randomBytes(32).toString('base64url'); const verifier = crypto.randomBytes(48).toString('base64url')
    const url = config.client.generateAuthUrl({ response_type: 'code', access_type: 'offline', prompt: 'consent select_account',
      scope: ['openid', 'email', SCOPE], include_granted_scopes: false, login_hint: owner(), redirect_uri: REDIRECT,
      state, nonce, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') })
    if (new URL(url).origin !== 'https://accounts.google.com') throw Error('oauth_configuration')
    pending.set(state, { ...config, cookie, nonce, verifier, epoch, owner: owner(), expires: clock() + 600000 })
    return { url, cookie }
  }
  async function finish ({ state, cookie, code, error }) {
    const entry = typeof state === 'string' && pending.get(state)
    const a = Buffer.from(typeof cookie === 'string' ? cookie : ''); const b = Buffer.from(entry?.cookie || '')
    if (!entry || a.length !== b.length || !crypto.timingSafeEqual(a, b) || entry.expires <= clock() || entry.epoch !== epoch || entry.owner !== owner()) throw Error('invalid_flow')
    pending.delete(state)
    if (error || typeof code !== 'string' || !code || code.length > 4096) throw Error('authorization_declined')
    const { tokens } = await entry.client.getToken({ code, codeVerifier: entry.verifier, redirect_uri: REDIRECT })
    if (!tokens?.id_token || !tokens.access_token || !tokens.refresh_token) throw Error('incomplete_grant')
    const claims = (await entry.client.verifyIdToken({ idToken: tokens.id_token, audience: entry.audience })).getPayload()
    if (claims?.nonce !== entry.nonce || claims.email_verified !== true || claims.email?.toLowerCase() !== owner() ||
        claims.hd !== registry.snapshot().tenantDomain || !claims.sub) throw Error('wrong_identity')
    const info = await entry.client.getTokenInfo(tokens.access_token)
    if (!info.scopes?.includes(SCOPE)) throw Error('incomplete_grant')
    if (entry.expires <= clock() || entry.epoch !== epoch || entry.owner !== owner()) throw Error('invalid_flow')
    secrets.save({ email: owner(), sub: claims.sub, project: entry.project, refresh_token: tokens.refresh_token })
    epoch++; connection = null; pending.clear()
  }
  async function prepare () {
    if (connection) return
    if (preparing) return preparing
    const started = epoch
    preparing = (async () => {
      const grant = secrets.load(); const config = factory()
      if (grant.email !== owner() || grant.project !== config.project || !grant.refresh_token) throw Error('wrong_identity')
      config.client.setCredentials({ refresh_token: grant.refresh_token })
      const api = service(config.client); const projects = api.projects; const name = topic(config.project); const sub = subscription(config.project)
      const exists = async (get, create) => { try { return await get() } catch (e) { if (Number(e.code || e.response?.status) !== 404) throw e; return create() } }
      await exists(() => projects.topics.get({ topic: name }), () => projects.topics.create({ name, requestBody: {} }))
      const policy = (await projects.topics.getIamPolicy({ resource: name, 'options.requestedPolicyVersion': 3 })).data
      const binding = (policy.bindings || []).find(b => b.role === 'roles/pubsub.publisher' && !b.condition)
      if (!binding?.members?.includes(PUBLISHER)) {
        if (binding) binding.members = [...(binding.members || []), PUBLISHER]
        else policy.bindings = [...(policy.bindings || []), { role: 'roles/pubsub.publisher', members: [PUBLISHER] }]
        await projects.topics.setIamPolicy({ resource: name, requestBody: { policy } })
      }
      const existing = (await exists(() => projects.subscriptions.get({ subscription: sub }), () => projects.subscriptions.create({ name: sub,
        requestBody: { topic: name, ackDeadlineSeconds: 600, messageRetentionDuration: '604800s', expirationPolicy: {} } }))).data
      if (existing.topic !== name || existing.pushConfig?.pushEndpoint || existing.bigqueryConfig || existing.cloudStorageConfig) throw Error('subscription_configuration')
      if (epoch !== started || !secrets.present()) throw Error('invalid_flow')
      connection = { api, project: config.project, epoch }
    })().finally(() => { preparing = null })
    return preparing
  }
  async function pull () {
    if (!connection) throw Error('not_connected')
    const active = connection
    const result = await active.api.projects.subscriptions.pull({ subscription: subscription(active.project), requestBody: { maxMessages: 20 } }, { timeout: 25000, retry: false })
    if (active !== connection || active.epoch !== epoch) throw Error('invalid_flow')
    return result.data.receivedMessages || []
  }
  async function ack (ackIds) {
    if (!connection) throw Error('not_connected')
    await connection.api.projects.subscriptions.acknowledge({ subscription: subscription(connection.project), requestBody: { ackIds } })
  }
  function disconnect () { epoch++; connection = null; pending.clear(); secrets.clear() }
  return { status, begin, finish, prepare, pull, ack, disconnect }
}
module.exports = { createMailPubsub, REDIRECT }
