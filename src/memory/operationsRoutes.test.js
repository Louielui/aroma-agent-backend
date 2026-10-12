'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs');const os=require('node:os');const path=require('node:path')
const {createApp}=require('../app')
const {createRuntime}=require('./runtime')
const {createTestStore}=require('./structuredStore')
const {createMemoryOperations}=require('./operations')
test('Owner can inspect a database outage without receiving a false empty catalogue; anonymous access denied',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memory-status-http-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const runtime=createRuntime({store:createTestStore(),engine:{},dir})
  runtime.gateway.status=async()=>{throw Error('provider-secret')}
  runtime.gateway.list=async()=>{throw Error('provider-secret')}
  const operations=createMemoryOperations({gateway:runtime.gateway,runtime,probe:async()=>({state:'unavailable',services:{bridge:{state:'unavailable'}}})})
  const app=createApp({ownerPassword:'test-owner',serviceToken:'test-owner-service',governedMemory:runtime,memoryOperations:operations,
    runPersistence:false,proposalPersistence:false,workerDeps:{artifactStore:null,runner:null}})
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
  const base='http://127.0.0.1:'+server.address().port
  assert.equal((await fetch(base+'/api/v1/memory/operations')).status,401)
  const headers={authorization:'Bearer test-owner-service'}
  const response=await fetch(base+'/api/v1/memory/operations',{headers})
  assert.equal(response.status,200)
  const result=await response.json();assert.equal(result.general.counts,null)
  assert.equal(result.services.bridge.state,'unavailable')
  assert.equal((await fetch(base+'/api/v1/memory/catalog',{headers})).status,503)
  assert.equal(JSON.stringify(result).includes('provider-secret'),false)
})

test('index rebuild and backup execution remain Owner-only same-origin operations',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memory-recovery-http-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const runtime=createRuntime({store:createTestStore(),engine:{},dir})
  let backups=0,rebuilds=0
  runtime.gateway.rebuildIndex=async(actor,scope)=>{assert.equal(actor.role,'owner');rebuilds++;return {queued:1,scope}}
  const recovery={status:()=>({state:'verified'}),run:async()=>{backups++;return {state:'verified'}}}
  const app=createApp({ownerPassword:'test-owner',serviceToken:'test-owner-service',governedMemory:runtime,memoryBackupScheduler:recovery,
    runPersistence:false,proposalPersistence:false,workerDeps:{artifactStore:null,runner:null}})
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
  const base='http://127.0.0.1:'+server.address().port
  const post=(body,origin='http://127.0.0.1:8090',authorization='Bearer test-owner-service',route='/api/v1/memory/catalog')=>new Promise((resolve,reject)=>{
    const req=require('node:http').request(base+route,{method:'POST',headers:{host:'127.0.0.1:8090',origin,authorization,'content-type':'application/json'}},res=>{
      let raw='';res.on('data',v=>{raw+=v});res.on('end',()=>resolve({status:res.statusCode,raw}))
    });req.on('error',reject);req.end(JSON.stringify(body))
  })
  assert.equal((await post({op:'rebuild_index'},undefined,'')).status,401)
  assert.equal((await post({op:'rebuild_index'},'https://evil.test')).status,403)
  assert.equal((await post({op:'rebuild_index',actor:'owner'})).status,400)
  assert.equal((await post({op:'rebuild_index',scope:'private:owner'})).status,200)
  assert.equal((await post({op:'backup'})).status,200)
  assert.equal(backups,1);assert.equal(rebuilds,1)
})
