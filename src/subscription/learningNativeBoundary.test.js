'use strict'
// Offline reproduction of PR141's real callback -> catalogue -> CLI refusal.
// Only the process and Hindsight responses are doubles; the client, Bridge,
// persistent budget, Gateway and native permit boundary are the real modules.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{EventEmitter}=require('node:events')
const usage=require('../actions/usageBudget'),actor={id:'owner',role:'owner'},selection={model:'claude-sonnet',effort:'low'}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'learning-native-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const make=()=>usage.createUsageBudget({store:require('../actions/store').createStore({dir}),evidenceDir:path.join(dir,'evidence'),profile:usage.LEARNING_PROFILE,activationReady:()=>true}),b=make(),turnId=crypto.randomUUID(),conversationId=crypto.randomUUID()
 b.handle(actor,{op:'usage_activate'});b.handle(actor,{op:'usage_bind_turn',turnId,conversationId});return{dir,b,make,scope:b.enterTurn(turnId,conversationId,crypto.randomUUID())}
}
function client(dir,{resolvedModel='claude-sonnet-5-5',nativeModel=resolvedModel,nativeEffort='low',outcome='success'}={}){
 let spawns=0
 const run=async(args,options)=>{
  if(args.includes('status'))return{loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'}
  const nativeArgs=args.slice();nativeArgs[nativeArgs.indexOf('--model')+1]=nativeModel;nativeArgs[nativeArgs.indexOf('--effort')+1]=nativeEffort
  return require('../core/workerFlow/providers').runClaude(nativeArgs,{...options,resolveCommand:()=>({ok:true,command:'offline-cli'}),spawnImpl:()=>{
   spawns++;const child=new EventEmitter();child.pid=process.pid;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>{};child.stdin.end=()=>setImmediate(()=>{child.emit('spawn');child.stdout.emit('data',Buffer.from(JSON.stringify({type:'result',subtype:outcome,is_error:outcome!=='success',result:'offline',modelUsage:{[resolvedModel]:{inputTokens:4,outputTokens:2}}})));child.emit('close',outcome==='success'?0:1)});return child
  }})
 }
 return{options:{cwd:dir,run,catalogue:async()=>[{value:'sonnet',resolvedModel,supportsEffort:true,supportedEffortLevels:['low','medium','high']}]},spawns:()=>spawns}
}
async function bridge(t,f,c){
 const token='a'.repeat(64),server=require('./bridge').createBridge({token,clientOptions:c.options,usageBudget:f.b,memoryEnabled:true,backgroundModel:'claude-sonnet',invocationLedger:c.ledger})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
 const header=f.b.encode(f.scope,token)
 return async()=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-xiangxiang-usage':header},body:JSON.stringify({model:'gpt-6-astra',messages:[{role:'user',content:'offline source'}]})});return{status:r.status,body:await r.json()}}
}
test('real memory callback resolves the subscribed Sonnet alias once, records actual native selection and preserves the same root on reload',async t=>{
 const f=fixture(t),c=client(f.dir),call=await bridge(t,f,c),before=f.b.readStatus();const r=await call()
 assert.equal(r.status,200);assert.equal(c.spawns(),1);assert.equal(r.body.model,'claude-sonnet')
 const after=f.make().readStatus();assert.equal(after.id,before.id);assert.equal(after.helper.reserved,1);assert.equal(after.helper.dispatched,1);assert.equal(after.helper.succeeded,1)
 assert.equal(after.attempts[0].model,'claude-sonnet');assert.equal(after.attempts[0].nativeModel,'claude-sonnet-5-5');assert.equal(after.attempts[0].nativeEffort,'low')
})
test('parallel resolved native requests share the existing eighteen-attempt cap',async t=>{
 const f=fixture(t),c=client(f.dir)
 const rows=await f.b.withScope(f.scope,()=>Promise.allSettled(Array.from({length:21},()=>usage.observe('helper',selection,()=>require('./claudeClient').complete(c.options,{...selection,prompt:'offline'})))))
 assert.equal(rows.filter(r=>r.status==='fulfilled').length,18);assert.equal(rows.filter(r=>r.reason?.code==='usage_limit_reached').length,3)
 assert.equal(c.spawns(),18);assert.equal(f.b.readStatus().helper.reserved,18);assert.equal(f.make().readStatus().helper.available,0)
})
for(const variant of [{nativeModel:'claude-opus-5-5'},{nativeEffort:'medium'}])test('catalogue binding refuses a substituted native selection before spawn '+JSON.stringify(variant),async t=>{
 const f=fixture(t),c=client(f.dir,variant),call=await bridge(t,f,c)
 assert.equal((await call()).body.code,'usage_model_not_allowed');assert.equal(c.spawns(),0);assert.equal(f.b.readStatus().helper.reserved,1)
 // Replayed Hindsight callback cannot burn another reservation after the refusal.
 assert.equal((await call()).body.code,'usage_model_not_allowed');assert.equal(f.b.readStatus().helper.reserved,1)
})
test('a Sonnet catalogue entry resolving to another family is refused before native dispatch',async t=>{
 const f=fixture(t),c=client(f.dir,{resolvedModel:'claude-opus-5-5'}),call=await bridge(t,f,c)
 assert.equal((await call()).body.code,'usage_model_not_allowed');assert.equal(c.spawns(),0)
})
test('a native retry keeps the requested alias, obtains a fresh reservation, and cannot reuse a spent native ticket',async t=>{
 const f=fixture(t),c=client(f.dir)
 await f.b.withScope(f.scope,()=>usage.observe('helper',selection,async()=>{
  const first=await require('./claudeClient').complete(c.options,{...selection,prompt:'offline'});assert.equal(first.actualModel,'claude-sonnet-5-5')
  const second=await require('./claudeClient').complete(c.options,{...selection,prompt:'offline retry'});assert.equal(second.actualModel,'claude-sonnet-5-5');return second
 }))
 assert.equal(c.spawns(),2);assert.equal(f.b.readStatus().helper.reserved,2);assert.equal(f.b.readStatus().helper.succeeded,2)
})
test('an unbound concrete Sonnet call cannot use the alias allowance',async t=>{
 const f=fixture(t);await f.b.withScope(f.scope,async()=>{
  assert.throws(()=>usage.nativePermit('helper',{model:'claude-sonnet-5-5',effort:'low'}),/usage_model_not_allowed/)
 });assert.equal(f.b.readStatus().helper.reserved,0)
})
test('a pre-spawn refusal is visible in the real invocation ledger without a false dispatch marker; reloading retains its safe reason',async t=>{
 const f=fixture(t),c=client(f.dir,{nativeEffort:'medium'}),file=path.join(f.dir,'invocations.json'),create=require('../investigation/invocations').createInvocationLedger
 c.ledger=create({file});const call=await bridge(t,f,c);assert.equal((await call()).body.code,'usage_model_not_allowed');assert.equal(c.spawns(),0)
 const row=create({file}).read().records[0];assert.equal(row.state,'failed');assert.equal(row.dispatchedAt,null);assert.equal(row.providerWaitMs,null);assert.equal(row.failureCode,'usage_model_not_allowed');assert.equal(row.modelResultObserved,false)
 const id=c.ledger.begin({role:'memory_completion',...selection});c.ledger.finish(id,null,Error('private credential-like provider prose'));assert.equal(c.ledger.read().records[0].failureCode,null)
})
test('the Claude client dispatch callback fires exactly at actual native process start',async t=>{
 const f=fixture(t),c=client(f.dir);let dispatches=0;c.options.onDispatch=()=>{dispatches++;assert.equal(c.spawns(),1)}
 await f.b.withScope(f.scope,()=>usage.observe('helper',selection,()=>require('./claudeClient').complete(c.options,{...selection,prompt:'offline'})))
 assert.equal(c.spawns(),1);assert.equal(dispatches,1);assert.equal(f.b.readStatus().helper.dispatched,1)
})
test('Hindsight/Gateway retains the authoritative usage refusal, disables timed retry and sanitizes remote prose',async t=>{
 const f=fixture(t),{OWNER,createGateway}=require('../memory/governed'),store=require('../memory/structuredStore').createTestStore()
 const engine=require('../memory/hindsight').createHindsight({env:{XIANGXIANG_MEMORY:'on',HINDSIGHT_URL:'http://127.0.0.1:8888',HINDSIGHT_BANK:'xiangxiang-owner',HINDSIGHT_TOKEN:'fixture',CODEX_CHAT_BRIDGE_TOKEN:'a'.repeat(64)},transport:async()=>{
  f.b.rejection('usage_model_not_allowed');return Response.json({detail:'private provider prose, not trusted error authority'},{status:500})
 }})
 const g=createGateway({store,engine}),source=await g.observe(OWNER,{type:'episodic',subject:'offline style',text:'Keep answers concise.',scope:'private:owner',policy:'owner_history',source:{kind:'conversation',id:'offline-source',at:'2026-11-05T00:00:00Z',attribution:'owner_statement'}})
 const result=await f.b.withScope(f.scope,()=>g.consolidate(OWNER,source.id));assert.equal(result.error,'usage_model_not_allowed');assert.equal(result.nextRetryAt,null);assert.equal(result.attemptHistory.at(-1).errorCode,'usage_model_not_allowed');assert.equal(result.candidateIds.length,0)
 assert.ok(!JSON.stringify(await g.get(OWNER,source.id)).includes('private provider prose'))
})
test('indexing at the actual root cap preserves the same safe refusal and cannot schedule an unscoped background retry',async t=>{
 const f=fixture(t),{OWNER,createGateway}=require('../memory/governed'),store=require('../memory/structuredStore').createTestStore();let retains=0
 const engine=require('../memory/hindsight').createHindsight({env:{XIANGXIANG_MEMORY:'on',HINDSIGHT_URL:'http://127.0.0.1:8888',HINDSIGHT_BANK:'xiangxiang-owner',HINDSIGHT_TOKEN:'fixture',CODEX_CHAT_BRIDGE_TOKEN:'a'.repeat(64)},transport:async(url,init)=>{
  if(init.method==='GET')return Response.json({}, {status:404})
  if(url.endsWith('/memories')){retains++;assert.throws(()=>f.b.reserve('helper',selection),/usage_limit_reached/);return Response.json({detail:'private callback prose'},{status:500})}
  return Response.json({})
 }})
 const g=createGateway({store,engine}),source=await g.observe(OWNER,{type:'episodic',subject:'offline preference',text:'Keep answers concise.',scope:'private:owner',policy:'owner_history',source:{kind:'conversation',id:'offline-index-source',at:'2026-11-05T00:00:00Z',attribution:'owner_statement'}})
 const result=await f.b.withScope(f.scope,async()=>{for(let i=0;i<18;i++)f.b.reserve('helper',selection).finish(Error('offline prior attempt'));return g.index(OWNER,source.id)})
 assert.equal(retains,1);assert.equal(result.index.state,'unconfirmed');assert.equal(result.index.reason,'usage_limit_reached');assert.equal(result.index.nextRetryAt,null);assert.equal(result.index.attemptHistory.at(-1).errorCode,'usage_limit_reached');assert.equal(f.b.readStatus().helper.dispatched,0);assert.equal(f.b.readStatus().helper.reserved,18)
 assert.ok(!JSON.stringify(result).includes('private callback prose'))
})
