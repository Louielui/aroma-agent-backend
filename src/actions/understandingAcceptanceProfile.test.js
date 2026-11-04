'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto')
const usage=require('./usageBudget'),OWNER={id:'owner',role:'owner'},MODEL={model:'claude-opus-5-5',effort:'medium'}
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'understanding-usage-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=require('./store').createStore({dir}),profile=usage.UNDERSTANDING_PROFILE;assert.ok(profile,'a distinct unactivated acceptance profile is required');const make=()=>usage.createUsageBudget({store,profile,activationReady:()=>true,evidenceDir:path.join(dir,'evidence')});return{store,profile,make,b:make()}}
function turn(b){const turnId=randomUUID(),conversationId=randomUUID();b.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId});return b.enterTurn(turnId,conversationId,randomUUID())}
test('new acceptance is inert, distinct from closed legacy capacity and not a development-root alias',t=>{
 const f=fixture(t);assert.notEqual(f.profile.id,usage.PROFILE.id);assert.equal(f.b.status().state,'not_activated');assert.equal(f.b.isActive(),false);assert.equal(f.b.status().helper.available,30);assert.equal(f.b.status().limits.turns,5);assert.equal(f.b.status().website.available,0)
 assert.throws(()=>f.b.enterTurn(randomUUID(),randomUUID(),randomUUID()),/usage_run_not_active/)
 for(const p of [f.profile,usage.PROFILE])assert.throws(()=>usage.developmentProfile(p.id),/usage_profile_not_allowed/)
 const scope={profile:'repository',budgetRoot:f.profile.id,files:['src/intake/distillPrompt.js']};assert.throws(()=>require('../core/projectTasks/repositoryScope').validate(scope,scope.files),/invalid_request/)
})
test('new profile cannot reopen or alter the legacy closed root',t=>{
 const f=fixture(t),legacy=usage.createUsageBudget({store:f.store,activationReady:()=>true});legacy.handle(OWNER,{op:'usage_activate'});legacy.handle(OWNER,{op:'usage_close'});const before=JSON.stringify(f.store.get(usage.PROFILE.id))
 f.b.handle(OWNER,{op:'usage_activate'});const s=turn(f.b);f.b.withScope(s,()=>f.b.reserve('helper',MODEL).finish(null,{text:'fixture'}));assert.equal(JSON.stringify(f.store.get(usage.PROFILE.id)),before);assert.throws(()=>legacy.handle(OWNER,{op:'usage_activate'}),/usage_run_closed/)
})
test('resident selection refuses an unresolved legacy window and requires separate activation after closure',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'understanding-resident-')),before=process.env.AROMA_DATA_DIR
 t.after(()=>{if(before===undefined)delete process.env.AROMA_DATA_DIR;else process.env.AROMA_DATA_DIR=before;fs.rmSync(dir,{recursive:true,force:true})})
 process.env.AROMA_DATA_DIR=dir
 const store=require('./store').createStore({dir:usage.ownerDirectory()}),legacy=usage.createUsageBudget({store,activationReady:()=>true})
 legacy.handle(OWNER,{op:'usage_activate'});assert.throws(()=>usage.owner(),/usage_unresolved_work/);legacy.handle(OWNER,{op:'usage_close'})
 const current=usage.owner();assert.equal(current.status().id,usage.UNDERSTANDING_PROFILE.id);assert.equal(current.status().state,'not_activated');assert.equal(current.status().helper.reserved,0);assert.throws(()=>current.handle(OWNER,{op:'usage_activate'}),/usage_idle_required/)
})
test('31st helper and every website call stop before dispatch across parallel work and restart',async t=>{
 const f=fixture(t);f.b.handle(OWNER,{op:'usage_activate'});const s=turn(f.b);let sent=0
 await f.b.withScope(s,async()=>{const results=await Promise.allSettled(Array.from({length:45},async()=>{const p=f.b.reserve('helper',MODEL);sent++;p.dispatched('cli_process_started');await Promise.resolve();p.finish(null,{text:'fixture'})}));assert.equal(results.filter(r=>r.status==='fulfilled').length,30);assert.throws(()=>f.b.reserve('website'),/usage_limit_reached/);const child=f.b.childScope(randomUUID());f.b.withScope(child,()=>assert.throws(()=>f.b.reserve('helper',MODEL),/usage_limit_reached/))})
 const restarted=f.make();assert.equal(sent,30);assert.equal(restarted.status().helper.dispatched,30);assert.equal(restarted.status().helper.available,0);assert.equal(restarted.status().website.dispatched,0);restarted.withScope(s,()=>assert.throws(()=>restarted.reserve('helper',MODEL),/usage_limit_reached/))
})
test('failed attempts consume capacity, the sixth turn is refused, closure is permanent and widening is rejected',t=>{
 const f=fixture(t);f.b.handle(OWNER,{op:'usage_activate'});const s=turn(f.b);f.b.withScope(s,()=>{f.b.reserve('helper',MODEL).finish(Error('fixture_failure'));assert.throws(()=>f.b.reserve('helper',{...MODEL,effort:'high'}),/usage_model_not_allowed/)});f.b.finishTurn(s)
 for(let i=1;i<5;i++){const current=turn(f.b);f.b.finishTurn(current)}assert.throws(()=>turn(f.b),/usage_turn_limit_reached/);assert.equal(f.b.status().helper.available,29);f.b.handle(OWNER,{op:'usage_close'});assert.throws(()=>f.make().handle(OWNER,{op:'usage_activate'}),/usage_run_closed/)
 assert.throws(()=>usage.createUsageBudget({store:f.store,profile:{...f.profile,helper:31}}),/usage_profile_not_allowed/)
})
