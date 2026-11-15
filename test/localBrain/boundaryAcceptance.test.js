'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),{randomUUID}=require('node:crypto')
const usage=require('../../src/actions/usageBudget'),{hash}=require('../../src/actions/contract'),deployment=require('../../src/localBrain/deploymentProfile.json'),OWNER={id:'owner',role:'owner'},COMMIT='a'.repeat(40)
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boundary-acceptance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=require('../../src/actions/store').createStore({dir}),parents=[usage.LATENCY_PROFILE,usage.MEMORY_ARBITRATION_PROFILE,usage.DELEGATION_LIST_PROFILE,usage.DELEGATION_RETEST_PROFILE,usage.SPEED_PROFILE,usage.FOREGROUND_PROFILE,usage.LEAN_PROFILE,usage.LOCK_RETEST_PROFILE,usage.ROSTER_EVIDENCE_PROFILE]
 const first=usage.createUsageBudget({store,profile:parents[0],activationReady:()=>true});first.handle(OWNER,{op:'usage_activate'});first.handle(OWNER,{op:'usage_pause'})
 const old=usage.createIndependentAcceptanceEntry({store});old.setActivationWitness(()=>true)
 for(let i=1;i<parents.length;i++){const rows=parents.slice(0,i).map(p=>({rootId:p.id,hash:hash(store.get(p.id))}));old.handle(OWNER,{op:'usage_acceptance_activate',rootId:parents[i].id,predecessorHash:hash(i===1?store.get(parents[0].id):rows)});old.handle(OWNER,{op:'usage_pause'})}
 const bytes=parents.map(p=>fs.readFileSync(path.join(dir,p.id+'.json')));let now=1000000,commit=COMMIT
 const make=()=>usage.createIndependentAcceptanceEntry({store,evidenceDir:path.join(dir,'evidence'),now:()=>now,runtimeCommit:()=>commit}),b=make();b.setActivationWitness(()=>true)
 const p=usage.LOCAL_BOUNDARY_PROFILE,activate={op:'usage_local_acceptance_activate',rootId:p?.id,commit:COMMIT,predecessorHash:hash(parents.map(p=>({rootId:p.id,hash:hash(store.get(p.id))})))}
 const turn=i=>{const turnId=p.slots[i].id,conversationId=randomUUID();b.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId});return b.enterTurn(turnId,conversationId,randomUUID())}
 return{dir,store,b,p,activate,make,turn,tick:n=>now+=n,drift:()=>commit='b'.repeat(40),unchanged:()=>{parents.forEach((p,i)=>assert.deepEqual(fs.readFileSync(path.join(dir,p.id+'.json')),bytes[i]));assert.equal(store.exists(usage.LOCAL_ACCEPTANCE_PROFILE.id),false)}}
}
const input={model:deployment.model,effort:'auto',digest:deployment.digest,phase:'answer'}
function send(b,s,fn=()=>{}){return b.withScope(s,()=>{const {permit}=usage.nativePermit('helper',input);permit.dispatched('local_http_send');fn();permit.finish(null,{});return permit})}
test('new six-turn profile is inert, cannot be a development budget and preserves the unused PR166 definition',t=>{
 const f=fixture(t);assert.ok(f.p);assert.notEqual(f.p.id,usage.LOCAL_ACCEPTANCE_PROFILE.id);assert.deepEqual([f.p.turns,f.p.helper,f.p.website],[6,36,0]);assert.equal(f.p.slots.filter(s=>s.purpose==='background').length,0);assert.equal(f.store.exists(f.p.id),false)
 assert.throws(()=>usage.developmentProfile(f.p.id),/usage_profile_not_allowed/);assert.throws(()=>f.b.handle({id:'model',role:'model'},f.activate),/owner_required/)
 assert.throws(()=>f.b.handle(OWNER,{...f.activate,commit:'b'.repeat(40)}),/usage_binding_conflict/)
 f.b.handle(OWNER,f.activate);assert.equal(f.b.readStatus().id,f.p.id);assert.throws(()=>f.b.handle(OWNER,f.activate),/usage_attempt_replayed/);assert.throws(()=>f.b.handle(OWNER,{...f.activate,rootId:usage.LOCAL_ACCEPTANCE_PROFILE.id}),/usage_binding_conflict/);f.unchanged()
})
test('six isolated dialogue slots share 36 sends and the 37th/new child/new turn cannot replenish them',t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);let sent=0
 for(let i=0;i<6;i++){const s=f.turn(i);for(let j=0;j<6;j++)send(f.make(),s,()=>sent++);assert.throws(()=>send(f.make(),s),/usage_limit_reached/);f.b.finishTurn(s)}
 assert.equal(sent,36);assert.equal(f.make().readStatus().helper.dispatched,36);assert.equal(f.make().readStatus().helper.available,0);assert.throws(()=>f.b.handle(OWNER,{op:'usage_bind_turn',turnId:randomUUID(),conversationId:randomUUID()}),/usage_scope_required/);f.unchanged()
})
test('real parallel LocalAdapter sends, children and fresh instances cannot exceed six per turn',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0);let sends=0
 const a=new(require('../../src/adapters/LocalAdapter').LocalAdapter)({env:{LOCAL_MODEL:deployment.model,LOCAL_MODEL_DIGEST:deployment.digest,LOCAL_MODEL_CONTEXT:String(deployment.context)},fetchFn:async url=>url.endsWith('/api/tags')?Response.json({models:[{name:deployment.model,digest:deployment.digest}]}):(sends++,new Response(JSON.stringify({message:{content:'{}'},done:true})+'\n'))})
 const results=await f.b.withScope(s,()=>Promise.allSettled(Array.from({length:10},()=>{const child=f.b.childScope(randomUUID());return f.make().withScope(child,()=>a.complete('offline substitute'))})))
 assert.equal(sends,6);assert.equal(results.filter(r=>r.status==='fulfilled').length,6);assert.equal(f.make().readStatus().helper.reserved,6);await assert.rejects(f.make().withScope(s,()=>a.complete('retry')),/usage_limit_reached/);f.unchanged()
})
test('separate OS processes use the same new root without opening a model connection',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0),worker=path.join(__dirname,'../../src/actions/localSharedBudgetWorker.fixture.cjs')
 const children=[0,1].map(()=>cp.fork(worker,[f.dir,JSON.stringify(s),COMMIT,f.p.id],{stdio:['ignore','ignore','pipe','ipc']}));t.after(()=>children.forEach(p=>{if(p.exitCode===null)p.kill()}))
 const rows=await Promise.all(children.map(p=>new Promise((resolve,reject)=>{let row,stderr='';p.stderr.on('data',v=>stderr+=v);p.on('message',v=>row=v);p.on('exit',code=>code===0?resolve(row):reject(Error(JSON.stringify(row)||stderr)))})))
 assert.equal(rows.reduce((n,r)=>n+r.sent,0),6);assert.equal(f.make().readStatus().helper.dispatched,6);f.unchanged()
})
test('background, website, cloud, model digest drift and wrong-purpose ingress fail before sending',t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0)
 f.b.withScope(s,()=>{for(const phase of ['memory_extract','memory_consolidation','memory_reflection'])assert.throws(()=>usage.nativePermit('helper',{...input,phase}),/usage_operation_not_allowed/);assert.throws(()=>usage.nativePermit('helper',{model:'claude-opus-5-5',effort:'medium'}),/usage_model_not_allowed/);assert.throws(()=>usage.nativePermit('website',{}),/usage_operation_not_allowed/);assert.throws(()=>usage.nativePermit('helper',{...input,digest:'b'.repeat(64)}),/usage_model_not_allowed/)})
 const turnId=f.p.slots[1].id,conversationId=randomUUID();f.b.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId});assert.throws(()=>f.b.enterTurn(turnId,conversationId,randomUUID(),'background'),/usage_operation_not_allowed/);assert.equal(f.b.readStatus().helper.reserved,0);f.unchanged()
})
test('failure, expiry, changed runtime and restart preserve capacity and forbid an automatic resume',t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0)
 f.b.withScope(s,()=>{const {permit}=usage.nativePermit('helper',input);permit.claimNative(input);permit.dispatched('local_http_send');permit.finish(Object.assign(Error('failed'),{code:'local_transport_or_protocol_error'}))})
 const st=f.make().readStatus();assert.equal(st.helper.failed,1);assert.equal(st.helper.dispatched,1);assert.equal(st.helper.unusedStopped,35);assert.throws(()=>send(f.make(),s),/usage_stopped/);assert.throws(()=>f.b.handle(OWNER,{op:'usage_activate'}),/usage_operation_not_allowed/);f.unchanged()
})
test('new root does not conceal a PR166 root that was activated elsewhere',t=>{
 const f=fixture(t);f.b.handle(OWNER,{...f.activate,rootId:usage.LOCAL_ACCEPTANCE_PROFILE.id});const bytes=fs.readFileSync(path.join(f.dir,usage.LOCAL_ACCEPTANCE_PROFILE.id+'.json'))
 assert.throws(()=>f.b.handle(OWNER,f.activate),/usage_binding_conflict/);assert.equal(f.store.exists(f.p.id),false);assert.deepEqual(fs.readFileSync(path.join(f.dir,usage.LOCAL_ACCEPTANCE_PROFILE.id+'.json')),bytes)
})
test('new root deadlines, runtime binding and paused state survive a fresh service object',t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0);f.tick(90001);assert.throws(()=>send(f.make(),s),/usage_expired/);assert.equal(f.make().readStatus().helper.dispatched,0);f.unchanged()
 const g=fixture(t);g.b.handle(OWNER,g.activate);const q=g.turn(0);g.drift();assert.throws(()=>send(g.make(),q),/usage_binding_conflict/);assert.equal(g.make().readStatus().helper.dispatched,0);g.unchanged()
 const h=fixture(t);h.b.handle(OWNER,h.activate);h.b.handle(OWNER,{op:'usage_pause'});assert.throws(()=>h.make().withHeader(undefined,'c'.repeat(64),()=>usage.nativePermit('helper',input)),/usage_run_not_active/);assert.throws(()=>h.b.handle(OWNER,{op:'usage_activate'}),/usage_operation_not_allowed/);h.unchanged()
})
test('inspection plan is bounded, uses saved Owner context and rejects execution flags',()=>{
 const plan=require('../../src/localBrain/boundaryAcceptancePlan');assert.equal(plan.cases.length,6);assert.equal(plan.cases.filter(c=>c.scenario==='minimum_transfer').length,3);assert.equal(plan.cases.filter(c=>c.scenario==='capability_offline').length,3);assert.equal(plan.backgroundBatches,0)
 assert.equal(plan.cases[0].history.length,2);assert.equal(plan.cases[0].history[1].role,'assistant');assert.equal(plan.cases[0].expected.moved,3);assert.equal(plan.cases[3].history.length,0)
 const script=path.join(__dirname,'../../scripts/localBrain/inspectBoundaryAcceptance.cjs');assert.equal(JSON.parse(cp.execFileSync(process.execPath,[script],{encoding:'utf8'})).state,'NOT_ACTIVATED');assert.throws(()=>cp.execFileSync(process.execPath,[script,'--activate'],{stdio:'pipe'}))
})
test('existing authenticated Action Gateway activates this exact new root, never a model-supplied grant',async t=>{
 const f=fixture(t),token='c'.repeat(64),server=require('../../src/subscription/bridge').createBridge({token,usageBudget:f.b,schedulerActions:require('../../src/actions/service').createGateway({usageBudget:f.b})});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
 const post=async auth=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/scheduler-action',{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify(f.activate)});return{status:r.status,body:await r.json()}}
 assert.equal((await post('wrong')).status,401);assert.equal(f.store.exists(f.p.id),false);assert.equal((await post(token)).body.budget.id,f.p.id);assert.equal((await post(token)).body.error,'usage_attempt_replayed');f.unchanged()
})
