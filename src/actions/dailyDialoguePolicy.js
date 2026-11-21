'use strict'
const { createHash } = require('node:crypto')
const { ID, hash } = require('./contract')
const { UsageBudgetError } = require('./usageError')
const local = require('./localAcceptancePolicy')
const deployment = require('../localBrain/deploymentProfile.json')
const IDENTITY = 'owner-manual-local-dialogue-v1'
const CONTROL = 'fe62ecba-eadc-4fcc-80a8-115714d185c5'
const phases = new Set(['intent','goal_understanding','answer','source_intent','final_verification','recovery_decision','public_query_plan'])

function profile(id, limit, windowMs) {
  if (!ID.test(id) || id === CONTROL || id !== id.toLowerCase() || !Number.isSafeInteger(limit) || limit < 1 || limit > 128 ||
      !Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > 86400000) throw new UsageBudgetError('usage_profile_not_allowed')
  const slots = Array.from({length:limit}, (_, index) => {
    const hex = createHash('sha256').update(IDENTITY + ':' + id + ':' + index).digest('hex').slice(0,32)
    const slot = [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-')
    return {id:slot, purpose:'dialogue', limit:Math.min(12,limit)}
  })
  return {id,identity:IDENTITY,model:deployment.model,digest:deployment.digest,effort:'auto',helper:limit,website:0,turns:limit,windowMs,turnMs:windowMs,slots}
}
function policy(candidate) {
  if (candidate.identity !== IDENTITY) return null
  if (hash(candidate) !== hash(profile(candidate.id,candidate.helper,candidate.windowMs))) throw new UsageBudgetError('usage_profile_not_allowed')
  const base = local.policyForDialogue(candidate)
  return {...base, validate(row) {
    base.validate(row)
    if (row.children.length || row.attempts.some(a=>!phases.has(a.phase))) throw new UsageBudgetError('usage_audit_unavailable')
  }, reserve(row, scope, input, kind, now, commit) {
    if (!phases.has(input.phase) || scope.childId) throw new UsageBudgetError('usage_operation_not_allowed')
    return base.reserve(row,scope,input,kind,now,commit)
  }}
}
module.exports = { profile, policy, CONTROL }
