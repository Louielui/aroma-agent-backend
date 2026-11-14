'use strict'
const path=require('node:path'),fs=require('node:fs')
function createLearning({dir,adapter,sourceRows=[],readConversation}){
 const database=require('./memoryStore').createLocalStore(dir)
 const lock=path.join(dir,'learning-owner.lock');let lockFd,engine,runtime
 try{
  // Serialize ownership recovery too: a second starter cannot remove a freshly
  // acquired lock. Unknown/inaccessible/live PIDs fail closed. No job is reset.
  const guard=lock+'.guard';let guardFd
  try{
   try{guardFd=fs.openSync(guard,'wx',0o600)}catch(e){if(e.code==='EEXIST')throw Error('local_memory_owner_busy');throw e}
   if(fs.existsSync(lock)){
    const previous=JSON.parse(fs.readFileSync(lock,'utf8'))
    if(!Number.isSafeInteger(previous.pid)||previous.pid<=0)throw Error('local_memory_owner_busy')
    try{process.kill(previous.pid,0);throw Error('local_memory_owner_busy')}catch(e){if(e.code!=='ESRCH')throw Error('local_memory_owner_busy')}
    fs.unlinkSync(lock)
   }
   lockFd=fs.openSync(lock,'wx',0o600)
   fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));fs.fsyncSync(lockFd)
  }finally{if(guardFd!==undefined){fs.closeSync(guardFd);fs.unlinkSync(guard)}}
  database.seed(sourceRows)
  engine=require('./memoryEngine').createLocalEngine({database,adapter})
  runtime=require('../memory/runtime').createRuntime({store:database.store,engine,dir:path.join(dir,'memory-outbox'),readConversation,isEngineReady:()=>!engine.status().busy,sequentialBackground:true})
 }catch(e){database.close();if(lockFd!==undefined){fs.closeSync(lockFd);fs.unlinkSync(lock)}throw e}
 let closed=false
 return {runtime,gateway:runtime.gateway,engine,database,
  start:()=>runtime.start(),close(){if(closed)return;runtime.stop();if(runtime.status().active||runtime.consolidation.status().busy||engine.status().busy)throw Error('local_memory_busy');closed=true;database.close();fs.closeSync(lockFd);fs.unlinkSync(lock)}}
}
module.exports={createLearning}
