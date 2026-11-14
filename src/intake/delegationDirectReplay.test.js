'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const saved=require('./fixtures/delegationDirectReplay.json')

async function replay(t,{changeGoal=()=>{},changeRows=()=>{},failRead=false,history=saved.history,sharing='on',prior={state:'absent'}}={}){
 const original={...process.env}
 t.after(()=>{for(const k of Object.keys(process.env))if(!(k in original))delete process.env[k];Object.assign(process.env,original)})
 t.mock.timers.enable({apis:['Date'],now:Date.parse(saved.observedAt)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',GOAL_DECOMPOSER:'on',READ_ACCESS:'on',CONTEXT_DECISIONS_OPENAI:sharing,CONTEXT_XIANGXIANG_OPERATIONS:'on',TURN_ROUTER:'on',A4_KNOWLEDGE_ROUTING:'on',MULTI_AI_ROUTER:'off',DECISION_RECALL:'off',CONVERSATION_RECALL:'off',XIANGXIANG_MEMORY:'off'})
 const goal=structuredClone(saved.goal),items=structuredClone(saved.items),calls=[],reads=[],telemetry={};let semanticCalls=0;changeGoal(goal);changeRows(items)
 const adapter={providerName:'claude',preflight:async()=>{},complete:async(prompt,options={})=>{calls.push({prompt,system:options.system,schema:options.responseFormat?.name,phase:options.invocationPhase});return{billing:'claude-subscription',model:'claude-opus-5-5',text:JSON.stringify(options.responseFormat?.name==='goal_plan'?goal:saved.raw)}}}
 const result=await require('./intakeService').processIntake(saved.message,{complete:async()=>assert.fail('No API call allowed')},history,{demo:true,interactionMode:'chat',ownerInvestigation:true,previousInvestigation:prior,telemetry,openaiAdapter:adapter,controlAdapter:{complete:async()=>assert.fail('No API control allowed')},semanticCallModel:async()=>{semanticCalls++;return saved.semanticRaw},memoryClient:{recall:async()=>[],preferences:async()=>({state:'ok',items:[]})},readContextDeps:{sources:['xiangxiang_operations'],connector:{read:async(source,method,params)=>{reads.push({source,method,params});if(failRead)throw Error('OFFLINE_READ_FAILURE');return{results:items}}},sourceIntentResolver:async()=>assert.fail('No extra source classifier allowed'),finalVerifier:async()=>({decision:'allow_final'})}})
 return{result,calls,reads,semanticCalls,telemetry}
}

test('retained PR162 goal and source render the same answer without the discarded final model call',async t=>{
 const x=await replay(t)
 assert.equal(x.calls.length,1,'Keep goal understanding; omit only the final structured answer')
 assert.equal(x.semanticCalls,2,'Keep the existing independent semantic opinions in this injected harness')
 assert.equal(x.calls[0].schema,'goal_plan');assert.ok(x.calls[0].prompt.includes(saved.history[1].text))
 assert.equal(x.reads.length,1);assert.deepEqual(x.reads[0].params.sections,['configuration','work','delegation'])
 assert.equal(x.result.reply,saved.expectedReply)
 assert.equal(x.result.investigation.answerPresentation.answerCallSkipped,true)
 assert.equal(x.result.investigation.answerPresentation.modelProseUsed,false)
 assert.equal(x.result.investigation.answerPresentation.validation.boundDelegationFacts,7)
 const details=JSON.parse(x.result.investigation.answerDetails.split('\n\n')[0])
 assert.equal(details.bootCommit,saved.runtime);assert.equal(details.channels.length,7)
 assert.equal(details.channels.find(c=>c.channelId==='backend:claude-code').model,null)
 assert.equal(details.dispatchVerified,false)
 assert.deepEqual(x.result.tasks,[]);assert.equal(x.result.decision,null);assert.equal(x.result.readClaimCorrected,false)
 assert.equal(x.telemetry.calls?.filter(c=>c.role==='answer').length||0,0,'Do not invent a model result')
})

test('current-topic corrections still reach understanding when long-term sharing is disabled',async t=>{
 const history=[...saved.history,{role:'user',text:'更正：現在只問目前可派工模型，並不是背景排程；不要保存。'}]
 const x=await replay(t,{history,sharing:'off'})
 assert.equal(x.calls.length,1);assert.ok(x.calls[0].prompt.includes(history.at(-1).text))
 assert.match(x.result.reply,/gpt-6-astra/);assert.match(x.result.reply,/claude-sonnet-5-5/)
 assert.deepEqual(x.result.tasks,[])
})

for(const [name,changeRows]of [
 ['missing delegation',rows=>rows.splice(2,1)],
 ['duplicate delegation',rows=>rows.push(structuredClone(rows[2]))],
 ['untrusted delegation',rows=>{rows[2].trust='memory'}],
 ['stale delegation',rows=>{rows[2].fields.observedAt='2026-11-13T12:24:03.156Z'}],
 ['partial connection coverage',rows=>{rows[2].fields.state='partial';rows[2].fields.scopeComplete=false;rows[2].fields.coverage.bridge='unavailable'}],
 ['forged authorization',rows=>{rows[2].fields.records[0].authorization='approved'}]
])test(name+' retains the existing model and evidence path',async t=>{
 const x=await replay(t,{changeRows});assert.equal(x.calls.length,2)
 assert.notEqual(x.result.investigation?.answerPresentation?.answerCallSkipped,true)
 assert.deepEqual(x.result.tasks,[])
})

test('read failure does not fabricate a successful direct roster',async t=>{
 const x=await replay(t,{failRead:true});assert.equal(x.calls.length,2)
 assert.notEqual(x.result.investigation?.answerPresentation?.answerCallSkipped,true)
 assert.deepEqual(x.result.tasks,[])
})

test('a previous investigation remains on the full understanding and answer path',async t=>{
 const x=await replay(t,{prior:{state:'partial',focus:'capability',sections:[]}})
 assert.equal(x.calls.length,2);assert.notEqual(x.result.investigation?.answerPresentation?.answerCallSkipped,true)
})

test('direct admission refuses actions, mixed sources, historical needs, joins and incomplete receipts',t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse(saved.observedAt)})
 const plan=require('./goal/goalPlanContract').judgeGoalPlan(saved.goal).plan
 const base={message:saved.message,plan,report:null,operationsLive:true,ownerInvestigation:true,subscriptionMode:true,interactionMode:'chat',previousInvestigation:{state:'absent'},capabilityReadSettled:true,truncated:false,ownerGoalReporting:false,authorisedSources:['xiangxiang_operations'],itemsBySource:[{source:'xiangxiang_operations',items:saved.items}],perSource:[{source:'xiangxiang_operations',trust:'live'}]}
 const direct=require('../investigation/answerFastPath').sourceBoundDelegationAnswer
 assert.equal(direct(base).reply,saved.expectedReply)
 const refusals=[
  x=>{x.plan=null},x=>{x.operationsLive=false},x=>{x.ownerInvestigation=false},x=>{x.subscriptionMode=false},x=>{x.interactionMode='commit'},x=>{x.ownerGoalReporting=true},x=>{x.truncated=true},x=>{x.capabilityReadSettled=false},x=>{x.authorisedSources=[]},
  x=>{x.plan.executiveFrame.taskType='execute'},x=>{x.plan.executiveFrame.decisionNeeded=true},x=>{x.plan.executiveFrame.answerPosture='provisional'},
  x=>{x.plan.facts.push({operation:'gmail',necessity:'enriching'})},x=>{x.plan.facts[0].operation=null},x=>{x.plan.joins=[{from:'a',to:'b'}]},x=>{x.plan.ownerOutcomes=[{action:'write'}]},
  x=>{x.plan.investigationEvidence.push('work_history')},x=>{x.plan.investigationEvidence=['configuration']},x=>{x.plan.investigationEvidence.push('execution_history')},x=>{x.plan.investigationReference={runId:'prior'}},x=>{x.plan.requestedCapability='email_send'},
  x=>{x.previousInvestigation={state:'partial'}},x=>{x.report={readOnly:true,focus:'background'}},x=>{x.itemsBySource.push({source:'public_knowledge',items:[]})},x=>{x.perSource[0].trust='unavailable'},
  x=>{x.itemsBySource[0].items[2].fields.records[0].canAccept=true},x=>{x.itemsBySource[0].items[2].fields.permissionsVerified=true},x=>{x.itemsBySource[0].items[2].fields.dispatchVerified=true}
 ]
 refusals.forEach((change,index)=>{const x=structuredClone(base);change(x);assert.equal(direct(x),null,'refusal '+index)})
})

test('unknown model and unavailable catalogue remain explicit in the unmodified source detail',t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse(saved.observedAt)})
 const input={message:saved.message,plan:require('./goal/goalPlanContract').judgeGoalPlan(saved.goal).plan,operationsLive:true,ownerInvestigation:true,subscriptionMode:true,interactionMode:'chat',capabilityReadSettled:true,authorisedSources:['xiangxiang_operations'],itemsBySource:[{source:'xiangxiang_operations',items:structuredClone(saved.items)}],perSource:[{source:'xiangxiang_operations',trust:'live'}]}
 const row=input.itemsBySource[0].items[2].fields.records.find(r=>r.channelId==='bridge:review');row.resolvedModel=null;row.subscription='catalogue_unavailable'
 const before=JSON.stringify(input),result=require('../investigation/answerFastPath').sourceBoundDelegationAnswer(input)
 assert.match(result.reply,/sonnet/);assert.doesNotMatch(result.reply,/claude-sonnet-5-5/)
 assert.equal(JSON.stringify(input),before,'admission and presentation cannot mutate source evidence')
})
