'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http')
const { createApp } = require('../app')
const { createDemoRouter } = require('../routes/demoRouter')
const express = require('express'), { randomUUID } = require('node:crypto')
const pack = { state:'ok',source:'drive',sourceId:'rootDrive',count:1,layer:'knowledge',sensitivity:'private',retrievedAt:'2026-10-01T19:00:00.000Z',
  content:[{sourceId:'sop',title:'Fixture SOP',originalDate:'2026-09-29T15:20:00.000Z',link:'https://drive.google.com/file/d/sop/view',fields:{mimeType:'text/plain',contentState:'metadata_only'},content:''}],
  coverage:{scope:'shared drive rootDrive: first 25 fullText matches',complete:false,truncated:true,excluded:0},contentPolicy:'data_only' }
function post(server,url,body,{token,origin='http://127.0.0.1:8090'}={}) {
  return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method:'POST',headers:{host:'127.0.0.1:8090',origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})}},res=>{
    let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(raw)}))});r.on('error',reject);r.end(JSON.stringify(body))})
}
test('official Drive page and all operations are Owner-gated; scope expansion is refused before reads',async t=>{
  const reads=[]
  const service={read:async()=>{},capabilities:()=>[],activity:()=>[],drive:{describe:()=>({name:'Company root',rootId:'rootDrive'}),
    read:async(actor,operation,input)=>{reads.push({actor,operation,input});return {pack,modelCalls:0}}}}
  const app=createApp({ownerPassword:'fixture-owner',serviceToken:'fixture-service',runPersistence:false,proposalPersistence:false,
    workerDeps:{artifactStore:null,runner:null},liveContext:service})
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
  const base='http://127.0.0.1:'+server.address().port
  assert.equal((await fetch(base+'/drive-context')).status,401)
  const page=await fetch(base+'/drive-context',{headers:{authorization:'Bearer fixture-service'}})
  assert.equal(page.status,200);assert.match(await page.text(),/api\/v1\/live-context\/drive/);assert.equal(reads.length,0)
  assert.equal((await post(server,'/api/v1/live-context/drive',{operation:'list',input:{}})).status,401)
  assert.equal((await post(server,'/api/v1/live-context/drive',{operation:'list',input:{}},{token:'fixture-service',origin:'https://evil.test'})).status,403)
  for(const b of [{operation:'write',input:{}},{operation:'list',input:{driveId:'other'}},{operation:'get',input:{fileId:'https://evil.test/'}},{operation:'search',input:{q:'raw query'}},{operation:'list',input:{},actor:'owner'}]) assert.equal((await post(server,'/api/v1/live-context/drive',b,{token:'fixture-service'})).status,400)
  assert.equal(reads.length,0)
  const result=await post(server,'/api/v1/live-context/drive',{operation:'search',input:{query:'SOP'}},{token:'fixture-service'})
  assert.equal(result.status,200);assert.equal(result.value.pack.content[0].sourceId,'sop');assert.equal(reads[0].actor.role,'owner');assert.equal(reads[0].input.query,'SOP')
})
test('complete Drive search chat uses measured context and saves once without model execution',async t=>{
  const saved=[];let reads=0,models=0
  const app=express();app.locals.conversationDemo=true;app.use(express.json());app.use(createDemoRouter({liveContext:{drive:{read:async()=>{reads++;return {pack,modelCalls:0}}}},
    conversationStore:{appendTurn:v=>saved.push(v)},getAdapterFn:()=>{models++;throw Error('model_must_not_run')}}))
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
  const body={message:'香香，搜尋公司文件：SOP',conversationId:'drive-context-fixture',workflowRequestId:randomUUID()}
  const result=await post(server,'/api/v1/demo/intake',body)
  assert.equal(result.status,200);assert.equal(result.value.mode,'chat');assert.equal(result.value.driveContext.pack.content[0].sourceId,'sop')
  assert.match(result.value.reply,/Fixture SOP/);assert.match(result.value.reply,/2026-09-29/);assert.match(result.value.reply,/部分/)
  assert.equal(saved.length,1);assert.equal(models,0);assert.equal(reads,1)
  await post(server,'/api/v1/demo/intake',body);assert.equal(saved.length,1);assert.equal(reads,1)
})
