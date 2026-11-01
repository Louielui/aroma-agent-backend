'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),usage=require('../../actions/usageBudget')
const {fixture,OWNER,OLD,NEW,FILE,TEST,ticket}=require('./recoveryFixture.cjs')

test('same-ID recovery keeps original failure/source, reuses approved tests and exhausts only the original allowance',async t=>{
 const f=await fixture(t),before=structuredClone(f.failed),priorEvents=f.counts().events,requestId=randomUUID(),p=await f.prepare(requestId)
 assert.equal(p.run.id,before.id);assert.equal(p.run.state,'failed');assert.equal(f.counts().coding,1);assert.equal(f.budget.status(f.taskId).helper.reserved,6)
 const again=await f.prepare(requestId);assert.deepEqual(again.approval,p.approval);assert.equal(again.run.recoveries.length,1)
 await f.work.approveRecovery(OWNER,ticket(p));await f.work.settled();const r=f.work.get(OWNER,before.id)
 assert.equal(r.state,'completed');assert.equal(r.id,before.id);assert.deepEqual(r.source,before.source);assert.deepEqual(r.workOrder,before.workOrder);assert.deepEqual(r.steps.slice(0,before.steps.length),before.steps)
 assert.deepEqual(r.recoveries[0].failure.source,before.source);assert.equal(r.recoveries[0].failure.reason,before.reason);assert.deepEqual(r.recoveries[0].failure.failureDiagnostic,before.failureDiagnostic)
 assert.equal(r.result.sourceRevision,OLD);assert.equal(r.recoveries[0].runtimeCommit,NEW);assert.equal(r.repositoryPromotion.state,'held');assert.equal(r.appliedToLive,false)
 assert.equal(f.counts().coding,2);assert.equal(f.counts().reviews,1);assert.equal(f.store.all().length,1)
 assert.equal(f.counts().events,priorEvents)
 assert.deepEqual(r.workerRuns[0],before.workerRuns[0]);assert.equal(r.workerRuns.length,2);assert.equal(r.workerRuns[1].trace.workId,r.workerRuns[0].trace.workId);assert.equal(r.workerRuns[1].trace.attempt,2);assert.equal(f.reloadedBudget().helper.reserved,8)
 assert.equal(f.budget.status(f.taskId).helper.reserved,8);await assert.rejects(f.budget.run(f.taskId,async()=>usage.nativePermit('helper',{model:'gpt-6.1-sol',effort:'high'})),/usage_limit_reached/)
 await assert.rejects(f.work.approveRecovery(OWNER,ticket(p)),/approval_unavailable/)
})
test('recovery requires Owner, closed input shapes and a fresh nonce; original coding approval cannot replay',async t=>{
 const f=await fixture(t),input={id:f.failed.id,bootCommit:NEW,requestId:randomUUID()}
 await assert.rejects(f.work.prepareRecovery({id:'other',role:'manager'},input),/permission_denied/)
 for(const extra of [{command:'run'},{budgetRoot:randomUUID()},{files:[FILE]},{model:'other'}])await assert.rejects(f.work.prepareRecovery(OWNER,{...input,...extra}),/invalid_request/)
 assert.throws(()=>f.work.approve(OWNER,ticket(f.originalApproval)),/approval_unavailable/)
 const p=await f.prepare();await assert.rejects(f.work.approveRecovery(OWNER,{...ticket(p),nonce:f.originalApproval.approval.nonce}),/approval_unavailable/)
 assert.equal(f.counts().coding,1);assert.equal(f.budget.status(f.taskId).helper.reserved,6)
})
test('expiry and service restart cannot renew or execute a stored recovery ticket',async t=>{
 const f=await fixture(t),p=await f.prepare();f.expire();await assert.rejects(f.work.approveRecovery(OWNER,ticket(p)),/approval_unavailable/)
 const q=await f.prepare();f.restart();await assert.rejects(f.work.approveRecovery(OWNER,ticket(q)),/approval_unavailable/)
 assert.equal(f.counts().coding,1);assert.equal(f.budget.status(f.taskId).helper.reserved,6);assert.equal(f.work.get(OWNER,f.failed.id).state,'failed')
})
test('changed source, protected tests or registration never reaches a recovery model call',async t=>{
 for(const change of ['source','tests','scope']){
  const f=await fixture(t)
  if(change==='source')f.drift();if(change==='tests')f.registered.tests[TEST]+='\n// changed';if(change==='scope')f.registered.workOrder.allowedFiles.push('outside.js')
  await assert.rejects(f.prepare(),/source_changed/);assert.equal(f.counts().coding,1);assert.equal(f.budget.status(f.taskId).helper.reserved,6)
 }
 const f=await fixture(t),p=await f.prepare();f.drift();await assert.rejects(f.work.approveRecovery(OWNER,ticket(p)),/source_changed/);assert.equal(f.counts().coding,1)
})
test('insufficient or changed allowance refuses before dispatch without activation or refunds',async t=>{
 const f=await fixture(t),p=await f.prepare()
 await f.budget.run(f.taskId,async()=>{const permit=usage.nativePermit('helper',{model:'gpt-6.1-sol',effort:'high'}).permit;permit.dispatched('provider_turn_start');permit.finish(null)})
 await assert.rejects(f.work.approveRecovery(OWNER,ticket(p)),/usage_limit_reached|usage_binding_conflict/)
 await assert.rejects(f.prepare(),/usage_limit_reached/);assert.equal(f.counts().coding,1);assert.equal(f.budget.status(f.taskId).helper.reserved,7)
})
test('concurrent approvals and disabled execution cannot duplicate or start a recovery',async t=>{
 const f=await fixture(t),p=await f.prepare();let enter,release;const entered=new Promise(r=>{enter=r}),held=new Promise(r=>{release=r});f.block(async()=>{enter();await held})
 const first=f.work.approveRecovery(OWNER,ticket(p));await entered
 await assert.rejects(f.work.approveRecovery(OWNER,ticket(p)),/worker_busy/);f.disable();release();await assert.rejects(first,/not_enabled/)
 assert.equal(f.counts().coding,1);assert.equal(f.budget.status(f.taskId).helper.reserved,6)
})
test('altered persisted failure and completed/candidate work cannot receive recovery authority',async t=>{
 const f=await fixture(t),p=await f.prepare(),r=f.store.get(f.failed.id);r.reason='worker_timeout';f.store.save(r)
 await assert.rejects(f.work.approveRecovery(OWNER,ticket(p)),/approval_unavailable/);assert.equal(f.counts().coding,1)
 for(const patch of [{state:'completed'},{result:{patchHash:'c'.repeat(64)}},{appliedToLive:true},{reason:'source_changed'}]){f.store.save({...structuredClone(f.failed),...patch});await assert.rejects(f.prepare(),/recovery_unavailable/)}
})
test('background memory must already be paused and idle; recovery never changes its setting',async t=>{
 const f=await fixture(t),events=f.counts().events;f.background(true);await assert.rejects(f.prepare(),/recovery_background_not_idle/)
 f.background(false);const p=await f.prepare();f.background(true);await assert.rejects(f.work.approveRecovery(OWNER,ticket(p)),/recovery_background_not_idle/)
 assert.equal(f.counts().coding,1);assert.equal(f.budget.status(f.taskId).helper.reserved,6)
 assert.equal(f.counts().events,events)
})
test('cancelling a queued recovery records a separate outcome without dispatch or erasing the original failure',async t=>{
 const f=await fixture(t),p=await f.prepare();let checks=0,enter,release;const entered=new Promise(r=>{enter=r}),held=new Promise(r=>{release=r})
 f.block(async()=>{if(++checks===2){enter();await held}})
 await f.work.approveRecovery(OWNER,ticket(p));await entered;f.work.cancel(OWNER,f.failed.id);release();await f.work.settled()
 const r=f.work.get(OWNER,f.failed.id);assert.equal(r.state,'cancelled');assert.equal(r.recoveries[0].outcome.state,'cancelled');assert.equal(r.recoveries[0].failure.reason,'subscription_unavailable');assert.equal(f.counts().coding,1);assert.equal(f.counts().reviews,0);assert.equal(f.budget.status(f.taskId).helper.reserved,6)
})

