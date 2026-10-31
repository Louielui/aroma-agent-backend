'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createWorkflow}=require('./workflow')
test('a new committed-candidate workflow references verified evidence without replaying commit/test/review effects',async()=>{
 const calls=[],snapshots=[],accepted={committed:{commit:'a'.repeat(40)},tests:{exitCode:0},publication:{verified:true},pr:{number:109},review:{verdict:'pass'},evidenceSourceRunId:'old-immutable-run'}
 const workflow=createWorkflow({id:'new-run',save:r=>snapshots.push(r),adapter:{inspect:async()=>({next:'develop'}),preserve:async()=>({verified:true}),acceptCommitted:async()=>{calls.push('accept');return accepted},prepare:()=>assert.fail('replayed prepare'),test:()=>assert.fail('replayed test'),commit:()=>assert.fail('replayed commit'),publish:()=>assert.fail('replayed publish'),pullRequest:()=>assert.fail('replayed PR'),review:()=>assert.fail('replayed review'),evidence:async()=>({}),decide:()=>({allowed:false}),recheck:()=>assert.fail('policy must stop before merge')}})
 const result=await workflow.finish();assert.equal(result.state,'needs_attention');assert.equal(result.reason,'policy_exception');assert.deepEqual(calls,['accept']);assert.ok(snapshots.some(r=>r.state==='accepted_committed'));assert.equal(result.id,'new-run');assert.equal(result.evidenceSourceRunId,'old-immutable-run')
})
test('needs_attention is still not an admissible resumed initial state',()=>{assert.throws(()=>createWorkflow({id:'old-run',initial:{state:'needs_attention'},adapter:{},save:()=>{}}),/promotion_recovery_requires_inspection/)})
