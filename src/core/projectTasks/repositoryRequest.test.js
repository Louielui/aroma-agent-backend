'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createMemoryRunStore}=require('../operating/runStore')
const OWNER={id:'owner',role:'owner'},HEAD='a'.repeat(40)
test('general repair intake persists the whole goal and deduplicates across request IDs and restarts without a model call',async()=>{
 const {createRepositoryRequests}=require('./repositoryRequest'),store=createMemoryRunStore();let sent=0
 const options={store,enabled:()=>true,lock:()=>()=>{},launch:()=>{sent++},record:(r,stage,facts={})=>{r.steps.push({stage,facts});store.save(r)}}
 const a=createRepositoryRequests(options),input={bootCommit:HEAD,requestId:randomUUID(),goal:'Repair response presentation across modules. Preserve memory opt-out and P02-C.'}
 const first=a.request(OWNER,input),second=a.request(OWNER,{...input,requestId:randomUUID()})
 assert.equal(first.run.state,'awaiting_scope');assert.equal(first.run.input.goal,input.goal);assert.equal(first.run.id,second.run.id);assert.equal(sent,0)
 const restarted=createRepositoryRequests(options),continued=restarted.continue(OWNER,{id:first.run.id,requestId:randomUUID()})
 assert.equal(continued.run.id,first.run.id);assert.equal(continued.nextAction,'select_scope');assert.equal(store.all().length,1);assert.equal(sent,0)
 assert.throws(()=>a.request(OWNER,{...input,goal:'Different objective'}),/request_conflict/)
 assert.throws(()=>a.request({id:'staff',role:'manager'},input),/permission_denied/)
})
test('repository scopes cannot nominate another repository, approval, source root, or acceptance budget',()=>{
 const {request}=require('./contract')
 const v={bootCommit:HEAD,requestId:randomUUID(),goal:'Repair a local source defect',criteria:['Preserve other answers'],editable:['src/intake/routeEvidenceGuard.js'],scope:{profile:'repository',files:['src/intake/routeEvidenceGuard.js'],budgetRoot:randomUUID()}}
 assert.equal(request(v).scope.profile,'repository')
 for(const bad of [{...v,scope:{...v.scope,budgetRoot:require('../../actions/usageBudget').PROFILE.id}},{...v,editable:['../production.js']},{...v,scope:{...v.scope,files:['.env']}},{...v,scope:{...v.scope,approved:true}}])assert.throws(()=>request(bad),/invalid_request/)
})
