'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {createGateway}=require('../../actions/service'),{createChatGateway}=require('../../actions/chat'),{TARGETS}=require('../../actions/contract'),goals=require('./ownerGoal')
test('whole-goal evidence follows the real existing Action Gateway displayed approval and readback, not model status or an older approval',async()=>{
 let writes=0;const rows=new Map(),requests=new Map(),enabled=new Map(TARGETS.map(t=>[t.id,false])),memory=map=>({get:id=>structuredClone(map.get(id)),save:r=>map.set(r.id,structuredClone(r)),list:()=>[...map.values()].map(v=>structuredClone(v)),lock:()=>()=>{}})
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-goal-gateway-')),conversations=require('../../store/conversationStore').createConversationStore({dir:path.join(dir,'conversations')}),receipts=require('../../investigation/receipts').createReceipts({dir:path.join(dir,'receipts')})
 const gateway=createGateway({store:memory(rows),scheduler:{read:async id=>({...TARGETS.find(t=>t.id===id),targetId:id,enabled:enabled.get(id),runtime:enabled.get(id)?'Ready':'Disabled',definitionHash:'a'.repeat(64),at:new Date().toISOString()}),apply:async id=>{writes++;enabled.set(id,!enabled.get(id))}}})
 let semanticIntent='clarify'
 const chat=createChatGateway({request:b=>gateway.handle({id:'owner',role:'owner'},b),receipts,conversations,continuationStore:memory(requests),providerFor:({model})=>({complete:async()=>({model,billing:require('../../subscription/chatModels').billingFor(model),text:JSON.stringify({intent:semanticIntent,targetId:'none',capability:'none',targetQuote:'',referenceQuote:''})})})}),cid=randomUUID(),start=message=>chat.start({message,conversationId:cid,requestId:randomUUID()})
 const prepared=await start('Resume ActionGatewayAcceptance');assert.equal(writes,0);assert.equal(prepared.ownerGoal.status,'GOAL_PENDING')
 const first=[...rows.values()].at(-1);assert.equal(first.state,'awaiting_approval')
 for(const message of ['ok','好','Tell me what you need']){const clarification=await start(message);assert.equal(clarification.ownerGoal.goalId,prepared.ownerGoal.goalId);assert.deepEqual(clarification.ownerGoal.outcomes[0].executionBinding,prepared.ownerGoal.outcomes[0].executionBinding);assert.equal(writes,0)}
 const prematureRestore=await start('Restore the previous schedule');assert.equal(prematureRestore.ownerGoal.goalId,prepared.ownerGoal.goalId);assert.deepEqual(prematureRestore.ownerGoal.outcomes[0].executionBinding,prepared.ownerGoal.outcomes[0].executionBinding);assert.equal(writes,0)
 const undisplayed=await start('I confirm the previous resume proposal');assert.equal(writes,0);assert.notEqual(undisplayed.ownerGoal.status,'GOAL_COMPLETED')
 await chat.handle({op:'present',conversationId:cid,investigationId:first.context.investigationId,id:first.id,hash:first.hash})
 const complete=await start('I confirm the previous resume proposal');assert.equal(writes,1);assert.equal(complete.ownerGoal.status,'GOAL_COMPLETED')
 assert.equal(complete.ownerGoal.outcomes[0].completionEvidence[0].receiptId,first.id)
 assert.equal(conversations.get(cid).messages.at(-1).ownerGoal.status,'GOAL_COMPLETED')
 const stored=[...rows.values()].find(r=>r.id===first.id)
 for(const bad of [{...stored,state:'completed'},{...stored,hash:'b'.repeat(64)},{...stored,after:{...stored.after,definitionHash:'b'.repeat(64)}}])assert.notEqual(goals.applyGatewayEvidence(prepared.ownerGoal,bad).status,'GOAL_COMPLETED')
 const inverse=await start('Restore the previous schedule');assert.notEqual(inverse.ownerGoal.goalId,complete.ownerGoal.goalId);assert.notEqual(inverse.ownerGoal.status,'GOAL_COMPLETED');assert.equal(writes,1)
 const second=[...rows.values()].at(-1);assert.notEqual(second.hash,first.hash)
 await chat.handle({op:'present',conversationId:cid,investigationId:second.context.investigationId,id:second.id,hash:second.hash})
 const restored=await start('I confirm the previous pause proposal');assert.equal(writes,2);assert.equal(restored.ownerGoal.status,'GOAL_COMPLETED')
 semanticIntent='restore';const freeRestore=await start('put it back');assert.equal(freeRestore.ownerGoal.goalId,restored.ownerGoal.goalId);assert.deepEqual(freeRestore.ownerGoal.outcomes[0].completionEvidence,restored.ownerGoal.outcomes[0].completionEvidence);assert.equal(writes,2);assert.equal([...rows.values()].at(-1).restoreOf,second.id)
})
test('a verified scheduler effect cannot complete an attached cart step or ambiguous compound objective',()=>{
 for(const objective of ['Resume ActionGatewayAcceptance and add Costco items to the cart','Resume ActionGatewayAcceptance; 不要下單，只放進購物車','Resume ActionGatewayAcceptance with Costco cart items added']){
  const goal=goals.createGoal({objective,requestId:'compound-fixture'}),run={id:'fixture-run',hash:'a'.repeat(64),state:'awaiting_approval',capability:'scheduler.resume',target:TARGETS[1],context:{investigationId:goal.requestId}}
  const bound=goals.bindGatewayGoal(goal,run),done=goals.applyGatewayEvidence(bound,{...run,state:'verified',expected:{definitionHash:'b'.repeat(64)},after:{definitionHash:'b'.repeat(64),enabled:true,runtime:'Ready'},timeline:[{phase:'verified'}]})
  assert.notEqual(done.status,'GOAL_COMPLETED');assert.equal(done.originalObjective,objective)
  if(goal.outcomes.length>1){assert.equal(done.status,'GOAL_PARTIAL');assert.equal(done.outcomes[0].status,'COMPLETED_WITH_EVIDENCE');assert.ok(done.outcomes.slice(1).every(o=>o.status!=='COMPLETED_WITH_EVIDENCE'))}
 }
})
test('read coverage and revocation stay distinct from verified whole-outcome completion',()=>{
 const g=goals.refineGoal(goals.createGoal({objective:'Read all records',requestId:'read-one'}),[{ownerQuote:'Read all records',capability:'aroma_system.read',kind:'read'}])
 const failed=goals.observeReads(g,{perSource:[{source:'aroma_system',trust:'unavailable'}],evidenceSets:[]});assert.equal(failed.outcomes[0].status,'BLOCKED')
 const partial=goals.observeReads(g,{perSource:[{source:'aroma_system',trust:'live'}],evidenceSets:[{source:'aroma_system',completeness:'sample'}]});assert.equal(partial.outcomes[0].status,'BLOCKED')
 const available=goals.observeReads(g,{perSource:[{source:'aroma_system',trust:'live'}],evidenceSets:[{source:'aroma_system',completeness:'complete'}]});assert.equal(available.outcomes[0].status,'AVAILABLE');assert.notEqual(available.status,'GOAL_COMPLETED')
})
test('semantic prepare cannot replace a compound Owner goal with an unbound follow-up goal',async()=>{
 let enabled=false,writes=0;const rows=new Map(),requests=new Map(),memory=m=>({get:id=>structuredClone(m.get(id)),save:r=>m.set(r.id,structuredClone(r)),list:()=>[...m.values()].map(v=>structuredClone(v)),lock:()=>()=>{}}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-goal-prepare-')),conversations=require('../../store/conversationStore').createConversationStore({dir:path.join(dir,'conversations')}),receipts=require('../../investigation/receipts').createReceipts({dir:path.join(dir,'receipts')})
 const gateway=createGateway({store:memory(rows),scheduler:{read:async id=>({...TARGETS.find(t=>t.id===id),targetId:id,enabled,runtime:enabled?'Ready':'Disabled',definitionHash:'a'.repeat(64),at:new Date().toISOString()}),apply:async()=>{writes++;enabled=!enabled}}})
 const target=TARGETS.find(t=>t.taskName==='ActionGatewayAcceptance'),cid=randomUUID(),chat=createChatGateway({request:b=>gateway.handle({id:'owner',role:'owner'},b),receipts,conversations,continuationStore:memory(requests),providerFor:({model})=>({complete:async()=>({model,billing:require('../../subscription/chatModels').billingFor(model),text:JSON.stringify({intent:'prepare',targetId:target.id,capability:'scheduler.pause',targetQuote:'',referenceQuote:'go ahead'})})})}),start=message=>chat.start({message,conversationId:cid,requestId:randomUUID()})
 const original=await start('Resume ActionGatewayAcceptance; add Costco items to the cart'),first=[...rows.values()].at(-1)
 await chat.handle({op:'present',conversationId:cid,investigationId:first.context.investigationId,id:first.id,hash:first.hash})
 const partial=await start('I confirm the previous resume proposal');assert.equal(partial.ownerGoal.status,'GOAL_PARTIAL');assert.equal(writes,1)
 const prepared=await start('go ahead and prepare the pause'),second=[...rows.values()].at(-1)
 assert.notEqual(second.id,first.id);assert.equal(second.state,'awaiting_approval');assert.equal(second.capability,'scheduler.pause');assert.equal(writes,1)
 assert.equal(prepared.ownerGoal.goalId,original.ownerGoal.goalId);assert.deepEqual(prepared.ownerGoal,partial.ownerGoal);assert.equal(conversations.get(cid).messages.at(-1).ownerGoal.originalObjective,original.ownerGoal.originalObjective)
 const undisplayed=await start('I confirm the previous pause proposal');assert.equal(writes,1);assert.equal(undisplayed.ownerGoal.status,'GOAL_PARTIAL')
 await chat.handle({op:'present',conversationId:cid,investigationId:second.context.investigationId,id:second.id,hash:second.hash})
 const done=await start('I confirm the previous pause proposal');assert.equal(writes,2);assert.equal(done.ownerGoal.status,'GOAL_PARTIAL');assert.equal(done.ownerGoal.outcomes[1].status,'UNAVAILABLE')
 const inverse=await start('Restore the previous schedule'),third=[...rows.values()].at(-1);assert.equal(inverse.ownerGoal.goalId,original.ownerGoal.goalId);assert.equal(third.restoreOf,second.id)
 await chat.handle({op:'present',conversationId:cid,investigationId:third.context.investigationId,id:third.id,hash:third.hash})
 const undone=await start('I confirm the previous resume proposal');assert.equal(writes,3);assert.equal(undone.ownerGoal.status,'GOAL_PARTIAL');assert.equal(undone.ownerGoal.outcomes[1].status,'UNAVAILABLE');assert.equal(undone.ownerGoal.originalObjective,original.ownerGoal.originalObjective)
})
test('a transient conversation read failure releases the existing gateway lock and permits a safe prepare retry',async()=>{
 const rows=new Map(),memory=m=>({get:id=>structuredClone(m.get(id)),save:r=>m.set(r.id,structuredClone(r)),list:()=>[...m.values()].map(v=>structuredClone(v)),lock:()=>()=>{}}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-goal-lock-')),base=require('../../store/conversationStore').createConversationStore({dir:path.join(dir,'conversations')}),receipts=require('../../investigation/receipts').createReceipts({dir:path.join(dir,'receipts')})
 let fail=true;const conversations={...base,get:id=>{if(fail){fail=false;throw Error('EBUSY')}return base.get(id)}}
 const gateway=createGateway({store:memory(rows),scheduler:{read:async id=>({...TARGETS.find(t=>t.id===id),targetId:id,enabled:false,runtime:'Disabled',definitionHash:'a'.repeat(64),at:new Date().toISOString()}),apply:async()=>{throw Error('unexpected_execution')}}}),chat=createChatGateway({request:b=>gateway.handle({id:'owner',role:'owner'},b),receipts,conversations,continuationStore:memory(new Map())}),input={message:'Resume ActionGatewayAcceptance',conversationId:randomUUID(),requestId:randomUUID()}
 await assert.rejects(chat.start(input),/EBUSY/);const retry=await chat.start(input);assert.equal(retry.ownerGoal.status,'GOAL_PENDING');assert.equal([...rows.values()].at(-1).state,'awaiting_approval')
})
test('restoring a verified child action retains every unresolved outcome of its compound Owner goal',async()=>{
 let enabled=false;const rows=new Map(),memory=m=>({get:id=>structuredClone(m.get(id)),save:r=>m.set(r.id,structuredClone(r)),list:()=>[...m.values()].map(v=>structuredClone(v)),lock:()=>()=>{}}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-goal-partial-inverse-')),conversations=require('../../store/conversationStore').createConversationStore({dir:path.join(dir,'conversations')}),receipts=require('../../investigation/receipts').createReceipts({dir:path.join(dir,'receipts')})
 const gateway=createGateway({store:memory(rows),scheduler:{read:async id=>({...TARGETS.find(t=>t.id===id),targetId:id,enabled,runtime:enabled?'Ready':'Disabled',definitionHash:'a'.repeat(64),at:new Date().toISOString()}),apply:async()=>{enabled=!enabled}}}),chat=createChatGateway({request:b=>gateway.handle({id:'owner',role:'owner'},b),receipts,conversations,continuationStore:memory(new Map())}),cid=randomUUID(),start=message=>chat.start({message,conversationId:cid,requestId:randomUUID()}),present=run=>chat.handle({op:'present',conversationId:cid,investigationId:run.context.investigationId,id:run.id,hash:run.hash})
 const original=await start('Resume ActionGatewayAcceptance; add Costco items to the cart');await present([...rows.values()].at(-1));const partial=await start('I confirm the previous resume proposal');assert.equal(partial.ownerGoal.status,'GOAL_PARTIAL')
 const inverse=await start('Restore the previous schedule');assert.equal(inverse.ownerGoal.goalId,original.ownerGoal.goalId);assert.equal(inverse.ownerGoal.outcomes.length,2);await present([...rows.values()].at(-1))
 const restored=await start('I confirm the previous pause proposal');assert.equal(restored.ownerGoal.goalId,original.ownerGoal.goalId);assert.equal(restored.ownerGoal.status,'GOAL_PARTIAL');assert.equal(restored.ownerGoal.outcomes[1].status,'UNAVAILABLE');assert.match(restored.reply,/Costco/);assert.equal(restored.ownerGoal.originalObjective,original.ownerGoal.originalObjective)
})
