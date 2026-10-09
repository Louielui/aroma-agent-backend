'use strict'
// Registered receipt metadata only. No reads, writes, inferred scheduler links,
// provider prices or account totals. Each counter keeps its original scope.
const {projectUsage}=require('./invocations')
const {UUID}=require('./invocationContext')
const {validWorkTrace}=require('./workTrace')
const {validWorkerTrace,STATES}=require('./workerInvocation')
const readable=s=>['ok','partial'].includes(s?.state)
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null
const label=v=>typeof v==='string'&&/^[a-z0-9_.:-]{1,160}$/i.test(v)?v:null
const number=v=>Number.isSafeInteger(v)&&v>=0?v:null
const canonical=v=>JSON.stringify(v,(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)
const reference=(s,r,fields)=>({sourceId:s.sourceId,recordId:r.sourceId,fields:Object.fromEntries(fields.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]))})
const CALL_FIELDS=['workerTrace','workerOutcome','workerPhase','candidateAttempt','dispatchBasis','failureCode','invocationId','requestId','workTrace','workOutcome','linkBasis','role','phase','state','startedAt','dispatchedAt','finishedAt','actualModel','modelResultObserved','billingRoute','usage','usageByModel','usageBasis']
const SESSION_FIELDS=['sessionId','lastStartedAt','lastCompletedAt','usage','usageAt','usageBasis','startedTurns','completedTurns','turnIdentityComplete','completeFile']
function buildExecutionUsage(report){
 const sections=report.sections||[],execution=sections.filter(s=>s.section==='execution'&&readable(s)),work=sections.filter(s=>s.section==='work'&&readable(s))
 const billing=sections.filter(s=>s.section==='billing'),billingState=billing.some(readable)?'UNKNOWN':'UNAVAILABLE'
 const chains=[],gaps=[],calls=new Map(),sessions=new Map();let duplicateReceipts=0,conflictingReceipts=0
 for(const s of execution)for(const r of s.records||[]){
  if(!label(r.sourceId))continue
  if(r.evidenceBasis==='owner_bridge_invocation_ledger'&&label(r.invocationId)&&r.sourceId==='invocation:'+r.invocationId&&date(r.startedAt)){
   const rows=calls.get(r.invocationId)||[];rows.push({s,r});calls.set(r.invocationId,rows)
  }else if(r.evidenceBasis==='owner_codex_session_metadata'&&label(r.sessionId)&&r.sourceId==='codex-session:'+r.sessionId){
   const rows=sessions.get(r.sessionId)||[];rows.push({s,r});sessions.set(r.sessionId,rows)
  }
 }
 const groups=new Map(),uniqueCalls=[],runIdentities=new Map(),invalidRuns=new Set()
 for(const rows of calls.values())for(const {r} of rows)if((validWorkTrace(r.workTrace)&&r.linkBasis==='host_work_identity')||(validWorkerTrace(r.workerTrace)&&r.linkBasis==='host_worker_identity')){
  const trace=r.workerTrace||r.workTrace,signature=canonical(trace),id=trace.runId
  if(runIdentities.has(id)&&runIdentities.get(id)!==signature)invalidRuns.add(id)
  runIdentities.set(id,signature)
 }
 for(const[id,rows]of calls){
  const signatures=new Set(rows.map(({r})=>canonical(Object.fromEntries(CALL_FIELDS.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]])))))
  if(signatures.size!==1){conflictingReceipts++;gaps.push({kind:'conflicting_invocation',recordId:'invocation:'+id,state:'CONTRADICTED',references:rows.map(({s,r})=>reference(s,r,CALL_FIELDS))});continue}
  duplicateReceipts+=rows.length-1;const {s,r}=rows[0];uniqueCalls.push(r)
  if(invalidRuns.has(r.workerTrace?.runId||r.workTrace?.runId)){gaps.push({kind:'conflicting_work_run',recordId:r.sourceId,state:'CONTRADICTED',references:rows.map(({s,r})=>reference(s,r,CALL_FIELDS))});continue}
  const workerLinked=validWorkerTrace(r.workerTrace)&&r.linkBasis==='host_worker_identity'
  const workLinked=validWorkTrace(r.workTrace)&&r.linkBasis==='host_work_identity'
  const linked=UUID.test(r.requestId||'')&&r.linkBasis==='host_request_identity'
  const key=workerLinked?r.workerTrace.workId:workLinked?r.workTrace.workId:linked?'request:'+r.requestId:'lane:'+id
  if(!groups.has(key))groups.set(key,{kind:workerLinked?'worker_work':workLinked?'background_work':linked?'host_request':'bridge_lane',workKind:workerLinked?'worker/'+r.workerTrace.kind:workLinked?r.workTrace.kind:null,jobId:workerLinked?r.workerTrace.workId:workLinked?r.workTrace.workId:linked?r.requestId:null,identity:workerLinked?'exact_host_worker_and_run_id':workLinked?'exact_host_work_and_run_id':linked?'exact_host_request_id':'unlinked_lane_call',rows:[]})
  groups.get(key).rows.push({s,r})
 }
 for(const group of groups.values()){
  const models=new Map();let successfulResults=0,observedDispatches=0,unknownUsageCalls=0,usageConflict=false
  const references=[],phases=[]
  for(const{s,r}of group.rows){
   references.push(reference(s,r,CALL_FIELDS));phases.push({invocationId:r.invocationId,phase:label(r.workerPhase||r.workTrace?.phase||r.phase),candidateAttempt:r.candidateAttempt||null,state:label(r.state),runId:r.workerTrace?.runId||r.workTrace?.runId||null})
   const success=r.state==='succeeded'&&r.modelResultObserved===true&&label(r.actualModel)&&date(r.finishedAt)&&Date.parse(r.finishedAt)>=Date.parse(r.startedAt)
   if(success)successfulResults++
   if(success||(date(r.dispatchedAt)&&r.dispatchBasis!=='cli_process_started'))observedDispatches++
   if(!success||!['provider_result_model_usage','provider_last_turn_usage'].includes(r.usageBasis)){unknownUsageCalls++;continue}
   const primary=projectUsage(r.usage),byModel=Array.isArray(r.usageByModel)?r.usageByModel:[],perModel=new Map();let conflict=false
   for(const item of byModel){if(!label(item?.model))continue;const usage=projectUsage(item.usage)
    if(perModel.has(item.model)&&canonical(perModel.get(item.model))!==canonical(usage))conflict=true
    perModel.set(item.model,usage)
   }
   if(perModel.has(r.actualModel)&&primary&&canonical(perModel.get(r.actualModel))!==canonical(primary))conflict=true
   if(conflict){usageConflict=true;unknownUsageCalls++;continue}
   if(!perModel.has(r.actualModel))perModel.set(r.actualModel,primary)
   if(!primary||[...perModel.values()].some(v=>!v||number(v.inputTokens)===null||number(v.outputTokens)===null)||r.usageBasis==='provider_last_turn_usage')unknownUsageCalls++
   for(const[model,usage]of perModel){
    if(!usage)continue
    const provider=r.billingRoute==='claude-subscription'?'claude':r.billingRoute==='chatgpt-subscription'?'gpt':'unknown',key=provider+':'+model
    if(!models.has(key))models.set(key,{provider,model,receiptCount:0,bases:new Set(),counterCoverage:{},subtotal:{},receipts:[]})
    const m=models.get(key);m.receiptCount++;m.bases.add(r.usageBasis);m.receipts.push({invocationId:r.invocationId,usage,scope:r.usageBasis})
    for(const[k,v]of Object.entries(usage)){m.counterCoverage[k]=(m.counterCoverage[k]||0)+1;if(Object.hasOwn(m.subtotal,k)&&m.subtotal[k]===null)continue;const sum=(m.subtotal[k]??0)+v;m.subtotal[k]=Number.isSafeInteger(sum)?sum:null}
   }
  }
  const usageModels=[...models.values()].map(m=>({...m,bases:[...m.bases],subtotal:m.bases.size===1&&m.bases.has('provider_result_model_usage')?m.subtotal:null}))
  const usageComplete=unknownUsageCalls===0&&usageModels.length>0&&usageModels.every(m=>m.subtotal!==null&&Object.values(m.counterCoverage).every(n=>n===m.receiptCount)&&Object.values(m.subtotal).every(n=>n!==null))&&!usageConflict
  const workerGroup=group.kind==='worker_work'
  const runs=[...new Map(group.rows.filter(({r})=>workerGroup?validWorkerTrace(r.workerTrace):validWorkTrace(r.workTrace)).map(({r})=>{const t=workerGroup?r.workerTrace:r.workTrace;return[t.runId,t]})).values()].map(trace=>{
   const outcomes=group.rows.filter(({r})=>(workerGroup?r.workerTrace:r.workTrace)?.runId===trace.runId).map(({r})=>workerGroup?r.workerOutcome:r.workOutcome).filter(o=>o?.basis===(workerGroup?'canonical_worker_checkpoint':'host_checkpoint_report')&&date(o.at)&&(workerGroup?STATES:['ready','saved','raw_only','done','empty','unconfirmed','failed','yielded']).includes(o.state))
   const conflicting=new Set(outcomes.map(canonical)).size>1
   return {...trace,outcomeState:conflicting?'CONTRADICTED':outcomes.length?'SUPPORTED':'UNKNOWN',hostOutcome:conflicting?null:outcomes[0]||null}
  })
  const linkedWorker=workerGroup?work.flatMap(s=>(s.records||[]).map(r=>({s,r}))).filter(({r})=>r.kind===group.workKind&&r.sourceId===runs[0]?.recordId&&runs.some(t=>(r.workerRuns||[]).some(w=>canonical(w.trace)===canonical(Object.fromEntries(['workId','runId','recordId','kind','attempt'].map(k=>[k,t[k]])))))):[]
  const workerConflict=linkedWorker.length>0&&(new Set(linkedWorker.map(({r})=>canonical({state:r.state,workerRuns:r.workerRuns}))).size>1||linkedWorker.some(({r})=>runs.some(t=>{const w=(r.workerRuns||[]).find(w=>w.trace?.runId===t.runId);return w&&t.hostOutcome&&(w.state!==t.hostOutcome.state||w.finishedAt!==t.hostOutcome.at)})))
  for(const x of linkedWorker)references.push(reference(x.s,x.r,['kind','state','workerRuns','testBinding','appliedToLive','loadedCommit','workRunId','taskRunId']))
  chains.push({kind:group.kind,workKind:group.workKind,jobId:group.jobId,identity:group.identity,recordId:workerGroup||group.kind==='background_work'?runs[0]?.recordId:null,observedRuns:workerGroup||group.kind==='background_work'?runs.length:null,observedRetryRuns:workerGroup||group.kind==='background_work'?runs.filter(r=>r.attempt>1).length:null,runs,canonicalEvidenceState:workerConflict?'CONTRADICTED':linkedWorker.length?'SUPPORTED':'UNKNOWN',canonicalRecordState:workerGroup?(linkedWorker.length&&!workerConflict?label(linkedWorker[0].r.state):null):null,canonicalRecordObserved:linkedWorker.length>0,observedAttempts:group.rows.length,observedDispatches,successfulResults,retryCount:null,phases,
   startedAt:group.rows.map(({r})=>r.startedAt).sort()[0],finishedAt:group.rows.map(({r})=>date(r.finishedAt)).filter(Boolean).sort().at(-1)||null,
   executionState:observedDispatches?'CONFIRMED':'UNKNOWN',modelState:successfulResults?'CONFIRMED':'UNKNOWN',usageState:usageConflict?'CONTRADICTED':!usageModels.length?'UNKNOWN':usageComplete?'CONFIRMED':'SUPPORTED',
   usageComplete,unknownUsageCalls,usageModels,billingState,correlationState:usageConflict?'CONTRADICTED':usageModels.length?'CONFIRMED':'UNKNOWN',requestCoverageComplete:false,references})
 }
 for(const[id,rows]of sessions){
  const dated=rows.filter(({r})=>date(r.usageAt)).sort((a,b)=>Date.parse(b.r.usageAt)-Date.parse(a.r.usageAt)),selected=dated[0]||rows[0]
  const same=dated.length?dated.filter(({r})=>Date.parse(r.usageAt)===Date.parse(selected.r.usageAt)):rows
  const conflict=new Set(same.map(({r})=>canonical(r.usage))).size>1
  const {s,r}=selected,usage=r.usageBasis==='latest_recorded_cumulative_session_snapshot_not_sum'&&r.usage&&typeof r.usage==='object'&&!Array.isArray(r.usage)?Object.fromEntries(Object.entries(r.usage).filter(([k,v])=>['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'].includes(k)&&number(v)!==null)):null
  const cumulativeUsage=!conflict&&date(r.usageAt)&&usage&&Object.keys(usage).length?usage:null
  chains.push({kind:'codex_session',jobId:id,identity:'exact_session_id',startedAt:date(r.lastStartedAt),finishedAt:date(r.lastCompletedAt),
   executionState:date(r.lastStartedAt)||date(r.lastCompletedAt)?'CONFIRMED':'UNKNOWN',modelState:'UNKNOWN',actualModel:null,
   observedStartedTurns:number(r.startedTurns),observedCompletedTurns:number(r.completedTurns),turnCountComplete:r.turnIdentityComplete===true&&r.completeFile===true,
   usageState:conflict?'CONTRADICTED':cumulativeUsage?'CONFIRMED':'UNKNOWN',cumulativeUsage,usageAt:date(r.usageAt),usageModels:[],
   usageScope:'latest_observed_session_cumulative_not_per_model_not_sum',billingState,correlationState:conflict?'CONTRADICTED':cumulativeUsage?'CONFIRMED':'UNKNOWN',references:same.map(x=>reference(x.s,x.r,SESSION_FIELDS))})
 }
 const workers=new Map()
 for(const s of work)for(const r of s.records||[])if(label(r.sourceId)&&/^worker\/(project-tasks|project-runs|adoptions|runs)$/.test(r.kind||'')){
  const rows=workers.get(r.sourceId)||[];rows.push({s,r});workers.set(r.sourceId,rows)
 }
 for(const[id,rows]of workers){
  const conflict=new Set(rows.map(({r})=>canonical({kind:r.kind,state:r.state,startedAt:r.startedAt,finishedAt:r.finishedAt}))).size>1,{s,r}=rows[0]
  chains.push({kind:'worker_record',jobId:id,identity:'exact_host_work_record',startedAt:date(r.startedAt),finishedAt:date(r.finishedAt),recordedState:label(r.state),
   executionState:conflict?'CONTRADICTED':'SUPPORTED',modelState:'UNKNOWN',usageState:'UNKNOWN',usageModels:[],billingState,correlationState:'UNKNOWN',
   references:rows.map(x=>reference(x.s,x.r,['kind','state','startedAt','finishedAt','model','requestId','workRunId','taskRunId']))})
 }
 const inventory=[['bridge_invocations','execution','invocations',uniqueCalls.length],['codex_sessions','execution','sessions',sessions.size],['worker_records','work',null,workers.size],['scheduler_definitions','schedules',null,null]].map(([source,name,sub,count])=>{
  const sources=sections.filter(s=>s.section===name),receipts=sources.filter(readable),states=sources.map(s=>sub?s.coverage?.[sub]||s.state:s.state)
  const state=!receipts.length||states.every(v=>['missing','unavailable','unconnected'].includes(v))?'UNAVAILABLE':'SUPPORTED'
  const references=receipts.flatMap(s=>(s.records||[]).filter(r=>source==='bridge_invocations'?uniqueCalls.some(c=>c.invocationId===r.invocationId):source==='codex_sessions'?sessions.has(r.sessionId):source==='worker_records'?workers.has(r.sourceId):true).map(r=>reference(s,r,source==='bridge_invocations'?['invocationId','evidenceBasis']:source==='codex_sessions'?['sessionId','evidenceBasis']:['kind','state'])))
  return {source,state,observedRecords:state==='UNAVAILABLE'?null:count??receipts.reduce((n,s)=>n+(s.records?.length||0),0),complete:false,references,
   receipts:sources.map(s=>({sourceId:s.sourceId,retrievedAt:s.retrievedAt||null,state:s.state,coverage:sub==='sessions'?s.sessionCoverage||s.coverage||null:sub==='invocations'?s.invocationCoverage||null:s.coverage||null,omitted:s.omitted??null}))}
 })
 return {version:1,readOnly:true,inventoryComplete:false,inventory,chains,duplicateReceipts,conflictingReceipts,gaps,billingState,billingConfirmed:false,subscriptionEvidence:require('./subscriptionEvidence').buildSubscriptionEvidence(sections),
  accountUsageTotal:null,subscriptionCreditUsed:null,scope:'registered_source_samples_not_all_external_work_or_account_totals'}
}
module.exports={buildExecutionUsage}
