'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto')
const usage=require('./usageBudget'),deployment=require('../localBrain/deploymentProfile.json')
test('registered local programming has an inert source-bound profile, with no subscription or extension capacity',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'local-registered-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const id=randomUUID(),commit='a'.repeat(40)
 const b=require('../core/projectTasks/repositoryBudget').createRepositoryBudget({dir,modeFor:()=> 'local',runtimeCommit:()=>commit})
 assert.equal(b.profile(id).model,deployment.model);assert.equal(b.profile(id).helper,8);assert.equal(b.status(id).state,'not_activated');assert.equal(fs.readdirSync(dir).length,0)
 b.activate(id,commit);assert.equal(b.status(id).commit,commit);assert.throws(()=>b.activate(id,commit),/usage_attempt_replayed/)
 return b.run(id,()=>{assert.throws(()=>usage.nativePermit('helper',{model:'gpt-6.1-sol',effort:'high'}),/usage_model_not_allowed/);assert.throws(()=>usage.nativePermit('website',{}),/usage_operation_not_allowed/);assert.throws(()=>usage.nativePermit('helper',{model:deployment.model,effort:'auto',digest:deployment.digest,phase:'memory_extract'}),/usage_operation_not_allowed/);assert.equal(b.status(id).helper.reserved,0)})
})
test('registered local calls retain native accounting, hard caps, digest, restart, mode binding and a terminal pause',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'local-registered-cap-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const id=randomUUID(),commit='a'.repeat(40),make=()=>require('../core/projectTasks/repositoryBudget').createRepositoryBudget({dir,modeFor:()=> 'local',runtimeCommit:()=>commit}),b=make();b.activate(id,commit)
 await b.run(id,()=>{for(let i=0;i<8;i++){const {permit}=usage.nativePermit('helper',{model:deployment.model,effort:'auto',digest:deployment.digest,phase:i%2?'local_code_review':'local_coding'});permit.dispatched('local_http_send');permit.finish(null,{})}assert.throws(()=>usage.nativePermit('helper',{model:deployment.model,effort:'auto',digest:deployment.digest,phase:'local_coding'}),/usage_limit_reached/)})
 assert.equal(make().status(id).helper.dispatched,8);assert.throws(()=>require('../core/projectTasks/repositoryBudget').createRepositoryBudget({dir}).status(id),/usage_audit_unavailable/);b.finish(id);assert.equal(make().status(id).state,'paused');await assert.rejects(make().run(id,()=>{throw Error('must not run')}),/usage_unresolved_work/);assert.throws(()=>usage.localDevelopmentProfile(usage.LOCAL_CODING_PROFILE.id),/usage_profile_not_allowed/)
})

test('concurrent requests and child retries cannot replenish a registered local allowance',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'local-registered-parallel-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const id=randomUUID(),commit='a'.repeat(40),b=require('../core/projectTasks/repositoryBudget').createRepositoryBudget({dir,modeFor:()=> 'local',runtimeCommit:()=>commit});b.activate(id,commit)
 let sent=0
 await b.run(id,async()=>{
  const send=async()=>{const {permit}=usage.nativePermit('helper',{model:deployment.model,effort:'auto',digest:deployment.digest,phase:'local_coding'});permit.dispatched('local_http_send');sent++;await new Promise(r=>setImmediate(r));permit.finish(null,{})}
  const results=await Promise.allSettled(Array.from({length:20},send));assert.equal(results.filter(r=>r.status==='fulfilled').length,8);assert.equal(sent,8);assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='usage_limit_reached'))
  const child=usage.service().childScope(randomUUID());assert.throws(()=>usage.service().withScope(child,()=>usage.nativePermit('helper',{model:deployment.model,effort:'auto',digest:deployment.digest,phase:'local_coding'})),/usage_limit_reached/);usage.service().finishChild(child)
 });assert.equal(b.status(id).helper.reserved,8);assert.equal(b.status(id).helper.dispatched,8);b.finish(id)
})
