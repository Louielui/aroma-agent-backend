'use strict'
const path = require('node:path')
const usage = require('../actions/usageBudget')
const { UsageBudgetError } = require('../actions/usageError')
const { hash, ID } = require('../actions/contract')
const { CONTROL, profile } = require('../actions/dailyDialoguePolicy')
const { createStore } = require('../actions/store')
const { createStandingDialogue } = require('./standingDialogue')
const OWNER = Object.freeze({ id:'owner', role:'owner' })
const fail = code => { throw new UsageBudgetError(code) }

// Host-only management. The browser receives only run(), never activation or pause.
function createDailyDialogue({ dir = path.join(require('../store/dataDir').resolveDataDir(),'owner-local-dialogue'),
  now = Date.now, runtimeCommit = () => require('../governance/bootCommit').BOOT_COMMIT } = {}) {
  const store = createStore({dir})
  const standing = createStandingDialogue({dir,now,runtimeCommit})
  function budget(spec) {
    return usage.createUsageBudget({ store, now, runtimeCommit, activationReady:()=>true,
      evidenceDir:path.join(dir,'evidence'), profile:profile(spec.id,spec.limit,spec.windowMs) })
  }
  function current() {
    const control = store.get(CONTROL)
    if (!control) return null
    if (!control.current || hash(control.current)!==control.materialHash) fail('usage_audit_unavailable')
    return control.current
  }
  function activate({id, commit, limit, windowMs}) {
    if (typeof commit!=='string' || !/^[0-9a-f]{40}$/.test(commit) || commit!==runtimeCommit()) fail('usage_binding_conflict')
    const material = {id,commit,limit,windowMs}
    const next = budget(material)
    const release = store.lockRun(CONTROL)
    try {
      if (standing.hasCurrent()) fail('usage_binding_conflict')
      if (store.exists(id)) fail('usage_attempt_replayed')
      const prior = current()
      if (prior && budget(prior).readStatus().state!=='paused') fail('usage_unresolved_work')
      next.handle(OWNER,{op:'usage_local_acceptance_activate',rootId:id,predecessorHash:hash([]),commit})
      // Publish last. If the process stops before this write the new grant is unreachable.
      store.save({id:CONTROL,current:material,materialHash:hash(material),timeline:[{event:'selected',prior:prior?.id||null}]})
    } finally { release() }
  }
  function status() {
    const selected=standing.currentStatus()
    if (selected) return selected
    const spec=current()
    return spec ? budget(spec).readStatus() : {state:'not_activated'}
  }
  // Operator observation is gated on a terminal HTTP workflow. finishTurn has
  // already returned before demoRouter persists that workflow's terminal state.
  function afterTurn(grantId,conversationId,requestId,workflow) {
    if (![grantId,conversationId,requestId].every(id=>typeof id==='string' && ID.test(id))) fail('invalid_request')
    const receipt=workflow.get(requestId)
    if (!receipt || receipt.conversationId!==conversationId || !['completed','failed'].includes(receipt.state))
      fail('turn_not_complete')
    const standingReceipt=standing.afterTurn(grantId,conversationId,requestId)
    if (standingReceipt) return standingReceipt
    const spec=current()
    if (spec?.id!==grantId) fail('usage_binding_conflict')
    // Use the ledger writer's lock for a single snapshot, even if a later
    // request has just begun. No PowerShell file handle spans a model call.
    const snapshot=budget(spec).status()
    const turn=snapshot.turns.find(t=>t.conversationId===conversationId && t.requestId===requestId)
    if (!turn?.finished) fail('turn_not_complete')
    return {grantId,turn,attempts:snapshot.attempts.filter(a=>a.turnId===turn.id),helper:snapshot.helper}
  }
  function pause(id) {
    const spec=current()
    if (!spec || spec.id!==id) fail('usage_binding_conflict')
    budget(spec).pauseDaily()
  }
  function manageStanding(operation,id,commit,expectedEpoch) {
    if (operation!=='activate') return standing.manage(operation,id,commit,expectedEpoch)
    const release=store.lockRun(CONTROL)
    try {
      const prior=current()
      if (prior && budget(prior).readStatus().state!=='paused') fail('usage_unresolved_work')
      return standing.manage(operation,id,commit,expectedEpoch)
    } finally { release() }
  }
  async function run(conversationId,requestId,operation,onAdmissionRefusal) {
    let spec, b, scope, standingTurn
    try {
      if (usage.currentScope()) fail('usage_binding_conflict')
      standingTurn=standing.admit(conversationId,requestId)
      if (standingTurn) ({b,scope}=standingTurn)
      else {
        spec=current()
        if (!spec) fail('usage_not_enabled')
        b=budget(spec)
        scope=b.enterDailyTurn(conversationId,requestId)
      }
    } catch (error) {
      // Only admission failures reach this observer. The intake mapper owns the public code.
      const expiry = error instanceof UsageBudgetError && error.code === 'usage_expired'
      onAdmissionRefusal?.({
        grantId:error.standingGrantId || (typeof spec?.id === 'string' && ID.test(spec.id) ? spec.id : null),
        requestId:typeof requestId === 'string' && ID.test(requestId) ? requestId : null,
        conversationId:typeof conversationId === 'string' && ID.test(conversationId) ? conversationId : null,
        evaluatedAt:expiry ? error.evaluatedAt : now(),
        expiresAt:expiry ? error.expiresAt : null
      })
      throw error
    }
    try {
      const result=await b.withScope(scope,operation)
      const blocked=b.turnFailure(scope)
      if (blocked) fail(blocked)
      return result
    } finally {
      try { b.finishTurn(scope) } finally { standingTurn?.close() }
    }
  }
  return {activate,status,afterTurn,pause,run,manageStanding,standingStatus:standing.status}
}
module.exports={createDailyDialogue}
