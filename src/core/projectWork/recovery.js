'use strict'
// Same-record coding recovery. No new registration, allowance or execution lane.
const {digest}=require('../../workers/execution/windowsSandbox'),{ID}=require('../operating/runStore')
const RETRYABLE=new Set(['subscription_unavailable','subscription_invalid_output','worker_timeout','claude_unavailable'])
function failure(r){
 const value={}
 for(const key of ['id','workflow','state','reason','finishedAt','workOrder','source','approvalHash','failureDiagnostic','workerRuns','attempts','result','appliedToLive'])if(Object.hasOwn(r,key))value[key]=structuredClone(r[key])
 value.steps=r.steps.filter(s=>!s.stage.startsWith('coding_recovery_'))
 return value
}
function eligible(r){
 const w=r?.workOrder
 if(!r||r.workflow!=='project_work'||r.state!=='failed'||!RETRYABLE.has(r.reason)||r.appliedToLive!==false||r.result||r.review||r.attempts?.length||r.repairOf||Object.hasOwn(r,'liveBaseline')||
  !ID.test(w?.usageRoot||'')||w.usageRoot!==w.registrationId||w.delivery!=='owner_deployment_package_required'||w.effort!=='high'||
  !r.steps.some(s=>s.stage==='approved'&&s.facts?.actor==='owner'&&s.facts.hash===r.approvalHash)||!r.steps.some(s=>s.stage==='coding')||
  r.workerRuns?.some(a=>!a.finishedAt||a.state!=='failed'))throw Error('recovery_unavailable')
 return failure(r)
}
function allowance(budget,root){
 if(!budget)throw Error('recovery_unavailable')
 const s=budget.status(root),turn=s.turns?.find(t=>t.id===root)
 if(s.id!==root||s.state!=='active'||s.identity!=='owner-repository-repair:'+root||!turn?.entered||turn.finished||turn.conversationId!==root||turn.requestId!==root)throw Error('usage_run_not_active')
 if(s.helper.unresolved)throw Error('usage_unresolved_work')
 if(s.helper.available<2)throw Error('usage_limit_reached')
 if(s.limits.turns!==1||s.limits.helper!==8||s.limits.website!==0||s.website.reserved!==0)throw Error('usage_binding_conflict')
 return{rootId:root,limits:s.limits,attemptsHash:digest(JSON.stringify(s.attempts)),helperReserved:s.helper.reserved,minimumHelpers:2}
}
function rebind(r,definition,current,bootCommit){
 const changed=()=>{throw Error('source_changed')},w=r.workOrder
 if(JSON.stringify(definition.workOrder)!==JSON.stringify(w)||current.evidence.bootCommit!==bootCommit||current.evidence.revision!==bootCommit||current.order.sourceRevision!==bootCommit||! /^[a-f0-9]{40}$/.test(bootCommit||''))changed()
 if(current.hash!==digest(JSON.stringify(current.evidence))||r.source.hash!==digest(JSON.stringify(r.source.evidence)))changed()
 const originalEvidence=structuredClone(r.source.evidence)
 if(JSON.stringify({...originalEvidence,revision:bootCommit,bootCommit})!==JSON.stringify(current.evidence))changed()
 if(Object.keys(definition.tests).sort().join(',')!==current.order.tests.slice().sort().join(',')||Object.entries(definition.tests).some(([n,text])=>current.order.files[n]!==text))changed()
 const original={evidence:originalEvidence,hash:r.source.hash,order:{...current.order,sourceRevision:originalEvidence.revision}}
 // Reconstruct and verify the *original* sealed hash. A changed goal, protected
 // test, file, scope or receipt cannot become a rebase merely by using a new SHA.
 if(digest(JSON.stringify({workOrder:w,snapshot:original}))!==r.approvalHash)changed()
 return original
}
module.exports={failure,eligible,allowance,rebind}
