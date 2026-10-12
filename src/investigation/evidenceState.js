 'use strict'
// Canonical evidence describes assertions, not whole sources. A readable config
// can confirm a configured model while leaving live activity UNKNOWN.
const STATES=Object.freeze(['CONFIRMED','SUPPORTED','CANDIDATE','CONTRADICTED','UNKNOWN','UNAVAILABLE'])
const readable=s=>['ok','partial'].includes(s?.state)
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null
const known=v=>v!==null&&v!==undefined&&v!==''&&!['unknown','UNREADABLE','not_observed','not_recorded'].includes(v)
const identity=r=>r?.sourceId||r?.role||null
function buildEvidenceState(report) {
  const assertions=[],coverage=[]
  const add=(s,r,facet,time,value,grade='CONFIRMED',fields=[])=>{
    const id=identity(r)
    const observedAt=['current_configuration','current_enablement','current_source'].includes(time)?date(s.retrievedAt):date(r?.at||r?.startedAt||r?.lastStartedAt||r?.originalDate)
    const references=fields.filter(f=>r&&Object.hasOwn(r,f)).map(field=>({sourceId:s.sourceId,recordId:id,field,value:r[field]}))
    const liveAt=facet==='configured_model'&&r?.modelObservedAt?r.modelObservedAt:r?.at
    const liveAge=date(s.retrievedAt)&&date(liveAt)?Date.parse(s.retrievedAt)-Date.parse(liveAt):null
    const liveBound=time==='current_runtime'||(r?.evidenceBasis==='live_process_snapshot'&&['current_configuration','current_enablement'].includes(time))
    const fresh=!liveBound||(liveAge!==null&&liveAge>=-5000&&liveAge<=300000)
    const unavailable=!readable(s)||['unavailable','unconnected'].includes(r?.observationState)||(facet==='enabled'&&['unavailable','unconnected'].includes(r?.enablementState))
    const state=unavailable?'UNAVAILABLE':!known(value)||!fresh?'UNKNOWN':grade
    assertions.push({id:'e'+(assertions.length+1),subject:s.section+':'+(id||'source'),sourceId:s.sourceId||null,recordId:id,
      facet,temporalScope:time,state,value:state==='UNKNOWN'||state==='UNAVAILABLE'?null:value,observedAt,retrievedAt:date(s.retrievedAt),references})
  }
  for(const s of report.sections||[]) {
    coverage.push({section:s.section,sourceId:s.sourceId,state:readable(s)?(s.records?.length?'SUPPORTED':'UNKNOWN'):'UNAVAILABLE',scope:s.coverage||'bounded_source_receipt',retrievedAt:date(s.retrievedAt)})
    for(const[role,state]of Object.entries(s.runtimeCoverage||{}))if(['unavailable','unconnected'].includes(state))coverage.push({section:'runtime_'+role,sourceId:s.sourceId,recordId:null,state:'UNAVAILABLE',scope:'registered_runtime_subsource',retrievedAt:date(s.retrievedAt)})
    if(!readable(s)){add(s,null,'source_access','unknown',null);continue}
    for(const r of s.records||[]) {
      if(!identity(r))continue
      if(['configuration','schedules'].includes(s.section)) {
        const model=Object.hasOwn(r,'configuredModel')?r.configuredModel:r.modelBasis==='in_flight_request_selection'?null:r.model
        add(s,r,'configured_model','current_configuration',r.usesModel===false?'no_model':model,'CONFIRMED',['configuredModel','configuredEffort','model','usesModel','modelBasis','modelObservedAt'])
        let enabled=typeof r.enabled==='boolean'?r.enabled:typeof r.scheduled==='boolean'?r.scheduled:r.state==='ACTIVE'?true:r.state==='PAUSED'||r.state==='NOT_INSTALLED'?false:null
        add(s,r,'enabled','current_enablement',enabled,'CONFIRMED',['enabled','scheduled','state'])
        const witness=r.evidenceBasis==='live_process_snapshot'||r.executionKind==='deterministic_food_recall_check'
        add(s,r,'running','current_runtime',witness?r.currentRunningState:null,'CONFIRMED',['currentRunningState','evidenceBasis','executionKind','at'])
        if(r.modelBasis==='in_flight_request_selection')add(s,r,'selected_request_model','current_runtime',witness&&r.currentRunningState==='active'?r.model:null,'CONFIRMED',['model','modelBasis','currentRunningState','at','startedAt'])
        if(r.bootCommit)add(s,r,'loaded_revision','current_configuration',r.bootCommit,'CONFIRMED',['bootCommit','bootedAt'])
      } else if(s.section==='execution') {
        add(s,r,'execution_state','historical_execution',r.state||((r.lastStartedAt||r.lastCompletedAt)?'execution_recorded':null),'CONFIRMED',['state','lastStartedAt','lastCompletedAt','startedAt','finishedAt'])
        if(r.evidenceBasis==='owner_bridge_invocation_ledger') {
          add(s,r,'requested_model','historical_configuration',r.model,'CONFIRMED',['model'])
          add(s,r,'executed_model','historical_execution',r.modelResultObserved===true?r.actualModel:null,'CONFIRMED',['actualModel','modelResultObserved'])
        } else add(s,r,'executed_model','historical_execution',r.model,'SUPPORTED',['model'])
        if(r.usage)add(s,r,'recorded_usage','historical_execution',r.usage,'CONFIRMED',['usage','usageBasis'])
        if(r.declaredAutomationId)add(s,r,'schedule_link','historical_execution',r.declaredAutomationId,'CANDIDATE',['declaredAutomationId'])
      } else if(s.section==='work') {
        add(s,r,'work_state','historical_execution',r.state,'CONFIRMED',['state','at'])
        if(['failed','timed_out','needs_attention'].includes(r.state)) {
          add(s,r,'failure_reason','historical_execution',r.reason,'CONFIRMED',['reason','failureDiagnostic'])
          add(s,r,'repaired','current_runtime',null,'UNKNOWN',[])
        }
        add(s,r,'source_revision','historical_configuration',r.sourceRevision,'CONFIRMED',['sourceRevision'])
        add(s,r,'candidate_tests','historical_execution',r.tests&&Object.values(r.tests).some(v=>Number.isFinite(v))?r.tests:null,'CONFIRMED',['tests','sourceRevision'])
        add(s,r,'registered_file_comparison','current_source',r.sourceFiles?.some(f=>f.currentHash)?r.sourceFiles:null,'CONFIRMED',['sourceFiles'])
        if(r.model)add(s,r,'executed_model','historical_execution',r.model,'CONFIRMED',['model'])
      } else if(s.section==='history') add(s,r,'historical_statement','historical_statement',r.title,'SUPPORTED',['title','at'])
      else if(s.section==='usage'&&r.evidenceBasis!=='official_subscription_account_metadata') add(s,r,'estimated_usage','historical_execution',r.estimated_tokens,'SUPPORTED',['estimated_tokens','at'])
      else if(s.section.startsWith('external_')) add(s,r,'source_statement','historical_statement',r.title||r.content,'SUPPORTED',['title','content','originalDate'])
    }
    if(s.section==='work') for(const w of s.workflows||[]) {
      add(s,{sourceId:'workflow:'+w.role,...w},'workflow_occupancy','current_runtime',w.state,'CONFIRMED',['state','at'])
      assertions.at(-1).references.forEach(ref=>{ref.collection='workflows';ref.recordId=w.role})
      add(s,{sourceId:'workflow:'+w.role,...w},'configured_model','current_configuration',w.model,'CONFIRMED',['model','modelBasis'])
      assertions.at(-1).references.forEach(ref=>{ref.collection='workflows';ref.recordId=w.role})
    }
  }
  coverage.push(...require('./generalRouter').requiredSourceCoverage(report))
  for(const job of report.workPurpose?.jobs||[]) {
    if(!['memory_index','memory_consolidation'].includes(job.role))continue
    const d=job.progress?.diagnostics,refs=job.references||[]
    const put=(facet,value,state,time='current_record_snapshot')=>assertions.push({id:'e'+(assertions.length+1),subject:'memory_diagnostics:'+job.role,
      sourceId:refs[0]?.sourceId||null,recordId:'backend:'+job.role,facet,temporalScope:time,state,
      value:['UNKNOWN','UNAVAILABLE','CONTRADICTED'].includes(state)?null:value,observedAt:job.progress?.at||null,retrievedAt:job.progress?.at||null,references:refs})
    const state=job.progressState==='CONFIRMED'?(d?'CONFIRMED':'UNKNOWN'):job.progressState
    put('memory_recorded_failure_count',d?.failed??null,state)
    put('memory_recorded_error_categories',d?.reasons??null,state==='CONFIRMED'?'SUPPORTED':state)
    put('memory_recorded_retry_state',d?.retry??null,state==='CONFIRMED'?'SUPPORTED':state)
    put('memory_retained_last_completion',d?.lastRecordedSuccessAt??null,state==='CONFIRMED'&&d.lastRecordedSuccessAt?'CONFIRMED':state==='CONFIRMED'?'UNKNOWN':state,'retained_historical_record')
    put('memory_failure_root_cause',null,'UNKNOWN','historical_failure_causation')
  }
  for(const job of report.memoryFailureCorrelation?.jobs||[])for(const c of job.cases){
    for(const [facet,state,value]of [
      ['memory_failure_checkpoint',c.checkpointState,c.checkpoint],
      ['memory_failure_validation',c.validationState,c.validationCode],
      ['memory_failure_provider_observation',c.providerState,{failures:c.providerFailures,results:c.providerResults}],
      ['memory_failure_execution_link',c.linkState,c.linkState==='CONFIRMED'?'exact_host_work_trace':null],
      ['memory_same_record_later_completion',c.laterCompletionState,c.laterCompletion]
    ])assertions.push({id:'e'+(assertions.length+1),subject:'memory_attempt:'+job.role+':'+c.recordId,sourceId:c.references[0]?.sourceId||null,recordId:c.recordId,
      facet,temporalScope:facet==='memory_same_record_later_completion'?'retained_later_completion':'historical_failure',state,
      value:['UNKNOWN','UNAVAILABLE','CONTRADICTED'].includes(state)?null:value,observedAt:facet==='memory_same_record_later_completion'?c.laterCompletion?.at||null:c.failedAt,
      retrievedAt:job.state==='CONFIRMED'?report.workPurpose.jobs.find(j=>j.role===job.role)?.progress?.at||null:null,references:c.references})
  }
  for(const c of report.executionUsage?.chains||[])for(const [facet,state]of Object.entries({execution:c.executionState,model:c.modelState,usage:c.usageState,correlation:c.correlationState,billing:c.billingState})){
    const refs=c.references.flatMap(ref=>Object.entries(ref.fields).map(([field,value])=>({sourceId:ref.sourceId,recordId:ref.recordId,field,value})))
    const values={execution:{attempts:c.observedAttempts??null,dispatches:c.observedDispatches??null,results:c.successfulResults??null,startedTurns:c.observedStartedTurns??null,completedTurns:c.observedCompletedTurns??null,recordedState:c.recordedState??null},model:c.references.filter(r=>r.fields.modelResultObserved===true&&r.fields.state==='succeeded').map(r=>r.fields.actualModel).filter(Boolean),usage:{models:c.usageModels,cumulativeUsage:c.cumulativeUsage??null,complete:c.usageComplete===true},correlation:c.identity}
    const retrieved=(report.sections||[]).filter(s=>c.references.some(r=>r.sourceId===s.sourceId)).map(s=>date(s.retrievedAt)).filter(Boolean).sort()[0]||null
    assertions.push({id:'e'+(assertions.length+1),subject:'execution_usage:'+c.kind+':'+(c.jobId||c.references[0]?.recordId),sourceId:refs[0]?.sourceId||null,recordId:c.jobId||c.references[0]?.recordId,
      facet:'execution_usage_'+facet,temporalScope:'historical_execution',state,value:['UNKNOWN','UNAVAILABLE','CONTRADICTED'].includes(state)?null:values[facet]??null,observedAt:date(c.finishedAt||c.usageAt||c.startedAt),retrievedAt:retrieved,references:refs})
  }
  for(const gap of report.executionUsage?.gaps||[])assertions.push({id:'e'+(assertions.length+1),subject:'execution_usage:'+gap.recordId,sourceId:gap.references[0]?.sourceId||null,recordId:gap.recordId,facet:'execution_usage_identity',temporalScope:'historical_execution',state:gap.state,value:null,observedAt:null,retrievedAt:null,references:gap.references.flatMap(ref=>Object.entries(ref.fields).map(([field,value])=>({sourceId:ref.sourceId,recordId:ref.recordId,field,value})))})
  const subscription=report.executionUsage?.subscriptionEvidence
  if(subscription&&subscription.state!=='UNKNOWN'){
    const refs=subscription.references||[],receipt=subscription.receipt
    const put=(subject,facet,value,state,at)=>assertions.push({id:'e'+(assertions.length+1),subject:'subscription:'+subject,sourceId:refs[0]?.sourceId||null,recordId:refs[0]?.recordId||null,facet,temporalScope:'account_snapshot',state,value:['UNKNOWN','UNAVAILABLE','CONTRADICTED'].includes(state)?null:value,observedAt:at||null,retrievedAt:at||null,references:refs})
    if(subscription.state==='CONTRADICTED')put('gpt','account_snapshot',null,'CONTRADICTED',null)
    else if(!receipt)put('gpt','account_snapshot',null,'UNAVAILABLE',null)
    for(const b of receipt?.quota?.buckets||[])for(const [kind,w]of [['primary',b.primary],['secondary',b.secondary]])if(w)for(const [key,facet]of [['usedPercent','quota_used_percent'],['remainingPercent','quota_remaining_percent'],['resetsAt','quota_reset_at']])put('gpt:'+b.id+':'+kind,facet,w[key],w[key]===null?'UNKNOWN':'CONFIRMED',receipt.quota.retrievedAt)
    for(const b of receipt?.quota?.buckets||[])put('gpt:'+b.id,'credit_balance',b.credits?.balance??null,b.credits?.balance===null||b.credits?.balance===undefined?'UNKNOWN':'CONFIRMED',receipt.quota.retrievedAt)
    const tokens=receipt?.activity?.summary?.lifetimeTokens??null
    put('gpt','account_lifetime_tokens',tokens,tokens===null?'UNKNOWN':'CONFIRMED',receipt?.activity?.retrievedAt)
    put('claude','remaining_quota',null,'UNAVAILABLE',null)
    put('gpt','account_to_job_charge',null,'UNKNOWN',null)
  }
  const chain=report.workCorrelation?.repairChain
  if(chain?.readOnly===true)for(const stage of chain.stages){
    const sources=(report.sections||[]).filter(s=>stage.references.some(r=>r.sourceId===s.sourceId))
    const records=sources.flatMap(s=>(s.records||[]).filter(r=>stage.references.some(ref=>ref.sourceId===s.sourceId&&ref.recordId===identity(r))))
    const earliest=values=>values.map(date).filter(Boolean).sort()[0]||null
    const retrievedAt=earliest(sources.map(s=>s.retrievedAt))
    assertions.push({id:'e'+(assertions.length+1),subject:'work:'+chain.targetId,sourceId:stage.references[0]?.sourceId||null,recordId:chain.targetId,
      facet:'repair_chain_'+stage.key,temporalScope:stage.key==='current_version'||stage.key==='registered_regression'?'current_source':stage.key==='live_failure_verification'?'current_runtime':'historical_execution',
      state:stage.state,value:['UNKNOWN','UNAVAILABLE'].includes(stage.state)?null:stage.reason,observedAt:stage.key==='live_failure_verification'?earliest(records.map(r=>r.liveVerification?.at)):['current_version','registered_regression'].includes(stage.key)?retrievedAt:earliest(records.map(r=>r.at)),retrievedAt,references:stage.references})
  }
  const contradictions=[],transitions=[],byKey=new Map()
  for(const a of assertions.filter(a=>a.state==='CONTRADICTED'))contradictions.push({subject:a.subject,facet:a.facet,observations:[a.id],reason:'derived_chain_conflict'})
  for(const a of assertions) {
    if(['UNKNOWN','UNAVAILABLE'].includes(a.state)) continue
    const key=a.subject+':'+a.facet+':'+a.temporalScope
    const previous=byKey.get(key)||[]
    for(const p of previous) {
      if(JSON.stringify(p.value)===JSON.stringify(a.value))continue
      if(p.observedAt&&a.observedAt&&p.observedAt!==a.observedAt) transitions.push({subject:a.subject,facet:a.facet,observations:[p.id,a.id]})
      else {p.state='CONTRADICTED';a.state='CONTRADICTED';contradictions.push({subject:a.subject,facet:a.facet,observations:[p.id,a.id]})}
    }
    previous.push(a);byKey.set(key,previous)
  }
  const counts=Object.fromEntries(STATES.map(s=>[s,assertions.filter(a=>a.state===s).length]))
  return {version:1,states:STATES,assertions:assertions.slice(0,200),omitted:Math.max(0,assertions.length-200),counts,coverage,contradictions,transitions,
    scope:'assertion_level_receipt_evidence_not_billing_or_global_truth',currentRuntimeMaxAgeMs:300000}
}
function currentActivity(report,sourceId,recordId,legacyValue) {
  if(!report?.evidenceModel)return legacyValue
  const a=currentFact(report,sourceId,recordId,'running')||currentFact(report,sourceId,recordId,'workflow_occupancy')
  return a?.state==='CONFIRMED'?a.value:'unknown'
}
function currentFact(report,sourceId,recordId,facet){
 const rows=(report?.evidenceModel?.assertions||[]).filter(a=>a.sourceId===sourceId&&a.recordId===recordId&&a.facet===facet)
 const latest=rows.sort((a,b)=>String(b.observedAt||'').localeCompare(String(a.observedAt||'')))[0]
 if(!latest)return null
 const same=rows.filter(a=>a.observedAt===latest.observedAt)
 return same.some(a=>a.state!=='CONFIRMED'||JSON.stringify(a.value)!==JSON.stringify(latest.value))?{state:same.some(a=>a.state==='UNAVAILABLE')?'UNAVAILABLE':'UNKNOWN',value:null}:latest
}
module.exports={STATES,buildEvidenceState,currentActivity,currentFact}
