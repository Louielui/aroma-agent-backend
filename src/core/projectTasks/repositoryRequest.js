'use strict'
// Intake and resumption extend Project Tasks; they do not start another worker
// system. Approval grants, generated tests and coding remain separate stages.
const {randomUUID}=require('node:crypto'),{digest}=require('../../workers/execution/windowsSandbox')
const {ID}=require('../operating/runStore'),{keys,request:validate,definition}=require('./contract')
const {createOwnerApprovalStore}=require('../../agent/ownerApprovalStore')
const owner=a=>{if(a?.id!=='owner'||a.role!=='owner')throw Error('permission_denied')}
const goalKey=goal=>digest(goal.normalize('NFC').trim().replace(/\r\n/g,'\n'))
const nextAction=r=>r.workRunId?'view_coding_result':({awaiting_scope:'select_scope',awaiting_scope_approval:'approve_scope_and_usage',awaiting_approval:'approve_tests',registered:'prepare_coding',interrupted:'inspect_interruption',failed:'inspect_failure',needs_attention:'inspect_findings'}[r.state]||'view_progress')
function createRepositoryRequests({store,enabled,lock,record,inventory,sourceFor,launch,budget,busy=()=>false,approvals=createOwnerApprovalStore()}){
 const tickets=new Map(),sessions=new Map()
 for(const r of store.all())if(r.state==='awaiting_scope_approval'){r.state='awaiting_scope';r.reason='approval_invalidated_on_restart';record(r,'scope_approval_interrupted')}
 function guarded(actor,fn){owner(actor);if(!enabled())throw Error('not_enabled');const release=lock();try{return fn()}finally{release()}}
 function view(r){return{run:r,approval:tickets.get(r.id)||null,nextAction:nextAction(r),...(r.input.scope&&budget?{usage:budget.status(r.id)}:{})}}
 function request(actor,input){return guarded(actor,()=>{
  if(!keys(input,['bootCommit','requestId','goal'])||!ID.test(input.requestId||'')||!/^[a-f0-9]{40}$/.test(input.bootCommit||'')||typeof input.goal!=='string'||!input.goal.trim()||input.goal.length>12000||input.goal.includes('\0'))throw Error('invalid_request')
  const key=goalKey(input.goal),rows=store.all(),prior=rows.find(r=>r.requestId===input.requestId||r.requestIds?.includes(input.requestId))
  if(prior){if(goalKey(prior.input.goal)!==key)throw Error('request_conflict');return view(prior)}
  const matches=rows.filter(r=>goalKey(r.input.goal)===key)
  if(matches.length>1)throw Error('task_selection_required')
  if(matches.length){const r=matches[0];if((r.requestIds?.length||0)>=128)throw Error('request_limit');r.requestIds=[...(r.requestIds||[r.requestId]),input.requestId];record(r,'owner_continued',{requestId:input.requestId,automaticExecution:false});return view(r)}
  const r={id:randomUUID(),workflow:'project_task',kind:'repository_repair',state:'awaiting_scope',requestId:input.requestId,requestIds:[input.requestId],input:{...input,criteria:[],editable:[]},startedAt:new Date().toISOString(),steps:[],sections:[],registration:null,workRunId:null}
  record(r,'requested',{actor:'owner',model:'gpt-6.1-sol',effort:'high',modelSent:false,appliedToLive:false});return view(r)
 })}
 function continued(actor,input){return guarded(actor,()=>{if(!keys(input,['id','requestId'])||!ID.test(input.id||'')||!ID.test(input.requestId||''))throw Error('invalid_request');const r=store.get(input.id);if(!r)throw Error('task_not_found');if(!r.requestIds?.includes(input.requestId)){if((r.requestIds?.length||0)>=128)throw Error('request_limit');if(store.all().some(other=>other.id!==r.id&&(other.requestId===input.requestId||other.requestIds?.includes(input.requestId))))throw Error('request_conflict');r.requestIds=[...(r.requestIds||[r.requestId]),input.requestId];record(r,'owner_continued',{requestId:input.requestId,automaticExecution:false})}return view(r)})}
 async function scope(actor,input){owner(actor);if(!enabled())throw Error('not_enabled');if(!keys(input,['id','bootCommit','criteria','editable','readonly']))throw Error('invalid_request')
  const release=lock();try{
   const r=store.get(input.id);if(r?.kind!=='repository_repair'||!['awaiting_scope','awaiting_scope_approval'].includes(r.state)||busy())throw Error('scope_unavailable')
   if(!Array.isArray(input.readonly))throw Error('invalid_request')
   const selected=validate({bootCommit:input.bootCommit,requestId:r.requestId,goal:r.input.goal,criteria:input.criteria,editable:input.editable,scope:{profile:'repository',files:[...input.editable,...input.readonly],budgetRoot:r.id}})
   const files=await inventory.list(input.bootCommit);if(selected.scope.files.some(n=>!files.some(f=>f.path===n&&f.eligible)))throw Error('repository_package_limit')
   const d=definition(r.id,selected,{testCode:"const test=require('node:test'),assert=require('node:assert/strict');",expectedTests:3}),snapshot=await sourceFor(d).read(input.bootCommit,undefined,d.workOrder.recipe)
   require('./repositoryScope').validateSnapshot(snapshot)
   const material={input:selected,snapshot,usage:require('../../actions/usageBudget').developmentProfile(r.id),delivery:'owner_deployment_package_required'},hash=digest(JSON.stringify(material)),approvalId=randomUUID(),session=approvals.createSession()
   const sealed=approvals.seal({workOrder:{approvalId,workOrderHash:hash,...material},proposalId:r.id});if(!sealed.ok)throw Error('approval_unavailable')
   r.input=selected;r.scopeMaterial=material;r.scopeApproval={id:approvalId,hash,expiresAt:sealed.record.expiresAt};r.state='awaiting_scope_approval';record(r,'scope_prepared',{hash,modelSent:false})
   sessions.set(r.id,session);tickets.set(r.id,{id:r.id,hash,nonce:approvals.issueNonce({approvalId,workOrderHash:hash,sessionId:session}),expiresAt:sealed.record.expiresAt});return view(r)
  }finally{release()}
 }
 async function authorize(actor,input){owner(actor);if(!enabled())throw Error('not_enabled');if(!keys(input,['id','hash','nonce']))throw Error('invalid_request')
  const release=lock();try{
   const r=store.get(input.id);if(r?.state!=='awaiting_scope_approval'||busy())throw Error('approval_unavailable')
   const a=r.scopeApproval,sealed=approvals.loadSealed(a.id)
   if(!sealed.ok||a.hash!==input.hash||digest(JSON.stringify(r.scopeMaterial))!==input.hash||JSON.stringify(r.input)!==JSON.stringify(r.scopeMaterial.input)||JSON.stringify(sealed.record.workOrder.input)!==JSON.stringify(r.input))throw Error('approval_unavailable')
   const d=definition(r.id,r.input,{testCode:"const test=require('node:test'),assert=require('node:assert/strict');",expectedTests:3});await sourceFor(d).verify(r.scopeMaterial.snapshot)
   if(!enabled())throw Error('not_enabled');if(busy())throw Error('worker_busy')
   if(!approvals.consumeNonce({nonce:input.nonce,approvalId:a.id,displayedHash:input.hash,sessionId:sessions.get(r.id)}).ok)throw Error('approval_unavailable')
   tickets.delete(r.id);r.scopeGrant={hash:input.hash,actor:'owner',at:new Date().toISOString()};r.state='queued';record(r,'scope_authorized',{hash:input.hash,helperLimit:8,websiteLimit:0})
   try{budget.activate(r.id);launch(r)}catch(e){r.state='interrupted';r.reason='scope_launch_uncertain';record(r,'scope_launch_interrupted');throw e}return view(store.get(r.id))
  }finally{release()}
 }
 return{request,continue:continued,scope,authorize,view,async inventory(actor,id){owner(actor);const r=store.get(id);if(!r||r.kind!=='repository_repair')throw Error('invalid_request');return{files:await inventory.list(r.input.bootCommit)}}}
}
module.exports={createRepositoryRequests,goalKey,nextAction}
