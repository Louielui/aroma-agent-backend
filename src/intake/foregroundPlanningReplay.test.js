'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fixture=require('./fixtures/foregroundPlanningReplay.json')
const main=fixture.outputs.find(x=>x.reply),goal=fixture.outputs.find(x=>x.question_restated)
const checks={goal:'aligned',priority:'conditional',capabilities:'qualified',facts:'qualified'}
const edits=[
 {before:'我判斷回覆慢、讀起來吃力，主要是因為連簡單追問也要跑完整套準備流程，而且呈現層會把答案拆成很多段。',after:'建議先在隔離副本量度回覆各階段，再整理呈現方式；目前沒有足夠資料判定主要延遲。',reason:'unsupported_premise'},
 {before:'**準備步驟太重：**目前設定裡，目標拆解和記憶擷取都是開著的，每一輪都會跑。簡單追問其實不需要這兩步。',after:'**流程待量度：**設定開啟不等於每一輪都會呼叫；先以實際回執核對，才決定哪些步驟可省略。',reason:'unsupported_premise'},
 {before:'**呈現層蓋過正文：**你之前指出過，intakeService.js 遇到空的 sections 時，呈現層會蓋掉正確答案。這是你當時的描述，這一輪我沒有辦法核對程式碼。',after:'**正文呈現待檢查：**這一輪尚未核對程式來源，先把正文及來源附註的呈現列為待檢查項。',reason:'historical_assumption'},
 {before:'**還沒有修正生效：**我讀到的兩項已完成的隔離修正都只是候選版本，沒有套用到目前的香香。另外，紀錄裡看不到專門處理回覆速度的工作。',after:'**版本仍需核對：**這次讀到的是部分歷史紀錄，不能據此判定改善是否已在目前版本生效。',reason:'historical_assumption'},
 {before:'判斷為簡單追問時，略過目標拆解，記憶只取最相關的幾則；有 sections 就由系統逐項列出，空的 sections 不可以蓋掉正文。正文固定為一句結論加最多三個重點。',after:'先量度簡單追問；只有對照測試確認不損理解及來源保護時，才縮減重複步驟，並保留還原方式。空的來源區塊不能蓋掉正文；主回覆採一句結論及最多三個重點。',reason:'missing_qualification'},
 {before:'你點頭的話，我就按這個範圍準備工作單和批准卡。',after:'這份方案目前供你審閱；任何實作仍使用既有批准流程。',reason:'missing_qualification'}
]
const review={status:'revised',checks,edits}
// Real draft/goal outputs are retained; review edits and fresh connector replies
// are explicit offline substitutes, never a native semantic review verdict.
async function replay(t,{reviewResult=review,throwReview=false,taskType='plan',mode='recommend',draft=main,question=fixture.message,history=fixture.history,failMain=false}={}){
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',TURN_ROUTER:'on',READ_ACCESS:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',GITHUB_READ_REPO:'fixture/project',GOAL_DECOMPOSER:'on',A4_KNOWLEDGE_ROUTING:'on',XIANGXIANG_WEBSITE_FLOW:'off',MULTI_AI_ROUTER:'off',XIANGXIANG_MEMORY:'off',CONVERSATION_RECALL:'off',DECISION_RECALL:'off',XIANGXIANG_ARCHIVE:'off'})
 const calls=[],reads=[],adapter={providerName:'claude',preflight:async()=>{},complete:async(prompt,opts={})=>{
  const schema=opts.responseFormat?.name;calls.push({schema,phase:opts.invocationPhase,prompt})
  let data
  if(schema==='goal_plan')data={...goal,executive_frame:{...goal.executive_frame,taskType},question_restated:taskType==='plan'?goal.question_restated:question}
  else if(schema==='advice_premise_review'){if(throwReview)throw Error('SECRET_REVIEW_TRANSPORT');data=reviewResult}
  else if(schema==='investigation_semantic_review')data=fixture.outputs.find(x=>x.reviews)
  else {if(failMain)throw Error('SECRET_MAIN_TRANSPORT');data={...draft,mode}}
  return{text:JSON.stringify(data),model:'claude-opus-5-5',billing:'claude-subscription'}
 }}
 const result=await require('./intakeService').processIntake(question,{complete:async()=>assert.fail('API forbidden')},history,{
  demo:true,interactionMode:'chat',ownerInvestigation:true,openaiAdapter:adapter,semanticCallModel:async()=>JSON.stringify(fixture.outputs[0]),
  controlAdapter:{complete:async()=>assert.fail('API control forbidden')},
  readContextDeps:{sources:['xiangxiang_operations','github'],connector:{read:async(source,method)=>{reads.push({source,method});if(source==='github')throw Error('offline_source_unavailable');assert.equal(source,'xiangxiang_operations');return{results:fixture.sections.filter(s=>!s.section.startsWith('external_')).map(s=>({source,sourceId:s.sourceId,title:s.section,retrievedAt:new Date().toISOString(),content:JSON.stringify(s),trust:'live',fields:s}))}}},
   finalVerifier:async()=>fixture.outputs.find(x=>x.decision),sourceIntentResolver:async()=>JSON.stringify({intent:'internal',question:null})}
 })
 return{result,calls,reads}
}

test('saved native planning goal keeps reviewed planning rather than a missing-failure template through full intake',async t=>{
 const x=await replay(t);assert.equal(x.result.investigation.answerPresentation.kind,'reviewed_foreground_planning_advice');assert.match(x.result.reply,/量度回覆各階段/);assert.doesNotMatch(x.result.reply,/未取得可讀的失敗紀錄|同一任務追查結果|每一輪都會跑|還沒有修正生效/)
 assert.equal(x.result.reply.split('\n').filter(l=>/^[-*] /.test(l)).length,3);assert.ok(x.result.reply.length<800)
 assert.match(x.result.investigation.answerDetails,/隔離修正方案/);assert.match(x.result.investigation.answerDetails,/只有對照測試確認不損理解/);assert.match(x.result.reply,/未.*部署/);assert.match(x.result.reply,/排除規則|opt.out/)
 assert.equal(x.result.replyForArchive,x.result.reply);assert.equal(x.result.decision,null);assert.deepEqual(x.result.tasks,[])
 assert.equal(x.calls.filter(c=>c.schema==='advice_premise_review').length,1);assert.equal(x.calls.filter(c=>c.schema==='investigation_semantic_review').length,0);assert.equal(x.calls.length,3);assert.ok(x.reads.length)
 const reviewPrompt=x.calls.find(c=>c.schema==='advice_premise_review').prompt,reviewData=JSON.parse(reviewPrompt.split('DATA:\n')[1]);assert.match(reviewData.foregroundPreview,/主要是因為/);assert.doesNotMatch(reviewData.foregroundPreview,/隔離修正方案/);assert.match(reviewPrompt,/visible selection must independently retain every essential condition/)
 assert.ok(x.result.investigation.sections.some(s=>s.section==='external_github'&&s.state==='unconnected'))
})

test('an unavailable or incomplete planning review is explicit, does not publish the unverified plan and does not retry',async t=>{
 for(const options of [{throwReview:true},{reviewResult:{...review,checks:{...checks,facts:'unresolved'}}},{reviewResult:{...review,edits:[{...edits[0],before:'MISSING_SPAN'}]}}]){
  const x=await replay(t,options);assert.notEqual(x.result.investigation.answerPresentation.kind,'reviewed_foreground_planning_advice');assert.match(x.result.reply,/方案.*未.*核對|planning.*not.*verified/i);assert.doesNotMatch(x.result.reply,/SECRET_REVIEW_TRANSPORT/)
  assert.equal(x.calls.filter(c=>c.schema==='advice_premise_review').length,1);assert.equal(x.calls.filter(c=>c.schema==='investigation_semantic_review').length,0);assert.equal(x.result.decision,null);assert.deepEqual(x.result.tasks,[])
 }
})

test('a positive reviewer cannot promote an operational claim through read-backed planning',async t=>{
 const injected={...review,edits:[...edits.slice(0,5),{...edits[5],after:'存貨還有 999 箱。'}]},x=await replay(t,{reviewResult:injected})
 assert.notEqual(x.result.investigation.answerPresentation.kind,'reviewed_foreground_planning_advice');assert.doesNotMatch(x.result.reply,/999/);assert.equal(x.result.decision,null);assert.deepEqual(x.result.tasks,[])
})

test('a genuine failure diagnosis retains the existing source-bound checks rather than planning presentation',async t=>{
 const x=await replay(t,{taskType:'diagnose',question:'上一個開發工作失敗的原因是甚麼？目前修好了嗎？'})
 assert.notEqual(x.result.investigation.answerPresentation.kind,'reviewed_foreground_planning_advice');assert.equal(x.calls.filter(c=>c.schema==='advice_premise_review').length,0);assert.match(x.result.reply,/未確認|未取得/);assert.deepEqual(x.result.tasks,[])
})

test('the candidate HTTP and actual browser keep a concise plan with safe complete advice and evidence collapsed',{timeout:30000},async t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cid=require('node:crypto').randomUUID(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'planning-ui-')),store=require('../store/conversationStore').createConversationStore({dataDir:dir})
 t.after(()=>{assert.ok(dir.startsWith(os.tmpdir()+path.sep));fs.rmSync(dir,{recursive:true,force:true})})
 for(let i=0;i<fixture.history.length;i+=2)store.appendTurn({id:cid,userText:fixture.history[i].text,replyText:fixture.history[i+1].text})
 const oldBackend=process.env.CHAT_BACKEND;process.env.CHAT_BACKEND='codex-subscription';t.after(()=>{if(oldBackend===undefined)delete process.env.CHAT_BACKEND;else process.env.CHAT_BACKEND=oldBackend})
 const brain={model:'claude-opus-5-5',effort:'medium'},selection={mode:'central',effective:brain,revision:1},modelCenter={read:()=>({brain,revision:1}),selection:()=>selection,resolveConversation:()=>brain}
 let captured=null;const app=require('express')();app.locals.conversationDemo=true;app.use(require('express').json());app.locals.promoteToProposal=()=>assert.fail('No proposal may be created')
 app.use(require('../routes/demoRouter').createDemoRouter({conversationStore:store,modelCenter,modelsFn:async()=>({billing:'subscriptions',models:[{model:brain.model,name:'Claude Opus 5.5',available:true,efforts:['medium'],supportsEffort:true,defaultEffort:'medium'}],providers:{claude:{state:'ready'}}}),getAdapterFn:()=>({providerName:'claude'}),processIntakeFn:async(message,adapter,history)=>{
  assert.equal(message,fixture.message);assert.deepEqual(history.map(x=>({role:x.role,text:x.text??x.content})),fixture.history.map(x=>({role:x.role,text:x.text??x.content})));captured=await replay(t,{question:message,history});return captured.result
 }}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/demo');await page.getByRole('button',{name:store.list()[0].title,exact:true}).click({timeout:5000});await page.getByRole('textbox',{name:'訊息',exact:true}).fill(fixture.message,{timeout:5000});await page.getByRole('button',{name:'送出',exact:true}).click({timeout:5000});await page.getByText('查看完整方案及來源依據',{exact:true}).waitFor({timeout:5000})
 }catch(error){
  if(process.env.AROMA_ARTIFACT_DIR){fs.mkdirSync(process.env.AROMA_ARTIFACT_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.AROMA_ARTIFACT_DIR,'planning-ui-failure.json'),JSON.stringify({message:error.message,url:page.url(),body:(await page.locator('body').innerText()).slice(-5000),captured:!!captured,calls:captured?.calls.map(c=>({schema:c.schema,phase:c.phase})),errors},null,2));await page.screenshot({path:path.join(process.env.AROMA_ARTIFACT_DIR,'planning-ui-failure.png')})}throw error
 }
 const bot=page.locator('#log .turn.bot').last(),md=bot.locator('.md').first(),visible=await bot.innerText();assert.match(visible,/量度回覆各階段/);assert.doesNotMatch(visible,/未取得可讀的失敗紀錄|已分開核對失敗紀錄/);assert.equal(await md.locator('li').count(),3);assert.equal(await bot.locator('details[open]').count(),0);assert.equal(await bot.locator('a[href^="/model-center"]').count(),0)
 const box=await md.boundingBox();assert.ok(box.width<=680);assert.ok((await md.innerText()).length<800);assert.equal(store.get(cid).messages.length,16);assert.equal(store.get(cid).messages.at(-1).content,captured.result.reply)
 if(process.env.AROMA_ARTIFACT_DIR){fs.mkdirSync(process.env.AROMA_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.AROMA_ARTIFACT_DIR,'planning-candidate-desktop.png'),fullPage:false})}
 await page.setViewportSize({width:390,height:844});await page.locator('#collapse').click();await md.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const mobileBox=await md.boundingBox();assert.ok(mobileBox.x>=0&&mobileBox.x+mobileBox.width<=390);assert.equal(await md.locator('li').count(),3)
 if(process.env.AROMA_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.AROMA_ARTIFACT_DIR,'planning-candidate-mobile.png'),fullPage:false})
 await page.setViewportSize({width:1440,height:1050});await page.getByText('查看完整方案及來源依據',{exact:true}).click();await page.getByText('完整建議方案',{exact:true}).click();assert.match(await bot.innerText(),/只有對照測試確認不損理解/);assert.match(await bot.innerText(),/P02-C/);assert.doesNotMatch(await bot.innerText(),/每一輪都會跑|還沒有修正生效/);assert.deepEqual(errors,[])
 if(process.env.AROMA_ARTIFACT_DIR){await page.screenshot({path:path.join(process.env.AROMA_ARTIFACT_DIR,'planning-candidate-expanded.png'),fullPage:false});fs.writeFileSync(path.join(process.env.AROMA_ARTIFACT_DIR,'planning-candidate.json'),JSON.stringify({scope:'Actual isolated candidate HTTP/UI with retained provider outputs and explicitly substituted review/connectors; not native acceptance',reply:captured.result.reply,fullReviewedAdvice:captured.result.investigation.answerDetails,adapterCalls:captured.calls.length,mainPromptCurrentMessageCount:captured.calls.filter(c=>c.phase==='answer').map(c=>c.prompt.split('Louie 現在說:「'+fixture.message+'」').length-1),ordinaryStoredMessages:16,closedByDefault:true,width:box.width,mobileNoOverflow:true,errors},null,2))}
})
