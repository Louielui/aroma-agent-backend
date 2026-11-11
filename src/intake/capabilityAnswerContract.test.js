'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const saved=require('./fixtures/delegationAnswer.json')
const {validatePlan}=require('./answerPlan'),{buildReadResultReply,renderPlanSection}=require('./readResultView')
const data=()=>({message:saved.message,answerKind:'capability_explanation',allowCapabilityPreview:true,reply:saved.raw.reply,answerPlan:structuredClone(saved.raw.answerPlan),evidenceSets:saved.evidenceSets,itemsBySource:[{source:'xiangxiang_operations',items:structuredClone(saved.items).map(r=>({...r,trust:'live'})).sort((a,b)=>Number(b.fields.section==='work')-Number(a.fields.section==='work'))}],perSource:[{source:'xiangxiang_operations',trust:'live',shownCount:2,status:'ok'}]})
test('saved real answer binds composed workflow cells to exact source-owned role models',()=>{
 const input=data(),v=validatePlan(input.answerPlan,input),facts=v.plan.sections[0].items[0].facts
 assert.equal(v.boundWorkflowFacts,3)
 assert.equal(facts.length,3);assert.match(facts[0].value,/gpt-6\.1-sol.*medium/)
 assert.equal(facts[1].value,'gpt-6.1-sol');assert.equal(facts[2].value,'sonnet')
 const view=buildReadResultReply(input)
 assert.match(view.reply,/GPT-6\.1[ -]Sol/i);assert.match(view.reply,/Sonnet/i)
 assert.doesNotMatch(view.reply,/###|\*\*香香工作紀錄\*\*/)
 assert.match(view.reply,/未測試接單|dispatch was not tested/)
 assert.match(view.answerDetails,/gpt-6\.1-sol.*medium/);assert.match(view.answerDetails,/AGENT_BRIDGE off/)
 assert.ok(view.reply.length<saved.raw.reply.length+100)
})
test('role binding corrects invented models without accepting them as evidence',()=>{
 const input=data();input.answerPlan.sections[0].items[0].facts=[{field:'review',value:'made-up-model-99'}]
 const v=validatePlan(input.answerPlan,input)
 assert.deepEqual(v.plan.sections[0].items[0].facts,[{field:'審閱流程',value:'sonnet'}])
 assert.doesNotMatch(JSON.stringify(v.plan),/made-up-model-99/)
})
test('ambiguous role identity, absent models and non-operational rows cannot use workflow projection',()=>{
 for(const mutate of [rows=>rows[0].fields.workflows.push({...rows[0].fields.workflows.find(w=>w.role==='review')}),rows=>{rows[0].fields.workflows.find(w=>w.role==='review').model=null},rows=>{rows[0].source='aroma_system'},rows=>{rows[0].trust='advisory'},rows=>{rows[0].fields.workflows={}}]){
  const input=data();mutate(input.itemsBySource[0].items);input.answerPlan.sections=[{heading:'Roles',items:[{sourceId:input.itemsBySource[0].items[0].source+'#'+input.itemsBySource[0].items[0].sourceId,title:'Roles',facts:[{field:'review',value:'not-a-recorded-value-99'}]}]}]
  const v=validatePlan(input.answerPlan,input);assert.equal(v.droppedFacts,1);assert.equal(v.plan.sections[0].items[0].facts.length,0)
 }
})
test('a fact under a different named role cannot borrow that other workflow model',()=>{
 const input=data(),item=input.answerPlan.sections[0].items[0]
 item.title='review';item.facts=[{field:'development',value:'gpt-6.1-sol'}]
 input.answerPlan.sections=[input.answerPlan.sections[0]]
 const v=validatePlan(input.answerPlan,input)
 assert.equal(v.boundWorkflowFacts,0);assert.equal(v.droppedFacts,1)
})

test('null and non-object workflow members fail closed without crashing validation',()=>{
 for(const member of [null,undefined,0,false,'invalid',[]]){
  const input=data();input.itemsBySource[0].items[0].fields.workflows.unshift(member)
  input.answerPlan.sections=[{heading:'Roles',items:[{sourceId:'xiangxiang_operations#'+input.itemsBySource[0].items[0].sourceId,title:'Roles',facts:[{field:'review',value:'not-recorded-99'}]}]}]
  const v=validatePlan(input.answerPlan,input)
  assert.equal(v.boundWorkflowFacts,0);assert.equal(v.droppedFacts,1)
 }
})
test('withheld-only items omit empty headings while intentional title-only rows survive',()=>{
 assert.equal(renderPlanSection({heading:'Empty',items:[{title:'Workflow',facts:[],factsWithheld:true}]}),'')
 assert.match(renderPlanSection({heading:'Names',items:[{title:'A retrieved name',facts:[]}]}),/A retrieved name/)
})

test('compact details retain verified item identity and source attribution',()=>{
 const view=buildReadResultReply(data())
 assert.match(view.answerDetails,/香香工作紀錄/)
 const text=renderPlanSection({heading:'Roles',items:[{title:'Verified role A',readKey:'gmail',facts:[{field:'model',value:'recorded'}]}]},true)
 assert.match(text,/Verified role A/);assert.match(text,/recorded/)
})

test('workflow scope notes require bound workflow evidence rather than capability kind alone',()=>{
 const input=data();input.itemsBySource[0].items[0].fields.workflows=[]
 const view=buildReadResultReply(input)
 assert.doesNotMatch(view.reply,/此處是已讀來源中的流程預設模型/)
 assert.equal(view.answerDetails,undefined)
})

test('callers without a guaranteed disclosure retain full validated limitations in the foreground',()=>{
 for(const option of [false,undefined]){
  const input=data();input.allowCapabilityPreview=option
  input.answerPlan.limitations=['本次沒有測試接單。']
  const view=buildReadResultReply(input)
  assert.equal(view.answerDetails,undefined)
  assert.match(view.reply,/AGENT_BRIDGE off/)
  assert.match(view.reply,/本次沒有測試接單/)
 }
})
test('capability first read needs a judged, fully local non-action goal; mixed and unknown goals keep existing gates',()=>{
 const {judgeGoalPlan}=require('./goal/goalPlanContract'),route=require('../investigation/generalRouter')
 const p=judgeGoalPlan(saved.goal).plan
 assert.deepEqual(route.capabilityReadSections(p,['xiangxiang_operations']),['configuration','work'])
 for(const change of [{answerKind:null},{investigationReference:'previous'},{requestedCapability:'gmail.read'},{facts:[...p.facts,{operation:'public_knowledge',necessity:'enriching'}]},{investigationEvidence:['live_runtime']},{executiveFrame:{...p.executiveFrame,decisionNeeded:true}}])assert.equal(route.capabilityReadSections({...p,...change},['xiangxiang_operations']),null)
 assert.equal(route.capabilityReadSections(p,[]),null)
})
test('actual intake uses judged authorised capability read before main answer and avoids duplicate decision helpers',async t=>{
 const old={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',GOAL_DECOMPOSER:'on',READ_ACCESS:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',XIANGXIANG_MEMORY:'on',TURN_ROUTER:'on',A4_KNOWLEDGE_ROUTING:'on',MULTI_AI_ROUTER:'off',DECISION_RECALL:'off',CONVERSATION_RECALL:'off'})
 const calls=[],reads=[];let worlds=0,verifiers=0
 const a={providerName:'claude',preflight:async()=>{},complete:async(p,o={})=>{calls.push({prompt:p,schema:o.responseFormat?.name});const reply=p.includes('<external_read_context>')?saved.raw:{mode:'chat',intent:'question',reply:'Read the configured workers first.',nextRead:{capability:'xiangxiang_operations',args:{query:saved.message,freshness:'current',location:null}}};return{billing:'claude-subscription',model:'claude-opus-5-5',text:JSON.stringify(o.responseFormat?.name==='goal_plan'?saved.goal:reply)}}}
 const result=await require('./intakeService').processIntake(saved.message,{complete:async()=>{throw Error('API forbidden')}},saved.history,{demo:true,interactionMode:'chat',ownerInvestigation:true,openaiAdapter:a,controlAdapter:{complete:async()=>{throw Error('API control forbidden')}},semanticCallModel:async()=>JSON.stringify({intent:'NONE',confidence:'HIGH'}),
  memoryClient:{recall:async()=>[]},readContextDeps:{sources:['xiangxiang_operations','public_knowledge'],connector:{read:async(source,method,params)=>{reads.push({source,method,params});assert.equal(source,'xiangxiang_operations');return{results:saved.items.map(r=>({...r,trust:'live',retrievedAt:'2026-11-08T06:04:22.475Z',content:JSON.stringify(r.fields)}))}}},finalVerifier:async()=>{verifiers++;return{decision:'allow_final'}},sourceIntentResolver:async()=>{worlds++;return JSON.stringify({intent:'internal'})}}})
 assert.equal(calls.length,2);assert.equal(reads.length,1);assert.deepEqual(reads[0].params.sections,['configuration','work']);assert.equal(worlds,0);assert.equal(verifiers,0)
 assert.match(calls[1].prompt,/gpt-6\.1-sol/);assert.match(result.reply,/GPT-6\.1[ -]Sol/i);assert.match(result.reply,/Sonnet/i)
 assert.equal(result.investigation.answerPresentation.kind,'validated_capability_explanation');assert.match(result.investigation.answerDetails,/AGENT_BRIDGE off/)
 assert.doesNotMatch(result.reply,/###|已讀取的背景工作/);assert.deepEqual(result.tasks,[])
})
