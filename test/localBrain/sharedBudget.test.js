'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),{randomUUID}=require('node:crypto')
const usage=require('../../src/actions/usageBudget'),{hash}=require('../../src/actions/contract'),OWNER={id:'owner',role:'owner'},COMMIT='a'.repeat(40)
const {LocalAdapter}=require('../../src/adapters/LocalAdapter'),deployment=require('../../src/localBrain/deploymentProfile.json')
function fixture(t){
 const dir=fs.mkdtempSync('C:/Aroma/local-brain-runtime/local-shared-cap-'),cleanups=[];t.after(()=>{for(const close of cleanups)close();fs.rmSync(dir,{recursive:true,force:true})})
 const store=require('../../src/actions/store').createStore({dir}),parents=[usage.LATENCY_PROFILE,usage.MEMORY_ARBITRATION_PROFILE,usage.DELEGATION_LIST_PROFILE,usage.DELEGATION_RETEST_PROFILE,usage.SPEED_PROFILE,usage.FOREGROUND_PROFILE,usage.LEAN_PROFILE,usage.LOCK_RETEST_PROFILE,usage.ROSTER_EVIDENCE_PROFILE]
 const first=usage.createUsageBudget({store,profile:parents[0],activationReady:()=>true});first.handle(OWNER,{op:'usage_activate'});first.handle(OWNER,{op:'usage_pause'})
 const old=usage.createIndependentAcceptanceEntry({store});old.setActivationWitness(()=>true)
 for(let i=1;i<parents.length;i++){const p=parents.slice(0,i).map(p=>({rootId:p.id,hash:hash(store.get(p.id))}));old.handle(OWNER,{op:'usage_acceptance_activate',rootId:parents[i].id,predecessorHash:hash(i===1?store.get(parents[0].id):p)});old.handle(OWNER,{op:'usage_pause'})}
 const before=parents.map(p=>fs.readFileSync(path.join(dir,p.id+'.json')));let clock=1000000,clockStep=0,commit=COMMIT
 const make=()=>usage.createIndependentAcceptanceEntry({store,evidenceDir:path.join(dir,'evidence'),now:()=>{const value=clock;clock+=clockStep;return value},runtimeCommit:()=>commit})
 const b=make();b.setActivationWitness(()=>true)
 const activate={op:'usage_local_acceptance_activate',rootId:usage.LOCAL_ACCEPTANCE_PROFILE?.id,predecessorHash:hash(parents.map(p=>({rootId:p.id,hash:hash(store.get(p.id))}))),commit:COMMIT}
 function turn(index){const turnId=usage.LOCAL_ACCEPTANCE_PROFILE.slots[index].id,conversationId=randomUUID();b.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId});return b.enterTurn(turnId,conversationId,randomUUID(),index===6?'background':'dialogue')}
 return{dir,store,b,make,activate,turn,cleanup:fn=>cleanups.push(fn),advancingClock:()=>clockStep=1,tick:ms=>clock+=ms,changeCommit:()=>commit='b'.repeat(40),unchanged:()=>parents.forEach((p,i)=>assert.deepEqual(fs.readFileSync(path.join(dir,p.id+'.json')),before[i]))}
}
function adapter(send,extra={}){return new LocalAdapter({env:{LOCAL_MODEL:deployment.model,LOCAL_MODEL_DIGEST:deployment.digest,LOCAL_MODEL_CONTEXT:String(deployment.context)},fetchFn:async(url,init)=>{if(url.endsWith('/api/tags'))return Response.json({models:[{name:deployment.model,digest:deployment.digest}]});send(init);return new Response(JSON.stringify({message:{content:'{"reply":"offline"}'},done:true})+'\n')},...extra})}
test('new local profile is inert, version-bound, exclusive and never reactivates a paused root',t=>{
 const f=fixture(t);assert.ok(usage.LOCAL_ACCEPTANCE_PROFILE);assert.equal(f.b.readStatus().id,usage.ROSTER_EVIDENCE_PROFILE.id)
 assert.throws(()=>f.b.handle({id:'model',role:'model'},f.activate),/owner_required/)
 assert.throws(()=>f.b.handle(OWNER,{...f.activate,commit:'b'.repeat(40)}),/usage_binding_conflict/)
 f.b.handle(OWNER,f.activate);assert.deepEqual(f.b.readStatus().limits,{turns:7,helper:38,website:0})
 assert.throws(()=>f.b.handle(OWNER,f.activate),/usage_attempt_replayed/)
 f.b.handle(OWNER,{op:'usage_pause'});assert.throws(()=>f.b.handle(OWNER,{op:'usage_activate'}),/usage_operation_not_allowed/)
 assert.throws(()=>usage.developmentProfile(usage.LOCAL_ACCEPTANCE_PROFILE.id),/usage_profile_not_allowed/);f.unchanged()
})
test('actual LocalAdapter transport shares six sends across parallel child work and restart; seventh never sends',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0);let sends=0;const a=adapter(()=>sends++)
 const results=await f.b.withScope(s,()=>Promise.allSettled(Array.from({length:12},()=>{const child=f.b.childScope(randomUUID());return f.make().withScope(child,()=>a.complete('offline'))})))
 assert.equal(sends,6);assert.equal(results.filter(r=>r.status==='fulfilled').length,6);assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='usage_limit_reached'))
 assert.equal(f.make().readStatus().helper.dispatched,6);assert.equal(f.make().readStatus().helper.succeeded,6)
 await assert.rejects(f.make().withScope(s,()=>a.complete('offline retry')),/usage_limit_reached/);assert.equal(sends,6);f.unchanged()
})
test('six dialogue slots and one isolated background slot share exactly 38 conservative reservations',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);let sends=0;const a=adapter(()=>sends++)
 for(let i=0;i<6;i++){const s=f.turn(i);await f.b.withScope(s,async()=>{for(let j=0;j<6;j++)await a.complete('offline')});f.b.finishTurn(s)}
 const s=f.turn(6);await f.b.withScope(s,async()=>{await a.complete('offline',{invocationPhase:'memory_extract'});await a.complete('offline',{invocationPhase:'memory_consolidation'});await assert.rejects(a.complete('extra',{invocationPhase:'memory_consolidation'}),/usage_limit_reached/)})
 assert.equal(sends,38);const st=f.make().readStatus();assert.equal(st.helper.reserved,38);assert.equal(st.helper.dispatched,38);assert.equal(st.helper.available,0);assert.equal(st.helper.unresolved,0);assert.throws(()=>f.b.handle(OWNER,{op:'usage_bind_turn',turnId:randomUUID(),conversationId:randomUUID()}),/usage_scope_required/);f.unchanged()
})
test('unspecified background, cloud model, reflection, wrong lane and unsigned request cannot send',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);let sends=0;const a=adapter(()=>sends++)
 await assert.rejects(f.b.withHeader(undefined,'d'.repeat(64),()=>a.complete('offline')),/usage_scope_required/)
 const s=f.turn(0);await f.b.withScope(s,async()=>{await assert.rejects(a.complete('offline',{invocationPhase:'memory_extract'}),/usage_operation_not_allowed/);assert.throws(()=>usage.nativePermit('helper',{model:'claude-opus-5-5',effort:'medium'}),/usage_model_not_allowed/)})
 const bg=f.turn(6);await f.b.withScope(bg,async()=>{await assert.rejects(a.complete('offline'),/usage_operation_not_allowed/);await assert.rejects(a.complete('offline',{invocationPhase:'memory_reflection'}),/usage_operation_not_allowed/)})
 assert.equal(sends,0);f.unchanged()
})
test('deadline and running-version drift are checked again immediately before native send',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0);let sends=0
 const a=adapter(()=>sends++,{fetchFn:async url=>{if(url.endsWith('/api/tags')){f.tick(90001);return Response.json({models:[{name:deployment.model,digest:deployment.digest}]})}sends++;throw Error('must_not_send')}})
 await assert.rejects(f.b.withScope(s,()=>a.complete('offline')),/usage_expired/);assert.equal(sends,0);f.unchanged()
})
test('unknown dispatched failure is retained, blocks further requests globally and cannot be refunded',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0);let sends=0
 const a=adapter(()=>{sends++;throw Error('offline connection lost')})
 await assert.rejects(f.b.withScope(s,()=>a.complete('offline')),/local_transport_or_protocol_error/)
 const st=f.make().readStatus();assert.equal(st.helper.reserved,1);assert.equal(st.helper.dispatched,1);assert.equal(st.helper.failed,1);assert.equal(st.helper.available,0);assert.equal(st.helper.unusedStopped,37)
 await assert.rejects(f.b.withScope(s,()=>a.complete('retry')),/usage_stopped/);assert.equal(sends,1);f.unchanged()
})
test('failed durable save before dispatch prevents native transport and preserves not-sent accounting',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0);let sends=0;const save=f.store.save
 f.store.save=r=>{if(r.timeline.at(-1).event==='dispatched')throw Error('offline disk full');save(r)}
 await assert.rejects(f.b.withScope(s,()=>adapter(()=>sends++).complete('offline')),/usage_audit_unavailable/)
 assert.equal(sends,0);f.store.save=save;const st=f.make().readStatus();assert.equal(st.helper.reserved,1);assert.equal(st.helper.dispatched,0);assert.equal(st.helper.failed,1);f.unchanged()
})

test('separate OS processes reserve the same durable allowance under actual transport contention',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0),worker=path.join(__dirname,'../../src/actions/localSharedBudgetWorker.fixture.cjs')
 const children=[0,1].map(()=>cp.fork(worker,[f.dir,JSON.stringify(s),COMMIT],{stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,NODE_PATH:process.env.NODE_PATH}}))
 t.after(()=>children.forEach(p=>{if(p.exitCode===null)p.kill()}))
 const rows=await Promise.all(children.map(p=>new Promise((resolve,reject)=>{let row,stderr='';p.stderr.on('data',c=>stderr+=c);p.on('message',v=>row=v);p.on('exit',code=>code===0?resolve(row):reject(Error('child_failed_'+code+':'+(row?.error?JSON.stringify(row):stderr.slice(-500)))))})))
 assert.equal(rows.reduce((n,r)=>n+r.sent,0),6);assert.equal(f.make().readStatus().helper.reserved,6);assert.equal(f.make().readStatus().helper.dispatched,6);f.unchanged()
})
test('restarted root retains whole-window expiry, runtime identity and paused local traffic fence',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0);let sends=0
 f.changeCommit();await assert.rejects(f.make().withScope(s,()=>adapter(()=>sends++).complete('offline')),/usage_binding_conflict/);assert.equal(sends,0)
 f.tick(900001);await assert.rejects(f.make().withScope(s,()=>adapter(()=>sends++).complete('offline')),/usage_binding_conflict|usage_expired/)
 f.b.finishTurn(s);f.b.handle(OWNER,{op:'usage_pause'});await assert.rejects(f.make().withHeader(undefined,'d'.repeat(64),()=>adapter(()=>sends++).complete('outside paused window')),/usage_run_not_active/);assert.equal(sends,0);f.unchanged()
})
test('background engine and persisted source validation share two sends and fail closed on unsupported learning',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(6),dir=path.join(f.dir,'isolated-learning');let sends=0
 const a=adapter(()=>sends++,{fetchFn:async url=>url.endsWith('/api/tags')?Response.json({models:[{name:deployment.model,digest:deployment.digest}]}):(sends++,new Response(JSON.stringify({message:{content:JSON.stringify({quotes:['invented preference']})},done:true})+'\n'))})
 const learning=require('../../src/localBrain/learning').createLearning({dir,adapter:a});f.cleanup(()=>learning.close())
 await assert.rejects(f.b.withScope(s,()=>learning.engine.forScope('private:owner').retain('xx-'+randomUUID(),'I prefer concise replies.')),/memory_invalid_result/)
 assert.equal(sends,1);assert.equal(f.b.readStatus().stopReason,'memory_invalid_result');assert.equal(learning.engine.status().inference.counts.failed,1)
 await assert.rejects(f.b.withScope(s,()=>a.complete('more',{invocationPhase:'memory_consolidation'})),/usage_stopped/);assert.equal(sends,1);f.unchanged()
})
test('local background slots cannot enter the dialogue ingress and child scope cannot change purpose',t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const turnId=usage.LOCAL_ACCEPTANCE_PROFILE.slots[6].id,conversationId=randomUUID();f.b.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId})
 assert.throws(()=>f.b.enterTurn(turnId,conversationId,randomUUID()),/usage_operation_not_allowed/)
 const s=f.b.enterTurn(turnId,conversationId,randomUUID(),'background')
 f.b.withScope(s,()=>{const child=f.b.childScope(randomUUID());assert.throws(()=>f.make().withScope({...child,turnId:usage.LOCAL_ACCEPTANCE_PROFILE.slots[0].id},()=>{}),/usage_scope_required/)})
 f.unchanged()
})
test('authenticated existing Action Gateway creates only the new profile and preserves all nine predecessors',async t=>{
 const f=fixture(t),token='c'.repeat(64),server=require('../../src/subscription/bridge').createBridge({token,usageBudget:f.b,schedulerActions:require('../../src/actions/service').createGateway({usageBudget:f.b})})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
 const post=async(auth,body)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/scheduler-action',{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,body:await r.json()}}
 assert.equal((await post('invalid',f.activate)).status,401);assert.equal(f.store.exists(usage.LOCAL_ACCEPTANCE_PROFILE.id),false)
 assert.equal((await post(token,f.activate)).body.budget.id,usage.LOCAL_ACCEPTANCE_PROFILE.id);assert.equal((await post(token,f.activate)).body.error,'usage_attempt_replayed');f.unchanged()
})
test('actual background interval inherits the same shared scope without approving its isolated candidate',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(6),text='I prefer concise test reports.',dir=path.join(f.dir,'timer-learning');let sends=0
 const a=adapter(()=>sends++,{fetchFn:async(url,init)=>{if(url.endsWith('/api/tags'))return Response.json({models:[{name:deployment.model,digest:deployment.digest}]});sends++;const system=JSON.parse(init.body).messages[0].content,result=system.includes('Return concise Traditional Chinese candidates')?{candidates:[{kind:'preference',subject:'Isolated fixture',text,quote:text,reason:'Explicit isolated statement',supersedes:null,taskState:null}]}:{quotes:[text]};return new Response(JSON.stringify({message:{content:JSON.stringify(result)},done:true})+'\n')}})
 const x=require('../../src/localBrain/learning').createLearning({dir,adapter:a});f.cleanup(()=>x.close());x.runtime.event('conversation','isolated-fixture',text,'owner_statement')
 await f.b.withScope(s,async()=>{x.start();const deadline=Date.now()+15000;while(Date.now()<deadline){await new Promise(r=>setTimeout(r,100));const candidates=await x.gateway.list(OWNER,{status:'candidate'});if(candidates.length&&!x.runtime.status().active&&!x.runtime.consolidation.status().busy)break}x.runtime.stop()})
 assert.equal(sends,2);assert.equal(f.b.readStatus().helper.dispatched,2);assert.equal((await x.gateway.list(OWNER,{status:'candidate'})).length,1);assert.equal((await x.gateway.preferences(OWNER)).items.length,0);f.unchanged()
})
test('host learning entry rejects unscoped and non-approved inputs without enabling a service',async t=>{
 const f=fixture(t),{runIsolatedLearningBatch}=require('../../src/actions/localAcceptanceLearning');f.b.handle(OWNER,f.activate)
 await assert.rejects(runIsolatedLearningBatch({budget:f.b,dir:path.join(f.dir,'new'),source:{},adapter:adapter(()=>{})}),/usage_scope_required/)
 const s=f.turn(6);await assert.rejects(f.b.withScope(s,()=>runIsolatedLearningBatch({budget:f.b,dir:path.join(f.dir,'new'),source:{},adapter:adapter(()=>{})})),/approved_source_required/)
 assert.equal(fs.existsSync(path.join(f.dir,'new')),false);assert.equal(f.b.readStatus().helper.reserved,0);f.unchanged()
})
test('bounded host entry runs the real isolated timer using the pinned preference provenance and persists an unapproved candidate',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(6),text='Owner 偏好之後的回報採固定三層簡短格式:第一行用一句話講結論,中間最多三個重點、每點只寫一行,風險與限制壓成最後一句,細節等 Owner 追問時才展開。';let sends=0
 const source={...usage.LOCAL_ACCEPTANCE_PROFILE.learningSource,text,scope:'private:owner',status:'active',type:'preference',source:{kind:'owner',id:'offline-original-source'}}
 const a=adapter(()=>sends++,{fetchFn:async(url,init)=>{if(url.endsWith('/api/tags'))return Response.json({models:[{name:deployment.model,digest:deployment.digest}]});sends++;const system=JSON.parse(init.body).messages[0].content,result=system.includes('Return concise Traditional Chinese candidates')?{candidates:[{kind:'preference',subject:'Isolated report preference',text,quote:text,reason:'Explicit source',supersedes:null,taskState:null}]}:{quotes:[text]};return new Response(JSON.stringify({message:{content:JSON.stringify(result)},done:true})+'\n')}})
 const dir=path.join(f.dir,'host-batch'),r=await f.b.withScope(s,()=>require('../../src/actions/localAcceptanceLearning').runIsolatedLearningBatch({budget:f.b,dir,source,adapter:a}))
 assert.equal(sends,2);assert.equal(r.attempts,2);assert.equal(r.approved,false);assert.equal(r.canonicalWrites,0);assert.equal(r.candidates[0].status,'candidate');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'acceptance-provenance.json'))).originalHash,source.hash);f.unchanged()
})
test('persistent lock contention refuses before reserve/send and never refunds an uncertain attempt',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0);let sends=0
 await f.b.withScope(s,async()=>{const release=f.store.lockRun(usage.LOCAL_ACCEPTANCE_PROFILE.id);try{await assert.rejects(adapter(()=>sends++).complete('offline'),/usage_busy/)}finally{release()}})
 assert.equal(sends,0);assert.equal(f.b.readStatus().helper.reserved,0);assert.ok(fs.readdirSync(path.join(f.dir,'evidence')).some(n=>n.startsWith('lock-failure-')));f.unchanged()
})

test("activation uses one timestamp when the real clock advances between reads",t=>{const f=fixture(t);f.advancingClock();f.b.handle(OWNER,f.activate);assert.equal(f.make().readStatus().helper.reserved,0);f.unchanged()})
test('explicit Owner closure releases ordinary dialogue only after all work resolves, never reopens acceptance or enables memory',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0)
 assert.throws(()=>f.b.handle(OWNER,{op:'usage_close'}),/usage_unresolved_work/)
 f.b.finishTurn(s);f.b.handle(OWNER,{op:'usage_pause'})
 await assert.rejects(f.b.withHeader(undefined,'d'.repeat(64),()=>adapter(()=>{}).complete('offline')),/usage_run_not_active/)
 assert.throws(()=>f.b.handle({id:'model',role:'model'},{op:'usage_close'}),/owner_required/)
 f.b.handle(OWNER,{op:'usage_close'});assert.equal(f.b.readStatus().state,'closed')
 f.b.withHeader(undefined,'d'.repeat(64),()=>assert.equal(usage.nativePermit('helper',{model:deployment.model,effort:'auto'}).permit,null))
 assert.throws(()=>f.b.withScope(s,()=>{}),/usage_run_not_active/);assert.throws(()=>f.b.handle(OWNER,f.activate),/usage_attempt_replayed/);assert.equal(f.b.readStatus().helper.reserved,0);f.unchanged()
})
test('slot-limit refusal reaches the existing final-response guard rather than a success-shaped fallback',async t=>{
 const f=fixture(t);f.b.handle(OWNER,f.activate);const s=f.turn(0),a=adapter(()=>{})
 await f.b.withScope(s,async()=>{for(let i=0;i<6;i++)await a.complete('offline');await assert.rejects(a.complete('seventh'),/usage_limit_reached/)})
 assert.equal(f.b.turnFailure(s),'usage_limit_reached');f.unchanged()
})
