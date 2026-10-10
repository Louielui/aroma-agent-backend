'use strict'
// Process observations only: no mailbox bodies, inference, scheduler control or billing.
function createBackendRuntimeReader ({ mailMemory = null, mailScheduler = null, memory = null, clock = () => new Date().toISOString() } = {}) {
  return { async read () {
    const at = clock()
    const safe = async (object,method) => {
      if(typeof object?.[method]!=='function')return {state:'unconnected',value:null}
      try {const value=await object[method]();return value&&typeof value==='object'?{state:'ok',value}:{state:'unavailable',value:null}} catch (_) {return {state:'unavailable',value:null}}
    }
    const [mailRead,schedulerRead,generalRead,consolidationRead,mailProgress,memoryProgress] = await Promise.all([
      safe(mailMemory,'runtimeStatus'), safe(mailScheduler,'status'), safe(memory,'status'),safe(memory?.consolidation,'status'),
      safe(mailMemory,'progressStatus'),safe(memory,'progressStatus')])
    const [mail,scheduler,general,consolidation]=[mailRead,schedulerRead,generalRead,consolidationRead].map(r=>r.value)
    const row = (role, enabled, active, observationState, extra = {}) => ({ sourceId:'backend:' + role, role, at,observationState,
      enabled: typeof enabled === 'boolean' ? enabled : null,
      currentRunningState: typeof active === 'boolean' ? active ? 'active' : 'idle' : 'unknown',
      model:null, modelBasis:'not_observed', evidenceBasis:'live_process_snapshot', ...extra,
      ...(['mail_analysis','memory_index','memory_outbox','memory_consolidation'].includes(role)?{
        progressState:(role==='mail_analysis'?mailProgress:memoryProgress).value?.[role]?.state==='unavailable'?'unavailable':(role==='mail_analysis'?mailProgress:memoryProgress).state,
        progress:require('./workPurpose').projectProgress(role,(role==='mail_analysis'?mailProgress:memoryProgress).value?.[role])}: {}) })
    return { state:'partial', retrievedAt:at, provesCharge:false, records:[
      row('mail_sync',mail?.enabled,mail?.syncActive,mailRead.state,{usesModel:false}),
      row('mail_analysis',mail && scheduler && [mail.enabled,mail.analysisConnected,scheduler.paused].every(v=>typeof v==='boolean') ? mail.enabled && mail.analysisConnected && !scheduler.paused : null,mail?.analysisActive,
        mailRead.state,{enablementState:schedulerRead.state,reason:typeof scheduler?.reason === 'string' ? scheduler.reason.slice(0,80) : null,nextAt:typeof scheduler?.nextAt === 'string' ? scheduler.nextAt : null}),
      row('mail_index',mail?.indexEnabled,mail?.indexActive,mailRead.state),
      row('memory_index',general?.enabled,general?.indexing,generalRead.state,{nextAt:general?.nextIndexAt || null}),
      row('memory_outbox',general?.enabled,general && [general.active,general.indexing].every(v=>typeof v==='boolean') ? general.active && !general.indexing : null,generalRead.state),
      row('memory_consolidation',consolidation && [consolidation.enabled,consolidation.captureEnabled].every(v=>typeof v==='boolean') ? consolidation.enabled && consolidation.captureEnabled : null,consolidation?.busy,consolidationRead.state)
    ], note:'Instantaneous status of registered backend components only. Idle is not absent. Model routing comes from the Owner bridge, not nominal Hindsight API model names. External workers and billing are outside this snapshot.' }
  } }
}
function joinBackgroundModels (records, bridgeRecords) {
  const routes=bridgeRecords.filter(r=>r.role==='memory_completion'&&r.sourceId==='bridge:memory_completion'),route=routes.length===1?routes[0]:null
  // Active selection belongs to the bridge lane, not an unrelated component.
  // A legacy idle receipt can still provide its configured route; an active
  // legacy receipt without a separate configuration cannot do so.
  const model=route&&(Object.hasOwn(route,'configuredModel')?route.configuredModel:route.modelBasis==='bridge_route_configuration'?route.model:null)
  return records.map(r => ['mail_analysis','mail_index','memory_index','memory_outbox','memory_consolidation'].includes(r.role) && model ?
    {...r,model,provider:require('../subscription/chatModels').isClaudeModel(model)?'claude':'gpt',effort:route.configuredEffort??(route.modelBasis==='bridge_route_configuration'?route.effort:null),modelBasis:'bridge_route_configuration',modelObservedAt:route.at} : r)
}
module.exports = {createBackendRuntimeReader,joinBackgroundModels}
