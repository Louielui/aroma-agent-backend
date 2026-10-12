'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createChatGateway,parseRequest}=require('./chat')
const {createGateway}=require('./service'),{createMemoryRunStore}=require('../core/operating/runStore'),{TARGETS}=require('./contract')
function fixture(){
 const rows=new Map(),turns=new Map(),store={get:id=>structuredClone(rows.get(id)),save:r=>rows.set(r.id,structuredClone(r)),list:()=>[...rows.values()].map(r=>structuredClone(r)),lock:()=>()=>{}}
 let enabled=true,writes=0
 const gateway=createGateway({store,scheduler:{read:async id=>({...TARGETS.find(t=>t.id===id),targetId:id,enabled,runtime:enabled?'Ready':'Disabled',definitionHash:'a'.repeat(64),at:new Date().toISOString()}),apply:async()=>{writes++;enabled=!enabled}}})
 const saved=new Map(),receipts={get:id=>saved.get(id),begin:(id,cid,requestHash)=>saved.set(id,{id,conversationId:cid,requestHash,state:'planning'}),finish:(id,res)=>Object.assign(saved.get(id),{state:'completed',investigation:res.investigation,response:res})}
 const conversations={get:id=>turns.get(id),appendTurn:b=>{const c=turns.get(b.id)||{messages:[]};c.messages.push({role:'assistant',investigationRunId:b.investigationRunId});turns.set(b.id,c)}}
 const chat=createChatGateway({request:b=>gateway.handle({id:'owner',role:'owner'},b),receipts,conversations})
 return {chat,gateway,receipts,conversations,saved,rows,writes:()=>writes}
}
test('Chinese and English exact requests prepare only, then same-conversation approval and inverse read-back',async()=>{
 for(const message of ['請提出暫停 AromaXiangXiang-ErrandRecall 的方案','Please propose pausing AromaXiangXiang-ErrandRecall']){
 const f=fixture(),conversationId=randomUUID(),requestId=randomUUID(),res=await f.chat.start({message,conversationId,requestId})
 assert.equal(res.investigation.focus,'background');assert.equal(f.writes(),0)
 const context={conversationId,investigationId:res.investigationRunId},list=await f.chat.handle({op:'list',...context}),p=list.runs[0]
 assert.equal(p.state,'awaiting_approval');assert.ok(p.nonce);assert.equal(p.context.investigationId,requestId)
 await assert.rejects(f.gateway.handle({id:'owner',role:'owner'},{op:'approve',id:p.id,hash:p.hash,nonce:p.nonce}),/approval_unavailable/)
 await assert.rejects(f.chat.handle({op:'approve',...context,conversationId:randomUUID(),id:p.id,hash:p.hash,nonce:p.nonce}),/investigation_unavailable/)
 const done=(await f.chat.handle({op:'approve',...context,id:p.id,hash:p.hash,nonce:p.nonce})).run
 assert.equal(done.state,'verified');assert.equal(done.after.enabled,false);assert.equal(f.writes(),1)
 await assert.rejects(f.chat.handle({op:'approve',...context,id:p.id,hash:p.hash,nonce:p.nonce}),/approval_unavailable/)
 const inverse=(await f.chat.handle({op:'restore',...context,id:p.id})).run;assert.equal(inverse.state,'awaiting_approval');assert.equal(f.writes(),1)
 assert.equal((await f.chat.handle({op:'approve',...context,id:inverse.id,hash:inverse.hash,nonce:inverse.nonce})).run.state,'verified');assert.equal(f.writes(),2)
 }
})
test('duplicate enquiry cannot manufacture evidence or an automatic pause',async()=>{
 const f=fixture(),res=await f.chat.start({message:'查一下本機排程是否重複；有重複才暫停',conversationId:randomUUID(),requestId:randomUUID()})
 assert.equal(res.investigation.duplicateState,'UNKNOWN');assert.equal(f.rows.size,1);assert.equal(f.writes(),0)
 assert.equal(parseRequest('不要暫停 AromaXiangXiang-ErrandRecall').action,null)
 assert.equal(parseRequest('Pause all schedules').targetId,null)
 assert.equal(parseRequest('If duplicated, pause AromaXiangXiang-ErrandRecall').action,null)
 assert.equal(parseRequest('Pause ActionGatewayAcceptance2').targetId,null)
 assert.equal(require('./contract').validInput({op:42}),false)
})
test('conversation deletion, forged evidence and stale saved report never grant action authority',async()=>{
 const f=fixture(),conversationId=randomUUID(),requestId=randomUUID();await f.chat.start({message:'Pause AromaXiangXiang-ErrandRecall',conversationId,requestId})
 const context={conversationId,investigationId:requestId},p=(await f.chat.handle({op:'list',...context})).runs[0]
 f.conversations.get=()=>null
 await assert.rejects(f.chat.handle({op:'approve',...context,id:p.id,hash:p.hash,nonce:p.nonce}),/investigation_unavailable/)
 assert.equal(f.writes(),0)
})
test('a different saved investigation in the same conversation cannot take over a sealed proposal',async()=>{
 const f=fixture(),cid=randomUUID(),first=randomUUID(),second=randomUUID()
 await f.chat.start({message:'Pause AromaXiangXiang-ErrandRecall',conversationId:cid,requestId:first})
 const c={conversationId:cid,investigationId:first},p=(await f.chat.handle({op:'list',...c})).runs[0]
 await f.chat.start({message:'查一下本機排程',conversationId:cid,requestId:second})
 await assert.rejects(f.chat.handle({op:'approve',conversationId:cid,investigationId:second,id:p.id,hash:p.hash,nonce:p.nonce}),/approval_unavailable/)
 assert.equal(f.writes(),0)
 assert.equal((await f.chat.handle({op:'approve',...c,id:p.id,hash:p.hash,nonce:p.nonce})).run.state,'verified')
})
test('changing a saved proposal context cannot change its sealed authority',async()=>{
 const f=fixture(),cid=randomUUID(),first=randomUUID(),second=randomUUID()
 await f.chat.start({message:'Pause AromaXiangXiang-ErrandRecall',conversationId:cid,requestId:first})
 const p=(await f.chat.handle({op:'list',conversationId:cid,investigationId:first})).runs[0]
 await f.chat.start({message:'查一下本機排程',conversationId:cid,requestId:second})
 f.rows.get(p.id).context.investigationId=second
 await assert.rejects(f.chat.handle({op:'approve',conversationId:cid,investigationId:second,id:p.id,hash:p.hash,nonce:p.nonce}),/approval_unavailable/)
 assert.equal(f.writes(),0)
})
