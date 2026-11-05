'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),usage=require('./usageBudget')

test('the proposed planning window is inert and refuses concurrent excess, retries, children and model drift before dispatch',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'planning-budget-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=require('./store').createStore({dir}),make=()=>usage.createUsageBudget({store,profile:usage.PLANNING_PROFILE,activationReady:()=>true}),b=make(),actor={id:'owner',role:'owner'},model={model:'claude-opus-5-5',effort:'medium'}
 assert.equal(b.status().state,'not_activated');assert.equal(store.exists(usage.PLANNING_PROFILE.id),false);assert.deepEqual(b.status().limits,{turns:2,helper:12,website:0});assert.throws(()=>usage.developmentProfile(usage.PLANNING_PROFILE.id),/usage_profile_not_allowed/)
 assert.throws(()=>b.handle({id:'model',role:'model'},{op:'usage_activate'}),/owner_required/);b.handle(actor,{op:'usage_activate'});let sent=0
 for(let turn=0;turn<2;turn++){
  const turnId=randomUUID(),conversationId=randomUUID();b.handle(actor,{op:'usage_bind_turn',turnId,conversationId});const scope=b.enterTurn(turnId,conversationId,randomUUID())
  await b.withScope(scope,async()=>{
   assert.throws(()=>b.reserve('helper',{...model,effort:'high'}),/usage_model_not_allowed/);assert.throws(()=>b.reserve('website'),/usage_limit_reached/)
   const results=await Promise.allSettled(Array.from({length:turn===0?6:9},async(_,i)=>{const p=make().reserve('helper',model);sent++;p.dispatched('cli_process_started');await Promise.resolve();p.finish(i===0?Error('offline_failure'):null,{text:'offline substitute'})}))
   assert.equal(results.filter(r=>r.status==='fulfilled').length,6);assert.equal(results.filter(r=>r.status==='rejected').length,turn===0?0:3)
   if(turn===1){assert.throws(()=>make().reserve('helper',model),/usage_limit_reached/);const child=b.childScope(randomUUID());b.withScope(child,()=>assert.throws(()=>make().reserve('helper',model),/usage_limit_reached/));b.finishChild(child)}
  });b.finishTurn(scope)
 }
 const persisted=make().readStatus();assert.equal(sent,12);assert.equal(persisted.helper.dispatched,12);assert.equal(persisted.helper.failed,2);assert.equal(persisted.helper.available,0);assert.equal(persisted.website.reserved,0);assert.equal(persisted.helper.unresolved,0);assert.throws(()=>b.handle(actor,{op:'usage_bind_turn',turnId:randomUUID(),conversationId:randomUUID()}),/usage_turn_limit_reached/)
})

test('resident selection preserves the spent paused clarity ledger and only explicit closure exposes an empty planning definition',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'planning-selection-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=require('./store').createStore({dir:path.join(dir,'scheduler-action-runs/usage-budget')}),actor={id:'owner',role:'owner'}
 for(const profile of [usage.UNDERSTANDING_PROFILE,usage.ADVICE_PROFILE,usage.PRIORITY_PROFILE,usage.CONVERSATION_PROFILE,usage.GOAL_PROFILE]){const b=usage.createUsageBudget({store,profile,activationReady:()=>true});b.handle(actor,{op:'usage_activate'});b.handle(actor,{op:'usage_close'})}
 const old=usage.createUsageBudget({store,profile:usage.CLARITY_PROFILE,activationReady:()=>true});old.handle(actor,{op:'usage_activate'})
 for(let i=0;i<3;i++){const turnId=randomUUID(),conversationId=randomUUID();old.handle(actor,{op:'usage_bind_turn',turnId,conversationId});const scope=old.enterTurn(turnId,conversationId,randomUUID());old.withScope(scope,()=>{for(let j=0;j<2;j++){const p=old.reserve('helper',{model:'claude-opus-5-5',effort:'medium'});p.dispatched('cli_process_started');p.finish(null,{text:'offline substitute'})}});old.finishTurn(scope)}
 old.handle(actor,{op:'usage_pause'});const before=structuredClone(store.get(usage.CLARITY_PROFILE.id))
 const inspect=()=>JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',"console.log(JSON.stringify(require(process.argv[1]).owner().readStatus()))",require.resolve('./usageBudget')],{env:{...process.env,AROMA_DATA_DIR:dir},encoding:'utf8'}))
 const paused=inspect();assert.equal(paused.id,usage.CLARITY_PROFILE.id);assert.equal(paused.state,'paused');assert.equal(paused.turnsUsed,3);assert.equal(paused.helper.reserved,6);assert.equal(paused.helper.available,12);assert.equal(store.exists(usage.PLANNING_PROFILE.id),false);assert.deepEqual(store.get(usage.CLARITY_PROFILE.id),before)
 old.handle(actor,{op:'usage_activate'});old.handle(actor,{op:'usage_close'});const next=inspect();assert.equal(next.id,usage.PLANNING_PROFILE.id);assert.equal(next.state,'not_activated');assert.equal(next.turnsUsed,0);assert.equal(next.helper.reserved,0);assert.equal(next.helper.available,12);assert.equal(store.exists(usage.PLANNING_PROFILE.id),false);assert.deepEqual(store.get(usage.CLARITY_PROFILE.id).attempts,before.attempts);assert.deepEqual(store.get(usage.CLARITY_PROFILE.id).turns,before.turns)
})
