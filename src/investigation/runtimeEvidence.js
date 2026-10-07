'use strict'
// Process observations only: no mailbox bodies, inference, scheduler control or billing.
function createBackendRuntimeReader ({ mailMemory = null, mailScheduler = null, memory = null, clock = () => new Date().toISOString() } = {}) {
  return { async read () {
    const at = clock()
    const safe = async fn => { try { return await fn() } catch (_) { return null } }
    const [mail, scheduler, general, consolidation] = await Promise.all([
      safe(() => mailMemory?.runtimeStatus?.()), safe(() => mailScheduler?.status?.()), safe(() => memory?.status?.()),safe(()=>memory?.consolidation?.status?.())])
    const row = (role, enabled, active, extra = {}) => ({ sourceId:'backend:' + role, role, at,
      enabled: typeof enabled === 'boolean' ? enabled : null,
      currentRunningState: typeof active === 'boolean' ? active ? 'active' : 'idle' : 'unknown',
      model:null, modelBasis:'not_observed', evidenceBasis:'live_process_snapshot', ...extra })
    return { state:'partial', retrievedAt:at, provesCharge:false, records:[
      row('mail_sync',mail?.enabled,mail?.syncActive,{usesModel:false}),
      row('mail_analysis',mail && scheduler ? mail.enabled && mail.analysisConnected && !scheduler.paused : null,mail?.analysisActive,
        {reason:typeof scheduler?.reason === 'string' ? scheduler.reason.slice(0,80) : null,nextAt:typeof scheduler?.nextAt === 'string' ? scheduler.nextAt : null}),
      row('mail_index',mail?.indexEnabled,mail?.indexActive),
      row('memory_index',general?.enabled,general?.indexing,{nextAt:general?.nextIndexAt || null}),
      row('memory_outbox',general?.enabled,general ? general.active && !general.indexing : null),
      row('memory_consolidation',consolidation ? consolidation.enabled && consolidation.captureEnabled : null,consolidation?.busy)
    ], note:'Instantaneous status of registered backend components only. Idle is not absent. Model routing comes from the Owner bridge, not nominal Hindsight API model names. External workers and billing are outside this snapshot.' }
  } }
}
function joinBackgroundModels (records, bridgeRecords) {
  const route = bridgeRecords.find(r => r.role === 'memory_completion')
  return records.map(r => ['mail_analysis','mail_index','memory_index','memory_outbox','memory_consolidation'].includes(r.role) && route?.model ?
    {...r,model:route.model,provider:route.provider,effort:route.effort,modelBasis:'bridge_route_configuration',modelObservedAt:route.at} : r)
}
module.exports = {createBackendRuntimeReader,joinBackgroundModels}
