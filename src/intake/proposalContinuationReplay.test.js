'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fixture=require('./fixtures/proposalContinuationReplay.json'),{enforceRouteEvidence}=require('./routeEvidenceGuard'),{compactPlanningAdvice}=require('../investigation/planningAdvice')
test('retained native continuation preserves its verified local proposal count without admitting source facts',()=>{
 const c=fixture.cases[1],out=enforceRouteEvidence({reply:c.reviewedReply,message:c.message,evidenceSets:[],reviewedNoReadAdvice:true})
 assert.equal(out.violated,false);assert.equal(out.reply,c.reviewedReply)
 const preview=compactPlanningAdvice(out.reply,{message:c.message,report:{gaps:[{section:'github'}]}})
 assert.equal(preview.points,2);assert.match(preview.reply,/若多輪實測證實/);assert.match(preview.reply,/若讀碼後發現/);assert.equal(preview.details,c.reviewedReply)
})

const say=reply=>enforceRouteEvidence({reply,message:'只討論設計，不查資料。',evidenceSets:[],reviewedNoReadAdvice:true})
test('local document counts require exact adjacent ordered items rather than a matching phrase',()=>{
 const {verifiedDocumentLists}=require('./documentEnumeration')
 for(const text of ['方案包含2個步驟。\n1. 保留上下文。\n2. 量度耗時。','建議分為三個重點。第一：先量度。第二：核對來源。第三：保留批准。','The proposal includes 2 changes.\n1. Retain context.\n2. Measure elapsed time.'])assert.equal(verifiedDocumentLists(text).length,1,text)
 for(const text of ['提案有兩項改動。','提案有三項改動。第一，保留上下文。第二，量度耗時。','提案有兩項改動。第一，保留上下文。第一，量度耗時。','提案有兩項改動。第二，保留上下文。第一，量度耗時。','提案有兩項改動。第一，保留上下文。第二，量度耗時。第三，核對來源。','提案有兩項改動。先看其他話題。第一，保留上下文。第二，量度耗時。','目前提案有兩項改動。第一，保留上下文。第二，量度耗時。','提案有兩項改動，存貨全部充足。第一，保留上下文。第二，量度耗時。']){
  assert.deepEqual(verifiedDocumentLists(text),[],text);assert.equal(say(text).violated,true,text)
 }
 const header='提案有兩項改動。',text=header+'第一，保留上下文。第二，量度耗時。\n\n'+header+'第一，只列一項。',out=say(text)
 assert.deepEqual(out.withheld,[header]);assert.ok(out.reply.startsWith(header+'第一，保留上下文。第二，量度耗時。'))
 assert.equal(enforceRouteEvidence({reply:header+'第一，先量度。第二，後核對。',message:'談談設計',evidenceSets:[]}).violated,true)
})
test('a proved proposal count never proves item bodies or adjacent business assertions',()=>{
 for(const claim of ['今日有 3 樣貨要補。','存貨還有 12 箱。','存貨全部充足。']){
  for(const reply of ['提案有兩項改動。第一，'+claim+'第二，保留批准。','提案有兩項改動。第一，先量度。第二，保留批准。\n\n'+claim]){
   const out=say(reply);assert.equal(out.violated,true,reply);assert.ok(out.withheld.join('').includes(claim));assert.ok(out.reply.includes('提案有兩項改動。'))
  }
 }
})

// All five outputs are actual retained responses. Fresh source reads below are
// explicit offline substitutes; this is not a second native/model assessment.
async function replay(t,c,{inject=false}={}){
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',TURN_ROUTER:'on',READ_ACCESS:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',GITHUB_READ_REPO:'fixture/project',GOAL_DECOMPOSER:'on',A4_KNOWLEDGE_ROUTING:'on',XIANGXIANG_WEBSITE_FLOW:'off',MULTI_AI_ROUTER:'off',XIANGXIANG_MEMORY:'off',CONVERSATION_RECALL:'off',DECISION_RECALL:'off',XIANGXIANG_ARCHIVE:'off'})
 const calls=[],outputs=c.outputs,main=outputs.find(o=>o.reply),goal=outputs.find(o=>o.question_restated),review=outputs.find(o=>o.edits)
 const adapter={providerName:'claude',preflight:async()=>{},complete:async(prompt,opts={})=>{
  calls.push({schema:opts.responseFormat?.name,phase:opts.invocationPhase,prompt})
  const data=opts.responseFormat?.name==='goal_plan'?goal:opts.responseFormat?.name==='advice_premise_review'?review:inject?{...main,reply:main.reply+'存貨還有 999 箱。'}:main
  return{text:JSON.stringify(data),model:'claude-opus-5-5',billing:'claude-subscription'}
 }}
 const source=require('./fixtures/foregroundPlanningReplay.json'),result=await require('./intakeService').processIntake(c.message,{complete:async()=>assert.fail('API forbidden')},c.history,{
  demo:true,interactionMode:'chat',ownerInvestigation:true,openaiAdapter:adapter,semanticCallModel:async()=>JSON.stringify(outputs[0]),controlAdapter:{complete:async()=>assert.fail('API control forbidden')},
  readContextDeps:{sources:['xiangxiang_operations','github'],connector:{read:async(name)=>{if(name==='github')throw Error('offline_source_unavailable');assert.equal(name,'xiangxiang_operations');return{results:source.sections.filter(s=>!s.section.startsWith('external_')).map(s=>({source:name,sourceId:s.sourceId,title:s.section,retrievedAt:new Date().toISOString(),content:JSON.stringify(s),trust:'live',fields:s}))}}},finalVerifier:async()=>outputs.find(o=>o.decision),sourceIntentResolver:async()=>JSON.stringify({intent:'internal',question:null})}
 })
 return{result,calls}
}
for(const c of fixture.cases)test('retained native case '+c.case+' traverses actual review, guards and full intake with source-unavailable substitutes',async t=>{
 const {result,calls}=await replay(t,c)
 assert.equal(result.investigation.answerPresentation.kind,'reviewed_foreground_planning_advice');assert.equal(result.investigation.answerDetails,c.reviewedReply)
 assert.equal(result.investigation.answerPresentation.points,c.case===1?3:2);assert.match(result.reply,c.case===3?/假設目標拆解是主要延遲來源/:/多輪實測/);assert.doesNotMatch(result.reply,/提案內容我暫定為|未取得可讀的失敗紀錄|有 1 句講到營運狀況|Bad credentials/)
 assert.equal(result.replyForArchive,result.reply);assert.equal(result.decision,null);assert.deepEqual(result.tasks,[]);assert.equal(calls.length,3)
 const answer=calls.find(x=>x.phase==='answer');assert.equal(answer.prompt.split('Louie 現在說:「'+c.message+'」').length-1,1)
 const reviewData=JSON.parse(calls.find(x=>x.schema==='advice_premise_review').prompt.split('DATA:\n')[1]);if(c.case===2)assert.match(reviewData.foregroundPreview,/第一，簡單追問/)
 if(c.case===2){assert.match(result.reply,/若這會降低追問的理解準確度就收回/);assert.match(result.reply,/若讀碼後發現/)}
 if(c.case===3){assert.match(result.reply,/正文只放答案/);assert.match(result.reply,/並實測確認不影響上下文理解/);assert.match(reviewData.foregroundPreview,/不跑完整的目標拆解/)}
})
test('a retained positive review cannot waive a new business quantity through full intake',async t=>{
 for(const c of fixture.cases){const {result}=await replay(t,c,{inject:true});assert.notEqual(result.investigation.answerPresentation.kind,'reviewed_foreground_planning_advice');assert.doesNotMatch(result.reply,/999/);assert.equal(result.decision,null);assert.deepEqual(result.tasks,[])}
})

for(const c of fixture.cases)test('candidate HTTP and actual pixels preserve native case '+c.case+' input, compact answer and complete reviewed plan',{timeout:30000},async t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cid=require('node:crypto').randomUUID(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'proposal-replay-')),store=require('../store/conversationStore').createConversationStore({dataDir:dir})
 t.after(()=>{assert.ok(dir.startsWith(os.tmpdir()+path.sep));fs.rmSync(dir,{recursive:true,force:true})})
 for(let i=0;i<c.history.length;i+=2)store.appendTurn({id:cid,userText:c.history[i].text,replyText:c.history[i+1].text})
 const oldBackend=process.env.CHAT_BACKEND;process.env.CHAT_BACKEND='codex-subscription';t.after(()=>{if(oldBackend===undefined)delete process.env.CHAT_BACKEND;else process.env.CHAT_BACKEND=oldBackend})
 const brain={model:'claude-opus-5-5',effort:'medium'},modelCenter={read:()=>({brain,revision:1}),selection:()=>({mode:'central',effective:brain,revision:1}),resolveConversation:()=>brain},app=require('express')();app.locals.conversationDemo=true;app.use(require('express').json());app.locals.promoteToProposal=()=>assert.fail('No proposal may be created')
 let captured=null
 app.use(require('../routes/demoRouter').createDemoRouter({conversationStore:store,modelCenter,modelsFn:async()=>({billing:'subscriptions',models:[{model:brain.model,name:'Claude Opus 5.5',available:true,efforts:['medium'],supportsEffort:true,defaultEffort:'medium'}],providers:{claude:{state:'ready'}}}),getAdapterFn:()=>({providerName:'claude'}),processIntakeFn:async(message,adapter,history)=>{
  assert.equal(message,c.message);assert.deepEqual(history.map(x=>({role:x.role,text:x.text??x.content})),c.history);captured=await replay(t,c);return captured.result
 }}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port+'/demo');await page.getByRole('button',{name:store.list()[0].title,exact:true}).click({timeout:5000});await page.getByRole('textbox',{name:'訊息',exact:true}).fill(c.message);await page.getByRole('button',{name:'送出',exact:true}).click();await page.getByText('查看完整方案及來源依據',{exact:true}).last().waitFor({timeout:5000})
 const bot=page.locator('#log .turn.bot').last(),md=bot.locator('.md').first(),visible=await bot.innerText();assert.equal(await md.locator('li').count(),c.case===1?3:2);assert.equal(await bot.locator('details[open]').count(),0);assert.doesNotMatch(visible,/有 1 句講到營運狀況|未取得可讀的失敗紀錄|Bad credentials/);assert.equal(await bot.locator('a[href^="/model-center"]').count(),0)
 const box=await md.boundingBox();assert.ok(box.width<=680);assert.equal(store.get(cid).messages.length,c.history.length+2);assert.equal(store.get(cid).messages.at(-1).content,captured.result.reply);assert.equal(captured.result.investigation.answerDetails,c.reviewedReply)
 const artifact=process.env.AROMA_ARTIFACT_DIR,screenshot=async name=>{if(artifact){fs.mkdirSync(artifact,{recursive:true});await page.screenshot({path:path.join(artifact,'proposal-case-'+c.case+'-'+name+'.png'),fullPage:false})}}
 await md.scrollIntoViewIfNeeded();await screenshot('desktop')
 await page.setViewportSize({width:390,height:844});await page.locator('#collapse').click();await md.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const mobile=await md.boundingBox();assert.ok(mobile.x>=0&&mobile.x+mobile.width<=390);await screenshot('mobile')
 await page.setViewportSize({width:1440,height:1050});await bot.getByText('查看完整方案及來源依據',{exact:true}).click();await bot.getByText('完整建議方案',{exact:true}).click();const planBody=bot.getByText('完整建議方案',{exact:true}).locator('..').locator('.md').first();assert.match(await planBody.innerText(),c.case===2?/若這會降低追問的理解準確度就收回/:c.case===3?/並實測確認不影響上下文理解/:/若多輪實測顯示/);await planBody.scrollIntoViewIfNeeded();await screenshot('expanded');assert.deepEqual(errors,[])
 if(artifact)fs.writeFileSync(path.join(artifact,'proposal-case-'+c.case+'.json'),JSON.stringify({scope:'Actual isolated HTTP/browser with retained real outputs/review, substituted connectors, no new provider call',provenance:c.provenance,reply:captured.result.reply,reviewedDetails:captured.result.investigation.answerDetails,pointCount:await md.locator('li').count(),savedMessages:store.get(cid).messages.length,ordinaryArchiveMatches:true,closedByDefault:true,width:box.width,mobileNoOverflow:true,offlineAdapterResponses:captured.calls.length,errors},null,2))
})
