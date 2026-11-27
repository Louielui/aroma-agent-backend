'use strict'
const fs=require('node:fs'),path=require('node:path')
const {fork}=require('node:child_process')
const {randomUUID}=require('node:crypto')
const {cleanEnv,createManager}=require('./engines')
const {turn,createSession,permit}=require('./dialogue')
const source=path.resolve(__dirname,'../../..')
const lab=path.resolve(source,'..')
const dependencies='C:/Aroma/aroma-agent-backend/node_modules'

function createHost(options={}){
  const root=path.join(lab,'runs',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,6))
  fs.mkdirSync(root,{recursive:true})
  const proof=JSON.parse(fs.readFileSync(path.join(lab,'asset-proof.json'),'utf8'))
  const log=(file,event)=>fs.appendFileSync(path.join(root,file),JSON.stringify({at:new Date().toISOString(),...event})+'\n')
  const lock=path.join(lab,'engine-owner.lock')
  const claim=()=>fs.writeFileSync(lock,JSON.stringify({pid:process.pid,root}),{flag:'wx'})
  try{claim()}catch(error){
    if(error.code!=='EEXIST'||!options.job)throw error
    const previous=JSON.parse(fs.readFileSync(lock,'utf8'))
    if(!Number.isSafeInteger(previous.pid)||previous.pid<1)throw Error('phase1_invalid_host_lock')
    try{
      process.kill(previous.pid,0)
      throw error
    }catch(probe){
      if(probe.code!=='ESRCH')throw probe
    }
    // Preserve the previous receipt. The Windows job releases its engine when its owner dies.
    fs.renameSync(lock,path.join(root,'previous-host-lock.json'))
    claim()
  }
  const manager=createManager({proof,root,job:options.job,idleMs:options.idleMs,event:e=>log('engines.jsonl',e)})
  const stop=manager.close
  manager.close=async()=>{await stop();if(fs.existsSync(lock)&&JSON.parse(fs.readFileSync(lock,'utf8')).pid===process.pid)fs.unlinkSync(lock)}
  const sessions=new Map()
  function fresh(){
    const session=createSession()
    if(sessions.size>=256)sessions.delete(sessions.keys().next().value)
    sessions.set(session.id,session)
    return session
  }
  function baseline({pin,mode,history,message,trace,signal}){
    const rootDir=path.join(root,'pipeline-'+randomUUID())
    const env={...cleanEnv(rootDir),NODE_PATH:dependencies,LOCAL_BRAIN_ONLY:'1',LLM_PROVIDER:'local',CHAT_BACKEND:'local',
      AROMA_DATA_DIR:path.join(rootDir,'data'),AROMA_ARTIFACT_DIR:path.join(rootDir,'artifacts'),
      LOCAL_MODEL:pin.model,LOCAL_MODEL_CONTEXT:'8192',LOCAL_MODEL_URL:pin.url,
      CONVERSATION_DEMO:'on',A4_KNOWLEDGE_ROUTING:'on',READ_ACCESS:'on',GOAL_DECOMPOSER:'on',TURN_ROUTER:'on',
      XIANGXIANG_MEMORY:'off',WORKER_INVOCATION:'off',AGENT_BRIDGE:'off',DEVELOP_DISPATCH:'off'}
    const fd=fs.openSync(path.join(rootDir,'pipeline.log'),'wx')
    const child=fork(path.join(source,'scripts/localBrain/nextBaseline.cjs'),[],{cwd:source,env,stdio:['ignore',fd,fd,'ipc'],windowsHide:true})
    fs.closeSync(fd)
    return new Promise((resolve,reject)=>{
      let settled=false
      const finish=(callback,value)=>{
        if(settled)return
        settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort)
        child.kill();callback(value)
      }
      const abort=()=>finish(reject,Error('local_cancelled'))
      const timer=setTimeout(()=>finish(reject,Error('baseline_timeout')),180000)
      child.on('error',()=>finish(reject,Error('baseline_worker_failed')))
      child.on('exit',()=>finish(reject,Error('baseline_worker_exited')))
      child.on('message',m=>{
        if(m.trace)trace(m.trace)
        else if(m.error)finish(reject,Error(m.error))
        else if(m.result)finish(resolve,m.result)
      })
      if(signal?.aborted)return abort()
      signal?.addEventListener('abort',abort,{once:true})
      child.send({pin,history,input:message,mode},error=>{if(error)finish(reject,Error('baseline_worker_failed'))})
    })
  }
  async function submit(session,arm,message,opts={}){
    return turn({manager,session,arm,message,mode:opts.mode,treatment:opts.treatment,experiment:opts.experiment,onDelta:opts.onDelta,signal:opts.signal,baseline,
      trace:e=>{log('turns.jsonl',{...e,sessionId:session.id,arm,caseId:opts.caseId??null});opts.onTrace?.(e)}})
  }
  function approve(session,id){
    const result=permit(session,id)
    log('turns.jsonl',{type:'fixture_owner_approval',...result,sessionId:session.id})
    return result
  }
  return {root,fresh,sessions,submit,approve,manager,log}
}
module.exports={createHost,lab}
