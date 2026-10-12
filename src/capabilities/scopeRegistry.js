'use strict'
// Host-owned development scopes. Matching identifies a candidate; it never
// grants credentials, read access, coding approval or adoption approval.
const SEVEN_FILES = Object.freeze(['src/context/adapters/sevenShiftsRead.js'])
const SEVEN_DEPENDENCIES = Object.freeze(['src/context/contextResult.js'])
const SEVEN_SCOPE = Object.freeze({profile:'seven_shifts',files:SEVEN_FILES,permissions:'read_only_existing_authorisation'})
function scopeForGoal (goal) {
  if (typeof goal !== 'string' || !/\b7\s*shifts?\b/i.test(goal) || !/(clock[ -]?(?:out|in)|time[ _-]?punch|打卡|上下班)/i.test(goal)) return null
  return structuredClone(SEVEN_SCOPE)
}
const planningMessage = scope => scope.profile === 'seven_shifts' ? 'plan Imagine seven_shifts reader improvements' : 'plan Imagine context read routing improvements'
function remediationGoal (scope, original, version = 2) {
  if (scope.profile === 'seven_shifts' && version === 3) return 'Add methods.listClockOuts({timeMin,timeMax}) to the registered 7shifts adapter. The existing host report/query handler already resolves Winnipeg dates including DST and renders all rows, and calls this exact new method with inclusive UTC boundaries. In this one editable reader file implement fixed GET time_punches clocked_out[gte/lte] filters, retain overnight shifts, fully retrieve at most 3 pages of 100 rows, and expose truthful completeness. Resolve names through fixed GET /v2/company/{bound company_id}/users/{numeric user_id}, max 50 unique users, bounded timeout; validate company and user identity and strip contacts, wages and other private fields. Name failures retain verified punch rows with employeeName:null and nameState:unavailable; successful names use nameState:confirmed. Return context result rows with fields including companyId,userId,punchId,clockedIn,clockedOut,employeeName,nameState,approved,autoClockedOut and evidence.trust:live, returnedRows, completeWithinScope, queryScope.companyId and queryScope.field:clocked_out. Preserve listTimePunches unchanged. Reject bad dates, out-of-window/company/duplicate evidence, arbitrary inputs and revoked or changed access. No token, permission, write, dependency or endpoint expansion. The host resumes the original read after reviewed adoption and loaded-build verification; payroll approval is outside this development scope.'
  return scope.profile === 'seven_shifts'
    ? 'Improve the registered 7shifts GET-only time-punch reader for clock-in/clock-out evidence. Preserve bounded dates, pagination completeness, exact company binding, credential isolation, safe failures and read-only guards. The original request is retained for read-only continuation; payroll approval is outside this development scope.'
    : original
}
module.exports = { SEVEN_FILES, SEVEN_DEPENDENCIES, SEVEN_SCOPE, scopeForGoal, planningMessage, remediationGoal }
