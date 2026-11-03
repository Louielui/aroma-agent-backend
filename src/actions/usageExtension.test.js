'use strict'
// Offline Action-store/provider fixtures. No live grant, model or website.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto')
const {createUsageBudget,developmentProfile}=require('./usageBudget'),{createStore}=require('./store'),{hash}=require('./contract')
const OWNER={id:'owner',role:'owner'},MODEL={coding:{model:'gpt-6.1-sol',effort:'high'},result_review:{model:'claude-sonnet-5-5',effort:'medium'}}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usage-extension-'));t.after(()=>{assert.equal(path.dirname(fs.realpathSync(dir)).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());assert.ok(path.basename(dir).startsWith('usage-extension-'));fs.rmSync(dir,{recursive:true,force:true})})
 const id=randomUUID(),workId=randomUUID(),store=createStore({dir});let now=1000,witness={workId,commit:'a'.repeat(40),approvalHash:'b'.repeat(64),idle:true,eligible:true}
 const make=()=>createUsageBudget({profile:developmentProfile(id),store,now:()=>now,activationReady:()=>true,extensionWitness:()=>({...witness})}),b=make();b.handle(OWNER,{op:'usage_activate'});b.handle(OWNER,{op:'usage_bind_turn',turnId:id,conversationId:id});const scope=b.enterTurn(id,id,id)
 b.withScope(scope,()=>{for(let i=0;i<8;i++){const p=b.reserve('helper',MODEL.result_review);p.dispatched('provider_turn_start');p.finish(null)}})
 const prepare=()=>b.handle(OWNER,{op:'usage_extension_prepare',workId,commit:witness.commit,attemptsHash:hash(b.status().attempts)}).extension
 const approve=p=>b.handle(OWNER,{op:'usage_extension_approve',id:p.id,hash:p.hash,nonce:p.nonce})
 const send=(service,purpose,model=MODEL[purpose])=>service.withScope(scope,()=>service.withAllocation(workId,purpose,()=>{const p=service.reserve('helper',model);p.dispatched('provider_turn_start');p.finish(null);return p.id}))
 return{id,workId,b,store,make,scope,prepare,approve,send,setNow:v=>{now=v},drift:patch=>{witness={...witness,...patch}}}
}
test('a same-root extension retains the original eight attempts and reserves one coding and one review only',t=>{
 const f=fixture(t),before=f.b.status(),p=f.prepare();assert.equal(f.b.status().helper.available,0);f.approve(p);const active=f.b.status();assert.deepEqual(active.attempts,before.attempts);assert.deepEqual(active.limits,{turns:1,helper:8,website:0});assert.equal(active.helper.limit,10);assert.equal(active.helper.available,2)
 f.send(f.b,'coding');assert.throws(()=>f.send(f.b,'coding'),/usage_allocation_exhausted/);f.send(f.make(),'result_review');assert.equal(f.make().status().helper.reserved,10);assert.equal(f.make().status().helper.available,0);assert.throws(()=>f.approve(p),/approval_unavailable/)
})
test('extension cannot be forged by a changed limit, applied twice, activated for a new task, or used without a phase',t=>{
 const f=fixture(t),p=f.prepare();assert.throws(()=>f.b.handle({id:'model',role:'owner'},{op:'usage_extension_approve',id:p.id,hash:p.hash,nonce:p.nonce}),/owner_required/);f.approve(p)
 assert.throws(()=>f.b.withScope(f.scope,()=>f.b.reserve('helper',MODEL.coding)),/usage_allocation_required/)
 assert.throws(()=>f.b.withScope(f.scope,()=>f.b.withAllocation(randomUUID(),'coding',()=>{})),/usage_binding_conflict/)
 assert.throws(()=>f.send(f.b,'coding',MODEL.result_review),/usage_model_not_allowed/);assert.throws(()=>f.prepare(),/usage_extension_unavailable/)
 const row=f.store.get(f.id);row.limits.helper=10;f.store.save(row);assert.throws(()=>f.make().status(),/usage_audit_unavailable/)
})
test('expired, restarted, source-drifted or changed-ledger extension approvals cannot add allowance',t=>{
 for(const fault of ['expired','restart','source','ledger','busy']){
  const f=fixture(t),p=f.prepare();if(fault==='expired')f.setNow(601001);if(fault==='source')f.drift({commit:'c'.repeat(40)});if(fault==='busy')f.drift({idle:false});if(fault==='ledger'){const r=f.store.get(f.id);r.attempts[0].failureCode='changed';f.store.save(r)}
  const service=fault==='restart'?f.make():f.b;assert.throws(()=>service.handle(OWNER,{op:'usage_extension_approve',id:p.id,hash:p.hash,nonce:p.nonce}),/approval_unavailable|usage_binding_conflict|usage_idle_required/);assert.equal(f.make().status().helper.limit,8)
 }
})
test('grant expiry, source drift, uncertain failure and concurrent requests cannot cause an eleventh dispatch',async t=>{
 const f=fixture(t);f.approve(f.prepare());let sent=0
 const result=await Promise.allSettled(Array.from({length:12},async()=>{f.b.withScope(f.scope,()=>f.b.withAllocation(f.workId,'coding',()=>{const p=f.b.reserve('helper',MODEL.coding);sent++;p.dispatched('provider_turn_start');p.finish(Error('fixture_failure'))}))}))
 assert.equal(sent,1);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.make().status().helper.failed,1)
 f.drift({commit:'c'.repeat(40)});assert.throws(()=>f.send(f.make(),'result_review'),/usage_binding_conflict/);f.drift({commit:'a'.repeat(40)});f.setNow(3601001);assert.throws(()=>f.send(f.make(),'result_review'),/usage_extension_expired/);assert.equal(f.b.status().helper.reserved,9);assert.equal(f.b.status().helper.available,0);assert.equal(f.b.status().helper.unusedExpired,1)
})
test('failed grant or reservation persistence prevents capacity or provider dispatch',t=>{
 const f=fixture(t),p=f.prepare(),save=f.store.save;f.store.save=()=>{throw Error('fixture_disk_failure')};assert.throws(()=>f.approve(p),/usage_audit_unavailable/);assert.equal(f.make().status().helper.limit,8);f.store.save=save;assert.throws(()=>f.approve(p),/approval_unavailable/)
 const g=fixture(t);g.approve(g.prepare());g.store.save=()=>{throw Error('fixture_disk_failure')};assert.throws(()=>g.send(g.b,'coding'),/usage_audit_unavailable/);assert.equal(g.make().status().helper.reserved,8)
})
test('the closed Owner entry accepts identifiers only and adds no execution or deployment switch',()=>{
 const entry=require('../../scripts/repository/approveUsageExtension.cjs'),args=['inspect','--candidate','a'.repeat(40),'--pr','118','--evidence-run',randomUUID(),'--root',randomUUID(),'--work',randomUUID()]
 assert.equal(entry.argumentsOf([...args]).mode,'inspect');for(const suffix of [['--helper','20'],['--deploy','true'],['--command','run'],['--root',randomUUID()]])assert.throws(()=>entry.argumentsOf([...args,...suffix]),/invalid_usage_entry_argument/)
})
test('malformed persisted grants, expired unused slots and extra input cannot silently become usable capacity',t=>{
 const f=fixture(t);assert.throws(()=>f.b.handle(OWNER,{op:'usage_extension_prepare',workId:f.workId,commit:'a'.repeat(40),attemptsHash:hash(f.b.status().attempts),helper:200}),/invalid_request/);f.approve(f.prepare());const r=f.store.get(f.id);r.extension.material=null;f.store.save(r);assert.throws(()=>f.make().status(),/usage_audit_unavailable/)
})
