'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),{randomUUID}=require('node:crypto'),usage=require('./usageBudget')
const OWNER={id:'owner',role:'owner'},MODEL={model:'claude-opus-5-5',effort:'medium'}
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'goal-budget-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=require('./store').createStore({dir});const make=()=>usage.createUsageBudget({store,profile:usage.GOAL_PROFILE,activationReady:()=>true});return{store,make,b:make()}}
function turn(b){const turnId=randomUUID(),conversationId=randomUUID();b.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId});return b.enterTurn(turnId,conversationId,randomUUID())}

test('the goal-correction definition is inert, exactly one turn and six helpers, and cannot alias development capacity',t=>{
 assert.ok(usage.GOAL_PROFILE);const f=fixture(t);assert.equal(f.b.status().state,'not_activated');assert.equal(f.store.exists(usage.GOAL_PROFILE.id),false);assert.deepEqual(f.b.status().limits,{turns:1,helper:6,website:0});assert.deepEqual({model:usage.GOAL_PROFILE.model,effort:usage.GOAL_PROFILE.effort},MODEL);assert.throws(()=>usage.developmentProfile(usage.GOAL_PROFILE.id),/usage_profile_not_allowed/)
})

test('six is a pre-send ceiling across concurrent attempts, failed attempts, children and restart; no second turn',async t=>{
 assert.ok(usage.GOAL_PROFILE);const f=fixture(t);f.b.handle(OWNER,{op:'usage_activate'});const s=turn(f.b);let sent=0
 await f.b.withScope(s,async()=>{
  const attempts=await Promise.allSettled(Array.from({length:12},async(_,i)=>{const p=f.b.reserve('helper',MODEL);sent++;p.dispatched('cli_process_started');await Promise.resolve();p.finish(i===0?Error('offline_failure'):null,{text:'offline'})}))
  assert.equal(attempts.filter(a=>a.status==='fulfilled').length,6);assert.equal(sent,6);assert.throws(()=>f.b.reserve('website'),/usage_limit_reached/)
  const child=f.b.childScope(randomUUID());f.b.withScope(child,()=>assert.throws(()=>f.b.reserve('helper',MODEL),/usage_limit_reached/));f.b.finishChild(child)
  f.make().withScope(s,()=>assert.throws(()=>f.make().reserve('helper',MODEL),/usage_limit_reached/))
 })
 f.b.finishTurn(s);const before=f.b.readStatus();assert.equal(before.helper.failed,1);assert.equal(before.helper.dispatched,6);assert.equal(before.helper.available,0)
 f.make().handle(OWNER,{op:'usage_activate'});assert.throws(()=>turn(f.make()),/usage_turn_limit_reached/);assert.deepEqual(f.make().readStatus().attempts,before.attempts)
})

test('the existing Opus/Medium subscription boundary refuses other models and effort before send',t=>{
 assert.ok(usage.GOAL_PROFILE);const f=fixture(t);f.b.handle(OWNER,{op:'usage_activate'});const s=turn(f.b)
 f.b.withScope(s,()=>{for(const input of [{...MODEL,effort:'high'},{model:'gpt-6.1-sol',effort:'high'},{model:'claude-sonnet-5-5',effort:'medium'}])assert.throws(()=>f.b.reserve('helper',input),/usage_model_not_allowed/);assert.equal(f.b.status().helper.reserved,0)})
})

test('the exhausted paused conversation root remains resident; only explicit closure selects an inert goal window',t=>{
 assert.ok(usage.GOAL_PROFILE);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'goal-selection-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=require('./store').createStore({dir:path.join(dir,'scheduler-action-runs/usage-budget')})
 for(const profile of [usage.UNDERSTANDING_PROFILE,usage.ADVICE_PROFILE,usage.PRIORITY_PROFILE]){const b=usage.createUsageBudget({store,profile,activationReady:()=>true});b.handle(OWNER,{op:'usage_activate'});b.handle(OWNER,{op:'usage_close'})}
 const previous=usage.createUsageBudget({store,profile:usage.CONVERSATION_PROFILE,activationReady:()=>true});previous.handle(OWNER,{op:'usage_activate'})
 for(const count of [4,5]){const s=turn(previous);previous.withScope(s,()=>{for(let i=0;i<count;i++){const p=previous.reserve('helper',MODEL);p.dispatched('cli_process_started');p.finish(null,{text:'offline'})}});previous.finishTurn(s)}
 previous.handle(OWNER,{op:'usage_pause'});const before=structuredClone(store.get(usage.CONVERSATION_PROFILE.id)),inspect=()=>JSON.parse(cp.execFileSync(process.execPath,['-e',"const u=require(process.argv[1]);console.log(JSON.stringify(u.owner().readStatus()))",require.resolve('./usageBudget')],{env:{...process.env,AROMA_DATA_DIR:dir},encoding:'utf8'}))
 const paused=inspect();assert.equal(paused.id,usage.CONVERSATION_PROFILE.id);assert.equal(paused.state,'paused');assert.equal(paused.turnsUsed,2);assert.equal(paused.helper.reserved,9);assert.equal(paused.helper.available,3);assert.equal(store.exists(usage.GOAL_PROFILE.id),false)
 previous.handle(OWNER,{op:'usage_activate'});previous.handle(OWNER,{op:'usage_close'});const next=inspect();assert.equal(next.id,usage.GOAL_PROFILE.id);assert.equal(next.state,'not_activated');assert.equal(next.helper.reserved,0);assert.equal(next.helper.available,6);assert.equal(store.exists(usage.GOAL_PROFILE.id),false)
 const after=store.get(usage.CONVERSATION_PROFILE.id);assert.deepEqual(after.attempts,before.attempts);assert.deepEqual(after.turns,before.turns);assert.deepEqual(after.timeline.slice(0,before.timeline.length),before.timeline);assert.throws(()=>previous.handle(OWNER,{op:'usage_activate'}),/usage_run_closed/)
})
