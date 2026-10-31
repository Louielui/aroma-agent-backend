'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process')
const {createTasks}=require('./service'),{createRegistry}=require('./contract'),{createRunStore}=require('../operating/runStore'),{createStore}=require('../../actions/store'),{createRepositoryBudget}=require('./repositoryBudget'),{createInventory}=require('./repositoryScope'),usage=require('../../actions/usageBudget'),{digest}=require('../../workers/execution/windowsSandbox'),{createProjectWork}=require('../projectWork/service')
const OWNER={id:'owner',role:'owner'}
const generated={testCode:"const test=require('node:test'),assert=require('node:assert/strict');for(const value of [1,2,3])test('returns increment '+value,()=>assert.equal(require('../src/logic.js')(value),value+1));",expectedTests:3}
async function native(model,effort,value){return usage.withRPCBudget({request:async()=>value},rpc=>rpc.request('turn/start',{model,effort}))}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'repository-flow-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const root=path.join(dir,'repo');fs.mkdirSync(path.join(root,'src'),{recursive:true});fs.writeFileSync(path.join(root,'src/logic.js'),'module.exports=value=>value;\n');fs.writeFileSync(path.join(root,'src/readonly.js'),'module.exports=true;\n')
 const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git('init');git('add','src');git('-c','user.name=Offline Test','-c','user.email=offline@example.invalid','-c','core.hooksPath=','commit','-m','offline fixture');const head=git('rev-parse','HEAD')
 const inventory=createInventory({root,health:async()=>({status:'ok',bootCommit:head})}),store=createRunStore({dir:path.join(dir,'tasks'),workflow:'project_task'}),workStore=createRunStore({dir:path.join(dir,'work'),workflow:'project_work'}),budget=createRepositoryBudget({dir:path.join(dir,'usage')}),locks=createStore({dir:path.join(dir,'locks')});let promotion=0,work
 const providers={isolation:async()=>({ready:true}),status:async()=>({codex:{ready:true},claude:{ready:true}}),codeOrder:async({order})=>{
  const changes=order.editable.map(file=>({file,before:order.files[file],after:'module.exports=value=>value+1;\n',beforeHash:digest(order.files[file]),afterHash:digest('module.exports=value=>value+1;\n')}))
  return native('gpt-6.1-sol','high',{model:'gpt-6.1-sol',effort:'high',billing:'chatgpt-subscription',execution:'windows_sandbox_offline',appliedToLive:false,changedFiles:order.editable,changes,patchHash:digest(JSON.stringify(changes)),baseline:{failed:3,total:3},tests:{total:3,passed:3,failed:0,skipped:0,cancelled:0,exitCode:0}})
 },reviewOrder:async()=>native('claude-sonnet-5-5','medium',{verdict:'pass',billing:'claude-subscription'})}
 const registry=createRegistry(store),source=require('../projectWork/source').createSource({root,resolveRecipe:registry.resolve,health:async()=>({status:'ok',bootCommit:head})})
 const makeWork=()=>work=createProjectWork({source,providers,store:workStore,enabled:()=>true,resolveRecipe:registry.resolve,repositoryBudget:budget,onAccepted:()=>{promotion++}});makeWork()
 const provider={preflight:async()=>({model:'gpt-6.1-sol',effort:'high',billing:'chatgpt-subscription'}),complete:async()=>native('gpt-6.1-sol','high',{model:'gpt-6.1-sol',billing:'chatgpt-subscription',text:JSON.stringify(generated)})}
 const options={store,enabled:()=>true,sourceFor:inventory.sourceFor,provider,review:async packet=>{const args=require('../workerFlow/providers').acceptanceReviewArgs(packet);assert.equal(args[args.indexOf('--model')+1],'claude-sonnet-5-5');assert.equal(args[args.indexOf('--effort')+1],'medium');return native('claude-sonnet-5-5','medium',{verdict:'pass',billing:'claude-subscription'})},prepareWork:input=>work.prepare(OWNER,input),repository:{inventory,budget,lock:()=>locks.lockRun('d970a642-61b1-47a1-8baf-6b33e910ac05'),provider}}
 return{dir,root,head,store,workStore,budget,inventory,sourceFor:inventory.sourceFor,make:(extra={})=>createTasks({...options,...extra,repository:{...options.repository,...extra.repository}}),makeWork,get work(){return work},get promotion(){return promotion}}
}
test('offline integration: intake, exact source approval, restart continuation, coding and review use one persistent budget; deployment stays held',async t=>{
 const f=fixture(t);let tasks=f.make();const input={bootCommit:f.head,requestId:randomUUID(),goal:'Fix increment while preserving the read-only dependency. Isolated candidate only.'}
 const requests=await Promise.all(Array.from({length:12},()=>Promise.resolve().then(()=>tasks.request(OWNER,{...input,requestId:randomUUID()}))));const id=requests[0].run.id;assert.equal(new Set(requests.map(v=>v.run.id)).size,1);assert.equal(f.budget.status(id).state,'not_activated')
 const scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria:['Return the input incremented by one','Do not change the dependency'],editable:['src/logic.js'],readonly:['src/readonly.js']});assert.equal(scoped.run.state,'awaiting_scope_approval');assert.equal(f.budget.status(id).helper.reserved,0)
 await assert.rejects(tasks.authorize(OWNER,{id,hash:'0'.repeat(64),nonce:scoped.approval.nonce}),/approval_unavailable/)
 await tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled();let ready=tasks.get(OWNER,id);assert.equal(ready.run.state,'awaiting_approval');assert.equal(f.budget.status(id).helper.dispatched,2);assert.equal(f.workStore.all().length,0)
 await assert.rejects(tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce}),/approval_unavailable/)
 tasks=f.make();assert.equal(tasks.continue(OWNER,{id,requestId:randomUUID()}).run.state,'interrupted');ready=await tasks.renew(OWNER,{id});assert.equal(f.budget.status(id).helper.dispatched,2);await tasks.approve(OWNER,{id,hash:ready.approval.hash,nonce:ready.approval.nonce})
 const prepared=await tasks.prepare(OWNER,{id,requestId:randomUUID()}),workId=prepared.work.run.id;assert.equal(prepared.work.run.workOrder.usageRoot,id)
 f.makeWork();const continued=await f.work.renew(OWNER,{id:workId});f.work.approve(OWNER,{id:workId,hash:continued.approval.hash,nonce:continued.approval.nonce});await f.work.settled()
 const result=f.work.get(OWNER,workId);assert.equal(result.state,'completed');assert.equal(result.repositoryPromotion.state,'held');assert.equal(f.promotion,0);assert.equal(f.budget.status(id).helper.dispatched,4);assert.equal(f.budget.status(id).helper.available,4);assert.equal(fs.readFileSync(path.join(f.root,'src/logic.js'),'utf8'),'module.exports=value=>value;\n')
 const repeated=await f.work.prepare(OWNER,{bootCommit:f.head,projectId:'aroma-agent-backend',recipe:result.workOrder.recipe,requestId:randomUUID()});assert.equal(repeated.run.id,workId);assert.equal(repeated.approval,null);await assert.rejects(f.work.renew(OWNER,{id:workId}),/approval_unavailable/)
 const adoption=require('../projectWork/adoption').createAdoption({work:f.work,enabled:()=>true,store:require('../operating/runStore').createMemoryRunStore(),isolated:()=>{throw Error('must not read or apply candidate')}})
 await assert.rejects(adoption.prepare(OWNER,{action:'adopt',runId:workId,requestId:randomUUID(),bootCommit:f.head}),/approval_unavailable/)
 const restarted=f.make();assert.equal(restarted.request(OWNER,{...input,requestId:randomUUID()}).run.id,id);assert.equal(f.store.all().length,1);assert.equal(f.workStore.all().length,1);assert.equal(f.budget.status(id).helper.reserved,4)
})
test('scope expiry and a competing worker during source verification consume no approval or model allowance',async t=>{
 const f=fixture(t);let now=0,occupied=false,block=false
 const tasks=f.make({sourceFor:d=>{const s=f.sourceFor(d);return{...s,verify:async snapshot=>{await s.verify(snapshot);if(block)occupied=true}}},repository:{otherActive:()=>occupied,approvals:require('../../agent/ownerApprovalStore').createOwnerApprovalStore({now:()=>now})}})
 const id=tasks.request(OWNER,{bootCommit:f.head,requestId:randomUUID(),goal:'A bounded repair'}).run.id
 let scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria:['Increment'],editable:['src/logic.js'],readonly:[]});now=600001
 await assert.rejects(tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce}),/approval_unavailable/);assert.equal(f.budget.status(id).state,'not_activated')
 scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria:['Increment'],editable:['src/logic.js'],readonly:[]});block=true
 await assert.rejects(tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce}),/worker_busy/);assert.equal(f.budget.status(id).state,'not_activated');assert.equal(tasks.get(OWNER,id).run.state,'awaiting_scope_approval')
})
test('source drift, oversized packages and extra scope authority stop before any model or budget activation',async t=>{
 const f=fixture(t),s=f.make(),v=s.request(OWNER,{bootCommit:f.head,requestId:randomUUID(),goal:'Repair this source'}),id=v.run.id
 await assert.rejects(s.scope(OWNER,{id,bootCommit:f.head,criteria:['Fix'],editable:['../production.js'],readonly:[]}),/invalid_request/)
 await assert.rejects(s.scope(OWNER,{id,bootCommit:f.head,criteria:['Fix'],editable:['src/logic.js'],readonly:[],root:'production'}),/invalid_request/)
 const selected=await s.scope(OWNER,{id,bootCommit:f.head,criteria:['Fix'],editable:['src/logic.js'],readonly:[]});fs.appendFileSync(path.join(f.root,'src/logic.js'),'// drift\n')
 await assert.rejects(s.authorize(OWNER,{id,hash:selected.approval.hash,nonce:selected.approval.nonce}),/source_dirty/);assert.equal(f.budget.status(id).state,'not_activated');assert.equal(f.workStore.all().length,0)
 assert.throws(()=>require('./repositoryScope').validateSnapshot({order:{files:{'src/huge.js':'x'.repeat(100001),'acceptance/registered-task.test.cjs':'x'}}}),/repository_package_limit/)
})
