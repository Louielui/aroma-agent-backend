'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const saved=require('./fixtures/leanCapabilityReplay.json'),{judgeGoalPlan}=require('./goal/goalPlanContract'),router=require('../investigation/generalRouter')

test('retained native enriching-local plan uses its judged read once and preserves the unavailable requirement',()=>{
 const p=judgeGoalPlan(saved.goal).plan
 assert.equal(p.facts[1].necessity,'enriching')
 assert.deepEqual(router.capabilityReadSections(p,['xiangxiang_operations']),['configuration','work'])
 assert.deepEqual(router.capabilityReadGaps(p).map(f=>f.id),['f1'])
 for(const change of [p=>{p.facts=p.facts.filter(f=>f.operation)},p=>{p.facts[0].status='UNKNOWN'},p=>{p.facts[0].reason='other'},p=>{p.facts[1].operation='gmail'},p=>{p.investigationFocus='background'},p=>{p.executiveFrame.taskType='execute'},p=>{p.executiveFrame.decisionNeeded=true},p=>{p.joins=[{from:'gmail',to:'drive'}]},p=>{p.ownerOutcomes=[{action:'write'}]},p=>{p.investigationEvidence=['execution_history']},p=>{p.requestedCapability='email_send'}]){
  const other=structuredClone(p);change(other);assert.equal(router.capabilityReadSections(other,['xiangxiang_operations']),null)
 }
 assert.equal(router.capabilityReadSections(p,[]),null)
})

function rc(){return{status:'READY',perSource:[{source:'xiangxiang_operations',trust:'live',count:2}],itemsBySource:[{source:'xiangxiang_operations',items:structuredClone(saved.items)}],evidenceSets:[{source:'xiangxiang_operations',trust:'live',shownCount:2,matchingTotal:2,sourceTotal:null,completeWithinScope:false}],block:'full fallback evidence'}}
test('capability prompt projection preserves source identity, defaults, nulls and coverage, without historical job bodies',()=>{
 const input=rc(),work=input.itemsBySource[0].items[1]
 work.fields.records=[{sourceId:'private-history',goal:'HISTORICAL_BODY_SENTINEL'.repeat(2000)}];work.content=JSON.stringify(work.fields)
 const before=JSON.stringify(input),block=require('./capabilityContext').capabilityContext(input)
 assert.equal(JSON.stringify(input),before,'server evidence must remain byte-for-byte unchanged')
 assert.match(block,/<external_read_context>/);assert.match(block,/not.*instruction/i);assert.match(block,/ref=xiangxiang_operations#work:/)
 assert.match(block,/gpt-6\.1-sol/);assert.match(block,/sonnet/);assert.match(block,/"model":null/);assert.match(block,/"WORKER_INVOCATION":null/)
 assert.match(block,/host_workflow_default_not_per_job_selection/);assert.match(block,/historical.*omitted/i);assert.match(block,/TOTAL IN THE WIDER SOURCE IS UNKNOWN/)
 assert.doesNotMatch(block,/HISTORICAL_BODY_SENTINEL/);assert.ok(Buffer.byteLength(block)<12000)
})
test('failed, truncated, untrusted and non-capability sections do not acquire a compact success context',()=>{
 for(const change of [r=>{r.status='TRUNCATED'},r=>{r.perSource[0].trust='unavailable'},r=>{r.itemsBySource[0].items[1].trust='memory'},r=>{r.itemsBySource[0].items[1].fields.state='unavailable'},r=>{r.itemsBySource[0].items.push({...r.itemsBySource[0].items[0],fields:{section:'execution'}})}]){
  const r=rc();change(r);assert.equal(require('./capabilityContext').capabilityContext(r),r.block)
 }
})

async function replay(t,{goal=saved.goal,failRead=false,history=saved.history,raw=saved.raw,sharing='on'}={}){
 const old={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',GOAL_DECOMPOSER:'on',READ_ACCESS:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',XIANGXIANG_MEMORY:'on',CONTEXT_DECISIONS_OPENAI:sharing,TURN_ROUTER:'on',A4_KNOWLEDGE_ROUTING:'on',MULTI_AI_ROUTER:'off',DECISION_RECALL:'off',CONVERSATION_RECALL:'off'})
 const calls=[],reads=[];let semanticCalls=0,worlds=0
 const pref='Owner prefers a short conclusion and at most three points.'
 const adapter={providerName:'claude',preflight:async()=>{},complete:async(prompt,o={})=>{calls.push({prompt,phase:o.invocationPhase,schema:o.responseFormat?.name});return{billing:'claude-subscription',model:'claude-opus-5-5',text:JSON.stringify(o.responseFormat?.name==='goal_plan'?goal:prompt.includes('<external_read_context>')?raw:{intent:'question',mode:'chat',reply:'Read settings first.',nextRead:{capability:'xiangxiang_operations',args:{query:saved.message,freshness:'current',location:null}}})}}}
 const result=await require('./intakeService').processIntake(saved.message,{complete:async()=>assert.fail('API forbidden')},history,{demo:true,interactionMode:'chat',ownerInvestigation:true,openaiAdapter:adapter,controlAdapter:{complete:async()=>assert.fail('API control forbidden')},semanticCallModel:async()=>{semanticCalls++;return JSON.stringify({intent:'NONE',confidence:'HIGH'})},memoryClient:{recall:async()=>[],preferences:async()=>({state:'ok',total:1,items:[{documentId:'xx-20000000-0000-4000-8000-000000000003',type:'preference',scope:'private:owner',text:pref,approval:{kind:'owner',actor:'owner',contentHash:crypto.createHash('sha256').update(pref).digest('hex')}}]})},readContextDeps:{sources:['xiangxiang_operations','public_knowledge'],connector:{read:async(source,method,params)=>{reads.push({source,method,params});if(failRead)throw Error('offline retained read failure');return{results:structuredClone(saved.items)}}},sourceIntentResolver:async()=>{worlds++;return JSON.stringify({intent:'internal',question:null})},finalVerifier:async()=>({decision:'allow_final'})}})
 return{calls,reads,semanticCalls,worlds,result,pref}
}
test('full retained native plan reaches one goal call, one answer, one bounded read and source-bound foreground',async t=>{
 const x=await replay(t)
 assert.equal(x.calls.length,2,'no intermediate read-decision answer')
 assert.equal(x.worlds,0,'do not reclassify a settled local-only capability read')
 assert.equal(x.reads.length,1);assert.deepEqual(x.reads[0].params.sections,['configuration','work'])
 assert.match(x.calls[0].prompt,/你好香香/);assert.ok(x.calls.at(-1).prompt.includes(x.pref))
 assert.equal(x.calls.at(-1).prompt.split('Louie 現在說:「'+saved.message+'」').length-1,1)
 assert.match(x.result.reply,/gpt-6\.1-sol/);assert.match(x.result.reply,/sonnet/);assert.match(x.result.reply,/未能核實/)
 assert.equal(x.result.investigation.answerPresentation.validation.boundWorkflowFacts,3)
 assert.equal(x.result.investigation.answerPresentation.validation.unresolvedNeeds[0].id,'f1')
 assert.match(x.result.reply,/背景排程.*不是.*AI/);assert.deepEqual(x.result.tasks,[]);assert.equal(x.result.decision,null)
 assert.ok(Buffer.byteLength(x.calls.at(-1).prompt)<45000,'bounded model input without historical work bodies')
})
test('failed read preserves the failure path rather than a source-bound success',async t=>{
 const x=await replay(t,{failRead:true});assert.equal(x.result.investigation?.answerPresentation,undefined);assert.doesNotMatch(x.result.reply,/已核對的流程預設模型/);assert.deepEqual(x.result.tasks,[])
})
test('current-topic correction and disabled personal-memory sharing survive lean evidence assembly',async t=>{
 const history=[...saved.history,{role:'user',text:'先討論背景排程。'},{role:'assistant',text:'可以先看排程。'},{role:'user',text:'改正：現在問可派工 AI，別再列背景工作。'}]
 const x=await replay(t,{history,sharing:'off'});assert.ok(x.calls[0].prompt.includes(history.at(-1).text));assert.ok(x.calls.every(c=>!c.prompt.includes(x.pref)));assert.match(x.result.reply,/gpt-6\.1-sol/)
})
