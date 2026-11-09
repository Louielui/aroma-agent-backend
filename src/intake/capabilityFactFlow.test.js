'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const saved=require('./fixtures/delegationRetestAnswer.json')
const {validatePlan}=require('./answerPlan'),{buildReadResultReply}=require('./readResultView')
const {judgeGoalPlan}=require('./goal/goalPlanContract'),route=require('../investigation/generalRouter')
const data=()=>({message:saved.message,answerKind:'capability_explanation',allowCapabilityPreview:true,reply:saved.raw.reply,answerPlan:structuredClone(saved.raw.answerPlan),evidenceSets:saved.evidenceSets,itemsBySource:[{source:'xiangxiang_operations',items:structuredClone(saved.items).map(r=>({...r,trust:'live'}))}],perSource:[{source:'xiangxiang_operations',trust:'live',shownCount:2,status:'ok'}]})

test('saved PR152 Chinese columns bind the three source roles while unsupported states remain withheld',()=>{
 const input=data(),v=validatePlan(input.answerPlan,input)
 assert.equal(v.boundWorkflowFacts,3)
 const facts=v.plan.sections[0].items[0].facts
 assert.ok(facts.some(f=>f.value==='gpt-6.1-sol / medium'))
 assert.ok(facts.some(f=>f.value==='gpt-6.1-sol'));assert.ok(facts.some(f=>f.value==='sonnet'))
 assert.ok(v.droppedFacts>0,'unknown connectivity and missing model are not fabricated')
 const view=buildReadResultReply(input)
 assert.ok(view.answerDetails);assert.doesNotMatch(view.reply,/###|要不要我/)
 assert.match(view.reply,/GPT-6\.1 Sol/);assert.match(view.reply,/Sonnet/)
 assert.match(view.reply,/未測試接單/);assert.match(view.answerDetails,/要不要我/)
})

test('localized named roles cannot borrow another role, unknown columns or duplicate records',()=>{
 for(const change of [i=>{i.answerPlan.sections[0].items[0].title='審核';i.answerPlan.sections[0].items[0].facts=[{field:'開發',value:'made-up-model'}]},i=>{i.answerPlan.sections[0].items[0].facts=[{field:'arbitrary model',value:'made-up-model'}]},i=>{const w=i.itemsBySource[0].items.find(r=>r.fields.section==='work').fields.workflows;w.push({...w.find(r=>r.role==='review')});i.answerPlan.sections[0].items[0].facts=[{field:'審核',value:'made-up-model'}]}]){
  const input=data();change(input);const v=validatePlan(input.answerPlan,input)
  assert.equal(v.boundWorkflowFacts,0);assert.ok(v.droppedFacts>0)
 }
})

test('judged unavailable requirements keep a bounded local read and an explicit host gap',()=>{
 const p=judgeGoalPlan(saved.goal).plan
 assert.equal(p.investigationFocus,null,'raw general is normalized before routing')
 assert.deepEqual(route.capabilityReadSections(p,['xiangxiang_operations']),['configuration','work'])
 assert.deepEqual(route.capabilityReadGaps(p),[{id:'f3',need:p.facts[2].need,status:'UNAVAILABLE',reason:p.facts[2].reason}])
 for(const f of [{...p.facts[2],status:'UNKNOWN'},{...p.facts[2],reason:'other'},{...p.facts[2],operation:'github'}])assert.equal(route.capabilityReadSections({...p,facts:[p.facts[0],f]},['xiangxiang_operations']),null)
 assert.equal(route.capabilityReadSections({...p,facts:[p.facts[2]]},['xiangxiang_operations']),null)
 assert.equal(route.capabilityReadSections(p,[]),null)
})

test('a title shared by a historical record and a workflow cannot select a workflow default',()=>{
 for(const title of ['development','開發','Development workflow']){
  const input=data(),work=input.itemsBySource[0].items.find(r=>r.fields.section==='work')
  work.fields.records.push({name:title,sourceId:'historical-name-collision',model:'historical-only-model'})
  input.answerPlan.sections=[{heading:'Role',items:[{sourceId:'xiangxiang_operations#'+work.sourceId,title,facts:[{field:'開發',value:'unrecorded-model'}]}]}]
  const v=validatePlan(input.answerPlan,input)
  assert.equal(v.boundWorkflowFacts,0,title);assert.equal(v.droppedFacts,1,title)
 }
 const input=data(),work=input.itemsBySource[0].items.find(r=>r.fields.section==='work')
 work.fields.records.push({name:'Same title'},{name:'Same title'})
 input.answerPlan.sections=[{heading:'Role',items:[{sourceId:'xiangxiang_operations#'+work.sourceId,title:'Same title',facts:[{field:'review',value:'unrecorded-model'}]}]}]
 assert.equal(validatePlan(input.answerPlan,input).boundWorkflowFacts,0)
})

function setup(t){const old={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',GOAL_DECOMPOSER:'on',READ_ACCESS:'on',CONTEXT_DECISIONS_OPENAI:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',XIANGXIANG_MEMORY:'on',TURN_ROUTER:'on',A4_KNOWLEDGE_ROUTING:'on',MULTI_AI_ROUTER:'off',DECISION_RECALL:'off',CONVERSATION_RECALL:'off'})}
const preference='Use a brief conclusion, three short points and one final limitation.'
async function exercise(t,{sharing='on',failRead=false,boundedRead=true}={}){
 setup(t);process.env.CONTEXT_DECISIONS_OPENAI=sharing
 const calls=[],reads=[];let classifiers=0,worlds=0,recalls=0,prefs=0
 const a={providerName:'claude',preflight:async()=>{},complete:async(prompt,o={})=>{calls.push({prompt,schema:o.responseFormat?.name});return{billing:'claude-subscription',model:'claude-opus-5-5',text:JSON.stringify(o.responseFormat?.name==='goal_plan'?saved.goal:prompt.includes('<external_read_context>')?saved.raw:{mode:'chat',intent:'question',reply:'Read configured workers first.',nextRead:{capability:'xiangxiang_operations',args:{query:saved.message,freshness:'current',location:null}}})}}}
 const result=await require('./intakeService').processIntake(saved.message,{complete:async()=>assert.fail('API forbidden')},saved.history,{demo:true,interactionMode:'chat',ownerInvestigation:boundedRead,openaiAdapter:a,controlAdapter:{complete:async()=>assert.fail('API control forbidden')},semanticCallModel:async()=>{classifiers++;return JSON.stringify({intent:'NONE',confidence:'HIGH'})},memoryClient:{recall:async()=>{recalls++;return[]},preferences:async()=>{prefs++;return{state:'ok',total:1,items:[{documentId:'xx-20000000-0000-4000-8000-000000000002',type:'preference',scope:'private:owner',text:preference,approval:{kind:'owner',actor:'owner',contentHash:crypto.createHash('sha256').update(preference).digest('hex')}}]}}},readContextDeps:{sources:['xiangxiang_operations','public_knowledge'],connector:{read:async(source,method,params)=>{reads.push({source,params});if(failRead)throw Error('offline read unavailable');return{results:saved.items.map(r=>({...r,trust:'live',retrievedAt:'2026-11-08T11:44:43.906Z'}))}}},sourceIntentResolver:async()=>{worlds++;return JSON.stringify({intent:'internal',question:null})},finalVerifier:async()=>({decision:'allow_final'})}})
 return{calls,reads,classifiers,worlds,recalls,prefs,result}
}
test('full saved goal routes once, retains approved preferences and presents explicit unknowns in existing disclosure',async t=>{
 const x=await exercise(t)
 assert.equal(x.calls.length,2);assert.equal(x.classifiers,2,'count both independent injected semantic opinions: four total helper slots')
 assert.equal(x.worlds,0);assert.equal(x.reads.length,1);assert.deepEqual(x.reads[0].params.sections,['configuration','work'])
 assert.equal(x.recalls,1);assert.equal(x.prefs,1);assert.ok(x.calls.at(-1).prompt.includes(preference))
 assert.match(x.result.reply,/未能核實/);assert.match(x.result.reply,/每個工作者/)
 assert.equal(x.result.investigation.answerPresentation.validation.unresolvedNeeds[0].id,'f3')
 assert.match(x.result.investigation.answerDetails,/gpt-6\.1-sol/);assert.deepEqual(x.result.tasks,[])
})
test('provider alias does not override a disabled memory sharing gate',async t=>{
 const x=await exercise(t,{sharing:'off'})
 assert.equal(x.prefs,0);assert.equal(x.recalls,0);assert.ok(x.calls.every(c=>!c.prompt.includes(preference)))
})
test('later main-loop requests retain the same approved preference after the subscription provider alias changes',async t=>{
 const x=await exercise(t,{boundedRead:false})
 assert.ok(x.calls.length>=3,'exercise the initial decision and later main-loop requests')
 assert.ok(x.calls[1].prompt.includes(preference));assert.ok(x.calls.at(-1).prompt.includes(preference))
 assert.equal(x.recalls,1);assert.equal(x.prefs,1)
})
test('failed reads cannot become a settled capability answer',async t=>{
 const x=await exercise(t,{failRead:true})
 assert.equal(x.result.investigation?.answerPresentation,undefined)
 assert.doesNotMatch(x.result.reply,/目前紀錄只顯示/);assert.deepEqual(x.result.tasks,[])
})
