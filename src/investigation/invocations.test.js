'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {createInvocationLedger,projectUsage}=require('./invocations')
const {withInvocationContext,currentInvocationTrace}=require('./invocationContext')
const {createBridge}=require('../subscription/bridge')
const uuid='12345678-1234-4234-8234-123456789012'
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'invocations-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'ledger.json')}
test('provider token fields preserve explicit zero, unknown and separate helper usage without inventing charges',()=>{
 assert.deepEqual(projectUsage({inputTokens:12,outputTokens:0,cacheReadInputTokens:40,totalTokens:null,costUSD:2,secret:'private'}),{inputTokens:12,outputTokens:0,cacheReadInputTokens:40})
 assert.equal(projectUsage({inputTokens:-1,outputTokens:'23',totalTokens:null}),null)
})
test('durable call identity, lifecycle, elapsed time and bounded history survive reload without content',t=>{
 const file=fixture(t);let now=1000;const ledger=createInvocationLedger({file,clock:()=>now,limit:2})
 const id=ledger.begin({role:'chat_completion',model:'claude-sonnet',effort:'medium',trace:{requestId:uuid,phase:'answer'},prompt:'TOP SECRET'})
 now=1200;ledger.dispatched(id);now=1800;ledger.finish(id,{model:'claude-sonnet',actualModel:'claude-sonnet-5-5',billing:'claude-subscription',usage:{inputTokens:10,outputTokens:3},text:'TOP SECRET'})
 const row=createInvocationLedger({file}).read().records[0]
 assert.equal(row.invocationId,id);assert.equal(row.requestId,uuid);assert.equal(row.phase,'answer');assert.equal(row.state,'succeeded')
 assert.equal(row.durationMs,800);assert.equal(row.preflightMs,200);assert.equal(row.providerWaitMs,600)
 assert.equal(row.actualModel,'claude-sonnet-5-5');assert.deepEqual(row.usage,{inputTokens:10,outputTokens:3});assert.equal(row.provesCharge,false)
 assert.doesNotMatch(fs.readFileSync(file,'utf8'),/TOP SECRET/)
 ledger.begin({role:'memory_completion',model:'claude-sonnet'});ledger.begin({role:'memory_completion',model:'claude-sonnet'})
 const snapshot=ledger.read();assert.equal(snapshot.records.length,2);assert.equal(snapshot.omitted,1)
 assert.ok(createInvocationLedger({file}).read().records.every(r=>r.state==='interrupted_unknown'))
})
test('failed and interrupted calls cannot imply zero usage or confirmed model completion',t=>{
 const ledger=createInvocationLedger({file:fixture(t)}),id=ledger.begin({role:'memory_completion',model:'claude-sonnet'})
 ledger.finish(id,null,new Error('token=PRIVATE'))
 const r=ledger.read().records[0];assert.equal(r.state,'failed');assert.equal(r.usage,null);assert.equal(r.actualModel,null);assert.equal(r.modelResultObserved,false);assert.equal(r.requestId,null)
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE/)
})
test('unreadable ledger stays unavailable and is not overwritten',t=>{
 const file=fixture(t);fs.writeFileSync(file,'broken');const ledger=createInvocationLedger({file});ledger.begin({role:'chat_completion',model:'claude-sonnet'})
 assert.equal(ledger.read().state,'unavailable');assert.equal(fs.readFileSync(file,'utf8'),'broken')
})
test('request correlation is async scoped and phases are closed host vocabulary',async()=>{
 const other='22345678-1234-4234-8234-123456789012'
 const a=withInvocationContext(uuid,async()=>{await new Promise(r=>setTimeout(r,10));return currentInvocationTrace('goal_understanding')})
 const b=withInvocationContext(other,async()=>currentInvocationTrace('private prompt'))
 assert.deepEqual(await a,{requestId:uuid,phase:'goal_understanding'});assert.deepEqual(await b,{requestId:other,phase:'unspecified'});assert.equal(currentInvocationTrace('answer'),null)
})
test('subscription adapter transmits only host context, not a prompt-supplied trace',async()=>{
 const {CodexSubscriptionAdapter}=require('../adapters/CodexSubscriptionAdapter');let sent
 const adapter=new CodexSubscriptionAdapter({model:'claude-sonnet',request:async(route,body)=>{sent=body;return{text:'ok',model:'claude-sonnet',billing:'claude-subscription',stopReason:'end_turn'}}})
 await withInvocationContext(uuid,()=>adapter.complete('private',{invocationPhase:'answer',trace:{requestId:'fake'}}))
 assert.deepEqual(sent.trace,{requestId:uuid,phase:'answer'})
 await adapter.complete('private');assert.equal(sent.trace,undefined)
 assert.throws(()=>require('../subscription/bridge').validateInput({prompt:'hi',trace:{requestId:uuid,phase:'answer',command:'run'}}))
})
test('authenticated ledger reads do not spend credits or acquire a busy memory lane',async t=>{
 const ledger=createInvocationLedger({file:fixture(t)});let release,entered;const waiting=new Promise(r=>{entered=r}),pending=new Promise(r=>{release=r});let calls=0
 const token='a'.repeat(64),server=createBridge({token,clientOptions:{},memoryEnabled:true,backgroundModel:'claude-sonnet',invocationLedger:ledger,claudeFn:async(options)=>{calls++;options.onDispatch();entered();await pending;return {text:'ok',model:'claude-sonnet',actualModel:'claude-sonnet-5-5',billing:'claude-subscription',usage:{inputTokens:4,outputTokens:2}}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close())
 const post=(route,body={},auth='Bearer '+token)=>fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(body)})
 const running=post('/v1/chat/completions',{messages:[{role:'user',content:'PRIVATE'}]});await waiting
 try{const response=await post('/invocation-metadata');assert.equal(response.status,200);const r=(await response.json()).records[0];assert.equal(r.state,'started');assert.ok(r.dispatchedAt);assert.equal(r.requestId,null);assert.equal(calls,1)
 assert.equal((await post('/invocation-metadata',{path:'secret'})).status,400);assert.equal((await post('/invocation-metadata',{},'bad')).status,401)
 }finally{release();await running}
 assert.equal(ledger.read().records[0].state,'succeeded');assert.equal(calls,1)
})
