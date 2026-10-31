'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process')
const usage=require('../actions/usageBudget'),OWNER={id:'owner',role:'owner'},MODEL={model:'claude-opus-5-5',effort:'medium'}
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usage-integration-'));t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true})});const store=require('../actions/store').createStore({dir}),b=usage.createUsageBudget({store,activationReady:()=>true,evidenceDir:path.join(dir,'evidence')});b.handle(OWNER,{op:'usage_activate'});const turnId=crypto.randomUUID(),conversationId=crypto.randomUUID();b.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId});const s=b.enterTurn(turnId,conversationId,crypto.randomUUID());return{b,s,dir}}
test('the real bridge refuses helper 41 and website 3; unbound requests and unsigned scopes never dispatch',async t=>{
 const f=fixture(t),token='a'.repeat(64);let sent=0,web=0
 const server=require('./bridge').createBridge({token,clientOptions:{},usageBudget:f.b,websiteEnabled:true,claudeFn:async()=>{sent++;return{text:'fixture',model:MODEL.model,billing:'claude-subscription',stopReason:'end_turn'}},findWebsiteFn:async()=>{web++;return{status:'found',url:'https://example.invalid'}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port,scope=f.b.encode(f.s,token)
 const call=async(route,body,header=scope)=>{const r=await fetch(url+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...(header?{'x-xiangxiang-usage':header}:{})},body:JSON.stringify(body)});return{status:r.status,body:await r.json()}}
 assert.equal((await call('/complete',{...MODEL,prompt:'fixture'},null)).body.code,'usage_scope_required');assert.equal((await call('/complete',{...MODEL,prompt:'fixture'},scope+'0')).status,409);assert.equal(sent,0)
 for(let i=0;i<40;i++)assert.equal((await call('/complete',{...MODEL,prompt:'fixture'})).status,200)
 assert.equal((await call('/complete',{...MODEL,prompt:'fixture'})).body.code,'usage_limit_reached');assert.equal(sent,40)
 for(let i=0;i<2;i++)assert.equal((await call('/website',{target:'fixture'})).status,200)
 assert.equal((await call('/website',{target:'fixture'})).body.code,'usage_limit_reached');assert.equal(web,2);assert.equal(f.b.status().helper.available,0)
})
test('the native Claude boundary never spawns on the 41st reservation',async t=>{
 const f=fixture(t);await f.b.withScope(f.s,async()=>{
  for(let i=0;i<40;i++)f.b.reserve('helper',MODEL).finish(Error('fixture_failed_attempt'))
  let spawns=0;const providers=require('../core/workerFlow/providers')
  await assert.rejects(providers.runClaude(['-p','--model',MODEL.model,'--effort',MODEL.effort],{cwd:f.dir,input:'fixture',resolveCommand:()=>({ok:true,command:'fixture'}),spawnImpl:()=>{spawns++;throw Error('unexpected_spawn')}}),/usage_limit_reached/)
  assert.equal(spawns,0)
 })
})
test('direct RPC and API alternatives cannot escape the active root; child scopes retain its remaining capacity',async t=>{
 const f=fixture(t);let rpcCalls=0
 await f.b.withScope(f.s,async()=>{
  const child=f.b.childScope(crypto.randomUUID());f.b.finishTurn(f.s)
  await f.b.withScope(child,async()=>{const rpc=usage.guardRPC({request:async()=>{rpcCalls++;return{}},events:{}});await assert.rejects(rpc.request('turn/start',{model:'gpt-6.1-sol',effort:'high'}),/usage_model_not_allowed/);assert.throws(()=>usage.blockAPI(),/usage_api_not_allowed/);f.b.reserve('helper',MODEL).finish(Error('fixture_failure'))});assert.equal(f.b.status().helper.reserved,1)
 });assert.equal(rpcCalls,0)
})
test('a retry inside one logical provider call reserves a new slot rather than reusing its native ticket',async t=>{
 const f=fixture(t)
 await f.b.withScope(f.s,async()=>usage.observe('helper',MODEL,async()=>{
  const first=usage.nativePermit('helper',MODEL);assert.equal(first.owned,false);first.permit.dispatched('cli_process_started');first.permit.finish(Error('fixture_failed_attempt'))
  const second=usage.nativePermit('helper',MODEL);assert.equal(second.owned,true);second.permit.dispatched('cli_process_started');second.permit.finish(null,{text:'fixture'})
  assert.notEqual(first.permit.id,second.permit.id);return{text:'fixture recovered'}
 }))
 assert.equal(f.b.status().helper.reserved,2);assert.equal(f.b.status().helper.dispatched,2);assert.equal(f.b.status().helper.failed,1);assert.equal(f.b.status().helper.succeeded,1)
})
test('two independent Node hosts atomically reserve the same persisted root without resetting after restart',async t=>{
 const f=fixture(t),moduleFile=path.join(__dirname,'../actions/usageBudget.js'),storeFile=path.join(__dirname,'../actions/store.js')
 const script=`const b=require(process.argv[1]).createUsageBudget({store:require(process.argv[2]).createStore({dir:process.argv[3]}),evidenceDir:require('node:path').join(process.argv[3],'evidence')});const s=JSON.parse(process.argv[4]);let reserved=0;for(let n=0;n<150;n++){try{b.withScope(s,()=>b.reserve('helper',{model:'claude-opus-5-5',effort:'medium'}).finish(Error('fixture_failure')));reserved++}catch(e){if(e.code==='usage_limit_reached')break;if(e.code!=='usage_busy')throw e}}process.stdout.write(JSON.stringify({reserved}))`
 const run=()=>new Promise((resolve,reject)=>{const p=cp.spawn(process.execPath,['-e',script,moduleFile,storeFile,f.dir,JSON.stringify(f.s)],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(JSON.parse(out)))})
 const rows=await Promise.all([run(),run()]);assert.ok(rows.reduce((n,r)=>n+r.reserved,0)>0);assert.equal(f.b.status().helper.reserved,40);assert.equal(f.b.status().helper.available,0)
})
test('the actual intake route preserves input, final response and precise budget refusal without replaying a turn',async t=>{
 const f=fixture(t),app=require('express')();app.use(require('express').json());app.locals.conversationDemo=true
 app.use((req,res,next)=>f.b.withScope(f.s,()=>next()))
 let entered=0
 app.use(require('../routes/demoRouter').createDemoRouter({getAdapterFn:()=>({providerName:'fixture'}),processIntakeFn:async()=>{entered++;if(entered===2){try{usage.service().reserve('helper',{model:'wrong',effort:'medium'})}catch{}}return{intent:'chit_chat',mode:'chat',reply:'fixture successful reply'}}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)))
 const call=async(turnId)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json',...(turnId?{'x-xiangxiang-usage-turn':turnId}:{})},body:JSON.stringify({message:'給我你的網址',interactionMode:'chat',history:[{role:'user',text:'earlier fixture'}],conversationId:f.s.conversationId,chatModel:MODEL.model,chatLevel:'medium'})});return{status:r.status,json:await r.json()}}
 assert.equal((await call()).json.error.code,'usage_scope_required');assert.equal(entered,0)
 const bind=()=>{const turnId=crypto.randomUUID();f.b.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId:f.s.conversationId});return turnId}
 const first=bind();assert.equal((await call(first)).status,200);assert.equal((await call(first)).json.error.code,'usage_turn_replayed');assert.equal(entered,1)
 const second=bind(),denied=await call(second);assert.equal(denied.status,409);assert.equal(denied.json.error.code,'usage_model_not_allowed');assert.ok(!JSON.stringify(denied).includes('fixture successful reply'))
 const refs=f.b.status().timeline.filter(v=>v.event==='evidence').map(ref=>({kind:ref.kind,value:JSON.parse(fs.readFileSync(path.join(f.dir,'evidence',ref.id+'.json')))}));assert.equal(refs.find(v=>v.kind==='turn_input').value.message,'給我你的網址');assert.ok(refs.some(v=>v.kind==='turn_output'&&v.value.status===409));assert.equal(f.b.status().helper.reserved,0)
})
test('website native retries reserve another website slot; the third RPC never starts',async t=>{
 const f=fixture(t);let sent=0
 await f.b.withScope(f.s,async()=>usage.observe('website',{},async()=>{
  const rpc=usage.guardRPC({request:async()=>{sent++;return{}}});await rpc.request('turn/start',{});await rpc.request('turn/start',{});await assert.rejects(rpc.request('turn/start',{}),/usage_limit_reached/);return{status:'fixture'}
 }))
 assert.equal(sent,2);assert.equal(f.b.status().website.reserved,2)
})
test('API web search is refused before fetch even with the existing paid-test opt-in',async t=>{
 const f=fixture(t),previous=process.env.RUN_PAID_E2E;process.env.RUN_PAID_E2E='1'
 try{await f.b.withScope(f.s,async()=>{assert.throws(()=>require('../adapters/liveEgressFence').fencedFetch('openai_web_search')('http://127.0.0.1:1',{}),/usage_api_not_allowed/)})}finally{if(previous===undefined)delete process.env.RUN_PAID_E2E;else process.env.RUN_PAID_E2E=previous}
})
test('RPC acknowledgement is not success; a later failed operation records the dispatched attempt as failed',async t=>{
 const f=fixture(t)
 await f.b.withScope(f.s,async()=>assert.rejects(usage.withRPCBudget({request:async()=>({turn:{id:'fixture'}})},async rpc=>{await rpc.request('turn/start',MODEL);assert.equal(f.b.status().helper.succeeded,0);assert.equal(f.b.status().helper.unresolved,1);throw Error('fixture_late_failure')}),/fixture_late_failure/))
 assert.equal(f.b.status().helper.dispatched,1);assert.equal(f.b.status().helper.failed,1);assert.equal(f.b.status().helper.unresolved,0)
})
test('a new legacy interactive child worker cannot escape the read-only acceptance window',async t=>{
 const f=fixture(t);let calls=0
 await f.b.withScope(f.s,async()=>{const worker=require('../agent/agentBridgeWorker').createAgentBridgeWorker({command:'fixture',runner:async()=>{calls++}});await assert.rejects(worker.invoke('AgentBridge',0,{}),/usage_operation_not_allowed/)})
 await f.b.withScope(f.s,async()=>{const worker=require('../workers/claudeWorker').createClaudeWorker({runner:async()=>{calls++}});await assert.rejects(worker.invoke('Invoke',1,{}),/usage_operation_not_allowed/)})
 assert.equal(calls,0);assert.equal(f.b.status().helper.reserved,0)
})
test('activation cannot race an existing in-flight bridge completion into an uncounted run',async t=>{
 const f=fixture(t);f.b.finishTurn(f.s);f.b.handle(OWNER,{op:'usage_pause'});let release,entered
 const started=new Promise(r=>{entered=r}),pending=new Promise(r=>{release=r}),token='b'.repeat(64)
 const server=require('./bridge').createBridge({token,clientOptions:{},usageBudget:f.b,claudeFn:async()=>{entered();await pending;return{text:'fixture',model:MODEL.model,billing:'claude-subscription'}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
 const request=fetch('http://127.0.0.1:'+server.address().port+'/complete',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({...MODEL,prompt:'fixture'})});await started
 assert.throws(()=>f.b.handle(OWNER,{op:'usage_activate'}),/usage_idle_required/);release();assert.equal((await request).status,200);f.b.handle(OWNER,{op:'usage_activate'});assert.equal(f.b.status().helper.reserved,0)
})
test('unpinned print calls and alternate print syntax cannot bypass the native budget; only exact metadata packets are exempt',async t=>{
 const f=fixture(t);let starts=0
 await f.b.withScope(f.s,async()=>{for(const args of [['-p','fixture'],['--print','fixture']])await assert.rejects(require('../core/workerFlow/providers').runClaude(args,{cwd:f.dir,input:'fixture',resolveCommand:()=>({ok:true,command:'fixture'}),spawnImpl:()=>{starts++;throw Error('unexpected_spawn')}}),/usage_model_not_allowed/)})
 assert.equal(starts,0);assert.equal(f.b.status().helper.reserved,0)
 const client=require('./claudeClient');await client.readCatalogue({run:async(args,options)=>{assert.equal(client.isMetadataOnly(args,options),true);assert.equal(client.isMetadataOnly([...args,'fixture'],options),false);assert.equal(client.isMetadataOnly(args,{...options,input:options.input+'fixture'}),false);return{models:[]}}})
})
test('completed child scope stays in the root audit, not a reusable worker record; a later ordinary run is unaffected',async t=>{
 const f=fixture(t),record={id:crypto.randomUUID(),state:'completed'},file=path.join(f.dir,'worker.json'),ledger=require('../investigation/invocations').createInvocationLedger({file:path.join(f.dir,'invocations.json')}),save=r=>fs.writeFileSync(file,JSON.stringify(r)),worker=require('../investigation/workerInvocation')
 await f.b.withScope(f.s,()=>worker.withWorkerRun({ledger,record,kind:'project-runs',save},async()=>{}));assert.equal(record.usageScope,undefined);const before=f.b.status().timeline.filter(e=>e.event==='child_bound').length;assert.equal(before,1)
 f.b.finishTurn(f.s);f.b.handle(OWNER,{op:'usage_close'});const reloaded=JSON.parse(fs.readFileSync(file));await worker.withWorkerRun({ledger,record:reloaded,kind:'project-runs',save},async()=>{});assert.equal(reloaded.workerRuns.length,2);assert.equal(f.b.status().timeline.filter(e=>e.event==='child_bound').length,before);assert.equal(f.b.status().helper.reserved,0)
})
