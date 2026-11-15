'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
test('test drafting uses its real persistent Codex thread and retains identity on retry without creating a mirror',async()=>{
 const {createDraftProvider}=require('./provider'),visibleWork={id:randomUUID(),purpose:'test_draft',created:async()=>{}},seen=[]
 const p=createDraftProvider({options:{cwd:'empty',allowCredits:false},effort:'high',client:{complete:async(o,i)=>{seen.push({o,i});return{text:'{}'}}}})
 await p.complete('Owner scope',{system:'Text only',schema:{type:'object'},visibleWork})
 assert.equal(seen[0].o.visibleWork,visibleWork);assert.equal(seen[0].o.allowCredits,false);assert.equal(seen[0].i.model,'gpt-6.1-sol');assert.equal(seen[0].i.effort,'high')
})
test('approved repository draft binds one real provider thread, publishes progress and reuses it on a rejected-test retry',async()=>{
 const {createTasks}=require('./service'),{createMemoryRunStore}=require('../operating/runStore'),{TEST,createRegistry}=require('./contract'),store=createMemoryRunStore(),HEAD='a'.repeat(40),OWNER={id:'owner',role:'owner'},thread=randomUUID(),events=[],seen=[];let reviews=0,activations=0
 const generated={expectedTests:3,testCode:"const test=require('node:test'),assert=require('node:assert/strict');test('one',()=>assert.equal(1,1));test('two',()=>assert.equal(2,2));test('three',()=>assert.equal(3,3));"}
 const sourceFor=d=>({read:async()=>({hash:'b'.repeat(64),evidence:{bootCommit:HEAD},order:{files:{'src/example.js':'module.exports=1',...d.tests}}}),verify:async()=>{}})
 const budget={activate:()=>{activations++},run:async(id,fn)=>fn(),status:()=>({state:'active',helper:{limit:8}})}
 const service=createTasks({store,sourceFor,enabled:()=>true,visibleCodexWork:true,appProjectRoot:'C:/isolated-app-project',onProgress:v=>events.push(v),provider:null,review:async()=>({verdict:++reviews===1?'changes_requested':'pass',billing:'claude-subscription'}),prepareWork:async()=>{},repository:{inventory:{list:async()=>[{path:'src/example.js',eligible:true}]},lock:()=>()=>{},budget,provider:{preflight:async()=>({model:'gpt-6.1-sol',effort:'high',billing:'chatgpt-subscription'}),complete:async(p,o)=>{seen.push(o.visibleWork);assert.equal(o.visibleWork.purpose,'test_draft');assert.equal(o.visibleWork.cwd,'C:/isolated-app-project');await o.visibleWork.created({id:thread,workId:o.visibleWork.id,model:'gpt-6.1-sol',effort:'high',source:'actual_test_draft_provider_thread',modelDispatched:false});return{model:'gpt-6.1-sol',billing:'chatgpt-subscription',text:JSON.stringify(generated)}}}}})
 const req={bootCommit:HEAD,requestId:randomUUID(),goal:'Repair one registered file'},a=service.request(OWNER,req);assert.equal(seen.length,0);const b=await service.scope(OWNER,{id:a.run.id,bootCommit:HEAD,criteria:['New behavior'],editable:['src/example.js'],readonly:[]});assert.equal(seen.length,0)
 await service.authorize(OWNER,{id:b.approval.id,hash:b.approval.hash,nonce:b.approval.nonce});await service.settled();const result=service.get(OWNER,a.run.id)
 assert.equal(result.run.state,'awaiting_approval');assert.equal(result.run.codexThread.id,thread);assert.equal(result.run.codexThread.appVisibility,'not_verified');assert.equal(seen.length,2);assert.equal(seen[0].resumeThreadId,undefined);assert.equal(seen[1].resumeThreadId,thread);assert.equal(activations,1);assert.equal(events.at(-1).state,'awaiting_approval');assert.ok(events.some(e=>e.state==='reviewing'));assert.ok(events.every(e=>e.threadId===thread&&e.appliedToLive===false));assert.equal(result.run.workRunId,null)
 const again=service.request(OWNER,{...req,requestId:randomUUID()});assert.equal(again.run.id,a.run.id);assert.equal(seen.length,2);assert.equal(store.all().length,1)
})
test('visible progress states distinguish review/test approval from completed coding and deployment',async()=>{
 const {createPublisher,titleFor}=require('../../subscription/workThreadTitles'),rows=new Map(),calls=[],store={get:id=>rows.get(id),save:r=>rows.set(r.id,structuredClone(r)),lockRun:()=>()=>{}}
 const p=createPublisher({store,client:{rename:async(...v)=>calls.push(v)}}),id=randomUUID(),threadId=randomUUID()
 for(const [i,state]of ['drafting','reviewing','awaiting_approval','registered','awaiting_scope_approval'].entries())await p.update({id,threadId,state,phase:state,at:new Date(1000+i).toISOString(),goal:'Owner request'})
 assert.equal(calls.length,5);assert.match(titleFor({id,goal:'x',state:'registered'}),/tests approved; coding not started/);assert.match(titleFor({id,goal:'x',state:'awaiting_approval'}),/awaiting Owner approval/)
})
