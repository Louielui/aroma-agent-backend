'use strict'
// Allocation policy for the existing UsageBudget ledger, never a second counter.
const deployment=require('../localBrain/deploymentProfile.json')
const PROFILE=Object.freeze({id:'abec5422-a464-440e-898a-70d35f956478',identity:'owner-local-brain-acceptance-20261115',model:deployment.model,effort:'auto',turns:7,helper:38,website:0,digest:deployment.digest,learningSource:Object.freeze({id:'xx-a2b8cbbc-2cf9-4d4f-8876-8f9b00b49537',version:3,hash:'876e7fb2ee15a10e824a668043e7af7300be5935c325d8678416e9bc469df447'}),windowMs:900000,turnMs:90000,slots:Object.freeze(['82f85017-3b6c-4e99-8e1f-624e64834f10','82f85017-3b6c-4e99-8e1f-624e64834f11','82f85017-3b6c-4e99-8e1f-624e64834f12','82f85017-3b6c-4e99-8e1f-624e64834f13','82f85017-3b6c-4e99-8e1f-624e64834f14','82f85017-3b6c-4e99-8e1f-624e64834f15','82f85017-3b6c-4e99-8e1f-624e64834f16'].map((id,i)=>Object.freeze({id,purpose:i===6?'background':'dialogue',limit:i===6?2:6})))})
const fail=code=>{throw Object.assign(Error(code),{code})}
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
module.exports={PROFILE,validate,assertTime,reserve}
