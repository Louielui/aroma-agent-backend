'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),{randomUUID}=require('node:crypto'),usage=require('./usageBudget')
const OWNER={id:'owner',role:'owner'},MODEL={model:'claude-opus-5-5',effort:'medium'}
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'advice-usage-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=require('./store').createStore({dir});assert.ok(usage.ADVICE_PROFILE);const make=()=>usage.createUsageBudget({store,profile:usage.ADVICE_PROFILE,activationReady:()=>true,evidenceDir:path.join(dir,'evidence')});return{store,make,b:make()}}
function turn(b){const turnId=randomUUID(),conversationId=randomUUID();b.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId});return b.enterTurn(turnId,conversationId,randomUUID())}
test('new advice acceptance is inert, cannot alias development and cannot alter the previous window',t=>{
 const f=fixture(t);assert.equal(f.b.status().state,'not_activated');assert.deepEqual(f.b.status().limits,{turns:2,helper:12,website:0});assert.throws(()=>usage.developmentProfile(usage.ADVICE_PROFILE.id),/usage_profile_not_allowed/)
 const old=usage.createUsageBudget({store:f.store,profile:usage.UNDERSTANDING_PROFILE,activationReady:()=>true});old.handle(OWNER,{op:'usage_activate'});old.handle(OWNER,{op:'usage_close'});const before=JSON.stringify(f.store.get(usage.UNDERSTANDING_PROFILE.id))
 f.b.handle(OWNER,{op:'usage_activate'});assert.equal(JSON.stringify(f.store.get(usage.UNDERSTANDING_PROFILE.id)),before);assert.throws(()=>old.handle(OWNER,{op:'usage_activate'}),/usage_run_closed/)
})
test('thirteenth helper, every website and third turn stop before dispatch despite concurrency, children and restart',async t=>{
 const f=fixture(t);f.b.handle(OWNER,{op:'usage_activate'});const s=turn(f.b);let sent=0
 await f.b.withScope(s,async()=>{const results=await Promise.allSettled(Array.from({length:20},async()=>{const p=f.b.reserve('helper',MODEL);sent++;p.dispatched('cli_process_started');await Promise.resolve();p.finish(null,{text:'offline'})}));assert.equal(results.filter(x=>x.status==='fulfilled').length,12);assert.throws(()=>f.b.reserve('website'),/usage_limit_reached/);const child=f.b.childScope(randomUUID());f.b.withScope(child,()=>assert.throws(()=>f.b.reserve('helper',MODEL),/usage_limit_reached/));f.b.finishChild(child)})
 f.b.finishTurn(s);const second=turn(f.b);f.b.finishTurn(second);assert.throws(()=>turn(f.make()),/usage_turn_limit_reached/);assert.equal(sent,12);assert.equal(f.make().status().helper.dispatched,12);assert.equal(f.make().status().website.dispatched,0)
})
test('a fresh resident keeps an unclosed prior window and selects the new inert profile only after explicit closure',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'advice-selection-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const data=path.join(dir,'scheduler-action-runs/usage-budget'),store=require('./store').createStore({dir:data})
 const previous=usage.createUsageBudget({store,profile:usage.UNDERSTANDING_PROFILE,activationReady:()=>true});previous.handle(OWNER,{op:'usage_activate'});previous.handle(OWNER,{op:'usage_pause'})
 const inspect=()=>JSON.parse(cp.execFileSync(process.execPath,['-e',"const u=require(process.argv[1]);console.log(JSON.stringify(u.owner().readStatus()))",require.resolve('./usageBudget')],{env:{...process.env,AROMA_DATA_DIR:dir},encoding:'utf8'}))
 assert.equal(inspect().id,usage.UNDERSTANDING_PROFILE.id)
 // Existing close accepts active state only. This control-state transition adds
 // no turn/reservation and does not reopen any closed window or reset capacity.
 previous.handle(OWNER,{op:'usage_activate'});previous.handle(OWNER,{op:'usage_close'})
 const now=inspect();assert.equal(now.id,usage.ADVICE_PROFILE.id);assert.equal(now.state,'not_activated');assert.equal(now.helper.reserved,0)
})
