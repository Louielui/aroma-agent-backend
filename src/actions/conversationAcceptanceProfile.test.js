'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),{randomUUID}=require('node:crypto'),usage=require('./usageBudget')
const OWNER={id:'owner',role:'owner'},MODEL={model:'claude-opus-5-5',effort:'medium'}
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conversation-budget-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=require('./store').createStore({dir});const make=()=>usage.createUsageBudget({store,profile:usage.CONVERSATION_PROFILE,activationReady:()=>true});return{store,make,b:make()}}
function turn(b){const turnId=randomUUID(),conversationId=randomUUID();b.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId});return b.enterTurn(turnId,conversationId,randomUUID())}

test('the conversation definition remains inert and cannot alias a development allocation',t=>{
 const f=fixture(t);assert.equal(f.b.status().state,'not_activated');assert.equal(f.store.exists(usage.CONVERSATION_PROFILE.id),false);assert.deepEqual(f.b.status().limits,{turns:2,helper:12,website:0});assert.throws(()=>usage.developmentProfile(usage.CONVERSATION_PROFILE.id),/usage_profile_not_allowed/)
})

test('conversation capacity stops before send at twelve helpers, zero websites and two turns across concurrency, children and restart',async t=>{
 const f=fixture(t);f.b.handle(OWNER,{op:'usage_activate'});const s=turn(f.b);let sent=0
 await f.b.withScope(s,async()=>{const settled=await Promise.allSettled(Array.from({length:18},async()=>{const p=f.b.reserve('helper',MODEL);sent++;p.dispatched('cli_process_started');await Promise.resolve();p.finish(null,{text:'offline'})}));assert.equal(settled.filter(x=>x.status==='fulfilled').length,12);assert.throws(()=>f.b.reserve('website'),/usage_limit_reached/);const child=f.b.childScope(randomUUID());f.b.withScope(child,()=>assert.throws(()=>f.b.reserve('helper',MODEL),/usage_limit_reached/));f.b.finishChild(child)})
 f.b.finishTurn(s);const second=turn(f.b);f.b.finishTurn(second);assert.throws(()=>turn(f.make()),/usage_turn_limit_reached/);assert.equal(sent,12);assert.equal(f.make().status().helper.dispatched,12)
})

test('a paused priority window stays selected until explicit closure, with all prior usage preserved',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conversation-selection-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=require('./store').createStore({dir:path.join(dir,'scheduler-action-runs/usage-budget')})
 for(const profile of [usage.UNDERSTANDING_PROFILE,usage.ADVICE_PROFILE]){const b=usage.createUsageBudget({store,profile,activationReady:()=>true});b.handle(OWNER,{op:'usage_activate'});b.handle(OWNER,{op:'usage_close'})}
 const previous=usage.createUsageBudget({store,profile:usage.PRIORITY_PROFILE,activationReady:()=>true});previous.handle(OWNER,{op:'usage_activate'});const s=turn(previous);previous.withScope(s,()=>{const p=previous.reserve('helper',MODEL);p.dispatched('cli_process_started');p.finish(Error('offline_failure'))});previous.finishTurn(s);previous.handle(OWNER,{op:'usage_pause'})
 const inspect=()=>JSON.parse(cp.execFileSync(process.execPath,['-e',"const u=require(process.argv[1]);console.log(JSON.stringify(u.owner().readStatus()))",require.resolve('./usageBudget')],{env:{...process.env,AROMA_DATA_DIR:dir},encoding:'utf8'}));assert.equal(inspect().id,usage.PRIORITY_PROFILE.id)
 assert.equal(store.exists(usage.CONVERSATION_PROFILE.id),false)
 const before=structuredClone(store.get(usage.PRIORITY_PROFILE.id));previous.handle(OWNER,{op:'usage_activate'});previous.handle(OWNER,{op:'usage_close'});const now=inspect();assert.equal(now.id,usage.CONVERSATION_PROFILE.id);assert.equal(now.state,'not_activated');assert.equal(now.helper.reserved,0);assert.equal(store.exists(usage.CONVERSATION_PROFILE.id),false)
 const after=store.get(usage.PRIORITY_PROFILE.id);assert.deepEqual(after.attempts,before.attempts);assert.deepEqual(after.turns,before.turns);assert.deepEqual(after.timeline.slice(0,before.timeline.length),before.timeline);assert.throws(()=>previous.handle(OWNER,{op:'usage_activate'}),/usage_run_closed/)
})
