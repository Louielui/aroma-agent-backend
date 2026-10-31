'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fixture=require('./fixtures/postdeploymentAnswerReplay.json')
const {processIntake}=require('./intakeService')
function flags(t){const old={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old)});Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',TURN_ROUTER:'on',READ_ACCESS:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',CONTEXT_PUBLIC_KNOWLEDGE:'on',GOAL_DECOMPOSER:'on',A4_KNOWLEDGE_ROUTING:'on',XIANGXIANG_WEBSITE_FLOW:'on',MULTI_AI_ROUTER:'off',DECISION_RECALL:'off',CONVERSATION_RECALL:'off',XIANGXIANG_MEMORY:'off'})}
async function replay(t,{main=fixture.outputs.find(v=>v.reply),reportPlan=fixture.outputs.find(v=>v.question_restated),combined=false}={}){
 flags(t);let reads=0;const calls=[],snapshots=[]
 const adapter={providerName:'claude',preflight:async()=>{},complete:async(prompt,opts={})=>{calls.push({schema:opts.responseFormat?.name,phase:opts.invocationPhase});snapshots.push(prompt);let value
  if(opts.responseFormat?.name==='website_intent')value={...fixture.outputs[0],...(combined?{businessIntent:fixture.outputs[1]}:{})}
  else if(opts.responseFormat?.name==='goal_plan')value=reportPlan
  else if(opts.invocationPhase==='intent')value=fixture.outputs[1]
  else if(opts.responseFormat?.name==='investigation_semantic_review')throw Error('No fresh evidence exists to review')
  else value=main
  return{text:JSON.stringify(value),model:'claude-opus-5-5',billing:'claude-subscription'}
 }}
 const result=await processIntake(fixture.message,{complete:async()=>{throw Error('API forbidden')}},fixture.history,{demo:true,interactionMode:'chat',ownerInvestigation:true,openaiAdapter:adapter,semanticCallModel:async({prompt})=>(await adapter.complete(prompt,{invocationPhase:'intent'})).text,runtimeSelf:{address:'127.0.0.1',port:8090},websiteDeps:{record:()=>{}},readContextDeps:{sources:['xiangxiang_operations'],connector:{read:async()=>{reads++;throw Error('Unexpected source read')}},finalVerifier:async()=>fixture.outputs.find(v=>v.decision),sourceIntentResolver:async()=>JSON.stringify({intent:'not_applicable'})}})
 return{result,calls,reads,snapshots}
}
test('full intake replay preserves the retained valid answer when the judged investigation has no observations or claims',async t=>{
 const x=await replay(t);assert.equal(x.reads,0);assert.match(x.result.reply,/http:\/\/127\.0\.0\.1:8090\/demo/);assert.doesNotMatch(x.result.reply,/扣款原因|建議怎樣處理/);assert.deepEqual(x.result.tasks,[]);assert.equal(x.result.investigation.sections.length,0)
})
test('actual per-turn memory exclusion is described as policy, without claiming deletion or a completed save receipt',async t=>{
 const x=await replay(t);assert.match(x.result.reply,/排除規則|opt.out/i);assert.doesNotMatch(x.result.reply,/沒辦法保證|沒有權限阻止|訊息可能在我回覆之前/);assert.match(x.result.reply,/對話紀錄|conversation/i);assert.ok(x.snapshots.some(p=>p.includes('MEMORY RETENTION POLICY')))
})
test('a combined navigation/abstention opinion removes duplicate intent requests while preserving the same real main answer',async t=>{
 const x=await replay(t,{combined:true});assert.equal(x.calls.filter(c=>c.phase==='intent').length,1);assert.match(x.result.reply,/127\.0\.0\.1:8090\/demo/)
})
test('unobserved business claims are still withheld even when the model supplies an empty operational claim list',async t=>{
 for(const reply of ['存貨有999件。','存貨全部充足。']){const main={...fixture.outputs.find(v=>v.reply),reply},x=await replay(t,{main});assert.ok(!x.result.reply.includes(reply));assert.deepEqual(x.result.tasks,[])}
})
test('missing, malformed or nonempty claim drafts and actual read sections retain evidence presentation',()=>{
 const {preservesOrdinaryAnswer}=require('../investigation/generalizationView'),report=structuredClone(fixture.report)
 for(const investigationAnswer of [undefined,null,{}, {claims:[],extra:true},{claims:[{statement:'unsupported'}]}])assert.equal(preservesOrdinaryAnswer(report,JSON.stringify({investigationAnswer}),{route:'CONVERSATION'}),false)
 for(const state of ['unavailable','partial','ok'])assert.equal(preservesOrdinaryAnswer({...report,sections:[{section:'external_github',state,records:[]}]},JSON.stringify({investigationAnswer:{claims:[]}}),{route:'CONVERSATION'}),false)
 assert.equal(preservesOrdinaryAnswer({...report,evidenceModel:{...report.evidenceModel,contradictions:[{subject:'one'}]}},JSON.stringify({investigationAnswer:{claims:[]}}),{route:'CONVERSATION'}),false)
 for(const focus of ['cost','background','work_failure'])assert.equal(preservesOrdinaryAnswer({...report,focus},JSON.stringify({investigationAnswer:{claims:[]}}),{route:'CONVERSATION'}),false)
 assert.equal(preservesOrdinaryAnswer(report,JSON.stringify({investigationAnswer:{claims:[]}}),{route:'BUSINESS_QUERY'}),false)
 assert.equal(preservesOrdinaryAnswer({...report,routing:{...report.routing,requiredSources:['aroma_system']}},JSON.stringify({investigationAnswer:{claims:[]}}),{route:'CONVERSATION'}),false)
})
test('the candidate browser renders the full replay result with its URL, accurate policy and collapsed evidence, without management controls',{timeout:30000},async t=>{
 const x=await replay(t,{combined:true}),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'answer-ui-replay-')),cid='00000000-0000-4000-8000-000000000112'
 t.after(()=>{assert.ok(dir.startsWith(os.tmpdir()+path.sep));fs.rmSync(dir,{recursive:true,force:true})})
 const iid=require('node:crypto').randomUUID(),receipts=require('../investigation/receipts').createReceipts();receipts.begin(iid,cid);receipts.finish(iid,x.result)
 const store=require('../store/conversationStore').createConversationStore({dataDir:dir});store.appendTurn({id:cid,userText:fixture.message,replyText:x.result.reply,investigationRunId:iid})
 const app=require('express')();app.locals.conversationDemo=true;app.use(require('../routes/demoRouter').createDemoRouter({conversationStore:store,getAdapterFn:()=>{throw Error('No additional model call permitted')}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port+'/demo');await page.getByRole('button',{name:store.list()[0].title,exact:true}).click();await page.locator('#log .turn.bot details summary').first().waitFor()
 const body=page.locator('#log .turn.bot').last();assert.match(await body.innerText(),/127\.0\.0\.1:8090\/demo/);assert.match(await body.innerText(),/排除規則/);assert.doesNotMatch(await body.innerText(),/扣款原因|節省額度|沒有權限阻止/);assert.equal(await body.locator('a[href^="/model-center"]').count(),0);assert.equal(await body.locator('details').count()>0,true);assert.equal(await body.locator('details[open]').count(),0);assert.deepEqual(errors,[])
 if(process.env.AROMA_ARTIFACT_DIR){fs.mkdirSync(process.env.AROMA_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.AROMA_ARTIFACT_DIR,'answer-flow-offline-ui.png'),fullPage:true});fs.writeFileSync(path.join(process.env.AROMA_ARTIFACT_DIR,'answer-flow-offline-ui.json'),JSON.stringify({scope:'Offline real-output replay in actual candidate UI; injected model results, isolated conversation data; not production acceptance',visible:await body.innerText(),helperRequests:x.calls.length,errors},null,2))}
})
test('standalone definitions and supplied-text transformations use one answer, with no planner, website classifier, recall or source-verifier call',async t=>{
 flags(t)
 for(const message of ['什麼是現金流？','Explain photosynthesis','翻譯成英文：網站暫停服務']){
  let answers=0,extra=0;const denied=async()=>{extra++;throw Error('unexpected helper')},a={providerName:'claude',preflight:async()=>{},complete:async()=>{answers++;return{text:JSON.stringify({mode:'chat',intent:'question',reply:'A stable explanation.',nextRead:null}),model:'claude-opus-5-5',billing:'claude-subscription'}}}
  const r=await processIntake(message,{complete:denied},[],{demo:true,interactionMode:'chat',openaiAdapter:a,semanticCallModel:denied,controlAdapter:{complete:denied},readContextDeps:{connector:{read:denied},finalVerifier:denied},decisionRecallDeps:{listDecisionsFn:denied}})
  assert.equal(r.reply,'A stable explanation.');assert.equal(answers,1);assert.equal(extra,0)
 }
 const eligible=require('./chatSpeed').canUseGeneralFastPath,route={route:'CONVERSATION',reason:'general_knowledge'}
 for(const message of ['今天我們庫存有多少？','照上次安排','What is our current revenue?','這三位先處理'])assert.equal(eligible(message,route,[],{}),false)
 assert.equal(eligible('什麼是現金流？',route,[{role:'user',text:'Earlier task'}],{}),false);assert.equal(eligible('什麼是現金流？',route,[],{attachSection:'work'}),false)
})
