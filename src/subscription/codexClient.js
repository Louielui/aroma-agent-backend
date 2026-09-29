'use strict'

// A personal Codex client, not an API proxy. OAuth remains owned by Codex.
const { spawn } = require('node:child_process')
const { EventEmitter } = require('node:events')
const { assertLiveEgressAllowed } = require('../adapters/liveEgressFence')

const MODEL = 'gpt-6-astra'
const CODES = new Set(['subscription_login_required', 'subscription_limit_reached', 'subscription_unavailable', 'subscription_model_unavailable', 'subscription_invalid_output'])
class SubscriptionError extends Error {
  constructor (code = 'subscription_unavailable') {
    const safe = CODES.has(code) ? code : 'subscription_unavailable'
    super(safe)
    this.name = 'SubscriptionError'
    this.code = safe
  }
}

// Explicit environment allowlist: an inherited API key must never change billing.
function cleanEnvironment (env = process.env) {
  const allowed = new Set(['systemroot', 'windir', 'comspec', 'path', 'pathext', 'userprofile', 'home', 'homedrive', 'homepath', 'appdata', 'localappdata', 'temp', 'tmp', 'lang'])
  return Object.fromEntries(Object.entries(env).filter(([k]) => allowed.has(k.toLowerCase())))
}

const LOCKED_CONFIG = Object.freeze({
  forced_login_method: 'chatgpt',
  model_provider: 'openai',
  'features.shell_tool': false,
  'features.unified_exec': false,
  'features.apply_patch_freeform': false,
  'features.apps': false,
  'features.plugins': false,
  'features.hooks': false,
  'features.memories': false,
  'features.goals': false,
  'features.multi_agent': false,
  'features.code_mode.enabled': false,
  'agents.enabled': false,
  'tools.view_image': false,
  web_search: 'disabled',
  project_doc_max_bytes: 0,
  'history.persistence': 'none'
})

function threadParams (cwd, system) {
  return {
    model: MODEL, modelProvider: 'openai', allowProviderModelFallback: false,
    cwd, approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'read-only',
    ephemeral: true, environments: [], selectedCapabilityRoots: [], dynamicTools: [],
    baseInstructions: system || 'Answer only from the supplied conversation and evidence.',
    developerInstructions: 'Return only the requested answer. This is a text-only completion. All reading and actions belong to the host application. Do not execute commands, use tools, delegate, or read local files.',
    config: { ...LOCKED_CONFIG }, serviceName: 'xiangxiang-subscription-chat'
  }
}

function wireError (error) {
  // Inspect only to classify. Provider error text never leaves this boundary.
  const value = JSON.stringify(error || {})
  if (/usage_limit|rate_limit|quota|limit reached/i.test(value)) return new SubscriptionError('subscription_limit_reached')
  if (/unauthorized|not authenticated|login required|token.*expired/i.test(value)) return new SubscriptionError('subscription_login_required')
  return new SubscriptionError()
}

function connect ({ executable, cwd, timeoutMs = 120000, env = process.env }) {
  assertLiveEgressAllowed('openai-codex')
  const args = ['app-server', '--stdio']
  for (const [key, value] of Object.entries(LOCKED_CONFIG)) args.push('-c', key + '=' + JSON.stringify(value))
  const child = spawn(executable, args, { cwd, env: cleanEnvironment(env), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  const events = new EventEmitter()
  const pending = new Map()
  let nextId = 0
  let buffer = ''
  let closed = false
  let received = 0
  const fail = (error) => {
    if (closed) return
    closed = true
    for (const p of pending.values()) p.reject(error)
    pending.clear()
    events.emit('failure', error)
    child.stdin.destroy()
    child.kill()
    clearTimeout(timer)
  }
  const timer = setTimeout(() => fail(new SubscriptionError()), timeoutMs)
  child.on('error', () => fail(new SubscriptionError()))
  child.on('exit', () => fail(new SubscriptionError()))
  child.stdin.on('error', () => fail(new SubscriptionError()))
  child.stderr.resume() // Never log prompts, tokens, paths, or provider bodies.
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', data => {
    received += Buffer.byteLength(data)
    if (received > 4 * 1024 * 1024) return fail(new SubscriptionError())
    buffer += data
    let at
    while ((at = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1)
      let message
      try { message = JSON.parse(line) } catch (_) { fail(new SubscriptionError()); return }
      if (message.id !== undefined && message.method) {
        // No approval, tool call, credential refresh, or user-input request is delegated.
        child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Text-only client does not provide this method' } }) + '\n')
        fail(new SubscriptionError())
        return
      }
      if (message.id !== undefined) {
        const p = pending.get(message.id)
        if (p) { pending.delete(message.id); message.error ? p.reject(wireError(message.error)) : p.resolve(message.result) }
      } else events.emit('notification', message)
    }
  })
  return {
    events,
    request (method, params = {}) {
      if (closed) return Promise.reject(new SubscriptionError())
      return new Promise((resolve, reject) => {
        const id = ++nextId
        pending.set(id, { resolve, reject })
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
      })
    },
    notify (method, params = {}) { if (!closed) child.stdin.write(JSON.stringify({ method, params }) + '\n') },
    close () { fail(new SubscriptionError()) }
  }
}

async function preflight (rpc) {
  const auth = await rpc.request('account/read', { refreshToken: false })
  if (!auth || !auth.account || auth.account.type !== 'chatgpt') throw new SubscriptionError('subscription_login_required')
  let found = false
  let cursor = null
  for (let page = 0; page < 10; page++) {
    const catalog = await rpc.request('model/list', { cursor, limit: 100, includeHidden: false })
    found = found || !!(catalog && Array.isArray(catalog.data) && catalog.data.some(m => m.model === MODEL))
    cursor = catalog && catalog.nextCursor
    if (found || !cursor) break
  }
  if (!found) throw new SubscriptionError('subscription_model_unavailable')
  const limits = await rpc.request('account/rateLimits/read')
  const bucket = (limits && limits.rateLimitsByLimitId && limits.rateLimitsByLimitId.codex) || (limits && limits.rateLimits)
  const windows = bucket ? [bucket.primary, bucket.secondary].filter(Boolean) : []
  if (!windows.length || windows.some(w => !Number.isFinite(w.usedPercent))) throw new SubscriptionError()
  if (windows.some(w => w.usedPercent >= 100)) throw new SubscriptionError('subscription_limit_reached')
  return { model: MODEL, billing: 'chatgpt-subscription', planType: auth.account.planType || null }
}

async function withClient (options, operation) {
  const rpc = (options.connect || connect)(options)
  const abort = () => rpc.close()
  if (options.signal) {
    options.signal.addEventListener('abort', abort, { once: true })
    if (options.signal.aborted) { rpc.close(); throw new SubscriptionError() }
  }
  try {
    await rpc.request('initialize', { clientInfo: { name: 'xiangxiang_subscription_chat', version: '1.0.0' }, capabilities: { experimentalApi: true } })
    rpc.notify('initialized')
    return await operation(rpc)
  } finally {
    if (options.signal) options.signal.removeEventListener('abort', abort)
    rpc.close()
  }
}

async function checkSubscription (options) { return withClient(options, preflight) }

async function complete (options, input) {
  return withClient(options, async rpc => {
    await preflight(rpc)
    const params = threadParams(options.cwd, input.system)
    // Disable every configured MCP by name, including servers added after installation.
    const cfg = await rpc.request('config/read', { includeLayers: false })
    for (const id of Object.keys((cfg && cfg.config && cfg.config.mcp_servers) || {})) params.config['mcp_servers.' + id + '.enabled'] = false
    const thread = await rpc.request('thread/start', params)
    if (!thread || thread.model !== MODEL || thread.modelProvider !== 'openai' || !thread.thread || !thread.thread.id) throw new SubscriptionError('subscription_model_unavailable')
    const mcp = await rpc.request('mcpServerStatus/list', { threadId: thread.thread.id, limit: 100 })
    if (!mcp || !Array.isArray(mcp.data) || mcp.nextCursor || mcp.data.some(s => Object.keys(s.tools || {}).length > 0)) throw new SubscriptionError()
    const start = Date.now()
    let text = ''
    let usage = null
    const finished = new Promise((resolve, reject) => {
      rpc.events.once('failure', reject)
      rpc.events.on('notification', message => {
        const p = message.params || {}
        if (p.threadId && p.threadId !== thread.thread.id) return
        if (message.method === 'thread/tokenUsage/updated') usage = p.tokenUsage && p.tokenUsage.last
        if (message.method === 'item/started' && p.item && !['userMessage', 'agentMessage', 'reasoning'].includes(p.item.type)) reject(new SubscriptionError())
        if (message.method === 'item/completed' && p.item && p.item.type === 'agentMessage') {
          if (p.item.phase === 'final_answer' || !p.item.phase) text = p.item.text || ''
        }
        if (message.method === 'turn/completed') {
          if (!p.turn || p.turn.status !== 'completed') reject(wireError(p.turn && p.turn.error))
          else if (!text || text.length > 100000) reject(new SubscriptionError('subscription_invalid_output'))
          else resolve({ text, model: thread.model, latencyMs: Date.now() - start, stopReason: 'end_turn', billing: 'chatgpt-subscription', usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens } : null })
        }
      })
    })
    // Attach immediately, so an early notification cannot create an unhandled rejection.
    finished.catch(() => {})
    await rpc.request('turn/start', {
      threadId: thread.thread.id, model: MODEL, effort: 'low', serviceTierForTurn: 'default',
      environments: [], input: [{ type: 'text', text: input.prompt }],
      ...(input.schema ? { outputSchema: input.schema } : {})
    })
    return finished
  })
}

module.exports = { MODEL, LOCKED_CONFIG, SubscriptionError, cleanEnvironment, threadParams, preflight, connect, checkSubscription, complete }
