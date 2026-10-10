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
function remediationGoal (scope, original) {
  return scope.profile === 'seven_shifts'
    ? 'Improve the registered 7shifts GET-only time-punch reader for clock-in/clock-out evidence. Preserve bounded dates, pagination completeness, exact company binding, credential isolation, safe failures and read-only guards. The original request is retained for read-only continuation; payroll approval is outside this development scope.'
    : original
}
module.exports = { SEVEN_FILES, SEVEN_DEPENDENCIES, SEVEN_SCOPE, scopeForGoal, planningMessage, remediationGoal }
