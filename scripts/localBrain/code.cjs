'use strict'
// An isolated entry into the existing coding executor and UsageBudget, not a service.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'../..'),evidence='C:/Users/louis/Documents/Codex/local-candidates/local-offline-coding-20261115'
const usage=require('../../src/actions/usageBudget'),profile=usage.LOCAL_CODING_PROFILE,fixtures=require('../../src/localBrain/codingFixtures')
const selection=require('../../src/workers/execution/localCodingProvider').SELECTION
const sha=x=>crypto.createHash('sha256').update(x).digest('hex')
function git(args){return cp.execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:15000,stdio:['ignore','pipe','pipe']}).trim()}
function material(){const files=['src/actions/usageBudget.js','src/actions/localAcceptancePolicy.js','src/adapters/LocalAdapter.js','src/workers/execution/isolatedCoding.js','src/workers/execution/localCodingProvider.js','src/workers/execution/windowsSandbox.js','src/workers/execution/sandboxGuest.cjs','src/workers/execution/packageLimits.js','src/localBrain/codingFixtures.js','src/localBrain/codingGit.js','src/localBrain/deploymentProfile.json','scripts/localBrain/code.cjs'];const value={version:1,sourceCommit:git(['rev-parse','HEAD']),selection,profile,orders:fixtures,sourceHashes:Object.fromEntries(files.map(p=>[p,sha(fs.readFileSync(path.join(root,p)))])),scope:'synthetic projects only; candidate only; no deployment, cloud, websites, background or formal-data access'};return{value,hash:sha(JSON.stringify(value))}}
async function main(argv=process.argv.slice(2)){
  if(argv.length!==1||!['inspect','run'].includes(argv[0]))throw Error('use_inspect_or_run')
  const plan=material();console.log(JSON.stringify({state:'PREPARED_NOT_ACTIVATED',hash:plan.hash,sourceCommit:plan.value.sourceCommit,selection,rootId:profile.id,tasks:2,helperCap:4,cloud:0,website:0,orders:Object.keys(fixtures)}))
  if(argv[0]==='inspect')return
  if(root.toLowerCase()==='c:\\aroma\\aroma-agent-backend'||!git(['branch','--show-current']).startsWith('codex/')||git(['status','--porcelain']))throw Error('clean_isolated_candidate_required')
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('interactive_owner_required')
  const readline=require('node:readline/promises'),rl=readline.createInterface({input:process.stdin,output:process.stdout})
  let answer;try{answer=await rl.question('Two synthetic tasks, at most four Qwen3.5 9B calls shared across both tasks and repairs; no cloud, deployment or old ledger use. Type LOCAL-CODE '+plan.hash+' to authorize this exact material: ')}finally{rl.close()}
  if(answer!=='LOCAL-CODE '+plan.hash)throw Error('owner_declined')
  if(material().hash!==plan.hash)throw Error('source_changed')
  const runDir=path.join(evidence,'acceptance-'+profile.id)
  if(fs.existsSync(runDir))throw Error('acceptance_already_exists')
  fs.mkdirSync(runDir,{recursive:true});fs.writeFileSync(path.join(runDir,'approved-material.json'),JSON.stringify({...plan,ownerConfirmedAt:new Date().toISOString()},null,2),{flag:'wx'})
  const store=require('../../src/actions/store').createStore({dir:path.join(runDir,'usage')}),budget=usage.createUsageBudget({store,profile,evidenceDir:path.join(runDir,'model-evidence'),activationReady:()=>material().hash===plan.hash,runtimeCommit:()=>git(['rev-parse','HEAD'])})
  const events=[],audit=event=>{events.push({...event,at:new Date().toISOString()});fs.writeFileSync(path.join(runDir,'events.json'),JSON.stringify(events))}
  const fetchFn=async(url,options={})=>{if(material().hash!==plan.hash)throw Error('source_changed');const u=new URL(url),method=options.method||'GET';if(u.origin!==selection.endpoint||u.search||u.hash||!(method==='GET'&&u.pathname==='/api/tags'||method==='POST'&&u.pathname==='/api/chat'))throw Error('local_cloud_inference_forbidden');audit({type:'local_transport',method,path:u.pathname});return fetch(url,{...options,redirect:'error'})}
  const provider=require('../../src/workers/execution/localCodingProvider').createLocalCodingProvider({fetchFn,onEvent:audit})
  const executor=require('../../src/workers/execution/windowsSandbox').createExecutor({root:path.join(runDir,'sandbox')})
  const ready=await executor.readiness();if(ready.ready!==true)throw Error(ready.reason||'sandbox_unavailable')
  budget.handle({id:'owner',role:'owner'},{op:'usage_local_acceptance_activate',rootId:profile.id,predecessorHash:require('../../src/actions/contract').hash([]),commit:plan.value.sourceCommit})
  const results=[]
  try{for(const [i,[name,order]]of Object.entries(fixtures).entries()){
    const slot=profile.slots[i],conversationId=crypto.randomUUID(),requestId=crypto.randomUUID();budget.handle({id:'owner',role:'owner'},{op:'usage_bind_turn',turnId:slot.id,conversationId});const scope=budget.enterTurn(slot.id,conversationId,requestId,'coding')
    try{const result=await budget.withScope(scope,async()=>{
      const worker=require('../../src/workers/execution/isolatedCoding').createIsolatedCoding({root:path.join(runDir,name,'runs'),local:true,provider,executor})
      const accepted=await worker.execute({actor:'owner',approval:worker.prepare(order,'owner'),emit:(stage,facts)=>audit({type:'coding',task:name,stage,facts})})
      if(material().hash!==plan.hash)throw Error('source_changed')
      const retained=require('../../src/localBrain/codingGit').retainCandidate({directory:path.join(runDir,name,'candidate'),order,changes:accepted.changes})
      return{name,...accepted,git:retained}
    });results.push(result);fs.writeFileSync(path.join(runDir,'results.json'),JSON.stringify(results,null,2))}finally{budget.finishTurn(scope)}
  }}catch(e){fs.writeFileSync(path.join(runDir,'failure.json'),JSON.stringify({state:'FAILED_NOT_REPLAYABLE',reason:/^[a-z_]+$/.test(e.code||e.message)?e.code||e.message:'local_coding_failed',at:new Date().toISOString(),completedTasks:results.length},null,2),{flag:'wx'});throw e}finally{budget.handle({id:'owner',role:'owner'},{op:'usage_pause'});fs.writeFileSync(path.join(runDir,'usage-final.json'),JSON.stringify(budget.status(),null,2))}
  console.log(JSON.stringify({state:'TESTED_LOCAL_CANDIDATES_REVIEW_REQUIRED',runDir,tasks:results.length,helper:budget.status().helper,cloudRequests:0,independentReview:'not_performed',appliedToLive:false}))
}
if(require.main===module)main().catch(e=>{console.error(/^[a-z_]+$/.test(e.code||e.message)?e.code||e.message:'local_coding_failed');process.exitCode=1})
module.exports={main,material}
