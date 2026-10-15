'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),vm=require('node:vm'),{randomUUID}=require('node:crypto')
const contract=require('./procurementContract')
const REQUEST='幫我新增一個schedule. 每天早上8點看系統, 把每個供應商要下的貨品列出來 之後把costco要下的訂單物品放進購物車. 不需要下單.'
const source=fs.readFileSync(path.join(__dirname,'../demo/assets/app.js'),'utf8'),start=source.indexOf('  function renderProcurement('),end=source.indexOf('\n  function render (',start)
assert.ok(start>=0&&end>start)
const flush=()=>new Promise(resolve=>setImmediate(resolve))
function ui(result,conv,fetch){
 const nodes=[],requests=[],renders=[],pending=[]
 function el(tag,cls,text){const node={tag,textContent:text,isConnected:true,children:[],listeners:{},appendChild(child){this.children.push(child)},addEventListener(event,fn){this.listeners[event]=fn}};nodes.push(node);return node}
 const context={el,crypto:{randomUUID},active:conv,t:key=>key,addBot:()=>({body:el('div')}),render:(...args)=>renders.push(args),fetch:(url,options)=>{requests.push(JSON.parse(options.body));const promise=Promise.resolve().then(()=>fetch(url,options));pending.push(promise);return promise}}
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);context.renderProcurement(result,conv)
 return{context,nodes,requests,renders,button:nodes.find(n=>n.tag==='button'),note:nodes.find(n=>n.tag==='p'),panel:nodes.find(n=>n.tag==='section'),async settled(){await Promise.allSettled(pending);await flush();await flush()}}
}
function send(server,route,body,headers={}){return new Promise((resolve,reject)=>{
 const cleanHeaders=Object.fromEntries(Object.entries({'content-type':'application/json',host:'127.0.0.1:8090',origin:'http://127.0.0.1:8090',...headers}).filter(([,value])=>value!==undefined))
 const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method:'POST',headers:cleanHeaders},response=>{let raw='';response.on('data',chunk=>raw+=chunk);response.on('end',()=>{let parsed;try{parsed=JSON.parse(raw)}catch{parsed=raw}resolve({status:response.statusCode,ok:response.statusCode>=200&&response.statusCode<300,headers:response.headers,body:parsed,json:async()=>parsed})})});request.on('error',reject);request.end(typeof body==='string'?body:JSON.stringify(body))
})}
async function listen(t,server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));return server}
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'procurement-presentation-'))
 // All persistence is synthetic and confined to this test's temporary directory.
 // No runtime directories, real credentials, OS scheduler or source adapter are used.
 t.after(()=>{assert.equal(path.dirname(fs.realpathSync(dir)).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());fs.rmSync(dir,{recursive:true,force:true})})
 const store=require('./store').createStore({dir:path.join(dir,'actions')}),conversations=require('../store/conversationStore').createConversationStore({dataDir:dir}),receipts=require('./store').createStore({dir:path.join(dir,'dialogue')})
 let now=Date.parse('2026-10-15T13:00:00Z'),exists=false,enabled=false,installs=0,changes=0,reads=0,gateway
 const scheduler={inspect:async()=>({exists,enabled,validDefinition:true,definitionHash:'b'.repeat(64),runtime:enabled?'Ready':'Disabled',at:new Date(now).toISOString()}),install:async()=>{exists=true;installs++},setEnabled:async value=>{enabled=value;changes++}}
 const sourceGateway={list:async()=>{reads++;throw Error('offline_source_access_forbidden')}}
 const makeGateway=()=>require('./service').createGateway({store,scheduler:{read:async()=>{throw Error('legacy_scheduler_not_requested')}},procurement:require('./procurement').createProcurement({store,scheduler,gateway:sourceGateway,approvals:require('../agent/ownerApprovalStore').createOwnerApprovalStore({now:()=>now,sessionTtlMs:5000}),enabled:()=>true,now:()=>now})})
 gateway=makeGateway();const bridgeCalls=[],token='a'.repeat(64)
 const bridge=await listen(t,require('../subscription/bridge').createBridge({token,schedulerActions:{handle:async(actor,body)=>{bridgeCalls.push(structuredClone(body));return gateway.handle(actor,body)}},completeFn:async()=>{throw Error('model_access_forbidden')}}))
 const bridgeRequest=body=>send(bridge,'/scheduler-action',body,{authorization:'Bearer '+token,origin:undefined}).then(response=>response.body)
 const options={conversations,receipts,tasks:{persistIntake(input){assert.equal(input.ownerGoal.originalObjective,REQUEST);return{task_ids:['task_1234abcd']}}},request:bridgeRequest}
 let chat=require('./procurementChat').createChat(options)
 const app=require('../app').createApp({ownerPassword:'offline-owner',serviceToken:'offline-service',procurementChat:{candidate:input=>chat.candidate(input),start:input=>chat.start(input),present:input=>chat.present(input),approve:input=>chat.approve(input),status:()=>chat.status()},runPersistence:false,proposalPersistence:false,workerDeps:{artifactStore:null,runner:null}});app.locals.conversationDemo=true
 const server=await listen(t,http.createServer(app)),login=await send(server,'/owner/login','password=offline-owner',{'content-type':'application/x-www-form-urlencoded'})
 assert.equal(login.status,302);const cookie=login.headers['set-cookie'][0].split(';')[0],conversationId=randomUUID(),conv={id:'c1',cid:conversationId}
 const post=(body,headers={})=>send(server,'/api/v1/demo/procurement-actions',body,{cookie,...headers}),first=await send(server,'/api/v1/demo/intake',{message:REQUEST,conversationId,websiteRequestId:randomUUID()},{cookie})
 assert.equal(first.status,200);assert.ok(first.body.procurementProposal,JSON.stringify(first.body))
 const proposal=first.body.procurementProposal,body=(op='present',extra={})=>({op,id:proposal.id,hash:proposal.hash,conversationId,requestId:randomUUID(),...extra})
 return{conv,proposal,result:first.body,store,conversations,receipts,bridgeCalls,post,body,cookie,server,bridgeRequest,
  mount:(fetch=(url,options)=>{assert.equal(url,'/api/v1/demo/procurement-actions');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');return post(JSON.parse(options.body))})=>ui(first.body,conv,fetch),
  reloadChat(){chat=require('./procurementChat').createChat(options)},restartGateway(){gateway=makeGateway()},advance(ms){now+=ms},counts:()=>({installs,changes,reads}),assertNoEffects(){assert.deepEqual(this.counts(),{installs:0,changes:0,reads:0})}}
}

test('presentation: actual browser conversation shape traverses HTTP, Bridge and Action Gateway before enabling approval',async t=>{
 const f=await fixture(t),card=f.mount();assert.equal(card.button.disabled,true);await card.settled()
 assert.equal(card.requests[0].conversationId,f.conv.cid);assert.equal(card.button.disabled,false);assert.equal(f.store.get(f.proposal.id).presentationHash,f.proposal.hash)
 assert.equal(f.bridgeCalls.filter(b=>b.op==='procurement_present').length,1);f.assertNoEffects()
 card.button.listeners.click();card.button.listeners.click();await card.settled()
 assert.equal(card.requests.length,2);assert.equal(card.requests[1].conversationId,f.conv.cid);assert.equal(card.button.disabled,true);assert.equal(card.renders.length,1)
 assert.equal(f.store.get(contract.STATE_ID).status,'active');assert.deepEqual(f.counts(),{installs:1,changes:1,reads:0});assert.notEqual(card.renders[0][1].ownerGoal.status,'GOAL_COMPLETED')
})
test('presentation: historical local UI ids and missing conversation ids fail the unchanged strict HTTP contract',async t=>{
 const f=await fixture(t),before=f.bridgeCalls.length
 for(const id of ['c1','h-'+f.conv.cid,undefined]){const response=await f.post(f.body('present',{conversationId:id}));assert.equal(response.status,400);assert.equal(response.body.error,'invalid_request')}
 assert.equal(f.bridgeCalls.length,before);assert.equal(f.store.get(f.proposal.id).presentationHash,undefined);f.assertNoEffects()
 // A rejected malformed presentation did not burn the valid approval ticket.
 assert.equal((await f.post(f.body())).body.presented,true);assert.equal((await f.post(f.body('approve'))).body.procurementStatus.schedule.status,'active');assert.equal(f.counts().installs,1)
})
test('presentation: missing, false or malformed acknowledgments and failed transports keep approval disabled',async()=>{
 for(const ack of [{},{presented:false},null,{presented:'true'},{presented:1}]){const card=ui({procurementProposal:{id:randomUUID(),hash:'a'.repeat(64)}},{id:'c1',cid:randomUUID()},async()=>({ok:true,json:async()=>ack}));await card.settled();assert.equal(card.button.disabled,true,JSON.stringify(ack));assert.equal(card.note.textContent,'procurement.presentFailed')}
 for(const fetch of [async()=>({ok:false}),async()=>{throw Error('offline_network_failure')},async()=>({ok:true,json:async()=>{throw Error('invalid_json')}})]){const card=ui({procurementProposal:{id:randomUUID(),hash:'a'.repeat(64)}},{id:'c1',cid:randomUUID()},fetch);await card.settled();assert.equal(card.button.disabled,true);assert.equal(card.note.textContent,'procurement.presentFailed')}
})
test('presentation: changed conversation or detached panel cannot activate after an in-flight acknowledgment',async()=>{
 for(const change of ['conversation','panel']){let resolve;const card=ui({procurementProposal:{id:randomUUID(),hash:'a'.repeat(64)}},{id:'c1',cid:randomUUID()},()=>new Promise(r=>{resolve=r}));await flush();if(change==='conversation')card.context.active={id:'c2',cid:randomUUID()};else card.panel.isConnected=false;resolve({ok:true,json:async()=>({presented:true})});await card.settled();assert.equal(card.button.disabled,true)}
})
test('presentation: missing acknowledgment cannot itself authorize a direct approval attempt',async t=>{
 const f=await fixture(t),card=f.mount(async()=>({ok:true,json:async()=>({})}));await card.settled();assert.equal(card.button.disabled,true)
 const result=await f.post(f.body('approve'));assert.equal(result.body.procurementStatus,undefined);assert.equal(f.store.get(f.proposal.id).presentationHash,undefined);f.assertNoEffects()
})
test('presentation: changed identity, hash and conversation remain blocked through the real HTTP path',async t=>{
 for(const changed of [{id:randomUUID()},{hash:'f'.repeat(64)},{conversationId:randomUUID()}]){const f=await fixture(t),response=await f.post(f.body('present',changed));assert.equal(response.status,409);assert.equal(f.store.get(f.proposal.id).presentationHash,undefined);f.assertNoEffects()}
})
test('presentation: canonical displayed text and durable proposal tampering remain blocked',async t=>{
 for(const changed of ['text','proposal']){const f=await fixture(t);if(changed==='text')f.conversations.appendTurn({id:f.conv.cid,userText:'different task',replyText:'different proposal'});else{const row=f.store.get(f.proposal.id);row.definition={...row.definition,toolScopeVersion:99};f.store.save(row)}assert.equal((await f.post(f.body())).status,409);f.assertNoEffects()}
})
test('presentation: expired proposal cannot acknowledge or execute',async t=>{
 const f=await fixture(t);f.advance(600001);assert.equal((await f.post(f.body())).status,409);assert.equal((await f.post(f.body('approve'))).body.procurementStatus,undefined);f.assertNoEffects()
})
test('presentation: expiration after acknowledgment still blocks approval',async t=>{
 const f=await fixture(t);assert.equal((await f.post(f.body())).body.presented,true);f.advance(600001);assert.equal((await f.post(f.body('approve'))).body.procurementStatus,undefined);f.assertNoEffects()
})
test('presentation: browser or dialogue reload keeps the exact still-valid proposal binding',async t=>{
 const f=await fixture(t);f.reloadChat();f.conv.id='h-'+f.conv.cid;const card=f.mount();await card.settled();assert.equal(card.button.disabled,false);assert.equal(card.requests[0].conversationId,f.conv.cid);card.button.listeners.click();await card.settled();assert.equal(f.counts().installs,1);assert.equal(f.counts().reads,0)
})
test('presentation: expired approval session or restarted Gateway never inherits an old ticket',async t=>{
 for(const scenario of ['expired_session','restart']){const f=await fixture(t);assert.equal((await f.post(f.body())).body.presented,true);if(scenario==='restart')f.restartGateway();else f.advance(5001);const response=await f.post(f.body('approve'));assert.equal(response.body.procurementStatus,undefined);f.assertNoEffects()}
})
test('presentation: changed Owner login session blocks both presentation and approval',async t=>{
 const f=await fixture(t);await send(f.server,'/owner/logout',{}, {cookie:f.cookie});for(const op of ['present','approve'])assert.equal((await f.post(f.body(op))).status,401);f.assertNoEffects()
})
test('presentation: wrong nonce cannot execute through the existing Gateway',async t=>{
 const f=await fixture(t);assert.equal((await f.post(f.body())).body.presented,true);const result=await f.bridgeRequest({op:'procurement_approve',id:f.proposal.id,hash:f.proposal.hash,conversationId:f.conv.cid,nonce:'f'.repeat(48)});assert.ok(result.error);f.assertNoEffects()
})
test('presentation: sequential and concurrent duplicate approvals never register twice',async t=>{
 const f=await fixture(t);assert.equal((await f.post(f.body())).body.presented,true);const body=f.body('approve'),responses=await Promise.all([f.post(body),f.post(body)]);assert.ok(responses.some(r=>r.body.procurementStatus?.schedule?.status==='active'));await f.post(body);await f.post(f.body('approve'));assert.deepEqual(f.counts(),{installs:1,changes:1,reads:0})
})
test('presentation: unauthenticated, cross-origin and extra-scope requests stay blocked',async t=>{
 const f=await fixture(t);assert.equal((await f.post(f.body(),{cookie:''})).status,401);assert.equal((await f.post(f.body(),{origin:'https://evil.invalid'})).status,403);assert.equal((await f.post({...f.body(),command:'forbidden'})).status,400);f.assertNoEffects()
})
