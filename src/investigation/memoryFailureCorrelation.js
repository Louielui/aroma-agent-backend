'use strict'
// Host identities only. Adjacent times, a configured model, and generic errors
// cannot identify a provider invocation or establish a deeper failure cause.
const {validWorkTrace}=require('./workTrace')
const {projectRecord}=require('./invocations')
const same=(a,b)=>validWorkTrace(a)&&validWorkTrace(b)&&Object.keys(a).every(k=>a[k]===b[k])
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))
function correlateMemoryFailures(report){
 const sections=(report.sections||[]).filter(s=>s.section==='execution')
 const readable=sections.filter(s=>['ok','partial'].includes(s.state)&&!['unavailable','unconnected','missing'].includes(s.coverage?.invocations))
 const rows=[]
 for(const s of readable)for(const raw of s.records||[]){
  if(raw.evidenceBasis!=='owner_bridge_invocation_ledger'||raw.linkBasis!=='host_work_identity')continue
  try{const r=projectRecord(raw);if(r.role==='memory_completion'&&r.workTrace)rows.push({s,r})}catch(_){/* Invalid receipts never become evidence. */}
 }
 const jobs=[]
 for(const job of report.workPurpose?.jobs||[]){
  if(!['memory_index','memory_consolidation'].includes(job.role))continue
  const p=job.progress?.failureEvidence
  const result={role:job.role,state:job.progressState==='CONFIRMED'?(p?'CONFIRMED':'UNKNOWN'):job.progressState,
   currentFailed:p?.currentFailed??null,tracedCurrentFailures:p?.tracedCurrentFailures??null,untracedCurrentFailures:p?.untracedCurrentFailures??null,
   omitted:p?.omitted??null,historyComplete:false,cases:[],currentDependencyState:'UNKNOWN',rootCauseState:'UNKNOWN'}
  for(const sample of p?.samples||[]){
   const f=sample.lastFailure,trace=f.workTrace,near=trace?rows.filter(({r})=>r.workTrace.runId===trace.runId):[]
   const exact=near.filter(({r})=>same(r.workTrace,trace)),ids=new Map();let conflict=near.some(({r})=>!same(r.workTrace,trace))
   for(const item of exact){
    const prior=ids.get(item.r.invocationId)
    if(prior&&JSON.stringify(prior.r)!==JSON.stringify(item.r))conflict=true
    else ids.set(item.r.invocationId,item)
   }
   const matched=[...ids.values()],usable=matched.filter(({r})=>date(r.finishedAt)&&Date.parse(r.startedAt)<=Date.parse(r.finishedAt)&&Date.parse(r.finishedAt)<=Date.parse(f.at)&&Date.parse(f.at)<=Date.parse(p.at))
   for(const {r}of matched)if(r.workOutcome&&(r.workOutcome.state!==(job.role==='memory_index'?'unconfirmed':'failed')||!date(r.workOutcome.at)||Date.parse(r.workOutcome.at)<Date.parse(r.finishedAt)||Date.parse(r.workOutcome.at)>Date.parse(p.at)))conflict=true
   const providerFailures=usable.filter(({r})=>r.state==='failed'&&r.failureCode).map(({r})=>({invocationId:r.invocationId,code:r.failureCode,at:r.finishedAt,requestedModel:r.model}))
   const providerResults=usable.filter(({r})=>r.state==='succeeded'&&r.modelResultObserved&&r.actualModel).map(({r})=>({invocationId:r.invocationId,actualModel:r.actualModel,at:r.finishedAt}))
   const references=[{sourceId:job.references[0]?.sourceId||null,recordId:sample.recordId,fields:{lastFailure:f,currentState:sample.currentState,currentAt:sample.currentAt,laterCompletion:sample.laterCompletion}}]
   references.push(...matched.map(({s,r})=>({sourceId:s.sourceId,recordId:r.sourceId,fields:{invocationId:r.invocationId,workTrace:r.workTrace,state:r.state,failureCode:r.failureCode,startedAt:r.startedAt,finishedAt:r.finishedAt,actualModel:r.actualModel,workOutcome:r.workOutcome}})))
   const providerState=conflict?'CONTRADICTED':!trace?'UNKNOWN':!readable.length?'UNAVAILABLE':providerFailures.length||providerResults.length?'CONFIRMED':'UNKNOWN'
   result.cases.push({recordId:sample.recordId,failedAt:f.at,currentAt:sample.currentAt,currentState:sample.currentState,
    checkpoint:f.checkpoint,checkpointState:f.checkpoint?'CONFIRMED':'UNKNOWN',validationCode:f.validationCode,validationState:f.validationCode?'CONFIRMED':'UNKNOWN',
    providerState,providerFailures:providerState==='CONFIRMED'?providerFailures:[],providerResults:providerState==='CONFIRMED'?providerResults:[],
    linkState:conflict?'CONTRADICTED':usable.length?'CONFIRMED':trace&&!readable.length?'UNAVAILABLE':'UNKNOWN',
    gap:conflict?'conflicting_receipts':!trace?'missing_host_identity':!readable.length?'execution_source_unavailable':!usable.length?'not_found_in_bounded_ledger':null,
    laterCompletion:sample.laterCompletion,laterCompletionState:sample.laterCompletion?'CONFIRMED':'UNKNOWN',rootCauseState:'UNKNOWN',references})
  }
  jobs.push(result);job.failureCorrelation=result
 }
 return jobs.length?{version:1,readOnly:true,executionAllowed:false,historyComplete:false,billingConfirmed:false,jobs}:null
}
function renderFailureCorrelation(value,locale){
 const {t}=require('../i18n/t')
 if(!value||value.state!=='CONFIRMED')return t('investigation.memoryTraceMissing',{},locale)
 const lines=[t('investigation.memoryTraceCoverage',{failed:value.currentFailed,traced:value.tracedCurrentFailures,untraced:value.untracedCurrentFailures},locale)]
 const checkpoints={
  index_lookup:()=>t('investigation.memoryCheckpointLookup',{},locale),
  index_retain:()=>t('investigation.memoryCheckpointRetain',{},locale),
  index_result_validation:()=>t('investigation.memoryCheckpointIndexValidation',{},locale),
  consolidation_inference:()=>t('investigation.memoryCheckpointInference',{},locale),
  consolidation_validation:()=>t('investigation.memoryCheckpointValidation',{},locale),
  consolidation_candidates:()=>t('investigation.memoryCheckpointCandidates',{},locale),
  consolidation_source_verification:()=>t('investigation.memoryCheckpointSourceVerification',{},locale),
  consolidation_commit:()=>t('investigation.memoryCheckpointCommit',{},locale)
 }
 const checkpointCounts=new Map(),providerCounts=new Map(),validationCounts=new Map()
 for(const c of value.cases){
  if(c.checkpointState==='CONFIRMED')checkpointCounts.set(c.checkpoint,(checkpointCounts.get(c.checkpoint)||0)+1)
  if(c.validationState==='CONFIRMED')validationCounts.set(c.validationCode,(validationCounts.get(c.validationCode)||0)+1)
  for(const f of c.providerFailures)providerCounts.set(f.code,(providerCounts.get(f.code)||0)+1)
 }
 for(const [key,count]of checkpointCounts)lines.push(t('investigation.memoryTraceCheckpoint',{stage:checkpoints[key](),count},locale))
 const validationLabels={
  invalid_result_shape:()=>t('investigation.memoryValidationResultShape',{},locale),
  invalid_candidate_shape:()=>t('investigation.memoryValidationCandidateShape',{},locale),
  invalid_candidate_field:()=>t('investigation.memoryValidationField',{},locale),
  unsupported_quote:()=>t('investigation.memoryValidationQuote',{},locale),
  invalid_attribution:()=>t('investigation.memoryValidationAttribution',{},locale),
  invalid_task_state:()=>t('investigation.memoryValidationTask',{},locale),
  invalid_supersession:()=>t('investigation.memoryValidationSupersession',{},locale)
 }
 for(const [key,count]of validationCounts)lines.push(t('investigation.memoryTraceValidation',{reason:validationLabels[key](),count},locale))
 // These are failed provider turns, not a claim that the provider caused all
 // failed records, or that the same condition still exists now.
 const labels={
  subscription_login_required:()=>t('investigation.memoryProviderLogin',{},locale),
  subscription_limit_reached:()=>t('investigation.memoryProviderLimit',{},locale),
  subscription_model_unavailable:()=>t('investigation.memoryProviderModel',{},locale),
  subscription_invalid_output:()=>t('investigation.memoryProviderOutput',{},locale)
 }
 for(const [code,count]of providerCounts)lines.push(t('investigation.memoryTraceProvider',{reason:labels[code]?labels[code]():t('investigation.memoryProviderUnavailable',{},locale),count},locale))
 const results=value.cases.reduce((n,c)=>n+c.providerResults.length,0)
 if(results)lines.push(t('investigation.memoryTraceResults',{count:results},locale))
 const gaps={
  missing_host_identity:count=>t('investigation.memoryTraceIdentityGap',{count},locale),
  execution_source_unavailable:count=>t('investigation.memoryTraceSourceGap',{count},locale),
  conflicting_receipts:count=>t('investigation.memoryTraceConflict',{count},locale),
  not_found_in_bounded_ledger:count=>t('investigation.memoryTraceLedgerGap',{count},locale)
 }
 for(const [key,label]of Object.entries(gaps)){const count=value.cases.filter(c=>c.gap===key).length;if(count)lines.push(label(count))}
 const recovered=value.cases.filter(c=>c.laterCompletionState==='CONFIRMED').length
 lines.push(t('investigation.memoryTraceSampleScope',{omitted:value.omitted},locale))
 lines.push(t('investigation.memoryTraceRecovery',{count:recovered},locale))
 lines.push(t('investigation.memoryTraceBoundary',{},locale))
 return lines.join('\n')
}
module.exports={correlateMemoryFailures,renderFailureCorrelation}
