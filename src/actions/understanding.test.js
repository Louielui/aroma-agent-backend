'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createChatGateway}=require('./chat'),{createGateway}=require('./service'),{TARGETS}=require('./contract')
const {billingFor}=require('../subscription/chatModels')
const MODEL='claude-opus-5-5'
const decision=(intent='prepare',extra={})=>({intent,targetId:'gateway-acceptance',capability:'scheduler.resume',targetQuote:'',referenceQuote:'that job',...extra})
function fixture(answer){
 const runs=new Map(),requests=new Map(),semantic=new Map(),saved=new Map(),turns=new Map(),enabled=new Map(TARGETS.map(t=>[t.id,false]));let calls=0,writes=0,selected,received
 const memory=m=>({get:id=>structuredClone(m.get(id)),save:r=>m.set(r.id,structuredClone(r)),list:()=>[...m.values()].map(r=>structuredClone(r)),lock:()=>()=>{}})
 const scheduler={read:async id=>({...TARGETS.find(t=>t.id===id),targetId:id,enabled:enabled.get(id),runtime:enabled.get(id)?'Ready':'Disabled',definitionHash:'a'.repeat(64),at:new Date().toISOString()}),apply:async id=>{writes++;enabled.set(id,!enabled.get(id))}}
 const gateway=createGateway({store:memory(runs),scheduler}),request=b=>gateway.handle({id:'owner',role:'owner'},b)
 const receipts={get:id=>structuredClone(saved.get(id)),begin:(id,cid,requestHash)=>saved.set(id,{id,conversationId:cid,requestHash,state:'planning'}),finish:(id,res)=>Object.assign(saved.get(id),{state:res?'completed':'failed',investigation:res?.investigation,response:res})}
 const conversations={get:id=>structuredClone(turns.get(id)),appendTurn:b=>{const c=turns.get(b.id)||{messages:[]};c.messages.push({role:'user',content:b.userText},{role:'assistant',content:b.replyText,investigationRunId:b.investigationRunId});turns.set(b.id,c)}}
 const providerFor=settings=>{selected=settings;return{complete:async(prompt,opts)=>{calls++;received={prompt:JSON.parse(prompt),opts};const v=typeof answer==='function'?await answer(received):answer;return{model:settings.model,billing:billingFor(settings.model),text:JSON.stringify(v)}}}}
 const chat=createChatGateway({request,receipts,conversations,semanticStore:memory(semantic),continuationStore:memory(requests),providerFor,semanticTimeoutMs:30})
 const cid=randomUUID(),start=(message,extra={})=>chat.start({message,conversationId:cid,requestId:randomUUID(),model:MODEL,effort:'medium',...extra})
 const latest=()=>[...runs.values()].at(-1)
 return{chat,cid,start,latest,runs,semantic,conversations,request,providerFor,receipts,memory,requests,enabled,proposals:()=>[...runs.values()].filter(r=>r.capability).length,writes:()=>writes,calls:()=>calls,selected:()=>selected,received:()=>received}
}
test('colloquial Chinese and English resolve the saved job, prepare only and use the selected brain',async()=>{
 for(const [text,quote]of [['剛才那個工作先別再自動跑，幫我看看怎樣暫停。','剛才那個工作'],['Keep that job from running automatically again; show me a pause plan.','that job']]){
  const f=fixture(decision('prepare',{capability:'scheduler.pause',referenceQuote:quote,targetQuote:quote}));await f.start('Resume ActionGatewayAcceptance');let p=f.latest()
  await f.chat.handle({op:'present',...p.context,id:p.id,hash:p.hash});await f.start('確認剛才那個恢復方案');assert.equal(f.writes(),1)
  assert.equal(f.chat.candidate(text,f.cid),true);const r=await f.start(text);p=f.latest()
  assert.equal(p.target.id,'gateway-acceptance');assert.equal(p.capability,'scheduler.pause');assert.equal(p.state,'awaiting_approval');assert.equal(f.writes(),1)
  assert.equal(r.investigation.readOnly,true);assert.equal(f.calls(),1);assert.deepEqual(f.selected(),{model:MODEL,effort:'medium'})
  assert.equal(f.received().prompt.currentAction.targetId,'gateway-acceptance');assert.equal(f.received().opts.responseFormat.schema.additionalProperties,false)
  await f.chat.handle({op:'present',...p.context,id:p.id,hash:p.hash});assert.equal((await f.start('確認剛才那個暫停方案')).actionContinuation.state,'verified');assert.equal(f.writes(),2);assert.equal(f.calls(),1)
 }
})
test('named first request reaches the fixed catalogue; existing pending proposal is reused',async()=>{
 const f=fixture(decision('prepare',{targetQuote:'ActionGatewayAcceptance',referenceQuote:''})),text='讓 ActionGatewayAcceptance 再次自動跑，先給我方案。'
 assert.equal(f.chat.candidate(text,f.cid),true);await f.start(text);assert.equal(f.proposals(),1);assert.equal(f.writes(),0)
 await f.start(text);assert.equal(f.proposals(),1);assert.equal(f.writes(),0)
})
test('model approval cannot consume any displayed authority and generic yes stays deterministic',async()=>{
 const f=fixture(decision('approval'));await f.start('Resume ActionGatewayAcceptance');const p=f.latest();await f.chat.handle({op:'present',...p.context,id:p.id,hash:p.hash})
 const r=await f.start('Looks good; you have my permission to do that job.');assert.match(r.reply,/批准按鈕|approval button/);assert.equal(f.writes(),0)
 await f.start('好');assert.equal(f.calls(),1);assert.equal(f.writes(),0)
})
test('model cannot invent a referent, choose a different current job or fake a quotation',async()=>{
 for(const v of [decision('prepare',{targetId:'errand-recall'}),decision('prepare',{targetQuote:'errand-recall',targetId:'errand-recall'}),decision('prepare',{referenceQuote:'invented phrase'})]){
  const f=fixture(v);await f.start('Resume ActionGatewayAcceptance');const r=await f.start('Please help that job run again.');assert.match(r.reply,/未能確定|cannot establish/);assert.equal(f.proposals(),1);assert.equal(f.writes(),0)
 }
 const f=fixture(decision());await f.start('Please resume that background job.');assert.equal(f.proposals(),0);assert.equal(f.writes(),0)
})
test('multiple proposals never provide a sole current action',async()=>{
 const f=fixture(decision());await f.start('Resume ActionGatewayAcceptance');const p=f.latest();await f.chat.handle({op:'prepare',...p.context,targetId:'errand-recall',action:'scheduler.resume'})
 await f.start('Please help that job run again.');assert.equal(f.proposals(),2);assert.equal(f.received().prompt.currentAction,null);assert.equal(f.writes(),0)
})
test('semantic status reads saved result and undo only prepares a separately approved inverse',async()=>{
 let next=decision('status',{capability:'none',targetId:'none',referenceQuote:'',targetQuote:''});const f=fixture(()=>next)
 await f.start('Resume ActionGatewayAcceptance');const p=f.latest();await f.chat.handle({op:'present',...p.context,id:p.id,hash:p.hash});await f.start('確認剛才那個恢復方案')
 const r=await f.start('How did that operation turn out?');assert.equal(r.actionContinuation.state,'verified');assert.match(r.reply,/當時|recorded/)
 next=decision('restore',{capability:'none',targetId:'none',referenceQuote:'',targetQuote:''});const undo=await f.start('Can you undo what we just changed?')
 assert.equal(undo.actionContinuation.state,'awaiting_approval');assert.equal(f.latest().restoreOf,p.id);assert.equal(f.writes(),1)
})
test('unrelated topic falls through and cannot carry the old job into the next topic',async()=>{
 const f=fixture(decision('other'));await f.start('Resume ActionGatewayAcceptance');assert.equal(await f.start('Let us discuss payroll.'),null)
 f.conversations.appendTurn({id:f.cid,userText:'payroll',replyText:'payroll context'});assert.equal(f.chat.candidate('Help that job run again.',f.cid),false);assert.equal(f.writes(),0)
})
test('durable semantic replay avoids a second inference, proposal or cross-topic dispatch',async()=>{
 const f=fixture(decision('prepare',{targetQuote:'ActionGatewayAcceptance',referenceQuote:''})),id=randomUUID(),message='讓 ActionGatewayAcceptance 再次自動跑。'
 const original=await f.start(message,{requestId:id});f.conversations.appendTurn({id:f.cid,userText:'other',replyText:'other topic'})
 assert.equal(f.chat.candidate(message,f.cid,id),true);assert.equal((await f.start(message,{requestId:id})).replayed,true);assert.equal(f.calls(),1);assert.equal(f.proposals(),1)
 await assert.rejects(f.start(message,{requestId:id,effort:'high'}),/request_conflict/)
 const reopened=createChatGateway({request:f.request,receipts:f.receipts,conversations:f.conversations,providerFor:()=>{throw Error('no_new_inference')},semanticStore:f.memory(f.semantic),continuationStore:f.memory(f.requests)})
 assert.deepEqual((await reopened.start({message,conversationId:f.cid,requestId:id,model:MODEL,effort:'medium'})).investigation,original.investigation)
 f.semantic.get(id).state='interpreting';await assert.rejects(f.start(message,{requestId:id}),/action_unavailable/);assert.equal(f.writes(),0)
})
test('invalid provider output, timeout and conversation drift cannot prepare or execute',async()=>{
 for(const answer of [{...decision(),command:'arbitrary'},decision('prepare',{targetId:'arbitrary'}),()=>{throw Error('authentication_failed')},()=>new Promise(()=>{})]){
  const f=fixture(answer),id=randomUUID();await assert.rejects(f.start('Please resume that background job.',{requestId:id}));assert.equal(f.proposals(),0);assert.equal(f.writes(),0);assert.equal(f.semantic.get(id).state,'interrupted');await assert.rejects(f.start('Please resume that background job.',{requestId:id}));assert.equal(f.calls(),1)
 }
 const f=fixture(()=>{f.conversations.appendTurn({id:f.cid,userText:'other',replyText:'other'});return decision()});await f.start('Resume ActionGatewayAcceptance');await assert.rejects(f.start('Please help that job run again.'),/conversation_changed/);assert.equal(f.proposals(),1);assert.equal(f.writes(),0)
})
test('unsupported management requests report a boundary without a proposal or mutation',async()=>{
 const f=fixture(decision('unsupported',{targetId:'none',capability:'none',referenceQuote:''}));const r=await f.start('Stop the running background job and delete it.');assert.match(r.reply,/尚未接通|not connected/);assert.equal(f.proposals(),0);assert.equal(f.writes(),0)
})
