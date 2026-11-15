'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createControlledDispatch,validInput}=require('./controlledDispatch')
const OWNER={id:'owner',role:'owner'},HEAD='a'.repeat(40),id=randomUUID(),root=randomUUID()
function fixture(){let sends=0;const task={id,kind:'repository_repair',workflow:'project_task',state:'awaiting_scope',input:{goal:'Repair only approved files'},workRunId:null},work={id:randomUUID(),workflow:'project_work',workOrder:{usageRoot:root,delivery:'owner_deployment_package_required'},state:'completed',result:{summary:'Test result',appliedToLive:false},appliedToLive:false},calls=[]
 const tasks={list:()=>({runs:[{id}],enabled:true}),get:()=>({run:task}),request:(a,b)=>{calls.push(b);return{run:task}},scope:(a,b)=>{calls.push(b);return{run:task}},authorize:()=>{sends++;return{run:task}}},works={list:()=>[work],get:()=>work,evidence:(a,b)=>({part:b.part,content:'host verified evidence'}),approve:()=>{sends++;return work}}
 return{task,work,calls,get sends(){return sends},service:createControlledDispatch({projectTasks:tasks,projectWork:works,enabled:()=>true,executionReady:()=>true,bootCommit:HEAD})}}
test('closed connector forwards only existing repository requests and never starts models on request/status/read',async()=>{const f=fixture(),s=await f.service.handle(OWNER,{op:'status'});assert.equal(s.protocol,'controlled-repository-dispatch-v1');assert.equal(s.bootCommit,HEAD);assert.equal(s.inferenceStarted,false);assert.equal(s.requiresScopeApproval,true);assert.equal(s.requiresUsageApproval,true)
 const b={op:'request',requestId:randomUUID(),goal:'Preserve full Owner goal',bootCommit:HEAD};const v=await f.service.handle(OWNER,{target:'task',input:b});assert.equal(v.run.id,id);assert.deepEqual(f.calls,[{requestId:b.requestId,goal:b.goal,bootCommit:b.bootCommit}]);assert.equal(f.sends,0)
 const got=await f.service.handle(OWNER,{target:'work',input:{op:'get',id:f.work.id}});assert.equal(got.run.result.summary,'Test result');assert.equal(got.run.appliedToLive,false);assert.equal(f.sends,0)})
test('non-Owner, disabled connector and unbounded legacy workflows fail before side effects',async()=>{const f=fixture();await assert.rejects(f.service.handle({id:'x',role:'staff'},{op:'status'}),/permission_denied/);const off=createControlledDispatch({enabled:()=>false});await assert.rejects(off.handle(OWNER,{target:'task',input:{op:'request',requestId:randomUUID(),goal:'x',bootCommit:HEAD}}),/controlled_dispatch_disabled/);assert.equal((await off.handle(OWNER,{op:'status'})).state,'disabled');delete f.work.workOrder.usageRoot;await assert.rejects(f.service.handle(OWNER,{target:'work',input:{op:'approve',id:f.work.id,hash:'b'.repeat(64),nonce:'c'.repeat(48)}}),/controlled_scope_required/);f.task.kind='legacy';await assert.rejects(f.service.handle(OWNER,{target:'task',input:{op:'get',id}}),/controlled_scope_required/);assert.equal(f.sends,0)})
test('exact body refuses completion, Worker, adoption, caller authority and source/version override',async()=>{for(const b of [{op:'status',approved:true},{target:'model',input:{op:'complete'}},{target:'work',input:{op:'prepare',projectId:'x',recipe:'x',requestId:randomUUID(),bootCommit:HEAD}},{target:'task',input:{op:'start'}},{target:'task',input:{op:'request',requestId:randomUUID(),goal:'x',bootCommit:HEAD,approved:true}},{target:'task',input:{op:'get',id,root:'production'}}])assert.equal(validInput(b),false)
 const f=fixture();await assert.rejects(f.service.handle(OWNER,{target:'task',input:{op:'request',requestId:randomUUID(),goal:'x',bootCommit:'b'.repeat(40)}}),/source_changed/);assert.equal(f.sends,0)})
test('unknown/evidence failures are retained as failures, never successful empty results',async()=>{const f=fixture();f.work.workOrder.delivery='auto';await assert.rejects(f.service.handle(OWNER,{target:'work',input:{op:'get',id:f.work.id}}),/controlled_scope_required/);assert.equal(f.sends,0)})

test('unknown or running automatic memory blocks inference authorization without consuming its approval',async()=>{
 let sent=0,ready=false;const run={id,kind:'repository_repair',workflow:'project_task'}
 const s=createControlledDispatch({enabled:()=>true,executionReady:()=>ready,bootCommit:HEAD,projectTasks:{get:()=>({run}),authorize:()=>{sent++;return{run}}}})
 const b={target:'task',input:{op:'authorize',id,hash:'b'.repeat(64),nonce:'c'.repeat(48)}}
 await assert.rejects(s.handle(OWNER,b),/controlled_background_not_idle/);assert.equal(sent,0)
 ready=true;await s.handle(OWNER,b);assert.equal(sent,1)
 const missing=createControlledDispatch({enabled:()=>true,bootCommit:HEAD,projectTasks:{get:()=>({run}),authorize:()=>assert.fail('no authority')}})
 await assert.rejects(missing.handle(OWNER,b),/controlled_background_not_idle/)
})

test('a competing existing workflow blocks mutation without consuming approval or reaching providers',async()=>{
 const s=createControlledDispatch({enabled:()=>true,executionReady:()=>true,otherActive:()=>true,bootCommit:HEAD,projectTasks:{authorize:()=>assert.fail('competing work')}})
 await assert.rejects(s.handle(OWNER,{target:'task',input:{op:'authorize',id,hash:'b'.repeat(64),nonce:'c'.repeat(48)}}),/worker_busy/)
})
