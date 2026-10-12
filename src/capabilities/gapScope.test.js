'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const revision = 'a'.repeat(40)

test('registered external read profile packages only the reader and its immutable dependency', () => {
  const planner = require('../core/taskPlanner/contract'), tasks = require('../core/projectTasks/contract')
  assert.equal(planner.classify('plan Imagine seven_shifts reader improvements').profile, 'seven_shifts')
  const editable = planner.PROFILES.seven_shifts
  assert.deepEqual(editable, ['src/context/adapters/sevenShiftsRead.js'])
  const input = tasks.request({bootCommit:revision,requestId:randomUUID(),goal:'Read clock-out',criteria:['Read only'],editable})
  assert.equal(tasks.profileFor(input), 'seven_shifts')
  assert.deepEqual(tasks.filesFor(input), [...editable, 'src/context/contextResult.js'])
  assert.throws(() => tasks.request({...input,editable:[...editable,'src/context/toolGateway.js']}), /invalid_request/)
})

test('external remediation scope needs a named source and clock evidence; unrelated needs remain unregistered', () => {
  const { scopeForGoal } = require('./scopeRegistry')
  assert.equal(scopeForGoal('幫我查7shift員工的clock out時間').profile, 'seven_shifts')
  assert.equal(scopeForGoal('Read 7shifts time punches').profile, 'seven_shifts')
  for (const goal of ['read QBO invoice', '7shifts invoice', 'read clock out', '7shifts payroll payment']) assert.equal(scopeForGoal(goal), null)
  assert.equal(scopeForGoal('7shifts time punches').permissions, 'read_only_existing_authorisation')
})

test('a previously approved unregistered task refreshes into a new bound proposal; old approval never authorises the reader scope',async()=>{
  const {createGapService}=require('./gapService'),{hash,proposalFor,detectGap}=require('./gapContract'),{createMemoryRunStore}=require('../core/operating/runStore')
  const actor={id:'owner',role:'owner'},cid=randomUUID(),store=createMemoryRunStore(),rows=new Map(),starts=[]
  const conversations={get:id=>rows.get(id),appendTurn:v=>rows.set(v.id,{messages:[{role:'assistant',capabilityGapRunId:v.capabilityGapRunId}]})}
  const service=createGapService({store,conversations,revision,planner:{start:(a,v)=>{starts.push(v);return {id:randomUUID(),profile:'seven_shifts'}}}})
  const gap=detectGap({reason:'no_mapped_operation',state:{facts:[{necessity:'required',need:'clock out',readState:'no_system_operation'}]}})
  const v=service.offer(actor,{conversationId:cid,requestId:randomUUID(),message:'查7shifts員工clock out時間',gap,model:'claude-opus-5-5',effort:'medium'})
  // Reconstitute a real v1 shape from the pre-registration build.
  const old=store.get(v.id);old.version=1;old.proposal=proposalFor(old.originalGoal,old.gap,old.language,1)
  old.proposalHash=hash([old.version,old.originalGoal,old.gap,old.proposal,old.revision,old.conversationId,old.createdAt,old.model,old.effort]);store.save(old)
  conversations.appendTurn({id:cid,capabilityGapRunId:old.id})
  const key={id:old.id,conversationId:cid,hash:old.proposalHash}
  assert.equal((await service.approve(actor,key)).run.state,'awaiting_scope_registration');assert.equal(starts.length,0)
  assert.equal(service.get(actor,old.id).scopeRefreshAvailable,true)
  const next=service.refreshScope(actor,key).run
  assert.notEqual(next.id,old.id);assert.notEqual(next.proposalHash,old.proposalHash);assert.equal(next.state,'awaiting_approval');assert.equal(next.proposal.scope.profile,'seven_shifts')
  assert.equal(starts.length,0);assert.equal(service.refreshScope(actor,key).replayed,true)
  await assert.rejects(service.approve(actor,{id:next.id,conversationId:cid,hash:old.proposalHash}),/proposal_changed/)
  const done=await service.approve(actor,{id:next.id,conversationId:cid,hash:next.proposalHash})
  assert.equal(done.run.state,'development_planning');assert.equal(starts.length,1)
  assert.deepEqual(done.run.developmentTask.originalRequest,{conversationId:cid,goal:old.originalGoal})
  assert.equal(starts[0].message,'plan Imagine seven_shifts reader improvements')
  assert.match(starts[0].dialogue.ownerRequests[1],/payroll approval is outside/)
  assert.equal(starts[0].model,'claude-opus-5-5');assert.equal(starts[0].effort,'medium')
})

test('the real committed-profile planner can produce and register an external read task without granting coding or credentials',async()=>{
  const fs=require('node:fs'),path=require('node:path'),{createPlanner}=require('../core/taskPlanner/service'),{createMemoryRunStore}=require('../core/operating/runStore')
  const contract=require('../core/taskPlanner/contract'),tasks=require('../core/projectTasks/contract'),actor={id:'owner',role:'owner'}
  const files=contract.READ_PROFILES.seven_shifts.map((p,i)=>{const content=fs.readFileSync(path.join(__dirname,'..','..',p),'utf8').replace(/\r\n/g,'\n');return {path:p,evidenceId:'plan-'+i,sha256:contract.hash(content),lineCount:content.split('\n').length,content}})
  const evidence={project:'aroma-agent-backend',profile:'seven_shifts',revision,bootCommit:revision,committedOnly:true,files}
  const packet={state:'ok',retrievedAt:new Date().toISOString(),evidence,hash:contract.hash(JSON.stringify(evidence))}
  const result={goal:'Improve exact-company clock-out reader validation',steps:['Preserve the GET-only bounded reader'],acceptanceChecks:['Reject foreign-company evidence without leaking credentials'],questions:[],risks:['Live connection is not configured'],capability:{status:'supported',explanation:'The registered reader scope contains the validation',missingCapabilities:[]},editableFiles:contract.PROFILES.seven_shifts,
    citations:[{evidenceId:'plan-0',startLine:1,endLine:2,quote:files[0].content.split('\n').slice(0,2).join('\n')}]}
  let drafted=0;const planner=createPlanner({source:{verify(){},read:async()=>packet},store:createMemoryRunStore(),bootCommit:revision,
    provider:{preflight:async()=>({model:'claude-opus-5-5',billing:'claude-subscription'}),complete:async()=>({model:'claude-opus-5-5',billing:'claude-subscription',text:JSON.stringify(result)})},
    registerTask:async input=>{drafted++;return {run:{id:randomUUID(),workflow:'project_task',input:(({op,...v})=>v)(input)}}}})
  const run=planner.start(actor,{message:'plan Imagine seven_shifts reader improvements',conversationId:randomUUID(),requestId:randomUUID(),model:'claude-opus-5-5',effort:'medium'});await planner.wait(run.id)
  assert.equal(planner.get(actor,run.id).state,'completed');assert.equal(drafted,0)
  const reg=await planner.registerTask(actor,{id:run.id,requestId:randomUUID(),goal:result.goal,criteria:result.acceptanceChecks,editable:result.editableFiles})
  assert.ok(reg.task.run.id);assert.equal(drafted,1)
  const input=reg.run.registrationPreparation.input,definition=tasks.definition(reg.task.run.id,input,{expectedTests:3,testCode:"const test=require('node:test');const assert=require('node:assert/strict');"})
  assert.deepEqual(definition.workOrder.allowedFiles,contract.PROFILES.seven_shifts)
  assert.deepEqual(definition.workOrder.readonlyFiles,['src/context/contextResult.js'])
  assert.equal(definition.workOrder.appliedToLive,false);assert.equal(JSON.stringify(input).includes('ACCESS_TOKEN'),false)
})

test('scope refresh recovers an interrupted history attachment but never overwrites a newer Owner turn',async()=>{
  const {createGapService}=require('./gapService'),{hash,proposalFor,detectGap}=require('./gapContract'),{createMemoryRunStore}=require('../core/operating/runStore')
  for(const newerTurn of [false,true]) {
    const actor={id:'owner',role:'owner'},cid=randomUUID(),store=createMemoryRunStore(),rows=new Map();let fail=false,attachments=0
    const conversations={get:id=>rows.get(id),appendTurn:v=>{if(fail)throw Error('storage_interrupted');attachments++;rows.set(v.id,{messages:[{role:'assistant',capabilityGapRunId:v.capabilityGapRunId}]})}}
    const service=createGapService({store,conversations,revision})
    const gap=detectGap({reason:'no_mapped_operation',state:{facts:[{necessity:'required',need:'clock out',readState:'no_system_operation'}]}})
    const offered=service.offer(actor,{conversationId:cid,requestId:randomUUID(),message:'Read 7shifts clock out',gap,model:'claude-opus-5-5',effort:'medium'})
    const old=store.get(offered.id);old.version=1;old.proposal=proposalFor(old.originalGoal,old.gap,old.language,1)
    old.proposalHash=hash([old.version,old.originalGoal,old.gap,old.proposal,old.revision,old.conversationId,old.createdAt,old.model,old.effort]);store.save(old)
    conversations.appendTurn({id:cid,capabilityGapRunId:old.id})
    const key={id:old.id,conversationId:cid,hash:old.proposalHash};await service.approve(actor,key)
    fail=true;assert.throws(()=>service.refreshScope(actor,key),/storage_interrupted/)
    const replacement=store.get(old.id).replacementRunId;assert.ok(replacement);assert.equal(store.get(replacement).approval,undefined)
    fail=false;const before=attachments
    if(newerTurn)rows.set(cid,{messages:[{role:'user',content:'A different request'}]})
    const result=service.refreshScope(actor,key);assert.equal(result.replayed,true);assert.equal(result.run.id,replacement)
    assert.equal(attachments,before+(newerTurn?0:1));assert.equal(rows.get(cid).messages.at(-1).role,newerTurn?'user':'assistant')
    assert.equal(result.run.state,'awaiting_approval');assert.equal(store.all().length,2)
  }
})
