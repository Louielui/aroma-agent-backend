'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {createGateway}=require('./service'),{createStore}=require('./store'),{TARGETS}=require('./contract')
const {createOwnerApprovalStore}=require('../agent/ownerApprovalStore')
test('after bridge loss, read-back observes the exact target without replay, new approval or causality claims',async t=>{
 let release=null;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'action-recovery-'));t.after(()=>{if(release)release();fs.rmSync(dir,{recursive:true,force:true})})
 const store=createStore({dir});let enabled=false,writes=0,offline=false,time=Date.now(),definitionHash='a'.repeat(64),runtime=null,readAt=null
 const scheduler={read:async id=>{if(offline)throw Error('scheduler_unavailable');return {...TARGETS.find(v=>v.id===id),targetId:id,enabled,runtime:runtime||(enabled?'Ready':'Disabled'),definitionHash,at:new Date(readAt||time).toISOString()}},apply:async()=>{writes++;enabled=true;offline=true;throw Error('reply_lost')}}
 const make=()=>createGateway({store,scheduler,now:()=>time,approvals:createOwnerApprovalStore({now:()=>time})}),actor={id:'owner',role:'owner'}
 let g=make();const i=(await g.handle(actor,{op:'inspect'})).inspection,p=(await g.handle(actor,{op:'prepare',inspectionId:i.id,targetId:'gateway-acceptance',action:'scheduler.resume'})).run
 assert.equal((await g.handle(actor,{op:'approve',id:p.id,hash:p.hash,nonce:p.nonce})).run.state,'outcome_unknown')
 g=make();offline=false;time+=1000
 const r=(await g.handle(actor,{op:'reconcile',id:p.id})).run
 assert.equal(r.state,'outcome_unknown');assert.equal(r.currentReadback.state,'MATCHES_DESIRED');assert.equal(r.currentReadback.provesOriginalExecution,false);assert.equal(r.currentReadback.snapshot.enabled,true)
 assert.equal(writes,1);assert.equal(r.timeline.filter(e=>e.phase==='dispatched').length,1)
 await assert.rejects(g.handle(actor,{op:'restore',id:p.id}),/rollback_unavailable/)
 await assert.rejects(g.handle(actor,{op:'approve',id:p.id,hash:p.hash,nonce:p.nonce}),/approval_unavailable/)
 offline=true;time+=1000;const lost=(await g.handle(actor,{op:'reconcile',id:p.id})).run
 assert.equal(lost.currentReadback.state,'UNAVAILABLE');assert.equal(lost.currentReadback.snapshot,undefined);assert.equal(writes,1)
 offline=false;enabled=false;assert.equal((await g.handle(actor,{op:'reconcile',id:p.id})).run.currentReadback.state,'DIFFERS_FROM_DESIRED')
 definitionHash='b'.repeat(64);assert.equal((await g.handle(actor,{op:'reconcile',id:p.id})).run.currentReadback.state,'DEFINITION_CHANGED')
 definitionHash='a'.repeat(64);runtime='Running';assert.equal((await g.handle(actor,{op:'reconcile',id:p.id})).run.currentReadback.state,'NOT_IDLE')
 readAt=time-31000;assert.equal((await g.handle(actor,{op:'reconcile',id:p.id})).run.currentReadback.state,'UNAVAILABLE');readAt=null;runtime=null
 release=store.lock('gateway-acceptance')
 const durable=store.get(p.id);durable.state='executing';store.save(durable)
 assert.equal((await g.handle(actor,{op:'reconcile',id:p.id})).run.state,'outcome_unknown')
 assert.ok(fs.existsSync(path.join(dir,'gateway-acceptance.lock')));assert.equal(writes,1)
 await assert.rejects(g.handle({id:'model',role:'owner'},{op:'reconcile',id:p.id}),/owner_required/)
 durable.hash='0'.repeat(64);store.save(durable);await assert.rejects(g.handle(actor,{op:'reconcile',id:p.id}),/reconciliation_unavailable/)
})
