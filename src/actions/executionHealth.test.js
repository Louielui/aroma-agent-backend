'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {readHealth,supervisorEvidence}=require('./executionHealth'),{createBridge}=require('../subscription/bridge')
test('health requires a fresh authenticated live response; prior ready data cannot survive refusal, stale replies or missing config',async()=>{
 const env={CODEX_CHAT_BRIDGE_TOKEN:'a'.repeat(64)},time=Date.now();let offline=false,calls=0
 const request=async(route,b)=>{assert.equal(route,'/execution-health');assert.deepEqual(b,{});calls++;if(offline)throw Error('password=secret');return{component:'execution-bridge',state:'ready',checkedAt:new Date(time).toISOString(),pid:123}}
 assert.equal((await readHealth({env,request,now:()=>time})).state,'ready');offline=true
 const lost=await readHealth({env,request,now:()=>time});assert.equal(lost.state,'unavailable');assert.ok(!JSON.stringify(lost).includes('secret'))
 offline=false;assert.equal((await readHealth({env,request,now:()=>time+31000})).state,'unavailable')
 assert.equal((await readHealth({env:{},request})).reason,'not_configured');assert.equal(calls,3)
})
test('supervisor ready evidence requires fresh heartbeat and both live processes, with closed exit facts',()=>{
 const time=Date.now(),s={component:'bridge',state:'ready',checkedAt:new Date(time).toISOString(),pid:123,supervisorPid:122,starts:2,lastExit:{at:new Date(time).toISOString(),code:17,stderr:'secret'}}
 const options={read:()=>JSON.stringify(s),now:()=>time,alive:()=>true}
 assert.equal(supervisorEvidence(options).state,'ready');assert.ok(!JSON.stringify(supervisorEvidence(options)).includes('secret'))
 assert.equal(supervisorEvidence({...options,alive:pid=>pid!==122}).state,'unknown')
 assert.equal(supervisorEvidence({...options,now:()=>time+31000}).state,'unknown')
 s.checkedAt=new Date(time+1).toISOString();assert.equal(supervisorEvidence(options).state,'unknown')
})
test('live health route is authenticated, closed and independent of occupied inference with zero extra provider calls',async t=>{
 const token='a'.repeat(64);let release,calls=0
 const server=createBridge({token,completeFn:async()=>{calls++;return new Promise(r=>{release=r})}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const send=(route,body,headers={})=>fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:JSON.stringify(body)})
 const pending=send('/complete',{prompt:'fixture'});while(!release)await new Promise(r=>setImmediate(r))
 try{
  assert.equal((await send('/execution-health',{}, {authorization:'bad'})).status,401)
  assert.equal((await send('/execution-health',{}, {origin:'http://evil'})).status,401)
  assert.equal((await send('/execution-health',{command:'anything'})).status,400)
  const health=await send('/execution-health',{});assert.equal(health.status,200);assert.equal((await health.json()).component,'execution-bridge');assert.equal(calls,1)
 }finally{release({output:'fixture'});await pending}
})
