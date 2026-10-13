'use strict'
const fs=require('node:fs'),path=require('node:path')
const {createCoordinator}=require('../../src/repositoryPromotion/coordinator')
const {command}=require('../../src/repositoryPromotion/repository')
const {promotionDirectory}=require('../../src/repositoryPromotion/paths')
function argumentsOf (argv) {
  const action=argv.shift(),options={}
  if(!['begin','finish','resume','status','install-hooks','hook-before-commit','hook-after-commit','hook-before-push'].includes(action))throw Error('invalid_repository_action')
  while(argv.length){const name=argv.shift(),value=argv.shift();if(!['--root','--files','--message','--id'].includes(name)||!value||Object.hasOwn(options,name))throw Error('invalid_repository_argument');options[name]=value}
  return{action,options}
}
async function main () {
  const {action,options}=argumentsOf(process.argv.slice(2))
  const root=path.resolve(options['--root']||command(process.cwd(),['rev-parse','--show-toplevel'])),runtimeRoot='C:/Aroma/aroma-agent-backend'
  const artifacts=promotionDirectory()
  const coordinator=createCoordinator({root,runtimeRoot,artifacts,privateRefs:['refs/heads/backup/imagine-20261012-dirty-checkpoint']})
  if(action==='hook-before-push'){
    const lines=fs.readFileSync(0,'utf8').split('\n').filter(Boolean)
    coordinator.repository.identity()
    validatePush(lines,coordinator.repository)
    return
  }
  if(action==='install-hooks'){
    coordinator.repository.identity()
    const hooks=path.join(runtimeRoot,'scripts/repository/hooks')
    for(const name of ['pre-commit','post-commit','pre-push']){
      const full=path.join(hooks,name),stat=fs.lstatSync(full)
      if(!stat.isFile()||stat.isSymbolicLink()||fs.readFileSync(full,'utf8').replace(/\r\n/g,'\n').trimEnd()!==coordinator.repository.runtimeGit(['show','HEAD:scripts/repository/hooks/'+name]).replace(/\r\n/g,'\n').trimEnd())throw Error('uncommitted_repository_hook')
    }
    coordinator.repository.git(['config','--local','core.hooksPath',hooks]);console.log(JSON.stringify({hooksInstalled:true,root:runtimeRoot}));return
  }
  if(action==='status'){
    const file=path.join(artifacts,'latest.json');console.log(fs.existsSync(file)?fs.readFileSync(file,'utf8'):JSON.stringify({state:'not_run'}));return
  }
  if(action==='begin'||action==='hook-before-commit'||action==='hook-after-commit'){
    const row=await coordinator.begin()
    if(action==='begin')console.log(JSON.stringify({branch:row.branch,head:row.head,originMain:row.originMain,ahead:row.ahead,behind:row.behind,unpublished:row.unpublished.length,dirty:row.dirty.length,preservation:row.preservation.directory,runtimeCommit:row.runtimeObserved,next:row.next}))
    return
  }
  const first=action==='resume'?await coordinator.resume(options['--id']):await coordinator.finish({files:options['--files']?.split(','),message:options['--message']||'Promote accepted Imagine development tranche'})
  const row=await require('../../src/repositoryPromotion/workflow').waitForIdle(first,{coordinator})
  console.log(JSON.stringify({id:row.id,state:row.state,reason:row.reason||null,commit:row.merge?.commit||row.committed?.commit||null,pr:row.pr,runtime:row.runtime}))
  if(!['complete','awaiting_idle','awaiting_reload_idle','awaiting_administrator'].includes(row.state))process.exitCode=1
}
function validatePush (lines,repository) {
    for(const line of lines){
      const fields=line.trim().split(/\s+/)
      if(fields.length!==4||!/^refs\/heads\/(?!main$)[A-Za-z0-9_./-]+$/.test(fields[2])||! /^[a-f0-9]{40}$/.test(fields[1])||/^0{40}$/.test(fields[1])||!/^[a-f0-9]{40}$/.test(fields[3]))throw Error('direct_main_or_ref_deletion_forbidden')
      if(!/^0{40}$/.test(fields[3])){
        try{repository.git(['cat-file','-e',fields[3]+'^{commit}'])}catch{repository.git(['fetch','--no-tags','origin',fields[3]])}
        try{repository.git(['merge-base','--is-ancestor',fields[3],fields[1]])}catch{throw Error('remote_history_rewrite_forbidden')}
      }
    }
}
if(require.main===module)main().catch(e=>{console.error(e instanceof Error&&/^[a-z_]+$/.test(e.message)?e.message:'repository_promotion_failed');process.exitCode=1})
module.exports={argumentsOf,validatePush}
