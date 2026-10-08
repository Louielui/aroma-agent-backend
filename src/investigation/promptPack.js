'use strict'

// The Owner's cost enquiry already has a bounded fresh scalar catalog. Sending
// the full rendered receipts again makes the model read the same records twice,
// including nested work artifacts that cannot be cited by the scalar reviewer.
// The full report remains server-side for exact binding and the Owner view.
const COST_LINKAGE_KINDS = new Set(['charge_unverified', 'candidate_link'])

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
  // The fresh scalar catalog already carries the exact citable records. Repeating
  // every invocation as a second finding consumed thousands of tokens and could
  // crowd out other source categories. Preserve only cross-source linkage and the
  // billing boundary here; counts describe the bounded sample, not account totals.
  const all = report.findings || []
  const findings = all.filter(f => COST_LINKAGE_KINDS.has(f.kind)).slice(0, 4)
  const findingKindCounts = {}
  for (const f of all) findingKindCounts[f.kind] = (findingKindCounts[f.kind] || 0) + 1
  return {
    ...common,
    findings,
    findingKindCounts,
    findingsOmittedFromPrompt: (report.findingsOmitted || 0) + all.length - findings.length,
    evaluationScope: report.evaluationScope + '; cost-focused bounded sample counts, full receipts retained server-side'
  }
}

module.exports = { promptEvaluation }
