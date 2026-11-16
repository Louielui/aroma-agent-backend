'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process')
const {createTasks}=require('./service'),{createRegistry}=require('./contract'),{createRunStore}=require('../operating/runStore'),{createStore}=require('../../actions/store'),{createRepositoryBudget}=require('./repositoryBudget'),{createInventory}=require('./repositoryScope'),usage=require('../../actions/usageBudget'),{digest}=require('../../workers/execution/windowsSandbox'),{createProjectWork}=require('../projectWork/service')
const OWNER={id:'owner',role:'owner'}
const generated={testCode:"const test=require('node:test'),assert=require('node:assert/strict');\n"+[1,2,3].map(value=>`test('returns increment ${value}',()=>assert.equal(require('../src/logic.js')(${value}),${value+1}));`).join('\n'),expectedTests:3}
function fixture(t,{visible=false,failure=false}={}){
 const appProjectRoot='C:/isolated-app-project'
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'repository-flow-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const root=path.join(dir,'repo');fs.mkdirSync(path.join(root,'src'),{recursive:true});fs.writeFileSync(path.join(root,'src/logic.js'),'module.exports=value=>value;\n');fs.writeFileSync(path.join(root,'src/readonly.js'),'module.exports=true;\n')
 const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git('init');git('add','src');git('-c','user.name=Offline Test','-c','user.email=offline@example.invalid','-c','core.hooksPath=','commit','-m','offline fixture');const head=git('rev-parse','HEAD')
 const inventory=createInventory({root,health:async()=>({status:'ok',bootCommit:head})}),store=createRunStore({dir:path.join(dir,'tasks'),workflow:'project_task'}),workStore=createRunStore({dir:path.join(dir,'work'),workflow:'project_work'}),budget=createRepositoryBudget({dir:path.join(dir,'usage'),modeFor:id=>store.get(id)?.input.execution,runtimeCommit:()=>head}),locks=createStore({dir:path.join(dir,'locks')});let promotion=0,work
 let sends=0,cloud=0,sandboxRuns=0;const events=[],selection=require('../../workers/execution/localCodingProvider').SELECTION
 const local=require('../workerFlow/localProviders').createLocalProviders({root:path.join(dir,'local-work'),onEvent:e=>events.push(e),executor:{readiness:async()=>({ready:true}),isBusy:()=>false,run:async pack=>{sandboxRuns++;assert.deepEqual(pack.tests,['acceptance/registered-task.test.cjs']);assert.equal(pack.files[pack.tests[0]],generated.testCode);assert.equal(pack.files['src/readonly.js'],'module.exports=true;\n');return sandboxRuns===1?{exitCode:1,total:3,failed:3,passed:0,skipped:0,cancelled:0}:{exitCode:0,total:3,passed:3,failed:0,skipped:0,cancelled:0}}},fetchFn:async(url,o)=>{
  assert.ok(url.startsWith('http://127.0.0.1:11435/'));assert.equal(o.redirect,'error');if(url.endsWith('/api/tags'))return{ok:true,json:async()=>({models:[{name:'qwen3.5:9b',digest:selection.digest}]})}
  assert.ok(url.endsWith('/api/chat'));sends++;if(failure)throw Error('simulated transport failure');const body=JSON.parse(o.body);assert.equal(body.model,'qwen3.5:9b');assert.equal(body.think,false)
  let reply=sends===1?generated:sends===3?{changes:[{file:'src/logic.js',content:'module.exports=value=>value+1;\n'}],summary:'Increment only'}:{verdict:'pass',summary:'Contract checked',findings:[]}
  if(sends===2){const packet=JSON.parse(body.messages.find(v=>v.role==='user').content),anchor=packet.target.files[0].lines.find(l=>l.kind==='assertion').anchorId;assert.equal(packet.stage,'test_draft');assert.equal(packet.target.files[0].lines[0].text,generated.testCode.split('\n')[0]);assert.equal(packet.baseline.role,'unchanged_reference_expected_to_fail');reply={...reply,binding:packet.binding,coverage:packet.criteria.map(v=>({criterion:v.id,status:'covered',checks:v.checks.map(check=>({id:check.id,status:'covered',anchors:[anchor],reason:'Offline increment check.'}))})),baseline:{expectation:'expected_failure',anchor,reason:'Unchanged identity function fails the increment assertion.'}}}
  return{ok:true,body:(async function*(){yield Buffer.from(JSON.stringify({message:{content:JSON.stringify(reply)},done:true,prompt_eval_count:20,eval_count:10})+'\n')})()}
 }})
 const never=new Proxy({}, {get:()=>()=>{cloud++;throw Error('CLOUD MUST NOT RUN')}})
 const registry=createRegistry(store),source=require('../projectWork/source').createSource({root,resolveRecipe:registry.resolve,health:async()=>({status:'ok',bootCommit:head})})
 const makeWork=()=>work=createProjectWork({source,providers:never,localProviders:local,store:workStore,visibleCodexWork:visible,appProjectRoot,resolveCodexThread:id=>store.get(id)?.codexThread||null,enabled:()=>true,resolveRecipe:registry.resolve,repositoryBudget:budget,onAccepted:()=>{promotion++}});makeWork()
 const options={store,localProviders:local,visibleCodexWork:visible,appProjectRoot,enabled:()=>true,sourceFor:inventory.sourceFor,provider:never,review:never.review,prepareWork:input=>work.prepare(OWNER,input),repository:{inventory,budget,lock:()=>locks.lockRun('d970a642-61b1-47a1-8baf-6b33e910ac05'),provider:never}}
 return{get sends(){return sends},get cloud(){return cloud},get sandboxRuns(){return sandboxRuns},events,dir,root,head,store,workStore,budget,inventory,sourceFor:inventory.sourceFor,make:(extra={})=>createTasks({...options,...extra,repository:{...options.repository,...extra.repository}}),makeWork,get work(){return work},get promotion(){return promotion}}
}

// These transport/executor doubles verify composition only. Real OS Sandbox
// boundaries and corrected example behavior have separate retained evidence.
test('local registered work uses one real adapter/budget through all approvals, without any cloud or App thread',async t=>{
 const f=fixture(t,{visible:true}),tasks=f.make(),c=require('../../subscription/controlledDispatch').createControlledDispatch({projectTasks:tasks,projectWork:f.work,bootCommit:f.head,enabled:()=>true,localEnabled:()=>true,subscriptionReady:()=>false,executionReady:()=>true})
 const call=(target,input)=>c.handle(OWNER,{target,input}),goal='Repair increment; isolated Node only',request={op:'request',execution:'local',bootCommit:f.head,requestId:randomUUID(),goal}
 const id=(await call('task',request)).run.id;assert.equal((await call('task',{...request,requestId:randomUUID()})).run.id,id);assert.equal(f.sends,0)
 await assert.rejects(call('task',{...request,execution:undefined,requestId:randomUUID()}),/invalid_request/)
 assert.throws(()=>tasks.request(OWNER,{bootCommit:f.head,requestId:request.requestId,goal}),/request_conflict/)
 const scoped=await call('task',{op:'scope',id,bootCommit:f.head,criteria:['Return increment','Preserve read-only dependency'],editable:['src/logic.js'],readonly:['src/readonly.js']})
 assert.equal(scoped.run.scopeMaterial.usage.model,'qwen3.5:9b');assert.equal(f.budget.status(id).state,'not_activated')
 await call('task',{op:'authorize',id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled();const ready=tasks.get(OWNER,id);assert.equal(ready.run.state,'awaiting_approval',JSON.stringify(ready.run));assert.equal(f.sends,2);assert.equal(ready.run.codexThread,undefined)
 assert.equal(ready.run.acceptanceReview.billing,'local');assert.equal(f.budget.status(id).helper.dispatched,2)
 await call('task',{op:'approve',id,hash:ready.approval.hash,nonce:ready.approval.nonce});const prepared=await call('task',{op:'prepare',id,requestId:randomUUID()}),wid=prepared.work.run.id
 f.work.approve(OWNER,{id:wid,hash:prepared.work.approval.hash,nonce:prepared.work.approval.nonce});await f.work.settled();const r=f.work.get(OWNER,wid)
 assert.equal(r.state,'completed',JSON.stringify(r));assert.equal(r.result.billing,'local');assert.equal(r.result.model,'local:qwen3.5:9b');assert.equal(r.repositoryPromotion.state,'held');assert.equal(r.codexThread,undefined);assert.equal(f.promotion,0);assert.equal(f.cloud,0);assert.equal(f.sends,4);assert.equal(f.sandboxRuns,2)
 assert.deepEqual(f.events.filter(e=>e.type==='model_start').map(e=>e.phase),['local_test_draft','local_test_review','local_coding','local_code_review']);assert.equal(f.budget.status(id).state,'paused');assert.equal(f.budget.status(id).helper.dispatched,4)
 assert.equal(fs.readFileSync(path.join(f.root,'src/logic.js'),'utf8'),'module.exports=value=>value;\n')
 const bytes=fs.readFileSync(path.join(f.dir,'usage',id+'.json'));assert.equal(createRepositoryBudget({dir:path.join(f.dir,'usage'),modeFor:()=> 'local',runtimeCommit:()=>f.head}).status(id).helper.dispatched,4);assert.deepEqual(fs.readFileSync(path.join(f.dir,'usage',id+'.json')),bytes)
 await assert.rejects(f.work.prepareRecovery(OWNER,{id:wid,requestId:randomUUID(),bootCommit:f.head}),/recovery_unavailable/)
})
test('local transport failure is preserved, counted once and pauses the same root without subscription fallback',async t=>{
 const f=fixture(t,{failure:true}),tasks=f.make(),id=tasks.request(OWNER,{bootCommit:f.head,requestId:randomUUID(),goal:'Repair increment',execution:'local'}).run.id
 const scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria:['Increment'],editable:['src/logic.js'],readonly:[]});await tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled()
 const r=tasks.get(OWNER,id).run;assert.equal(r.state,'failed');assert.equal(r.reason,'local_transport_or_protocol_error');assert.equal(f.budget.status(id).state,'paused');assert.equal(f.sends,1);assert.equal(f.cloud,0);assert.equal(f.budget.status(id).helper.dispatched,1)
})
