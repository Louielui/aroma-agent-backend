'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),BOOT='a'.repeat(40),profile=require('../../localBrain/deploymentProfile.json')
function receipt(){const at=new Date().toISOString();return{component:'controlled-dispatch',protocol:'controlled-repository-dispatch-v1',bootCommit:BOOT,checkedAt:at,state:'connected',inferenceStarted:false,requiresScopeApproval:true,requiresUsageApproval:true,requiresCodingApproval:true,cloudFallback:false,automaticDeployment:false,workerInference:'explicit_subscription_work_only',localCoding:{enabled:true,state:'connected',requiresSeparateApproval:true,automaticFallback:false,selection:{model:'local:'+profile.model,digest:profile.digest},isolation:{protocol:'sandbox-prerequisites-v1',source:'owner_bridge',bootCommit:BOOT,engine:'windows-sandbox-offline-v1',state:'ready',ready:true,reason:null,checkedAt:at,boundaryVerified:false,metadataOnly:true}}}}
test('real backend fence stays installed while local status consumes only closed Bridge metadata',async()=>{
 const fence=require('../../localBrain/productionFence'),audit=[],restore=fence.install({audit:e=>audit.push(e)})
 try{const r=await require('./localStatus').readLocalStatus({bootCommit:BOOT,request:async b=>{assert.deepEqual(b,{op:'status'});return receipt()}});assert.equal(r.isolation.ready,true);assert.equal(r.isolation.source,'owner_bridge');assert.equal(audit.length,0)
  assert.throws(()=>require('child_process').execFile(process.execPath,['-e','0']),/local_cloud_inference_forbidden/);await assert.rejects(fetch('https://api.openai.com/v1/responses'),/local_cloud_inference_forbidden/);assert.equal(audit.length,2)
 }finally{restore()}
})
test('connection may remain known while missing or untrusted executor metadata stays unknown',async()=>{
 const {readLocalStatus}=require('./localStatus')
 for(const mutate of [v=>delete v.localCoding.isolation,v=>v.localCoding.isolation.checkedAt='2000-01-01T00:00:00.000Z',v=>v.localCoding.isolation.cli='secret-path',v=>v.localCoding.isolation.bootCommit='b'.repeat(40)]){const v=receipt();mutate(v);const r=await readLocalStatus({bootCommit:BOOT,request:async()=>v});assert.equal(r.localCoding.state,'connected');assert.equal(r.isolation.ready,null)}
 const r=await readLocalStatus({bootCommit:BOOT,request:async()=>{throw Error('timeout secret')}});assert.equal(r.localCoding.state,'unavailable');assert.equal(r.isolation.ready,null);assert.ok(!JSON.stringify(r).includes('timeout secret'))
})
test('controlled status reads executor metadata only, without touching tasks, providers or usage',async()=>{
 let probes=0;const {createControlledDispatch}=require('../../subscription/controlledDispatch'),forbidden=new Proxy({},{get(){assert.fail('work state accessed')}}),proof=receipt().localCoding.isolation
 const s=createControlledDispatch({enabled:()=>true,localEnabled:()=>true,bootCommit:BOOT,projectTasks:forbidden,projectWork:forbidden,isolationStatus:async()=>{probes++;return proof}})
 const r=await s.handle({id:'owner',role:'owner'},{op:'status'});assert.equal(probes,1);assert.equal(r.localCoding.isolation.ready,true);assert.equal(r.inferenceStarted,false)
 await assert.rejects(s.handle({id:'staff',role:'staff'},{op:'status'}),/permission_denied/);assert.equal(probes,1)
})
test('disabled lane never probes; malformed metadata never leaks a raw path',async()=>{
 const {createControlledDispatch}=require('../../subscription/controlledDispatch');let probes=0
 const off=createControlledDispatch({enabled:()=>false,localEnabled:()=>true,bootCommit:BOOT,isolationStatus:async()=>{probes++;throw Error('must not probe')}})
 assert.equal((await off.handle({id:'owner',role:'owner'},{op:'status'})).localCoding.isolation,null);assert.equal(probes,0)
 const s=createControlledDispatch({enabled:()=>true,localEnabled:()=>true,bootCommit:BOOT,isolationStatus:async()=>({...receipt().localCoding.isolation,cli:'secret-path'})})
 const r=await s.handle({id:'owner',role:'owner'},{op:'status'});assert.equal(r.localCoding.isolation,null);assert.ok(!JSON.stringify(r).includes('secret-path'))
})
test('real provider-to-controller-to-backend composition works under the fence with the same fake executor',async t=>{
 const fs=require('fs'),os=require('os'),path=require('path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'closed-prerequisite-'));t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true})});let probes=0,runs=0
 t.mock.method(require('../../workers/execution/windowsSandbox'),'createExecutor',()=>({readiness:async()=>{probes++;return{ready:true,engine:'windows-sandbox-offline-v1',cli:'private-path'}},isBusy:()=>false,run:()=>{runs++;assert.fail('guest forbidden')}}))
 const p=require('./providers').createProviders({root:dir,bootCommit:BOOT}),controller=require('../../subscription/controlledDispatch').createControlledDispatch({enabled:()=>true,localEnabled:()=>true,subscriptionReady:()=>false,bootCommit:BOOT,isolationStatus:p.isolationStatus}),audit=[],restore=require('../../localBrain/productionFence').install({audit:e=>audit.push(e)})
 try{const r=await require('./localStatus').readLocalStatus({bootCommit:BOOT,request:b=>controller.handle({id:'owner',role:'owner'},b)});assert.equal(r.localCoding.state,'connected');assert.equal(r.isolation.ready,true);assert.equal(r.isolation.boundaryVerified,false);assert.equal(r.executionAuthorized,false);assert.equal(probes,1);assert.equal(runs,0);assert.equal(audit.length,0);assert.ok(!JSON.stringify(r).includes('private-path'))}finally{restore()}
})
