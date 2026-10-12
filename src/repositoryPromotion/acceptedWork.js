'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process')
const {createCoordinator,atomic}=require('./coordinator'),{digest,secretPath}=require('./repository')
function createAcceptedWork ({root,artifacts,privateRefs=[],resolveRecipe,isolated,invocationLedger=null}) {
  const coordinator=createCoordinator({root,runtimeRoot:root,artifacts,privateRefs,invocationLedger})
  async function accept (run) {
    if(!/^[a-f0-9-]{36}$/.test(run?.id||'')||run.actor!=='owner'||run.state!=='completed'||run.appliedToLive!==false)throw Error('unaccepted_repository_work')
    const accepted=require('../core/projectWork/adoption').validateAccepted(run,await isolated(run.result?.isolatedRunId),resolveRecipe)
    const definition=resolveRecipe(accepted.recipe||run.workOrder.recipe),names=definition.workOrder.allowedFiles
    if(!Array.isArray(names)||names.some(secretPath)||!Array.isArray(run.result.changes)||JSON.stringify(names.slice().sort())!==JSON.stringify(run.result.changes.map(c=>c.file).sort()))throw Error('unaccepted_repository_work')
    const request=path.join(artifacts,'accepted',run.id+'.json')
    fs.mkdirSync(path.dirname(request),{recursive:true})
    try{fs.writeFileSync(request,JSON.stringify({id:run.id,state:'claimed',at:new Date().toISOString()}),{flag:'wx'})}catch{
      return JSON.parse(fs.readFileSync(request,'utf8'))
    }
    let result
    try{
      const before=await coordinator.begin()
      if(before.runtimeObserved!==run.source.evidence.bootCommit)throw Error('accepted_source_changed')
      const branch='codex/accepted-'+run.id,worktree=path.join(artifacts,'accepted-worktrees',run.id)
      coordinator.repository.git(['worktree','add','-b',branch,worktree,before.remoteMain])
      for(const c of run.result.changes){
        if(c.beforeHash!==digest(c.before)||c.afterHash!==digest(c.after)||coordinator.repository.git(['show',before.remoteMain+':'+c.file]).replace(/\r\n/g,'\n').trimEnd()!==c.before.replace(/\r\n/g,'\n').trimEnd())throw Error('accepted_source_changed')
        const full=path.join(worktree,c.file),stat=fs.lstatSync(full)
        if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('accepted_source_changed')
        fs.writeFileSync(full,c.after)
      }
      const candidate=createCoordinator({root:worktree,runtimeRoot:root,artifacts,privateRefs,invocationLedger})
      const first=await candidate.finish({files:names,message:'Promote Owner-approved Imagine task '+run.id})
      const row=await require('./workflow').waitForIdle(first,{coordinator:candidate})
      result={id:row.id,state:row.state,sourceWorkRunId:run.id,commit:row.merge?.commit||row.committed?.commit||null,pr:row.pr||null,runtimeVerified:row.runtime?.verified===true,appliedToLive:row.state==='complete'&&row.runtime?.verified===true,reason:row.reason||null}
    }catch(error){result={id:run.id,sourceWorkRunId:run.id,state:'needs_attention',reason:['accepted_source_changed','repository_reconciliation_required','promotion_busy'].includes(error.message)?error.message:'repository_promotion_unavailable',runtimeVerified:false,appliedToLive:false}}
    atomic(request,result);return result
  }
  async function enqueue (run) {
    if(!/^[a-f0-9-]{36}$/.test(run?.id||'')||run.actor!=='owner'||run.state!=='completed'||run.appliedToLive!==false)throw Error('unaccepted_repository_work')
    require('../core/projectWork/adoption').validateAccepted(run,await isolated(run.result?.isolatedRunId),resolveRecipe)
    const file=path.join(artifacts,'dispatch',run.id+'.json');fs.mkdirSync(path.dirname(file),{recursive:true})
    try{fs.writeFileSync(file,JSON.stringify({id:run.id,state:'dispatching',at:new Date().toISOString()}),{flag:'wx'})}catch{return{detached:true,state:'already_dispatched',sourceWorkRunId:run.id}}
    const script=path.join(root,'scripts/repository/acceptedTranche.cjs'),stat=fs.lstatSync(script)
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||fs.readFileSync(script,'utf8').replace(/\r\n/g,'\n').trimEnd()!==coordinator.repository.git(['show','HEAD:scripts/repository/acceptedTranche.cjs']).replace(/\r\n/g,'\n').trimEnd())throw Error('accepted_driver_changed')
    const log=fs.openSync(path.join(artifacts,'dispatch',run.id+'.log'),'a')
    const child=cp.spawn(process.execPath,[script,'--run-id',run.id],{cwd:root,env:require('../agent/agentBridgeWorker').buildChildEnv(process.env),detached:true,windowsHide:true,shell:false,stdio:['ignore',log,log]})
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error('accepted_driver_unavailable')))})
    atomic(file,{id:run.id,state:'dispatched',pid:child.pid,at:new Date().toISOString()});child.unref();fs.closeSync(log)
    return{detached:true,state:'queued',sourceWorkRunId:run.id,pid:child.pid}
  }
  return{begin:coordinator.begin,enqueue,accept,isActive:coordinator.isActive,coordinator}
}
module.exports={createAcceptedWork}
