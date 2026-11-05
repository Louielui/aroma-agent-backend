'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fixture=require('./fixtures/proposalDraftIntentReplay.json'),{isPlanningAdvice}=require('../investigation/planningAdvice'),{judgeGoalPlan}=require('./goal/goalPlanContract')
const actualGoal=fixture.outputs.find(o=>o.question_restated),judged=judgeGoalPlan(actualGoal)
test('the retained act/proposal.create recommendation selects draft presentation without changing execution authority',()=>{
 assert.equal(judged.ok,true);assert.equal(judged.plan.executiveFrame.taskType,'act');assert.equal(judged.plan.requestedCapability,'proposal.create')
 assert.equal(isPlanningAdvice({plan:judged.plan,report:{readOnly:true},mode:'recommend'}),true)
 for(const capability of [null,'email.send','development.modify','calendar.create','made.up'])assert.equal(isPlanningAdvice({plan:{...judged.plan,requestedCapability:capability},report:{readOnly:true},mode:'recommend'}),false)
 for(const override of [{ownerGoal:{}},{clarification:true},{mode:'commit'},{mode:'ask'},{report:{readOnly:false}},{plan:{...judged.plan,executiveFrame:{taskType:'act',decisionNeeded:false}}},{plan:{...judged.plan,ownerOutcomes:[...judged.plan.ownerOutcomes,{kind:'action',capability:'email.send',ownerQuote:'send it'}]}}])assert.equal(isPlanningAdvice({plan:judged.plan,report:{readOnly:true},mode:'recommend',...override}),false)
})

// Replay the real latest goal, draft and verifier. The newly selected premise
// reviewer and fresh sources are explicit offline substitutes, not live results.
async function replay(t,{review=fixture.offlineAdviceReview,inject=false}={}){
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',TURN_ROUTER:'on',READ_ACCESS:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',GITHUB_READ_REPO:'fixture/project',GOAL_DECOMPOSER:'on',A4_KNOWLEDGE_ROUTING:'on',XIANGXIANG_WEBSITE_FLOW:'off',MULTI_AI_ROUTER:'off',XIANGXIANG_MEMORY:'off',CONVERSATION_RECALL:'off',DECISION_RECALL:'off',XIANGXIANG_ARCHIVE:'off'})
 const calls=[],outputs=fixture.outputs,main=outputs.find(o=>o.reply),source=require('./fixtures/foregroundPlanningReplay.json')
 const adapter={providerName:'claude',preflight:async()=>{},complete:async(prompt,opts={})=>{
  calls.push({schema:opts.responseFormat?.name,phase:opts.invocationPhase,prompt})
  const data=opts.responseFormat?.name==='goal_plan'?actualGoal:opts.responseFormat?.name==='advice_premise_review'?review:opts.responseFormat?.name==='investigation_semantic_review'?outputs.at(-1):inject?{...main,reply:main.reply+'\n\n存貨還有 999 箱。'}:main
  return{text:JSON.stringify(data),model:'claude-opus-5-5',billing:'claude-subscription'}
 }}
 const result=await require('./intakeService').processIntake(fixture.message,{complete:async()=>assert.fail('API forbidden')},fixture.history,{
  demo:true,interactionMode:'chat',ownerInvestigation:true,openaiAdapter:adapter,semanticCallModel:async()=>JSON.stringify(outputs[0]),controlAdapter:{complete:async()=>assert.fail('API control forbidden')},
  readContextDeps:{sources:['xiangxiang_operations','github'],connector:{read:async(name)=>{if(name==='github')throw Error('offline_source_unavailable');assert.equal(name,'xiangxiang_operations');return{results:source.sections.filter(s=>!s.section.startsWith('external_')).map(s=>({source:name,sourceId:s.sourceId,title:s.section,retrievedAt:new Date().toISOString(),content:JSON.stringify(s),trust:'live',fields:s}))}}},finalVerifier:async()=>outputs.find(o=>o.decision),sourceIntentResolver:async()=>JSON.stringify({intent:'internal',question:null})}
 })
 return{result,calls}
}
test('retained act draft traverses premise edits and both guards while keeping useful changes and source gaps',async t=>{
 const {result,calls}=await replay(t)
 assert.equal(result.investigation.answerPresentation.kind,'reviewed_foreground_planning_advice');assert.equal(result.investigation.answerDetails,fixture.reviewedReply);assert.equal(result.adviceReview.state,'revised');assert.equal(result.adviceReview.editedSpans,2)
 assert.equal(result.investigation.answerPresentation.points,3);assert.match(result.reply,/速度.*簡單追問/s);assert.match(result.reply,/須先量度，並確認不損害上下文理解/);assert.match(result.reply,/呈現.*最多三個重點/s);assert.match(result.reply,/未知/);assert.doesNotMatch(result.reply,/Bad credentials|等待範圍|補充來源讀取狀態/)
 assert.equal(result.replyForArchive,result.reply);assert.equal(result.decision,null);assert.deepEqual(result.tasks,[]);assert.ok(!result.offer);assert.equal(calls.length,3)
 const answer=calls.find(x=>x.phase==='answer');assert.equal(answer.prompt.split('Louie 現在說:「'+fixture.message+'」').length-1,1)
 const data=JSON.parse(calls.find(x=>x.schema==='advice_premise_review').prompt.split('DATA:\n')[1]);assert.match(data.foregroundPreview,/目標一/);assert.match(data.reply,/Bad credentials/);assert.ok(!calls.some(x=>x.schema==='investigation_semantic_review'))
})
test('act draft advice still refuses an unresolved review or an injected business claim',async t=>{
 for(const opts of [{review:{...fixture.offlineAdviceReview,status:'unresolved',checks:{...fixture.offlineAdviceReview.checks,goal:'unresolved'}}},{inject:true}]){
  const {result}=await replay(t,opts);assert.notEqual(result.investigation.answerPresentation.kind,'reviewed_foreground_planning_advice');assert.doesNotMatch(result.reply,/999/);assert.equal(result.decision,null);assert.deepEqual(result.tasks,[])
 }
})

test('actual isolated HTTP/browser keeps the act draft useful on desktop/mobile and its full plan expandable',{timeout:30000},async t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cid=require('node:crypto').randomUUID(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'draft-intent-')),store=require('../store/conversationStore').createConversationStore({dataDir:dir})
 t.after(()=>{assert.ok(dir.startsWith(os.tmpdir()+path.sep));fs.rmSync(dir,{recursive:true,force:true})})
 for(let i=0;i<fixture.history.length;i+=2)store.appendTurn({id:cid,userText:fixture.history[i].text,replyText:fixture.history[i+1].text})
 const old=process.env.CHAT_BACKEND;process.env.CHAT_BACKEND='codex-subscription';t.after(()=>{if(old===undefined)delete process.env.CHAT_BACKEND;else process.env.CHAT_BACKEND=old})
 const brain={model:'claude-opus-5-5',effort:'medium'},modelCenter={read:()=>({brain,revision:1}),selection:()=>({mode:'central',effective:brain,revision:1}),resolveConversation:()=>brain},app=require('express')();app.locals.conversationDemo=true;app.use(require('express').json());app.locals.promoteToProposal=()=>assert.fail('No proposal may be created');let captured=null
 app.use(require('../routes/demoRouter').createDemoRouter({conversationStore:store,modelCenter,modelsFn:async()=>({billing:'subscriptions',models:[{model:brain.model,name:'Claude Opus 5.5',available:true,efforts:['medium'],supportsEffort:true,defaultEffort:'medium'}],providers:{claude:{state:'ready'}}}),getAdapterFn:()=>({providerName:'claude'}),processIntakeFn:async(message,adapter,history)=>{
  assert.equal(message,fixture.message);assert.deepEqual(history.map(x=>({role:x.role,text:x.text??x.content})),fixture.history);captured=await replay(t);return captured.result
 }}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port+'/demo');await page.getByRole('button',{name:store.list()[0].title,exact:true}).click({timeout:5000});await page.getByRole('textbox',{name:'訊息',exact:true}).fill(fixture.message);await page.getByRole('button',{name:'送出',exact:true}).click();await page.getByText('查看完整方案及來源依據',{exact:true}).last().waitFor({timeout:5000})
 const bot=page.locator('#log .turn.bot').last(),md=bot.locator('.md').first(),visible=await bot.innerText();assert.equal(await md.locator('li').count(),3);assert.equal(await bot.locator('details[open]').count(),0);assert.doesNotMatch(visible,/Bad credentials|等待範圍|補充來源讀取狀態/);assert.equal(await bot.locator('a[href^="/model-center"]').count(),0)
 assert.equal(store.get(cid).messages.length,24);assert.equal(store.get(cid).messages.at(-1).content,captured.result.reply);const box=await md.boundingBox();assert.ok(box.width<=680)
 const artifact=process.env.AROMA_ARTIFACT_DIR,screenshot=async name=>{if(artifact){fs.mkdirSync(artifact,{recursive:true});await page.screenshot({path:path.join(artifact,'draft-intent-'+name+'.png'),fullPage:false})}}
 await md.scrollIntoViewIfNeeded();await screenshot('desktop');await page.setViewportSize({width:390,height:844});await page.locator('#collapse').click();await md.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await screenshot('mobile')
 await page.setViewportSize({width:1440,height:1050});await bot.getByText('查看完整方案及來源依據',{exact:true}).click();await bot.getByText('完整建議方案',{exact:true}).click();const body=bot.getByText('完整建議方案',{exact:true}).locator('..').locator('.md').first();assert.match(await body.innerText(),/須先量度，並確認不損害上下文理解/);assert.match(await body.innerText(),/source revision/);await body.scrollIntoViewIfNeeded();await screenshot('expanded');assert.deepEqual(errors,[])
 if(artifact)fs.writeFileSync(path.join(artifact,'draft-intent.json'),JSON.stringify({scope:fixture.provenance.scope,reply:captured.result.reply,details:captured.result.investigation.answerDetails,width:box.width,points:3,mobileNoOverflow:true,closedByDefault:true,persistedMessages:24,errors},null,2))
})
