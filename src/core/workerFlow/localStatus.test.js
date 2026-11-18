'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const boot='a'.repeat(40),profile=require('../../localBrain/deploymentProfile.json')
function receipt(){const at=new Date().toISOString();return{component:'controlled-dispatch',protocol:'controlled-repository-dispatch-v1',bootCommit:boot,checkedAt:at,state:'connected',inferenceStarted:false,requiresScopeApproval:true,requiresUsageApproval:true,requiresCodingApproval:true,cloudFallback:false,automaticDeployment:false,workerInference:'explicit_subscription_work_only',localCoding:{enabled:true,state:'connected',requiresSeparateApproval:true,automaticFallback:false,selection:{model:'local:'+profile.model,digest:profile.digest},isolation:{protocol:'sandbox-prerequisites-v1',source:'owner_bridge',bootCommit:boot,engine:'windows-sandbox-offline-v1',state:'ready',ready:true,reason:null,checkedAt:at,boundaryVerified:false,metadataOnly:true}}}}
test('local workbench reads only Bridge metadata and never equates prerequisites with guest isolation',async()=>{
 const {readLocalStatus}=require('./localStatus');let calls=0
 const r=await readLocalStatus({bootCommit:boot,request:async b=>{assert.deepEqual(b,{op:'status'});calls++;return receipt()},check:()=>assert.fail('backend OS probe forbidden')})
 assert.equal(calls,1);assert.equal(r.mode,'local');assert.equal(r.enabled,false);assert.equal(r.localCoding.state,'connected')
 assert.equal(r.isolation.ready,true);assert.equal(r.isolation.source,'owner_bridge');assert.equal(r.isolation.boundaryVerified,false)
 assert.equal(r.subscriptionVerified,false);assert.equal(r.executionAuthorized,false);assert.deepEqual(r.runs,[])
})
test('source, model, freshness or control drift cannot admit executor evidence',async()=>{
 const {readLocalStatus}=require('./localStatus')
 for(const mutate of [v=>v.bootCommit='b'.repeat(40),v=>v.checkedAt='2020-01-01',v=>delete v.localCoding,v=>v.localCoding.selection.digest='0'.repeat(64),v=>v.cloudFallback=true]){
  const v=receipt();mutate(v);const r=await readLocalStatus({bootCommit:boot,request:async()=>v})
  assert.equal(r.localCoding.state,'unavailable');assert.equal(r.isolation.ready,null);assert.equal(r.enabled,false)
 }
})
test('local HTTP reads avoid the legacy provider and all legacy POST operations remain blocked',async t=>{
 const express=require('express'),{createWorkerRouter}=require('./routes');let legacy=0,status=0
 const app=express();app.use(express.json());app.use(createWorkerRouter({env:{LOCAL_BRAIN_ONLY:'1'},request:async()=>{legacy++;throw Error('forbidden')},localStatus:async()=>{status++;return{mode:'local',enabled:false,runs:[]}}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const url='http://127.0.0.1:'+server.address().port
 const get=await fetch(url+'/api/v1/worker-flow');assert.equal(get.status,200);assert.equal((await get.json()).mode,'local');assert.equal(get.headers.get('cache-control'),'no-store')
 for(const op of ['start','review','status']){
  const statusCode=await new Promise((resolve,reject)=>{const r=require('node:http').request(url+'/api/v1/worker-flow',{method:'POST',headers:{host:'127.0.0.1:8090',origin:'http://127.0.0.1:8090','content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});r.on('error',reject);r.end(JSON.stringify({op}))})
  assert.equal(statusCode,503)
 }
 assert.equal(legacy,0);assert.equal(status,1)
})
test('rendered local workbench shows independent status, disables old actions and refreshes with GET only',async()=>{
 const vm=require('node:vm'),{buildWorkerHtml}=require('./view'),nodes=new Map(),requests=[]
 const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',checked:false});return nodes.get(id)}}
 let receiptValue={mode:'local',localCoding:{state:'connected'},isolation:{ready:true,boundaryVerified:false}}
 const script=buildWorkerHtml({localMode:true}).match(/<script>([\s\S]*?)<\/script>/)[1]
 vm.runInNewContext(script,{document,fetch:async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>receiptValue}},setInterval(){},console})
 await new Promise(r=>setImmediate(r));assert.equal(nodes.get('run').disabled,true);assert.equal(nodes.get('legacyControls').hidden,true)
 assert.equal(nodes.get('projectLink').href,'/project-tasks');assert.match(nodes.get('localState').textContent,/已連線/);assert.match(nodes.get('isolationState').textContent,/尚未/)
 receiptValue={mode:'local',localCoding:{state:'unavailable'},isolation:{ready:null}}
 await nodes.get('check').onclick();assert.match(nodes.get('isolationState').textContent,/未能核實/);assert.equal(nodes.get('run').disabled,true)
 receiptValue={mode:'local',localCoding:{state:'connected'},isolation:{ready:false,state:'busy'}}
 await nodes.get('check').onclick();assert.match(nodes.get('isolationState').textContent,/正在/);assert.equal(nodes.get('run').disabled,true)
 assert.equal(requests.length,3);assert.ok(requests.every(r=>!r.options?.method&&!r.options?.body))
})
