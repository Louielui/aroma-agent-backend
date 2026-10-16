'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),{randomUUID,createHash}=require('node:crypto')
async function fixture(t,mode='backend',shared=null,bridgePort=null){
 const directory=shared||fs.mkdtempSync(path.join(os.tmpdir(),'q-ingress-')),pending=new Map();let next=0,ready,executing
 const child=cp.fork(path.join(__dirname,'quiescenceProcess.fixture.cjs'),[directory,mode,...(bridgePort?[String(bridgePort)]:[])],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,NODE_PATH:process.env.NODE_PATH||'C:/Aroma/aroma-agent-backend/node_modules'}})
 let errors='';child.stderr.on('data',d=>errors+=d)
 const started=new Promise((resolve,reject)=>{ready=resolve;child.once('error',reject);child.once('exit',code=>reject(Error('fixture exited '+code+' '+errors)))})
 const startedExecuting=new Promise(resolve=>{executing=resolve})
 child.on('message',message=>{if(message.event==='ready')ready(message);else if(message.event==='executing')executing();else if(message.event==='fatal')ready(Promise.reject(Error(message.error)));else pending.get(message.id)?.(message)})
 const send=command=>new Promise(resolve=>{const id=++next;pending.set(id,result=>{pending.delete(id);resolve(result)});child.send({id,command})})
 t.after(async()=>{if(child.connected)await send('close');if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));if(!shared)fs.rmSync(directory,{recursive:true,force:true})})
 const info=await started
 const request=(route,body,method='POST',headers={})=>fetch('http://127.0.0.1:'+info.port+route,{method,headers:{authorization:'Bearer '+'a'.repeat(64),'content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})})
 return{directory,child,send,request,port:info.port,startedExecuting}
}
test('actual Direct Backend and Native Browser Read admissions are refused after draining, including GET side effects',async t=>{
 const f=await fixture(t)
 assert.equal((await f.request('/side-effect',null,'GET')).status,200)
 assert.equal((await f.send('prepare')).result.phase,'draining')
 assert.equal((await f.request('/side-effect',null,'GET')).status,503)
 assert.match((await f.send('native')).error,/deployment_draining/)
 const source={url:'https://example.com/',tabId:1,windowId:2,frameId:0,documentId:'fixture',capturedAt:new Date().toISOString(),contentHash:createHash('sha256').update('fixture').digest('hex'),truncated:false}
 assert.equal((await f.request('/api/v1/browser-read',{op:'prepare',requestId:randomUUID(),question:'Heading?',source})).status,503)
 assert.equal(fs.existsSync(path.join(f.directory,'data','reads')),false)
})
for(const route of ['/detached','/child'])test('admitted '+route+' retains lease until delayed final write; frozen rejects actual sync/async persistence bypass',async t=>{
 const f=await fixture(t)
 assert.equal((await f.request(route,{})).status,200)
 assert.equal((await f.send('prepare')).result.phase,'draining')
 assert.ok((await f.send('active')).result.leases.length>0)
 assert.match((await f.send('freeze')).error,/writers_not_drained/)
 for(let i=0;i<100&&(await f.send('active')).result.leases.length;i++)await new Promise(r=>setTimeout(r,20))
 assert.equal((await f.send('freeze')).result.phase,'frozen')
 assert.equal(fs.readFileSync(path.join(f.directory,'data',route.slice(1)),'utf8'),'finished')
 assert.match((await f.send('write')).error,/deployment_frozen/)
 assert.match((await f.send('async-write')).error,/deployment_frozen/)
  assert.match((await f.send('truncate-read')).error,/deployment_frozen/)
 assert.equal(fs.existsSync(path.join(f.directory,'data','bypass')),false)
})
test('actual Bridge dispatch is blocked during drain and cannot create an outcome',async t=>{
 const f=await fixture(t,'bridge');await f.send('prepare')
 assert.equal((await f.request('/complete',{prompt:'fixture'})).status,503)
 assert.equal(fs.existsSync(path.join(f.directory,'data','bridge')),false)
})
test('Native execution and its real child process finish before freeze without cancellation',async t=>{
 const f=await fixture(t,'native'),running=f.send('native');await f.startedExecuting
 await f.send('prepare');assert.match((await f.send('freeze')).error,/writers_not_drained/)
 assert.match((await f.send('native')).error,/deployment_draining/)
 assert.equal((await running).result.state,'completed')
 for(let i=0;i<100&&(await f.send('active')).result.leases.length;i++)await new Promise(r=>setTimeout(r,20))
 assert.equal((await f.send('freeze')).result.phase,'frozen')
 assert.equal(fs.readFileSync(path.join(f.directory,'data','report'),'utf8'),'finished')
 assert.equal(fs.readFileSync(path.join(f.directory,'data','native-input'),'utf8'),'input-finished')
})
test('business filesystem cannot modify Gate records or remove their parent directory even while open',async t=>{const f=await fixture(t);assert.equal((await f.send('control-write')).error,'deployment_control_path_forbidden');assert.equal((await f.send('delete-control-parent')).error,'deployment_control_path_forbidden');assert.equal(fs.existsSync(path.join(f.directory,'gate','gate.json')),true)})
test('real persisted pending Browser consent refuses freeze without cancellation or recovery mutation',async t=>{const f=await fixture(t),prepared=await f.send('native');assert.equal(prepared.result.state,'awaiting_consent');const file=path.join(f.directory,'data','reads',prepared.result.id+'.json'),before=fs.readFileSync(file);await f.send('prepare');assert.match((await f.send('freeze')).error,/participant_not_idle/);assert.deepEqual(fs.readFileSync(file),before)})
test('background interval writes while open, skips new ticks during drain and cannot mutate after freeze',async t=>{
 const f=await fixture(t,'background'),file=path.join(f.directory,'data','ticks')
 await new Promise(r=>setTimeout(r,80));assert.ok(fs.readFileSync(file,'utf8').length>0)
 await f.send('prepare')
 for(let i=0;i<100&&(await f.send('active')).result.leases.length;i++)await new Promise(r=>setTimeout(r,20))
 assert.equal((await f.send('freeze')).result.phase,'frozen');const before=fs.readFileSync(file)
 await new Promise(r=>setTimeout(r,100));assert.deepEqual(fs.readFileSync(file),before)
})
test('corrupt durable Gate state refuses HTTP and actual writes rather than falling back to open',async t=>{const f=await fixture(t);await f.send('corrupt');assert.equal((await f.request('/side-effect',null,'GET')).status,503);assert.match((await f.send('write')).error,/gate_integrity_unconfirmed/)})
test('Backend admitted before drain can finish through independently authenticated Bridge with a child lease',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'q-chain-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
 const bridge=await fixture(t,'bridge',directory),backend=await fixture(t,'backend',directory,bridge.port)
 const pending=backend.request('/chain',{});await backend.startedExecuting;await backend.send('prepare')
 assert.equal((await bridge.request('/complete',{prompt:'new request'})).status,503)
 assert.equal((await bridge.request('/complete',{prompt:'forged parent'},'POST',{'x-aroma-quiescence-lease':randomUUID()})).status,503)
 assert.equal((await pending).status,200)
 assert.equal(fs.readFileSync(path.join(directory,'data','chain'),'utf8'),'finished')
})
