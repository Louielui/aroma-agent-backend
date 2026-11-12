'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),{randomUUID}=require('node:crypto')
const usage=require('./usageBudget'),{hash}=require('./contract'),OWNER={id:'owner',role:'owner'},MODEL={model:'claude-opus-5-5',effort:'medium'}
const PROFILE={id:'d4654bf0-3e8a-4991-8c51-81aa34359960',identity:'owner-ai-model-foreground-retest-20261111',...MODEL,turns:1,helper:6,website:0}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'delegation-retest-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=require('./store').createStore({dir}),first=usage.createUsageBudget({store,profile:usage.LATENCY_PROFILE,activationReady:()=>true})
 first.handle(OWNER,{op:'usage_activate'});first.handle(OWNER,{op:'usage_pause'})
 const make=()=>usage.createIndependentAcceptanceEntry({store,evidenceDir:path.join(dir,'evidence')}),old=make();old.setActivationWitness(()=>true)
 old.handle(OWNER,{op:'usage_acceptance_activate',rootId:usage.MEMORY_ARBITRATION_PROFILE.id,predecessorHash:hash(store.get(usage.LATENCY_PROFILE.id))})
 old.handle(OWNER,{op:'usage_pause'})
 const previousBindings=[usage.LATENCY_PROFILE,usage.MEMORY_ARBITRATION_PROFILE].map(p=>({rootId:p.id,hash:hash(store.get(p.id))}))
 old.handle(OWNER,{op:'usage_acceptance_activate',rootId:usage.DELEGATION_LIST_PROFILE.id,predecessorHash:hash(previousBindings)})
 old.handle(OWNER,{op:'usage_pause'})
 const oldParents=[usage.LATENCY_PROFILE,usage.MEMORY_ARBITRATION_PROFILE,usage.DELEGATION_LIST_PROFILE].map(p=>({rootId:p.id,hash:hash(store.get(p.id))}));old.handle(OWNER,{op:'usage_acceptance_activate',rootId:usage.DELEGATION_RETEST_PROFILE.id,predecessorHash:hash(oldParents)});old.handle(OWNER,{op:'usage_pause'});
 const speedParents=[usage.LATENCY_PROFILE,usage.MEMORY_ARBITRATION_PROFILE,usage.DELEGATION_LIST_PROFILE,usage.DELEGATION_RETEST_PROFILE].map(p=>({rootId:p.id,hash:hash(store.get(p.id))}));old.handle(OWNER,{op:'usage_acceptance_activate',rootId:usage.SPEED_PROFILE.id,predecessorHash:hash(speedParents)});const spent=turn(old);old.withScope(spent,()=>{for(let i=0;i<3;i++){const p=old.reserve('helper',MODEL);p.dispatched('cli_process_started');p.finish(null,{text:'offline prior sample'})}});old.finishTurn(spent);old.handle(OWNER,{op:'usage_pause'});
 const parents=[usage.LATENCY_PROFILE,usage.MEMORY_ARBITRATION_PROFILE,usage.DELEGATION_LIST_PROFILE,usage.DELEGATION_RETEST_PROFILE,usage.SPEED_PROFILE].map(p=>({rootId:p.id,hash:hash(store.get(p.id))})),before=parents.map(p=>fs.readFileSync(path.join(dir,p.rootId+'.json')))
 const entry=make();entry.setActivationWitness(()=>true)
 const activate={op:'usage_acceptance_activate',rootId:PROFILE.id,predecessorHash:hash(parents)}
 return{dir,store,entry,make,activate,parents,unchanged:()=>parents.forEach((p,i)=>assert.deepEqual(fs.readFileSync(path.join(dir,p.rootId+'.json')),before[i]))}
}
function turn(b){const turnId=randomUUID(),conversationId=randomUUID();b.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId});return b.enterTurn(turnId,conversationId,randomUUID())}
test('foreground definition is inert; only exact authenticated activation creates the separate six-helper ledger',t=>{
 const f=fixture(t),b=f.entry
 assert.deepEqual(usage.FOREGROUND_PROFILE,PROFILE);assert.equal(usage.isAcceptanceRoot(PROFILE.id),true)
 assert.equal(b.readStatus().id,usage.SPEED_PROFILE.id);assert.equal(f.store.exists(PROFILE.id),false)
 assert.throws(()=>b.handle(OWNER,{op:'usage_activate'}),/usage_operation_not_allowed/)
 assert.throws(()=>b.handle({id:'model',role:'model'},f.activate),/owner_required/)
 assert.throws(()=>b.handle(OWNER,{...f.activate,rootId:randomUUID()}),/usage_profile_not_allowed/)
 assert.throws(()=>b.handle(OWNER,{...f.activate,helper:40}),/invalid_request/)
 assert.throws(()=>b.handle(OWNER,{...f.activate,predecessorHash:f.parents[1].hash}),/usage_binding_conflict/)
 b.setActivationWitness(()=>false);assert.throws(()=>b.handle(OWNER,f.activate),/usage_idle_required/);assert.equal(f.store.exists(PROFILE.id),false)
 b.setActivationWitness(()=>true);b.handle(OWNER,f.activate)
 assert.equal(b.readStatus().id,PROFILE.id);assert.deepEqual(b.readStatus().limits,{turns:1,helper:6,website:0});assert.equal(b.readStatus().helper.reserved,0)
 assert.throws(()=>b.handle(OWNER,f.activate),/usage_attempt_replayed/)
 b.handle(OWNER,{op:'usage_pause'});assert.equal(f.make().readStatus().state,'paused')
 assert.throws(()=>b.handle(OWNER,{op:'usage_activate'}),/usage_operation_not_allowed/);assert.throws(()=>b.handle(OWNER,f.activate),/usage_attempt_replayed/)
 assert.throws(()=>usage.developmentProfile(PROFILE.id),/usage_profile_not_allowed/)
 assert.throws(()=>usage.createUsageBudget({store:f.store,profile:{...PROFILE,helper:7}}),/usage_profile_not_allowed/);f.unchanged()
})
test('all five paused predecessors are binding and any missing, active, closed or unresolved predecessor refuses activation',t=>{
 for(const index of [0,1,2,3,4])for(const kind of ['missing','active','closed','turn','child','attempt','drift']){
  const f=fixture(t),id=f.parents[index].rootId,r=f.store.get(id)
  if(kind==='missing')fs.unlinkSync(path.join(f.dir,id+'.json'))
  else{if(['active','closed'].includes(kind))r.state=kind;if(kind==='turn'||kind==='attempt'){r.turns.push({id:randomUUID(),conversationId:randomUUID(),entered:true,finished:kind==='attempt',requestId:randomUUID(),hostPid:process.pid});if(kind==='attempt')r.attempts.push({id:randomUUID(),kind:'helper',turnId:r.turns[0].id,hostPid:process.pid,...MODEL,state:'reserved'})}if(kind==='child'){r.turns.push({id:randomUUID(),conversationId:randomUUID(),entered:false,finished:false});r.children.push({id:randomUUID(),turnId:r.turns[0].id,finished:false})}if(kind==='drift')r.timeline.push({event:'offline_drift'});f.store.save(r)}
  assert.throws(()=>f.entry.handle(OWNER,f.activate),/usage_(unresolved_work|binding_conflict|audit_unavailable)/);assert.equal(f.store.exists(PROFILE.id),false)
 }
})
test('predecessor drift and parent lock contention block further reservations after activation',t=>{
 for(const index of [0,1,2,3,4]){
  const f=fixture(t);f.entry.handle(OWNER,f.activate);const s=turn(f.entry),release=f.store.lockRun(f.parents[index].rootId)
  assert.throws(()=>f.entry.withScope(s,()=>f.entry.reserve('helper',MODEL)),/usage_busy/);release()
  const r=f.store.get(f.parents[index].rootId);r.timeline.push({event:'offline_drift'});f.store.save(r)
  assert.throws(()=>f.entry.readStatus(),/usage_binding_conflict/)
  assert.throws(()=>f.entry.withScope(s,()=>f.entry.reserve('helper',MODEL)),/usage_binding_conflict/)
  assert.equal(f.store.get(PROFILE.id).attempts.length,0)
 }
})
test('failed reservations, parallel child work, model restrictions and restarts share one hard cap',async t=>{
 const f=fixture(t),b=f.entry;b.handle(OWNER,f.activate);const s=turn(b);let sent=0
 await b.withScope(s,async()=>{
  assert.throws(()=>b.reserve('helper',{...MODEL,effort:'high'}),/usage_model_not_allowed/)
  assert.throws(()=>b.reserve('helper',{model:'gpt-6.1-sol',effort:'high'}),/usage_model_not_allowed/)
  b.reserve('helper',MODEL).finish(Error('offline_before_send'))
  const child=b.childScope(randomUUID());await b.withScope(child,async()=>{
   const results=await Promise.allSettled(Array.from({length:10},async()=>{const other=f.make();return other.withScope(child,()=>{const p=other.reserve('helper',MODEL);p.dispatched('cli_process_started');sent++;p.finish(null,{text:'offline'})})}))
   assert.equal(results.filter(r=>r.status==='fulfilled').length,5);assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='usage_limit_reached'))
  });b.finishChild(child)
  const retry=b.childScope(randomUUID());b.withScope(retry,()=>assert.throws(()=>b.reserve('helper',MODEL),/usage_limit_reached/));b.finishChild(retry)
  assert.throws(()=>b.reserve('website',{}),/usage_limit_reached/)
 });b.finishTurn(s)
 const r=f.make().readStatus();assert.equal(sent,5);assert.equal(r.helper.reserved,6);assert.equal(r.helper.dispatched,5);assert.equal(r.helper.failed,1);assert.equal(r.helper.reservedNotDispatched,1);assert.equal(r.helper.available,0);assert.equal(r.website.reserved,0)
 assert.throws(()=>b.handle(OWNER,{op:'usage_bind_turn',turnId:randomUUID(),conversationId:randomUUID()}),/usage_turn_limit_reached/)
 const script="const u=require(process.argv[1]);console.log(JSON.stringify(u.createIndependentAcceptanceEntry({store:require(process.argv[2]).createStore({dir:process.argv[3]})}).readStatus()))"
 const restarted=JSON.parse(cp.execFileSync(process.execPath,['-e',script,require.resolve('./usageBudget'),require.resolve('./store'),f.dir],{encoding:'utf8',windowsHide:true}))
 assert.equal(restarted.id,PROFILE.id);assert.equal(restarted.helper.reserved,6);f.unchanged()
})
test('independent Node hosts cannot over-reserve or reset the new root',async t=>{
 const f=fixture(t);f.entry.handle(OWNER,f.activate);const s=turn(f.entry)
 const script="const b=require(process.argv[1]).createIndependentAcceptanceEntry({store:require(process.argv[2]).createStore({dir:process.argv[3]})}),s=JSON.parse(process.argv[4]);require(process.argv[5]).reserveUntilCap({budget:b,scope:s}).then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{console.error(e.code||e.message);process.exitCode=1})"
 const run=()=>new Promise((resolve,reject)=>{const p=cp.spawn(process.execPath,['-e',script,require.resolve('./usageBudget'),require.resolve('./store'),f.dir,JSON.stringify(s),require.resolve('./fixtures/reservationContender.cjs')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(JSON.parse(out)))})
 const results=await Promise.all([run(),run()]);assert.equal(results.reduce((n,r)=>n+r.reserved,0),6)
 const r=f.make().readStatus();assert.equal(r.helper.reserved,6);assert.equal(r.helper.dispatched,0);assert.equal(r.helper.unresolved,6)
 assert.throws(()=>f.entry.handle(OWNER,{op:'usage_pause'}),/usage_unresolved_work/);f.unchanged()
})

test('two real hosts yield through more than 150 busy locks and complete after release',async t=>{
 const f=fixture(t);f.entry.handle(OWNER,f.activate);const s=turn(f.entry),unlock=f.store.lockRun(PROFILE.id)
 const script="const b=require(process.argv[1]).createIndependentAcceptanceEntry({store:require(process.argv[2]).createStore({dir:process.argv[3]}),lockWaitMs:0}),s=JSON.parse(process.argv[4]);require(process.argv[5]).reserveUntilCap({budget:b,scope:s,onBusy:n=>{if(n===151)process.send({busy:n})}}).then(r=>{process.stdout.write(JSON.stringify(r));process.disconnect()}).catch(e=>{console.error(e.code||e.message);process.disconnect();process.exitCode=1})"
 const run=()=>{
  const p=cp.spawn(process.execPath,['-e',script,require.resolve('./usageBudget'),require.resolve('./store'),f.dir,JSON.stringify(s),require.resolve('./fixtures/reservationContender.cjs')],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});let out='',err='',notify,rejectReady
  const ready=new Promise((resolve,reject)=>{notify=resolve;rejectReady=reject})
  p.on('message',m=>{if(m.busy===151)notify()});p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x)
  const done=new Promise((resolve,reject)=>{p.on('error',e=>{rejectReady(e);reject(e)});p.on('close',code=>{if(code){const e=Error(err);rejectReady(e);reject(e)}else resolve(JSON.parse(out))})});done.catch(()=>{})
  return{p,ready,done}
 }
 const children=[run(),run()];let timer
 try{await Promise.race([Promise.all(children.map(c=>c.ready)),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('contention_barrier_timeout')),10000)})])}
 finally{clearTimeout(timer);unlock()}
 const rows=await Promise.all(children.map(c=>c.done));assert.ok(rows.every(r=>r.busy>=151&&r.reachedLimit));assert.equal(rows.reduce((n,r)=>n+r.reserved,0),6)
 assert.equal(f.make().readStatus().helper.reserved,6);assert.equal(f.make().readStatus().helper.dispatched,0);f.unchanged()
 console.log('OFFLINE_CONTENTION_TRACE '+JSON.stringify(rows))
})
test('persistence failure before activation or reservation cannot emit a provider call',t=>{
 const f=fixture(t),save=f.store.save;f.store.save=()=>{throw Error('offline_disk_failure')}
 assert.throws(()=>f.entry.handle(OWNER,f.activate),/usage_audit_unavailable/);assert.equal(f.store.exists(PROFILE.id),false)
 f.store.save=save;f.entry.handle(OWNER,f.activate);const s=turn(f.entry);let sent=0;f.store.save=()=>{throw Error('offline_disk_failure')}
 assert.throws(()=>f.entry.withScope(s,()=>{f.entry.reserve('helper',MODEL);sent++}),/usage_audit_unavailable/);assert.equal(sent,0);f.unchanged()
})
test('existing authenticated Bridge and Action Gateway select the new root and stop the seventh helper before send',async t=>{
 const f=fixture(t),resident=f.make(),token='c'.repeat(64);let sent=0,web=0
 const server=require('../subscription/bridge').createBridge({token,clientOptions:{},usageBudget:f.entry,schedulerActions:require('./service').createGateway({usageBudget:f.entry}),websiteEnabled:true,claudeFn:async()=>{sent++;return{text:'offline only',...MODEL,billing:'claude-subscription'}},findWebsiteFn:async()=>{web++;return{status:'found'}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
 const call=async(route,body,header,auth=token)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json',...(header?{'x-xiangxiang-usage':header}:{})},body:JSON.stringify(body)});return{status:r.status,body:await r.json()}}
 assert.equal((await call('/scheduler-action',f.activate,null,'invalid')).status,401);assert.equal(f.store.exists(PROFILE.id),false)
 assert.equal((await call('/scheduler-action',f.activate)).body.budget.id,PROFILE.id);assert.equal(resident.readStatus().id,PROFILE.id)
 const s=turn(resident),header=resident.encode(s,token)
 assert.equal((await call('/complete',{...MODEL,prompt:'offline'})).body.code,'usage_scope_required')
 for(const p of f.parents)assert.equal((await call('/complete',{...MODEL,prompt:'offline'},resident.encode({...s,rootId:p.rootId},token))).status,409)
 for(let i=0;i<6;i++)assert.equal((await call('/complete',{...MODEL,prompt:'offline'},header)).status,200)
 assert.equal((await call('/complete',{...MODEL,prompt:'offline'},header)).body.code,'usage_limit_reached');assert.equal(sent,6)
 assert.equal((await call('/website',{target:'offline'},header)).body.code,'usage_limit_reached');assert.equal(web,0)
 resident.finishTurn(s);assert.equal((await call('/scheduler-action',{op:'usage_pause'})).body.budget.state,'paused')
 assert.equal((await call('/scheduler-action',f.activate)).body.error,'usage_attempt_replayed');f.unchanged()
})
test('resident owner selection observes new activation without closing all five paused old roots',t=>{
 const f=fixture(t),data=path.join(f.dir,'resident'),dir=path.join(data,'scheduler-action-runs','usage-budget');fs.mkdirSync(dir,{recursive:true});const store=require('./store').createStore({dir})
 for(const profile of [usage.UNDERSTANDING_PROFILE,usage.ADVICE_PROFILE,usage.PRIORITY_PROFILE,usage.CONVERSATION_PROFILE,usage.GOAL_PROFILE,usage.CLARITY_PROFILE,usage.PLANNING_PROFILE,usage.CONTINUATION_PROFILE,usage.MARKDOWN_PROFILE,usage.DRAFT_PROFILE,usage.HANDOFF_PROFILE,usage.VERIFIER_PROFILE,usage.EDIT_PROFILE,usage.SCOPE_PROFILE,usage.LEARNING_PROFILE]){const b=usage.createUsageBudget({store,profile,activationReady:()=>true});b.handle(OWNER,{op:'usage_activate'});b.handle(OWNER,{op:'usage_close'})}
 for(const p of f.parents)store.save(f.store.get(p.rootId))
 const script="const u=require(process.argv[1]),b=u.owner(),before=b.readStatus();b.setActivationWitness(()=>true);b.handle({id:'owner',role:'owner'},JSON.parse(process.argv[2]));console.log(JSON.stringify({before:before.id,after:u.owner().readStatus().id}))"
 const r=JSON.parse(cp.execFileSync(process.execPath,['-e',script,require.resolve('./usageBudget'),JSON.stringify(f.activate)],{env:{...process.env,AROMA_DATA_DIR:data},encoding:'utf8',windowsHide:true}))
 assert.equal(r.before,usage.SPEED_PROFILE.id);assert.equal(r.after,PROFILE.id)
 for(const p of f.parents)assert.deepEqual(store.get(p.rootId),f.store.get(p.rootId));f.unchanged()
})
test('actual intake route binds one new-root turn and captures output without reviving any old window',async t=>{
 const f=fixture(t);f.entry.handle(OWNER,f.activate);const backend=f.make(),app=require('express')();app.use(require('express').json());app.locals.conversationDemo=true
 app.use((req,res,next)=>backend.withHeader(undefined,'d'.repeat(64),next));let calls=0
 app.use(require('../routes/demoRouter').createDemoRouter({getAdapterFn:()=>({providerName:'offline'}),processIntakeFn:async()=>{calls++;const p=usage.service().reserve('helper',MODEL);p.dispatched('cli_process_started');p.finish(null,{text:'offline candidate reply'});return{intent:'chit_chat',mode:'chat',reply:'offline candidate reply'}}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)))
 const conversationId=randomUUID(),turnId=randomUUID();backend.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId})
 const call=async id=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json',...(id?{'x-xiangxiang-usage-turn':id}:{})},body:JSON.stringify({message:'offline AI capability question',interactionMode:'chat',history:[],conversationId,chatModel:MODEL.model,chatLevel:'medium'})});return{status:r.status,body:await r.json()}}
 assert.equal((await call()).body.error.code,'usage_scope_required');assert.equal(calls,0)
 assert.equal((await call(turnId)).status,200);assert.equal((await call(turnId)).body.error.code,'usage_turn_replayed');assert.equal(calls,1)
 const r=backend.readStatus();assert.equal(r.id,PROFILE.id);assert.equal(r.turnsUsed,1);assert.equal(r.helper.dispatched,1)
 const evidence=r.timeline.filter(e=>e.event==='evidence').map(e=>({kind:e.kind,value:JSON.parse(fs.readFileSync(path.join(f.dir,'evidence',e.id+'.json')))}))
 assert.ok(evidence.some(e=>e.kind==='turn_input'&&e.value.message==='offline AI capability question'));assert.ok(evidence.some(e=>e.kind==='turn_output'&&JSON.stringify(e.value).includes('offline candidate reply')))
 assert.throws(()=>backend.handle(OWNER,{op:'usage_extension_prepare',workId:randomUUID(),commit:'a'.repeat(40),attemptsHash:'b'.repeat(64)}),/usage_extension_unavailable/);f.unchanged()
})
