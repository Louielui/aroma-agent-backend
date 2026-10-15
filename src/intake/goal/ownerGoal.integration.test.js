'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto')
const goals=require('./ownerGoal'),REQUEST='幫我新增一個schedule. 每天早上8點看系統,\n把每個供應商要下的貨品列出來\n之後把costco要下的訂單物品放進購物車. 不需要下單.'
test('existing Goal Decomposer carries whole Owner outcomes even when its read-fact plan has no facts',async()=>{
 let calls=0
 const result=await require('./goalDecomposer').decomposeGoal({question:REQUEST,callModel:async({prompt,responseFormat})=>{
  calls++;assert.ok(prompt.includes(REQUEST));assert.ok(responseFormat.schema.required.includes('owner_outcomes'))
  return {text:JSON.stringify({question_restated:'Prepare the recurring purchasing workflow',executive_frame:{taskType:'act',decisionNeeded:false,successDefinition:'All Owner outcomes verified',answerPosture:'evidence_first'},requested_capability:null,facts:[],joins:[],owner_outcomes:[{ownerQuote:'每天早上8點看系統',capability:'aroma_system.read',kind:'read'}]})}
 }})
 assert.equal(calls,1);assert.equal(result.ok,false);assert.equal(result.understanding.ownerOutcomes[0].ownerQuote,'每天早上8點看系統')
})
test('ordinary informational intake cannot acquire an action goal from invented decomposer mappings',async()=>{
 const vars={CHAT_BACKEND:'off',READ_ACCESS:'on',GOAL_DECOMPOSER:'on',MULTI_AI_ROUTER:'off',TURN_ROUTER:'off',A4_KNOWLEDGE_ROUTING:'off',DECISION_RECALL:'off',CONVERSATION_RECALL:'off'},prior=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars)
 try{
  let decomposed=0,message;const adapter={providerName:'claude',complete:async(prompt,opts={})=>{
   if(opts.responseFormat?.name==='goal_plan'){decomposed++;return {text:JSON.stringify({question_restated:message,executive_frame:{taskType:'act',decisionNeeded:false,successDefinition:'Read records',answerPosture:'evidence_first'},requested_capability:null,facts:[],joins:[],owner_outcomes:[{ownerQuote:message,capability:'aroma_system.read',kind:'read'}]})}}
   return {text:JSON.stringify({intent:'query',mode:'chat',reply:'Inventory describes the goods held for use.',tasks:[],decision:null}),model:'offline-fixture',usage:{inputTokens:1,outputTokens:1},latencyMs:1}
  }}
  for(message of ['What is inventory?','每天的訂貨單是怎麼建立的？','請問系統每天的設定是什麼']){
   const result=await require('../intakeService').processIntake(message,adapter,[],{demo:true,interactionMode:'chat',requestId:randomUUID(),providerHint:'claude',readContextDeps:{sources:[]}})
   assert.equal(result.ownerGoal,undefined);assert.match(result.reply,/Inventory describes/)
  }
  assert.equal(decomposed,3)
 }finally{for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v}
})
test('real intake preserves the failed procurement goal despite a data-only model answer and performs no business action',async()=>{
 const keys=['CHAT_BACKEND','READ_ACCESS','A4_KNOWLEDGE_ROUTING','GOAL_DECOMPOSER','MULTI_AI_ROUTER'],prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
 Object.assign(process.env,{CHAT_BACKEND:'off',READ_ACCESS:'off',A4_KNOWLEDGE_ROUTING:'off',GOAL_DECOMPOSER:'off',MULTI_AI_ROUTER:'off'})
 try{
  let calls=0;const adapter={providerName:'claude',complete:async()=>{calls++;return {text:JSON.stringify({intent:'task',mode:'recommend',reply:'所有排程及購物車操作已完成。',tasks:[],decision:null}),model:'offline-fixture',usage:{inputTokens:1,outputTokens:1},latencyMs:1}}}
  const result=await require('../intakeService').processIntake(REQUEST,adapter,[],{demo:true,interactionMode:'chat',requestId:randomUUID(),providerHint:'claude'})
  assert.ok(calls>0);assert.equal(result.ownerGoal.originalObjective,REQUEST);assert.equal(result.ownerGoal.recurring,true);assert.notEqual(result.ownerGoal.status,'GOAL_COMPLETED');assert.match(result.reply,/8點/);assert.match(result.reply,/購物車/);assert.match(result.reply,/不需要下單/);assert.deepEqual(result.tasks,[])
  assert.ok(!result.reply.includes('所有排程及購物車操作已完成'))
 }finally{for(const [k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v}
})
test('existing conversation and investigation stores retain incomplete goals separately from completed read-only receipts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-goal-fixture-')),id=randomUUID(),g=goals.createGoal({objective:REQUEST,requestId:randomUUID()})
 const conversations=require('../../store/conversationStore').createConversationStore({dataDir:dir})
 conversations.appendTurn({id,userText:REQUEST,replyText:'Incomplete',ownerGoal:g})
 assert.deepEqual(conversations.get(id).messages.at(-1).ownerGoal,g)
 const receipts=require('../../investigation/receipts').createReceipts({dir:path.join(dir,'receipts')}),rid=randomUUID()
 receipts.begin(rid,id);receipts.finish(rid,{reply:'Read finished',ownerGoal:g})
 assert.equal(receipts.get(rid).state,'completed');assert.equal(receipts.get(rid).goalStatus,'GOAL_BLOCKED')
 assert.throws(()=>conversations.appendTurn({id,userText:'new task',replyText:'x',ownerGoal:g}),/invalid_owner_goal/)
 assert.equal(conversations.get(id).messages.length,2)
})
test('existing Task Store keeps legacy state and stores a separate goal projection without dispatch',()=>{
 const store=require('../../store/store'),g=goals.createGoal({objective:REQUEST,requestId:randomUUID()}),before=store.listDispatches().length
 const r=store.persistIntake({understanding:'Offline goal fixture',tasks:[{title:'Track the complete Owner request'}],ownerGoal:g})
 const task=store.getTask(r.task_ids[0]);assert.equal(task.state,'todo');assert.equal(task.goalStatus,'GOAL_BLOCKED');assert.deepEqual(task.ownerGoal,g);assert.equal(store.listDispatches().length,before)
 const old=store.persistIntake({understanding:'Legacy fixture',tasks:[{title:'Legacy task'}]});assert.ok(!Object.hasOwn(store.getTask(old.task_ids[0]),'ownerGoal'))
})
test('conversation goal index survives ordinary topics and preserves independently scoped unfinished requests',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-goal-index-')),store=require('../../store/conversationStore').createConversationStore({dataDir:dir}),cid=randomUUID(),first=goals.createGoal({objective:REQUEST,requestId:randomUUID()})
 store.appendTurn({id:cid,userText:REQUEST,replyText:'Incomplete',ownerGoal:first})
 store.appendTurn({id:cid,userText:'What is inventory?',replyText:'An informational answer',ownerGoal:null})
 assert.equal(store.get(cid).messages.at(-1).ownerGoal,undefined);assert.equal(goals.currentGoal(store.get(cid)).goalId,first.goalId)
 const objective='Read the approved record',next=goals.refineGoal(goals.createGoal({objective,requestId:randomUUID()}),[{ownerQuote:objective,capability:'aroma_system.read',kind:'read'}]),completed=goals.applyEvidence(next,[{goalId:next.goalId,scopeHash:next.scopeHash,outcomeId:'outcome-0',capability:'aroma_system.read',receiptId:'offline-verified-read',state:'verified',complete:true}],()=>true)
 assert.equal(completed.status,'GOAL_COMPLETED');store.appendTurn({id:cid,userText:objective,replyText:'Verified current goal',ownerGoal:completed})
 const reloaded=require('../../store/conversationStore').createConversationStore({dataDir:dir}),saved=reloaded.get(cid),view=goals.withOutstanding(goals.attachResult({reply:''},completed),saved)
 assert.equal(saved.ownerGoals.length,2);assert.equal(goals.currentGoal(saved).goalId,completed.goalId);assert.deepEqual(saved.ownerGoals.find(g=>g.goalId===first.goalId),first);assert.equal(view.pendingOwnerGoals[0].goalId,first.goalId);assert.equal(view.hasUnresolvedOwnerGoals,true);assert.match(view.reply,/8點/);assert.match(view.reply,/購物車/);assert.equal(view.replyForArchive,view.reply)
 assert.equal(goals.withOutstanding(goals.attachResult({reply:''},completed),{ownerGoals:[completed],activeOwnerGoalId:completed.goalId}).hasUnresolvedOwnerGoals,false)
 assert.equal(goals.withOutstanding(goals.attachResult({reply:''},first),{ownerGoals:[first],activeOwnerGoalId:first.goalId}).hasUnresolvedOwnerGoals,true)
 assert.throws(()=>reloaded.appendTurn({id:randomUUID(),userText:'做完了嗎',replyText:'x',ownerGoal:first,ownerGoalReference:first.goalId}),/invalid_owner_goal/)
 reloaded.appendTurn({id:cid,userText:'做完了嗎',replyText:'Original goal',ownerGoal:first,ownerGoalReference:first.goalId});assert.equal(goals.currentGoal(reloaded.get(cid)).goalId,first.goalId);assert.equal(reloaded.get(cid).ownerGoals.length,2)
})
test('malformed canonical goal history fails closed without overwriting or hiding unfinished records',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-goal-corrupt-')),store=require('../../store/conversationStore').createConversationStore({dataDir:dir}),cid=randomUUID(),goal=goals.createGoal({objective:REQUEST,requestId:randomUUID()})
 store.appendTurn({id:cid,userText:REQUEST,replyText:'Incomplete',ownerGoal:goal})
 const file=path.join(store.dir,cid+'.json'),record=JSON.parse(fs.readFileSync(file,'utf8'));record.ownerGoals.push({...goal,status:'GOAL_COMPLETED'});fs.writeFileSync(file,JSON.stringify(record));const before=fs.readFileSync(file)
 assert.throws(()=>goals.currentGoal(store.get(cid)),/owner_goal_history_unavailable/);assert.throws(()=>store.appendTurn({id:cid,userText:'Another topic',replyText:'x'}),/owner_goal_history_unavailable/);assert.deepEqual(fs.readFileSync(file),before)
})
test('ordinary acknowledgements accept the immediate unrelated offer rather than a persistent or completed goal cursor',async()=>{
 const express=require('express'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-goal-ack-topic-')),store=require('../../store/conversationStore').createConversationStore({dataDir:dir}),cid=randomUUID(),goal=goals.createGoal({objective:REQUEST,requestId:randomUUID()});let calls=0
 store.appendTurn({id:cid,userText:REQUEST,replyText:'Incomplete',ownerGoal:goal});store.appendTurn({id:cid,userText:'Explain inventory',replyText:'Would you like more detail?'})
 const app=express();app.locals.conversationDemo=true;app.use(express.json());app.use(require('../../routes/demoRouter').createDemoRouter({conversationStore:store,getAdapterFn:()=>({providerName:'spy'}),processIntakeFn:async()=>{calls++;return {mode:'chat',reply:'Ordinary follow-up handled'}}}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port
 const post=message=>new Promise((resolve,reject)=>{const req=require('node:http').request(origin+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:8090',host:'127.0.0.1:8090'}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}))});req.on('error',reject);req.end(JSON.stringify({message,conversationId:cid}))})
 try{
  const normal=await post('好');assert.equal(normal.status,200);assert.equal(normal.body.reply,'Ordinary follow-up handled');assert.equal(calls,1);assert.equal(goals.currentGoal(store.get(cid)).goalId,goal.goalId)
  const objective='Read the approved record',next=goals.refineGoal(goals.createGoal({objective,requestId:randomUUID()}),[{ownerQuote:objective,capability:'aroma_system.read',kind:'read'}]),completed=goals.applyEvidence(next,[{goalId:next.goalId,scopeHash:next.scopeHash,outcomeId:'outcome-0',capability:'aroma_system.read',receiptId:'offline-complete',state:'verified',complete:true}],()=>true)
  store.appendTurn({id:cid,userText:objective,replyText:'This goal is complete. Need something else?',ownerGoal:completed});const afterComplete=await post('ok');assert.equal(afterComplete.body.reply,'Ordinary follow-up handled');assert.equal(calls,2)
  const status=await post('做完了嗎');assert.equal(status.status,200);assert.equal(calls,2);assert.equal(status.body.ownerGoal.goalId,completed.goalId);assert.equal(status.body.hasUnresolvedOwnerGoals,true);assert.ok(status.body.pendingOwnerGoals.some(g=>g.goalId===goal.goalId))
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
test('a failed goal-history append stays visible to the Owner instead of claiming durable task tracking',async()=>{
 const express=require('express'),message='Create a daily purchasing schedule',goal=goals.createGoal({objective:message,requestId:randomUUID()}),app=express();app.locals.conversationDemo=true;app.use(express.json())
 app.use(require('../../routes/demoRouter').createDemoRouter({conversationStore:{get:()=>null,list:()=>[],appendTurn:()=>{throw Error('ENOSPC')}},getAdapterFn:()=>({providerName:'spy'}),processIntakeFn:async()=>goals.attachResult({mode:'chat',reply:''},goal)}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port
 try{
  const response=await new Promise((resolve,reject)=>{const req=require('node:http').request(origin+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:8090',host:'127.0.0.1:8090'}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}))});req.on('error',reject);req.end(JSON.stringify({message,conversationId:randomUUID()}))})
  assert.equal(response.status,200);assert.equal(response.body.historySaved,false);assert.equal(response.body.ownerGoalTrackingUnavailable,true);assert.equal(response.body.ownerGoal.originalObjective,message);assert.equal(response.body.ownerGoal.status,'GOAL_BLOCKED');assert.match(response.body.reply,/未能保存|could not be saved/);assert.equal(response.body.replyForArchive,response.body.reply)
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
test('same-conversation whole-goal status survives reload and reads back without a model call or action',async()=>{
 const express=require('express'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-goal-http-')),conversations=require('../../store/conversationStore').createConversationStore({dataDir:dir}),cid=randomUUID(),g=goals.createGoal({objective:REQUEST,requestId:randomUUID()})
 conversations.appendTurn({id:cid,userText:REQUEST,replyText:'Incomplete',ownerGoal:g})
 const reloaded=require('../../store/conversationStore').createConversationStore({dataDir:dir}),app=express();app.locals.conversationDemo=true;app.use(express.json());app.use(require('../../routes/demoRouter').createDemoRouter({conversationStore:reloaded,getAdapterFn:()=>{throw Error('unexpected_model_call')}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port
 try{
  const ack=await new Promise((resolve,reject)=>{const req=require('node:http').request(origin+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:8090',host:'127.0.0.1:8090'}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}))});req.on('error',reject);req.end(JSON.stringify({message:'好',conversationId:cid}))})
  assert.equal(ack.status,200);assert.equal(ack.body.ownerGoal.goalId,g.goalId)
  reloaded.appendTurn({id:cid,userText:'What is inventory?',replyText:'Ordinary information, no new action'})
  assert.equal(reloaded.get(cid).messages.at(-1).ownerGoal,undefined)
  const response=await new Promise((resolve,reject)=>{const req=require('node:http').request(origin+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:8090',host:'127.0.0.1:8090'}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}))});req.on('error',reject);req.end(JSON.stringify({message:'做完了嗎',conversationId:cid}))}),result=response.body
  assert.equal(response.status,200);assert.equal(result.ownerGoal.goalId,g.goalId);assert.equal(result.ownerGoal.status,'GOAL_BLOCKED');assert.equal(result.historySaved,true);assert.equal(result.servedBy,null);assert.equal(reloaded.get(cid).messages.length,8)
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
