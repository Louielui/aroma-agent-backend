'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),f=require('./fixtures/learningContinuityReplay.json')
const guard=require('./routeEvidenceGuard'),review=require('../investigation/semanticAnswer')
async function edited(){const r=await review.reviewAdviceAnswer({reply:f.outputs[2].reply,judgment:f.outputs[2].executiveJudgment,recommendation:true,foregroundPlanning:true,message:f.message,history:f.history,adapter:{complete:async()=>({text:JSON.stringify(f.outputs[4]),model:'claude-opus-5-5',billing:'claude-subscription'})},model:'claude-opus-5-5',billing:'claude-subscription'});assert.equal(r.editedSpans,6);return r.reply}
test('the actual reviewed draft retains its document reference and substantive concise preview',async()=>{
 const reply=await edited(),out=guard.enforceRouteEvidence({reply,message:f.message,reviewedNoReadAdvice:true,evidenceSets:[]})
 assert.equal(out.violated,false);assert.equal(out.reply,reply)
 const preview=require('../investigation/planningAdvice').compactPlanningAdvice(out.reply,{message:f.message})
 assert.equal(preview.points,3);assert.equal(preview.details,reply)
 assert.match(preview.reply,/對話與調查報告分開/);assert.match(preview.reply,/說話偏好/);assert.match(preview.reply,/回覆速度/)
})
test('an ordinal refers only to a real complete local draft list, never adjacent business facts',()=>{
 const headings='**1. Read and summarize**\nDiscuss the scope.\n\n**2. Measure and verify**\nCheck a proposed change.\n\n'
 const check=(tail,head=headings,reviewed=true)=>guard.enforceRouteEvidence({reply:head+'相關檔案未核對；'+tail,message:'Please discuss the plan.',reviewedNoReadAdvice:reviewed,evidenceSets:[]})
 assert.equal(check('第 2 項先做量度。').violated,false)
 for(const tail of ['第 3 項先做量度。','第 2 項已經完成。','第 2 項先處理12份文件。','第 2 項先核對發票。'])assert.equal(check(tail).violated,true,tail)
 assert.equal(check('第 2 項先做量度。','',true).violated,true)
 assert.equal(check('第 2 項先做量度。',headings.replace('**2.','**3.'),true).violated,true)
 assert.equal(check('第 2 項先做量度。',headings,false).violated,true)
 const mixed=check('第 2 項先做量度；只剩12箱。');assert.equal(mixed.violated,true);assert.ok(mixed.withheld.includes('只剩12箱。'))
})

test('saved native outputs traverse the complete intake without replacing the learning plan with a failure report',async t=>{
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',TURN_ROUTER:'on',READ_ACCESS:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',GITHUB_READ_REPO:'fixture/project',GOAL_DECOMPOSER:'on',A4_KNOWLEDGE_ROUTING:'on',XIANGXIANG_WEBSITE_FLOW:'off',MULTI_AI_ROUTER:'off',XIANGXIANG_MEMORY:'off',CONVERSATION_RECALL:'off',DECISION_RECALL:'off',XIANGXIANG_ARCHIVE:'off'})
 const calls=[],packets=[],sourceFixture=require('./fixtures/foregroundPlanningReplay.json'),prior=require('./fixtures/planningContextReplay.json')
 const previous=require('../investigation/continuity').previousInvestigation({conversationId:prior.conversationId,conversationStore:{get:()=>({messages:prior.history})},receipts:{get:id=>structuredClone(prior.receipts.find(r=>r.id===id))}})
 const adapter={providerName:'claude',preflight:async()=>{},complete:async(prompt,opts={})=>{const name=opts.responseFormat?.name;calls.push(name);packets.push({prompt,opts});return{text:JSON.stringify(name==='goal_plan'?f.outputs[1]:name==='final_knowledge_requirement'?f.outputs[3]:name==='advice_premise_review'?f.outputs[4]:f.outputs[2]),model:'claude-opus-5-5',billing:'claude-subscription'}}}
 // Actual saved outputs and history; connectors and prior receipts below are
 // explicit offline substitutes. This is not a new real-model acceptance.
 const result=await require('./intakeService').processIntake(f.message,{complete:async()=>assert.fail('API forbidden')},f.history,{demo:true,interactionMode:'chat',ownerInvestigation:true,previousInvestigation:previous,openaiAdapter:adapter,semanticCallModel:async()=>JSON.stringify(f.outputs[0]),controlAdapter:{complete:async()=>assert.fail('API forbidden')},
  readContextDeps:{sources:['xiangxiang_operations','github'],connector:{read:async name=>{if(name==='github')throw Error('offline_source_unavailable');assert.equal(name,'xiangxiang_operations');return{results:sourceFixture.sections.filter(s=>!s.section.startsWith('external_')).map(s=>({source:name,sourceId:s.sourceId,title:s.section,retrievedAt:new Date().toISOString(),content:JSON.stringify(s),trust:'live',fields:s}))}}}},sourceIntentResolver:async()=>JSON.stringify({intent:'internal',question:null})})
 assert.equal(result.investigation.answerPresentation.kind,'reviewed_foreground_planning_advice')
 assert.equal(result.investigation.answerPresentation.points,3);assert.match(result.reply,/說話偏好/)
 assert.match(result.investigation.answerDetails,/第 3 項先做量度/);assert.equal(result.decision,null);assert.deepEqual(result.tasks,[])
 assert.equal(calls.filter(n=>n==='advice_premise_review').length,1)
 const planning=packets.find(p=>p.opts.responseFormat?.name==='goal_plan')
 assert.equal(planning.opts.system,require('./goal/goalDecomposer').PLANNING_SYSTEM)
 assert.ok(planning.prompt.includes(f.message));assert.ok(planning.prompt.includes('CONTEXT'))
 assert.ok(packets.some(p=>p.opts.system!==planning.opts.system&&p.opts.system?.length>planning.opts.system.length),'answer instructions remain on the answer call')
})
