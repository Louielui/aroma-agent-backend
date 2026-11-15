'use strict'
// A closed adapter into Project Tasks/Work, not a second queue or executor.
// No inference or workflow starts on status, request, continuation or reads.
const {ID}=require('../actions/contract'),presentation=require('../core/projectWork/presentation')
const taskShapes={list:[],get:['id'],find:['requestId'],request:['requestId','goal','bootCommit'],continue:['id','requestId'],inventory:['id'],scope:['id','bootCommit','criteria','editable','readonly'],authorize:['id','hash','nonce'],renew:['id'],approve:['id','hash','nonce'],prepare:['id','requestId'],cancel:['id']}
const workShapes={list:[],get:['id'],evidence:['id','part','offset','patchHash'],renew:['id'],approve:['id','hash','nonce'],cancel:['id'],prepareRecovery:['id','requestId','bootCommit'],approveRecovery:['id','hash','nonce']}
const exact=(b,ks)=>b&&typeof b==='object'&&!Array.isArray(b)&&Object.keys(b).sort().join(',')===ks.slice().sort().join(',')
function validInput(b){
 if(exact(b,['op'])&&b.op==='status')return true
 if(!exact(b,['target','input'])||!['task','work'].includes(b.target))return false
 const v=b.input,shapes=b.target==='task'?taskShapes:workShapes;if(!v||!Object.hasOwn(shapes,v.op))return false
 let keys=['op',...shapes[v.op]];if(b.target==='work'&&v.op==='evidence'&&['before','after'].includes(v.part))keys.push('file')
 if(!exact(v,keys)||JSON.stringify(v).length>65536)return false
 if(Object.hasOwn(v,'id')&&!ID.test(v.id||'')||Object.hasOwn(v,'requestId')&&!ID.test(v.requestId||'')||Object.hasOwn(v,'bootCommit')&&!/^[a-f0-9]{40}$/.test(v.bootCommit||''))return false
 if(Object.hasOwn(v,'hash')&&(!/^[a-f0-9]{64}$/.test(v.hash||'')||!/^[a-f0-9]{48}$/.test(v.nonce||'')))return false
 return true
}
function createControlledDispatch({projectTasks,projectWork,enabled=()=>false,executionReady=()=>false,otherActive=()=>false,bootCommit}={}){
 const owner=a=>{if(a?.id!=='owner'||a.role!=='owner')throw Error('permission_denied')}
 const task=r=>{if(!r||r.kind!=='repository_repair'||r.workflow!=='project_task')throw Error('controlled_scope_required');return r}
 const work=r=>{if(!r?.workOrder||!ID.test(r.workOrder.usageRoot||'')||r.workOrder.delivery!=='owner_deployment_package_required')throw Error('controlled_scope_required');return r}
 async function handle(actor,b){
  owner(actor);if(!validInput(b))throw Error('invalid_request')
  if(b.op==='status')return{component:'controlled-dispatch',protocol:'controlled-repository-dispatch-v1',state:enabled()?'connected':'disabled',checkedAt:new Date().toISOString(),bootCommit,inferenceStarted:false,requiresScopeApproval:true,requiresUsageApproval:true,requiresCodingApproval:true,automaticDeployment:false,cloudFallback:false,workerInference:'explicit_subscription_work_only'}
  if(!enabled())throw Error('controlled_dispatch_disabled')
  const v=b.input,{op,...body}=v;if(v.bootCommit&&v.bootCommit!==bootCommit)throw Error('source_changed')
  if(!['list','get','find','evidence','cancel','request','continue','inventory'].includes(op)&&otherActive(b.target))throw Error('worker_busy')
  if(b.target==='task'&&v.op==='authorize'||b.target==='work'&&['approve','approveRecovery'].includes(v.op)){
   let idle=false;try{idle=executionReady()===true}catch{/* Unknown background state cannot authorize inference. */}
   if(!idle)throw Error('controlled_background_not_idle')
  }
  if(b.target==='task'){
   if(v.op==='list'){const r=projectTasks.list(actor);return{...r,runs:r.runs.filter(x=>{const value=projectTasks.get(actor,x.id).run;if(!value)throw Error('controlled_dispatch_unavailable');return value.kind==='repository_repair'&&value.workflow==='project_task'})}}
   if(v.op==='find'){const r=projectTasks.find(actor,body);if(r.run)task(r.run);return r}
   if(v.op!=='request')task(projectTasks.get(actor,v.id).run)
   const result=await projectTasks[op](actor,['get','cancel'].includes(op)?body.id:body);if(result.run)task(result.run);return result
  }
  if(v.op==='list')return presentation.list(projectWork.list(actor).filter(r=>ID.test(r?.workOrder?.usageRoot||'')&&r.workOrder.delivery==='owner_deployment_package_required'))
  const r=work(projectWork.get(actor,v.id))
  if(v.op==='get')return{run:presentation.present(r)}
  if(v.op==='evidence')return{evidence:presentation.evidence(r,v)}
  const result=await projectWork[op](actor,op==='cancel'?body.id:body)
  return result?.run?{...result,run:presentation.present(work(result.run))}:{run:presentation.present(work(result))}
 }
 return{handle}
}
module.exports={createControlledDispatch,validInput}
