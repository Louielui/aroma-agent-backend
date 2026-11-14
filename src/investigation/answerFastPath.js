'use strict'

const { renderSourceBoundFindings } = require('./sourceBoundFindings')
const { renderInvocationSummary } = require('./invocationBrief')

// Only a fresh, operations-only Owner enquiry whose final words are entirely
// rendered from source-bound receipts can omit the otherwise discarded answer
// model call. A missing or ambiguous plan falls back to the normal pipeline.
function sourceBoundDirectAnswer (input) {
  const { message, plan, report, operationsLive, ownerInvestigation, subscriptionMode, interactionMode, previousInvestigation, onDecision } = input
  const delegation = sourceBoundDelegationAnswer(input)
  if (delegation) return delegation
  const refused = reason => { onDecision?.(reason); return null }
  // The production continuity lookup returns {state:'absent'} for a new
  // conversation. It is a sentinel, not a prior investigation.
  const priorMayMatter = previousInvestigation && previousInvestigation.state !== 'absent'
  if (!ownerInvestigation || !subscriptionMode || interactionMode !== 'chat' || !operationsLive || priorMayMatter) return refused('outside_fresh_owner_read')
  if (!report || report.readOnly !== true || report.continuity || !plan || plan.investigationReference || plan.investigationFocus !== report.focus) return refused('report_or_focus_mismatch')
  // A fulfilled operations read is the evidence source for this answer, not a new action request.
  if ((plan.requestedCapability || plan.requestedCapabilityImplementation) &&
    !(plan.requestedCapability === 'xiangxiang_operations.read' && plan.requestedCapabilityImplementation === 'implemented')) return refused('capability_requested')
  const frame = plan.executiveFrame
  if (!frame || !['diagnose', 'retrieve', 'understand'].includes(frame.taskType) ||
    !['evidence_first', 'provisional'].includes(frame.answerPosture)) return refused('frame_not_eligible')
  const required = Array.isArray(plan.facts) ? plan.facts.filter(f => f.necessity === 'required') : []
  if (!required.length || required.some(f => f.operation !== 'xiangxiang_operations')) return refused('mixed_required_facts')
  // Enriching facts may now be read by the bounded investigation continuation.
  // They can change the answer the Owner expects. Other sources and unresolved
  // facts retain the model path except for the exact revision-only receipt below.
  const revisionProbe = report.focus === 'work_failure' && report.crossSourceReads?.length === 1 &&
    report.crossSourceReads.every(r => r.source === 'github' && r.phase === 'followup' &&
      r.scope === 'exact_target_source_revision_not_repair_proof' &&
      r.targetRecordId === report.workCorrelation?.targetId &&
      !!r.targetRecordId && /^[a-f0-9]{40}$/i.test(r.requestedRevision || '') &&
      ['sampled', 'empty', 'unavailable'].includes(r.state) && !r.usedFallback)
  // This continuation checks revision metadata only. It cannot settle a repair
  // or add free-form code claims. Its outcome and unresolved development-record
  // integration remain explicit in the fixed reply and full receipt.
  const revisionOnlyFact = f => revisionProbe && f.necessity === 'enriching' &&
    ['development_record', 'github'].includes(f.operation)
  if (plan.facts.some(f => f.operation !== 'xiangxiang_operations' && !revisionOnlyFact(f))) return refused('mixed_plan_facts')
  if (report.crossSourceReads?.length && !revisionProbe) return refused('cross_source_read')
  if (report.evidenceModel?.contradictions?.length) return refused('conflicting_evidence')
  if (!Array.isArray(report.sections) || !report.sections.some(s => ['ok', 'partial'].includes(s.state) && Array.isArray(s.records) && s.records.length)) return refused('no_readable_records')
  const findings = renderSourceBoundFindings(report, { message, plan })
  if (!findings || !['cost', 'work_failure', 'background'].includes(findings.kind) || !findings.text || !findings.references?.length) return refused('no_fixed_findings')
  if (findings.kind === 'background' && (findings.ambiguousRows || plan.joins?.length ||
    !report.sections.some(s => s.section === 'configuration' && ['ok', 'partial'].includes(s.state)))) return refused('background_requires_review')
  onDecision?.('eligible')
  const locale = /[\u3400-\u9fff]/.test(message) ? 'zh' : 'en'
  const label = findings.kind === 'cost' ? 'source_bound_cost_findings' : findings.kind === 'background' ? 'source_bound_background_inventory' : 'source_bound_work_findings'
  const stored = { ...findings, text: undefined }
  const presentation = { kind: label, locale, modelProseUsed: false, reviewSkipped: 'deterministic_verified_findings', findings: stored, answerCallSkipped: true }
  if (findings.kind === 'cost') presentation.costFindings = stored
  const invocation = renderInvocationSummary(report, { message })
  if (invocation) presentation.invocationSummary = { ...invocation, text: undefined }
  return { reply: findings.text, presentation }
}

// Reuse the exact source projection that already replaces the discarded draft
// after generation. The judged goal and authorised read must have completed;
// this predicate grants no source access and never classifies message keywords.
function sourceBoundDelegationAnswer ({ message, plan, report, operationsLive, ownerInvestigation, subscriptionMode, interactionMode, previousInvestigation, capabilityReadSettled, truncated, ownerGoalReporting, authorisedSources, itemsBySource, perSource }) {
  if (!ownerInvestigation || !subscriptionMode || interactionMode !== 'chat' || !operationsLive ||
    !capabilityReadSettled || truncated || ownerGoalReporting || report ||
    previousInvestigation && previousInvestigation.state !== 'absent') return null
  const sections = require('./generalRouter').capabilityReadSections(plan, authorisedSources)
  if (!sections?.includes('delegation') || !Array.isArray(plan.investigationEvidence) || !plan.investigationEvidence.length || !Array.isArray(plan.facts) ||
    plan.investigationEvidence.some(n => !['delegation', 'configuration'].includes(n)) ||
    plan.facts.some(f => f.operation !== 'xiangxiang_operations') ||
    require('./generalRouter').capabilityReadGaps(plan).length ||
    plan.executiveFrame.answerPosture !== 'evidence_first') return null
  if (!Array.isArray(itemsBySource) || itemsBySource.length !== 1 ||
    itemsBySource[0]?.source !== 'xiangxiang_operations' ||
    !Array.isArray(perSource) || perSource.length !== 1 || perSource[0]?.source !== 'xiangxiang_operations' || perSource[0].trust !== 'live') return null
  const rows = itemsBySource[0].items || []
  if (!Array.isArray(rows) || rows.length !== 3 || sections.some(s => rows.filter(r => r?.fields?.section === s).length !== 1) ||
    rows.some(r => !r || r.source !== 'xiangxiang_operations' || r.trust !== 'live' ||
      !r.sourceId || !['ok', 'partial'].includes(r.fields?.state))) return null
  const roster = rows.find(r => r.fields.section === 'delegation').fields
  if (!roster.scopeComplete || roster.coverage?.backend !== 'read' || roster.coverage?.bridge !== 'read') return null
  const direct = require('./delegationEvidenceView').renderDelegation({
    message, answerKind: plan.answerKind, capabilityReadSettled, itemsBySource, ownerGoalReporting
  })
  if (!direct) return null
  return {reply: direct.reply, presentation: {kind: 'validated_capability_explanation',
    validation: direct.validation, modelProseUsed: false, dispatchVerified: false,
    answerCallSkipped: true, skipReason: 'settled_source_bound_delegation'}}
}

module.exports = { sourceBoundDirectAnswer, sourceBoundDelegationAnswer }
