'use strict'
// A reviewed Owner-host entry, not an LLM tool or an approval-file importer.
// Inspect is read-only. Approval requires a real interactive Owner terminal,
// full SHA + material hash typed after all three distinct decisions are shown.
const path=require('node:path'),os=require('node:os')
const {createCoordinator}=require('../../src/repositoryPromotion/coordinator')
const {promotionDirectory}=require('../../src/repositoryPromotion/paths')
const {createPromotionActions}=require('../../src/repositoryPromotion/authorization')
const {createStore}=require('../../src/actions/store')
const {createGateway}=require('../../src/actions/service')
const {hash}=require('../../src/actions/contract')
function argumentsOf(args){
 const mode=args.shift(),options={}
 if(!['inspect','approve'].includes(mode))throw Error('invalid_promotion_entry_mode')
 while(args.length){const key=args.shift(),value=args.shift();if(!['--candidate','--pr','--evidence-run','--readiness'].includes(key)||!value||Object.hasOwn(options,key))throw Error('invalid_promotion_entry_argument');options[key]=value}
 if(Object.keys(options).length!==4||!/^[a-f0-9]{40}$/.test(options['--candidate'])||!/^\d{1,8}$/.test(options['--pr'])||!/^[a-f0-9-]{36}$/.test(options['--evidence-run'])||!/^[a-f0-9-]{36}$/.test(options['--readiness']))throw Error('invalid_promotion_entry_argument')
 return{mode,options:{commit:options['--candidate'],pr:Number(options['--pr']),evidenceRunId:options['--evidence-run'],readinessId:options['--readiness']}}
}
function interactiveOwner(input=process.stdin,output=process.stdout,platform=process.platform,user=os.userInfo()){
 return platform==='win32'&&input.isTTY===true&&output.isTTY===true&&user.username.toLowerCase()==='louis'&&path.resolve(user.homedir).toLowerCase()===path.resolve('C:/Users/louis').toLowerCase()
}
async function main(){
 const {mode,options}=argumentsOf(process.argv.slice(2))
 if(mode==='approve'&&!interactiveOwner())throw Error('interactive_owner_terminal_required')
 const root=path.resolve(__dirname,'../..'),artifacts=promotionDirectory(),coordinator=createCoordinator({root,runtimeRoot:'C:/Aroma/aroma-agent-backend',artifacts})
 const inspected=await coordinator.inspectCommitted(options),material=inspected.material,materialHash=hash(material)
 console.log(JSON.stringify({mode:'inspection',material,materialHash,hold:'retained',grantsIssued:0,consequences:'Exact PR merge; local assistant/owned bridge reload; existing managed client publication; verification and conditional exact-source rollback. No business writes, model calls, API fallback or ACL changes.'},null,2))
 if(mode==='inspect')return
 console.log('Three independent decisions: (1) scope exception for these exact paths; (2) release Hold for this exact commit once; (3) authorize only the listed deployment operations. All expire after 10 minutes; replay is refused. A process restart invalidates unclaimed approvals. No blank/default answer approves anything.')
 const prompt=require('node:readline/promises').createInterface({input:process.stdin,output:process.stdout})
 let answer;try{answer=await prompt.question('Type AUTHORIZE '+material.commit+' '+materialHash+' to confirm all three, or anything else to stop: ')}finally{prompt.close()}
 if(answer!=='AUTHORIZE '+material.commit+' '+materialHash)throw Error('owner_declined')
 const fresh=await coordinator.inspectCommitted(options)
 if(hash(fresh.material)!==materialHash)throw Error('approval_material_changed')
 const store=createStore({dir:path.join(artifacts,'approval-actions')}),promotion=createPromotionActions({store}),gateway=createGateway({store,promotion,scheduler:{}}),actor={id:'owner',role:'owner'},ids={}
 for(const [kind,key]of [['scope','scope'],['hold_release','hold'],['deployment','deployment']]){
  const {run}=await gateway.handle(actor,{op:'promotion_prepare',material,decision:kind})
  await gateway.handle(actor,{op:'promotion_approve',id:run.id,hash:run.hash,nonce:run.nonce,commit:material.commit,decision:kind});ids[key]=run.id
 }
 const authority=promotion.claim(actor,ids,material)
 const first=await coordinator.promoteCommitted(options,authority)
 const result=await require('../../src/repositoryPromotion/workflow').waitForIdle(first,{coordinator})
 console.log(JSON.stringify({id:result.id,state:result.state,reason:result.reason||null,sourceEvidenceRunId:result.evidenceSourceRunId,commit:result.merge?.commit||result.committed?.commit,verified:result.runtime?.verified===true}))
 if(result.state!=='complete')process.exitCode=1
}
if(require.main===module)main().catch(error=>{console.error(/^[a-z_]+$/.test(error.message)?error.message:'promotion_entry_unavailable');process.exitCode=1})
module.exports={argumentsOf,interactiveOwner}
