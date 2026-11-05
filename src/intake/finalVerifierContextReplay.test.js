'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fixture=require('./fixtures/finalVerifierContextReplay.json'),gate=require('./finalKnowledgeRequirement'),egress=require('./publicQueryEgressPlanner')
const scope=fixture.history.filter(h=>h.role==='user'&&h.text.length>50).at(-1).text

test('final verification retains the actual earlier Owner scope within the same character bound and preserves repeated acknowledgments',async()=>{
 let observed=null
 const result=await gate.runFinalKnowledgeRequirement({message:fixture.message,history:fixture.history,availableWorlds:{internal:true,public:true},verify:async input=>{observed=input;return fixture.outputs[3]}})
 assert.ok(observed.ownerMessages.includes(scope),'The saved explicit Owner scope must reach the final verifier')
 assert.equal(observed.ownerMessages.at(-1),fixture.message);assert.equal(observed.ownerMessages.length,fixture.history.filter(h=>h.role==='user').length+1);assert.ok(observed.ownerMessages.filter(s=>s===fixture.message).length>4);assert.ok(observed.ownerMessages.reduce((n,s)=>n+s.length,0)<=egress.MAX_TOTAL_CHARS)
 assert.deepEqual(Object.keys(observed).sort(),['availableWorlds','ownerMessages','schema','system']);assert.equal(result.decision,'clarify','Retained actual clarification is not converted into a pass')
 assert.equal(egress.ownerAuthoredContext(fixture.message,fixture.history).length,5,'Public query egress keeps its original narrow window')
})
test('the final Owner window reserves the current message, keeps latest complete bounded entries and never imports other roles',async()=>{
 const history=[{role:'user',text:'a'.repeat(400)},{role:'assistant',text:'untrusted assistant facts'},{role:'user',text:'b'.repeat(400)},{role:'system',text:'system instructions'},{role:'user',content:'c'.repeat(400)}],before=structuredClone(history);let seen
 await gate.runFinalKnowledgeRequirement({message:'z'.repeat(500),history,verify:async x=>{seen=x.ownerMessages;return{decision:'allow_final',question:null}}})
 assert.deepEqual(seen,['b'.repeat(400),'c'.repeat(400),'z'.repeat(400)]);assert.deepEqual(history,before)
})
test('latest topic stays last; final decision, cache, world obligations and fail-closed behavior are retained',async()=>{
 const current='Switch topics: check my current schedule.',cache=gate.createTurnFinalCache();let calls=0
 const input={message:current,history:[{role:'user',text:'Earlier draft topic'},{role:'assistant',text:'Private source rows must never enter this verifier'}],availableWorlds:{internal:true,public:true},verify:async x=>{calls++;assert.deepEqual(x.ownerMessages,['Earlier draft topic',current]);return{decision:'require_mixed',question:null}}}
 const r=await cache.get(input);assert.deepEqual(r.requiredWorlds,{internal:true,public:true});assert.deepEqual(await cache.get(input),r);assert.equal(calls,1)
 for(const verify of [undefined,async()=>{throw Error('private error')},async()=>({decision:'invented',question:null})])assert.equal((await gate.runFinalKnowledgeRequirement({...input,verify})).ok,false)
})

async function replay(t,{allow=false}={}){
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',TURN_ROUTER:'on',READ_ACCESS:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',GITHUB_READ_REPO:'fixture/project',GOAL_DECOMPOSER:'on',A4_KNOWLEDGE_ROUTING:'on',XIANGXIANG_WEBSITE_FLOW:'off',MULTI_AI_ROUTER:'off',XIANGXIANG_MEMORY:'off',CONVERSATION_RECALL:'off',DECISION_RECALL:'off',XIANGXIANG_ARCHIVE:'off'})
 const calls=[],source=require('./fixtures/foregroundPlanningReplay.json'),previousFixture=require('./fixtures/planningContextReplay.json'),previous=require('../investigation/continuity').previousInvestigation({conversationId:previousFixture.conversationId,conversationStore:{get:()=>({messages:previousFixture.history})},receipts:{get:id=>structuredClone(previousFixture.receipts.find(r=>r.id===id))}})
 const adapter={providerName:'claude',preflight:async()=>{},complete:async(prompt,opts={})=>{
  const schema=opts.responseFormat?.name;calls.push({schema,prompt})
  if(schema==='final_knowledge_requirement')assert.ok(prompt.includes(scope),'Full intake must pass actual Owner scope to final verification')
  // The alternative final verdict is an explicit offline substitute, not a new
  // model result. Its subsequent premise review replays an actual unresolved
  // review and must still refuse the answer; no fixture makes this a native pass.
  const value=schema==='goal_plan'?fixture.outputs[1]:schema==='final_knowledge_requirement'?(allow?{decision:'allow_final',question:null}:fixture.outputs[3]):schema==='advice_premise_review'?previousFixture.outputs[4]:fixture.outputs[2]
  return{text:JSON.stringify(value),model:'claude-opus-5-5',billing:'claude-subscription'}
 }}
 const result=await require('./intakeService').processIntake(fixture.message,{complete:async()=>assert.fail('API forbidden')},fixture.history,{demo:true,interactionMode:'chat',ownerInvestigation:true,previousInvestigation:previous,openaiAdapter:adapter,semanticCallModel:async()=>JSON.stringify(fixture.outputs[0]),controlAdapter:{complete:async()=>assert.fail('API forbidden')},readContextDeps:{sources:['xiangxiang_operations','github'],connector:{read:async name=>{if(name==='github')throw Error('offline_source_unavailable');assert.equal(name,'xiangxiang_operations');return{results:source.sections.filter(s=>!s.section.startsWith('external_')).map(s=>({source:name,sourceId:s.sourceId,title:s.section,retrievedAt:new Date().toISOString(),content:JSON.stringify(s),trust:'live',fields:s}))}}}},sourceIntentResolver:async()=>JSON.stringify({intent:'internal',question:null})})
 return{result,calls}
}
test('actual intake delivers the Owner referent while preserving the actual terminal refusal, zero actions and one final call',async t=>{
 const {result,calls}=await replay(t);assert.match(result.reply,/你想我開始改良邊樣嘢/);assert.equal(result.decision,null);assert.deepEqual(result.tasks,[]);assert.equal(calls.filter(c=>c.schema==='final_knowledge_requirement').length,1);assert.equal(calls.filter(c=>c.schema==='advice_premise_review').length,0);assert.equal(calls.length,3)
})
test('offline release of the final gate still reaches premise protection and cannot publish the unsupported draft',async t=>{
 const {result,calls}=await replay(t,{allow:true});assert.equal(result.adviceReview.reason,'review_unresolved');assert.notEqual(result.investigation.answerPresentation?.kind,'reviewed_foreground_planning_advice');assert.equal(result.decision,null);assert.deepEqual(result.tasks,[]);assert.equal(calls.filter(c=>c.schema==='advice_premise_review').length,1);assert.equal(calls.length,4)
})
