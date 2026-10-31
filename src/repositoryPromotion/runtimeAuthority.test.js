'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const COMMIT='a'.repeat(40),TREE='b'.repeat(40)
function fixture(){
 let expired=false,writes=0
 const installer=Buffer.from('param([switch]$PublishClient)\n'),module={exports:{}}
 const fakeFs={existsSync:()=>true,readFileSync:file=>String(file).endsWith('.env')?Buffer.from(''):installer}
 const fakeRequire=name=>{
  if(name==='node:fs')return fakeFs
  if(name==='node:child_process')return{spawnSync:()=>{writes++;return{status:0,stdout:JSON.stringify({commit:COMMIT,registrationVerified:true})}}}
  if(name==='./repository')return{digest:()=>'',parseStatus:()=>[],command:()=>Buffer.from('')}
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
