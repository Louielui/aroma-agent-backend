'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createWorkflow } = require('./workflow')
function fixture (changes={}) {
  const events=[];let current='a'.repeat(40)
  const adapter={
    inspect:async()=>({next:'develop',commit:current}),preserve:async()=>{events.push('preserve');return{verified:true}},
    prepare:async()=>{events.push('prepare');return{tree:'b'.repeat(40)}},
    test:async()=>{events.push('tests');return{exitCode:0}},commit:async()=>{events.push('commit');return{commit:current}},
    publish:async()=>{events.push('publish');return{verified:true}},review:async()=>{events.push('review');return{verdict:'pass'}},
    pullRequest:async()=>{events.push('pr');return{number:65}},evidence:async()=>({allowed:true}),
    decide:()=>({allowed:true,reasons:[]}),recheck:async()=>{events.push('recheck');return true},
    merge:async()=>{events.push('merge');current='c'.repeat(40);return{commit:current}},
    deploy:async()=>{events.push('deploy');return{expected:current}},
    verify:async()=>{events.push('verify');return{verified:true}},
    rollback:async()=>{events.push('rollback');return{commit:'d'.repeat(40)}},
    verifyRollback:async()=>{events.push('verify_rollback');return{verified:true}},
    ...changes
  }
  const rows=[];const w=createWorkflow({adapter,save:row=>rows.push(structuredClone(row)),id:'fixture'})
  return {w,events,rows}
}
test('ordinary promotion preserves, tests, commits, publishes, reviews, merges, deploys and verifies in order',async()=>{
  const {w,events}=fixture();const row=await w.finish()
  assert.equal(row.state,'complete');assert.deepEqual(events,['preserve','prepare','tests','commit','publish','pr','review','recheck','merge','deploy','verify'])
})
test('divergence saves unique history before reconciliation and never takes ordinary merge path',async()=>{
  const {w,events}=fixture({inspect:async()=>({next:'preserve_then_reconcile'}),reconcile:async()=>{events.push('reconcile');return{state:'needs_reconciliation'}}})
  assert.equal((await w.finish()).state,'needs_reconciliation');assert.deepEqual(events,['preserve','reconcile'])
})
test('a runtime mismatch preserves unpublished history when repository identity is proven, then stops promotion',async()=>{
  const {w,events}=fixture({inspect:async()=>({next:'blocked',reason:'runtime_mismatch',preservationAllowed:true})})
  const row=await w.finish();assert.equal(row.reason,'runtime_mismatch');assert.equal(row.preservation.verified,true)
  assert.deepEqual(events,['preserve'])
  const foreign=fixture({inspect:async()=>({next:'blocked',reason:'repository_identity_unavailable'})})
  await foreign.w.finish();assert.deepEqual(foreign.events,[])
})
test('failed tests and review findings cannot merge or declare complete',async()=>{
  for(const changes of [{test:async()=>({exitCode:1})},{review:async()=>({verdict:'changes_requested'})}]){
    const {w,events}=fixture(changes);assert.equal((await w.finish()).state,'needs_attention');assert.ok(!events.includes('merge'))
  }
})
test('failed review keeps the exact closed failure boundary without leaking arbitrary error text',async()=>{
  for(const reason of ['review_invalid_output','claude_login_required','arbitrary secret text']){
    const {w,events}=fixture({review:async()=>{throw Error(reason)}})
    const row=await w.finish();assert.equal(row.failure.stage,'pr_prepared')
    assert.equal(row.reason,reason==='arbitrary secret text'?'promotion_unavailable':reason)
    assert.ok(!events.includes('merge'));assert.ok(!JSON.stringify(row).includes('arbitrary secret text'))
  }
})
test('a head race after approval blocks merge rather than rerunning with old evidence',async()=>{
  const {w,events}=fixture({recheck:async()=>false});assert.equal((await w.finish()).reason,'head_or_base_changed');assert.ok(!events.includes('merge'))
})
test('verification failure automatically rolls back and independently reads back its state',async()=>{
  const {w,events,rows}=fixture({verify:async()=>({verified:false,reason:'boot_commit_mismatch'})})
  const row=await w.finish();assert.equal(row.state,'rolled_back');assert.deepEqual(events.slice(-2),['rollback','verify_rollback']);assert.ok(rows.some(x=>x.failure?.reason==='boot_commit_mismatch'))
})
test('verification throwing also rolls back; a failed rollback remains an Owner exception',async()=>{
  const {w}=fixture({verify:async()=>{throw Error('verification_unavailable')},rollback:async()=>{throw Error('rollback_failed')}})
  const row=await w.finish();assert.equal(row.state,'needs_attention');assert.equal(row.reason,'rollback_failed');assert.ok(row.failure)
})
test('Windows privilege block persists a reload-pending state without bypass, rollback or completion',async()=>{
  const {w,events}=fixture({deploy:async()=>({state:'administrator_required',applied:false})})
  const row=await w.finish();assert.equal(row.state,'awaiting_administrator');assert.ok(!events.includes('rollback'));assert.ok(!events.includes('verify'))
})
test('concurrent execution is rejected and restart cannot blindly replay a spent merge or deploy',async()=>{
  let release;const pending=new Promise(r=>{release=r});const {w}=fixture({preserve:async()=>{await pending;return{verified:true}}})
  const first=w.finish();await assert.rejects(w.finish(),/promotion_busy/);release();await first
  await assert.rejects(w.finish(),/promotion_already_finished/)
})
test('an idle wait resumes only deployment, never tests/review/merge, and a permission retry restarts once',async()=>{
  let ready=false
  const {w,events}=fixture({deploy:async()=>{events.push('deploy');return ready?{applied:true}:{state:'idle_required',applied:false}},recheckPending:async()=>true})
  assert.equal((await w.finish()).state,'awaiting_idle');ready=true
  assert.equal((await w.resume()).state,'complete');assert.equal(events.filter(x=>x==='merge').length,1)
  const f=fixture({deploy:async()=>({state:'administrator_required',applied:false}),recheckDeployed:async()=>true,restartPending:async()=>{f.events.push('restart_pending');return{state:'restarted'}}})
  await f.w.finish();assert.equal((await f.w.resume()).state,'complete');assert.equal(f.events.filter(x=>x==='restart_pending').length,1)
})
