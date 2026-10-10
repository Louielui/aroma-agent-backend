'use strict'
// Closed component registry and canonical counters; no inferred Owner goals,
// mailbox totals, scheduler identities, model calls or management authority.
const registry=Object.freeze({
 mail_analysis:{unit:'captured_thread',scope:'captured_mail_threads',fields:['total','ready','pending','failed']},
 memory_index:{unit:'memory_record',scope:'active_general_memory_records',fields:['total','saved','raw_only','pending','unconfirmed','source_only','other']},
 memory_consolidation:{unit:'memory_record',scope:'eligible_general_memory_records',fields:['total','pending','running','done','empty','failed','other','candidates']},
 memory_outbox:{unit:'queued_capture',scope:'local_capture_outbox',fields:['pending']}
})
const integer=v=>Number.isSafeInteger(v)&&v>=0
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))
function projectProgress(role,value){
 const rule=registry[role]
 if(!rule||value?.version!==1||value.unit!==rule.unit||value.scope!==rule.scope||!date(value.at)||!rule.fields.every(k=>integer(value.counts?.[k])))return null
 const c=Object.fromEntries(rule.fields.map(k=>[k,value.counts[k]]))
 if(role==='mail_analysis'&&(c.ready+c.pending!==c.total||c.failed>c.pending))return null
 if(['memory_index','memory_consolidation'].includes(role)&&rule.fields.filter(k=>!['total','candidates'].includes(k)).reduce((n,k)=>n+c[k],0)!==c.total)return null
 return {version:1,at:value.at,unit:rule.unit,scope:rule.scope,counts:c,...(role==='mail_analysis'?{syncHasMore:typeof value.syncHasMore==='boolean'?value.syncHasMore:null}:{}),
  ...(['memory_index','memory_consolidation'].includes(role)?{diagnostics:require('./memoryFailures').projectDiagnostics(role,value.diagnostics,c.unconfirmed??c.failed,value.at),
    failureEvidence:require('./memoryAttemptEvidence').projectAttemptEvidence(role,value.failureEvidence,c.unconfirmed??c.failed,value.at)}:{})}
}
function buildWorkPurpose(report,{now=Date.now()}={}){
 const sections=(report.sections||[]).filter(s=>s.section==='configuration'&&['ok','partial'].includes(s.state))
 if(!sections.length)return null
 const jobs=[]
 for(const role of Object.keys(registry)){
  const rows=sections.flatMap(s=>(s.records||[]).filter(r=>r.sourceId==='backend:'+role&&r.role===role&&r.evidenceBasis==='live_process_snapshot').map(r=>({s,r})))
  if(!rows.length||!rows.some(({r})=>Object.hasOwn(r,'progressState')))continue
  // Compare only snapshots for the same observation time. Older queue values
  // changing over time are not contradictory current-state observations.
  rows.sort((a,b)=>(Date.parse(b.r.at)||0)-(Date.parse(a.r.at)||0))
  const {r}=rows[0],p=projectProgress(role,r.progress)
  const conflict=new Set(rows.filter(x=>x.r.at===r.at).map(({r})=>JSON.stringify(projectProgress(role,r.progress)))).size>1
  const fresh=p&&now-Date.parse(p.at)>=-5000&&now-Date.parse(p.at)<=300000
  const state=conflict?'CONTRADICTED':r.progressState==='unavailable'||r.progressState==='unconnected'?'UNAVAILABLE':fresh?'CONFIRMED':'UNKNOWN'
  const references=rows.map(({s,r})=>({sourceId:s.sourceId,recordId:r.sourceId,fields:{role:r.role,at:r.at,progress:projectProgress(role,r.progress)}}))
  // A host outcome is a sampled historical checkpoint, never a queue total.
  const runs=new Map(),conflicts=new Set()
  for(const chain of report.executionUsage?.chains||[]){
   if(chain.kind!=='background_work'||chain.workKind!==role||chain.identity!=='exact_host_work_and_run_id')continue
   for(const run of chain.runs||[]){
    if(run.outcomeState==='CONTRADICTED'){conflicts.add(run.runId);continue}
    if(run.outcomeState!=='SUPPORTED'||run.hostOutcome?.basis!=='host_checkpoint_report')continue
    if(runs.has(run.runId)&&runs.get(run.runId).state!==run.hostOutcome.state)conflicts.add(run.runId)
    runs.set(run.runId,{state:run.hostOutcome.state,at:run.hostOutcome.at})
   }
   references.push(...chain.references.map(ref=>({sourceId:ref.sourceId,recordId:ref.recordId,fields:{workTrace:ref.fields?.workTrace,workOutcome:ref.fields?.workOutcome}})))
  }
  for(const id of conflicts)runs.delete(id)
  jobs.push({role,purposeState:'SUPPORTED',purposeBasis:'registered_component_definition',ownerRequestState:'UNKNOWN',
   progressState:state,progress:state==='CONFIRMED'?p:null,observedHostOutcomes:Object.fromEntries([...new Set([...runs.values()].map(r=>r.state))].map(state=>[state,[...runs.values()].filter(r=>r.state===state).length])),
   outcomeScope:'sampled_historical_runs_not_unique_records_or_current_queue',outcomeConflict:conflicts.size>0,
   recommendation:state!=='CONFIRMED'?'verify_progress_source':(p.counts.failed||p.counts.unconfirmed||p.counts.other)?'inspect_unresolved_records':(p.counts.pending||p.counts.running)?'observe_existing_processing':'no_observed_pending',references})
 }
 return jobs.length?{version:1,readOnly:true,executionAllowed:false,inventoryComplete:false,jobs,ownerPurposeLink:'not_connected',billingConfirmed:false}:null
}
function renderWorkPurpose(value,{message='',failuresOnly=false}={}){
 if(!value?.readOnly||value.executionAllowed!==false||!value.jobs?.length)return null
 const {t}=require('../i18n/t'),locale=/[\u3400-\u9fff]/.test(message)?'zh':'en'
 const purposes={
  mail_analysis:()=>t('investigation.progressPurposeMailAnalysis',{},locale),
  memory_index:()=>t('investigation.progressPurposeMemoryIndex',{},locale),
  memory_consolidation:()=>t('investigation.progressPurposeMemoryConsolidation',{},locale),
  memory_outbox:()=>t('investigation.progressPurposeMemoryOutbox',{},locale)
 }
 const counts={
  mail_analysis:c=>t('investigation.progressCountsMailAnalysis',c,locale),
  memory_index:c=>t('investigation.progressCountsMemoryIndex',{...c,rawOnly:c.raw_only,sourceOnly:c.source_only},locale),
  memory_consolidation:c=>t('investigation.progressCountsMemoryConsolidation',c,locale),
  memory_outbox:c=>t('investigation.progressCountsMemoryOutbox',c,locale)
 }
 const next={
  verify_progress_source:()=>t('investigation.progressNextVerifySource',{},locale),
  inspect_unresolved_records:()=>t('investigation.progressNextInspectUnresolved',{},locale),
  observe_existing_processing:()=>t('investigation.progressNextObserveProcessing',{},locale),
  no_observed_pending:()=>t('investigation.progressNextNoPending',{},locale)
 }
 const lines=[failuresOnly?t('investigation.memoryFailureReportTitle',{},locale):t('investigation.progressTitle',{},locale)],references=[]
 for(const job of value.jobs){
  if(failuresOnly&&!['memory_index','memory_consolidation'].includes(job.role))continue
  lines.push(purposes[job.role]())
  if(job.progressState==='CONFIRMED'){
   lines.push(counts[job.role](job.progress.counts))
   if(job.role==='mail_analysis')lines.push(job.progress.syncHasMore===true?t('investigation.progressMoreMail',{},locale):t('investigation.progressMailScope',{},locale))
   lines.push(t('investigation.progressAsOf',{at:job.progress.at},locale))
   if(['memory_index','memory_consolidation'].includes(job.role)){
    lines.push(require('./memoryFailures').renderDiagnostics(job.role,job.progress.diagnostics,locale))
    lines.push(require('./memoryFailureCorrelation').renderFailureCorrelation(job.failureCorrelation,locale))
   }
  }else lines.push(t('investigation.progressGap',{state:job.progressState},locale))
  if(!failuresOnly)lines.push(next[job.recommendation]())
  references.push(...job.references)
  for(const c of job.failureCorrelation?.cases||[])references.push(...c.references)
 }
 if(!failuresOnly)lines.push(t('investigation.progressBoundary',{},locale))
 return {text:lines.join('\n\n'),references,modelProseUsed:false}
}
module.exports={projectProgress,buildWorkPurpose,renderWorkPurpose}
