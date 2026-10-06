'use strict'

const http = require('node:http')
const crypto = require('node:crypto')
const { complete, checkSubscription, listSubscriptionModels, SubscriptionError, createSession } = require('./codexClient')
const { REASONING_EFFORTS, isBrainModel: isChatModel, isClaudeModel, DEFAULT_BRAIN_MODEL } = require('./chatModels')
const { adoptionView } = require('../core/projectWork/adoptionView')
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
  if (Object.keys(input).some(k => !['prompt', 'system', 'schema', 'effort', 'model', 'images'].includes(k))) throw new SubscriptionError('subscription_invalid_output')
  if (input.images !== undefined) {
    try { require('../chat/imageAttachments').validateImages(input.images) } catch (_) { throw new SubscriptionError('subscription_invalid_output') }
  }
  if (input.model !== undefined && !isChatModel(input.model)) throw new SubscriptionError('subscription_model_unavailable')
  if (input.effort !== undefined && !REASONING_EFFORTS.includes(input.effort)) throw new SubscriptionError('subscription_invalid_output')
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 500000) throw new SubscriptionError('subscription_invalid_output')
  if (input.system !== undefined && (typeof input.system !== 'string' || input.system.length > 200000)) throw new SubscriptionError('subscription_invalid_output')
  if (input.schema !== undefined && (!input.schema || typeof input.schema !== 'object' || Array.isArray(input.schema))) throw new SubscriptionError('subscription_invalid_output')
  return input
}

function createBridge ({ token, clientOptions, memoryClientOptions = clientOptions, completeFn = complete, claudeFn = require('./claudeClient').complete, claudeCheckFn = require('./claudeClient').checkSubscription, claudeModelsFn = require('./claudeClient').listModels, backgroundModel = null, checkFn = checkSubscription, modelsFn = listSubscriptionModels, workerFlow = null, workerProviders = null, websiteEnabled = false, memoryEnabled = false, memoryStore = null, codeSourceFactory = null, taskPlanSource = null, codeRepair = null, projectWork = null, projectAdoption = null, projectTasks = null, findWebsiteFn = require('./websiteClient').findWebsite }) {
  if (!validToken(token)) throw new Error('bridge requires a 256-bit local token')
  let busy = false; let memoryBusy = false
  const session = createSession(clientOptions)
  const memorySession = createSession(memoryClientOptions)
  const catalogueSession = createSession({ ...clientOptions, timeoutMs: 20000 })
  let cataloguePending = null, catalogueController = null
  function readCatalogue () {
    if (!cataloguePending) {
      catalogueController = new AbortController()
      const options = { ...clientOptions, session: catalogueSession, signal: AbortSignal.any([catalogueController.signal, AbortSignal.timeout(25000)]) }
      cataloguePending = Promise.allSettled([Promise.resolve().then(() => modelsFn(options)), Promise.resolve().then(() => claudeModelsFn(options))]).then(([gpt, claude]) => {
        const gptModels = gpt.status === 'fulfilled' ? gpt.value.models : require('./chatModels').CHAT_MODELS.map(m => ({ ...m, available: false, efforts: [] }))
        return { billing: 'subscriptions', defaultModel: DEFAULT_BRAIN_MODEL, models: [...(claude.status === 'fulfilled' ? claude.value.models : [{ model: DEFAULT_BRAIN_MODEL, name: 'Claude Sonnet', available: false, efforts: [] }]), ...gptModels] }
      }).finally(() => { cataloguePending = null; catalogueController = null })
    }
    return cataloguePending
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
    }
    if (!authenticated(req.headers.authorization, token) || req.headers.origin) { reply(401, { code: 'subscription_unavailable' }); req.resume(); return }
    if (req.method !== 'POST' || !['/complete', '/status', '/models', '/workers', '/website', '/v1/chat/completions', '/memory-store', '/code-diagnosis-source', '/task-plan-source', '/code-repair', '/project-work', '/project-adoption', '/project-tasks'].includes(req.url)) { reply(404, { code: 'subscription_unavailable' }); req.resume(); return }
    const isMemory = req.url === '/v1/chat/completions'
    const isStore = req.url === '/memory-store'
    const isCatalogue = req.url === '/models'
    // Closed account metadata uses its own single-flight session. Reading it
    // neither acquires nor releases the execution lane or dispatches a turn.
    if (!isStore && !isCatalogue && ((isMemory ? memoryBusy : busy) || (!isMemory && req.url !== '/project-tasks' && projectTasks?.isActive()) || (!isMemory && req.url !== '/code-repair' && codeRepair?.isActive()) || (!isMemory && !['/project-work', '/project-adoption', '/project-tasks'].includes(req.url) && projectWork?.isActive()) || (!isMemory && req.url !== '/workers' && workerFlow?.isActive?.()) || (!isMemory && !['/project-adoption', '/project-work', '/project-tasks'].includes(req.url) && projectAdoption?.isActive()))) { reply(503, { code: 'subscription_unavailable' }); req.resume(); return }
    if (req.headers['content-type'] !== 'application/json') { reply(415, { code: 'subscription_unavailable' }); req.resume(); return }
    if (isMemory) memoryBusy = true; else if (!isStore && !isCatalogue) busy = true
    const controller = new AbortController()
    res.on('close', () => { if (!res.writableFinished) controller.abort() })
    const options = { ...(isMemory ? memoryClientOptions : clientOptions), session: isMemory ? memorySession : session, signal: controller.signal }
    try {
      const chunks = []
      let length = 0
      for await (const chunk of req) {
        length += chunk.length
        if (length > (req.url === '/complete' ? 9 * MAX_BODY : MAX_BODY)) { reply(413, { code: 'subscription_unavailable' }); req.destroy(); return }
        chunks.push(chunk)
      }
      let input
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (_) { reply(400, { code: 'subscription_invalid_output' }); return }
      if (req.url === '/project-tasks') {
        const shapes = { list: ['op'], get: ['op', 'id'], find: ['op', 'requestId'], start: ['op', 'bootCommit', 'requestId', 'goal', 'criteria', 'editable'], approve: ['op', 'id', 'hash', 'nonce'], prepare: ['op', 'id', 'requestId'], cancel: ['op', 'id'] }
        if (!projectTasks || !input || Array.isArray(input) || !Object.hasOwn(shapes, input.op) || Object.keys(input).sort().join(',') !== shapes[input.op].sort().join(',')) { reply(400, { error: 'invalid_request' }); return }
        const actor = { id: 'owner', role: 'owner' }, { op, ...body } = input
        try {
          if (!['list', 'get', 'find', 'cancel'].includes(op) && (projectWork?.isActive() || projectAdoption?.isActive())) throw Error('worker_busy')
          const value = op === 'list' ? projectTasks.list(actor) : op === 'get' ? projectTasks.get(actor, body.id) : op === 'cancel' ? projectTasks.cancel(actor, body.id) : await projectTasks[op](actor, body)
          reply(200, value)
        } catch (e) { reply(200, { error: ['invalid_request', 'worker_busy', 'approval_unavailable', 'source_changed', 'source_dirty', 'source_sensitive', 'source_unavailable', 'not_enabled', 'request_conflict'].includes(e.message) ? e.message : 'registration_unavailable' }) }
      } else if (req.url === '/project-adoption') {
        const shapes = { list: ['op'], prepare: ['op', 'action', 'runId', 'requestId', 'bootCommit'], approve: ['op', 'id', 'hash', 'nonce'], cancel: ['op', 'id'], reload: ['op', 'id'] }
        if (!projectAdoption || !input || Array.isArray(input) || !Object.hasOwn(shapes, input.op) || Object.keys(input).sort().join(',') !== shapes[input.op].sort().join(',')) { reply(400, { error: 'invalid_request' }); return }
        const actor = { id: 'owner', role: 'owner' }, { op, ...body } = input
        try {
          if (op !== 'list' && projectWork?.isActive()) throw Error('worker_busy')
          await projectAdoption.refresh()
          if (op === 'list') reply(200, { enabled: projectAdoption.enabled(), runs: projectAdoption.list(actor).map(adoptionView) })
          else if (op === 'prepare') {
            const value = await projectAdoption.prepare(actor, body)
            reply(200, { ...value, run: adoptionView(value.run) })
          } else if (op === 'reload') reply(200, { run: adoptionView(await projectAdoption.reload(actor, body.id)) })
          else reply(200, { run: adoptionView(projectAdoption[op](actor, op === 'cancel' ? body.id : body)) })
        } catch (e) { reply(200, { error: ['invalid_request', 'source_changed', 'source_dirty', 'accepted_evidence_changed', 'request_conflict', 'approval_unavailable', 'rollback_unavailable', 'worker_busy', 'reload_pending', 'not_enabled'].includes(e.message) ? e.message : 'adoption_unavailable' }) }
      } else if (req.url === '/project-work') {
        const shapes = { list: ['op'], get: ['op', 'id'], browser: ['op', 'id', 'name'], prepare: ['op', 'projectId', 'recipe', 'requestId', 'bootCommit'], approve: ['op', 'id', 'hash', 'nonce'], cancel: ['op', 'id'] }
        if (input?.op === 'browser' && Object.hasOwn(input, 'phase')) { if (!['before','after'].includes(input.phase)) { reply(400, { error: 'invalid_request' }); return }; shapes.browser.push('phase') }
        if (!projectWork || !input || Array.isArray(input) || !Object.hasOwn(shapes, input.op) || Object.keys(input).sort().join(',') !== shapes[input.op].sort().join(',')) { reply(400, { error: 'invalid_request' }); return }
        const actor = { id: 'owner', role: 'owner' }, { op, ...body } = input
        try {
          if (!['list', 'get', 'browser'].includes(op) && projectAdoption?.isActive()) throw Error('worker_busy')
          if (op === 'list') reply(200, { ...projectWork.catalogue(actor), runs: projectWork.list(actor) })
          else if (op === 'get') reply(200, { run: projectWork.get(actor, body.id) })
          else if (op === 'browser') reply(200, projectWork.browser(actor, body.id, body.name, body.phase))
          else if (op === 'prepare') reply(200, await projectWork.prepare(actor, body))
          else reply(200, { run: projectWork[op](actor, op === 'cancel' ? body.id : body) })
        } catch (e) { reply(200, { error: ['invalid_request', 'worker_busy', 'approval_unavailable', 'source_changed', 'source_dirty', 'source_sensitive', 'source_unavailable', 'not_enabled', 'request_conflict'].includes(e.message) ? e.message : 'workflow_unavailable' }) }
      } else if (req.url === '/code-repair') {
        const shapes = { list: ['op'], get: ['op','id'], prepare: ['op','diagnosisId','requestId','bootCommit'], approve: ['op','id','hash','nonce'], cancel: ['op','id'] }
        if (!codeRepair || !input || Array.isArray(input) || !Object.hasOwn(shapes,input.op) || Object.keys(input).sort().join(',') !== shapes[input.op].sort().join(',')) { reply(400,{error:'invalid_request'}); return }
        const actor={id:'owner',role:'owner'}, {op,...body}=input
        try {
          if(op==='list')reply(200,{...codeRepair.catalogue(actor),runs:codeRepair.list(actor)})
          else if(op==='get')reply(200,{run:codeRepair.get(actor,body.id)})
          else reply(200,{run:codeRepair[op](actor,op==='cancel'?body.id:body)})
        }catch(e){reply(200,{error:['worker_busy','unsupported_diagnosis','invalid_request','approval_unavailable','evidence_changed','request_conflict'].includes(e.message)?e.message:'workflow_unavailable'})}
      } else if (req.url === '/task-plan-source') {
        if (!taskPlanSource || !input || Object.keys(input).sort().join(',') !== 'bootCommit,profile') { reply(400, { code: 'context_unavailable' }); return }
        try { reply(200, await taskPlanSource.read(input, controller.signal)) } catch (_) { reply(503, { code: 'context_unavailable' }) }
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
        reply(200, await require('./memoryCompletion').memoryCompletion(options, input, backgroundModel === DEFAULT_BRAIN_MODEL ? (opts, body) => claudeFn(opts, { ...body, model: DEFAULT_BRAIN_MODEL }) : completeFn))
      } else if (req.url === '/website') {
        if (!websiteEnabled) { reply(503, { code: 'subscription_unavailable' }); return }
        reply(200, await findWebsiteFn(options, input))
      } else if (req.url === '/workers') {
        if (!workerFlow || !workerProviders) { reply(503, { code: 'subscription_unavailable' }); return }
        const allowed = { list: ['op'], status: ['op'], get: ['op', 'id'], start: ['op', 'recipe', 'approved'], review: ['op', 'id', 'approved'] }
        if (!input || !Object.hasOwn(allowed, input.op) || Object.keys(input).some(k => !allowed[input.op].includes(k))) { reply(400, { code: 'invalid_work_order' }); return }
        if (input.op === 'list') reply(200, { enabled: workerFlow.enabled(), workOrder: workerFlow.workOrder, runs: workerFlow.list(), isolation: workerProviders.isolation ? await workerProviders.isolation() : null })
        if (input.op === 'get') reply(200, { run: workerFlow.get(input.id) })
        if (input.op === 'status') reply(200, { providers: await workerProviders.status(), enabled: workerFlow.enabled() })
        if (input.op === 'start' || input.op === 'review') {
          try { reply(200, { run: input.op === 'start' ? workerFlow.start({ recipe: input.recipe, approved: input.approved }) : workerFlow.reviewAgain({ id: input.id, approved: input.approved }) }) }
          catch (e) { reply(200, { error: ['not_enabled', 'invalid_work_order', 'approval_required', 'worker_busy'].includes(e.message) ? e.message : 'audit_unavailable' }) }
        }
      } else if (req.url === '/status') {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['model', 'effort'].includes(k)) || (input.model !== undefined && !isChatModel(input.model)) || (input.effort !== undefined && !REASONING_EFFORTS.includes(input.effort))) { reply(400, { code: 'subscription_invalid_output' }); return }
        reply(200, await (isClaudeModel(input.model) ? claudeCheckFn : checkFn)({ ...options, ...input }))
      } else if (req.url === '/models') {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) { reply(400, { code: 'subscription_invalid_output' }); return }
        reply(200, await readCatalogue())
      } else reply(200, await (isClaudeModel(input?.model) ? claudeFn : completeFn)(options, validateInput(input)))
    } catch (error) {
      const safe = error instanceof SubscriptionError ? error : new SubscriptionError()
      reply(safe.code === 'subscription_limit_reached' ? 429 : 503, { code: safe.code })
    } finally { if (isMemory) memoryBusy = false; else if (!isStore && !isCatalogue) busy = false }
  })
  server.requestTimeout = 150000
  server.on('close', () => { catalogueController?.abort(); catalogueSession.close(); session.close(); memorySession.close() })
  server.headersTimeout = 10000
  return server
}

module.exports = { createBridge, validToken, validateInput, DEFAULT_PORT, MAX_BODY }
