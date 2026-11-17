'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createRepositoryRequests}=require('./repositoryRequest'),{createMemoryRunStore}=require('../operating/runStore'),{createOwnerApprovalStore}=require('../../agent/ownerApprovalStore')
const OWNER={id:'owner',role:'owner'},HEAD='a'.repeat(40)
async function fixture({failDecision=false,nowAt=1000000000000}={}){
 let now=nowAt,activations=0,sends=0,verify=async()=>{}
 const store=createMemoryRunStore(),approvals=createOwnerApprovalStore({now:()=>now}),api=createRepositoryRequests({store,approvals,now:()=>now,enabled:()=>true,lock:()=>()=>{},record:(r,stage,facts={})=>{if(failDecision&&stage==='scope_approval_accepted')throw Error('audit_write_failed');r.steps.push({stage,facts});store.save(r)},inventory:{list:async()=>[{path:'src/example.js',eligible:true}]},sourceFor:d=>({read:async()=>({hash:'b'.repeat(64),evidence:{bootCommit:HEAD},order:{files:{'src/example.js':'module.exports=1',...d.tests}}}),verify:()=>verify()}),budget:{profile:()=>({helper:8}),status:()=>({state:'not_activated',helper:{reserved:0,available:8}}),activate:()=>{activations++}},launch:()=>{sends++}})
 const r=api.request(OWNER,{bootCommit:HEAD,requestId:randomUUID(),goal:'Fix one isolated source'}),scope={id:r.run.id,bootCommit:HEAD,criteria:['Preserve behavior'],editable:['src/example.js'],readonly:[]},card=await api.scope(OWNER,scope)
 return{api,store,scope,card,setNow:n=>{now=n},getNow:()=>now,setVerify:fn=>{verify=fn},counts:()=>({activations,sends}),input:()=>({id:card.run.id,hash:card.approval.hash,nonce:card.approval.nonce})}
}
test('saved expired source-card rejection records host receipt and evaluation time without activating or extending quota',async()=>{
 const f=await fixture(),expiry=f.card.approval.expiresAt;f.setNow(expiry+1)
 await assert.rejects(f.api.authorize(OWNER,f.input()),/approval_unavailable/)
 const v=f.api.view(f.store.get(f.card.run.id));assert.equal(v.run.state,'awaiting_scope_approval')
 assert.equal(v.run.scopeApprovalDiagnostic.reason,'approval_expired');assert.equal(v.run.scopeApprovalDiagnostic.receivedAt,new Date(expiry+1).toISOString());assert.equal(v.run.scopeApprovalDiagnostic.expiredAtReceipt,true)
 assert.equal(v.approvalTiming.state,'expired');assert.equal(v.approvalTiming.expiresAt,expiry);assert.equal(v.approvalTiming.serverNow,expiry+1);assert.equal(v.approvalTiming.remainingMs,0)
 assert.deepEqual(f.counts(),{activations:0,sends:0});assert.equal(v.usage.state,'not_activated');assert.ok(v.run.steps.some(s=>s.stage==='scope_approval_rejected'))
 f.setNow(expiry+999);assert.equal(f.api.view(f.store.get(f.card.run.id)).approvalTiming.expiresAt,expiry)
})
test('nonce rejection is specific and contains no submitted values; explicit fresh scope retains old decisions and activates only its valid nonce',async()=>{
 const f=await fixture(),nonce='private_nonce_marker';await assert.rejects(f.api.authorize(OWNER,{...f.input(),nonce}),/approval_unavailable/)
 const r=f.store.get(f.card.run.id);assert.equal(r.scopeApprovalDiagnostic.reason,'nonce_unknown');assert.equal(r.scopeApprovalDiagnostic.expiredAtReceipt,false);assert.equal(JSON.stringify(r).includes(nonce),false)
 assert.deepEqual(f.counts(),{activations:0,sends:0})
 const renewed=await f.api.scope(OWNER,f.scope);assert.equal(renewed.run.scopeApprovalDiagnostic,null);assert.equal(renewed.approval.hash,f.card.approval.hash);assert.ok(renewed.run.steps.some(s=>s.facts.reason==='nonce_unknown'))
 await f.api.authorize(OWNER,{id:renewed.run.id,hash:renewed.approval.hash,nonce:renewed.approval.nonce});assert.deepEqual(f.counts(),{activations:1,sends:1})
})

test('a displayed hash mistake never consumes the valid nonce: explicit correct confirmation keeps existing semantics with both decisions retained',async()=>{
 const f=await fixture();await assert.rejects(f.api.authorize(OWNER,{...f.input(),hash:'c'.repeat(64)}),/approval_unavailable/);assert.deepEqual(f.counts(),{activations:0,sends:0});await f.api.authorize(OWNER,f.input());assert.deepEqual(f.counts(),{activations:1,sends:1});const steps=f.store.get(f.card.run.id).steps;assert.equal(steps.filter(s=>s.stage==='scope_approval_rejected').length,1);assert.equal(steps.filter(s=>s.stage==='scope_approval_accepted').length,1)
})
test('approval received before expiry but evaluated after a slow source verification is distinguished from late receipt',async()=>{
 const f=await fixture(),expiry=f.card.approval.expiresAt;f.setNow(expiry-5);f.setVerify(async()=>f.setNow(expiry+1))
 await assert.rejects(f.api.authorize(OWNER,f.input()),/approval_unavailable/)
 const d=f.store.get(f.card.run.id).scopeApprovalDiagnostic;assert.equal(d.reason,'nonce_expired');assert.equal(d.expiredAtReceipt,false);assert.equal(d.receivedAt,new Date(expiry-5).toISOString());assert.equal(d.evaluatedAt,new Date(expiry+1).toISOString());assert.deepEqual(f.counts(),{activations:0,sends:0})
})
test('hash mismatch and source verification failures keep their exact safe diagnostics without copying exceptions',async()=>{
 const f=await fixture();await assert.rejects(f.api.authorize(OWNER,{...f.input(),hash:'c'.repeat(64)}),/approval_unavailable/);assert.equal(f.store.get(f.card.run.id).scopeApprovalDiagnostic.reason,'displayed_hash_mismatch');assert.deepEqual(f.counts(),{activations:0,sends:0})
 const g=await fixture();g.setVerify(async()=>{throw Error('source_changed')});await assert.rejects(g.api.authorize(OWNER,g.input()),/source_changed/);assert.equal(g.store.get(g.card.run.id).scopeApprovalDiagnostic.reason,'source_verification_failed');assert.deepEqual(g.counts(),{activations:0,sends:0})
})
test('successful approval records a positive receipt only after all binding and nonce checks, and prevents replay',async()=>{
 const f=await fixture();const v=await f.api.authorize(OWNER,f.input());assert.equal(v.run.state,'queued');assert.equal(v.run.scopeApprovalDiagnostic.outcome,'accepted');assert.equal(v.run.scopeApprovalDiagnostic.reason,'accepted');assert.deepEqual(f.counts(),{activations:1,sends:1});await assert.rejects(f.api.authorize(OWNER,f.input()),/approval_unavailable/);assert.deepEqual(f.counts(),{activations:1,sends:1})
})

test('audit persistence failure cannot activate quota or dispatch, and the consumed nonce cannot be replayed',async()=>{
 const f=await fixture({failDecision:true});await assert.rejects(f.api.authorize(OWNER,f.input()),/audit_write_failed/);assert.deepEqual(f.counts(),{activations:0,sends:0});await assert.rejects(f.api.authorize(OWNER,f.input()),/approval_unavailable/);assert.deepEqual(f.counts(),{activations:0,sends:0});assert.equal(f.store.get(f.card.run.id).scopeApprovalDiagnostic.reason,'nonce_already_used')
})

test('saved November source-card epoch has a host-bound MBT and UTC display without shifting the expiry or issuing usage',async()=>{
 const f=await fixture({nowAt:1794897003452}),v=f.api.view(f.store.get(f.card.run.id))
 assert.equal(v.approvalTiming.expiresAt,1794897603452)
 assert.deepEqual(v.approvalTiming.display,{epoch:1794897603452,utc:'2026-11-17T06:40:03.452Z',local:'2026-11-17 01:40:03.452 UTC-05:00',timeZone:'America/Winnipeg',rule:'manitoba-permanent-05-2026'})
 assert.equal(v.approvalTiming.remainingMs,600000);assert.deepEqual(f.counts(),{activations:0,sends:0})
 f.setNow(1794897603452);await assert.rejects(f.api.authorize(OWNER,f.input()),/approval_unavailable/)
 assert.equal(f.store.get(f.card.run.id).scopeApprovalDiagnostic.reason,'approval_expired');assert.deepEqual(f.counts(),{activations:0,sends:0})
})
