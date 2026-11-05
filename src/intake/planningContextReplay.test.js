'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fixture=require('./fixtures/planningContextReplay.json'),continuity=require('../investigation/continuity'),planning=require('../investigation/planningAdvice')
const actualGoal=require('./goal/goalPlanContract').judgeGoalPlan(fixture.outputs[1]).plan,details=fixture.receipts.at(-1).investigation.answerDetails
function load(rows=fixture.receipts,messages=fixture.history){
 const reads=[],got=continuity.previousInvestigation({conversationId:fixture.conversationId,conversationStore:{get:()=>({messages})},receipts:{get:id=>{reads.push(id);return structuredClone(rows.find(r=>r.id===id))}}})
 return{got,reads}
}
test('saved full planning draft survives the actual same-conversation continuity link without scanning another topic',()=>{
 const {got,reads}=load();assert.equal(got.state,'available');assert.equal(reads.length,1);const draft=continuity.resolvePlanningDraft(got);assert.equal(draft.text,details);assert.equal(draft.runId,fixture.receipts.at(-1).id);assert.equal(draft.hops,1);assert.deepEqual(reads,fixture.receipts.map(r=>r.id))
 const context=planning.promptContext({plan:actualGoal,report:{readOnly:true,focus:'general'},previous:got}),prompt=context.prompt;assert.match(prompt,/PLANNING DELIVERABLE/);assert.ok(prompt.includes(JSON.stringify(details)));assert.match(prompt,/not current evidence or authorization/);assert.equal(context.receipt.priorDraft.chars,details.length)
 for(const plan of [{...actualGoal,investigationReference:null},{...actualGoal,investigationFocus:'cost'}])assert.ok(!planning.promptContext({plan,report:{readOnly:true,focus:'general'},previous:got})?.prompt.includes(JSON.stringify(details)))
 assert.equal(planning.promptContext({plan:actualGoal,report:{readOnly:true},previous:got,ownerGoal:{}}),null)
})
test('receipt chain stops on a missing link, cycle, foreign conversation, mismatched focus or unreviewed draft',()=>{
 const changes=[r=>{r[1].conversationId='foreign'},r=>{r[1].state='failed'},r=>{r[1].investigation.focus='cost'},r=>{r[0].investigation.continuity.state='focus_mismatch'},r=>{r[0].investigation.continuity.referenceRunId=r[0].id},r=>{r.pop()},r=>{r[1].response.adviceReview.state='unavailable'},r=>{r[1].investigation.answerDetails='x'.repeat(3601)},r=>{r[1].id=randomUUID()},r=>{r[1].updatedAt='2099-01-01T00:00:00Z'}]
 for(const change of changes){const rows=structuredClone(fixture.receipts);change(rows);const {got,reads}=load(rows);assert.equal(got.state,'available');assert.notEqual(continuity.resolvePlanningDraft(got).state,'available');assert.ok(reads.length<=4)}
 const boundary=load(fixture.receipts,[...fixture.history,{role:'assistant',content:'a separate topic without a receipt'}]);assert.equal(boundary.got.state,'absent');assert.deepEqual(boundary.reads,[])
})
test('receipt lookup is bounded and read failures cannot borrow an older draft',()=>{
 const rows=structuredClone(fixture.receipts),draft=rows.pop(),middle=rows.at(-1)
 for(let n=0;n<4;n++){const next={...structuredClone(middle),id:randomUUID()};rows.at(-1).investigation.continuity.referenceRunId=next.id;rows.push(next)}rows.at(-1).investigation.continuity.referenceRunId=draft.id;rows.push(draft)
 const {got,reads}=load(rows);assert.notEqual(continuity.resolvePlanningDraft(got).state,'available');assert.equal(reads.length,4)
 const p=continuity.previousInvestigation({conversationId:fixture.conversationId,conversationStore:{get:()=>({messages:fixture.history})},receipts:{get:id=>{if(id!==fixture.receipts[0].id)throw Error('unavailable');return structuredClone(fixture.receipts[0])}}});assert.equal(p.state,'available');assert.equal(continuity.resolvePlanningDraft(p).state,'unavailable')
 const fresh=load();planning.promptContext({plan:{...actualGoal,investigationReference:null},report:{readOnly:true,focus:'general'},previous:fresh.got});assert.equal(fresh.reads.length,1)
 assert.equal(continuity.resolvePlanningDraft({...fresh.got}).state,'unavailable','serialized context cannot forge a host receipt reader')
})

async function replay(t,{expectContext=true,goal=fixture.outputs[1]}={}){
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',TURN_ROUTER:'on',READ_ACCESS:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',GITHUB_READ_REPO:'fixture/project',GOAL_DECOMPOSER:'on',A4_KNOWLEDGE_ROUTING:'on',XIANGXIANG_WEBSITE_FLOW:'off',MULTI_AI_ROUTER:'off',XIANGXIANG_MEMORY:'off',CONVERSATION_RECALL:'off',DECISION_RECALL:'off',XIANGXIANG_ARCHIVE:'off'})
 const calls=[],source=require('./fixtures/foregroundPlanningReplay.json'),adapter={providerName:'claude',preflight:async()=>{},complete:async(prompt,opts={})=>{
  calls.push({schema:opts.responseFormat?.name,phase:opts.invocationPhase,prompt})
  if(opts.invocationPhase==='answer'){
   assert.equal(prompt.includes(JSON.stringify(details)),expectContext)
   if(expectContext){assert.ok(prompt.startsWith('PLANNING DELIVERABLE'));assert.match(prompt,/Missing source access limits factual claims/)}
  }
  // All five outputs are the retained failing native outputs. A new prompt does
  // not magically repair them; the unresolved premise verdict must stay failed.
  const value=opts.responseFormat?.name==='goal_plan'?goal:opts.responseFormat?.name==='final_knowledge_requirement'?fixture.outputs[3]:opts.responseFormat?.name==='advice_premise_review'?fixture.outputs[4]:fixture.outputs[2]
  return{text:JSON.stringify(value),model:'claude-opus-5-5',billing:'claude-subscription'}
 }}
 const result=await require('./intakeService').processIntake(fixture.message,{complete:async()=>assert.fail('API forbidden')},fixture.history,{
  demo:true,interactionMode:'chat',ownerInvestigation:true,previousInvestigation:load().got,openaiAdapter:adapter,semanticCallModel:async()=>JSON.stringify(fixture.outputs[0]),controlAdapter:{complete:async()=>assert.fail('API forbidden')},
  readContextDeps:{sources:['xiangxiang_operations','github'],connector:{read:async name=>{if(name==='github')throw Error('offline_source_unavailable');assert.equal(name,'xiangxiang_operations');return{results:source.sections.filter(s=>!s.section.startsWith('external_')).map(s=>({source:name,sourceId:s.sourceId,title:s.section,retrievedAt:new Date().toISOString(),content:JSON.stringify(s),trust:'live',fields:s}))}}}},finalVerifier:async()=>fixture.outputs[3],sourceIntentResolver:async()=>JSON.stringify({intent:'internal',question:null})
 })
 return{result,calls}
}
test('actual intake transfers the saved draft to the answer but preserves the real unresolved review and zero execution',async t=>{
 const {result,calls}=await replay(t);assert.equal(calls.length,4,JSON.stringify(calls.map(x=>({schema:x.schema,phase:x.phase}))));assert.equal(result.adviceReview.reason,'review_unresolved');assert.notEqual(result.investigation.answerPresentation.kind,'reviewed_foreground_planning_advice');assert.equal(result.decision,null);assert.deepEqual(result.tasks,[]);assert.ok(!result.offer)
 const answer=calls.find(x=>x.phase==='answer');assert.equal(answer.prompt.split('Louie 現在說:「'+fixture.message+'」').length-1,1);assert.equal(answer.prompt.split(JSON.stringify(details)).length-1,1)
 assert.equal(result.investigation.planningContext.priorDraft.runId,fixture.receipts.at(-1).id);assert.equal(result.investigation.planningContext.priorDraft.chars,484)
})
test('a fresh topic does not receive the prior full draft even when a previous receipt is available',async t=>{
 const goal={...fixture.outputs[1],investigation_reference:null};const {calls}=await replay(t,{expectContext:false,goal});assert.equal(calls.length,4,JSON.stringify(calls.map(x=>({schema:x.schema,phase:x.phase}))))
})
