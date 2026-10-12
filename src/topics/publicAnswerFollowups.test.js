'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {reviewClaims}=require('../subscription/publicAnswer')
const quote='Create a virtual environment using python -m venv tutorial-env.'
const source={id:'p1',url:'https://docs.python.org/3/tutorial/venv.html',kind:'publisher_page',text:quote,title:'Python',hash:'a'.repeat(64),retrievedAt:'2026-10-12T12:00:00Z'}
function rows(){return [{trust:'live',retrievedAt:source.retrievedAt,content:'已核對的內容。',fields:{provider:'claude_subscription_search',consulted:true,contentKind:'publisher_cited_summary',url:source.url,sourceTitle:'Python',sourceEvidence:{kind:source.kind,quote,hash:source.hash,language:'zh',readAt:source.retrievedAt,answerState:'supported',publicQuery:{query:'Python virtual environment Windows',freshness:'any',location:null},gaps:[{reason:'unverified_number',sourceId:'p1',url:source.url,quote,hash:source.hash,readAt:source.retrievedAt,quoteVerified:true}]}}}]}
test('retains quote-bound diagnostics for rejected translations and mismatched quotes without publishing draft answers',()=>{
 const reviewed=reviewClaims({claims:[{sourceId:'p1',quote,answer:'建立一個虛擬環境。'},{sourceId:'p1',quote:'A fabricated quotation of this source.',answer:'這是一段假的引用。'}]},[source],'zh')
 assert.equal(reviewed.claims.length,0);assert.equal(reviewed.gaps.length,2)
 assert.equal(reviewed.gaps[0].quote,quote);assert.equal(reviewed.gaps[0].quoteVerified,true);assert.equal(reviewed.gaps[1].quoteVerified,false)
 assert.equal(JSON.stringify(reviewed.gaps).includes('建立一個'),false)
})
test('server transcript receipt survives reopen; latest topic change invalidates it and forged receipts fail closed',t=>{
 const follow=require('./publicAnswerFollowups'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-followup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=require('../store/conversationStore').createConversationStore({dataDir:dir}),receipt=follow.createReceipt({itemsBySource:[{source:'public_knowledge',items:rows()}]})
 assert.ok(receipt);assert.ok(follow.validReceipt(receipt))
 store.appendTurn({id:'public-topic',userText:'Python?',replyText:'partial',publicAnswerReceipt:receipt})
 assert.deepEqual(follow.latestReceipt(store.get('public-topic')),receipt)
 assert.match(follow.explain(receipt,'zh'),/python -m venv/)
 assert.equal(follow.validReceipt({...receipt,query:{...receipt.query,secret:'private'}}),false)
 store.appendTurn({id:'public-topic',userText:'HR question',replyText:'HR answer'})
 assert.equal(follow.latestReceipt(store.get('public-topic')),null)
})
test('only bounded public completion requests match; mixed instructions do not become source authority',()=>{
 const {requestKind}=require('./publicAnswerFollowups')
 for(const text of ['哪一段不完整？幫我補齊。','幫我補齊','Complete the missing part.'])assert.equal(requestKind(text),'complete')
 for(const text of ['哪段不完整？','Which part is incomplete?'])assert.equal(requestKind(text),'inspect')
 for(const text of ['幫我補齊並停掉排程','Complete the missing part and email Samuel','Python Windows 呢？'])assert.equal(requestKind(text),null)
})
test('explicit completion refresh bypasses a partial cache and concurrent repeats still share one bounded execution',async()=>{
 const {createSearchCache}=require('../subscription/publicSearch');let calls=0,release
 const run=createSearchCache(async()=>{calls++;if(calls===2)await new Promise(r=>{release=r});return {status:'live',retrievedAt:'2026-10-12T12:00:00Z',results:[],webSearchCalls:1}})
 const input={query:'Python Windows',freshness:'any',replyLanguage:'zh'}
 await run(input);assert.equal((await run(input)).cache,'hit')
 const first=run({...input,refresh:true});await new Promise(r=>setImmediate(r));const second=run({...input,refresh:true});release()
 assert.equal((await first).cache,'miss');assert.equal((await second).cache,'shared');assert.equal(calls,2)
})
test('real HTTP follow-up uses only the saved public query, persists the budget, deduplicates and refuses cross-topic/client history',async t=>{
 const express=require('express'),follow=require('./publicAnswerFollowups'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-followup-http-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=require('../store/conversationStore').createConversationStore({dataDir:dir}),receipt=follow.createReceipt({itemsBySource:[{source:'public_knowledge',items:rows()}]})
 const env={READ_ACCESS:'on',CONTEXT_PUBLIC_KNOWLEDGE:'on',A4_KNOWLEDGE_ROUTING:'on',PUBLIC_SEARCH_PROVIDER:'claude-subscription',CODEX_CHAT_BRIDGE_TOKEN:'a'.repeat(64)}
 let calls=0
 const service=follow.createService({env,request:async(route,input)=>{
  calls++;assert.equal(route,'/public-search');assert.deepEqual(input,{...receipt.query,replyLanguage:'zh',refresh:true});assert.equal(JSON.stringify(input).includes('PRIVATE_SENTINEL'),false)
  const r=rows()[0];return {status:'live',provider:'claude_subscription_search',model:'claude-opus-5-5',billing:'claude-subscription',retrievedAt:r.retrievedAt,webSearchCalls:1,results:[{title:'Python',url:r.fields.url,content:r.content,contentKind:'publisher_cited_summary',consulted:true,sourceEvidence:{...r.fields.sourceEvidence,gaps:[]}}]}
 }})
 const app=express();app.locals.conversationDemo=true;app.use(express.json());app.use((req,res,next)=>req.headers['x-owner']==='yes'?next():res.sendStatus(401))
 app.use((req,res,next)=>{req.headers.host='127.0.0.1:8090';next()})
 app.use(require('../routes/demoRouter').createDemoRouter({conversationStore:store,publicCompletion:service,getAdapterFn:()=>({}),processIntakeFn:async()=>({mode:'chat',reply:'first partial',publicAnswerReceipt:receipt})}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const base='http://127.0.0.1:'+server.address().port
 const post=(body,origin='http://127.0.0.1:8090',owner=true)=>fetch(base+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json',origin,...(owner?{'x-owner':'yes'}:{})},body:JSON.stringify(body)})
 const id=()=>require('node:crypto').randomUUID(),cid='public-http'
 const body={message:'Python virtual environment setup',interactionMode:'chat',conversationId:cid,workflowRequestId:id()}
 assert.equal((await post(body)).status,200);assert.ok(store.get(cid).messages.at(-1).publicAnswerReceipt)
 const inspect={...body,message:'哪一段不完整？',workflowRequestId:id()}
 assert.equal((await post(inspect,'https://outside.example')).status,403);assert.equal((await post(inspect,undefined,false)).status,401)
 const explanation=await (await post(inspect)).json();assert.match(explanation.reply,/python -m venv/);assert.equal(calls,0)
 const complete={...body,message:'哪一段不完整？幫我補齊。',workflowRequestId:id(),history:[{role:'user',content:'PRIVATE_SENTINEL'}],publicAnswerReceipt:{query:'PRIVATE_SENTINEL'}}
 const first=await (await post(complete)).json();assert.equal(first.historySaved,true);assert.equal(calls,1);assert.equal(store.get(cid).messages.at(-1).publicAnswerReceipt.completionAttempted,true)
 assert.equal((await (await post(complete)).json()).reused,true);assert.equal(calls,1)
 assert.equal((await post({...complete,message:'幫我補齊'})).status,409)
 await post({...complete,workflowRequestId:id()});assert.equal(calls,1)
 store.appendTurn({id:cid,userText:'HR',replyText:'HR answer'})
 const changed=await (await post({...complete,workflowRequestId:id()})).json();assert.match(changed.reply,/沒有可銜接/);assert.equal(calls,1)
 env.READ_ACCESS='off';store.appendTurn({id:cid,userText:'Python',replyText:'partial',publicAnswerReceipt:receipt})
 const disabled=await (await post({...complete,workflowRequestId:id()})).json();assert.match(disabled.reply,/未取得可核對/);assert.equal(calls,1)
})
test('flag revocation after retrieval and malformed receipts never release a completion',async()=>{
 const follow=require('./publicAnswerFollowups'),receipt=follow.createReceipt({itemsBySource:[{source:'public_knowledge',items:rows()}]}),env={READ_ACCESS:'on',CONTEXT_PUBLIC_KNOWLEDGE:'on',A4_KNOWLEDGE_ROUTING:'on',PUBLIC_SEARCH_PROVIDER:'claude-subscription',CODEX_CHAT_BRIDGE_TOKEN:'a'.repeat(64)}
 let calls=0;const service=follow.createService({env,request:async()=>{calls++;env.READ_ACCESS='off';return {status:'live',provider:'claude_subscription_search',model:'claude-opus-5-5',billing:'claude-subscription',retrievedAt:source.retrievedAt,results:[]}}})
 await assert.rejects(service.complete({...receipt,query:{...receipt.query,private:'secret'}},{language:'en'}),/invalid/);assert.equal(calls,0)
 await assert.rejects(service.complete(receipt,{language:'en'}),/unavailable/);assert.equal(calls,1)
})
test('completion is reserved before dispatch and remains consumed across a restart without erasing the answer',t=>{
 const follow=require('./publicAnswerFollowups'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-reservation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const create=()=>require('../store/conversationStore').createConversationStore({dataDir:dir}),store=create(),receipt=follow.createReceipt({itemsBySource:[{source:'public_knowledge',items:rows()}]}),id='public-reservation',requestId=require('node:crypto').randomUUID()
 store.appendTurn({id,userText:'Python',replyText:'Original verified partial answer',publicAnswerReceipt:receipt})
 const reserved=store.reservePublicCompletion(id,receipt,requestId);assert.equal(reserved.completionAttempted,true)
 const reopened=create();assert.equal(follow.latestReceipt(reopened.get(id)).completionAttempted,true);assert.equal(reopened.get(id).messages.at(-1).content,'Original verified partial answer')
 assert.throws(()=>reopened.reservePublicCompletion(id,receipt,requestId),/context_changed/)
 assert.throws(()=>reopened.reservePublicCompletion(id,reserved,requestId),/invalid/)
 assert.equal(reopened.get(id).messages.length,2)
})
test('all rejected translations retain an insufficient source receipt and never turn into supported facts',async()=>{
 const out=await require('../subscription/publicAnswer').compose({run:async()=>({subtype:'success',modelUsage:{'claude-opus-5-5':{}},structured_output:{answerState:'supported',claims:[{sourceId:'p1',quote,answer:'這需要 99 個環境。'}]}})},{query:'venv',language:'zh',sources:[source]})
 assert.equal(out.answerState,'insufficient');assert.equal(out.gaps[0].reason,'unverified_number');assert.equal(out.omitted,1)
 assert.equal(out.claims[0].quote,quote);assert.equal(out.claims[0].answer.includes('99'),false)
})
