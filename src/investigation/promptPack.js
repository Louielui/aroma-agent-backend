'use strict'

// The Owner's cost enquiry already has a bounded fresh scalar catalog. Sending
// the full rendered receipts again makes the model read the same records twice,
// including nested work artifacts that cannot be cited by the scalar reviewer.
// The full report remains server-side for exact binding and the Owner view.
const COST_KINDS = new Set([
  'charge_unverified', 'invocation_attempt_observed', 'model_result_observed',
  'execution_observed', 'usage_recorded', 'candidate_link', 'schedule_current',
  'configuration_current', 'background_activity_observed', 'historical_statement',
  'estimated_usage', 'work_recorded', 'work_failure_observed'
])

function promptEvaluation (report) {
  const common = {
    plan: report.plan,
    gaps: report.gaps,
    contradictions: report.contradictions,
    transitions: report.transitions,
    continuity: report.continuity || null,
    evaluationScope: report.evaluationScope
  }
  if (report.focus !== 'cost') return { ...common, findings: report.findings }
  const findings = (report.findings || []).filter(f => COST_KINDS.has(f.kind)).map(f => {
    if (f.kind !== 'work_recorded') return f
    const value = f.value || {}
    return { ...f, value: { state: value.state ?? null, model: value.model ?? null,
      reviewModel: value.reviewModel ?? null, appliedToLive: value.appliedToLive ?? null } }
  })
  return {
    ...common,
    findings,
    findingsOmittedFromPrompt: (report.findingsOmitted || 0) + (report.findings || []).length - findings.length,
    evaluationScope: report.evaluationScope + '; cost-focused findings projection, full receipts retained server-side'
  }
}

module.exports = { promptEvaluation }
