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
    const liveAge=date(s.retrievedAt)&&date(r?.at)?Date.parse(s.retrievedAt)-Date.parse(r.at):null
    const fresh=time!=='current_runtime'||(liveAge!==null&&liveAge>=-5000&&liveAge<=300000)
    const state=!readable(s)?'UNAVAILABLE':!known(value)||!fresh?'UNKNOWN':grade
    assertions.push({id:'e'+(assertions.length+1),subject:s.section+':'+(id||'source'),sourceId:s.sourceId||null,recordId:id,
      facet,temporalScope:time,state,value:state==='UNKNOWN'||state==='UNAVAILABLE'?null:value,observedAt,retrievedAt:date(s.retrievedAt),references})
  }
  for(const s of report.sections||[]) {
    coverage.push({section:s.section,sourceId:s.sourceId,state:readable(s)?(s.records?.length?'SUPPORTED':'UNKNOWN'):'UNAVAILABLE',scope:s.coverage||'bounded_source_receipt',retrievedAt:date(s.retrievedAt)})
    if(!readable(s)){add(s,null,'source_access','unknown',null);continue}
    for(const r of s.records||[]) {
      if(!identity(r))continue
      if(['configuration','schedules'].includes(s.section)) {
        add(s,r,'configured_model','current_configuration',r.usesModel===false?'no_model':r.model,'CONFIRMED',['model','usesModel','modelBasis'])
        let enabled=typeof r.enabled==='boolean'?r.enabled:typeof r.scheduled==='boolean'?r.scheduled:r.state==='ACTIVE'?true:r.state==='PAUSED'||r.state==='NOT_INSTALLED'?false:null
        add(s,r,'enabled','current_enablement',enabled,'CONFIRMED',['enabled','scheduled','state'])
        const witness=r.evidenceBasis==='live_process_snapshot'||r.executionKind==='deterministic_food_recall_check'
        add(s,r,'running','current_runtime',witness?r.currentRunningState:null,'CONFIRMED',['currentRunningState','evidenceBasis','executionKind','at'])
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
      else if(s.section==='usage') add(s,r,'estimated_usage','historical_execution',r.estimated_tokens,'SUPPORTED',['estimated_tokens','at'])
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
  const a=report.evidenceModel.assertions.find(a=>a.sourceId===sourceId&&a.recordId===recordId&&['running','workflow_occupancy'].includes(a.facet))
  return a?.state==='CONFIRMED'?a.value:'unknown'
}
module.exports={STATES,buildEvidenceState,currentActivity}
