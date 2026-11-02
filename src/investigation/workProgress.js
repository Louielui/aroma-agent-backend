'use strict'
// Read-only projection of existing canonical work, invocation and usage records.
// No worker/service constructors, provider calls, new store or synthetic history.
const fs=require('node:fs'),path=require('node:path'),{ID}=require('../actions/contract')
const {pin,readAt,FOLDERS}=require('./workRecords'),{projectWorkRecord}=require('./workEvidence'),{projectRecord}=require('./invocations')
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null
const uuid=v=>typeof v==='string'&&ID.test(v)?v:null
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:null
const code=v=>typeof v==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(v)?v:null
const safeModel=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9.\[\]-]{0,99}$/.test(v)?v:null
function links(r){return[uuid(r.workRunId),uuid(r.taskRunId),uuid(r.workOrder?.registrationId),uuid(r.workOrder?.usageRoot),uuid(r.input?.scope?.budgetRoot),uuid(/^registered-task-(.+)$/.exec(r.workOrder?.recipe||'')?.[1])].filter(Boolean)}
function shape(input){return !!input&&!Array.isArray(input)&&Object.keys(input).every(k=>['id','limit'].includes(k))&&(input.id===undefined||uuid(input.id))&&(input.limit===undefined||Number.isInteger(input.limit)&&input.limit>0&&input.limit<=25)}
function createProgressReader({workerRoot,repoRoot,dataRoot=null,invocationFile,now=()=>new Date().toISOString()}){
 function invocations(){
  try{const root=pin(path.dirname(invocationFile)),v=JSON.parse(readAt(root,path.basename(invocationFile),2*1024*1024));if(v.version!==1||!Array.isArray(v.records)||v.records.length>256||!Number.isSafeInteger(v.omitted)||v.omitted<0||!stamp(v.coverageStartedAt))throw Error('invalid_ledger');const records=v.records.map(projectRecord);if(new Set(records.map(r=>r.invocationId)).size!==records.length)throw Error('duplicate_ledger_identity');return{state:v.omitted?'partial':'ok',records,omitted:v.omitted,coverageStartedAt:v.coverageStartedAt}}catch{return{state:'unavailable',records:null,omitted:null,coverageStartedAt:null}}
 }
 function usage(rootId,root){
  if(!rootId)return{state:'not_bound',rootId:null,helper:null,website:null}
  try{
   const row=JSON.parse(readAt(root,path.join('project-task-usage',rootId+'.json'),2*1024*1024));if(row.id!==rootId)throw Error('invalid_ledger')
   const u=require('../actions/usageBudget'),store={get:()=>structuredClone(row),lockRun:()=>{throw Error('read_only_observer')}}
   const s=u.createUsageBudget({profile:u.developmentProfile(rootId),store}).readStatus();if(s.state==='not_activated')throw Error('missing_usage')
   return{state:'validated_snapshot',rootId,status:s.state,baseLimits:s.limits,helper:s.helper,website:s.website,dispatchAuthority:'not_assessed',extension:s.extension?{id:s.extension.id,expiresAt:new Date(s.extension.expiresAt).toISOString()}:null}
  }catch{return{state:'unavailable',rootId,helper:null,website:null}}
 }
 async function read(input={}){
  if(!shape(input))throw Error('invalid_progress_request')
  const observedAt=now(),limit=input.limit||10,coverage=[],all=[],unavailableRecords=[],seen=new Set(),lookupFailures=new Set();let root=null,repo=null
  try{root=pin(workerRoot)}catch{/* Each source reports its own missing coverage. */}try{repo=pin(repoRoot)}catch{/* Source comparisons stay unavailable. */}
  const sources=FOLDERS.map(kind=>({kind,base:root,folder:kind}));if(dataRoot){let d=null;try{d=pin(dataRoot)}catch{};for(const kind of ['code-diagnosis-runs','code-repair-runs'])sources.push({kind,base:d,folder:kind})}
  function load(source,name){
   const key=source.kind+'/'+name;if(seen.has(key))return;seen.add(key)
   const raw=JSON.parse(readAt(source.base,path.join(source.folder,name),2*1024*1024)),id=name.slice(0,-5),expected={ 'project-tasks':'project_task','project-runs':'project_work',adoptions:'project_adoption','code-diagnosis-runs':'code_diagnosis','code-repair-runs':'code_repair'}[source.kind]
   if(raw.id!==id||expected&&raw.workflow!==expected||!Array.isArray(raw.steps)&&!(source.kind==='runs'&&Array.isArray(raw.events)))throw Error('invalid_work_record')
   if(raw.workOrder?.usageRoot&&raw.workOrder?.registrationId&&raw.workOrder.usageRoot!==raw.workOrder.registrationId)throw Error('conflicting_work_identity')
   const canonicalKind=FOLDERS.includes(source.kind)?'worker/'+source.kind:source.kind,p=projectWorkRecord(raw,{kind:canonicalKind,recordId:id,readSource:n=>repo?readAt(repo,n,512*1024):null})
   const phases=(raw.steps||raw.events).filter(s=>code(s.stage)&&stamp(s.at)),last=phases.at(-1),rootId=uuid(raw.workOrder?.usageRoot)||uuid(raw.input?.scope?.budgetRoot)||(raw.kind==='repository_repair'?id:null)
   const requested=typeof raw.input?.goal==='string'?raw.input.goal:raw.workOrder?.goal
   all.push({raw,p,id,kind:source.kind,rootId,linkedIds:links(raw),goal:typeof requested==='string'?requested.slice(0,240):p.goal,phase:last?.stage||p.state||'unknown',phaseAt:last?.at||p.at})
  }
  for(const source of sources){
   const c={kind:source.kind,state:'ok',scanned:0,failed:0,omitted:0};coverage.push(c)
   try{
    if(!source.base)throw Error('source_unavailable');const dir=path.join(source.base,source.folder);if(fs.lstatSync(dir).isSymbolicLink()||fs.realpathSync.native(dir).toLowerCase()!==dir.toLowerCase())throw Error('redirected_directory')
    const names=fs.readdirSync(dir).filter(n=>n.endsWith('.json')&&uuid(n.slice(0,-5))).sort()
    const selected=[...new Set([...(input.id&&names.includes(input.id+'.json')?[input.id+'.json']:[]),...names.slice(0,250)])]
    c.omitted=names.length-selected.length
    for(const name of selected){c.scanned++;try{load(source,name)}catch(e){c.failed++;unavailableRecords.push({id:name.slice(0,-5),kind:source.kind,reason:['redirected_record','record_limit','invalid_work_record','conflicting_work_identity'].includes(e.message)?e.message:'record_unavailable'});if(name===input.id+'.json')lookupFailures.add(source.kind)}}
    if(c.failed||c.omitted)c.state='partial'
   }catch(e){c.state=e.code==='ENOENT'?'missing':'unavailable';c.failed=null;c.omitted=null}
  }
  // Direct identity links may be older than the bounded list sample. Reading
  // those exact UUIDs neither scans new roots nor matches titles or prose.
  if(input.id){const wanted=new Set(all.filter(r=>r.id===input.id).flatMap(r=>r.linkedIds));for(const source of sources)for(const id of wanted)if(source.base&&!seen.has(source.kind+'/'+id+'.json'))try{load(source,id+'.json');const c=coverage.find(c=>c.kind===source.kind);c.scanned++;if(c.omitted>0)c.omitted--}catch(e){if(e.code!=='ENOENT')lookupFailures.add(source.kind)}}
  const ledger=invocations(),targets=input.id?all.filter(r=>r.id===input.id):[],related=new Set(targets.flatMap(r=>[r.id,r.rootId,...r.linkedIds]).filter(Boolean))
  let selected=input.id?all.filter(r=>related.has(r.id)||r.linkedIds.includes(input.id)||r.rootId===input.id):all
  selected.sort((a,b)=>(input.id?Number(b.id===input.id)-Number(a.id===input.id):0)||String(b.phaseAt||'').localeCompare(String(a.phaseAt||''))||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id))
  const omitted=Math.max(0,selected.length-limit);selected=selected.slice(0,limit)
  const records=selected.map(({raw,p,id,kind,rootId,linkedIds,goal,phase,phaseAt})=>{
   const runs=p.workerRuns,matched=runs.length?ledger.records?.filter(call=>runs.some(r=>call.workerTrace&&Object.keys(r.trace).every(k=>r.trace[k]===call.workerTrace[k])))||null:null
   const calls=matched?{state:'bounded_ledger',observed:matched.length,dispatched:matched.filter(c=>c.dispatchedAt).length,providerTurns:matched.filter(c=>c.dispatchedAt&&c.dispatchBasis==='provider_turn_start').length,cliProcesses:matched.filter(c=>c.dispatchedAt&&c.dispatchBasis==='cli_process_started').length,modelResults:matched.filter(c=>c.modelResultObserved).length,receipts:matched.map(c=>({id:c.invocationId,phase:c.workerPhase,state:c.state,requestedModel:c.model,actualModel:c.modelResultObserved?c.actualModel:null,resultObserved:c.modelResultObserved,effort:c.effort,dispatchBasis:c.dispatchBasis,dispatchedAt:c.dispatchedAt,finishedAt:c.finishedAt,durationMs:c.durationMs}))}:{state:ledger.records?'not_linked':'unavailable',observed:null,dispatched:null,providerTurns:null,cliProcesses:null,modelResults:null,receipts:[]}
   // Diagnosis has its own host receipts, not workerTrace. Do not invent a link
   // to the invocation ledger or mistake configured workers for actual models.
   const diagnosisReceipts=kind==='code-diagnosis-runs'&&Array.isArray(raw.modelReceipts)?raw.modelReceipts.slice(0,20).filter(r=>r.requestId===id).map(r=>({requestedModel:safeModel(r.requestedModel),actualModel:safeModel(r.actualModel),effort:code(r.effort),state:['started','returned','failed'].includes(r.state)?r.state:'unknown',billing:['chatgpt-subscription','claude-subscription'].includes(r.billing)?r.billing:null,basis:'canonical_diagnosis_model_receipt'})):[]
   return{id,kind,goal,state:p.state||'unknown',phase,phaseAt,startedAt:p.startedAt,finishedAt:p.finishedAt,reason:p.reason,rootId,linkedIds,currentRunning:'unknown',
    acceptance:{approvedAt:stamp((raw.steps||raw.events).find(s=>s.stage==='approved'&&s.facts?.actor==='owner')?.at),workerAttempts:runs.length,dispatchCheckpoints:calls.dispatched},calls,diagnosisReceipts,usage:usage(rootId,root),
    completion:{candidateRecorded:!!hash(raw.result?.patchHash),tests:p.tests,reviewVerdict:p.reviewVerdict||'unknown',appliedToLive:p.appliedToLive,liveVerified:null,recordedLiveVerificationState:code(p.liveVerification?.state),diagnosisVerified:kind==='code-diagnosis-runs'&&raw.verification?raw.verification.matched===true&&raw.verification.citationsVerified===true:null,promotionState:code(raw.repositoryPromotion?.state),loadedCommit:p.loadedCommit},
    references:{record:kind+'/'+id,sourceRevision:p.sourceRevision,patchHash:hash(raw.result?.patchHash),isolatedRunId:uuid(raw.result?.isolatedRunId)}}
  })
  const lookup=input.id?(targets.length>1?'ambiguous':targets.length===1?'found':lookupFailures.size||coverage.some(c=>c.state!=='ok')?'unavailable':'not_found'):'list'
  return{version:1,readOnly:true,observedAt,state:coverage.every(c=>c.state==='ok')&&ledger.state==='ok'&&!omitted&&!lookupFailures.size?'ok':'partial',lookup,records,coverage,unavailableRecords:unavailableRecords.slice(0,25),unavailableRecordsOmitted:Math.max(0,unavailableRecords.length-25),invocationCoverage:{state:ledger.state,omitted:ledger.omitted,coverageStartedAt:ledger.coverageStartedAt},omitted,
   scope:'existing_program_workers_and_fixed_diagnosis_records',consistency:'individual_file_snapshots_not_a_cross_store_transaction',codexAppThreadBinding:'not_connected',automaticUpdates:false,note:'Recorded phase is not a per-job live-process witness. Bounded receipts are not account totals; missing evidence is unknown. This observer starts no work, approvals, reconciliation or model calls.'}
 }
 return{read}
}
module.exports={createProgressReader}
