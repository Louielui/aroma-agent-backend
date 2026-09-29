'use strict'

const http = require('node:http')
const { LLMAdapter } = require('./LLMAdapter')
const { assertResponseFormat } = require('./adapterErrors')
const { assertLiveEgressAllowed } = require('./liveEgressFence')
const { MODEL, SubscriptionError } = require('../subscription/codexClient')
const { validToken, DEFAULT_PORT } = require('../subscription/bridge')

function subscriptionChatEnabled (env = process.env, lane) {
  return lane === 'chat' && env.CHAT_BACKEND === 'codex-subscription'
}

// Fixed loopback destination, no redirects or proxies, and no provider API credential.
function localRequest (route, input, env) {
  assertLiveEgressAllowed('openai-codex')
  if (!validToken(env.CODEX_CHAT_BRIDGE_TOKEN)) return Promise.reject(new SubscriptionError())
  return new Promise((resolve, reject) => {
    const bytes = JSON.stringify(input)
    const req = http.request({ hostname: '127.0.0.1', port: DEFAULT_PORT, path: route, method: 'POST',
      headers: { authorization: 'Bearer ' + env.CODEX_CHAT_BRIDGE_TOKEN, 'content-type': 'application/json', 'content-length': Buffer.byteLength(bytes) } }, res => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { data += chunk; if (data.length > (route === '/workers' ? 2000000 : 200000)) req.destroy(new SubscriptionError()) })
      res.on('error', () => reject(new SubscriptionError()))
      res.on('end', () => {
        let result
        try { result = JSON.parse(data) } catch (_) { reject(new SubscriptionError()); return }
        if (res.statusCode !== 200) reject(new SubscriptionError(result && result.code))
        else resolve(result)
      })
    })
    req.setTimeout(125000, () => req.destroy(new SubscriptionError()))
    req.on('error', () => reject(new SubscriptionError()))
    req.end(bytes)
  })
}

class CodexSubscriptionAdapter extends LLMAdapter {
  get providerName () { return 'openai' }
  constructor ({ env = process.env, request = localRequest, effort = 'low' } = {}) {
    super()
    if (!['low', 'medium', 'high'].includes(effort)) throw new SubscriptionError('subscription_invalid_output')
    this.env = env; this.request = request; this._model = MODEL; this.effort = effort
  }
  async preflight () {
    const result = await this.request('/status', {}, this.env)
    if (!result || result.model !== MODEL || result.billing !== 'chatgpt-subscription') throw new SubscriptionError()
    return result
  }
  async complete (prompt, opts = {}) {
    const schema = opts.responseFormat ? assertResponseFormat(opts.responseFormat).schema : undefined
    const result = await this.request('/complete', { prompt, system: opts.system || '', effort: this.effort, ...(schema ? { schema } : {}) }, this.env)
    if (!result || result.model !== MODEL || result.billing !== 'chatgpt-subscription' || typeof result.text !== 'string' || !result.text || result.stopReason !== 'end_turn') throw new SubscriptionError('subscription_invalid_output')
    return result
  }
}
module.exports = { CodexSubscriptionAdapter, subscriptionChatEnabled, localRequest }
