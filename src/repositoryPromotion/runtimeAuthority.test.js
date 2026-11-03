'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const COMMIT='a'.repeat(40),TREE='b'.repeat(40)
function fixture({subprocess=null}={}){
 let expired=false,writes=0
 const installer=Buffer.from('param([switch]$PublishClient)\n'),module={exports:{}}
 const fakeFs={existsSync:()=>true,readFileSync:file=>String(file).endsWith('.env')?Buffer.from(''):installer}
 const fakeRequire=name=>{
  if(name==='node:fs')return fakeFs
  if(name==='node:child_process')return{spawnSync:()=>{writes++;return subprocess||{status:0,stdout:JSON.stringify({commit:COMMIT,registrationVerified:true})}}}
  if(name==='./repository')return{digest:b=>require('node:crypto').createHash('sha256').update(b).digest('hex'),parseStatus:()=>[],command:()=>Buffer.from('')}
  if(name==='dotenv')return{parse:()=>({})}
  if(name==='../adapters/CodexSubscriptionAdapter')return{localRequest:async()=>({bootCommit:COMMIT,state:'ready'})}
  if(name==='./checks')return{runTests:async()=>{expired=true;return{exitCode:0,failed:0,passed:1}}}
  if(name==='../browserRead/clientUpdate')return{readInstallation:()=>({state:'ready'})}
  return require(name)
 }
 // The fixture models the Windows runtime on every runner, without borrowing
 // credentials, profile paths or environment assumptions from the host.
 const fixtureProcess={env:{USERPROFILE:'C:/Users/fixture',SystemRoot:'C:/Windows'}}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'runtime.js'),'utf8'),{module,require:fakeRequire,Buffer,process:fixtureProcess,setTimeout,AbortSignal})
 const repository={runtimeRoot:'C:/Aroma/aroma-agent-backend',artifacts:'fixture',runtimeGit:args=>args[0]==='show'?installer:args[1]?.endsWith('^{tree}')?TREE:COMMIT,git:()=>TREE}
 const guard=()=>{if(expired)throw Error('deployment_authorization_expired')}
 const runtime=module.exports.createRuntime({repository,readinessImpl:async()=>{expired=true;return{state:'idle_verified'}},fetchImpl:async url=>({ok:true,status:401,json:async()=>({status:'ok',service:'aroma-hub',bootCommit:COMMIT})})})
 return{runtime,guard,writes:()=>writes}
}
test('expiry during regression prevents subsequent managed-client publication',async()=>{
 const f=fixture()
 await assert.rejects(f.runtime.verify({merge:{commit:COMMIT}},{guard:f.guard}),/deployment_authorization_expired/)
 assert.equal(f.writes(),0)
})
test('expiry during idle inspection prevents checkout and reload',async()=>{
 const f=fixture()
 await assert.rejects(f.runtime.deploy({merge:{commit:COMMIT},evidence:{tree:TREE}},{guard:f.guard}),/deployment_authorization_expired/)
 assert.equal(f.writes(),0)
})

test('client subprocess failures preserve safe exit and stage evidence without raw output or credentials',async()=>{
 const marker={stage:'copy_sources',reason:'client_install_unconfirmed',errorType:'System.Management.Automation.CommandNotFoundException',errorId:'CommandNotFoundException',sourceName:'src/browserRead/nativeHost.cjs'},stderr='credential=fixture-secret\nIMAGINE_CLIENT_INSTALL '+JSON.stringify(marker)+'\n'
 const f=fixture({subprocess:{status:1,stdout:'private-output',stderr}}),r=await f.runtime.verify({merge:{commit:COMMIT}})
 assert.equal(r.verified,false);assert.equal(r.reason,'client_publication_failed');assert.equal(r.diagnostics.exitCode,1);assert.equal(r.diagnostics.stderrBytes,Buffer.byteLength(stderr));assert.equal(r.diagnostics.stderrHash,require('node:crypto').createHash('sha256').update(stderr).digest('hex'));assert.deepEqual(JSON.parse(JSON.stringify(r.diagnostics.installer)),marker);assert.equal(f.writes(),1);assert.ok(!JSON.stringify(r).includes('fixture-secret'));assert.ok(!JSON.stringify(r).includes('private-output'))
 const malformed=fixture({subprocess:{status:null,signal:null,error:{code:'ETIMEDOUT'},stdout:'',stderr:'IMAGINE_CLIENT_INSTALL {"stage":"unknown","reason":"token=fixture-secret"}\n'}}),m=await malformed.runtime.verify({merge:{commit:COMMIT}})
 assert.equal(m.verified,false);assert.equal(m.diagnostics.exitCode,null);assert.equal(m.diagnostics.timedOut,true);assert.equal(m.diagnostics.installer,null);assert.ok(!JSON.stringify(m).includes('fixture-secret'))
 const invalid=fixture({subprocess:{status:0,stdout:'credential=fixture-secret',stderr:''}}),v=await invalid.runtime.verify({merge:{commit:COMMIT}})
 assert.equal(v.reason,'client_publication_unconfirmed');assert.equal(v.diagnostics.exitCode,0);assert.ok(!JSON.stringify(v).includes('fixture-secret'))
 for(const forged of [{...marker,errorId:'credential_fixture_secret'},{...marker,errorType:'credential_fixture_secret'},{...marker,sourceName:'src/browserRead/credential_fixture_secret.js'},{...marker,extra:'credential_fixture_secret'}]){
  const fake=fixture({subprocess:{status:1,stdout:'',stderr:'IMAGINE_CLIENT_INSTALL '+JSON.stringify(forged)+'\n'}}),value=await fake.runtime.verify({merge:{commit:COMMIT}});assert.equal(value.diagnostics.installer,null);assert.ok(!JSON.stringify(value).includes('credential_fixture_secret'))
 }
})
