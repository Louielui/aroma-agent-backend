'use strict'
// Host-only worker context. Never accepted from prompts, HTTP callers or a
// provider response. Authentication/catalogue checks are not model invocations.
const { AsyncLocalStorage } = require('node:async_hooks')
const { createHash, randomUUID } = require('node:crypto')
const { UUID } = require('./invocationContext')
const context = new AsyncLocalStorage()
const KINDS = ['project-tasks', 'project-runs', 'runs']
const PHASES = ['test_draft', 'development', 'review', 'visual_review']
const STATES = ['completed', 'awaiting_approval', 'needs_attention', 'failed', 'cancelled', 'timed_out', 'interrupted']
function validWorkerTrace(t) {
  return !!t && Object.keys(t).sort().join(',') === 'attempt,kind,recordId,runId,workId' &&
    KINDS.includes(t.kind) && UUID.test(t.recordId || '') && UUID.test(t.runId || '') &&
    /^work:[a-f0-9]{64}$/.test(t.workId || '') && Number.isSafeInteger(t.attempt) && t.attempt > 0 &&
    t.workId === 'work:' + createHash('sha256').update(JSON.stringify(['worker/' + t.kind, t.recordId])).digest('hex')
}
function projectRun(r, kind, id) {
  if (!validWorkerTrace(r?.trace) || r.trace.kind !== kind || r.trace.recordId !== id ||
      !Number.isFinite(Date.parse(r.startedAt))) return null
  return { trace: { ...r.trace }, startedAt: r.startedAt,
    finishedAt: Number.isFinite(Date.parse(r.finishedAt)) ? r.finishedAt : null,
    state: STATES.includes(r.state) ? r.state : 'unknown' }
}
async function withWorkerRun({ ledger, record, kind, save }, fn) {
  if (!ledger) return fn() // Existing test/embedded hosts without receipt storage.
  if (!KINDS.includes(kind) || !UUID.test(record.id || '')) throw Error('worker_evidence_unavailable')
  const previous = (Array.isArray(record.workerRuns) ? record.workerRuns : []).map(r => projectRun(r, kind, record.id)).filter(Boolean)
  const attempt = Math.max(0, ...previous.map(r => r.trace.attempt)) + 1
  const trace = { workId: 'work:' + createHash('sha256').update(JSON.stringify(['worker/' + kind, record.id])).digest('hex'), runId: randomUUID(), recordId: record.id, kind, attempt }
  const usage=require('../actions/usageBudget'),parent=usage.currentScope()
  if(parent)record.usageScope=usage.service().childScope(trace.runId)
  const run = { trace, startedAt: new Date().toISOString(), state: 'unknown', finishedAt: null }
  record.workerRuns = [...previous.slice(-19), run]
  save(record) // Fail closed before dispatch; no historical backfill.
  const state = { ledger, trace, phase: kind === 'project-tasks' ? 'test_draft' : 'development', candidateAttempt: 1, calls: [], gate: { closed: false } }
  const execute=()=>context.run(state, async () => {
    try { return await fn() }
    finally {
      state.gate.closed = true
      // Cancellation can finish the host race before the dispatched provider.
      // Keep the lane occupied until those providers settle, without retrying.
      await Promise.allSettled(state.calls)
      run.finishedAt = new Date().toISOString()
      run.state = STATES.includes(record.state) ? record.state : 'unknown'
      save(record)
      if (run.state !== 'unknown') state.ledger.workerOutcome(trace, { state: run.state, at: run.finishedAt })
    }
  })
  if(record.usageScope)return usage.service().withScope(record.usageScope,async()=>{try{return await execute()}finally{usage.service().finishChild(record.usageScope)}})
  return execute()
}
function withWorkerPhase(phase, candidateAttempt, fn) {
  const s = context.getStore()
  if (!s) return fn()
  if (candidateAttempt === null) candidateAttempt = s.candidateAttempt
  if (!PHASES.includes(phase) || !Number.isSafeInteger(candidateAttempt) || candidateAttempt < 1 || candidateAttempt > 2 || s.gate.closed) throw Error('worker_evidence_unavailable')
  return context.run({ ...s, phase, candidateAttempt }, fn)
}
function observeWorkerCall(input, fn, project = value => value) {
  const s = context.getStore()
  if (!s) return fn(() => {})
  if (s.gate.closed) return Promise.reject(Error('worker_evidence_unavailable'))
  const id = s.ledger.begin({ role: 'worker_completion', model: input.model, effort: input.effort,
    workerTrace: s.trace, workerPhase: s.phase, candidateAttempt: s.candidateAttempt, dispatchBasis: input.dispatchBasis })
  if (!id) return Promise.reject(Error('worker_evidence_unavailable'))
  const call = Promise.resolve().then(() => fn(() => s.ledger.dispatched(id))).then(value => {
    s.ledger.finish(id, project(value)); return value
  }).catch(error => { s.ledger.finish(id, null, error); throw error })
  s.calls.push(call)
  return call
}
function claudeReceipt(value) {
  if (value?.type !== 'result' || value.subtype !== 'success' || value.is_error === true) return {}
  const rows = Object.entries(value.modelUsage || {}).slice(0, 8).map(([model, v]) => ({ model,
    usage: { inputTokens: v?.inputTokens, outputTokens: v?.outputTokens, cacheReadInputTokens: v?.cacheReadInputTokens, cacheCreationInputTokens: v?.cacheCreationInputTokens } }))
  const primary = rows.filter(r => !/haiku/.test(r.model))
  return { model: primary.length === 1 ? primary[0].model : null, billing: 'claude-subscription',
    usage: primary.length === 1 ? primary[0].usage : null, usageByModel: rows, usageBasis: 'provider_result_model_usage',
    providerTiming: { basis: 'claude_cli_result', cliDurationMs: value.duration_ms, apiDurationMs: value.duration_api_ms } }
}
module.exports = { validWorkerTrace, projectRun, withWorkerRun, withWorkerPhase, observeWorkerCall, claudeReceipt, STATES, PHASES }
