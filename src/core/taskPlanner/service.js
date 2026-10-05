'use strict'
const { randomUUID } = require('node:crypto'), { ID } = require('../operating/runStore')
const { classify, SYSTEM, SCHEMA, validatePacket, validateResult, hash } = require('./contract')
const { PROJECT, FAILURE_RECIPE } = require('../projectWork/contract')
const { register } = require('../../capability/registry'), { registerAgent } = require('../../capability/agents')
const { evaluate } = require('../../capability/policy'), { createDispatcher } = require('../../capability/dispatcher')
const { DEFAULT_EFFORT, REASONING_EFFORTS } = require('../../subscription/chatModels')
const { numberedEvidence } = require('./numberedEvidence')
const OWNER = Object.freeze({ id: 'owner', role: 'owner' })
const SAFE = new Set(['worker_busy', 'invalid_request', 'permission_denied', 'read_access_disabled', 'evidence_changed', 'context_unavailable', 'source_dirty', 'source_sensitive', 'subscription_limit_reached', 'subscription_login_required', 'subscription_unavailable', 'subscription_model_unavailable', 'invalid_worker_result', 'cancelled', 'timed_out', 'run_store_unavailable', 'request_conflict', 'not_enabled'])
const safe = e => SAFE.has(e.code || e.message) ? (e.code || e.message) : 'planning_unavailable'
// Execution selection is host-owned current-request matching. An LLM plan, source
// instruction or a browser recipe field can never grant mutable paths or tests.
function eligibleRecipe (message) {
  return classify(message)?.profile === 'context' && /(?:unavailable|失敗|無法取得|離線)/i.test(message) && /(?:scope|範圍)/i.test(message) && /(?:snapshot|快照|改寫|修改|mutat)/i.test(message) ? FAILURE_RECIPE : null
}
function createPlanner ({ source, provider, providerFor, store, bootCommit, prepareWork, registerTask, findTask, executionRpc, executionPollMs, timeoutMs = 120000, onFinish = () => ({ state: 'not_connected' }) }) {
  const capability = 'TaskPlanning', worker = 'codex-task-planner'
  register({ id: capability, version: 2, lifecycle: 'active', risk_tier: 'low', input_schema: { type: 'object', required: ['evidence'], properties: { evidence: { type: 'object' } } }, output_schema: SCHEMA })
  registerAgent({ id: worker, role: 'Read-only task planner', adapter: 'bounded-subscription-text', availability: 'local', status: 'active', provides: [{ capability, version: 2, seed_quality: 0, seed_cost: 'unknown' }] })
  const controls = new Map(); let active = null
  const owner = actor => { if (actor?.id !== 'owner' || actor.role !== 'owner') throw Error('permission_denied'); source.verify(actor) }
  const save = r => store.save(r)
  const record = (r, stage) => { r.steps.push({ stage, sequence: r.steps.length + 1, at: new Date().toISOString() }); save(r) }
  for (const r of store.all()) if (['queued', 'running'].includes(r.state)) { r.state = 'interrupted'; r.reason = 'process_restarted'; r.result = null; r.finishedAt = new Date().toISOString(); record(r, 'interrupted') }
  const get = (actor, id) => { owner(actor); if (!ID.test(id || '')) throw Error('invalid_request'); const r = store.get(id); return r ? { ...r, executionAvailable: execution.enabled(), executionStale: !!r.evidence && r.evidence.bootCommit !== bootCommit } : r }
  async function execute (r, c) {
    const check = () => { if (c.abort.signal.aborted) throw Error(c.reason || 'cancelled'); owner(OWNER) }
    const step = async fn => {
      check(); let listener
      const pending = Promise.resolve().then(() => { check(); return fn() }); c.inflight.add(pending)
      pending.then(() => c.inflight.delete(pending), () => c.inflight.delete(pending))
      const stopped = new Promise((resolve, reject) => { listener = () => reject(Error(c.reason || 'cancelled')); c.abort.signal.addEventListener('abort', listener, { once: true }) })
      try { const v = await Promise.race([pending, stopped]); check(); return v } finally { c.abort.signal.removeEventListener('abort', listener) }
    }
    try {
      const dispatchRequest = { capabilityId: capability, version: 2, target: 'dev', context: { data_domains: ['local_development_code'], description: 'Plan within fixed committed profiles' } }
      if (evaluate(dispatchRequest).verdict !== 'allow') throw Error('permission_denied')
      check(); record(r, 'policy_checked')
      r.state = 'running'; record(r, 'source_read')
      const packet = await step(() => source.read(OWNER, r.profile, c.abort.signal)), evidence = validatePacket(packet, r.profile)
      if (evidence.bootCommit !== bootCommit) throw Error('evidence_changed')
      r.evidence = evidence; r.evidenceHash = packet.hash; r.retrievedAt = packet.retrievedAt; record(r, 'source_received')
      const uiDesign = require('../../design/uiDesign').guidance(r.profile)
      if (uiDesign) { r.design = uiDesign.receipt; record(r, 'design_guidance_loaded') }
      const runProvider = providerFor ? providerFor({ model: r.model, effort: r.effort }) : provider
      const ready = await step(() => runProvider.preflight({ signal: c.abort.signal }))
      if (ready?.model !== 'gpt-6.1-sol' || ready.billing !== 'chatgpt-subscription') throw Error('invalid_worker_result')
      record(r, 'planning')
      const numbered = numberedEvidence(evidence)
      const dispatcher = createDispatcher({ allowedAgentIds: [worker], fallback: false, adapters: { [worker]: {
        health: () => ({ availability: 'up', latencyMs: 0 }),
        invoke: async (id, version, input) => {
          try {
            check(); if (id !== capability || version !== 2 || input.evidence !== evidence) throw Error('invalid_worker_result')
            const response = await step(() => runProvider.complete(JSON.stringify({ request: r.message, ...(r.dialogue ? { dialogue: r.dialogue } : {}), capabilities: require('./capabilities').capabilities(r.profile), evidence: numbered }), { system: require('../../design/uiDesign').systemFor(SYSTEM + ' ' + require('./capabilities').INSTRUCTION, r.profile), signal: c.abort.signal, responseFormat: { type: 'json_schema', name: 'task_plan', schema: SCHEMA } }))
            if (response?.model !== 'gpt-6.1-sol' || response.billing !== 'chatgpt-subscription' || typeof response.text !== 'string' || response.text.length > 40000) throw Error('invalid_worker_result')
            let result; try { result = JSON.parse(response.text) } catch (_) { throw Error('invalid_worker_result') }
            if (!validateResult(result, evidence, { requireCapability: true })) throw Error('invalid_worker_result')
            return { ok: true, output: result, cost: null, latencyMs: response.latencyMs ?? null }
          } catch (e) { return { ok: false, error: safe(e), cost: null } }
        }
      } } })
      const dispatched = await step(() => dispatcher.dispatch({ ...dispatchRequest, input: { evidence } }))
      if (dispatched.status !== 'ok' || dispatched.agentId !== worker) throw Error(dispatched.error || 'invalid_worker_result')
      const result = dispatched.output
      r.dispatch = { capability, version: 2, worker, cost: null }
      const after = await step(() => source.read(OWNER, r.profile, c.abort.signal)); validatePacket(after, r.profile)
      if (after.hash !== packet.hash) throw Error('evidence_changed')
      r.result = result; r.verification = { matched: true, citationsVerified: true, testsExecuted: false, filesChanged: false, factualClaimsVerified: false }
      r.executableRecipe = result.capability.status === 'supported' && result.questions.length === 0 ? eligibleRecipe(r.message) : null
      r.planHash = hash(JSON.stringify({ result, evidenceHash: packet.hash, message: r.message, executableRecipe: r.executableRecipe, ...(r.dialogue ? { dialogue: r.dialogue } : {}) }))
      r.state = result.capability.status === 'unsupported' ? 'out_of_scope' : result.questions.length ? 'needs_clarification' : 'completed'; record(r, 'source_verified')
    } catch (e) { r.result = null; r.executableRecipe = null; r.reason = safe(e); r.state = r.reason === 'cancelled' ? 'cancelled' : r.reason === 'timed_out' ? 'timed_out' : 'failed' }
    finally {
      r.finishedAt = new Date().toISOString()
      try { record(r, r.state) } catch (_) { r.state = 'failed'; r.result = null; r.executableRecipe = null; r.reason = 'run_store_unavailable'; return }
      let timer
      try { const receipt = await Promise.race([Promise.resolve().then(() => onFinish(structuredClone(r))), new Promise(resolve => { timer = setTimeout(() => resolve({ state: 'unavailable' }), 3000) })]); r.memoryReceipt = ['queued', 'saved', 'not_connected'].includes(receipt?.state) ? receipt.state : 'unavailable'; save(r) } catch (_) { /* The durable plan remains readable; no replay. */ } finally { clearTimeout(timer) }
    }
  }
  function start (actor, input) {
    owner(actor)
    if (!input || !['conversationId,message,requestId','conversationId,effort,message,requestId','conversationId,dialogue,effort,message,requestId'].includes(Object.keys(input).sort().join(',')) || !ID.test(input.requestId || '') || !/^[a-z0-9][a-z0-9-]{7,63}$/.test(input.conversationId || '') || !classify(input.message)?.profile) throw Error('invalid_request')
    if (input.dialogue && !require('./dialogueContext').validDialogue(input.dialogue, bootCommit, input.conversationId, classify(input.message).profile)) throw Error('invalid_request')
    const effort = Object.hasOwn(input, 'effort') ? input.effort : DEFAULT_EFFORT
    if (!REASONING_EFFORTS.includes(effort)) throw Error('invalid_request')
    const prior = store.all().find(r => r.requestId === input.requestId)
    if (prior) { if (prior.message !== input.message || prior.conversationId !== input.conversationId || prior.effort !== effort || JSON.stringify(prior.dialogue) !== JSON.stringify(input.dialogue)) throw Error('request_conflict'); return { ...prior, reused: true } }
    if (active) throw Error('worker_busy')
    const r = { id: randomUUID(), workflow: 'task_plan', ...input, profile: classify(input.message).profile, state: 'queued', reason: null, startedAt: new Date().toISOString(), steps: [], sections: [], result: null, executableRecipe: null, workRunId: null, permissions: 'read_only_committed_profile', model: 'gpt-6.1-sol', effort, billing: 'chatgpt-subscription' }
    record(r, 'owner_requested'); active = r.id
    const c = { abort: new AbortController(), inflight: new Set(), reason: null }; controls.set(r.id, c)
    const timer = setTimeout(() => { c.reason = 'timed_out'; c.abort.abort() }, timeoutMs)
    c.promise = execute(r, c).finally(() => { clearTimeout(timer); const release = () => { if (active === r.id) active = null; controls.delete(r.id) }; if (c.inflight.size) Promise.allSettled([...c.inflight]).then(release); else release() })
    return store.get(r.id)
  }
  async function prepare (actor, input) {
    owner(actor)
    if (!input || Object.keys(input).sort().join(',') !== 'id,requestId' || !ID.test(input.id || '') || !ID.test(input.requestId || '')) throw Error('invalid_request')
    const r = get(actor, input.id)
    if (!r || r.state !== 'completed' || !r.executableRecipe || r.executableRecipe !== eligibleRecipe(r.message) || !r.verification?.matched || !validateResult(r.result, r.evidence) || r.planHash !== hash(JSON.stringify({ result: r.result, evidenceHash: r.evidenceHash, message: r.message, executableRecipe: r.executableRecipe, ...(r.dialogue ? { dialogue: r.dialogue } : {}) }))) throw Error('invalid_request')
    if (r.registrationPreparation) throw Error('request_conflict')
    if (r.preparation) { if (r.preparation.requestId !== input.requestId || !r.workRunId) throw Error('request_conflict'); return { run: r, work: { run: { id: r.workRunId }, approval: null } } }
    if (active) throw Error('worker_busy')
    active = r.id
    try {
      const fresh = await source.read(actor, r.profile); validatePacket(fresh, r.profile)
      if (fresh.hash !== r.evidenceHash || fresh.evidence.bootCommit !== bootCommit) throw Error('evidence_changed')
      // Persist intent BEFORE issuing authority; uncertain outcomes require inspection.
      r.preparation = { requestId: input.requestId, state: 'pending' }; record(r, 'work_prepare_requested')
      const work = await prepareWork({ op: 'prepare', projectId: PROJECT, recipe: r.executableRecipe, requestId: input.requestId, bootCommit })
      if (work?.error || work?.run?.workflow !== 'project_work' || work.run.requestId !== input.requestId || work.run.workOrder?.recipe !== r.executableRecipe || work.run.source?.evidence?.revision !== bootCommit) throw Error(work?.error || 'invalid_worker_result')
      r.workRunId = work.run.id; r.preparation.state = 'prepared'; record(r, 'work_prepared')
      return { run: r, work }
    } finally { if (active === r.id) active = null }
  }
  function attachTask (r, v) {
    if (v?.error || !ID.test(v?.run?.id || '') || v.run.workflow !== 'project_task' || JSON.stringify(v.run.input) !== JSON.stringify(r.registrationPreparation.input)) throw Error('invalid_worker_result')
    r.taskRunId = v.run.id; r.registrationPreparation.state = 'prepared'; record(r, 'task_draft_linked'); return { run: r, task: v }
  }
  async function registerFromPlan (actor, input) {
    owner(actor)
    const { keys, request, profileFor } = require('../projectTasks/contract')
    if (!keys(input, ['id', 'requestId', 'goal', 'criteria', 'editable']) || !ID.test(input.id || '')) throw Error('invalid_request')
    const taskInput = request({ bootCommit, requestId: input.requestId, goal: input.goal, criteria: input.criteria, editable: input.editable }), r = get(actor, input.id)
    if (!r || r.profile !== profileFor(taskInput) || r.state !== 'completed' || r.result?.capability?.status === 'unsupported' || !r.verification?.matched || !validateResult(r.result, r.evidence) || r.evidenceHash !== hash(JSON.stringify(r.evidence)) || r.planHash !== hash(JSON.stringify({ result: r.result, evidenceHash: r.evidenceHash, message: r.message, executableRecipe: r.executableRecipe, ...(r.dialogue ? { dialogue: r.dialogue } : {}) }))) throw Error('invalid_request')
    if (r.preparation) throw Error('request_conflict')
    if (r.registrationPreparation) { if (JSON.stringify(r.registrationPreparation.input) !== JSON.stringify(taskInput) || !r.taskRunId) throw Error('request_conflict'); return { run: r, task: { run: { id: r.taskRunId }, approval: null } } }
    if (active) throw Error('worker_busy')
    if (typeof registerTask !== 'function') throw Error('not_enabled')
    active = r.id
    try {
      const fresh = await source.read(actor, r.profile); validatePacket(fresh, r.profile)
      if (fresh.hash !== r.evidenceHash || fresh.evidence.bootCommit !== bootCommit) throw Error('evidence_changed')
      // Persist the explicit Owner request before dispatching a draft. A lost
      // response permits readback only, never another automatic start or nonce.
      r.registrationPreparation = { state: 'pending', input: taskInput }; record(r, 'task_draft_requested')
      return attachTask(r, await registerTask({ op: 'start', ...structuredClone(taskInput) }))
    } finally { if (active === r.id) active = null }
  }
  async function refreshRegistration (actor, id) {
    const r = get(actor, id)
    if (!r || r.taskRunId || r.registrationPreparation?.state !== 'pending' || active || typeof findTask !== 'function') return r
    active = r.id
    try { const actual = await findTask(r.registrationPreparation.input.requestId); return actual ? attachTask(r, actual).run : r } finally { if (active === r.id) active = null }
  }
  const execution = require('./confirmedExecution').createConfirmedExecution({ store, source, bootCommit, registerTask: registerFromPlan, rpc: executionRpc, pollMs: executionPollMs })
  function replan (actor, input) {
    owner(actor)
    if (!require('../projectTasks/contract').keys(input, ['id', 'requestId']) || !ID.test(input.requestId || '')) throw Error('invalid_request')
    const old = get(actor, input.id)
    if (!old || !['completed', 'failed', 'interrupted', 'needs_clarification', 'out_of_scope'].includes(old.state) || old.execution && ['queued', 'reading', 'drafting', 'checking', 'coding', 'reviewing'].includes(old.execution.state)) throw Error('invalid_request')
    if (old.updatedPlanRunId) return { run: get(actor, old.updatedPlanRunId) }
    let dialogue
    if (old.dialogue) {
      const context = require('./dialogueContext').seal({ ...old.dialogue.context, revision: bootCommit, createdAt: new Date().toISOString() })
      dialogue = { ...old.dialogue, context, contextDigest: context.digest, confirmation: 'Owner requested a refreshed plan through its confirmation card' }
    }
    const next = start(actor, { message: old.message, requestId: input.requestId, conversationId: old.conversationId, effort: old.effort, ...(dialogue ? { dialogue } : {}) })
    old.updatedPlanRunId = next.id; record(old, 'owner_requested_updated_plan'); return { run: get(actor, next.id) }
  }
  return { start, prepare, replan, registerTask: registerFromPlan, refreshRegistration, get, executeConfirmed: execution.start, cancelExecution: execution.cancel, waitExecution: execution.wait, list: actor => { owner(actor); return store.all().sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 25).map(({ evidence, ...r }) => r) }, wait: id => controls.get(id)?.promise || Promise.resolve(), cancel: (actor, id) => { const r = get(actor, id), c = controls.get(id); if (!r) throw Error('invalid_request'); if (c) { c.reason = 'cancelled'; c.abort.abort() }; return r } }
}
module.exports = { createPlanner, eligibleRecipe }
