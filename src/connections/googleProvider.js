'use strict'
const auth = require('../context/googleAuth')
const { createLiveReadConnector } = require('../context/liveClients')
const { SOURCE_FLAG } = require('../context/flags')
const SCOPE = Object.freeze({ gmail: auth.READONLY_SCOPES[1], drive: auth.READONLY_SCOPES[0], calendar: auth.READONLY_SCOPES[2] })
function failure (code) { return Object.assign(Error('google_connection_failed'), { connectionCode: code }) }
function classify (e) {
  if (e.connectionCode) return e
  const status = e.response && e.response.status
  const kind = e.response && e.response.data && e.response.data.error
  return failure(status === 401 || kind === 'invalid_grant' ? 'auth' : status === 403 ? 'permission' : ['ETIMEDOUT', 'ECONNABORTED'].includes(e.code) ? 'timeout' : 'error')
}
const configuration = auth.credentialConfiguration
function createGoogleProvider ({ oauthFactory = auth.createOAuthClient, serviceFactory = auth.serviceWithOAuth, buildConnector = createLiveReadConnector, env = process.env } = {}) {
  return { configuration, async probe (source) {
    if (!Object.hasOwn(SCOPE, source)) throw failure('configuration')
    try {
      const oauth = oauthFactory()
      Object.assign(oauth.transporter.defaults, { timeout: 8000, retry: false })
      const token = await oauth.getAccessToken(); if (!token.token) throw failure('auth')
      const info = await oauth.getTokenInfo(token.token)
      if (!Array.isArray(info.scopes) || !info.scopes.includes(SCOPE[source])) throw failure('permission')
      const client = serviceFactory(source, source === 'gmail' ? 'v1' : 'v3', oauth)
      const options = { timeout: 8000, retry: false }; let account = null
      if (source === 'gmail') account = (await client.users.getProfile({ userId: 'me' }, options)).data.emailAddress || null
      if (source === 'drive') account = (await client.about.get({ fields: 'user(emailAddress)' }, options)).data.user?.emailAddress || null
      if (source === 'calendar') account = (await client.calendars.get({ calendarId: 'primary', fields: 'id' }, options)).data.id || null
      const probeEnv = { ...env }
      for (const flag of Object.values(SOURCE_FLAG)) probeEnv[flag] = 'off'
      probeEnv[SOURCE_FLAG[source]] = env[SOURCE_FLAG[source]]
      const connector = buildConnector({ env: probeEnv, caps: { maxResults: 1, timeoutMs: 8000 }, googleServiceFn: () => client }).connector
      const now = new Date().toISOString()
      const params = source === 'gmail' ? { maxResults: 1 } : source === 'drive' ? { pageSize: 1, orderBy: 'modifiedTime desc' }
        : { calendarId: 'primary', maxResults: 1, timeMin: now, timeMax: new Date(Date.parse(now) + 86400000).toISOString() }
      const result = await connector.read(source, source === 'gmail' ? 'searchMessages' : source === 'drive' ? 'listFiles' : 'listEvents', params)
      if (!result || result.trust === 'unavailable' || !Array.isArray(result.results) || result.results.some(r => !r || r.trust !== 'live')) throw failure('error')
      return { account, scopes: info.scopes, count: result.results.length }
    } catch (e) { throw classify(e) }
  } }
}
module.exports = { createGoogleProvider, configuration, SCOPE, classify, failure }
