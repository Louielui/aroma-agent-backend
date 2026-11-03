'use strict'
const path=require('node:path'),usage=require('../../actions/usageBudget'),{createStore}=require('../../actions/store')
const OWNER={id:'owner',role:'owner'}
function createRepositoryBudget({dir,root=null,extensionIdle=()=>false,extensionWitness=null}){
 const store=createStore({dir}),budgets=new Map(),git=root?args=>require('node:child_process').execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim():null,bootCommit=git?git(['rev-parse','HEAD']):null
 const witness=(id,workId)=>{
  if(extensionWitness)return extensionWitness(id,workId)
  if(!git)throw Error('usage_extension_unavailable')
  const r=require('../operating/runStore').createRunStore({dir:path.join(dir,'../project-runs'),workflow:'project_work'}).get(workId)
  if(r?.workOrder.usageRoot!==id||r.workOrder.registrationId!==id||r.workOrder.delivery!=='owner_deployment_package_required'||git(['rev-parse','HEAD'])!==bootCommit)throw Error('usage_binding_conflict')
  // The launcher overlay is retained separately; executable budget/worker source
  // must still be the exact boot tree before any additional dispatch.
  if(git(['diff','HEAD','--','src/actions','src/core/projectTasks','src/core/projectWork','src/subscription','src/workers/execution','scripts/subscription/startBridge.js']))throw Error('usage_binding_conflict')
  let eligible=false;try{require('../projectWork/recovery').eligible(r);eligible=true}catch{/* Coding/completed work cannot prepare another grant. */}
  return{workId,commit:bootCommit,approvalHash:r.approvalHash,eligible,idle:extensionIdle()===true}
 }
 const get=id=>{if(!budgets.has(id))budgets.set(id,usage.createUsageBudget({profile:usage.developmentProfile(id),store,evidenceDir:path.join(dir,'evidence'),activationReady:()=>true,extensionWitness:root||extensionWitness?workId=>witness(id,workId):null}));return budgets.get(id)}
 return {
  activate(id){const b=get(id);if(b.status().state!=='not_activated')throw Error('usage_attempt_replayed');b.handle(OWNER,{op:'usage_activate'});b.handle(OWNER,{op:'usage_bind_turn',turnId:id,conversationId:id});return b.enterTurn(id,id,id)},
  status:id=>get(id).status(),
  actions:id=>({handle:(actor,input)=>get(id).handle(actor,input)}),
  phase:(id,workId,purpose,fn)=>get(id).withAllocation(workId,purpose,fn),
  extensionForRecovery(id,workId){const s=get(id).status();if(!s.extension)return null;const m=s.extension.material,w=witness(id,workId);if(m.workId!==workId||m.commit!==w.commit||m.approvalHash!==w.approvalHash||Date.now()>=s.extension.expiresAt||s.attempts.some(a=>a.extensionId))throw Error('usage_binding_conflict');return{extensionId:s.extension.id,hash:s.extension.hash,commit:m.commit,expiresAt:s.extension.expiresAt}},
  async run(id,fn){const b=get(id),s=b.status();if(s.state!=='active'||s.helper.unresolved)throw Error('usage_unresolved_work');const t=s.turns.find(t=>t.id===id);if(!t?.entered||t.finished)throw Error('usage_scope_required');return b.withScope({rootId:id,turnId:id,conversationId:id,requestId:id,childId:null},fn)}
 }
}
module.exports={createRepositoryBudget}
