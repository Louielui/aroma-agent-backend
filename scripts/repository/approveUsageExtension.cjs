'use strict'
// Owner-host only. Reuses the existing Action Gateway, sealed nonce and budget.
// Inspect is read-only; application does not launch work, merge or reload.
const fs=require('node:fs'),path=require('node:path'),{ID,hash}=require('../../src/actions/contract')
const {command}=require('../../src/repositoryPromotion/repository')
function argumentsOf(args){
 const mode=args.shift(),options={}
 if(!['inspect','approve'].includes(mode))throw Error('invalid_usage_entry_mode')
 while(args.length){const key=args.shift(),value=args.shift();if(!['--candidate','--pr','--evidence-run','--root','--work'].includes(key)||!value||Object.hasOwn(options,key))throw Error('invalid_usage_entry_argument');options[key]=value}
 if(Object.keys(options).length!==5||!/^[a-f0-9]{40}$/.test(options['--candidate'])||!/^\d{1,8}$/.test(options['--pr'])||!['--evidence-run','--root','--work'].every(k=>ID.test(options[k]||'')))throw Error('invalid_usage_entry_argument')
 return{mode,options}
}
async function main(){
 const {mode,options:o}=argumentsOf(process.argv.slice(2)),root=path.resolve(__dirname,'../..'),live='C:/Aroma/aroma-agent-backend',artifacts=require('../../src/repositoryPromotion/paths').promotionDirectory(),coordinator=require('../../src/repositoryPromotion/coordinator').createCoordinator({root,runtimeRoot:live,artifacts})
 if(mode==='approve'&&!require('./approvePromotion.cjs').interactiveOwner())throw Error('interactive_owner_terminal_required')
 let idle=false
 const dir=path.join(process.env.LOCALAPPDATA,'AromaXiangXiang/worker-flow/project-task-usage'),budget=require('../../src/core/projectTasks/repositoryBudget').createRepositoryBudget({dir,root:live,extensionIdle:()=>idle})
 async function inspect(){
  idle=false
  const candidate=require('../../src/repositoryPromotion/committedCandidate').verifiedCandidate({root,artifacts,commit:o['--candidate'],pr:Number(o['--pr']),evidenceRunId:o['--evidence-run']})
  const health=await coordinator.runtime.health(),quiet=await coordinator.runtime.idle(),commit=command(live,['rev-parse','HEAD'])
  if(health.bootCommit!==commit||command(live,['rev-parse',commit+'^{tree}'])!==candidate.committed.tree||quiet.state!=='idle_verified'||quiet.bootCommit!==commit)throw Error('usage_idle_required')
  const r=JSON.parse(fs.readFileSync(path.join(dir,'../project-runs',o['--work']+'.json'),'utf8')),s=budget.status(o['--root'])
  require('../../src/core/projectWork/recovery').eligible(r)
  if(r.id!==o['--work']||r.workOrder.usageRoot!==o['--root']||r.workOrder.registrationId!==o['--root']||s.extension||s.helper.reserved!==8||s.helper.unresolved||s.helper.limit!==8||s.website.reserved!==0)throw Error('usage_extension_unavailable')
  idle=true
  return{rootId:o['--root'],workId:r.id,candidate:o['--candidate'],runtimeCommit:commit,tree:candidate.committed.tree,attemptsHash:hash(s.attempts),profileUnchanged:true,used:8,additionalHelpers:2,totalHelperLimit:10,websiteLimit:0,allocations:{coding:'gpt-6.1-sol/high',result_review:'claude-sonnet-5-5/medium'},usageValidFor:'at most 60 minutes from sealed preparation',approvalTtlMinutes:10,dispatch:false,merge:false,deployment:false}
 }
 const preview=await inspect(),materialHash=hash(preview)
 console.log(JSON.stringify({mode:'inspection',material:preview,materialHash,grantsIssued:0},null,2));if(mode==='inspect')return
 const prompt=require('node:readline/promises').createInterface({input:process.stdin,output:process.stdout}),expected='EXTEND '+preview.rootId+' '+materialHash
 let answer;try{answer=await prompt.question('Type '+expected+' for these two additional attempts only, or anything else to stop: ')}finally{prompt.close()}
 if(answer!==expected)throw Error('owner_declined')
 if(hash(await inspect())!==materialHash)throw Error('approval_material_changed')
 const gateway=require('../../src/actions/service').createGateway({usageBudget:budget.actions(preview.rootId),scheduler:{}}),owner={id:'owner',role:'owner'}
 const {extension:p}=await gateway.handle(owner,{op:'usage_extension_prepare',workId:preview.workId,commit:preview.runtimeCommit,attemptsHash:preview.attemptsHash})
 await gateway.handle(owner,{op:'usage_extension_approve',id:p.id,hash:p.hash,nonce:p.nonce})
 const after=budget.status(preview.rootId)
 console.log(JSON.stringify({rootId:after.id,helper:after.helper,website:after.website,extensionId:after.extension.id,expiresAt:new Date(after.extension.expiresAt).toISOString(),modelsSent:0,merged:false,deployed:false}))
}
if(require.main===module)main().catch(e=>{console.error(/^[a-z_]+$/.test(e.message)?e.message:'usage_entry_unavailable');process.exitCode=1})
module.exports={argumentsOf}
