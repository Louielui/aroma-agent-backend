'use strict'
// Allocation policy for the existing UsageBudget ledger, never a second counter.
const deployment=require('../localBrain/deploymentProfile.json')
const PROFILE=Object.freeze({id:'abec5422-a464-440e-898a-70d35f956478',identity:'owner-local-brain-acceptance-20261115',model:deployment.model,effort:'auto',turns:7,helper:38,website:0,digest:deployment.digest,learningSource:Object.freeze({id:'xx-a2b8cbbc-2cf9-4d4f-8876-8f9b00b49537',version:3,hash:'876e7fb2ee15a10e824a668043e7af7300be5935c325d8678416e9bc469df447'}),windowMs:900000,turnMs:90000,slots:Object.freeze(['82f85017-3b6c-4e99-8e1f-624e64834f10','82f85017-3b6c-4e99-8e1f-624e64834f11','82f85017-3b6c-4e99-8e1f-624e64834f12','82f85017-3b6c-4e99-8e1f-624e64834f13','82f85017-3b6c-4e99-8e1f-624e64834f14','82f85017-3b6c-4e99-8e1f-624e64834f15','82f85017-3b6c-4e99-8e1f-624e64834f16'].map((id,i)=>Object.freeze({id,purpose:i===6?'background':'dialogue',limit:i===6?2:6})))})
// A definition only, not activation. Six fresh dialogue slots; no learning lane.
const BOUNDARY_PROFILE=Object.freeze({id:'57a05d0c-f684-4a10-9f7a-899629d87dc4',identity:'owner-local-boundary-acceptance-20261115',model:deployment.model,effort:'auto',turns:6,helper:36,website:0,digest:deployment.digest,windowMs:900000,turnMs:90000,slots:Object.freeze(['ea952897-e445-4bb5-b1e6-7347d4b00901','ea952897-e445-4bb5-b1e6-7347d4b00902','ea952897-e445-4bb5-b1e6-7347d4b00903','ea952897-e445-4bb5-b1e6-7347d4b00904','ea952897-e445-4bb5-b1e6-7347d4b00905','ea952897-e445-4bb5-b1e6-7347d4b00906'].map((id,i)=>Object.freeze({id,purpose:'dialogue',limit:6,scenario:i<3?'minimum_transfer':'capability_offline',repeat:i%3+1})))})
const fail=code=>{throw Object.assign(Error(code),{code})}
function policy(PROFILE){
function validate(row){
 if(!/^[a-f0-9]{40}$/.test(row.commit||'')||!Number.isSafeInteger(row.activatedAt)||row.expiresAt!==row.activatedAt+PROFILE.windowMs||row.turns.some(t=>!PROFILE.slots.some(s=>s.id===t.id)||t.entered&&!Number.isSafeInteger(t.enteredAt)))fail('usage_audit_unavailable')
 for(const s of PROFILE.slots){const attempts=row.attempts.filter(a=>a.turnId===s.id);if(attempts.length>s.limit||attempts.some(a=>a.kind!=='helper'||a.digest!==PROFILE.digest||typeof a.phase!=='string')||s.purpose==='background'&&(attempts.some(a=>!['memory_extract','memory_consolidation'].includes(a.phase))||new Set(attempts.map(a=>a.phase)).size!==attempts.length))fail('usage_audit_unavailable')}
}
function assertTime(row,turn,now,commit){
 if(row.stopReason)fail('usage_stopped')
 if(commit!==row.commit)fail('usage_binding_conflict')
 if(now>=row.expiresAt||turn?.enteredAt&&now>=turn.enteredAt+PROFILE.turnMs)fail('usage_expired')
}
function reserve(row,scope,input,kind,now,commit){
 const turn=row.turns.find(t=>t.id===scope.turnId),slot=PROFILE.slots.find(s=>s.id===scope.turnId);assertTime(row,turn,now,commit)
 if(kind!=='helper')fail('usage_operation_not_allowed')
 if(input.digest!==PROFILE.digest||input.model!==PROFILE.model||input.effort!==PROFILE.effort)fail('usage_model_not_allowed')
 const phase=input.phase||'helper'
 if(typeof phase!=='string'||!(/^[a-z_]{1,60}$/).test(phase))fail('usage_operation_not_allowed')
 if(slot.purpose==='background'?!['memory_extract','memory_consolidation'].includes(phase):phase.startsWith('memory_'))fail('usage_operation_not_allowed')
 const attempts=row.attempts.filter(a=>a.turnId===scope.turnId)
 if(attempts.length>=slot.limit||slot.purpose==='background'&&attempts.some(a=>a.phase===phase))fail('usage_limit_reached')
 return{phase,digest:input.digest}
}
return Object.freeze({validate,assertTime,reserve})
}
// Isolated programming proposal only; no ledger or inference is created here.
const CODING_PROFILE=Object.freeze({id:'cddc36a0-9781-4f2b-8630-e34a24c50814',identity:'owner-local-offline-coding-20261115',model:deployment.model,effort:'auto',turns:2,helper:4,website:0,digest:deployment.digest,windowMs:1800000,turnMs:360000,slots:Object.freeze(['29b22ba2-49d8-4ad5-b94d-cfc589124a01','29b22ba2-49d8-4ad5-b94d-cfc589124a02'].map(id=>Object.freeze({id,purpose:'coding',limit:2})))})
const original=policy(PROFILE),boundary=policy(BOUNDARY_PROFILE),codingBase=policy(CODING_PROFILE)
const coding=Object.freeze({...codingBase,reserve(row,scope,input,kind,now,commit){if(input.phase!=='local_coding')fail('usage_operation_not_allowed');return codingBase.reserve(row,scope,input,kind,now,commit)}})
function forProfile(id){return id===PROFILE.id?original:id===BOUNDARY_PROFILE.id?boundary:id===CODING_PROFILE.id?coding:null}
function registeredProfile(id){return{id,identity:'owner-local-repository-repair:'+id,model:deployment.model,effort:'auto',turns:1,helper:8,website:0,digest:deployment.digest,windowMs:1800000,turnMs:1800000,slots:[{id,purpose:'coding',limit:8}]}}
const REGISTERED_PHASES=Object.freeze(['local_test_draft','local_test_review','local_coding','local_code_review'])
function registeredPolicy(profile){const base=policy(profile);return Object.freeze({...base,validate(row){base.validate(row);if(row.attempts.some(a=>!REGISTERED_PHASES.includes(a.phase)))fail('usage_audit_unavailable')},reserve(row,scope,input,kind,now,commit){if(!REGISTERED_PHASES.includes(input.phase))fail('usage_operation_not_allowed');return base.reserve(row,scope,input,kind,now,commit)}})}
module.exports={policyForDialogue:policy,PROFILE,BOUNDARY_PROFILE,CODING_PROFILE,forProfile,registeredProfile,registeredPolicy,...original}
