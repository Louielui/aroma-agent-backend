'use strict'
const fs=require('node:fs'),path=require('node:path')
async function main () {
  const args=process.argv.slice(2)
  if(args.length!==2||args[0]!=='--run-id'||!/^[a-f0-9-]{36}$/.test(args[1]))throw Error('invalid_accepted_work_id')
  const id=args[1],root=path.resolve(__dirname,'../..'),local=process.env.LOCALAPPDATA||process.env.TEMP
  const workerRoot=path.join(local,'AromaXiangXiang','worker-flow'),artifacts=path.join(local,'AromaXiangXiang','repository-promotion')
  const {createRunStore}=require('../../src/core/operating/runStore')
  const workStore=createRunStore({dir:path.join(workerRoot,'project-runs'),workflow:'project_work'})
  const taskStore=createRunStore({dir:path.join(workerRoot,'project-tasks'),workflow:'project_task'})
  const registry=require('../../src/core/projectTasks/contract').createRegistry(taskStore)
  const env=require('dotenv').parse(fs.readFileSync(path.join(root,'.env')))
  const workspaceRoot=env.XIANGXIANG_WORKER_WORKSPACE_ROOT&&path.isAbsolute(env.XIANGXIANG_WORKER_WORKSPACE_ROOT)?env.XIANGXIANG_WORKER_WORKSPACE_ROOT:path.join(require('node:os').homedir(),'Documents','AromaXiangXiang','worker-workspaces')
  const isolated=key=>{
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key||''))throw Error('accepted_evidence_changed')
    const file=path.join(workspaceRoot,'isolated-coding-runs',key+'.json'),stat=fs.lstatSync(file)
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>5000000)throw Error('accepted_evidence_changed')
    return JSON.parse(fs.readFileSync(file,'utf8'))
  }
  const work=require('../../src/repositoryPromotion/acceptedWork').createAcceptedWork({root,artifacts,privateRefs:['refs/heads/backup/imagine-20261012-dirty-checkpoint'],resolveRecipe:registry.resolve,isolated})
  const original=workStore.get(id)
  const result=await work.accept(original)
  const current=workStore.get(id)
  if(!current||current.state!=='completed'||current.result?.patchHash!==original.result?.patchHash)throw Error('accepted_work_changed')
  current.repositoryPromotion=result;current.appliedToLive=result.state==='complete'&&result.runtimeVerified===true
  current.steps.push({stage:'repository_promotion_recorded',at:new Date().toISOString(),facts:{state:result.state,commit:result.commit,appliedToLive:current.appliedToLive}})
  workStore.save(current)
  console.log(JSON.stringify(result))
}
main().catch(e=>{console.error(['invalid_accepted_work_id','accepted_evidence_changed','accepted_work_changed'].includes(e.message)?e.message:'repository_promotion_unavailable');process.exitCode=1})
