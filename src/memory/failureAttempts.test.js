'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createGateway,OWNER}=require('./governed'),{createTestStore}=require('./structuredStore')
const {appendAttempt,buildAttemptEvidence,projectAttemptEvidence}=require('../investigation/memoryAttemptEvidence')
const {createWorkTrace}=require('../investigation/workTrace')
const at='2026-10-10T12:00:00.000Z',id='xx-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const observe=g=>g.observe(OWNER,{type:'episodic',subject:'Attempt fixture',text:'Use green folders.',scope:'private:owner',policy:'owner_history',source:{kind:'conversation',id:'fixture',at,attribution:'owner_statement'}})
test('lookup failure retains the exact trace and normal later completion retains safe failure history',async()=>{
 let fail=true,now=at,getCalls=0,retains=0
 const store=createTestStore(),g=createGateway({store,clock:()=>now,engine:{forScope:()=>({get:async()=>{getCalls++;if(fail)throw Error('memory_timeout');return null},retain:async()=>{retains++;return {facts:1}}})}})
 const row=await observe(g),failed=(await g.index(OWNER,row.id)).index
 assert.equal(failed.state,'unconfirmed');assert.equal(failed.failureCheckpoint,'index_lookup');assert.equal(failed.workTrace.recordId,row.id);assert.equal(retains,0)
 assert.equal(failed.attemptHistory[0].errorCode,'memory_timeout');assert.equal(failed.attemptHistory[0].workTrace.runId,failed.workTrace.runId)
 fail=false;now='2026-10-10T12:01:00.000Z'
 const done=(await g.index(OWNER,row.id)).index,progress=await g.progress(OWNER)
 assert.equal(done.state,'saved');assert.equal(getCalls,2);assert.equal(retains,1)
 const p=progress.memory_index.failureEvidence
 assert.equal(p.currentFailed,0);assert.equal(p.samples[0].lastFailure.checkpoint,'index_lookup')
 assert.equal(p.samples[0].laterCompletion.workTrace.workId,failed.workTrace.workId);assert.notEqual(p.samples[0].laterCompletion.workTrace.runId,failed.workTrace.runId)
 assert.equal(p.samples[0].laterCompletion.attempt,2);assert.ok(projectAttemptEvidence('memory_index',p,0,now))
 assert.doesNotMatch(JSON.stringify(p),/green folders|Attempt fixture/)
 await assert.rejects(g.progress({id:'agent',role:'agent'}),/permission_denied/)
})
test('validation rejection keeps a closed reason and later normal empty consolidation is local recovery only',async()=>{
 let valid=false,now=at
 const g=createGateway({store:createTestStore(),clock:()=>now,engine:{forScope:()=>({consolidate:async()=>valid?{candidates:[]}:{candidates:[{kind:'preference',subject:'Fixture',text:'not original',reason:'fixture',quote:'not original',supersedes:null,taskState:null}]}})}})
 const row=await observe(g),failure=await g.consolidate(OWNER,row.id)
 assert.equal(failure.failureCheckpoint,'consolidation_validation');assert.equal(failure.validationCode,'unsupported_quote')
 assert.equal(failure.error,'invalid_consolidation');assert.equal((await g.list(OWNER)).length,1)
 valid=true;now='2026-10-10T12:01:00.000Z'
 assert.equal((await g.consolidate(OWNER,row.id)).state,'empty')
 const p=(await g.progress(OWNER)).memory_consolidation.failureEvidence
 assert.equal(p.samples[0].lastFailure.validationCode,'unsupported_quote');assert.equal(p.samples[0].laterCompletion.state,'empty')
 assert.ok(projectAttemptEvidence('memory_consolidation',p,0,now));assert.doesNotMatch(JSON.stringify(p),/not original|green folders/)
})
test('metadata history is bounded, sanitized and cannot confirm recovery for a changed work identity',()=>{
 let state=null
 for(let i=1;i<=10;i++)state=appendAttempt('memory_index',state,{state:'unconfirmed',attempts:i,checkedAt:at,reason:'SECRET',failureCheckpoint:'SECRET',validationCode:'SECRET',workTrace:createWorkTrace('memory_index','same','extraction',i,id)},id)
 assert.equal(state.attemptHistory.length,6);assert.doesNotMatch(JSON.stringify(state.attemptHistory),/SECRET/)
 state=appendAttempt('memory_index',state,{state:'saved',attempts:11,checkedAt:at,workTrace:createWorkTrace('memory_index','changed','extraction',11,id)},id)
 const p=buildAttemptEvidence('memory_index',[{id,index:state}],at)
 assert.equal(p.samples[0].laterCompletion,null);assert.equal(p.historyComplete,false)
 const forged=structuredClone(p);forged.samples[0].laterCompletion=state.attemptHistory.at(-1)
 assert.equal(projectAttemptEvidence('memory_index',forged,0,at),null)
})
test('bounded samples retain omission counts, do not accept future timestamps or foreign traces',()=>{
 const rows=Array.from({length:20},(_,n)=>({id:'xx-'+n.toString(16).padStart(8,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa',index:{state:'unconfirmed',attempts:3,checkedAt:at,reason:'memory_unavailable'}}))
 rows[0].index.workTrace=createWorkTrace('memory_index','foreign','extraction',3,id)
 const p=buildAttemptEvidence('memory_index',rows,at)
 assert.equal(p.samples.length,12);assert.equal(p.omitted,8);assert.equal(p.untracedCurrentFailures,20)
 assert.ok(projectAttemptEvidence('memory_index',p,20,at))
 const bad=structuredClone(p);bad.samples[0].lastFailure.at='2099-01-01T00:00:00Z'
 assert.equal(projectAttemptEvidence('memory_index',bad,20,at),null)
})
