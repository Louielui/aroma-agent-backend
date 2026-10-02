'use strict'
const { randomUUID } = require('node:crypto')
const { register } = require('../../capability/registry')
const { registerAgent, agentsProviding, rankByHealth } = require('../../capability/agents')
const { evaluate } = require('../../capability/policy')
const { createDispatcher } = require('../../capability/dispatcher')
const { ID } = require('../operating/runStore')
const { RECIPE, CAPABILITY, FILES, WORK_ORDER, SYSTEM, SCHEMA, digest, validateResult } = require('./contract')
const OWNER = Object.freeze({ id: 'owner', role: 'owner' })
const SAFE = new Set(['subscription_limit_reached', 'subscription_login_required', 'subscription_model_unavailable', 'subscription_unavailable', 'subscription_invalid_output', 'invalid_worker_result', 'context_unavailable', 'source_sensitive', 'read_access_disabled', 'evidence_changed', 'cancelled', 'timed_out', 'run_store_unavailable', 'permission_denied', 'no_worker_available', 'policy_denied'])
const safe = error => SAFE.has(error?.code || error?.message) ? (error.code || error.message) : 'subscription_unavailable'
function validateEvidence (packet) {
  const e = packet?.evidence
  if (packet?.state !== 'ok' || !Number.isFinite(Date.parse(packet.retrievedAt)) || Math.abs(Date.now() - Date.parse(packet.retrievedAt)) > 60000 || !e || e.project !== 'xiangxiang-backend' || e.profile !== WORK_ORDER.profile || e.committedOnly !== true || !/^[a-f0-9]{40}$/.test(e.revision || '') || !/^[a-f0-9]{40}$/.test(e.bootCommit || '') || !Array.isArray(e.files) || e.files.length !== FILES.length || packet.hash !== digest(JSON.stringify(e))) throw Error('context_unavailable')
  if (Object.keys(e).sort().join(',') !== 'bootCommit,committedOnly,files,profile,project,revision,scope') throw Error('context_unavailable')
  let bytes = 0
  e.files.forEach((file, i) => {
    if (!file || Object.keys(file).sort().join(',') !== 'content,evidenceId,lineCount,path,sha256' || file.path !== FILES[i] || file.evidenceId !== 'code-' + i || typeof file.content !== 'string' || !file.content || file.content.includes('\0') || file.sha256 !== digest(file.content) || file.lineCount !== file.content.split('\n').length || Buffer.byteLength(file.content) > 70000) throw Error('context_unavailable')
    bytes += Buffer.byteLength(file.content)
  })
  if (bytes > 170000) throw Error('context_unavailable')
  return e
}
function createCodeDiagnosis ({ source, provider, workers = [{ id: 'codex-code-diagnosis', name: 'Codex', model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', provider }], store, timeoutMs = 120000, clock = () => new Date().toISOString(), onFinish = () => ({ state: 'not_connected' }) }) {
  if (typeof source?.read !== 'function' || typeof source?.verify !== 'function' || !store || !Array.isArray(workers) || !workers.length || !Number.isFinite(timeoutMs) || timeoutMs < 1) throw Error('diagnosis_not_configured')
  register({ id: CAPABILITY, version: 1, lifecycle: 'active', risk_tier: 'low', input_schema: { type: 'object', required: ['evidence'], additionalProperties: false, properties: { evidence: { type: 'object' } } }, output_schema: SCHEMA })
  // Providers are host composition, not JSON manifests uploaded by a caller.
  // Future workers implement the same bounded contract and get their own actual
  // preflight. No worker gains tools or production write authority by registering.
  if (new Set(workers.map(w => w.id)).size !== workers.length) throw Error('diagnosis_not_configured')
  const configured = workers.map(w => {
    if (!/^[a-z][a-z0-9-]{1,70}$/.test(w.id || '') || typeof w.name !== 'string' || !w.name || w.name.length > 80 || !/^[a-z][a-z0-9.-]{1,100}$/.test(w.model || '') || !['chatgpt-subscription', 'claude-subscription'].includes(w.billing) || typeof w.provider?.preflight !== 'function' || typeof w.provider?.complete !== 'function') throw Error('diagnosis_not_configured')
    registerAgent({ id: w.id, role: 'Read-only code diagnosis', adapter: 'bounded-subscription-text', availability: 'local', status: 'active', provides: [{ capability: CAPABILITY, version: 1, seed_quality: 0, seed_cost: 'unknown' }] })
    return Object.freeze({ ...w })
  })
  const rows = new Map(), controls = new Map(); let activeId = null
  const owner = actor => { if (actor?.id !== OWNER.id || actor.role !== OWNER.role) throw Error('permission_denied'); source.verify(actor) }
  const save = run => { try { store.save(run); rows.set(run.id, structuredClone(run)) } catch (_) { throw Error('run_store_unavailable') } }
  const record = (run, stage, facts = {}) => { run.steps.push({ sequence: run.steps.length + 1, at: clock(), stage, ...facts }); run.updatedAt = clock(); save(run) }
  for (const run of store.all()) {
    if (['queued', 'running'].includes(run.state)) { run.state = 'interrupted'; run.reason = 'service_restarted'; run.result = null; run.finishedAt = clock(); record(run, 'interrupted') }
    rows.set(run.id, structuredClone(run))
  }
  const get = (actor, id) => { owner(actor); if (!ID.test(id || '')) throw Error('invalid_run_id'); return structuredClone(rows.get(id) || null) }
  const list = actor => { owner(actor); return [...rows.values()].sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '')).slice(0, 25).map(r => ({ id: r.id, state: r.state, reason: r.reason, startedAt: r.startedAt, finishedAt: r.finishedAt, worker: r.workOrder.worker || null })) }
  function catalogue (actor) {
    owner(actor)
    return { workOrder: WORK_ORDER, workers: configured.map(w => ({ id: w.id, name: w.name, capability: CAPABILITY, version: 1, model: w.model, billing: w.billing, state: 'configured', permissions: WORK_ORDER.permissions })), unconnected: ['Claude diagnosis/review', 'Browser/Computer execution', 'patch application'] }
  }
  async function execute (run, control) {
    const check = () => { if (control.abort.signal.aborted) throw Error(control.reason); owner(OWNER) }
    const awaitStep = async call => {
      check()
      let listener
      const stopped = new Promise((resolve, reject) => {
        listener = () => reject(Error(control.reason || 'cancelled'))
        control.abort.signal.addEventListener('abort', listener, { once: true })
      })
      try { const value = await Promise.race([Promise.resolve().then(() => { check(); return call() }), stopped]); check(); return value } finally { control.abort.signal.removeEventListener('abort', listener) }
    }
    try {
      check(); run.state = 'running'
      const request = { capabilityId: CAPABILITY, version: 1, target: 'dev', context: { data_domains: ['local_development_code'], description: WORK_ORDER.goal } }
      const policy = evaluate(request); record(run, 'policy_checked', { verdict: policy.verdict, rule_id: policy.rule_id })
      if (policy.verdict !== 'allow') throw Error('policy_denied')
      const candidates = agentsProviding(CAPABILITY, 1).filter(a => configured.some(w => w.id === a.id))
      const selected = rankByHealth(candidates, CAPABILITY, 1)[0]
      const worker = configured.find(w => w.id === selected?.id)
      if (!worker) throw Error('no_worker_available')
      run.workOrder = { ...WORK_ORDER, worker: worker.id, model: worker.model, billing: worker.billing }
      record(run, 'worker_selected', { worker: worker.id, basis: 'exact_contract_and_existing_health_ranking', cost: null })
      record(run, 'subscription_check'); const ready = await awaitStep(() => worker.provider.preflight({ signal: control.abort.signal }))
      if (ready?.model !== worker.model || ready?.billing !== worker.billing) throw Error('invalid_worker_result')
      record(run, 'context_read'); const before = await awaitStep(() => source.read(OWNER, { signal: control.abort.signal }))
      const evidence = validateEvidence(before); run.evidence = evidence; run.evidenceHash = before.hash; run.retrievedAt = before.retrievedAt; record(run, 'context_received')
      const dispatcher = createDispatcher({ allowedAgentIds: [worker.id], fallback: false, runContext: { appendStage: (stage, facts) => { check(); record(run, stage, facts) } }, adapters: { [worker.id]: {
        health: () => ({ availability: 'up', latencyMs: 0 }),
        invoke: async (capability, version, input) => {
          try {
            check(); if (capability !== CAPABILITY || version !== 1 || input.evidence !== evidence) throw Error('invalid_worker_result')
            const numbered = { ...evidence, files: evidence.files.map(({ content, ...meta }) => ({ ...meta, source: content.split('\n').map((line, i) => (i + 1) + ' | ' + line).join('\n') })) }
            const reply = await awaitStep(() => worker.provider.complete(JSON.stringify({ workOrder: run.workOrder, evidence: numbered }), { system: SYSTEM, signal: control.abort.signal, responseFormat: { type: 'json_schema', name: 'code_diagnosis', schema: SCHEMA } }))
            if (reply?.billing !== worker.billing || reply.model !== worker.model || typeof reply.text !== 'string' || reply.text.length > 40000) throw Error('invalid_worker_result')
            let result; try { result = JSON.parse(reply.text) } catch (_) { throw Error('invalid_worker_result') }
            if (!validateResult(result, evidence)) throw Error('invalid_worker_result')
            return { ok: true, output: result, latencyMs: reply.latencyMs, cost: null }
          } catch (error) { return { ok: false, error: safe(error), cost: null } }
        }
      } } })
      const dispatched = await awaitStep(() => dispatcher.dispatch({ ...request, input: { evidence } }))
      run.dispatch = { status: dispatched.status, worker: dispatched.agentId || null, latencyMs: dispatched.latencyMs ?? null, cost: null }
      if (dispatched.status !== 'ok' || dispatched.agentId !== worker.id) throw Error(dispatched.error || 'invalid_worker_result')
      record(run, 'source_verifying'); const after = await awaitStep(() => source.read(OWNER, { signal: control.abort.signal })); validateEvidence(after)
      run.verification = { at: clock(), matched: after.hash === run.evidenceHash, citationsVerified: true, factualClaimsVerified: false, testsExecuted: false, filesChanged: false, scope: 'exact_committed_blobs_revision_boot_and_line_quotes' }
      if (!run.verification.matched) { run.state = 'needs_attention'; run.reason = 'evidence_changed'; record(run, 'evidence_changed') }
      else { run.result = { ...dispatched.output, attribution: 'worker_diagnosis_proposal', factualClaimsVerified: false, model: worker.model, billing: worker.billing }; run.state = 'completed'; record(run, 'source_verified') }
    } catch (error) {
      run.result = null; run.reason = safe(error); run.state = run.reason === 'cancelled' ? 'cancelled' : run.reason === 'timed_out' ? 'timed_out' : 'failed'
    } finally {
      run.finishedAt = clock()
      try { record(run, run.state) } catch (_) { run.state = 'failed'; run.reason = 'run_store_unavailable'; run.result = null; rows.set(run.id, structuredClone(run)); return }
      let receiptTimer
      try {
        const receipt = await Promise.race([Promise.resolve().then(() => onFinish(structuredClone(run))), new Promise(resolve => { receiptTimer = setTimeout(() => resolve({ state: 'unavailable' }), 3000) })])
        run.memoryReceipt = ['queued', 'saved', 'not_connected'].includes(receipt?.state) ? receipt.state : 'unavailable'; save(run)
      } catch (error) { run.memoryReceipt = 'unavailable'; if (error.message === 'run_store_unavailable') { run.state = 'failed'; run.reason = 'run_store_unavailable'; run.result = null }; rows.set(run.id, structuredClone(run)) } finally { clearTimeout(receiptTimer) }
    }
  }
  function start (actor, input) {
    owner(actor)
    if (!input || Array.isArray(input) || Object.keys(input).some(k => !['recipe', 'requestId', 'conversationId'].includes(k)) || input.recipe !== RECIPE || !ID.test(input.requestId || '') || (input.conversationId !== undefined && (typeof input.conversationId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.conversationId)))) throw Error('invalid_request')
    const previous = [...rows.values()].find(r => r.requestId === input.requestId)
    if (previous) { if (previous.workOrder.recipe !== input.recipe || previous.conversationId !== (input.conversationId || null)) throw Error('request_conflict'); return { ...structuredClone(previous), reused: true } }
    if (activeId) throw Error('worker_busy')
    const run = { id: randomUUID(), workflow: 'code_diagnosis', requestId: input.requestId, conversationId: input.conversationId || null, actor: 'owner', startedAt: clock(), finishedAt: null, state: 'queued', reason: null, workOrder: WORK_ORDER, steps: [], sections: [], evidence: null, result: null, verification: null }
    record(run, 'owner_requested', { recipe: RECIPE }); activeId = run.id
    const control = { abort: new AbortController(), reason: null }; controls.set(run.id, control)
    const timer = setTimeout(() => { control.reason = 'timed_out'; control.abort.abort() }, timeoutMs)
    control.promise = execute(run, control).finally(() => { clearTimeout(timer); if (activeId === run.id) activeId = null; controls.delete(run.id) })
    return structuredClone(rows.get(run.id))
  }
  function cancel (actor, id) { const run = get(actor, id); if (!run) throw Error('run_not_found'); const control = controls.get(id); if (control) { control.reason = 'cancelled'; control.abort.abort() } return run }
  return { start, cancel, get, list, catalogue, wait: id => controls.get(id)?.promise || Promise.resolve(), workOrder: WORK_ORDER }
}
module.exports = { createCodeDiagnosis, validateEvidence }
