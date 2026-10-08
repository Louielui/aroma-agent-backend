'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const api=require('../../context/contextResult'), live=require('./liveVerification'),{RECIPE}=require('./contract')
const sha='a'.repeat(40), sourceHash=crypto.createHash('sha256').update('source').digest('hex'),workRunId='11111111-1111-4111-8111-111111111111'
const bootedAt='2026-10-01T00:00:00Z'
test('loaded actual component runs eight closed checks; shallow snapshot regression is caught without executing caller tests',()=>{
 const good=live.createProbe({bootCommit:sha,bootedAt,api,sourceHash})()
 assert.equal(good.passed,8);assert.equal(good.failed,0);assert.equal(live.valid(good),true)
 const broken={...api,makeContextResult:value=>({...api.makeContextResult(value),fields:value.fields && typeof value.fields==='object'&&!Array.isArray(value.fields)?value.fields:{}})}
 const bad=live.createProbe({bootCommit:sha,bootedAt,api:broken,sourceHash})()
 assert.equal(bad.failed,5);assert.equal(live.valid(bad),true)
 assert.deepEqual(bad.checks.filter(c=>!c.passed).map(c=>c.id),live.CHECKS.slice(0,5))
})
test('fixed client binds source, boot, exact work and safe projection; unavailable adapters and malformed evidence fail closed',async()=>{
 const good=live.createProbe({bootCommit:sha,bootedAt,api,sourceHash})(),input={recipe:RECIPE,bootCommit:sha,sourceHash,workRunId}
 let calls=0
 const client=live.createClient({request:async()=>{calls++;return {...good,stdout:'SECRET',nonce:'SECRET',path:'../../.env'}}})
 const result=await client(input);assert.equal(result.workRunId,workRunId);assert.doesNotMatch(JSON.stringify(result),/SECRET|\.env/)
 assert.equal((await client({...input,recipe:'unregistered'})).reason,'live_adapter_not_registered');assert.equal(calls,1)
 for(const change of [v=>v.bootCommit='b'.repeat(40),v=>v.sourceHash='b'.repeat(64),v=>v.checksHash='b'.repeat(64),v=>v.checks.reverse(),v=>v.passed=7,v=>v.at='2000-01-01']){
  const value=structuredClone(good);change(value)
  assert.equal((await live.createClient({request:async()=>value})(input)).state,'unavailable')
 }
 assert.equal((await live.createClient({request:async()=>{throw Error('credential')}})(input)).reason,'live_verification_unavailable')
})
test('actual application owner gate, read switch and closed probe route reject unauthorised, query and arbitrary paths',async t=>{
 const {createApp}=require('../../app'),env={READ_ACCESS:'on'}
 let calls=0
 const probe=live.createProbe({bootCommit:sha,bootedAt,api,sourceHash})
 const app=createApp({ownerPassword:'fixture-owner',serviceToken:'fixture-service',runPersistence:false,proposalPersistence:false,
  workerDeps:{artifactStore:null,runner:null},liveVerificationOptions:{env,probe:()=>{calls++;return probe()}}})
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
 t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const url='http://127.0.0.1:'+server.address().port+'/api/v1/project-work/verification/',headers={authorization:'Bearer fixture-service'}
 assert.equal((await fetch(url+live.PROBE)).status,401);assert.equal(calls,0)
 const response=await fetch(url+live.PROBE,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store')
 const measured=await response.json();assert.equal(measured.passed,8);assert.equal(measured.bootCommit,sha)
 assert.equal((await fetch(url+'arbitrary',{headers})).status,400)
 assert.equal((await fetch(url+live.PROBE+'?code=anything',{headers})).status,400)
 env.READ_ACCESS='off';assert.equal((await fetch(url+live.PROBE,{headers})).status,503);assert.equal(calls,1)
})
