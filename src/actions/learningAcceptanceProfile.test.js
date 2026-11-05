'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),usage=require('./usageBudget')
test('learning verification is inert, persistent and stops sends before the shared parallel limit',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'learning-budget-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=require('./store').createStore({dir}),make=()=>usage.createUsageBudget({store,profile:usage.LEARNING_PROFILE,activationReady:()=>true}),actor={id:'owner',role:'owner'},b=make(),model={model:'claude-opus-5-5',effort:'medium'}
 assert.equal(b.status().state,'not_activated');assert.equal(store.exists(usage.LEARNING_PROFILE.id),false);assert.deepEqual(b.status().limits,{turns:3,helper:18,website:0})
 assert.throws(()=>usage.developmentProfile(usage.LEARNING_PROFILE.id),/usage_profile_not_allowed/)
 assert.throws(()=>b.handle({id:'model',role:'model'},{op:'usage_activate'}),/owner_required/)
 b.handle(actor,{op:'usage_activate'});let sent=0
 for(let turn=0;turn<3;turn++){
  const turnId=randomUUID(),conversationId=randomUUID();b.handle(actor,{op:'usage_bind_turn',turnId,conversationId});const scope=b.enterTurn(turnId,conversationId,randomUUID())
  await b.withScope(scope,async()=>{
   assert.throws(()=>b.reserve('website'),/usage_limit_reached/)
   const outcomes=await Promise.allSettled(Array.from({length:turn===2?9:6},async(_,i)=>{const p=make().reserve('helper',model);sent++;p.dispatched('cli_process_started');await Promise.resolve();p.finish(turn===0&&i===0?Error('offline_failure'):null,{text:'offline substitute'})}))
   assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,6)
   if(turn===2){assert.equal(outcomes.filter(r=>r.status==='rejected').length,3);const child=b.childScope(randomUUID());b.withScope(child,()=>assert.throws(()=>make().reserve('helper',model),/usage_limit_reached/));b.finishChild(child)}
  });b.finishTurn(scope)
 }
 const status=make().readStatus();assert.equal(sent,18);assert.equal(status.helper.dispatched,18);assert.equal(status.helper.failed,1);assert.equal(status.helper.available,0)
 assert.throws(()=>make().handle(actor,{op:'usage_bind_turn',turnId:randomUUID(),conversationId:randomUUID()}),/usage_turn_limit_reached/)
})
test('resident selection preserves the paused scope ledger and never transfers its unused helper',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'learning-selection-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=require('./store').createStore({dir:path.join(dir,'scheduler-action-runs/usage-budget')}),actor={id:'owner',role:'owner'}
 for(const profile of [usage.UNDERSTANDING_PROFILE,usage.ADVICE_PROFILE,usage.PRIORITY_PROFILE,usage.CONVERSATION_PROFILE,usage.GOAL_PROFILE,usage.CLARITY_PROFILE,usage.PLANNING_PROFILE,usage.CONTINUATION_PROFILE,usage.MARKDOWN_PROFILE,usage.DRAFT_PROFILE,usage.HANDOFF_PROFILE,usage.VERIFIER_PROFILE,usage.EDIT_PROFILE]){const b=usage.createUsageBudget({store,profile,activationReady:()=>true});b.handle(actor,{op:'usage_activate'});b.handle(actor,{op:'usage_close'})}
 const old=usage.createUsageBudget({store,profile:usage.SCOPE_PROFILE,activationReady:()=>true});old.handle(actor,{op:'usage_activate'})
 const turnId=randomUUID(),conversationId=randomUUID();old.handle(actor,{op:'usage_bind_turn',turnId,conversationId});const scope=old.enterTurn(turnId,conversationId,randomUUID())
 old.withScope(scope,()=>{for(let i=0;i<5;i++){const p=old.reserve('helper',{model:'claude-opus-5-5',effort:'medium'});p.dispatched('cli_process_started');p.finish(null,{text:'offline substitute'})}});old.finishTurn(scope);old.handle(actor,{op:'usage_pause'})
 const inspect=()=>JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',"console.log(JSON.stringify(require('./src/actions/usageBudget').owner().status()))"],{cwd:path.join(__dirname,'../..'),env:{...process.env,AROMA_DATA_DIR:dir},encoding:'utf8'}))
 assert.equal(inspect().id,usage.SCOPE_PROFILE.id);assert.equal(inspect().helper.available,1);assert.equal(store.exists(usage.LEARNING_PROFILE.id),false)
 old.handle(actor,{op:'usage_activate'});old.handle(actor,{op:'usage_close'});assert.equal(inspect().id,usage.LEARNING_PROFILE.id);assert.equal(inspect().state,'not_activated');assert.equal(store.exists(usage.LEARNING_PROFILE.id),false)
})
