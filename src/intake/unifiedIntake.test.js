'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto')
process.env.AROMA_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'u1-contract-'))
const taskStore=require('../store/store')
const envelope=(patch={})=>({version:1,operation:'start',clientSubmissionId:randomUUID(),message:'Find the recipe; schedule daily 08:00; do not checkout',conversationId:randomUUID(),taskRef:null,expectedRevision:null,contextRefs:[],...patch})
test('C03/C18 closed U1 envelope rejects client authority and unknown versions',()=>{
 const {validate}=require('./unifiedContract');assert.doesNotThrow(()=>validate(envelope()))
 for(const patch of [{role:'owner'},{capabilities:[]},{receipt:{}},{version:2}])assert.throws(()=>validate(envelope(patch)))
})
test('C01/C02/C27 atomic reservation preserves one goal and creates no business Decision',()=>{
 const {createUnifiedIntake}=require('./unifiedIntake'),u=createUnifiedIntake({store:taskStore,enabled:()=>true}),b=envelope(),host={surface:'main',principal:'owner',scope:[]}
 const first=u.reserve(b,host),retry=u.reserve(b,host)
 assert.equal(first.taskId,retry.taskId);assert.equal(first.attemptId,retry.attemptId);assert.equal(first.replayed,false);assert.equal(retry.replayed,true)
 const t=taskStore.getTask(first.taskId);assert.equal(t.ownerGoal.originalObjective,b.message);assert.equal(t.ownerGoal.constraints[0],'do not checkout');assert.equal(t.ownerGoal.outcomes.length,2)
 assert.equal(taskStore.listDecisions().length,0)
 assert.throws(()=>u.reserve({...b,message:'changed'},host),/submission_conflict/)
})
test('C09/C13/C18 continue preserves identity, CAS and flag-off prevents replay',()=>{
 const {createUnifiedIntake}=require('./unifiedIntake');let on=true
 const u=createUnifiedIntake({store:taskStore,enabled:()=>on}),b=envelope(),h={surface:'chrome',principal:'owner',scope:[]},a=u.reserve(b,h)
 u.link(a,{kind:'browser_read',id:randomUUID(),version:1});const view=u.view(a.taskId,{surface:'main',principal:'owner'}),c=envelope({operation:'continue',taskRef:a.taskId,expectedRevision:view.revision,message:b.message})
 const next=u.reserve(c,{...h,surface:'main'});assert.equal(next.taskId,a.taskId);assert.notEqual(next.attemptId,a.attemptId)
 assert.equal(u.view(a.taskId,{surface:'main',principal:'owner'}).goalId,view.goalId)
 assert.throws(()=>u.reserve({...c,clientSubmissionId:randomUUID()},{...h,surface:'main'}),/revision_conflict/)
 on=false;assert.throws(()=>u.reserve(envelope(),h),/unified_intake_disabled/);assert.equal(u.view(a.taskId,{surface:'main',principal:'owner'}).continuationEnabled,false)
})
test('C14/C16/C24 unsupported evidence never completes the goal',()=>{
 const {createUnifiedIntake}=require('./unifiedIntake'),u=createUnifiedIntake({store:taskStore,enabled:()=>true}),a=u.reserve(envelope(),{surface:'main',principal:'owner',scope:[]})
 assert.throws(()=>u.link(a,{kind:'invented',id:randomUUID(),version:1}),/invalid_execution_ref/)
 const v=u.view(a.taskId,{surface:'main',principal:'owner'});assert.notEqual(v.goalStatus,'GOAL_COMPLETED');assert(v.outcomes.every(o=>o.blockers.length))
 assert.throws(()=>u.view(a.taskId,{surface:'main',principal:'someone_else'}),/task_not_found/)
})
