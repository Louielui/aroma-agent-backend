'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const saved=require('./fixtures/capabilityForegroundAnswer.json')
const {buildReadResultReply}=require('./readResultView')
const {validatePlan}=require('./answerPlan')
const input=()=>({message:saved.message,answerKind:'capability_explanation',allowCapabilityPreview:true,reply:saved.raw.reply,answerPlan:structuredClone(saved.raw.answerPlan),itemsBySource:[{source:'xiangxiang_operations',items:structuredClone(saved.items)}],perSource:[{source:'xiangxiang_operations',trust:'live',shownCount:2,status:'ok'}],evidenceSets:saved.evidenceSets})

test('retained native role-only answer keeps verified models on the face without claiming Worker readiness',()=>{
 const i=input(),v=validatePlan(i.answerPlan,i),view=buildReadResultReply(i)
 assert.equal(v.boundWorkflowFacts,3)
 assert.match(view.reply,/gpt-6\.1-sol/);assert.match(view.reply,/sonnet/)
 assert.match(view.reply,/測試草稿流程/);assert.match(view.reply,/開發流程/);assert.match(view.reply,/審閱流程/)
 assert.doesNotMatch(view.reply,/四個 AI|全部都是閒置|test_draft|daily_procurement/)
 assert.match(view.reply,/模型未記錄.*本機採納流程/)
 assert.match(view.reply,/背景排程.*每日採購.*不是.*AI/)
 assert.match(view.reply,/未測試接單/);assert.match(view.reply,/1 個數值/)
 assert.match(view.answerDetails,/daily_procurement/)
 assert.equal(view.reply.split('gpt-6.1-sol').length-1,2)
})

test('a different model-authored opening or question wording cannot hide bound model facts',()=>{
 for(const message of ['Which assistants and models handle delegated development?','開發和審查分別用誰？']){
  const i=input();i.message=message;i.answerPlan.directAnswer='Configured workflows exist.';i.answerPlan.answerClaims=[]
  const v=buildReadResultReply(i);assert.match(v.reply,/gpt-6\.1-sol/);assert.match(v.reply,/sonnet/)
 }
})

test('untrusted, ambiguous, missing and rejected facts cannot mint a foreground model list',()=>{
 for(const change of [
  i=>{i.itemsBySource[0].items.forEach(r=>{r.trust='memory'})},
  i=>{const row=i.itemsBySource[0].items.find(r=>r.fields.section==='work');row.fields.workflows.push({...row.fields.workflows.find(r=>r.role==='review')});i.answerPlan.sections[0].items[0].facts=[{field:'review',value:'invented'}]},
  i=>{i.answerPlan.sections=[]},
  i=>{i.answerPlan.citesEvidence=false},
  i=>{i.answerPlan.sections[0].items[0].facts=[{field:'adoption',value:'invented-model'},{field:'daily_procurement',value:'invented-model'}]}
 ]){const i=input();change(i);const v=validatePlan(i.answerPlan,i);assert.equal(v.boundWorkflowFacts,0);assert.equal(v.workflowModels?.length||0,0);assert.doesNotMatch(buildReadResultReply(i).reply,/invented-model/)}
})

test('a single selected workflow never imports other models or a duplicate role into the face',()=>{
 const i=input();i.answerPlan.sections[0].items[0].facts=[{field:'review',value:'not-the-source-model'},{field:'review',value:'duplicate-model'}]
 const v=buildReadResultReply(i);assert.match(v.reply,/sonnet/);assert.doesNotMatch(v.reply,/gpt-6\.1-sol|not-the-source-model|duplicate-model/)
 assert.equal(v.reply.split('sonnet').length-1,1)
})

test('English foreground keeps the same bound models and distinguishes unrecorded roles and schedules',t=>{
 const old=process.env.XIANGXIANG_LOCALE;process.env.XIANGXIANG_LOCALE='en';t.after(()=>{if(old===undefined)delete process.env.XIANGXIANG_LOCALE;else process.env.XIANGXIANG_LOCALE=old})
 const view=buildReadResultReply(input());assert.match(view.reply,/gpt-6\.1-sol/);assert.match(view.reply,/sonnet/)
 assert.match(view.reply,/Model not recorded.*Local adoption workflow/);assert.match(view.reply,/background schedule is not a dispatchable AI/)
 assert.match(view.reply,/dispatch was not tested/);assert.match(view.reply,/could not be verified/)
})

async function intakeReplay(t){
 const old={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',GOAL_DECOMPOSER:'on',READ_ACCESS:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',XIANGXIANG_MEMORY:'on',TURN_ROUTER:'on',A4_KNOWLEDGE_ROUTING:'on',MULTI_AI_ROUTER:'off',DECISION_RECALL:'off',CONVERSATION_RECALL:'off'})
 const calls=[],reads=[];let semanticCalls=0
 const adapter={providerName:'claude',preflight:async()=>{},complete:async(prompt,o={})=>{calls.push({prompt,schema:o.responseFormat?.name});assert.ok(o.responseFormat?.name==='goal_plan'||prompt.includes('<external_read_context>'),'no extra answer/decision model');return{billing:'claude-subscription',model:'claude-opus-5-5',text:JSON.stringify(o.responseFormat?.name==='goal_plan'?saved.goal:saved.raw)}}}
 const result=await require('./intakeService').processIntake(saved.message,{complete:async()=>assert.fail('API forbidden')},saved.history,{demo:true,interactionMode:'chat',ownerInvestigation:true,openaiAdapter:adapter,controlAdapter:{complete:async()=>assert.fail('API control forbidden')},semanticCallModel:async()=>{semanticCalls++;return JSON.stringify({intent:'NONE',confidence:'HIGH'})},memoryClient:{recall:async()=>[]},readContextDeps:{sources:['xiangxiang_operations','public_knowledge'],connector:{read:async(source,method,params)=>{reads.push({source,params});assert.equal(source,'xiangxiang_operations');return{results:structuredClone(saved.items)}}},sourceIntentResolver:async()=>assert.fail('duplicate classification'),finalVerifier:async()=>({decision:'allow_final'})}})
 return{result,calls,reads,semanticCalls}
}

test('full intake replays retained raw output through bounded reads, unchanged guards and source-owned foreground',async t=>{
 const x=await intakeReplay(t)
 assert.equal(x.calls.length,2);assert.equal(x.semanticCalls,2,'two independent injected opinions, not native provider calls')
 assert.equal(x.reads.length,1);assert.deepEqual(x.reads[0].params.sections,['configuration','work'])
 assert.match(x.result.reply,/gpt-6\.1-sol/);assert.match(x.result.reply,/sonnet/);assert.doesNotMatch(x.result.reply,/四個 AI|全部都是閒置/)
 assert.match(x.calls.at(-1).prompt,/a role list or idle-state inventory is not a model-name answer/)
 assert.equal(x.result.investigation.answerPresentation.validation.boundWorkflowFacts,3)
 assert.deepEqual(x.result.tasks,[]);assert.ok(x.result.decision==null||x.result.decision==='');assert.ok(x.result.offer==null||x.result.offer==='')
 assert.equal(x.calls.at(-1).prompt.split('Louie 現在說:「'+saved.message+'」').length-1,1)
})

test('candidate desktop/mobile pixels show models before any details click using the full offline intake result',{skip:process.platform!=='win32',timeout:45000},async t=>{
 const fs=require('node:fs'),path=require('node:path'),{assemblePage}=require('../demo/pageTemplate'),{modelCatalogue}=require('../workers/execution/chatBrowser.cjs')
 const x=await intakeReplay(t),browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true})
 const read=n=>fs.readFileSync(path.join(__dirname,'../demo/assets',n),'utf8')
 const html=assemblePage({template:read('index.html'),css:read('app.css'),sidebarCss:read('sidebar.css'),app:read('app.js'),sidebar:read('sidebar.js'),topics:read('topics.js'),i18n:require('../i18n/browserResolver').browserI18nSource(),dot:read('dot.svg'),favicon:'',sourceLabels:[],subscription:true,modelCenter:true,buildStamp:'isolated-offline-capability-foreground'})
 try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await context.route('**/*',async route=>{const p=new URL(route.request().url()).pathname,method=route.request().method(),json=o=>route.fulfill({contentType:'application/json',body:JSON.stringify(o)})
   if(p==='/demo')return route.fulfill({contentType:'text/html',body:html})
   if(p==='/api/v1/demo/models')return json({...modelCatalogue(),models:[...modelCatalogue().models,{model:'claude-opus-5-5',name:'Claude Opus 5.5',available:true,supportsEffort:true,efforts:['low','medium','high'],defaultEffort:'medium'}],central:{model:'claude-opus-5-5',effort:'medium'},selection:{mode:'central',revision:0,effective:{model:'claude-opus-5-5',effort:'medium'}}})
   if(p==='/api/v1/demo/intake'){assert.equal(method,'POST');assert.equal(route.request().postDataJSON().message,saved.message);return json(x.result)}
   if(method==='GET')return json(p==='/api/v1/conversations'?{ok:true,conversations:[]}:p==='/api/v1/demo/greeting'?{line:'Offline fixture'}:p==='/api/v1/demo/version'?{build:'isolated-offline-capability-foreground'}:{ok:true,entries:[],sections:[],state:'unavailable'})
   assert.fail('Unexpected browser mutation '+p)
  })
  try{await page.goto('http://127.0.0.1:19091/demo');await page.locator('#msg').fill(saved.message);await page.locator('#send').click();await page.getByText('已核對的流程預設模型：',{exact:true}).waitFor()
   const body=await page.locator('main').innerText();assert.match(body,/gpt-6\.1-sol/);assert.match(body,/sonnet/);assert.match(body,/背景排程.*不是.*AI/)
   assert.equal(await page.locator('.investigation-evidence').getAttribute('open'),null)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[])
   if(process.env.AROMA_ARTIFACT_DIR){fs.mkdirSync(process.env.AROMA_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.AROMA_ARTIFACT_DIR,'foreground-'+width+'.png'),fullPage:false});fs.writeFileSync(path.join(process.env.AROMA_ARTIFACT_DIR,'foreground-'+width+'.json'),JSON.stringify({scope:'Actual candidate page and full intake with retained native outputs and substituted connector/provider; not production/model/latency acceptance',reply:x.result.reply,modelsVisibleWithoutDisclosure:true,detailsClosed:true,width,errors},null,2))}
  }finally{await context.close()}
 }}finally{await browser.close()}
})
