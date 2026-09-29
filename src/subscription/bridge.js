'use strict'

const http = require('node:http')
const crypto = require('node:crypto')
const { complete, checkSubscription, SubscriptionError, createSession } = require('./codexClient')
const MAX_BODY = 1024 * 1024
const DEFAULT_PORT = 8091

function validToken (token) { return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) }
function authenticated (header, token) {
  const a = Buffer.from(typeof header === 'string' ? header : '')
  const b = Buffer.from('Bearer ' + token)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
function validateInput (input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SubscriptionError('subscription_invalid_output')
  if (Object.keys(input).some(k => !['prompt', 'system', 'schema', 'effort'].includes(k))) throw new SubscriptionError('subscription_invalid_output')
  if (input.effort !== undefined && !['low', 'medium', 'high'].includes(input.effort)) throw new SubscriptionError('subscription_invalid_output')
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 500000) throw new SubscriptionError('subscription_invalid_output')
  if (input.system !== undefined && (typeof input.system !== 'string' || input.system.length > 200000)) throw new SubscriptionError('subscription_invalid_output')
  if (input.schema !== undefined && (!input.schema || typeof input.schema !== 'object' || Array.isArray(input.schema))) throw new SubscriptionError('subscription_invalid_output')
  return input
}

function createBridge ({ token, clientOptions, completeFn = complete, checkFn = checkSubscription }) {
  if (!validToken(token)) throw new Error('bridge requires a 256-bit local token')
  let busy = false
  const session = createSession(clientOptions)
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
    }
    if (!authenticated(req.headers.authorization, token) || req.headers.origin) { reply(401, { code: 'subscription_unavailable' }); req.resume(); return }
    if (req.method !== 'POST' || !['/complete', '/status'].includes(req.url)) { reply(404, { code: 'subscription_unavailable' }); req.resume(); return }
    if (busy) { reply(503, { code: 'subscription_unavailable' }); req.resume(); return }
    if (req.headers['content-type'] !== 'application/json') { reply(415, { code: 'subscription_unavailable' }); req.resume(); return }
    busy = true
    const controller = new AbortController()
    res.on('close', () => { if (!res.writableFinished) controller.abort() })
    const options = { ...clientOptions, session, signal: controller.signal }
    try {
      const chunks = []
      let length = 0
      for await (const chunk of req) {
        length += chunk.length
        if (length > MAX_BODY) { reply(413, { code: 'subscription_unavailable' }); req.destroy(); return }
        chunks.push(chunk)
      }
      let input
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (_) { reply(400, { code: 'subscription_invalid_output' }); return }
      if (req.url === '/status') {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) { reply(400, { code: 'subscription_invalid_output' }); return }
        reply(200, await checkFn(options))
      } else reply(200, await completeFn(options, validateInput(input)))
    } catch (error) {
      const safe = error instanceof SubscriptionError ? error : new SubscriptionError()
      reply(safe.code === 'subscription_limit_reached' ? 429 : 503, { code: safe.code })
    } finally { busy = false }
  })
  server.requestTimeout = 150000
  server.on('close', () => session.close())
  server.headersTimeout = 10000
  return server
}

module.exports = { createBridge, validToken, validateInput, DEFAULT_PORT, MAX_BODY }
