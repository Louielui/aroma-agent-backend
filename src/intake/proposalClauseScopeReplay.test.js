'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),f=require('./fixtures/proposalClauseScopeReplay.json'),semantic=require('../investigation/semanticAnswer'),guard=require('./routeEvidenceGuard')
const check=(reply,reviewed=true)=>guard.enforceRouteEvidence({reply,message:f.message,reviewedNoReadAdvice:reviewed,evidenceSets:[]})
async function corrected(){let calls=0;const r=await semantic.reviewAdviceAnswer({reply:f.raw.reply,judgment:f.raw.executiveJudgment,recommendation:true,foregroundPlanning:true,message:f.message,history:f.history,billing:'claude-subscription',model:'claude-opus-5-5',adapter:{complete:async()=>{calls++;return{text:JSON.stringify(f.review),model:'claude-opus-5-5',billing:'claude-subscription'}}}});assert.equal(calls,1);assert.equal(r.state,'revised');assert.equal(r.editedSpans,6);return r.reply}
test('actual six-edit native review retains its conditional conceptual consolidation without inventing a file quantity',async()=>{
 const reply=await corrected(),g=check(reply);assert.equal(g.violated,false);assert.equal(g.reply,reply);assert.match(g.reply,/可合併成一項修正/)
 const compact=require('../investigation/planningAdvice').compactPlanningAdvice(reply,{message:f.message});assert.equal(compact.points,3);assert.match(compact.reply,/若定位後確認/);assert.match(compact.reply,/假設重試讀不到的來源/);assert.match(compact.reply,/不保存長期記憶/);assert.equal(compact.details,reply)
})
test('modal transformations quantify a proposed design object independently of an earlier file subject across varied verbs and text-object kinds',()=>{
 for(const modal of ['可','可以','建議'])for(const verb of ['合併成','整合為','歸併成'])for(const object of ['一項修正','一項變更','一個步驟','一個流程','一個方案']){
  const reply='相關檔案範圍還沒有核對；'+modal+verb+object+'。';assert.equal(check(reply).violated,false,reply)
 }
 for(const reply of ['相關檔案範圍還沒有核對；We could combine these into one change.','相關檔案範圍還沒有核對；Consider consolidating these into a step.'])assert.equal(check(reply).violated,false,reply)
})
test('proposal-object classification cannot admit actual business quantities, completed work, ambiguous counts or an unreviewed draft',()=>{
 for(const clause of ['目前已合併成一項修正。','已經合併成一項修正。','可合併成兩項修正。','可合併成一張發票。','可合併成一份文件。','可合併成一項改動。','可合併成一項修正（存貨全部充足）。','可合併成一項修正（有12箱）。'])assert.equal(check('相關檔案範圍還沒有核對；'+clause).violated,true,clause)
 // Existing vocabulary and measurement blind spots are not broadened or claimed
 // solved here: a file object never enters this proposed-design classification.
 assert.equal(require('./documentEnumeration').conditionalDraftObject('可合併成一個文件。'),false)
 assert.equal(check('相關檔案範圍還沒有核對；可合併成一項修正。',false).violated,true)
 const mixed=check('相關檔案範圍還沒有核對；可合併成一項修正；只剩12箱。');assert.equal(mixed.violated,true);assert.match(mixed.reply,/可合併成一項修正/);assert.ok(mixed.withheld.includes('只剩12箱。'))
})

async function intakeReplay(t){
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',TURN_ROUTER:'on',READ_ACCESS:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',GITHUB_READ_REPO:'fixture/project',GOAL_DECOMPOSER:'on',A4_KNOWLEDGE_ROUTING:'on',XIANGXIANG_WEBSITE_FLOW:'off',MULTI_AI_ROUTER:'off',XIANGXIANG_MEMORY:'off',CONVERSATION_RECALL:'off',DECISION_RECALL:'off',XIANGXIANG_ARCHIVE:'off'})
 const calls=[],sources=require('./fixtures/foregroundPlanningReplay.json'),previousFixture=require('./fixtures/planningContextReplay.json'),previous=require('../investigation/continuity').previousInvestigation({conversationId:previousFixture.conversationId,conversationStore:{get:()=>({messages:previousFixture.history})},receipts:{get:id=>structuredClone(previousFixture.receipts.find(r=>r.id===id))}})
 const adapter={providerName:'claude',preflight:async()=>{},complete:async(prompt,opts={})=>{const schema=opts.responseFormat?.name;calls.push(schema);return{text:JSON.stringify(schema==='goal_plan'?f.outputs[1]:schema==='final_knowledge_requirement'?f.outputs[3]:schema==='advice_premise_review'?f.outputs[4]:f.outputs[2]),model:'claude-opus-5-5',billing:'claude-subscription'}}}
 // Actual saved model outputs; fresh source fixtures and prior-draft receipts are
 // explicitly offline substitutes, not authenticated native acceptance.
 const result=await require('./intakeService').processIntake(f.message,{complete:async()=>assert.fail('API forbidden')},f.history,{demo:true,interactionMode:'chat',ownerInvestigation:true,previousInvestigation:previous,openaiAdapter:adapter,semanticCallModel:async()=>JSON.stringify(f.outputs[0]),controlAdapter:{complete:async()=>assert.fail('API forbidden')},readContextDeps:{sources:['xiangxiang_operations','github'],connector:{read:async name=>{if(name==='github')throw Error('offline_source_unavailable');assert.equal(name,'xiangxiang_operations');return{results:sources.sections.filter(s=>!s.section.startsWith('external_')).map(s=>({source:name,sourceId:s.sourceId,title:s.section,retrievedAt:new Date().toISOString(),content:JSON.stringify(s),trust:'live',fields:s}))}}}},sourceIntentResolver:async()=>JSON.stringify({intent:'internal',question:null})})
 return{result,calls}
}
test('complete intake carries the actual corrected plan through unchanged premise, source, presentation and action gates',async t=>{const {result,calls}=await intakeReplay(t);assert.equal(result.adviceReview.state,'revised');assert.equal(result.adviceReview.editedSpans,6);assert.equal(result.investigation.answerPresentation.kind,'reviewed_foreground_planning_advice');assert.equal(result.investigation.answerPresentation.points,3);assert.match(result.investigation.answerDetails,/可合併成一項修正/);assert.match(result.reply,/若定位後確認/);assert.match(result.reply,/假設重試讀不到的來源/);assert.equal(result.decision,null);assert.deepEqual(result.tasks,[]);assert.equal(result.replyForArchive,result.reply);assert.equal(calls.filter(x=>x==='advice_premise_review').length,1)})
