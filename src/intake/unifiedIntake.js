'use strict'
const {validate,payloadHash,executionRef}=require('./unifiedContract')
function createUnifiedIntake({store,enabled=()=>false,reads=null}){
 const host=h=>{if(h?.principal!=='owner'||!['chrome','main'].includes(h.surface))throw Error('task_not_found');return h}
 function reserve(body,context){
  const b=validate(body),h=host(context)
  if(!enabled())throw Error('unified_intake_disabled')
  if(b.operation!=='start'&&h.surface!=='main')throw Error('owner_session_required')
  return store.reserveUnifiedTask({envelope:b,payloadHash:payloadHash(b),principal:h.principal,surface:h.surface,scope:structuredClone(h.scope),sourceHash:h.sourceHash||null})
 }
 function link(a,ref){return store.linkUnifiedAttempt(a,executionRef(ref))}
 function view(id,context,selected=null){
  const h=host(context),task=store.getTask(id),u=task?.unifiedIntake
  if(!u||u.version!==1||u.principal!==h.principal)throw Error('task_not_found')
  // A native service bearer token is not an Owner web session. Native clients
  // receive linkage only on their existing Browser Read record, never this API.
  if(h.surface!=='main')throw Error('owner_session_required')
  const a=selected?u.attempts.find(a=>a.id===selected):u.attempts.at(-1);if(!a)throw Error('task_not_found');let record=null,persistence='stored'
  try{record=a.executionRef&&reads?.get(a.executionRef.id);if(a.executionRef&&!record)persistence='unavailable'}catch{persistence='unavailable'}
  const bound=record?.unifiedTask?.taskId===id&&record.unifiedTask.attemptId===a.id&&record.unifiedTask.goalId===task.ownerGoal.goalId
  if(record&&!bound){record=null;persistence='unavailable'}
  let state=record?({awaiting_consent:'awaiting_authorization',processing:'running',completed:'finished',failed:'failed',cancelled:'cancelled',interrupted:'interrupted'}[record.state]||'interrupted'):'interrupted'
  const c=u.clarification,clarification=c&&[c.originAttemptId,c.attemptId].includes(a.id)&&a===u.attempts.at(-1)?{id:c.id,state:c.state,candidates:structuredClone(c.candidates),reads:c.reads,reason:c.reason||null,originAttemptId:c.originAttemptId,originalDiscoveryEvidenceHash:c.discoveryPackHash}:null
  if(clarification)state=record?.reconciliationRequired||c.state==='PROCESSING_CLARIFICATION'&&(!record||['failed','interrupted'].includes(record.state))?'CLARIFICATION_RECONCILIATION_REQUIRED':c.state
  // The existing bounded read runner has no full-Owner-goal completion verifier.
  // An answer, even with complete read coverage, leaves every outcome unresolved.
  const proof=record?.result?.taskEvidence
  return {...(record?.ownerCoordination?{investigation:require('./investigationResult').investigationResult(task,record)}:{}),version:1,taskId:id,goalId:task.ownerGoal.goalId,attemptId:a.id,revision:u.revision,objective:task.ownerGoal.originalObjective,goalStatus:task.ownerGoal.status,outcomes:structuredClone(task.ownerGoal.outcomes),constraints:structuredClone(task.ownerGoal.constraints),executionState:state,...(clarification?{clarification}:{}),active:['running','awaiting_authorization','WAITING_CLARIFICATION','PROCESSING_CLARIFICATION'].includes(state),coverage:proof?.state==='live'?(proof.complete===true?'complete':'partial'):proof?.state==='failed'?'failed':'unknown',persistence,continuationEnabled:enabled()===true,executionRef:a.executionRef?structuredClone(a.executionRef):null,executionRefs:u.attempts.flatMap(x=>x.executionRef?[structuredClone(x.executionRef)]:[]),result:record?.result?.text||null,contextAvailability:record?.contextAvailability||'unavailable',limitations:['outcome_not_verified','fresh_context_required_for_browser_operations','bounded_read_runner_only']}
 }
 function browserProjection(record){
  const binding=record?.unifiedTask,task=binding&&store.getTask(binding.taskId),a=task?.unifiedIntake?.attempts.find(a=>a.id===binding.attemptId)
  if(record.unifiedSurface!=='chrome'||a?.surface!=='chrome'||a.executionRef?.id!==record.id)throw Error('task_not_found')
  const result=view(task.id,{surface:'main',principal:'owner'},a.id)
  delete result.result;result.executionRefs=[structuredClone(a.executionRef)]
  return result
 }
 function verifyClarification(binding,tool=null){
  if(!enabled())throw Error('unified_intake_disabled')
  const c=store.checkUnifiedClarification(binding),task=store.getTask(binding.taskId),origin=task.unifiedIntake.attempts.find(a=>a.id===c.originAttemptId)
  const proof=require('./toolSelection/clarification'),actual=proof.fromRecord(reads.get(c.originExecutionRef.id),origin)
  for(const k of ['authorizationHash','scopeHash','discovery','dependency','source','resource','candidates','discoveryPackHash','originEvidenceHash','originalSelectionId'])if(proof.hash(actual[k])!==proof.hash(c[k]))throw Error('clarification_evidence_changed')
  if(proof.hash(actual.crossSource??null)!==proof.hash(c.crossSource??null))throw Error('clarification_evidence_changed')
  if(proof.hash(actual.crossSourceIntent??null)!==proof.hash(c.crossSourceIntent??null))throw Error('clarification_evidence_changed')
  if(c.lastExecutionRef&&proof.hash(reads.get(c.lastExecutionRef.id))!==c.lastRecordHash)throw Error('clarification_evidence_changed')
  if(tool!==null)store.checkUnifiedClarification(binding,tool)
  return c
 }
 function cancelClarification(id,revision,attemptId,h){host(h);if(h.surface!=='main'||!enabled())throw Error('owner_session_required');return store.cancelUnifiedClarification(id,revision,attemptId)}
 function clarificationEvidence(binding){const c=verifyClarification(binding);return structuredClone(reads.get(c.originExecutionRef.id).result.taskEvidence)}
 return{enabled,reserve,link,goal:binding=>{const task=store.getTask(binding.taskId);if(task?.ownerGoal?.goalId!==binding.goalId||!task.unifiedIntake.attempts.some(a=>a.id===binding.attemptId))throw Error('task_not_found');return structuredClone(task.ownerGoal)},abortResponse:b=>store.abortUnifiedClarification(b),verifyClarification,clarificationEvidence,cancelClarification,publishClarification:(binding,r)=>store.publishUnifiedClarification(binding,r),finishClarification:(binding,r)=>store.finishUnifiedClarification(binding,r),reconcileClarifications:()=>store.reconcileUnifiedClarifications(reads),view:(id,h)=>view(id,h),viewAttempt:(id,attemptId,h)=>view(id,h,attemptId),browserProjection}
}
module.exports={createUnifiedIntake}
