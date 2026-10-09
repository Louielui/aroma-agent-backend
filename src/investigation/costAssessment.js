'use strict'
// Projection of existing authorized receipts. No source reads, inference, prices,
// quota deltas, schedule-to-call guesses or management actions.
const {currentFact}=require('./evidenceState')
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null
const fact=(state,value=null)=>({state,value:['UNKNOWN','UNAVAILABLE','CONTRADICTED'].includes(state)?null:value})
function buildCostAssessment(report){
 if(report?.readOnly!==true||report.focus!=='cost'||!report.executionUsage)return null
 const e=report.executionUsage,sections=report.sections||[]
 const linkedWorkers=e.chains.filter(c=>c.kind==='worker_work'&&c.recordId)
 const chains=e.chains.filter(c=>c.kind!=='worker_record'||!linkedWorkers.some(w=>w.recordId===c.jobId&&w.workKind===c.references.find(r=>r.fields.kind)?.fields.kind))
 const jobs=chains.map(c=>({
  kind:c.kind,workKind:c.workKind||null,id:c.jobId||c.references[0]?.recordId||null,
  recordId:c.recordId||null,identity:c.identity,
  identityState:['exact_host_worker_and_run_id','exact_host_work_and_run_id','exact_host_request_id','exact_session_id','exact_host_work_record'].includes(c.identity)?'CONFIRMED':'UNKNOWN',
  execution:fact(c.executionState,{attempts:c.observedAttempts??null,observedRuns:c.observedRuns??null,observedDispatches:c.observedDispatches??null,successfulResults:c.successfulResults??null,startedTurns:c.observedStartedTurns??null,completedTurns:c.observedCompletedTurns??null}),
  models:fact(c.modelState,[...new Set(c.references.filter(r=>r.fields.state==='succeeded'&&r.fields.modelResultObserved===true&&/^[a-z0-9_.:-]{1,160}$/i.test(r.fields.actualModel||'')).map(r=>r.fields.actualModel))]),
  usage:{state:c.usageState,models:c.usageModels,cumulative:c.cumulativeUsage||null,unknownCalls:c.unknownUsageCalls??null,completeObservedCalls:c.usageComplete===true,completeJob:false,scope:c.usageScope||'observed_invocation_receipts_not_complete_job'},
  currentlyRunning:fact('UNKNOWN'),accountQuotaConsumption:fact('UNKNOWN'),billing:{state:c.billingState,amount:null,currency:null},
  executionToUsage:fact(c.correlationState,c.identity),startedAt:date(c.startedAt),finishedAt:date(c.finishedAt),
  retrievedAt:sections.filter(s=>c.references.some(r=>r.sourceId===s.sourceId)).map(s=>date(s.retrievedAt)).filter(Boolean).sort()[0]||null,
  references:c.references
 })).sort((a,b)=>String(b.startedAt||b.finishedAt||'').localeCompare(String(a.startedAt||a.finishedAt||''))||String(a.id).localeCompare(String(b.id)))
 const seen=new Set(),activities=[]
 for(const s of sections)for(const r of s.records||[]){
  if(!['configuration','schedules'].includes(s.section)||!(r.evidenceBasis==='live_process_snapshot'||r.executionKind==='deterministic_food_recall_check')||!r.sourceId)continue
  const key=s.sourceId+':'+r.sourceId;if(seen.has(key))continue;seen.add(key)
  const read=facet=>{const a=currentFact(report,s.sourceId,r.sourceId,facet);return{...fact(a?.state||'UNKNOWN',a?.value),observedAt:a?.observedAt||null}}
  activities.push({id:r.sourceId,role:r.role||null,configuredModel:read('configured_model'),enabled:read('enabled'),running:read('running'),retrievedAt:date(s.retrievedAt),
   references:[{sourceId:s.sourceId,recordId:r.sourceId,fields:Object.fromEntries(['role','model','configuredModel','enabled','state','currentRunningState','at','modelObservedAt','evidenceBasis','observationState','executionKind'].filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]))}]})
 }
 // An activity snapshot belongs to a component, not an individual historical run.
 // Keep it separate even when role, configured model or timestamps look similar.
 const sub=e.subscriptionEvidence,receipt=sub?.receipt
 const source=(key,state,refs=[])=>({key,state,references:refs})
 const sources=[
  ...e.inventory.map(i=>({...source(i.source,i.state,i.references),observedRecords:i.observedRecords,complete:false,receipts:i.receipts})),
  source('codex_quota',sub?.state==='CONTRADICTED'?'CONTRADICTED':receipt?.quota?.buckets?.some(b=>b.primary||b.secondary)?'SUPPORTED':sub?.state==='UNKNOWN'?'UNKNOWN':'UNAVAILABLE',sub?.references||[]),
  source('codex_account_usage',sub?.state==='CONTRADICTED'?'CONTRADICTED':receipt?.activity?.state==='partial'?'SUPPORTED':sub?.state==='UNKNOWN'?'UNKNOWN':'UNAVAILABLE',sub?.references||[]),
  source('claude_quota','UNAVAILABLE'),
  source('billing',e.billingState,sections.filter(s=>s.section==='billing').map(s=>({sourceId:s.sourceId,recordId:null,fields:{state:s.state}})))
 ]
 const recommendations=[]
 if(jobs.some(j=>j.identityState==='UNKNOWN')||e.conflictingReceipts)recommendations.push({kind:'resolve_execution_identity',readOnly:true})
 if(jobs.some(j=>j.usage.state!=='CONFIRMED'||!j.usage.completeObservedCalls))recommendations.push({kind:'obtain_missing_usage_receipts',readOnly:true})
 if(sources.find(s=>s.key==='codex_quota').state!=='SUPPORTED')recommendations.push({kind:'read_available_account_quota',readOnly:true})
 recommendations.push({kind:'inspect_claude_quota_separately',readOnly:true},{kind:'obtain_identity_linked_billing_evidence',readOnly:true})
 return{version:1,readOnly:true,inventoryComplete:false,jobs,activities,sources,recommendations,
  summary:{sampledChains:jobs.length,exactJobs:jobs.filter(j=>j.identityState==='CONFIRMED').length,jobsWithExecutionEvidence:jobs.filter(j=>j.execution.state==='CONFIRMED').length,
   jobsWithUsageEvidence:jobs.filter(j=>['CONFIRMED','SUPPORTED'].includes(j.usage.state)).length,jobsWithIncompleteUsage:jobs.filter(j=>j.usage.state!=='CONFIRMED'||!j.usage.completeObservedCalls).length,
   unlinkedCalls:jobs.filter(j=>j.identityState==='UNKNOWN').length,conflictingReceipts:e.conflictingReceipts,confirmedCharges:0},
  accountToJobLink:'UNKNOWN',chargeAttribution:'UNKNOWN',scope:'bounded_work_receipts_and_separate_account_snapshots_no_total_or_charge_inference'}
}
module.exports={buildCostAssessment}
