'use strict'
// Real local HTTP router -> authenticated Bridge -> work service. Providers and
// source are deterministic fixtures; no production service or model is called.
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),{randomUUID}=require('node:crypto')
const {fixture,OWNER,NEW,ticket}=require('./recoveryFixture.cjs'),{createBridge}=require('../../subscription/bridge'),{createProjectRouter}=require('./routes')
test('HTTP recovery binds the host SHA, uses existing Bridge authentication and returns one same-ID completion',async t=>{
 const f=await fixture(t),token='d'.repeat(64),bridge=createBridge({token,projectWork:f.work}),app=express();app.use(express.json())
 await new Promise(r=>bridge.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{bridge.closeAllConnections();bridge.close(r)}))
 const bridgeUrl='http://127.0.0.1:'+bridge.address().port+'/project-work',sendBridge=(body,auth='Bearer '+token)=>fetch(bridgeUrl,{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(body)})
 app.use(createProjectRouter({bootCommit:NEW,env:{READ_ACCESS:'on'},request:async body=>(await sendBridge(body)).json()}));const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s))});t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const base='http://127.0.0.1:'+server.address().port,send=(body,origin='http://127.0.0.1:8090')=>new Promise((resolve,reject)=>{const req=require('node:http').request(base+'/api/v1/project-work',{method:'POST',headers:{host:'127.0.0.1:8090',origin,'content-type':'application/json'}},res=>{let text='';res.on('data',c=>{text+=c});res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(text)}))});req.on('error',reject);req.end(JSON.stringify(body))})
 const prepare={op:'prepareRecovery',id:f.failed.id,requestId:randomUUID()}
 assert.equal((await sendBridge({...prepare,bootCommit:NEW},'wrong')).status,401)
 assert.equal((await send(prepare,'http://evil.invalid')).status,403)
 assert.equal((await send({...prepare,bootCommit:'e'.repeat(40)})).status,400)
 assert.equal((await send({...prepare,command:'anything'})).status,400)
 const response=await send(prepare);assert.equal(response.status,200);const p=await response.json();assert.equal(p.run.recoveries[0].runtimeCommit,NEW);assert.equal(f.counts().coding,1)
 const approved=await send({op:'approveRecovery',...ticket(p)});assert.equal(approved.status,200);await f.work.settled();assert.equal(f.work.get(OWNER,f.failed.id).state,'completed')
 assert.equal((await send({op:'approveRecovery',...ticket(p)})).status,409);assert.equal(f.counts().coding,2);assert.equal(f.counts().reviews,1);assert.equal(f.budget.status(f.taskId).helper.reserved,8)
})
