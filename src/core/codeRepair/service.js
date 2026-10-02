'use strict'
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto')
const {createOwnerApprovalStore}=require('../../agent/ownerApprovalStore'),{register}=require('../../capability/registry'),{registerAgent}=require('../../capability/agents'),{evaluate}=require('../../capability/policy'),{createDispatcher}=require('../../capability/dispatcher')
const {ID}=require('../operating/runStore'),{SOURCE_REVISION,readProfile,createWorkspace,checkScope,applyReplacements}=require('./workspace'),{RECIPES,replacement}=require('./recipes'),{WORK_ORDER,SCHEMA,SYSTEM,hash}=require('./contract'),{SOURCE}=require('./acceptance'),{runAcceptance}=require('./runner')
const OWNER=Object.freeze({id:'owner',role:'owner'}),ACTIVE=new Set(['checking','running']),SAFE=new Set(['evidence_changed','recipe_source_changed','context_unavailable','source_sensitive','scope_changed','sandbox_failed','test_evidence_unavailable','baseline_not_red','invalid_worker_result','subscription_limit_reached','subscription_login_required','subscription_model_unavailable','subscription_unavailable','subscription_invalid_output','policy_denied','cancelled','timed_out','run_store_unavailable'])
const safe=e=>SAFE.has(e.code||e.message)?(e.code||e.message):'workflow_unavailable'
const request=()=>({capabilityId:'CodeRepair',version:1,target:'dev',context:{data_domains:['local_development_code'],description:WORK_ORDER.goal}})
function createCodeRepair ({repo,root,store,provider,read=readProfile,test=runAcceptance,loadDiagnosis=id=>JSON.parse(fs.readFileSync(path.join(repo,'data/code-diagnosis-runs',id+'.json'),'utf8')),onFinish=()=>({state:'not_connected'}),timeoutMs=150000,clock=()=>new Date().toISOString()}) {
 if(!store||!provider||!repo||!root)throw Error('repair_not_configured')
 register({id:'CodeRepair',version:1,lifecycle:'active',risk_tier:'high',input_schema:{},output_schema:SCHEMA})
 registerAgent({id:WORK_ORDER.worker,role:'Fixed isolated repair catalogue',adapter:'bounded-subscription-text',availability:'local',status:'active',provides:[{capability:'CodeRepair',version:1,seed_quality:0,seed_cost:'unknown'}]})
 const approvals=createOwnerApprovalStore(),sessionId=approvals.createSession(),rows=new Map(),controls=new Map();let active=null
 const owner=a=>{if(a?.id!==OWNER.id||a.role!==OWNER.role)throw Error('permission_denied')}
 const save=r=>{try{store.save(r);rows.set(r.id,structuredClone(r))}catch(_){throw Error('run_store_unavailable')}}
 const record=(r,stage,facts={})=>{r.steps.push({sequence:r.steps.length+1,at:clock(),stage,...facts});r.updatedAt=clock();save(r)}
 for(const row of store.all()){if(ACTIVE.has(row.state)||row.state==='awaiting_approval'){row.state='interrupted';row.reason='service_restarted';row.result=null;record(row,'interrupted')}rows.set(row.id,row)}
 const get=(actor,id)=>{owner(actor);if(!ID.test(id||''))throw Error('invalid_run_id');return structuredClone(rows.get(id)||null)}
 const list=actor=>{owner(actor);return [...rows.values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,25).map(r=>({id:r.id,state:r.state,reason:r.reason,startedAt:r.startedAt,diagnosisId:r.diagnosisId}))}
 const seal=r=>hash(JSON.stringify({workOrder:r.workOrder,diagnosisId:r.diagnosisId,diagnosisHash:r.diagnosisHash,revision:r.source.revision,headCommit:r.source.headCommit,sourceHash:r.source.hash,testHash:hash(SOURCE),baselineHash:hash(JSON.stringify(r.baseline))}))
 async function receipt(r){try{const value=await onFinish(structuredClone(r));r.memoryReceipt=['queued','saved','not_connected'].includes(value?.state)?value.state:'unavailable';save(r)}catch(_){r.memoryReceipt='unavailable';rows.set(r.id,structuredClone(r))}}
 function launch(r,fn){active=r.id;const c={abort:new AbortController(),reason:null};controls.set(r.id,c);const timer=setTimeout(()=>{c.reason='timed_out';c.abort.abort()},timeoutMs)
  const check=()=>{if(c.abort.signal.aborted)throw Error(c.reason);owner(OWNER)}
  const step=async call=>{check();let listener;const stopped=new Promise((resolve,reject)=>{listener=()=>reject(Error(c.reason));c.abort.signal.addEventListener('abort',listener,{once:true})});try{const out=await Promise.race([Promise.resolve().then(()=>{check();return call()}),stopped]);check();return out}finally{c.abort.signal.removeEventListener('abort',listener)}}
  c.promise=(async()=>{try{await fn({check,step,signal:c.abort.signal})}catch(e){r.state=c.reason||'failed';r.reason=safe(e);r.result=null;record(r,r.state)}finally{if(r.state!=='awaiting_approval'){r.finishedAt=clock();await receipt(r)}clearTimeout(timer);active=null;controls.delete(r.id)}})().catch(()=>{r.state='failed';r.reason='run_store_unavailable';r.result=null;rows.set(r.id,structuredClone(r))})
 }
 function prepare(actor,input){owner(actor)
  if(!input||Object.keys(input).sort().join(',')!=='bootCommit,diagnosisId,requestId'||!ID.test(input.requestId||'')||!ID.test(input.diagnosisId||'')||!/^[a-f0-9]{40}$/.test(input.bootCommit||''))throw Error('invalid_request')
  const old=[...rows.values()].find(r=>r.requestId===input.requestId);if(old){if(old.diagnosisId!==input.diagnosisId||old.sourceBoot!==input.bootCommit)throw Error('request_conflict');return {...structuredClone(old),reused:true}}
  if(active)throw Error('worker_busy')
  const policy=evaluate(request());if(policy.verdict==='deny')throw Error('policy_denied')
  const diagnosis=loadDiagnosis(input.diagnosisId)
  const proposal=diagnosis?.result&&{summary:diagnosis.result.summary,findings:diagnosis.result.findings,limitations:diagnosis.result.limitations}
  if(diagnosis?.state!=='completed'||diagnosis.workflow!=='code_diagnosis'||diagnosis.evidence?.revision!==SOURCE_REVISION||diagnosis.verification?.citationsVerified!==true||!proposal?.findings?.length||!require('../codeDiagnosis/contract').validateResult(proposal,diagnosis.evidence))throw Error('unsupported_diagnosis')
  const r={id:randomUUID(),workflow:'code_repair',requestId:input.requestId,diagnosisId:input.diagnosisId,diagnosisHash:hash(JSON.stringify(diagnosis)),sourceBoot:input.bootCommit,actor:'owner',workOrder:WORK_ORDER,state:'checking',reason:null,startedAt:clock(),finishedAt:null,steps:[],sections:[],source:null,baseline:null,result:null}
  record(r,'owner_requested');record(r,'policy_checked',{verdict:policy.verdict,rule_id:policy.rule_id})
  launch(r,async({step,check})=>{r.source=await step(()=>read(repo,input.bootCommit));r.workspace=createWorkspace(root,r.source);record(r,'source_verified',{revision:r.source.revision,headCommit:r.source.headCommit,sourceHash:r.source.hash})
   r.baseline=await step(()=>test({dir:r.workspace}));checkScope(r.workspace,r.source);record(r,'baseline_measured',{tests:r.baseline.tests,fail:r.baseline.fail})
   if(r.baseline.tests!==7||r.baseline.fail!==6||r.baseline.pass!==1||r.baseline.skipped!==0||r.baseline.cancelled!==0||r.baseline.exitCode!==1)throw Error('baseline_not_red')
   check();r.plan=RECIPES;r.approvalHash=seal(r);const order={...WORK_ORDER,approvalId:r.id,workOrderHash:r.approvalHash}
   const sealed=approvals.seal({workOrder:order,proposalId:r.id});if(!sealed.ok)throw Error('approval_unavailable')
   r.approval={hash:r.approvalHash,nonce:approvals.issueNonce({approvalId:r.id,workOrderHash:r.approvalHash,sessionId}),expiresAt:new Date(sealed.record.expiresAt).toISOString(),consumed:false};r.state='awaiting_approval';record(r,'awaiting_approval')
  });return get(actor,r.id)
 }
 function approve(actor,input){owner(actor);if(!input||Object.keys(input).sort().join(',')!=='hash,id,nonce'||!ID.test(input.id||'')||!/^[a-f0-9]{64}$/.test(input.hash||'')||typeof input.nonce!=='string')throw Error('invalid_request')
  if(active)throw Error('worker_busy');const r=rows.get(input.id);if(!r||r.state!=='awaiting_approval')throw Error('approval_unavailable')
  const used=approvals.consumeNonce({nonce:input.nonce,approvalId:r.id,displayedHash:input.hash,sessionId});if(!used.ok){if(input.nonce===r.approval.nonce){r.approval.consumed=true;r.approval.actor='owner';r.approval.decidedAt=clock();record(r,'approval_rejected',{reason:used.reason})}throw Error('approval_unavailable')}
  if(input.hash!==seal(r)||input.hash!==r.approvalHash)throw Error('evidence_changed')
  r.approval.consumed=true;r.approval.decidedAt=clock();r.approval.actor='owner';r.state='running';record(r,'owner_approved',{hash:input.hash,actor:'owner',singleUse:true})
  launch(r,async({step,check,signal})=>{
   const fresh=await step(()=>read(repo,r.sourceBoot));if(fresh.hash!==r.source.hash||fresh.headCommit!==r.source.headCommit||hash(JSON.stringify(loadDiagnosis(r.diagnosisId)))!==r.diagnosisHash)throw Error('evidence_changed');checkScope(r.workspace,r.source)
   record(r,'subscription_check');const ready=await step(()=>provider.preflight({signal}));if(ready.model!==WORK_ORDER.model||ready.billing!==WORK_ORDER.billing)throw Error('invalid_worker_result')
   const dispatcher=createDispatcher({allowedAgentIds:[WORK_ORDER.worker],fallback:false,runContext:{appendStage:(stage,facts)=>{check();record(r,stage,facts)}},adapters:{[WORK_ORDER.worker]:{health:()=>({availability:'up',latencyMs:0}),invoke:async()=>{
    const reply=await step(()=>provider.complete(JSON.stringify({workOrder:WORK_ORDER,source:r.source,baseline:r.baseline,recipes:RECIPES}),{system:SYSTEM,signal,responseFormat:{type:'json_schema',name:'controlled_repair',schema:SCHEMA}}))
    if(reply.model!==WORK_ORDER.model||reply.billing!==WORK_ORDER.billing||typeof reply.text!=='string'||reply.text.length>8000)throw Error('invalid_worker_result')
    let decision;try{decision=JSON.parse(reply.text)}catch(_){throw Error('invalid_worker_result')}
    if(Object.keys(decision).sort().join(',')!=='decision,recipeIds,summary'||!['apply','decline'].includes(decision.decision)||typeof decision.summary!=='string'||!decision.summary.trim()||decision.summary.length>4000||!Array.isArray(decision.recipeIds)||decision.recipeIds.some(id=>!RECIPES.some(x=>x.id===id)))throw Error('invalid_worker_result')
    return {ok:true,output:decision,cost:null}
   }}}})
   const dispatch=await step(()=>dispatcher.dispatch({...request(),input:{}},{approved:true,approvedBy:'owner',workOrderHash:r.approvalHash}));if(dispatch.status!=='ok')throw Error(SAFE.has(dispatch.error)?dispatch.error:'invalid_worker_result')
   r.workerDecision=dispatch.output;record(r,'worker_returned',{worker:dispatch.agentId,model:WORK_ORDER.model,cost:null})
   if(r.workerDecision.decision==='decline'){r.state='needs_attention';r.reason='worker_declined';record(r,'worker_declined');return}
   if([...new Set(r.workerDecision.recipeIds)].sort().join(',')!==RECIPES.map(x=>x.id).sort().join(',')||r.workerDecision.recipeIds.length!==RECIPES.length)throw Error('invalid_worker_result')
   const replacements={summary:r.workerDecision.summary,files:r.source.files.filter(f=>f.mutable).map(f=>({path:f.path,content:replacement(f.path,f.content)}))}
   const changes=applyReplacements(r.workspace,r.source,replacements);record(r,'fixed_recipes_applied',{files:changes.map(f=>f.path),executableOrigin:'host_reviewed_templates'})
   r.tests=await step(()=>test({dir:r.workspace}));checkScope(r.workspace,r.source,replacements.files);record(r,'tests_measured',{tests:r.tests.tests,pass:r.tests.pass,fail:r.tests.fail})
   if(r.tests.tests!==7||r.tests.pass!==7||r.tests.fail!==0||r.tests.skipped!==0||r.tests.cancelled!==0||r.tests.exitCode!==0)throw Error('test_evidence_unavailable')
   const after=await step(()=>read(repo,r.sourceBoot));if(after.hash!==r.source.hash||after.headCommit!==r.source.headCommit)throw Error('evidence_changed')
   check();r.result={summary:r.workerDecision.summary,changes,sourceRevision:r.source.revision,headCommit:r.source.headCommit,testHash:hash(SOURCE),patchHash:hash(JSON.stringify(changes)),testsExecuted:true,filesChanged:true,appliedToLive:false,productionChanged:false,worker:WORK_ORDER.worker,model:WORK_ORDER.model,billing:WORK_ORDER.billing,cost:null};r.state='completed';record(r,'completed',{patchHash:r.result.patchHash})
  });return get(actor,r.id)
 }
 function cancel(actor,id){owner(actor);const r=rows.get(id);if(!r)throw Error('run_not_found');const c=controls.get(id);if(c){c.reason='cancelled';c.abort.abort()}else if(r.state==='awaiting_approval'){r.state='cancelled';r.finishedAt=clock();record(r,'cancelled')}return get(actor,id)}
 return {prepare,approve,cancel,get,list,isActive:()=>!!active,wait:id=>controls.get(id)?.promise||Promise.resolve(),catalogue:actor=>{owner(actor);return {workOrder:WORK_ORDER,recipes:RECIPES,sourceRevision:SOURCE_REVISION,unconnected:['arbitrary_code_edits','network_isolated_model_code_execution','automatic_live_application','Claude_repair','other_projects']}}}
}
module.exports={createCodeRepair}
