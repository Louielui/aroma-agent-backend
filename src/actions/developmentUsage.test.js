'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto')
const usage=require('./usageBudget'),{createStore}=require('./store')
test('development and acceptance use different immutable profiles and persistent caps',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'development-budget-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const id=randomUUID(),profile=usage.developmentProfile(id),make=()=>usage.createUsageBudget({profile,store:createStore({dir}),evidenceDir:path.join(dir,'evidence'),activationReady:()=>true}),b=make(),actor={id:'owner',role:'owner'}
 b.handle(actor,{op:'usage_activate'});b.handle(actor,{op:'usage_bind_turn',turnId:id,conversationId:id});const s=b.enterTurn(id,id,id)
 let sent=0;await b.withScope(s,async()=>{for(let i=0;i<8;i++){const p=usage.nativePermit('helper',{model:i%2?'claude-sonnet-5-5':'gpt-6.1-sol',effort:i%2?'medium':'high'}).permit;p.dispatched('provider_turn_start');sent++;p.finish(null)}})
 assert.equal(sent,8);assert.equal(make().status().helper.available,0)
 await assert.rejects(make().withScope(s,async()=>usage.nativePermit('helper',{model:'gpt-6.1-sol',effort:'high'})),/usage_limit_reached/)
 assert.equal(usage.createUsageBudget({store:createStore({dir})}).status().state,'not_activated');assert.equal(usage.PROFILE.helper,40)
 assert.throws(()=>usage.createUsageBudget({profile:{...profile,helper:9},store:createStore({dir})}),/usage_profile_not_allowed/)
 assert.throws(()=>usage.developmentProfile(usage.PROFILE.id),/usage_profile_not_allowed/)
})
test('parallel sends, native retries and child requests share the same durable cap',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'development-concurrent-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const id=randomUUID(),{createRepositoryBudget}=require('../core/projectTasks/repositoryBudget'),b=createRepositoryBudget({dir});b.activate(id);let sends=0
 await b.run(id,async()=>{
  const results=await Promise.allSettled(Array.from({length:20},async(_,i)=>{
   const child=usage.service().childScope(randomUUID());return usage.service().withScope(child,async()=>{
    const p=usage.nativePermit('helper',{model:'gpt-6.1-sol',effort:'high'}).permit;p.dispatched('provider_turn_start');sends++;await new Promise(r=>setImmediate(r));p.finish(i===0?Error('provider_failed'):null)
   })
  }));assert.equal(results.filter(r=>r.status==='fulfilled').length,8);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.message==='usage_limit_reached').length,12)
  assert.throws(()=>usage.nativePermit('website',{}),/usage_limit_reached/)
 })
 assert.equal(sends,8);const restarted=createRepositoryBudget({dir});assert.equal(restarted.status(id).helper.failed,1);assert.equal(restarted.status(id).helper.dispatched,8);assert.equal(restarted.status(id).helper.available,0)
 await assert.rejects(restarted.run(id,async()=>usage.nativePermit('helper',{model:'gpt-6.1-sol',effort:'high'})),/usage_limit_reached/);assert.equal(sends,8);assert.throws(()=>restarted.activate(id),/usage_attempt_replayed/)
})
