'use strict'
const { isValidId } = require('../store/conversationStore')
const { validEvidenceSource, validCandidate, identityFor, hash } = require('./evidenceFollowups')
const exact = (o, keys) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join(',') === keys.slice().sort().join(',')
const instant = v => typeof v === 'string' && v.length <= 35 && Number.isFinite(Date.parse(v))
const states = ['changed', 'unchanged', 'unknown', 'unavailable']
const reasons = ['records_changed', 'records_unchanged', 'findings_cleared', 'source_unavailable', 'source_access_changed', 'scope_mismatch', 'stale_source', 'record_not_found', 'ambiguous_match', 'partial_scope', 'unverified_match', 'manual_out_unknown', 'read_limit', 'invalid_source_response']
function validResult (r, source, state) {
  return exact(r, ['state', 'reason', 'checkedAt', 'completeWithinScope', 'after', 'suggestedState']) && states.includes(r.state) && reasons.includes(r.reason) &&
    (r.checkedAt === null || instant(r.checkedAt)) && (r.completeWithinScope === null || typeof r.completeWithinScope === 'boolean') && ['todo', 'doing', 'done'].includes(r.suggestedState) &&
    (r.after === null || validCandidate(r.after, true) && r.after.identity === source.snapshot.identity && r.after.identity === identityFor(source.reportKind, source.companyId, source.queryDate, r.after.evidence) && r.after.key === hash([r.after.identity, r.after.evidence])) &&
    (!['changed', 'unchanged'].includes(r.state) || r.after !== null && r.checkedAt !== null && Date.parse(r.checkedAt) > Date.parse(source.retrievedAt) && r.completeWithinScope === true && r.after.evidence.matchState === 'CONFIRMED') &&
    (r.suggestedState === state || r.suggestedState === 'done' && r.reason === 'findings_cleared' && r.state === 'changed' && r.after?.evidence.findings.length === 0 && r.after?.evidence.clockedOut !== null) &&
    (!['unknown', 'unavailable'].includes(r.state) || r.suggestedState === state)
}
function validRecheck (r) {
  return exact(r, ['id', 'conversationId', 'createdAt', 'expiresAt', 'items', 'acceptedIds']) && isValidId(r.id) && isValidId(r.conversationId) && instant(r.createdAt) && instant(r.expiresAt) && Date.parse(r.expiresAt) - Date.parse(r.createdAt) === 3600000 &&
    Array.isArray(r.items) && r.items.length <= 100 && new Set(r.items.map(i => i.noteId)).size === r.items.length && r.items.every(i =>
      exact(i, ['noteId', 'revision', 'state', 'nextStep', 'title', 'source', 'baseline', 'result']) && isValidId(i.noteId) && Number.isInteger(i.revision) && i.revision > 0 && ['todo', 'doing', 'done'].includes(i.state) &&
      typeof i.nextStep === 'string' && i.nextStep.length <= 600 && typeof i.title === 'string' && i.title.length > 0 && i.title.length <= 160 && validEvidenceSource(i.source) && validEvidenceSource(i.baseline, true) &&
      i.baseline.snapshot.identity === i.source.snapshot.identity && validResult(i.result, i.baseline, i.state) && (i.result.checkedAt === null || Date.parse(i.result.checkedAt) <= Date.parse(r.createdAt))) &&
    Array.isArray(r.acceptedIds) && new Set(r.acceptedIds).size === r.acceptedIds.length && r.acceptedIds.every(id => r.items.some(i => i.noteId === id && ['changed', 'unchanged'].includes(i.result.state)))
}
module.exports = { exact, validResult, validRecheck }
