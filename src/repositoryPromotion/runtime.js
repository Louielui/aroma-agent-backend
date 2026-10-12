'use strict'
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process')
const {SHA}=require('./policy'),{digest,parseStatus,command}=require('./repository')
function overlayPlan (repository,snapshot,target) {
  if(!SHA.test(target||'')||!SHA.test(snapshot.head||'')||snapshot.verified!==true)throw Error('runtime_snapshot_unavailable')
  const blob=(sha,name)=>{try{return repository.runtimeGit(['rev-parse',sha+':'+name])}catch{return null}}
  return snapshot.files.map(file=>{
    const before=blob(snapshot.comparisonHead || snapshot.head,file.path),after=blob(target,file.path),saved=blob(snapshot.checkpoint,file.path)
    if(after!==before&&after!==saved)throw Error('material_runtime_overlay_conflict')
    return{...file,beforeBlob:before,targetBlob:after,snapshotBlob:saved,absorbed:after===saved}
  })
}
function applyCheckout (repository,snapshot,target) {
  const plan=overlayPlan(repository,snapshot,target)
  if(repository.runtimeGit(['symbolic-ref','--quiet','--short','HEAD'])!=='main'||repository.runtimeGit(['rev-parse','HEAD'])!==snapshot.head)throw Error('runtime_mismatch')
  repository.runtimeGit(['merge-base','--is-ancestor',snapshot.head,target])
  for(const file of plan)if(!file.deleted&&digest(fs.readFileSync(path.join(repository.runtimeRoot,file.path)))!==file.sha256)throw Error('runtime_overlay_changed')
  let stash=null
  if(plan.length){
    let previous;try{previous=repository.runtimeGit(['rev-parse','refs/stash'])}catch{}
    if(previous)repository.runtimeGit(['update-ref','refs/preservation/stash/'+previous,previous])
    repository.runtimeGit(['stash','push','-m','Policy-preserved runtime overlay','--',...plan.map(f=>f.path)])
    stash=repository.runtimeGit(['rev-parse','refs/stash'])
    repository.runtimeGit(['update-ref','refs/preservation/stash/'+stash,stash])
  }
  try{repository.runtimeGit(['merge','--ff-only',target])}
  finally{
    const current=repository.runtimeGit(['rev-parse','HEAD'])
    if(current!==snapshot.head&&current!==target)throw Error('runtime_checkout_race')
    for(const file of plan){
      const full=path.join(repository.runtimeRoot,file.path)
      if(file.deleted){if(fs.existsSync(full))fs.unlinkSync(full)}
      else{
        const bytes=fs.readFileSync(path.join(snapshot.directory,'files',file.path))
        if(digest(bytes)!==file.sha256)throw Error('runtime_snapshot_damaged')
        fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,bytes)
      }
    }
  }
  if(repository.runtimeGit(['rev-parse','HEAD'])!==target)throw Error('runtime_checkout_unconfirmed')
  return{commit:target,stash,absorbed:plan.filter(f=>f.absorbed).map(f=>f.path),retainedOverlays:plan.filter(f=>!f.absorbed).map(f=>f.path),sourceVerified:true}
}
async function health (url,fetchImpl=fetch) {
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(7000),redirect:'manual'})
  if(!response.ok)throw Error('runtime_health_unavailable')
  const value=await response.json()
  if(value.status!=='ok'||value.service!=='aroma-hub'||!SHA.test(value.bootCommit||''))throw Error('runtime_identity_unavailable')
  return value
}
function createRuntime ({repository,dependencies,restartImpl=null,readinessImpl=null,fetchImpl=fetch}) {
  const root=repository.runtimeRoot
  async function idle () {
    if(readinessImpl)return readinessImpl()
    const env=require('dotenv').parse(fs.readFileSync(path.join(root,'.env')))
    const {localRequest}=require('../adapters/CodexSubscriptionAdapter')
    const values=await Promise.all(['/runtime-metadata','/work-metadata','/execution-health'].map(route=>localRequest(route,{},env,AbortSignal.timeout(7000))))
    return require('../../scripts/connections/setupReadiness.cjs').project(...values)
  }
  async function restart (expected) {
    if(restartImpl)return restartImpl(expected)
    const relative='scripts/repository/restartLocal.ps1',full=path.join(root,relative)
    if(fs.readFileSync(full,'utf8').replace(/\r\n/g,'\n').trimEnd()!==repository.runtimeGit(['show',expected+':'+relative]).replace(/\r\n/g,'\n').trimEnd())throw Error('reload_script_changed')
    const executable=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe')
    const result=cp.spawnSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',full,'-ExpectedCommit',expected],{windowsHide:true,shell:false,encoding:'utf8',timeout:90000})
    if(result.status===5)return{state:'administrator_required',applied:false}
    if(result.status!==0)throw Error('local_reload_failed')
    return{state:'restarted',applied:true}
  }
  async function deploy (row) {
    const expected=row.merge.commit
    if(!SHA.test(expected||'')||repository.git(['rev-parse',expected+'^{tree}'])!==row.evidence.tree)throw Error('merged_tree_mismatch')
    const readiness=await idle()
    if(readiness.state!=='idle_verified')return{state:'idle_required',applied:false}
    let snapshot=row.runtimeSnapshot
    if(!snapshot){
      const before=await repository.inspect();snapshot=repository.preserve(before,root);row.runtimeSnapshot=snapshot
    }
    row.checkout=applyCheckout(repository,snapshot,expected)
    const reloaded=await restart(expected)
    return{...reloaded,expectedCommit:expected,checkout:row.checkout}
  }
  async function verify (row,{rollback=false}={}) {
    const expected=rollback?row.rollbackResult.commit:row.merge.commit
    let source=repository.runtimeGit(['rev-parse','HEAD'])===expected
    const dirty=parseStatus(command(root,['status','--porcelain=v1','-z','--untracked-files=all'],{buffer:true}).toString('utf8'))
    for(const entry of dirty){
      const saved=row.runtimeSnapshot?.files || []
      const file=(Array.isArray(saved)?saved:[]).find(f=>f.path===entry.path)
      if(!file||(!file.deleted&&digest(fs.readFileSync(path.join(root,file.path)))!==file.sha256))source=false
    }
    let backend,bridge
    for(let attempt=0;attempt<12;attempt++){
      try{
        backend=await health('http://127.0.0.1:8090/health',fetchImpl)
        const env=require('dotenv').parse(fs.readFileSync(path.join(root,'.env')))
        bridge=await require('../adapters/CodexSubscriptionAdapter').localRequest('/execution-health',{},env,AbortSignal.timeout(7000))
        if(backend.bootCommit===expected&&bridge?.bootCommit===expected&&bridge.state==='ready')break
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,1000))
    }
    if(!source||backend?.bootCommit!==expected||bridge?.bootCommit!==expected||bridge?.state!=='ready')return{verified:false,reason:'runtime_mismatch',expectedCommit:expected,bootCommit:backend?.bootCommit||null,bridgeCommit:bridge?.bootCommit||null,sourceVerified:source}
    const unauthenticated=await fetchImpl('http://127.0.0.1:8090/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json'},body:'{}',redirect:'manual',signal:AbortSignal.timeout(7000)})
    const smokePassed=[401,403].includes(unauthenticated.status)
    const files=['src/investigation/generalization.test.js','src/actions/continuation.test.js','src/context/adapters/sevenShiftsRead.test.js','src/routing/modelRouter.test.js']
    const regression=await require('./checks').runTests({root,dependencies,directory:path.join(repository.artifacts,'runtime-regression-'+expected),files,commit:expected,tree:repository.runtimeGit(['rev-parse',expected+'^{tree}'])})
    return{verified:smokePassed&&regression.exitCode===0&&regression.failed===0&&regression.passed>0,expectedCommit:expected,bootCommit:backend.bootCommit,bridgeCommit:bridge.bootCommit,sourceVerified:source,smokePassed,regressionPassed:regression.exitCode===0&&regression.failed===0&&regression.passed>0,regression,checkedAt:new Date().toISOString()}
  }
  return{idle,restart,deploy,verify,health:()=>health('http://127.0.0.1:8090/health',fetchImpl)}
}
module.exports={overlayPlan,applyCheckout,health,createRuntime}
