'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const BOOT='a'.repeat(40),ENGINE='windows-sandbox-offline-v1'
test('metadata shares an in-flight executor probe and preserves its actual cached timestamp',async()=>{
 const {createPrerequisiteStatus}=require('./sandboxPrerequisites');let calls=0,clock=100000,finish
 const read=createPrerequisiteStatus({bootCommit:BOOT,now:()=>clock,isBusy:()=>false,probe:()=>{calls++;return new Promise(r=>{finish=r})}})
 const a=read(),b=read();await Promise.resolve();assert.equal(calls,1);clock+=11000;const c=read();await Promise.resolve();assert.equal(calls,1)
 finish({ready:true,engine:ENGINE,cli:'private-path',boundaryVerified:true});const results=await Promise.all([a,b,c]);for(const r of results){assert.equal(r.ready,true);assert.equal(r.boundaryVerified,false);assert.equal(r.checkedAt,new Date(clock).toISOString());assert.ok(!JSON.stringify(r).includes('private-path'))}
 clock+=9000;assert.equal((await read()).checkedAt,results[0].checkedAt);assert.equal(calls,1)
})
test('busy, known OS refusal, unknown and throwing probes have distinct closed states',async()=>{
 const {createPrerequisiteStatus}=require('./sandboxPrerequisites');let calls=0
 const busy=createPrerequisiteStatus({bootCommit:BOOT,isBusy:()=>true,probe:()=>{calls++;throw Error('must not probe')}})
 assert.equal((await busy()).state,'busy');assert.equal(calls,0)
 for(const [raw,state,ready]of [[{ready:false,reason:'windows_sandbox_cli_unavailable',engine:ENGINE},'unavailable',false],[{ready:false,reason:'windows_sandbox_unavailable',engine:ENGINE},'unknown',null],[{ready:true,engine:'other'},'unknown',null]]){
  const v=await createPrerequisiteStatus({bootCommit:BOOT,isBusy:()=>false,probe:async()=>raw})();assert.equal(v.state,state);assert.equal(v.ready,ready);assert.equal(v.boundaryVerified,false)
 }
 const thrown=await createPrerequisiteStatus({bootCommit:BOOT,isBusy:()=>false,probe:async()=>{throw Object.assign(Error('secret path'),{code:'local_cloud_inference_forbidden'})}})();assert.equal(thrown.reason,'sandbox_probe_policy_blocked');assert.ok(!JSON.stringify(thrown).includes('secret path'))
})
test('consumer rejects stale, future, mismatched, extra and contradictory metadata',()=>{
 const {parsePrerequisiteStatus}=require('./sandboxPrerequisites'),clock=100000,valid={protocol:'sandbox-prerequisites-v1',source:'owner_bridge',bootCommit:BOOT,engine:ENGINE,state:'ready',ready:true,reason:null,checkedAt:new Date(clock).toISOString(),boundaryVerified:false,metadataOnly:true}
 assert.equal(parsePrerequisiteStatus(valid,BOOT,clock).ready,true)
 for(const change of [r=>r.source='backend',r=>r.bootCommit='b'.repeat(40),r=>r.checkedAt=new Date(clock-30001).toISOString(),r=>r.checkedAt=new Date(clock+1).toISOString(),r=>r.boundaryVerified=true,r=>r.reason='arbitrary text',r=>r.extra='private-path',r=>r.state='unknown',r=>r.ready=null]){const r=structuredClone(valid);change(r);assert.equal(parsePrerequisiteStatus(r,BOOT,clock),null)}
})
test('provider metadata uses the same executor as local repair without invoking a provider or guest',async t=>{
 const fs=require('fs'),os=require('os'),path=require('path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'prerequisite-provider-'));t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true})});let probes=0,runs=0
 t.mock.method(require('./windowsSandbox'),'createExecutor',()=>({readiness:async()=>{probes++;return{ready:true,engine:ENGINE}},isBusy:()=>false,run:()=>{runs++;assert.fail('guest execution forbidden')}}))
 const p=require('../../core/workerFlow/providers').createProviders({root:dir,bootCommit:BOOT});assert.equal((await p.isolationStatus()).ready,true);assert.equal(probes,1);assert.equal((await p.local({}).isolation()).ready,true);assert.equal(probes,2);assert.equal(runs,0)
})
test('cache refreshes after its fixed age and busy transitions cannot borrow a ready result',async()=>{
 const {createPrerequisiteStatus}=require('./sandboxPrerequisites');let calls=0,clock=100000,busy=false
 const read=createPrerequisiteStatus({bootCommit:BOOT,now:()=>clock,isBusy:()=>busy,probe:async()=>{calls++;return{ready:true,engine:ENGINE}}})
 const first=await read();first.ready=false;assert.equal((await read()).ready,true);assert.equal(calls,1)
 busy=true;assert.equal((await read()).state,'busy');assert.equal(calls,1);busy=false;clock+=10000
 assert.equal((await read()).checkedAt,new Date(clock).toISOString());assert.equal(calls,2)
})
