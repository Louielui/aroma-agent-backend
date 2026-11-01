'use strict'
// Deterministic lifecycle fixtures: no real review, model call or promotion.
const test=require('node:test'),assert=require('node:assert/strict'),{createWorkflow,waitForIdle}=require('./workflow')
test('native CLI exposes an explicit preparation action without widening approval arguments',()=>{
 const {argumentsOf}=require('../../scripts/repository/tranche.cjs')
 assert.equal(argumentsOf(['prepare-review','--files','docs/example.md']).action,'prepare-review')
 assert.throws(()=>argumentsOf(['prepare-review','--review-pass','true']),/invalid_repository_argument/)
 assert.throws(()=>argumentsOf(['prepare-review','--exception','owner']),/invalid_repository_argument/)
})
function fixture(overrides={}){
 const calls=[],snapshots=[],adapter={inspect:async()=>({next:'develop'}),preserve:async()=>({verified:true}),prepare:async()=>{calls.push('prepare');return{tree:'tree'}},test:async()=>{calls.push('tests');return{exitCode:0}},commit:async()=>{calls.push('commit');return{commit:'commit'}},publish:async()=>{calls.push('publish');return{verified:true}},pullRequest:async()=>{calls.push('pr');return{number:1}},review:async()=>{calls.push('review');return{verdict:'pass'}},recheckReview:async()=>{calls.push('check_review');return true},evidence:async()=>assert.fail('review-only must not publish checks'),merge:async()=>assert.fail('review-only must not merge'),deploy:async()=>assert.fail('review-only must not deploy'),...overrides}
 return{calls,snapshots,adapter,workflow:createWorkflow({id:'fixture',adapter,save:r=>snapshots.push(structuredClone(r)),stopBeforeReview:true})}
}
test('native preparation pauses before any review call and exposes the committed exact source',async()=>{
 const f=fixture(),r=await f.workflow.finish();assert.equal(r.state,'awaiting_review');assert.equal(r.reviewHold,true);assert.deepEqual(f.calls,['prepare','tests','commit','publish','pr']);assert.equal(r.review,undefined)
 assert.equal((await waitForIdle(r,{coordinator:{resume:()=>assert.fail('no automatic review'),runtime:{idle:()=>assert.fail('no polling')}}})).state,'awaiting_review')
})
test('explicit same-run review resumes only the review, records real adapter output and remains on Hold',async()=>{
 const f=fixture(),prepared=await f.workflow.finish(),resumed=createWorkflow({id:prepared.id,initial:prepared,adapter:f.adapter,save:r=>f.snapshots.push(structuredClone(r))})
 const r=await resumed.resume();assert.equal(r.id,prepared.id);assert.equal(r.state,'reviewed_hold');assert.equal(r.review.verdict,'pass');assert.deepEqual(f.calls,['prepare','tests','commit','publish','pr','check_review','review'])
 await assert.rejects(resumed.resume(),/promotion_recovery_requires_inspection/);assert.throws(()=>createWorkflow({initial:{state:'needs_attention'},adapter:{},save:()=>{}}),/promotion_recovery_requires_inspection/)
})
test('stale source blocks before review; provider failure and findings cannot be retried as a pending review',async()=>{
 for(const fault of ['stale','provider','findings']){
  let reviews=0;const f=fixture({recheckReview:async()=>fault!=='stale',review:async()=>{reviews++;if(fault==='provider')throw Error('worker_timeout');return{verdict:'changes_requested',findings:[]}}}),p=await f.workflow.finish(),w=createWorkflow({id:p.id,initial:p,adapter:f.adapter,save:()=>{}})
  const r=await w.resume();assert.equal(r.state,'needs_attention');assert.equal(reviews,fault==='stale'?0:1);assert.equal(r.reason,{stale:'head_or_base_changed',provider:'worker_timeout',findings:'review_changes_requested'}[fault]);assert.throws(()=>createWorkflow({initial:r,adapter:f.adapter,save:()=>{}}),/promotion_recovery_requires_inspection/)
 }
})
test('concurrent explicit resume cannot duplicate the review; restart at reviewing is inspection-only',{timeout:5000},async()=>{
 let enter,release,reviews=0;const entered=new Promise(r=>{enter=r}),held=new Promise(r=>{release=r}),f=fixture({review:async()=>{reviews++;enter();await held;return{verdict:'pass'}}}),p=await f.workflow.finish(),rows=[],w=createWorkflow({id:p.id,initial:p,adapter:f.adapter,save:r=>rows.push(structuredClone(r))})
 const first=w.resume();await entered;await assert.rejects(w.resume(),/promotion_busy/);assert.throws(()=>createWorkflow({initial:rows.at(-1),adapter:f.adapter,save:()=>{}}),/promotion_recovery_requires_inspection/);release();assert.equal((await first).state,'reviewed_hold');assert.equal(reviews,1)
})
