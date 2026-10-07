'use strict'
// Deterministic evidence grading complements the model answer. Records remain
// untrusted observations; neither a model nor a source can grant write authority.
function evaluateInvestigation ({ goal = '', focus = null, sections = [] } = {}) {
  // The judged decomposer focus changes reporting, never access or capabilities.
  // Old saved credit receipts retain their presentation without a model replay.
  focus = ['cost', 'work_failure', 'background', 'general'].includes(focus) ? focus : /credit|billing|扣款|額度|用量/i.test(goal) ? 'cost' : 'general'
  const findings = [], gaps = [], contradictions = [], transitions = []
  const add = (s, r, kind, evidenceState, temporalScope, value = null) => findings.push({ kind, evidenceState, temporalScope, sourceId: s.sourceId, recordId: r?.sourceId || null, at: r?.at || r?.lastStartedAt || null, retrievedAt: s.retrievedAt, value })
  const schedules = sections.find(s => s.section === 'schedules')
  const currentByIdentity = new Map()
  for (const s of sections) {
    if ((focus === 'cost' || !['billing', 'usage'].includes(s.section)) && (s.state !== 'ok' || !s.records?.length)) gaps.push({ section: s.section, state: s.state, sourceId: s.sourceId, coverage: s.coverage || null, omitted: s.omitted ?? null })
    if (s.section === 'billing') { if (focus === 'cost') add(s, null, 'charge_unverified', 'not_established', 'unknown'); continue }
    for (const r of s.records || []) {
      if (s.section === 'schedules') add(s, r, 'schedule_current', 'confirmed', 'current', { name: r.name || r.sourceId, state: r.state, model: r.model ?? null, currentRunningState: r.currentRunningState || 'unknown' })
      else if (s.section === 'configuration') {
        if (r.evidenceBasis === 'live_process_snapshot' && r.role) add(s,r,'background_activity_observed',r.currentRunningState === 'unknown' ? 'not_established' : 'confirmed','current',{role:r.role,state:r.currentRunningState,enabled:r.enabled,model:r.model,modelBasis:r.modelBasis,provider:r.provider,effort:r.effort,at:r.at,reason:r.reason,nextAt:r.nextAt})
        else add(s, r, 'configuration_current', 'confirmed', 'current', { model: r.model, effort: r.effort })
      }
      else if (s.section === 'execution') {
        if(r.evidenceBasis==='owner_bridge_invocation_ledger') {
          add(s,r,'invocation_attempt_observed','confirmed','historical',{role:r.role,state:r.state,requestId:r.requestId,phase:r.phase,model:r.model,actualModel:r.actualModel,durationMs:r.durationMs,preflightMs:r.preflightMs,providerWaitMs:r.providerWaitMs})
          if(r.state==='succeeded'&&r.modelResultObserved===true)add(s,r,'model_result_observed','confirmed','historical',{role:r.role,actualModel:r.actualModel,finishedAt:r.finishedAt})
        }
        if (r.lastStartedAt || r.lastCompletedAt) add(s, r, 'execution_observed', 'confirmed', 'historical', { model: r.model, startedAt: r.lastStartedAt, completedAt: r.lastCompletedAt })
        if (r.usage) add(s, r, 'usage_recorded', 'confirmed', 'historical', { usage: r.usage, usageAt: r.usageAt, basis: r.usageBasis })
        const matched = schedules?.records?.find(task => task.sourceId === 'codex-automation:' + r.declaredAutomationId)
        if (matched) add(s, r, 'candidate_link', 'possible', 'historical', { name: matched.name, scheduleSourceId: schedules.sourceId, basis: 'user_declared_heartbeat_id_only' })
      } else if (s.section === 'history') add(s, r, 'historical_statement', 'supported', 'historical', { title: r.title })
      else if (s.section === 'usage') add(s, r, 'estimated_usage', 'supported', 'historical', { model: r.model, estimated_tokens: r.estimated_tokens })
      else if (s.section === 'work') {
        add(s, r, 'work_recorded', 'confirmed', 'historical', { state: r.state, model: r.model, reviewModel: r.reviewModel, goal: r.goal, sourceRevision: r.sourceRevision, workRunId: r.workRunId, taskRunId: r.taskRunId, appliedToLive: r.appliedToLive })
        if (r.reason || ['failed', 'timed_out', 'needs_attention'].includes(r.state)) add(s, r, 'work_failure_observed', 'confirmed', 'historical', { reason: r.reason ?? null, state: r.state, steps: r.steps, failureDiagnostic: r.failureDiagnostic })
        if (r.tests) add(s, r, 'candidate_tests_recorded', 'confirmed', 'historical', { tests: r.tests, sourceRevision: r.sourceRevision, appliedToLive: r.appliedToLive })
        if (r.sourceFiles?.length) add(s, r, 'source_snapshot_compared', 'confirmed', 'current_disk', { files: r.sourceFiles, sourceRevision: r.sourceRevision, provesFix: false })
      }
    }
    // Same source category, identity and observed facet only. Historical work
    // state and a current schedule definition are not opposing observations.
    const byId = currentByIdentity
    for (const r of s.records || []) {
      if (!r.sourceId) continue
      const identity = s.section + ':' + r.sourceId
      const prior = byId.get(identity)
      for (const field of ['state','currentRunningState','model']) {
        if (!prior || typeof prior[field]!=='string' || typeof r[field]!=='string' || [prior[field],r[field]].some(v=>['unknown','UNREADABLE'].includes(v)) || prior[field]===r[field]) continue
        const target = prior.at && r.at && prior.at !== r.at ? transitions : contradictions
        target.push({ sourceId: s.sourceId, recordId: r.sourceId, field, observations: [{ state: prior[field], at: prior.at || null }, { state: r[field], at: r.at || null }] })
      }
      byId.set(identity, r)
    }
  }
  const required = focus === 'cost' ? ['execution', 'billing'] : focus === 'work_failure' ? ['work', 'configuration'] : focus === 'background' ? ['configuration', 'schedules'] : []
  for (const name of required) if (!sections.some(s => s.section === name)) gaps.push({ section: name, state: 'unconnected', sourceId: null })
  if (focus === 'work_failure') {
    const work = sections.find(s => s.section === 'work') || { sourceId: null }
    add(work, null, 'fix_unverified', 'not_established', 'current', { sameFailureRegressionInLoadedVersion: null })
    gaps.push({ section: 'same_failure_current_version_verification', state: 'unconnected', sourceId: work.sourceId })
  }
  if (focus === 'background') {
    const config = sections.find(s => s.section === 'configuration') || { sourceId: null }
    const work = sections.find(s => s.section === 'work')
    for (const w of work?.workflows || []) add(work, {sourceId:w.role}, 'workflow_occupancy_observed', 'confirmed', 'current', {role:w.role, state:w.state, model:w.model, modelBasis:w.modelBasis, at:w.at})
    add(config, null, 'activity_unverified', 'not_established', 'current', { liveWorkerInventory: null })
    gaps.push({ section: 'live_worker_activity', state: work?.workflows?.length ? 'partial' : 'unconnected', sourceId: work?.sourceId || config.sourceId })
  }
  const recommendations = (focus === 'cost' ? ['obtain_billing_evidence', 'compare_explicit_execution_identity'] : focus === 'work_failure' ? ['verify_same_task_current_source'] : focus === 'background' ? ['inspect_live_worker_activity'] : ['resolve_relevant_source_gaps']).map(kind => ({ kind, evidenceState: 'not_established', readOnly: true }))
  // Keep the requested evidence and its uncertainty boundary inside the display
  // budget. Full receipts and omitted counts remain available in every focus.
  const priorityKinds = focus === 'background' ? ['background_activity_observed','workflow_occupancy_observed', 'activity_unverified', 'configuration_current', 'schedule_current', 'work_recorded'] : focus === 'work_failure' ? ['work_failure_observed', 'fix_unverified', 'candidate_tests_recorded', 'source_snapshot_compared', 'work_recorded', 'configuration_current'] : ['charge_unverified', 'execution_observed', 'usage_recorded', 'candidate_link', 'invocation_attempt_observed','model_result_observed']
  findings.sort((a, b) => Number(b.kind==='charge_unverified')-Number(a.kind==='charge_unverified') || Number(priorityKinds.includes(b.kind)) - Number(priorityKinds.includes(a.kind)))
  const invocationCorrelation=require('./invocationCorrelation').correlateInvocations(sections)
  return { version: 1, focus, state: sections.length ? 'partial' : 'unavailable', goal, readOnly: true, billingConfirmed: false, sections, invocationCorrelation, plan: { goal, focus, readOnly: true, sources: sections.map(s => s.section), fallback: 'continue_available_authorised_sources_when_memory_insufficient', automaticModelRetries: 0 }, findings: findings.slice(0, 30), findingsOmitted: Math.max(0, findings.length - 30), contradictions, transitions, gaps, recommendations, evaluationScope: 'structured_receipt_fields_only_no_semantic_conflict_or_billing_inference' }
}
module.exports = { evaluateInvestigation }
