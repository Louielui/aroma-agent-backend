'use strict'

const { renderSourceBoundFindings } = require('./sourceBoundFindings')
const { renderInvocationSummary } = require('./invocationBrief')

// Only a fresh, operations-only Owner enquiry whose final words are entirely
// rendered from source-bound receipts can omit the otherwise discarded answer
// model call. A missing or ambiguous plan falls back to the normal pipeline.
function sourceBoundDirectAnswer ({ message, plan, report, operationsLive, ownerInvestigation, subscriptionMode, interactionMode, previousInvestigation }) {
  if (!ownerInvestigation || !subscriptionMode || interactionMode !== 'chat' || !operationsLive || previousInvestigation) return null
  if (!report || report.readOnly !== true || report.continuity || !plan || plan.investigationReference || plan.investigationFocus !== report.focus) return null
  if (plan.requestedCapability || plan.requestedCapabilityImplementation) return null
  const frame = plan.executiveFrame
  if (!frame || !['diagnose', 'retrieve', 'understand'].includes(frame.taskType) ||
    !['evidence_first', 'provisional'].includes(frame.answerPosture)) return null
  const required = Array.isArray(plan.facts) ? plan.facts.filter(f => f.necessity === 'required') : []
  if (!required.length || required.some(f => f.operation !== 'xiangxiang_operations')) return null
  if (!Array.isArray(report.sections) || !report.sections.some(s => ['ok', 'partial'].includes(s.state) && Array.isArray(s.records) && s.records.length)) return null
  const findings = renderSourceBoundFindings(report, { message })
  if (!findings || !['cost', 'work_failure'].includes(findings.kind) || !findings.text || !findings.references?.length) return null
  const locale = /[\u3400-\u9fff]/.test(message) ? 'zh' : 'en'
  const label = findings.kind === 'cost' ? 'source_bound_cost_findings' : 'source_bound_work_findings'
  const stored = { ...findings, text: undefined }
  const presentation = { kind: label, locale, modelProseUsed: false, reviewSkipped: 'deterministic_verified_findings', findings: stored, answerCallSkipped: true }
  if (findings.kind === 'cost') presentation.costFindings = stored
  const invocation = renderInvocationSummary(report, { message })
  if (invocation) presentation.invocationSummary = { ...invocation, text: undefined }
  return { reply: findings.text, presentation }
}

module.exports = { sourceBoundDirectAnswer }
