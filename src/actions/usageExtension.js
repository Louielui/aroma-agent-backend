'use strict'
// Additional capacity on an existing repository budget, never a second ledger.
const {hash,ID}=require('./contract')
const MODELS=Object.freeze({coding:{model:'gpt-6.1-sol',effort:'high'},result_review:{model:'claude-sonnet-5-5',effort:'medium'}})
const fail=code=>{throw Object.assign(Error(code),{code})}
function validGrant(r,profileHash){
 const g=r.extension;if(!g)return true
 const m=g.material
 return g.kind==='repository_usage_extension_v1'&&ID.test(g.id||'')&&g.hash===hash(m)&&m?.rootId===r.id&&m.profileHash===profileHash&&m.baseHelpers===8&&m.extraHelpers===2&&m.website===0&&m.turns===1&&ID.test(m.workId||'')&&/^[a-f0-9]{40}$/.test(m.commit||'')&&/^[a-f0-9]{64}$/.test(m.approvalHash||'')&&
  Number.isSafeInteger(g.appliedAt)&&Number.isSafeInteger(g.expiresAt)&&g.expiresAt>g.appliedAt&&g.expiresAt<=g.appliedAt+3600000&&g.expiresAt<=m.useUntil&&
  r.attempts.slice(0,8).length===8&&r.attempts.slice(0,8).every(a=>a.kind==='helper'&&!a.extensionId&&!['reserved','dispatched'].includes(a.state))&&hash(r.attempts.slice(0,8))===m.attemptsHash&&
  r.timeline.filter(e=>e.event==='extension_applied'&&e.extensionId===g.id&&e.hash===g.hash).length===1&&
  r.attempts.slice(8).every(a=>a.kind==='helper'&&a.extensionId===g.id&&Object.hasOwn(MODELS,a.allocation)&&Object.entries(MODELS[a.allocation]).every(([k,v])=>a[k]===v)&&Date.parse(a.reservedAt)>=g.appliedAt&&Date.parse(a.reservedAt)<g.expiresAt)&&new Set(r.attempts.slice(8).map(a=>a.allocation)).size===r.attempts.slice(8).length
}
function witnessFor(witness,workId){
 if(typeof witness!=='function')fail('usage_extension_unavailable')
 let w;try{w=witness(workId)}catch{fail('usage_binding_conflict')}
 if(w?.workId!==workId||!/^[a-f0-9]{40}$/.test(w.commit||'')||!/^[a-f0-9]{64}$/.test(w.approvalHash||''))fail('usage_binding_conflict')
 return w
}
function assertDispatch(r,witness,allocation,now,input){
 const g=r.extension,m=g.material
 if(now>=g.expiresAt)fail('usage_extension_expired')
 const w=witnessFor(witness,m.workId)
 if(w.commit!==m.commit||w.approvalHash!==m.approvalHash)fail('usage_binding_conflict')
 if(!allocation||allocation.workId!==m.workId||!Object.hasOwn(MODELS,allocation.purpose))fail('usage_allocation_required')
 if(Object.entries(MODELS[allocation.purpose]).some(([k,v])=>input[k]!==v))fail('usage_model_not_allowed')
 if(r.attempts.some(a=>a.extensionId===g.id&&a.allocation===allocation.purpose))fail('usage_allocation_exhausted')
 return{extensionId:g.id,allocation:allocation.purpose}
}
module.exports={MODELS,validGrant,witnessFor,assertDispatch}
