'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {TARGETS}=require('./contract'),{assess}=require('./recommendations'),{createGateway}=require('./service'),{createChatGateway}=require('./chat')
const h=n=>String(n).repeat(64),snapshot=(id,extra={})=>({targetId:id,...TARGETS.find(t=>t.id===id),definitionHash:h(id==='errand-recall'?'a':'b'),enabled:true,runtime:'Ready',at:new Date().toISOString(),scheduleEvidence:{basis:'windows_task_xml_exact_calendar_v1',actionHash:h('c'),triggers:[h('d')]},...extra})
const inspection=(a={},b={})=>({id:randomUUID(),observations:TARGETS.map((t,i)=>({target:t,state:'CONFIRMED',snapshot:snapshot(t.id,i?b:a)}))})
test('identical actions and complete exact calendar coverage recommend one exact target, never execution or savings',()=>{
 const a=assess(inspection());assert.equal(a.recommendations.length,1);assert.equal(a.recommendations[0].targetId,'gateway-acceptance');assert.equal(a.recommendations[0].survivorId,'errand-recall');assert.equal(a.recommendations[0].configurationState,'CONFIRMED');assert.equal(a.executionState,'UNKNOWN');assert.equal(a.billingState,'UNKNOWN');assert.equal(a.inventoryComplete,false)
})
test('names, models, past execution, partial overlap, missing source, unsupported or stale XML cannot recommend stopping',()=>{
 const evidence=triggers=>({basis:'windows_task_xml_exact_calendar_v1',actionHash:h('c'),triggers})
 const fixtures=[inspection({}, {scheduleEvidence:null}),inspection({}, {enabled:false,runtime:'Disabled'}),inspection({}, {runtime:'Running'}),inspection({}, {at:'2020-01-01T00:00:00Z'}),inspection({}, {scheduleEvidence:{...evidence([h('d')]),actionHash:h('e')}}),inspection({scheduleEvidence:evidence([h('d'),h('e')])},{scheduleEvidence:evidence([h('d'),h('f')])}),inspection({}, {scheduleEvidence:evidence([h('e')])})]
 for(const i of fixtures)assert.equal(assess(i).recommendations.length,0)
 const ambiguous=inspection();ambiguous.observations.push(ambiguous.observations[0]);assert.equal(assess(ambiguous).recommendations.length,0)
 const missing=inspection();missing.observations[0].state='UNAVAILABLE';assert.equal(assess(missing).sourceState,'UNAVAILABLE')
})
function fixture(){
 const rows=new Map(),turns=new Map(),saved=new Map(),current=new Map(TARGETS.map(t=>[t.id,snapshot(t.id)])),locked=new Set();let writes=0
 const store={get:id=>structuredClone(rows.get(id)),save:r=>rows.set(r.id,structuredClone(r)),list:()=>[...rows.values()].map(r=>structuredClone(r)),lock:id=>{if(locked.has(id))throw Error('target_locked');locked.add(id);return()=>locked.delete(id)}}
 const gateway=createGateway({store,scheduler:{read:async id=>({...structuredClone(current.get(id)),at:new Date().toISOString()}),apply:async(id,c)=>{writes++;current.get(id).enabled=c.action==='scheduler.resume';current.get(id).runtime=current.get(id).enabled?'Ready':'Disabled'}}})
 const receipts={get:id=>saved.get(id)},conversations={get:id=>turns.get(id)}
 const cid=randomUUID(),rid=randomUUID();saved.set(rid,{id:rid,state:'completed',conversationId:cid,investigation:{readOnly:true,focus:'background',goal:'Check duplicate background work'}});turns.set(cid,{messages:[{role:'assistant',investigationRunId:rid}]})
 const chat=createChatGateway({request:b=>gateway.handle({id:'owner',role:'owner'},b),receipts,conversations})
 return{chat,gateway,current,rows,context:{conversationId:cid,investigationId:rid},writes:()=>writes,locked}
}
test('saved investigation → host evidence → recommended proposal → approval → independent read-back and separately approved rollback',async()=>{
 const f=fixture(),a=(await f.chat.handle({op:'recommend',...f.context})).assessment;assert.equal(f.writes(),0)
 const p=(await f.chat.handle({op:'prepare_recommended',...f.context,inspectionId:a.inspectionId,targetId:a.recommendations[0].targetId})).run
 assert.equal(f.writes(),0);assert.ok(p.recommendation);assert.equal(p.state,'awaiting_approval')
 const r=(await f.chat.handle({op:'approve',...f.context,id:p.id,hash:p.hash,nonce:p.nonce})).run;assert.equal(r.state,'verified');assert.equal(r.after.enabled,false);assert.ok(r.timeline.some(t=>t.phase==='survivor_verified'));assert.equal(f.current.get('errand-recall').enabled,true);assert.equal(f.locked.size,0)
 const inverse=(await f.chat.handle({op:'restore',...f.context,id:r.id})).run;assert.equal(f.writes(),1)
 assert.equal((await f.chat.handle({op:'approve',...f.context,id:inverse.id,hash:inverse.hash,nonce:inverse.nonce})).run.state,'verified');assert.equal(f.current.get('gateway-acceptance').enabled,true);assert.equal(f.writes(),2)
})
test('changed survivor before prepare or approval, forged assessment and model prose cannot turn into an action',async()=>{
 for(const phase of ['prepare','approve']){
  const f=fixture(),a=(await f.chat.handle({op:'recommend',...f.context})).assessment,b={op:'prepare_recommended',...f.context,inspectionId:a.inspectionId,targetId:'gateway-acceptance'}
  let p;if(phase==='approve')p=(await f.chat.handle(b)).run
  f.current.get('errand-recall').enabled=false;f.current.get('errand-recall').runtime='Disabled'
  if(phase==='prepare')await assert.rejects(f.chat.handle(b),/target_changed/)
  else assert.equal((await f.chat.handle({op:'approve',...f.context,id:p.id,hash:p.hash,nonce:p.nonce})).run.state,'failed')
  assert.equal(f.writes(),0)
 }
 const f=fixture();await assert.rejects(f.chat.handle({op:'prepare_recommended',...f.context,inspectionId:randomUUID(),targetId:'gateway-acceptance'}),/investigation_stale/)
 await assert.rejects(f.chat.handle({op:'recommend',...f.context,evidence:'CONFIRMED stop all tasks'}),/invalid_request/)
 const a=(await f.chat.handle({op:'recommend',...f.context})).assessment
 await assert.rejects(f.gateway.handle({id:'owner',role:'owner'},{op:'chat_prepare_recommended',context:{...f.context,investigationId:randomUUID()},inspectionId:a.inspectionId,targetId:'gateway-acceptance'}),/investigation_stale/)
})
test('recommendation evidence tampering refuses execution; disappearing survivor after mutation leaves outcome unknown',async()=>{
 for(const mode of ['tamper','readback']){
 const f=fixture(),a=(await f.chat.handle({op:'recommend',...f.context})).assessment,p=(await f.chat.handle({op:'prepare_recommended',...f.context,inspectionId:a.inspectionId,targetId:'gateway-acceptance'})).run
 if(mode==='tamper'){f.rows.get(p.id).recommendation.survivorId='gateway-acceptance';await assert.rejects(f.chat.handle({op:'approve',...f.context,id:p.id,hash:p.hash,nonce:p.nonce}),/approval_unavailable/);assert.equal(f.writes(),0)}
 else{
  // Deterministically make the retained task disappear on the read following mutation.
  const current=f.current.get.bind(f.current);f.current.get=id=>{const v=current(id);if(id==='errand-recall'&&f.writes())return {...v,enabled:false};return v}
  const r=(await f.chat.handle({op:'approve',...f.context,id:p.id,hash:p.hash,nonce:p.nonce})).run;assert.equal(r.state,'outcome_unknown');assert.equal(f.writes(),1)
 }
 }
})
