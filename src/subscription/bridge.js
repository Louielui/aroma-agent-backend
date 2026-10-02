'use strict'

const http = require('node:http')
const crypto = require('node:crypto')
const { complete, checkSubscription, listSubscriptionModels, SubscriptionError, createSession } = require('./codexClient')
const { isChatModel } = require('./chatModels')
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
  if (Object.keys(input).some(k => !['prompt', 'system', 'schema', 'effort', 'model'].includes(k))) throw new SubscriptionError('subscription_invalid_output')
  if (input.model !== undefined && !isChatModel(input.model)) throw new SubscriptionError('subscription_model_unavailable')
  if (input.effort !== undefined && !['low', 'medium', 'high'].includes(input.effort)) throw new SubscriptionError('subscription_invalid_output')
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 500000) throw new SubscriptionError('subscription_invalid_output')
  if (input.system !== undefined && (typeof input.system !== 'string' || input.system.length > 200000)) throw new SubscriptionError('subscription_invalid_output')
  if (input.schema !== undefined && (!input.schema || typeof input.schema !== 'object' || Array.isArray(input.schema))) throw new SubscriptionError('subscription_invalid_output')
  return input
}

function createBridge ({ token, clientOptions, memoryClientOptions = clientOptions, completeFn = complete, checkFn = checkSubscription, modelsFn = listSubscriptionModels, workerFlow = null, workerProviders = null, websiteEnabled = false, memoryEnabled = false, memoryStore = null, codeSourceFactory = null, codeRepair = null, findWebsiteFn = require('./websiteClient').findWebsite }) {
  if (!validToken(token)) throw new Error('bridge requires a 256-bit local token')
  let busy = false; let memoryBusy = false
  const session = createSession(clientOptions)
  const memorySession = createSession(memoryClientOptions)
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
    }
    if (!authenticated(req.headers.authorization, token) || req.headers.origin) { reply(401, { code: 'subscription_unavailable' }); req.resume(); return }
    if (req.method !== 'POST' || !['/complete', '/status', '/models', '/workers', '/website', '/v1/chat/completions', '/memory-store', '/code-diagnosis-source', '/code-repair'].includes(req.url)) { reply(404, { code: 'subscription_unavailable' }); req.resume(); return }
    const isMemory = req.url === '/v1/chat/completions'
    const isStore = req.url === '/memory-store'
    if (!isStore && ((isMemory ? memoryBusy : busy) || (!isMemory && req.url !== '/code-repair' && codeRepair?.isActive()))) { reply(503, { code: 'subscription_unavailable' }); req.resume(); return }
    if (req.headers['content-type'] !== 'application/json') { reply(415, { code: 'subscription_unavailable' }); req.resume(); return }
    if (isMemory) memoryBusy = true; else if (!isStore) busy = true
    const controller = new AbortController()
    res.on('close', () => { if (!res.writableFinished) controller.abort() })
    const options = { ...(isMemory ? memoryClientOptions : clientOptions), session: isMemory ? memorySession : session, signal: controller.signal }
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
      if (req.url === '/code-repair') {
        const shapes = { list: ['op'], get: ['op','id'], prepare: ['op','diagnosisId','requestId','bootCommit'], approve: ['op','id','hash','nonce'], cancel: ['op','id'] }
        if (!codeRepair || !input || Array.isArray(input) || !Object.hasOwn(shapes,input.op) || Object.keys(input).sort().join(',') !== shapes[input.op].sort().join(',')) { reply(400,{error:'invalid_request'}); return }
        const actor={id:'owner',role:'owner'}, {op,...body}=input
        try {
          if(op==='list')reply(200,{...codeRepair.catalogue(actor),runs:codeRepair.list(actor)})
          else if(op==='get')reply(200,{run:codeRepair.get(actor,body.id)})
          else reply(200,{run:codeRepair[op](actor,op==='cancel'?body.id:body)})
        }catch(e){reply(200,{error:['worker_busy','unsupported_diagnosis','invalid_request','approval_unavailable','evidence_changed','request_conflict'].includes(e.message)?e.message:'workflow_unavailable'})}
      } else if (req.url === '/code-diagnosis-source') {
        if (!input || Array.isArray(input) || Object.keys(input).join(',') !== 'bootCommit' || !/^[a-f0-9]{40}$/.test(input.bootCommit || '')) { reply(400, { code: 'context_unavailable' }); return }
        if (typeof codeSourceFactory !== 'function') { reply(503, { code: 'context_unavailable' }); return }
        try { reply(200, await codeSourceFactory(input.bootCommit).read({ id: 'owner', role: 'owner' }, { signal: controller.signal })) }
        catch (_) { reply(503, { code: 'context_unavailable' }) }
      } else if (isStore) {
        if (!memoryEnabled || !memoryStore) { reply(503, { error: 'memory_database_unavailable' }); return }
        try { reply(200, { result: await memoryStore.request(input) }) }
        catch (e) { reply(200, { error: ['revision_conflict', 'decision_conflict'].includes(e.message) ? e.message : 'memory_database_unavailable' }) }
      } else if (req.url === '/v1/chat/completions') {
        if (!memoryEnabled) { reply(503, { code: 'subscription_unavailable' }); return }
        reply(200, await require('./memoryCompletion').memoryCompletion(options, input, completeFn))
      } else if (req.url === '/website') {
        if (!websiteEnabled) { reply(503, { code: 'subscription_unavailable' }); return }
        reply(200, await findWebsiteFn(options, input))
      } else if (req.url === '/workers') {
        if (!workerFlow || !workerProviders) { reply(503, { code: 'subscription_unavailable' }); return }
        const allowed = { list: ['op'], status: ['op'], get: ['op', 'id'], start: ['op', 'recipe', 'approved'], review: ['op', 'id', 'approved'] }
        if (!input || !Object.hasOwn(allowed, input.op) || Object.keys(input).some(k => !allowed[input.op].includes(k))) { reply(400, { code: 'invalid_work_order' }); return }
        if (input.op === 'list') reply(200, { enabled: workerFlow.enabled(), workOrder: workerFlow.workOrder, runs: workerFlow.list() })
        if (input.op === 'get') reply(200, { run: workerFlow.get(input.id) })
        if (input.op === 'status') reply(200, { providers: await workerProviders.status(), enabled: workerFlow.enabled() })
        if (input.op === 'start' || input.op === 'review') {
          try { reply(200, { run: input.op === 'start' ? workerFlow.start({ recipe: input.recipe, approved: input.approved }) : workerFlow.reviewAgain({ id: input.id, approved: input.approved }) }) }
          catch (e) { reply(200, { error: ['not_enabled', 'invalid_work_order', 'approval_required', 'worker_busy'].includes(e.message) ? e.message : 'audit_unavailable' }) }
        }
      } else if (req.url === '/status') {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['model', 'effort'].includes(k)) || (input.model !== undefined && !isChatModel(input.model)) || (input.effort !== undefined && !['low', 'medium', 'high'].includes(input.effort))) { reply(400, { code: 'subscription_invalid_output' }); return }
        reply(200, await checkFn({ ...options, ...input }))
      } else if (req.url === '/models') {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) { reply(400, { code: 'subscription_invalid_output' }); return }
        reply(200, await modelsFn(options))
      } else reply(200, await completeFn(options, validateInput(input)))
    } catch (error) {
      const safe = error instanceof SubscriptionError ? error : new SubscriptionError()
      reply(safe.code === 'subscription_limit_reached' ? 429 : 503, { code: safe.code })
    } finally { if (isMemory) memoryBusy = false; else if (!isStore) busy = false }
  })
  server.requestTimeout = 150000
  server.on('close', () => { session.close(); memorySession.close() })
  server.headersTimeout = 10000
  return server
}

module.exports = { createBridge, validToken, validateInput, DEFAULT_PORT, MAX_BODY }
