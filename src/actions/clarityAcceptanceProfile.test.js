'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),usage=require('./usageBudget')
test('the proposed clarity window is inert and shares a persistent hard ceiling across turns, children and failures',async t=>{
 assert.ok(usage.CLARITY_PROFILE);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clarity-budget-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=require('./store').createStore({dir}),make=()=>usage.createUsageBudget({store,profile:usage.CLARITY_PROFILE,activationReady:()=>true}),b=make(),actor={id:'owner',role:'owner'},model={model:'claude-opus-5-5',effort:'medium'}
 assert.equal(b.status().state,'not_activated');assert.equal(store.exists(usage.CLARITY_PROFILE.id),false);assert.deepEqual(b.status().limits,{turns:3,helper:18,website:0});assert.throws(()=>usage.developmentProfile(usage.CLARITY_PROFILE.id),/usage_profile_not_allowed/)
 b.handle(actor,{op:'usage_activate'});let sent=0
 for(let turn=0;turn<3;turn++){
  const turnId=randomUUID(),conversationId=randomUUID();b.handle(actor,{op:'usage_bind_turn',turnId,conversationId});const scope=b.enterTurn(turnId,conversationId,randomUUID())
  await b.withScope(scope,async()=>{if(turn===0){assert.throws(()=>b.reserve('helper',{...model,effort:'high'}),/usage_model_not_allowed/);assert.equal(b.status().helper.reserved,0)}const results=await Promise.allSettled(Array.from({length:6},async(_,i)=>{const p=make().reserve('helper',model);sent++;p.dispatched('cli_process_started');await Promise.resolve();p.finish(i===0?Error('offline_failure'):null,{text:'offline'})}));assert.ok(results.every(r=>r.status==='fulfilled'));assert.throws(()=>b.reserve('website'),/usage_limit_reached/)
   if(turn===2){const child=b.childScope(randomUUID());b.withScope(child,()=>assert.throws(()=>make().reserve('helper',model),/usage_limit_reached/));b.finishChild(child)}
  });b.finishTurn(scope)
 }
 assert.equal(sent,18);assert.equal(make().readStatus().helper.failed,3);assert.throws(()=>b.handle(actor,{op:'usage_bind_turn',turnId:randomUUID(),conversationId:randomUUID()}),/usage_turn_limit_reached/)
})
test('resident selection preserves the paused goal ledger and only explicit closure exposes an unactivated clarity profile',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clarity-selection-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=require('./store').createStore({dir:path.join(dir,'scheduler-action-runs/usage-budget')}),actor={id:'owner',role:'owner'}
 for(const profile of [usage.UNDERSTANDING_PROFILE,usage.ADVICE_PROFILE,usage.PRIORITY_PROFILE,usage.CONVERSATION_PROFILE]){const b=usage.createUsageBudget({store,profile,activationReady:()=>true});b.handle(actor,{op:'usage_activate'});b.handle(actor,{op:'usage_close'})}
 const old=usage.createUsageBudget({store,profile:usage.GOAL_PROFILE,activationReady:()=>true});old.handle(actor,{op:'usage_activate'});const turnId=randomUUID(),conversationId=randomUUID();old.handle(actor,{op:'usage_bind_turn',turnId,conversationId});const scope=old.enterTurn(turnId,conversationId,randomUUID());old.withScope(scope,()=>{for(let i=0;i<4;i++){const p=old.reserve('helper',{model:'claude-opus-5-5',effort:'medium'});p.dispatched('cli_process_started');p.finish(null,{text:'offline'})}});old.finishTurn(scope);old.handle(actor,{op:'usage_pause'});const before=structuredClone(store.get(usage.GOAL_PROFILE.id))
 const inspect=()=>JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',"console.log(JSON.stringify(require(process.argv[1]).owner().readStatus()))",require.resolve('./usageBudget')],{env:{...process.env,AROMA_DATA_DIR:dir},encoding:'utf8'}))
 assert.equal(inspect().id,usage.GOAL_PROFILE.id);assert.equal(inspect().helper.reserved,4);assert.equal(inspect().helper.available,2);assert.equal(store.exists(usage.CLARITY_PROFILE.id),false)
 old.handle(actor,{op:'usage_activate'});old.handle(actor,{op:'usage_close'});const next=inspect();assert.equal(next.id,usage.CLARITY_PROFILE.id);assert.equal(next.state,'not_activated');assert.equal(next.helper.reserved,0);assert.equal(store.exists(usage.CLARITY_PROFILE.id),false);assert.deepEqual(store.get(usage.GOAL_PROFILE.id).attempts,before.attempts);assert.deepEqual(store.get(usage.GOAL_PROFILE.id).turns,before.turns)
})
