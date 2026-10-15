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
  let decomposed=0;const message='What is inventory?',adapter={providerName:'claude',complete:async(prompt,opts={})=>{
   if(opts.responseFormat?.name==='goal_plan'){decomposed++;return {text:JSON.stringify({question_restated:message,executive_frame:{taskType:'act',decisionNeeded:false,successDefinition:'Read records',answerPosture:'evidence_first'},requested_capability:null,facts:[],joins:[],owner_outcomes:[{ownerQuote:message,capability:'aroma_system.read',kind:'read'}]})}}
   return {text:JSON.stringify({intent:'query',mode:'chat',reply:'Inventory describes the goods held for use.',tasks:[],decision:null}),model:'offline-fixture',usage:{inputTokens:1,outputTokens:1},latencyMs:1}
  }}
  const result=await require('../intakeService').processIntake(message,adapter,[],{demo:true,interactionMode:'chat',requestId:randomUUID(),providerHint:'claude',readContextDeps:{sources:[]}})
  assert.equal(decomposed,1);assert.equal(result.ownerGoal,undefined);assert.match(result.reply,/Inventory describes/)
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
 const conversations=require('../../store/conversationStore').createConversationStore({dir:path.join(dir,'conversations')})
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
test('same-conversation whole-goal status survives reload and reads back without a model call or action',async()=>{
 const express=require('express'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-goal-http-')),conversations=require('../../store/conversationStore').createConversationStore({dir}),cid=randomUUID(),g=goals.createGoal({objective:REQUEST,requestId:randomUUID()})
 conversations.appendTurn({id:cid,userText:REQUEST,replyText:'Incomplete',ownerGoal:g})
 const reloaded=require('../../store/conversationStore').createConversationStore({dir}),app=express();app.locals.conversationDemo=true;app.use(express.json());app.use(require('../../routes/demoRouter').createDemoRouter({conversationStore:reloaded,getAdapterFn:()=>{throw Error('unexpected_model_call')}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port
 try{
  const ack=await new Promise((resolve,reject)=>{const req=require('node:http').request(origin+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:8090',host:'127.0.0.1:8090'}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}))});req.on('error',reject);req.end(JSON.stringify({message:'好',conversationId:cid}))})
  assert.equal(ack.status,200);assert.equal(ack.body.ownerGoal.goalId,g.goalId)
  const response=await new Promise((resolve,reject)=>{const req=require('node:http').request(origin+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:8090',host:'127.0.0.1:8090'}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}))});req.on('error',reject);req.end(JSON.stringify({message:'做完了嗎',conversationId:cid}))}),result=response.body
  assert.equal(response.status,200);assert.equal(result.ownerGoal.goalId,g.goalId);assert.equal(result.ownerGoal.status,'GOAL_BLOCKED');assert.equal(result.historySaved,true);assert.equal(result.servedBy,null);assert.equal(reloaded.get(cid).messages.length,6)
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
