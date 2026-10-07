'use strict'
// Deterministic evidence grading complements the model answer. Records remain
// untrusted observations; neither a model nor a source can grant write authority.
function evaluateInvestigation ({ goal = '', sections = [] } = {}) {
  const findings = [], gaps = [], contradictions = [], transitions = []
  const add = (s, r, kind, evidenceState, temporalScope, value = null) => findings.push({ kind, evidenceState, temporalScope, sourceId: s.sourceId, recordId: r?.sourceId || null, at: r?.at || r?.lastStartedAt || null, retrievedAt: s.retrievedAt, value })
  const schedules = sections.find(s => s.section === 'schedules')
  for (const s of sections) {
    if (s.state !== 'ok' || !s.records?.length) gaps.push({ section: s.section, state: s.state, sourceId: s.sourceId, coverage: s.coverage || null, omitted: s.omitted ?? null })
    if (s.section === 'billing') { add(s, null, 'charge_unverified', 'not_established', 'unknown'); continue }
    for (const r of s.records || []) {
      if (s.section === 'schedules') add(s, r, 'schedule_current', 'confirmed', 'current', { name: r.name || r.sourceId, state: r.state })
      else if (s.section === 'configuration') add(s, r, 'configuration_current', 'confirmed', 'current', { model: r.model, effort: r.effort })
      else if (s.section === 'execution') {
        if (r.lastStartedAt || r.lastCompletedAt) add(s, r, 'execution_observed', 'confirmed', 'historical', { model: r.model, startedAt: r.lastStartedAt, completedAt: r.lastCompletedAt })
        if (r.usage) add(s, r, 'usage_recorded', 'confirmed', 'historical', { usage: r.usage, usageAt: r.usageAt, basis: r.usageBasis })
        const matched = schedules?.records?.find(task => task.sourceId === 'codex-automation:' + r.declaredAutomationId)
        if (matched) add(s, r, 'candidate_link', 'possible', 'historical', { name: matched.name, scheduleSourceId: schedules.sourceId, basis: 'user_declared_heartbeat_id_only' })
      } else if (s.section === 'history') add(s, r, 'historical_statement', 'supported', 'historical', { title: r.title })
      else if (s.section === 'usage') add(s, r, 'estimated_usage', 'supported', 'historical', { model: r.model, estimated_tokens: r.estimated_tokens })
      else if (s.section === 'work') add(s, r, 'work_recorded', 'confirmed', 'historical', { state: r.state, model: r.model })
    }
    const byId = new Map()
    for (const r of s.records || []) {
      if (!r.sourceId || !r.state) continue
      const prior = byId.get(r.sourceId)
      if (prior && prior.state !== r.state) {
        const target = prior.at && r.at && prior.at !== r.at ? transitions : contradictions
        target.push({ sourceId: s.sourceId, recordId: r.sourceId, observations: [{ state: prior.state, at: prior.at || null }, { state: r.state, at: r.at || null }] })
      }
      byId.set(r.sourceId, r)
    }
  }
  for (const name of ['execution', 'billing']) if (!sections.some(s => s.section === name)) gaps.push({ section: name, state: 'unconnected', sourceId: null })
  const recommendations = [{ kind: 'obtain_billing_evidence', evidenceState: 'not_established', readOnly: true }, { kind: 'compare_explicit_execution_identity', evidenceState: 'possible', readOnly: true }]
  findings.sort((a, b) => Number(['charge_unverified', 'execution_observed', 'usage_recorded', 'candidate_link'].includes(b.kind)) - Number(['charge_unverified', 'execution_observed', 'usage_recorded', 'candidate_link'].includes(a.kind)))
  return { version: 1, state: sections.length ? 'partial' : 'unavailable', goal, readOnly: true, billingConfirmed: false, sections, plan: { goal, readOnly: true, sources: sections.map(s => s.section), fallback: 'continue_available_authorised_sources_when_memory_insufficient', automaticModelRetries: 0 }, findings: findings.slice(0, 30), findingsOmitted: Math.max(0, findings.length - 30), contradictions, transitions, gaps, recommendations, evaluationScope: 'structured_receipt_fields_only_no_semantic_conflict_or_billing_inference' }
}
module.exports = { evaluateInvestigation }
