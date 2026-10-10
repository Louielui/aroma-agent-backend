'use strict'
// Single Owner-bridge writer. Fixed composition-root file, metadata only; no
// prompts, answers, credentials, provider cost estimates or inferred job links.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto')
const {validTrace,UUID}=require('./invocationContext')
const {validWorkTrace,validOutcome}=require('./workTrace')
const {validWorkerTrace,STATES,PHASES}=require('./workerInvocation')
const TOKEN_FIELDS=['inputTokens','outputTokens','totalTokens','cacheReadInputTokens','cacheCreationInputTokens','cachedInputTokens','reasoningOutputTokens']
const number=v=>Number.isSafeInteger(v)&&v>=0?v:null
const model=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9.\[\]-]{0,99}$/.test(v)?v:null
function projectUsage(value){if(!value||typeof value!=='object'||Array.isArray(value))return null;const r={};for(const key of TOKEN_FIELDS)if(number(value[key])!==null)r[key]=value[key];return Object.keys(r).length?r:null}
function byModel(rows){return Array.isArray(rows)?rows.slice(0,8).filter(r=>model(r?.model)).map(r=>({model:model(r.model),usage:projectUsage(r.usage)})):[]}
function projectTiming(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.basis!=='claude_cli_result')return null
 const cliDurationMs=number(value.cliDurationMs),apiDurationMs=number(value.apiDurationMs)
 return cliDurationMs===null&&apiDurationMs===null?null:{cliDurationMs,apiDurationMs,basis:'claude_cli_result'}
}
function projectRecord(r){
 if(!r||typeof r.invocationId!=='string'||!UUID.test(r.invocationId)||!['chat_completion','memory_completion','worker_completion'].includes(r.role)||!['started','succeeded','failed','interrupted_unknown'].includes(r.state)||typeof r.startedAt!=='string'||!Number.isFinite(Date.parse(r.startedAt)))throw Error('invalid_ledger')
 const at=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null
 const trace=validTrace({requestId:r.requestId,phase:r.phase})?{requestId:r.requestId,phase:r.phase}:{requestId:null,phase:'unspecified'}
 const workTrace=r.role!=='worker_completion'&&validWorkTrace(r.workTrace)?{...r.workTrace}:null
 const workOutcome=r.workOutcome&&{state:r.workOutcome.state,at:r.workOutcome.at}
 const workerTrace=r.role==='worker_completion'&&validWorkerTrace(r.workerTrace)?{...r.workerTrace}:null
 const workerOutcome=workerTrace&&STATES.includes(r.workerOutcome?.state)&&at(r.workerOutcome?.at)?{state:r.workerOutcome.state,at:r.workerOutcome.at,basis:'canonical_worker_checkpoint'}:null
 return {sourceId:'invocation:'+r.invocationId,invocationId:r.invocationId,role:r.role,...trace,state:r.state,model:model(r.model),actualModel:model(r.actualModel),effort:['low','medium','high','xhigh','max','ultra','auto'].includes(r.effort)?r.effort:null,
  at:at(r.finishedAt)||r.startedAt,startedAt:r.startedAt,dispatchedAt:at(r.dispatchedAt),finishedAt:at(r.finishedAt),durationMs:number(r.durationMs),preflightMs:number(r.preflightMs),providerWaitMs:number(r.providerWaitMs),providerTiming:projectTiming(r.providerTiming),
  modelResultObserved:r.state==='succeeded'&&r.modelResultObserved===true,billingRoute:['claude-subscription','chatgpt-subscription'].includes(r.billingRoute)?r.billingRoute:null,
  usage:projectUsage(r.usage),usageByModel:byModel(r.usageByModel),usageBasis:['provider_result_model_usage','provider_last_turn_usage'].includes(r.usageBasis)?r.usageBasis:null,
  workTrace,workOutcome:workTrace&&validOutcome(workOutcome)?{...workOutcome,basis:'host_checkpoint_report'}:null,
  workerTrace,workerOutcome,workerPhase:workerTrace&&PHASES.includes(r.workerPhase)?r.workerPhase:null,candidateAttempt:workerTrace&&[1,2].includes(r.candidateAttempt)?r.candidateAttempt:null,
  dispatchBasis:['provider_turn_start','cli_process_started'].includes(r.dispatchBasis)?r.dispatchBasis:null,
  failureCode:r.state==='failed'&&['worker_cancelled','worker_timeout','claude_unavailable','subscription_limit_reached','subscription_login_required','subscription_invalid_output','subscription_model_unavailable','subscription_unavailable','worker_evidence_unavailable'].includes(r.failureCode)?r.failureCode:null,
  evidenceBasis:'owner_bridge_invocation_ledger',linkBasis:workerTrace?'host_worker_identity':workTrace?'host_work_identity':trace.requestId?'host_request_identity':'role_only_no_individual_job_link',provesCharge:false}
}
function createInvocationLedger({file,clock=Date.now,limit=256}={}){
 if(!file||!path.isAbsolute(file)||!Number.isInteger(limit)||limit<1||limit>256)throw Error('invalid_ledger_configuration')
 let records=[],omitted=0,unavailable=false,coverageStartedAt=new Date(clock()).toISOString()
 const safe=target=>{const resolved=path.resolve(target),canonical=fs.realpathSync.native(target);if((process.platform==='win32'?resolved.toLowerCase()!==canonical.toLowerCase():resolved!==canonical)||fs.lstatSync(target).isSymbolicLink())throw Error('unsafe_ledger')}
 try{
  safe(path.dirname(file))
  if(fs.existsSync(file)){
   safe(file);const stat=fs.statSync(file);if(!stat.isFile()||stat.nlink!==1||stat.size>2*1024*1024)throw Error('ledger_limit')
   const saved=JSON.parse(fs.readFileSync(file,'utf8'))
   if(saved.version!==1||!Array.isArray(saved.records)||saved.records.length>256||number(saved.omitted)===null||!Number.isFinite(Date.parse(saved.coverageStartedAt)))throw Error('invalid_ledger')
   records=saved.records.map(projectRecord).map(r=>r.state==='started'?{...r,state:'interrupted_unknown'}:r);omitted=saved.omitted;coverageStartedAt=saved.coverageStartedAt
   if(new Set(records.map(r=>r.invocationId)).size!==records.length)throw Error('duplicate_ledger_identity')
  }
 }catch(_){unavailable=true}
 function save(){
  if(unavailable)return
  let temp
  try{
   safe(path.dirname(file));if(fs.existsSync(file))safe(file)
   while(records.length>limit){records.shift();omitted++}
   temp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify({version:1,coverageStartedAt,omitted,records:records.map(projectRecord)}),{flag:'wx',mode:0o600});fs.renameSync(temp,file)
  }catch(_){unavailable=true;if(temp)try{fs.unlinkSync(temp)}catch(_){}}
 }
 return {
  begin(input){if(unavailable)return null;const id=randomUUID();records.push(projectRecord({invocationId:id,role:input.role,state:'started',model:input.model,effort:input.effort,workTrace:input.workTrace,workerTrace:input.workerTrace,workerPhase:input.workerPhase,candidateAttempt:input.candidateAttempt,dispatchBasis:input.dispatchBasis,...(validTrace(input.trace)?input.trace:{}),startedAt:new Date(clock()).toISOString()}));save();return unavailable?null:id},
  dispatched(id){const r=records.find(r=>r.invocationId===id);if(!r||r.state!=='started'||r.dispatchedAt)return;r.dispatchedAt=new Date(clock()).toISOString();r.preflightMs=Math.max(0,Date.parse(r.dispatchedAt)-Date.parse(r.startedAt));save()},
  finish(id,result,error){const r=records.find(r=>r.invocationId===id);if(!r||r.state!=='started')return;r.finishedAt=new Date(clock()).toISOString();r.durationMs=Math.max(0,Date.parse(r.finishedAt)-Date.parse(r.startedAt));r.providerWaitMs=r.dispatchedAt?Math.max(0,Date.parse(r.finishedAt)-Date.parse(r.dispatchedAt)):null
   r.state=error?'failed':'succeeded';r.failureCode=error?.code||error?.message;r.actualModel=error?null:model(result?.actualModel||result?.model);r.modelResultObserved=!error&&!!r.actualModel;r.billingRoute=error?null:result?.billing;r.usage=error?null:projectUsage(result?.usage);r.usageByModel=error?[]:byModel(result?.usageByModel);r.usageBasis=error?null:result?.usageBasis;r.providerTiming=error?null:projectTiming(result?.providerTiming);save()},
  workerOutcome(trace,outcome){
   if(unavailable||!validWorkerTrace(trace)||!STATES.includes(outcome?.state)||!Number.isFinite(Date.parse(outcome.at)))return false
   const rows=records.filter(r=>r.workerTrace?.runId===trace.runId)
   if(!rows.length||rows.some(r=>Object.keys(trace).some(k=>r.workerTrace[k]!==trace[k])||r.state==='started'||r.workerOutcome&&(r.workerOutcome.state!==outcome.state||r.workerOutcome.at!==outcome.at)))return false
   for(const r of rows)r.workerOutcome={state:outcome.state,at:outcome.at};save();return !unavailable
  },
  workOutcome(trace,outcome){
   if(unavailable||!validWorkTrace(trace)||!validOutcome(outcome))return false
   const rows=records.filter(r=>r.workTrace?.runId===trace.runId)
   if(!rows.length||rows.some(r=>Object.keys(trace).some(k=>r.workTrace[k]!==trace[k])||r.state==='started'||r.workOutcome&&(r.workOutcome.state!==outcome.state||r.workOutcome.at!==outcome.at)))return false
   for(const r of rows)r.workOutcome={...outcome};save();return !unavailable
  },
  read(){const sample=unavailable?[]:records.slice(-24).reverse().map(projectRecord);return {state:unavailable?'unavailable':'partial',records:sample,coverageStartedAt,retained:unavailable?null:records.length,omitted:unavailable?null:omitted+Math.max(0,records.length-24),provesCharge:false,
   note:'Bounded Owner bridge chat, memory and registered development worker receipts since coverageStartedAt, not account totals. New project-tasks, project-runs and fixed-fixture runs have host identities; old records remain unlinked. CLI process start is not proof of a provider turn. Failed or interrupted calls may consume unknown usage. Tokens are not credits or charges. Legacy workers, controlled code repair, website, API and external-app calls are not covered. No retrospective backfill.'}}
 }
}
function createOwnerInvocationLedger({home=require('node:os').homedir()}={}){
 // Packaged Windows apps may virtualize individual LocalAppData files while
 // leaving their parent directory canonical. Use the existing Owner Documents
 // storage convention; retain the canonical-path guard rather than bypass it.
 const dir=path.join(home,'Documents','AromaXiangXiang','subscription-invocations')
 try{fs.mkdirSync(dir,{recursive:true})}catch(_){/* The reader reports unavailable; inference must remain independent. */}
 return createInvocationLedger({file:path.join(dir,'ledger.json')})
}
module.exports={createInvocationLedger,createOwnerInvocationLedger,projectUsage,projectRecord}
