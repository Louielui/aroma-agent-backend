'use strict'
// Bounded host checkpoints, not original text or provider output. Pure projection.
const {validWorkTrace}=require('./workTrace')
const INDEX=['pending','saved','raw_only','source_only','unconfirmed']
const CONSOLIDATION=['running','done','empty','failed']
const CODES=['memory_timeout','memory_rate_limited','memory_unauthorized','memory_invalid_request','memory_invalid_text','memory_invalid_result','memory_unconfirmed','memory_unavailable','invalid_consolidation','stale_evidence','consolidation_unavailable']
const CHECKPOINTS=['index_lookup','index_retain','index_result_validation','consolidation_inference','consolidation_validation','consolidation_candidates','consolidation_source_verification','consolidation_commit']
const VALIDATION=['invalid_result_shape','invalid_candidate_shape','invalid_candidate_field','unsupported_quote','invalid_attribution','invalid_task_state','invalid_supersession']
const ID=/^xx-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const integer=v=>Number.isSafeInteger(v)&&v>=1
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))
function attempt(role,state,recordId,at){
 if(!['memory_index','memory_consolidation'].includes(role)||!state||!(role==='memory_index'?INDEX:CONSOLIDATION).includes(state.state)||!integer(state.attempts)||!date(state.checkedAt)||Date.parse(state.checkedAt)>Date.parse(at))return null
 const trace=validWorkTrace(state.workTrace)&&state.workTrace.kind===role&&state.workTrace.recordId===recordId&&state.workTrace.attempt===state.attempts&&state.workTrace.phase===(role==='memory_index'?'extraction':'consolidation')?{...state.workTrace}:null
 return {state:state.state,attempt:state.attempts,at:state.checkedAt,workTrace:trace,
  errorCode:CODES.includes(state.reason||state.error)&&(role==='memory_index'?String(state.reason||state.error).startsWith('memory_'):['invalid_consolidation','stale_evidence','consolidation_unavailable'].includes(state.error))?state.reason||state.error:null,
  checkpoint:CHECKPOINTS.includes(state.failureCheckpoint)&&state.failureCheckpoint.startsWith(role==='memory_index'?'index_':'consolidation_')?state.failureCheckpoint:null,
  validationCode:role==='memory_consolidation'&&state.error==='invalid_consolidation'&&state.failureCheckpoint==='consolidation_validation'&&VALIDATION.includes(state.validationCode)?state.validationCode:null}
}
function fromSaved(role,value,recordId,at){
 if(!value||typeof value!=='object')return null
 return attempt(role,{state:value.state,attempts:value.attempt,checkedAt:value.at,workTrace:value.workTrace,reason:value.errorCode,error:value.errorCode,failureCheckpoint:value.checkpoint,validationCode:value.validationCode},recordId,at)
}
function appendAttempt(role,previous,result,recordId){
 const at=result.checkedAt,history=(Array.isArray(previous?.attemptHistory)?previous.attemptHistory:[]).slice(-6).map(v=>fromSaved(role,v,recordId,at)).filter(Boolean)
 const old=attempt(role,previous,recordId,at),next=attempt(role,result,recordId,at)
 for(const item of [old,next].filter(Boolean))if(!history.some(h=>JSON.stringify(h)===JSON.stringify(item)))history.push(item)
 return {...result,attemptHistory:history.slice(-6)}
}
function buildAttemptEvidence(role,rows,at){
 const failure=role==='memory_index'?'unconfirmed':'failed',success=role==='memory_index'?['saved','raw_only']:['done','empty']
 const samples=[];let currentFailed=0,tracedCurrentFailures=0,retainedHistoryRecords=0
 for(const row of rows){
  const s=role==='memory_index'?row.index:row.details?.consolidation
  if(s?.state===failure)currentFailed++
  if(!ID.test(row.id))continue
  const current=attempt(role,s,row.id,at)
  if(s?.state===failure&&current?.workTrace)tracedCurrentFailures++
  const history=(Array.isArray(s?.attemptHistory)?s.attemptHistory:[]).slice(-6).map(v=>fromSaved(role,v,row.id,at)).filter(Boolean)
  if(history.length)retainedHistoryRecords++
  if(current&&!history.some(h=>JSON.stringify(h)===JSON.stringify(current)))history.push(current)
  const failures=history.filter(h=>h.state===failure).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))
  if(!failures.length)continue
  const lastFailure=failures.at(-1)
  // A current retained success for the same host work identity is completion evidence,
  // never retrospective remote persistence or proof the dependency is now healthy.
  const laterCompletion=current&&success.includes(current.state)&&current.workTrace&&lastFailure.workTrace&&
   current.workTrace.workId===lastFailure.workTrace.workId&&current.workTrace.runId!==lastFailure.workTrace.runId&&current.attempt>lastFailure.attempt&&Date.parse(current.at)>=Date.parse(lastFailure.at)?current:null
  samples.push({recordId:row.id,currentState:s.state,currentAt:date(s.checkedAt)?s.checkedAt:null,lastFailure,laterCompletion})
 }
 samples.sort((a,b)=>Number(!!b.lastFailure.workTrace)-Number(!!a.lastFailure.workTrace)||String(b.lastFailure.at).localeCompare(a.lastFailure.at)||a.recordId.localeCompare(b.recordId))
 return {version:1,at,currentFailed,tracedCurrentFailures,untracedCurrentFailures:currentFailed-tracedCurrentFailures,retainedHistoryRecords,
  sampleTotal:samples.length,omitted:Math.max(0,samples.length-12),samples:samples.slice(0,12),historyComplete:false}
}
function projectAttemptEvidence(role,value,failed,at){
 if(!value||value.version!==1||value.at!==at||value.currentFailed!==failed||value.historyComplete!==false||!Array.isArray(value.samples)||value.samples.length>12||
  !['currentFailed','tracedCurrentFailures','untracedCurrentFailures','retainedHistoryRecords','sampleTotal','omitted'].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0)||
  value.tracedCurrentFailures+value.untracedCurrentFailures!==failed||value.samples.length+value.omitted!==value.sampleTotal||value.sampleTotal>failed+value.retainedHistoryRecords)return null
 const seen=new Set(),samples=[]
 for(const s of value.samples){
  if(!ID.test(s?.recordId)||seen.has(s.recordId)||!(role==='memory_index'?INDEX:CONSOLIDATION).includes(s.currentState)||!date(s.currentAt)||Date.parse(s.currentAt)>Date.parse(at))return null
  const lastFailure=fromSaved(role,s.lastFailure,s.recordId,at),laterCompletion=s.laterCompletion===null?null:fromSaved(role,s.laterCompletion,s.recordId,at)
  if(!lastFailure||lastFailure.state!==(role==='memory_index'?'unconfirmed':'failed')||Date.parse(lastFailure.at)>Date.parse(s.currentAt)||
   (s.laterCompletion!==null&&!laterCompletion)||laterCompletion&&(!(role==='memory_index'?['saved','raw_only']:['done','empty']).includes(laterCompletion.state)||laterCompletion.state!==s.currentState||laterCompletion.at!==s.currentAt||!lastFailure.workTrace||!laterCompletion.workTrace||lastFailure.workTrace.workId!==laterCompletion.workTrace.workId||lastFailure.workTrace.runId===laterCompletion.workTrace.runId||laterCompletion.attempt<=lastFailure.attempt||Date.parse(laterCompletion.at)<Date.parse(lastFailure.at)))return null
  seen.add(s.recordId);samples.push({recordId:s.recordId,currentState:s.currentState,currentAt:s.currentAt,lastFailure,laterCompletion})
 }
 return {version:1,at,currentFailed:failed,tracedCurrentFailures:value.tracedCurrentFailures,untracedCurrentFailures:value.untracedCurrentFailures,retainedHistoryRecords:value.retainedHistoryRecords,sampleTotal:value.sampleTotal,omitted:value.omitted,samples,historyComplete:false}
}
module.exports={appendAttempt,buildAttemptEvidence,projectAttemptEvidence,VALIDATION}
