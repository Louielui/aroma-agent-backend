'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),{randomUUID}=require('node:crypto')
const usage=require('./usageBudget'),{hash}=require('./contract'),OWNER={id:'owner',role:'owner'},MODEL={model:'claude-opus-5-5',effort:'medium'}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'independent-acceptance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=require('./store').createStore({dir}),old=usage.createUsageBudget({store,profile:usage.LATENCY_PROFILE,activationReady:()=>true})
 old.handle(OWNER,{op:'usage_activate'})
 for(let i=0;i<3;i++){const turnId=randomUUID(),conversationId=randomUUID();old.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId});const s=old.enterTurn(turnId,conversationId,randomUUID());old.withScope(s,()=>{for(let j=0;j<4;j++){const p=old.reserve('helper',MODEL);p.dispatched('cli_process_started');p.finish(null,{text:'offline'})}});old.finishTurn(s)}
 old.handle(OWNER,{op:'usage_pause'})
 const before=fs.readFileSync(path.join(dir,usage.LATENCY_PROFILE.id+'.json')),make=()=>usage.createIndependentAcceptanceEntry({store,evidenceDir:path.join(dir,'evidence')})
 const entry=make();entry.setActivationWitness(()=>true)
 const activate={op:'usage_acceptance_activate',rootId:'6181f0ad-90d7-4c89-9886-39671ce75a05',predecessorHash:hash(store.get(usage.LATENCY_PROFILE.id))}
 const unchanged=()=>assert.deepEqual(fs.readFileSync(path.join(dir,usage.LATENCY_PROFILE.id+'.json')),before)
 return{dir,store,old,make,entry,activate,unchanged}
}
function turn(b){const turnId=randomUUID(),conversationId=randomUUID();b.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId});return b.enterTurn(turnId,conversationId,randomUUID())}
test('explicit independent activation preserves the paused old root and does not replay or resume it',t=>{
 const f=fixture(t),b=f.entry
 assert.equal(b.readStatus().id,usage.LATENCY_PROFILE.id);assert.equal(b.readStatus().state,'paused');assert.equal(f.store.exists(f.activate.rootId),false)
 assert.throws(()=>b.handle(OWNER,{op:'usage_activate'}),/usage_operation_not_allowed/)
 assert.throws(()=>b.handle({id:'model',role:'model'},f.activate),/owner_required/)
 assert.throws(()=>b.handle(OWNER,{...f.activate,rootId:randomUUID()}),/usage_profile_not_allowed/)
 assert.throws(()=>b.handle(OWNER,{...f.activate,helper:400}),/invalid_request/)
 assert.throws(()=>b.handle(OWNER,{...f.activate,predecessorHash:'0'.repeat(64)}),/usage_binding_conflict/)
 b.setActivationWitness(()=>false);assert.throws(()=>b.handle(OWNER,f.activate),/usage_idle_required/);assert.equal(f.store.exists(f.activate.rootId),false)
 b.setActivationWitness(()=>true);b.handle(OWNER,f.activate)
 assert.deepEqual(b.status().limits,{turns:1,helper:6,website:0});assert.equal(b.status().helper.reserved,0);assert.equal(b.status().id,f.activate.rootId)
 assert.throws(()=>b.handle(OWNER,f.activate),/usage_attempt_replayed/);b.handle(OWNER,{op:'usage_pause'})
 assert.throws(()=>b.handle(OWNER,{op:'usage_activate'}),/usage_operation_not_allowed/)
 assert.throws(()=>b.handle(OWNER,f.activate),/usage_attempt_replayed/);assert.equal(f.make().readStatus().state,'paused');f.unchanged()
})
test('new root uses native boundary, rejects foreign scope, and retains retry and parallel accounting after restart',async t=>{
 const f=fixture(t),b=f.entry;b.handle(OWNER,f.activate);const s=turn(b),token='a'.repeat(64);let sends=0
 assert.throws(()=>b.withHeader(b.encode({...s,rootId:usage.LATENCY_PROFILE.id},token),token,()=>{}),/usage_scope_required/)
 assert.throws(()=>b.withHeader(undefined,token,()=>usage.nativePermit('helper',MODEL)),/usage_scope_required/)
 await b.withScope(s,async()=>{
  assert.throws(()=>b.reserve('helper',{...MODEL,effort:'high'}),/usage_model_not_allowed/)
  assert.throws(()=>b.reserve('helper',{model:'gpt-6.1-sol',effort:'high'}),/usage_model_not_allowed/)
  assert.throws(()=>b.reserve('website',{}),/usage_limit_reached/)
  const first=b.reserve('helper',MODEL);first.finish(Error('failed_before_send'))
  const child=b.childScope(randomUUID())
  await b.withScope(child,async()=>{
   const outcomes=await Promise.allSettled(Array.from({length:9},async()=>{
    const other=f.make();return other.withHeader(other.encode(child,token),token,()=>usage.observe('helper',MODEL,async p=>{const native=usage.nativePermit('helper',MODEL);assert.equal(native.permit.id,p.id);p.dispatched('cli_process_started');sends++;await Promise.resolve();return{text:'offline native substitute'}}))
   }))
   assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,5)
   assert.ok(outcomes.filter(r=>r.status==='rejected').every(r=>r.reason.code==='usage_limit_reached'))
  });b.finishChild(child)
  const next=b.childScope(randomUUID());b.withScope(next,()=>assert.throws(()=>b.reserve('helper',MODEL),/usage_limit_reached/));b.finishChild(next)
 });b.finishTurn(s)
 const status=f.make().status();assert.equal(sends,5);assert.equal(status.helper.reserved,6);assert.equal(status.helper.dispatched,5);assert.equal(status.helper.failed,1);assert.equal(status.helper.reservedNotDispatched,1);assert.equal(status.helper.available,0);assert.equal(status.helper.unresolved,0);assert.equal(status.website.reserved,0)
 assert.throws(()=>b.handle(OWNER,{op:'usage_bind_turn',turnId:randomUUID(),conversationId:randomUUID()}),/usage_turn_limit_reached/)
 const restarted=JSON.parse(cp.execFileSync(process.execPath,['-e',"const u=require(process.argv[1]);const store=require(process.argv[2]).createStore({dir:process.argv[3]});console.log(JSON.stringify(u.createIndependentAcceptanceEntry({store}).readStatus()))",require.resolve('./usageBudget'),require.resolve('./store'),f.dir],{encoding:'utf8'}))
 assert.equal(restarted.id,f.activate.rootId);assert.equal(restarted.helper.reserved,6);assert.equal(restarted.turnsUsed,1);f.unchanged()
})
test('predecessor drift, unresolved work and active state refuse before any new allowance',t=>{
 const f=fixture(t)
 f.old.handle(OWNER,{op:'usage_activate'});assert.throws(()=>f.entry.handle(OWNER,f.activate),/usage_unresolved_work/);assert.equal(f.store.exists(f.activate.rootId),false)
 f.old.handle(OWNER,{op:'usage_pause'});assert.throws(()=>f.entry.handle(OWNER,f.activate),/usage_binding_conflict/)
 const updated={...f.activate,predecessorHash:hash(f.store.get(usage.LATENCY_PROFILE.id))};f.entry.handle(OWNER,updated)
 const row=f.store.get(usage.LATENCY_PROFILE.id);row.timeline.push({event:'fixture_drift'});f.store.save(row)
 assert.throws(()=>f.entry.isActive(),/usage_binding_conflict/);assert.throws(()=>f.entry.reserve('helper',MODEL),/usage_binding_conflict/)
})

test('missing, closed and unfinished paused predecessors fail closed without creating a root',t=>{
 for(const kind of ['missing','closed','turn','attempt','child']){
  const f=fixture(t),row=f.store.get(usage.LATENCY_PROFILE.id)
  if(kind==='missing')fs.unlinkSync(path.join(f.dir,row.id+'.json'))
  else{if(kind==='closed')row.state='closed';if(kind==='turn')row.turns[0].finished=false;if(kind==='attempt')row.attempts[0].state='dispatched';if(kind==='child')row.children.push({id:randomUUID(),turnId:row.turns[0].id,finished:false});f.store.save(row)}
  assert.throws(()=>f.entry.handle(OWNER,{...f.activate,predecessorHash:hash(row)}),/usage_unresolved_work/);assert.equal(f.store.exists(f.activate.rootId),false)
 }
})
test('activation and reservation persistence failures cannot send or create a replacement root',t=>{
 const f=fixture(t),save=f.store.save;f.store.save=()=>{throw Error('offline_disk_failure')}
 assert.throws(()=>f.entry.handle(OWNER,f.activate),/usage_audit_unavailable/);assert.equal(f.store.exists(f.activate.rootId),false)
 f.store.save=save;f.entry.handle(OWNER,f.activate);const s=turn(f.entry);let sent=0;f.store.save=()=>{throw Error('offline_disk_failure')}
 assert.throws(()=>f.entry.withScope(s,()=>{f.entry.reserve('helper',MODEL);sent++}),/usage_audit_unavailable/);assert.equal(sent,0);f.unchanged()
 assert.throws(()=>usage.developmentProfile(f.activate.rootId),/usage_profile_not_allowed/)
 assert.throws(()=>usage.createUsageBudget({store:f.store,profile:{...usage.MEMORY_ARBITRATION_PROFILE,id:randomUUID()}}),/usage_profile_not_allowed/)
})

test('authenticated Bridge and Action Gateway activate the exact root, while a resident backend observes the same ledger',async t=>{
 const f=fixture(t),backend=f.make(),token='c'.repeat(64);let sends=0,web=0,release,started
 const pending=new Promise(r=>{release=r}),entered=new Promise(r=>{started=r})
 const server=require('../subscription/bridge').createBridge({token,clientOptions:{},usageBudget:f.entry,
  schedulerActions:require('./service').createGateway({usageBudget:f.entry}),websiteEnabled:true,
  claudeFn:async()=>{sends++;if(sends===1){started();await pending}return{text:'offline',model:MODEL.model,billing:'claude-subscription'}},
  findWebsiteFn:async()=>{web++;return{status:'found'}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
 const call=async(route,body,scope,auth=token)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json',...(scope?{'x-xiangxiang-usage':scope}:{})},body:JSON.stringify(body)});return{status:r.status,body:await r.json()}}
 assert.equal((await call('/scheduler-action',f.activate,null,'invalid')).status,401);assert.equal(f.store.exists(f.activate.rootId),false)
 const ordinary=call('/complete',{...MODEL,prompt:'offline'});await entered
 assert.equal((await call('/scheduler-action',f.activate)).body.error,'usage_idle_required');assert.equal(f.store.exists(f.activate.rootId),false)
 release();assert.equal((await ordinary).status,200)
 assert.equal((await call('/scheduler-action',f.activate)).body.budget.id,f.activate.rootId)
 assert.equal(backend.readStatus().id,f.activate.rootId);assert.equal(backend.readStatus().helper.reserved,0)
 const s=turn(backend),header=backend.encode(s,token)
 assert.equal((await call('/complete',{...MODEL,prompt:'offline'})).body.code,'usage_scope_required')
 assert.equal((await call('/complete',{...MODEL,prompt:'offline'},backend.encode({...s,rootId:usage.LATENCY_PROFILE.id},token))).status,409)
 for(let i=0;i<6;i++)assert.equal((await call('/complete',{...MODEL,prompt:'offline'},header)).status,200)
 assert.equal((await call('/complete',{...MODEL,prompt:'offline'},header)).body.code,'usage_limit_reached')
 assert.equal((await call('/website',{target:'offline'},header)).body.code,'usage_limit_reached');assert.equal(web,0);assert.equal(sends,7)
 assert.equal(backend.readStatus().helper.reserved,6);backend.finishTurn(s)
 assert.equal((await call('/scheduler-action',{op:'usage_pause'})).body.budget.state,'paused')
 assert.equal((await call('/scheduler-action',f.activate)).body.error,'usage_attempt_replayed');f.unchanged()
})

test('independent Node hosts share six reservations and cannot reset the selected new root',async t=>{
 const f=fixture(t);f.entry.handle(OWNER,f.activate);const s=turn(f.entry)
 // Simulate hosts exiting after reservation but before dispatch. Unfinished
 // reservations must still consume capacity; no retry refunds them.
 const script="const b=require(process.argv[1]).createIndependentAcceptanceEntry({store:require(process.argv[2]).createStore({dir:process.argv[3]})});const s=JSON.parse(process.argv[4]);let reserved=0;for(let i=0;i<150;i++){try{b.withScope(s,()=>b.reserve('helper',{model:'claude-opus-5-5',effort:'medium'}));reserved++}catch(e){if(e.code==='usage_limit_reached')break;if(e.code!=='usage_busy')throw e}}process.stdout.write(JSON.stringify({reserved}))"
 const run=()=>new Promise((resolve,reject)=>{const p=cp.spawn(process.execPath,['-e',script,require.resolve('./usageBudget'),require.resolve('./store'),f.dir,JSON.stringify(s)],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(JSON.parse(out)))})
 const results=await Promise.all([run(),run()]);assert.equal(results.reduce((n,r)=>n+r.reserved,0),6)
 assert.equal(f.make().readStatus().helper.reserved,6);assert.equal(f.make().readStatus().helper.dispatched,0);assert.equal(f.make().readStatus().helper.unresolved,6);f.entry.finishTurn(s);f.unchanged()
})

test('the actual intake route admits one new-root turn, captures the final reply and rejects replay',async t=>{
 const f=fixture(t),backend=f.make();f.entry.handle(OWNER,f.activate)
 const app=require('express')();app.use(require('express').json());app.locals.conversationDemo=true
 app.use((req,res,next)=>backend.withHeader(undefined,'d'.repeat(64),next));let calls=0
 app.use(require('../routes/demoRouter').createDemoRouter({getAdapterFn:()=>({providerName:'offline'}),processIntakeFn:async()=>{calls++;const p=usage.service().reserve('helper',MODEL);p.dispatched('cli_process_started');p.finish(null,{text:'offline answer'});return{intent:'chit_chat',mode:'chat',reply:'offline final reply'}}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)))
 const conversationId=randomUUID(),turnId=randomUUID();f.entry.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId})
 const call=async(id)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json',...(id?{'x-xiangxiang-usage-turn':id}:{})},body:JSON.stringify({message:'offline follow-up',interactionMode:'chat',history:[],conversationId,chatModel:MODEL.model,chatLevel:'medium'})});return{status:r.status,body:await r.json()}}
 assert.equal((await call()).body.error.code,'usage_scope_required');assert.equal(calls,0)
 assert.equal((await call(turnId)).status,200);assert.equal((await call(turnId)).body.error.code,'usage_turn_replayed');assert.equal(calls,1)
 const status=backend.readStatus();assert.equal(status.helper.reserved,1);assert.equal(status.helper.dispatched,1);assert.equal(status.turnsUsed,1)
 const refs=status.timeline.filter(e=>e.event==='evidence').map(e=>({kind:e.kind,value:JSON.parse(fs.readFileSync(path.join(f.dir,'evidence',e.id+'.json')))}))
 assert.ok(refs.some(e=>e.kind==='turn_input'&&e.value.message==='offline follow-up'));assert.ok(refs.some(e=>e.kind==='turn_output'&&JSON.stringify(e.value).includes('offline final reply')));f.unchanged()
})

test('the real resident owner selector observes independent activation without closing its paused predecessor',t=>{
 const f=fixture(t),data=path.join(f.dir,'resident'),dir=path.join(data,'scheduler-action-runs','usage-budget');fs.mkdirSync(dir,{recursive:true})
 const store=require('./store').createStore({dir})
 for(const profile of [usage.UNDERSTANDING_PROFILE,usage.ADVICE_PROFILE,usage.PRIORITY_PROFILE,usage.CONVERSATION_PROFILE,usage.GOAL_PROFILE,usage.CLARITY_PROFILE,usage.PLANNING_PROFILE,usage.CONTINUATION_PROFILE,usage.MARKDOWN_PROFILE,usage.DRAFT_PROFILE,usage.HANDOFF_PROFILE,usage.VERIFIER_PROFILE,usage.EDIT_PROFILE,usage.SCOPE_PROFILE,usage.LEARNING_PROFILE]){const b=usage.createUsageBudget({store,profile,activationReady:()=>true});b.handle(OWNER,{op:'usage_activate'});b.handle(OWNER,{op:'usage_close'})}
 store.save(f.store.get(usage.LATENCY_PROFILE.id))
 const script="const u=require(process.argv[1]),b=u.owner(),before=b.readStatus();b.setActivationWitness(()=>true);b.handle({id:'owner',role:'owner'},JSON.parse(process.argv[2]));console.log(JSON.stringify({before:before.id,after:u.owner().readStatus().id}))"
 const r=JSON.parse(cp.execFileSync(process.execPath,['-e',script,require.resolve('./usageBudget'),JSON.stringify(f.activate)],{env:{...process.env,AROMA_DATA_DIR:data},encoding:'utf8',windowsHide:true}))
 assert.equal(r.before,usage.LATENCY_PROFILE.id);assert.equal(r.after,f.activate.rootId);assert.deepEqual(store.get(usage.LATENCY_PROFILE.id),f.store.get(usage.LATENCY_PROFILE.id));f.unchanged()
})
