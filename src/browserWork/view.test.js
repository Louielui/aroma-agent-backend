'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const model={model:'claude-opus-5-5',effort:'medium'},at='2026-10-14T17:00:00.000Z'
const read=(id,extra={})=>({id,workflow:'browser_context_read',question:'Fixture Browser question',state:'completed',selection:model,timeline:[{stage:'consent_consumed_before_dispatch',at},{stage:'answer_saved',at:'2026-10-14T17:00:09.000Z'}],result:{text:'Saved answer',actualModel:model.model,effort:model.effort},...extra})
function fixture(records=[],live=[],audit=[]){let calls=0;const originals=JSON.stringify({records,live,audit});const view=require('./view').createBrowserWork({reads:{all:()=>structuredClone(records)},operators:()=>structuredClone(live),audits:()=>structuredClone(audit),now:()=>Date.parse('2026-10-14T17:00:10Z')});return {view,records,live,audit,unchanged:()=>assert.equal(JSON.stringify({records,live,audit}),originals),dispatch:()=>++calls,get calls(){return calls}}}
test('Browser work observes the real native service without exposing input authority or mutating its jobs',async()=>{
 const events=[];let calls=0;const operator=require('../browserOperator/service').createOperator({companyId:17,env:{},now:()=>Date.parse(at),selection:()=>model,provider:()=>{calls++;throw Error('never_dispatch')},audit:e=>events.push(e)})
 const j=await operator.handle({op:'start',requestId:randomUUID(),question:'Native fixture question',consent:true,scope:{tabId:1,windowId:2,url:require('../browserOperator/service').FIXTURE,width:600,height:500}})
 const view=require('./view').createBrowserWork({reads:{all:()=>[]},operators:operator.inspectAll,audits:()=>events,now:()=>Date.parse(at)+2000})
 for(let i=0;i<3;i++){const detail=view.detail('operator',j.id);assert.equal(detail.latest.active,true);assert.equal(detail.latest.elapsedSeconds,2);assert.equal(detail.turns[0].question,'Native fixture question')}
 const snapshot=operator.inspectAll();snapshot[0].scope.tabId=999;assert.equal((await operator.handle({op:'get',id:j.id})).scope.tabId,1);assert.equal(calls,0);assert.equal(events.length,1)
 await operator.handle({op:'stop',id:j.id});assert.equal(view.detail('operator',j.id).latest.state,'stopped');assert.equal(view.detail('operator',j.id).latest.active,false)
})
test('Browser work audit reader fails visibly on malformed files and accounts for its bounded operation history',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'browser-work-audit-')),id=randomUUID(),reader=require('./view').createAuditReader(dir)
 const file=path.join(dir,randomUUID()+'.json');fs.writeFileSync(file,JSON.stringify({id,workflow:'browser_operator',stage:'owner_stopped',at:Date.parse(at)}));assert.equal(reader().length,1);fs.writeFileSync(file,'not-json');const view=require('./view').createBrowserWork({reads:{all:()=>[]},audits:reader});assert.deepEqual(view.list().unavailableSources,['audit'])
 const events=Array.from({length:102},(_,i)=>({id:randomUUID(),workflow:'browser_operator',stage:'owner_stopped',at:Date.parse(at)+i})),f=fixture([],[],events);assert.equal(f.view.list().topics.length,100);assert.equal(f.view.list().coverage.operatorJobs,102);assert.equal(f.view.list().coverage.operatorAuditLimited,true)
})
test('Browser work groups saved parent chains into independent topics and projects real phases without dispatch',()=>{
 const a=randomUUID(),b=randomUUID(),c=randomUUID(),f=fixture([read(a,{timeline:[{stage:'consent_consumed_before_dispatch',at:'2026-10-14T16:59:40Z'},{stage:'answer_saved',at:'2026-10-14T16:59:49Z'}]}),read(b,{parentId:a,question:'Fresh followup',state:'processing',result:undefined,timeline:[{stage:'consent_consumed_before_dispatch',at},{stage:'model_request_started',at}]}),read(c,{question:'Other tab'})])
 const list=f.view.list();assert.equal(list.topics.length,2);assert.equal(list.topics.find(t=>t.id===a).latest.id,b);assert.equal(list.topics.find(t=>t.id===a).title,'Fixture Browser question');assert.equal(list.topics.find(t=>t.id===a).latest.phase,'model_request_started');assert.equal(list.topics.find(t=>t.id===a).latest.elapsedSeconds,10)
 const detail=f.view.detail('read',a);assert.deepEqual(detail.turns.map(t=>t.id),[a,b]);assert.equal(detail.turns[0].answer.text,'Saved answer');assert.equal(detail.turns[1].answer,null);for(let i=0;i<3;i++)f.view.detail('read',a);assert.equal(f.calls,0);f.unchanged()
})
test('Browser work terminal clocks remain fixed and unknown or malformed evidence cannot claim active progress',()=>{
 const a=randomUUID(),b=randomUUID(),c=randomUUID(),f=fixture([read(a),read(b,{state:'failed',result:undefined,timeline:[{stage:'failed_no_retry',at}]}),read(c,{state:'processing',result:undefined,timeline:[{stage:'injected_fake_stage',at}]})]);const topics=f.view.list().topics
 assert.equal(topics.find(t=>t.id===a).latest.elapsedSeconds,9);assert.equal(topics.find(t=>t.id===a).latest.active,false);assert.equal(topics.find(t=>t.id===b).latest.elapsedSeconds,null);assert.equal(topics.find(t=>t.id===c).latest.phase,'unknown');assert.equal(topics.find(t=>t.id===c).latest.active,false);f.unchanged()
})
test('Browser work omits snapshots secrets tickets request hashes and private action data from both projections',()=>{
 const a=randomUUID(),b=randomUUID(),f=fixture([read(a,{requestId:'SECRET_REQUEST',requestHash:'SECRET_HASH',source:{origin:'https://app.7shifts.com',url:'SECRET_URL',urlHash:'SECRET_URL_HASH',contentHash:'SECRET_CONTENT',tabId:1,windowId:2},result:{text:'Saved answer',actualModel:model.model,billing:{secret:'SECRET_BILLING'},taskEvidence:{operation:'seven_shifts.employee_wages',complete:false}}})],[{id:b,question:'Operator fixture',state:'awaiting_input',selection:model,steps:2,scope:{url:'https://app.7shifts.com/company/17/employees/list',tabId:5,windowId:6,width:800,height:600},ticket:'SECRET_TICKET',frame:{image:'SECRET_SCREENSHOT'},history:[{text:'SECRET_PAGE'}]}])
 const json=JSON.stringify([f.view.list(),f.view.detail('read',a),f.view.detail('operator',b)]);assert.doesNotMatch(json,/SECRET_|contentHash|urlHash|ticket|billing|width|height/);assert.match(json,/Saved answer/);assert.match(json,/Operator fixture/);f.unchanged()
})
test('Browser work retains native audit status after restart without inventing lost questions or answers',()=>{
 const a=randomUUID(),b=randomUUID(),f=fixture([],[],[{id:a,workflow:'browser_operator',stage:'owner_started',at:Date.parse(at),model:model.model},{id:a,workflow:'browser_operator',stage:'answer_from_observation',at:Date.parse(at)+3000,step:2},{id:b,workflow:'browser_operator',stage:'vision_dispatched',at:Date.parse(at),step:1}])
 const complete=f.view.detail('operator',a);assert.equal(complete.latest.state,'completed');assert.equal(complete.turns[0].answer,null);assert.equal(complete.turns[0].question,null);assert.equal(complete.historyAvailable,false);assert.equal(complete.latest.elapsedSeconds,3)
 const lost=f.view.detail('operator',b);assert.equal(lost.latest.state,'unavailable');assert.equal(lost.latest.active,false);f.unchanged()
})
test('Browser work visibly reports unavailable stores and refuses broken parent chains instead of empty success',()=>{
 const f=require('./view').createBrowserWork({reads:{all:()=>{throw Error('SECRET_PATH')}},operators:()=>[],audits:()=>[]});assert.deepEqual(f.list().unavailableSources,['read']);assert.throws(()=>f.detail('read',randomUUID()),/browser_work_unavailable/)
 const a=randomUUID(),broken=fixture([read(a,{parentId:randomUUID()})]);assert.deepEqual(broken.view.list().unavailableSources,['read']);assert.throws(()=>broken.view.detail('read',a),/browser_work_unavailable/)
})
test('Browser work exposes only authenticated Owner GET routes and observes the same source without executing jobs',async t=>{
 const express=require('express'),app=express(),a=randomUUID(),f=fixture([read(a)]);app.locals.conversationDemo=true;app.locals.ownerSessions={valid:id=>id==='fixture-owner'};app.use(require('./routes').createRouter({view:f.view}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port+'/api/v1/demo/browser-work',cookie=require('../governance/ownerAuth').SESSION_COOKIE+'=fixture-owner'
 for(const headers of [{},{authorization:'Bearer fixture-service'},{cookie,origin:'https://evil.example'},{cookie,'sec-fetch-site':'cross-site'}])assert.equal((await fetch(base,{headers})).status,403)
 assert.equal((await fetch(base,{headers:{cookie}})).status,200);const detail=await fetch(base+'/read/'+a,{headers:{cookie}}).then(r=>r.json());assert.equal(detail.turns[0].answer.text,'Saved answer')
 for(const method of ['POST','PUT','DELETE'])assert.equal((await fetch(base+'/read/'+a,{method,headers:{cookie}})).status,405)
 assert.equal((await fetch(base+'/read/not-an-id',{headers:{cookie}})).status,400);assert.equal((await fetch(base+'?execute=true',{headers:{cookie}})).status,400);app.locals.conversationDemo=false;assert.equal((await fetch(base,{headers:{cookie}})).status,403);f.unchanged();assert.equal(f.calls,0)
})
