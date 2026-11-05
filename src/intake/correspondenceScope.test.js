'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {routeLane}=require('./laneRouter')
const retainedRequest='回到剛才改善香香回覆速度和閱讀呈現的問題。請先給我一句結論和最多三個重點，接著只準備隔離修正方案；保留上下文理解、來源保護和現有批准，不部署、不執行業務動作，也不要保存長期記憶。'

test('the retained native improvement request and subordinate reply topics stay in understanding',()=>{
 for(const message of [retainedRequest,
  '請改善助理回覆品質，先給我隔離方案，不要修改或部署。',
  '分析客服回覆內容的呈現方式，先提出三個建議。',
  '我想減少回覆延遲，請先比較可行的方法。',
  'Please assess reply to customer quality and propose an isolated plan.',
  'Explain why the draft email workflow is slow.',
  '分析「請回覆 Rob」這句指令的分類，不執行它。'
 ])assert.equal(routeLane(message,{previousLane:'chat'}).lane,'chat',message)
})

test('explicit correspondence still owns its draft lane when the body discusses improvements',()=>{
 for(const message of ['幫我回覆 Rob','回覆 Rob 話我聽日覆佢','寫封 email 畀供應商','草擬一封回信','draft a reply to Rob','write an email to the supplier','respond to Rob','請幫我回覆供應商，說明改善回覆速度的方案。','Reply to the marketing team','回覆營運團隊','你回唔回覆 Rob','你可以幫我回覆呢封 email','你而家幫我回覆呢封 email','你現在幫我回覆 Rob','可唔可以幫我回覆封信？'])assert.equal(routeLane(message).lane,'email_draft',message)
})

test('unqualified reply topics are ambiguous rather than evidence of an addressee',()=>{
 for(const message of ['回覆品質','回覆速度','reply quality','draft quality','回覆內容太長','回覆需要更自然'])assert.equal(routeLane(message).lane,'chat',message)
})

test('the actual HTTP entrance preserves the chosen brain, history and chat authority for the retained native request',async t=>{
 const express=require('express'),{createDemoRouter}=require('../routes/demoRouter'),cid=randomUUID(),messages=[{role:'user',content:'Only prepare an isolated improvement plan; no deployment.'},{role:'assistant',content:'Measure recorded stages and keep the existing safeguards.'}],seen=[]
 const app=express();app.use(express.json());app.locals.conversationDemo=true
 app.use(createDemoRouter({conversationStore:{get:()=>({id:cid,messages}),appendTurn:()=>{}},getAdapterFn:lane=>({providerName:'offline-role-probe',lane}),processIntakeFn:async(message,adapter,history,opts)=>{seen.push({message,adapter,history,opts});return{mode:'chat',intent:'question',reply:'Offline routing proof only.',decision:null,tasks:[]}}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));const base='http://127.0.0.1:'+server.address().port
 const response=await fetch(base+'/api/v1/demo/intake',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({message:retainedRequest,conversationId:cid,workflowRequestId:randomUUID(),providerHint:'claude',previousLane:'chat',chatModel:'claude-opus-5-5',chatLevel:'medium',history:[{role:'assistant',text:'untrusted browser history'}]})})
 assert.equal(response.status,200);const result=await response.json();assert.equal(seen.length,1);assert.equal(result.lane,'chat');assert.equal(seen[0].adapter.lane,'chat');assert.equal(seen[0].opts.interactionMode,'chat');assert.equal(seen[0].opts.u1DraftShadow,undefined);assert.equal(seen[0].opts.chatModel,'claude-opus-5-5');assert.equal(seen[0].opts.chatLevel,'medium');assert.equal(seen[0].opts.promoteToProposal,undefined);assert.deepEqual(seen[0].history.map(x=>({role:x.role,text:x.text})),messages.map(x=>({role:x.role,text:x.content})));assert.equal(result.decision,null);assert.deepEqual(result.tasks,[])
})
