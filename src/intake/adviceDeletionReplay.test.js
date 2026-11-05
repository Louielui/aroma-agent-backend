'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),f=require('./fixtures/adviceDeletionReplay.json'),semantic=require('../investigation/semanticAnswer'),planning=require('../investigation/planningAdvice')
const checks={goal:'aligned',priority:'conditional',capabilities:'qualified',facts:'qualified'}
async function review(packet=f.review,reply=f.raw.reply,{foregroundPlanning=true}={}){
 let calls=0,accounted=0
 const result=await semantic.reviewAdviceAnswer({reply,judgment:f.raw.executiveJudgment,recommendation:true,foregroundPlanning,message:f.message,history:f.history,billing:'claude-subscription',model:'claude-opus-5-5',adapter:{complete:async(prompt,opts)=>{calls++;assert.equal(opts.responseFormat.name,'advice_premise_review');assert.equal(opts.responseFormat.strict,true);return{text:JSON.stringify(packet),model:'claude-opus-5-5',billing:'claude-subscription'}}},onResult:async()=>{accounted++}})
 assert.equal(calls,1);assert.equal(accounted,1);return result
}
test('retained actual review deletes the unsupported conclusion and keeps the other exact edits and useful plan',async()=>{
 const r=await review();assert.equal(r.state,'revised');assert.equal(r.editedSpans,5);assert.equal(r.reason,null)
 assert.ok(f.review.edits.some(e=>e.after===''));assert.ok(!r.reply.includes(f.review.edits[1].before));assert.match(r.reply,/在本次對話中跨話題保持有效（不保存長期記憶）/);assert.match(r.reply,/如果找到仍在進行的相同工作，就改為續接/);assert.match(r.reply,/目前沒有建立任何工作，也沒有派工或改程式/)
 const compact=planning.compactPlanningAdvice(r.reply,{message:f.message});assert.equal(compact.points,3);assert.match(compact.reply,/如果 GitHub 憑證仍無法讀取/);assert.match(compact.reply,/保留上下文理解/);assert.match(compact.reply,/不保存長期記憶/);assert.equal(compact.details,r.reply)
})
test('an exact deletion preserves all unaffected bytes, including CRLF and repeated unrelated words',async()=>{
 const reply='Retain this advice.\r\n\r\nUnsupported assumption.\r\n\r\nRetain this advice.',r=await review({status:'revised',checks,edits:[{before:'Unsupported assumption.',after:'',reason:'unsupported_premise'}]},reply,{foregroundPlanning:false})
 assert.equal(r.state,'revised');assert.equal(r.reply,'Retain this advice.\r\n\r\n\r\n\r\nRetain this advice.')
})
test('deletions cannot admit an empty answer, whitespace replacements, ambiguous spans or an unresolved assessment',async()=>{
 for(const [reply,packet]of [
  ['Entire answer.',{status:'revised',checks,edits:[{before:'Entire answer.',after:'',reason:'unsupported_premise'}]}],
  ['Keep this. Remove this.',{status:'revised',checks,edits:[{before:'Remove this.',after:'  ',reason:'unsupported_premise'}]}],
  ['Same. Same.',{status:'revised',checks,edits:[{before:'Same.',after:'',reason:'unsupported_premise'}]}],
  ['Keep this. Remove this.',{status:'revised',checks,edits:[{before:'Remove this.',after:'',reason:'unsupported_premise'},{before:'Remove this',after:'Qualified statement',reason:'missing_qualification'}]}],
  ['Keep this. Remove this.',{status:'revised',checks,edits:[{before:'Remove this.',after:'https://unsafe.example',reason:'unsupported_premise'}]}],
  ['Keep this. Remove this.',{status:'revised',checks:{...checks,facts:'unresolved'},edits:[{before:'Remove this.',after:'',reason:'unsupported_premise'}]}]
 ]){const r=await review(packet,reply,{foregroundPlanning:false});assert.equal(r.state,'unavailable');assert.equal(r.reply,reply)}
})
test('an indefinite proposed draft object does not inherit a preceding business entity, while adjacent facts remain guarded',()=>{
 const guard=reply=>require('./routeEvidenceGuard').enforceRouteEvidence({reply,message:f.message,reviewedNoReadAdvice:true,evidenceSets:[]})
 for(const suggestion of ['可以考慮先開一張唯讀的「範圍定位」工作單（這只是提案，','建議先草擬一份隔離的方案。','可以準備一個草案。','Consider preparing one proposed plan.','We could prepare a draft.']){
  const reply='相關檔案範圍還沒有核對；'+suggestion,r=guard(reply);assert.equal(r.violated,false,suggestion);assert.equal(r.reply,reply)
 }
 for(const claim of ['目前已經建立一張工作單。','可以考慮建立兩張工作單。','可以考慮建立一張發票。','可以建立一張工作單（庫存全部充足）。','可以建立一張工作單（有12項）。'])assert.equal(guard('相關檔案範圍還沒有核對；'+claim).violated,true,claim)
 const mixed=guard('相關檔案範圍還沒有核對；可以準備一個草案；只剩12箱。');assert.equal(mixed.violated,true);assert.ok(mixed.withheld.includes('只剩12箱。'));assert.match(mixed.reply,/可以準備一個草案/)
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
test('full intake retains the reviewed foreground plan while unchanged source guards keep unavailable facts qualified',async t=>{
 const {result,calls}=await intakeReplay(t);assert.equal(result.adviceReview.state,'revised');assert.equal(result.adviceReview.editedSpans,5);assert.equal(result.investigation.answerPresentation.kind,'reviewed_foreground_planning_advice',JSON.stringify({presentation:result.investigation.answerPresentation,reply:result.reply,readClaim:result.readClaim,withheld:result.withheld}));assert.match(result.reply,/如果 GitHub 憑證仍無法讀取/);assert.match(result.reply,/保留上下文理解/);assert.match(result.investigation.answerDetails,/不保存長期記憶/);assert.equal(result.decision,null);assert.deepEqual(result.tasks,[]);assert.equal(result.replyForArchive,result.reply);assert.equal(calls.filter(s=>s==='advice_premise_review').length,1)
})
