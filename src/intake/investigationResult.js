'use strict'
const goals = require('./goal/ownerGoal')
// Projection of host-persisted gateway evidence; no model prose completes goals.
function investigationResult(task, record) {
  const evidence = record?.ownerCoordination && record?.result?.taskEvidence
  if (!evidence) return null
  const execution = evidence.execution, packs = execution?.packs || [], synthesis = evidence.synthesis
  const capabilities = [...new Set((evidence.selection?.tools || []).map(t => t.id.startsWith('aroma.') ? 'aroma_system.read' : t.id.startsWith('drive.') ? 'drive.read' : t.id.startsWith('calendar.') ? 'calendar.read' : null).filter(Boolean))]
  // Only unambiguous single-capability evidence labels a clause. Cross-source
  // investigations retain all mandatory original clauses without guessed mapping.
  const proposed = capabilities.length === 1 && task.ownerGoal.outcomes.length === 1 ? [{ ownerQuote: task.ownerGoal.outcomes[0].ownerQuote, capability: capabilities[0], kind: 'read' }] : []
  let goal = goals.refineGoal(task.ownerGoal, proposed)
  if (evidence.evidenceMode !== 'synthetic_fixture') goal = goals.observeReads(goal, { perSource: packs.map(p => ({ source: p.source, trust: p.state === 'ok' ? 'live' : 'unavailable' })), evidenceSets: packs.map(p => ({ source: p.source, completeness: p.coverage?.complete && p.coverage?.truncated === false ? 'complete' : 'partial' })) })
  // These read receipts establish retrieval, never a verified mandatory outcome.
  goal = goals.applyEvidence(goal, [], () => false)
  return { taskId: task.id, goalId: goal.goalId, attemptId: record.unifiedTask.attemptId,
    executed: record.state === 'completed', readState: !packs.length ? 'not_read' : packs.every(p => p.state === 'ok') ? 'retrieved' : 'partial_or_unavailable',
    groundedAnswer: synthesis?.state === 'reviewed' && synthesis.claims.length > 0,
    sourceCoverage: !packs.length ? 'not_read' : packs.every(p => p.state === 'ok' && p.kind !== 'bounded_read_receipt' && p.coverage?.complete === true && p.coverage?.truncated === false) ? 'complete_within_returned_scope' : 'partial_or_unknown',
    answerCoverage: synthesis?.sources?.every(s => s.state === 'ok') ? 'complete_within_projected_scope' : 'partial_or_unknown',
    answerSources: (synthesis?.report?.sections || []).map(s => ({ sourceId: s.sourceId, source: s.source, tool: s.tool, packSha256: s.packSha256, state: s.state,
      records: s.records.map(r => ({ recordId: r.sourceId, originalSourceId: r.originalSourceId, link: r.link || null, ...(Number.isSafeInteger(r.start) ? { start: r.start, end: r.end, contentSha256: r.contentSha256 } : {}) })) })),
    evidenceMode: evidence.evidenceMode, ...(evidence.executionProvenance ? { executionProvenance: evidence.executionProvenance } : {}), sourceReceipts: packs.map(p => ({ source: p.source, resource: p.resource, operation: p.operation, packSha256: p.packSha256 || require('./toolSelection/selection').digest(p) })),
    goalVerifiedComplete: false, goalStatus: goal.status, unresolvedReason: 'no_host_verified_receipt_for_all_mandatory_owner_outcomes', goal }
}
module.exports = { investigationResult }
