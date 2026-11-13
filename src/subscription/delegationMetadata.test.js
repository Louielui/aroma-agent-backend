'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createBridge}=require('./bridge'),{validSnapshot}=require('../investigation/delegationEvidence')
const saved=require('../investigation/fixtures/delegationAudit.json')
test('delegation metadata keeps the existing auth/closed-input boundary and does not dispatch while a workflow is occupied',async t=>{
 let jobs=0,catalogueReads=0,descriptions=0
 const token='6'.repeat(64),server=createBridge({token,bootCommit:saved.runtime,
  completeFn:async()=>{jobs++;throw Error('must_not_complete')},claudeFn:async()=>{jobs++;throw Error('must_not_complete')},
  workerProviders:{describe:()=>{descriptions++;return[{id:'review',role:'Result review',model:'sonnet',effort:null,selection:'workflow_default',permissions:'supplied_packet_only'}]},status:async()=>{jobs++;throw Error('must_not_probe_sandbox')}},
  projectWork:{isActive:()=>true,catalogue:()=>({enabled:true,workOrders:saved.workflow.projects.workOrders}),prepare:()=>{jobs++;throw Error('must_not_prepare')}},
  modelsFn:async()=>{catalogueReads++;return{models:saved.models.models.filter(m=>m.provider==='openai')}},
  claudeModelsFn:async()=>{catalogueReads++;return{models:saved.models.models.filter(m=>m.provider==='claude')}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const send=(body,headers={})=>fetch('http://127.0.0.1:'+server.address().port+'/delegation-metadata',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:JSON.stringify(body)})
 assert.equal((await send({},{authorization:'bad'})).status,401)
 assert.equal((await send({},{origin:'http://foreign.test'})).status,401)
 assert.equal((await send({op:'start'})).status,400);assert.equal(catalogueReads,0)
 const response=await send({}),v=await response.json()
 assert.equal(response.status,200);assert.equal(validSnapshot(v),true)
 assert.equal(v.records[0].model,'sonnet');assert.equal(v.records[0].canAccept,null)
 assert.equal(v.records[0].authorization,'required_per_job');assert.equal(v.recipes.length,7)
 assert.equal(catalogueReads,2);assert.equal(descriptions,1);assert.equal(jobs,0)
 assert.equal(JSON.stringify(v).includes(token),false)
})
