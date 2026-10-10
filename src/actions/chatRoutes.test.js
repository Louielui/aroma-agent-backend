'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto')
const {createChatGateway}=require('./chat'),{createChatRouter}=require('./chatRoutes'),{createGateway}=require('./service'),{createRouter}=require('./routes'),{TARGETS}=require('./contract')
const {createReceipts}=require('../investigation/receipts'),{createConversationStore}=require('../store/conversationStore'),{createDemoRouter}=require('../routes/demoRouter')
test('real intake → saved investigation → inline approval route → read-back → durable reopening, with no model call',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xx-chat-actions-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const conversations=createConversationStore({dataDir:dir}),receipts=createReceipts({dir:path.join(dir,'investigations')}),store=require('./store').createStore({dir:path.join(dir,'actions')})
 let writes=0,enabled=false
 const scheduler={read:async id=>({targetId:id,...TARGETS.find(t=>t.id===id),enabled,runtime:enabled?'Ready':'Disabled',definitionHash:'a'.repeat(64),at:new Date().toISOString()}),apply:async()=>{writes++;enabled=!enabled}}
 let gateway=createGateway({store,scheduler}),request=b=>gateway.handle({id:'owner',role:'owner'},b)
 const chat=createChatGateway({request,receipts,conversations}),app=express();app.use(express.json());app.locals.conversationDemo=true
 app.use(['/api/v1/demo','/api/v1/scheduler-actions'],(q,r,next)=>q.headers.authorization==='Bearer owner'?next():r.sendStatus(401))
 app.use(createRouter({request}));app.use(createChatRouter({chat}));app.use(createDemoRouter({conversationStore:conversations,schedulerChat:chat,getAdapterFn:()=>{throw Error('no_model_allowed')},processIntakeFn:()=>{throw Error('no_model_allowed')}}))
 const s=app.listen(0,'127.0.0.1');t.after(()=>s.close());await new Promise(r=>s.once('listening',r));const root='http://127.0.0.1:'+s.address().port
 const cid=randomUUID(),rid=randomUUID(),message='Please resume ActionGatewayAcceptance'
 // Production sameOrigin requires the registered loopback authority, so use the same Host seam as existing route tests.
 const send=(url,b,auth=true,origin='http://127.0.0.1:8090')=>new Promise((resolve,reject)=>{const q=require('node:http').request(root+url,{method:'POST',headers:{...(auth?{authorization:'Bearer owner'}:{}),'content-type':'application/json',host:'127.0.0.1:8090',origin}},r=>{let raw='';r.on('data',v=>raw+=v);r.on('end',()=>resolve({status:r.statusCode,body:(()=>{try{return JSON.parse(raw)}catch(_){return null}})()}))});q.on('error',reject);q.end(JSON.stringify(b))})
 let r=await send('/api/v1/demo/intake',{message,conversationId:cid,websiteRequestId:rid});assert.equal(r.status,200);assert.equal(writes,0);assert.equal(r.body.investigationRunId,rid)
 assert.equal(conversations.get(cid).messages.at(-1).investigationRunId,rid)
 const c={conversationId:cid,investigationId:rid},api='/api/v1/demo/scheduler-actions'
 const p=(await send(api,{op:'list',...c})).body.runs[0];assert.ok(p.nonce);assert.equal(p.capability,'scheduler.resume')
 assert.equal((await send(api,{op:'approve',...c,id:p.id,hash:p.hash,nonce:p.nonce},false)).status,401)
 assert.equal((await send(api,{op:'approve',...c,id:p.id,hash:p.hash,nonce:p.nonce},true,'https://other.invalid')).status,403)
 assert.equal((await send('/api/v1/scheduler-actions',{op:'chat_approve',context:c,id:p.id,hash:p.hash,nonce:p.nonce})).status,400)
 assert.equal((await send(api,{op:'approve',...c,conversationId:randomUUID(),id:p.id,hash:p.hash,nonce:p.nonce})).status,409)
 assert.equal((await send(api,{op:'prepare',...c,targetId:'anything',action:'scheduler.pause',command:'injected'})).status,400);assert.equal(writes,0)
 r=await send(api,{op:'approve',...c,id:p.id,hash:p.hash,nonce:p.nonce});assert.equal(r.body.run.state,'verified');assert.equal(writes,1)
 r=await send(api,{op:'restore',...c,id:p.id});const inverse=r.body.run;assert.equal(inverse.state,'awaiting_approval');assert.equal(writes,1)
 gateway=createGateway({store,scheduler})
 const reopened=(await send(api,{op:'list',...c})).body.runs;assert.equal(reopened.length,2);assert.equal(reopened.find(r=>r.id===inverse.id).nonce,undefined)
 assert.equal((await send(api,{op:'approve',...c,id:inverse.id,hash:inverse.hash,nonce:inverse.nonce})).status,409);assert.equal(writes,1)
 assert.equal((await send(api,{op:'get',...c,id:p.id})).body.run.state,'verified')
 assert.equal((await send(api,{op:'list',...c,investigationId:randomUUID()})).status,409)
})
