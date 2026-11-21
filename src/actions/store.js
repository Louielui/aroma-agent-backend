'use strict'
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto'), { ID, target } = require('./contract')
// Keep only operating-system enums. OS messages and paths may identify private data.
const errno = require('node:os').constants.errno
function fileFailure(operation, cause) {
  return Object.assign(Error('audit_unavailable'), {
    fileOperation:operation, osCode:Object.hasOwn(errno,cause?.code) ? cause.code : 'UNKNOWN'
  })
}
function createStore ({ dir = path.join(require('../store/dataDir').resolveDataDir(),'scheduler-action-runs') } = {}) {
  const file = id => { if (!ID.test(id || '')) throw Error('invalid_request'); return path.join(dir,id+'.json') }
  const exists = id => {try{fs.statSync(file(id));return true}catch(e){if(e.code==='ENOENT')return false;throw Error('audit_unavailable')}}
  const get = id => {
    let bytes
    try { bytes=fs.readFileSync(file(id),'utf8') }
    catch(e) { if(e.code==='ENOENT')return null; throw fileFailure('read',e) }
    try {
      const row=JSON.parse(bytes)
      if(row.id!==id || !Array.isArray(row.timeline))throw Error('invalid_run')
      return row
    } catch(e) { throw fileFailure('decode',e) }
  }
  const save = r => {
    const dest=file(r.id),tmp=dest+'.'+randomUUID()+'.tmp'
    let fd,operation='mkdir',created=false
    try {
      fs.mkdirSync(dir,{recursive:true})
      operation='open'; fd=fs.openSync(tmp,'wx',0o600); created=true
      operation='encode'; const bytes=JSON.stringify(r)
      operation='write'; fs.writeFileSync(fd,bytes)
      operation='fsync'; fs.fsyncSync(fd)
      operation='close'; fs.closeSync(fd); fd=null
      operation='rename'; fs.renameSync(tmp,dest)
    } catch(e) {
      if(fd!=null)try{fs.closeSync(fd)}catch{}
      if(created)try{fs.unlinkSync(tmp)}catch{}
      throw fileFailure(operation,e)
    }
  }
  const list = () => {try{return fs.readdirSync(dir).filter(n=>ID.test(n.slice(0,-5))&&n.endsWith('.json')).map(n=>get(n.slice(0,-5)))}catch(e){if(e.code==='ENOENT')return [];throw Error('audit_unavailable')}}
  function lock (targetId) {
    if(![require('./procurementContract').TARGET,require('./procurementContract').CONTROL].includes(targetId))target(targetId)
    return acquire(targetId)
  }
  function lockRun(id){if(!ID.test(id||''))throw Error('invalid_request');return acquire('run-'+id)}
  function acquire(targetId){
    fs.mkdirSync(dir,{recursive:true}); const p=path.join(dir,targetId+'.lock'),tmp=p+'.'+randomUUID()+'.tmp';let fd,phase='prepare'
    // Publish only a complete, flushed identity. Exclusive hard-link creation cannot
    // replace another holder; a crash before publication leaves only an inert temp.
    try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));fs.fsyncSync(fd);phase='publish';fs.linkSync(tmp,p)}catch(e){
      if(fd!=null)fs.closeSync(fd);try{fs.unlinkSync(tmp)}catch(_){}
      const lockContention=phase==='publish'&&e.code==='EEXIST';let lockOwnerPid=null
      if(lockContention)try{const owner=JSON.parse(fs.readFileSync(p,'utf8'));if(Number.isSafeInteger(owner.pid)&&owner.pid>0)lockOwnerPid=owner.pid}catch(_){}
      // Preserve only bounded diagnostics, never OS messages, paths or credentials.
      throw Object.assign(Error('target_locked'),{lockContention,lockOwnerPid,lockCode:['EEXIST','EACCES','EPERM','ENOSPC','EIO','EMFILE','ENFILE','EROFS'].includes(e.code)?e.code:'UNKNOWN'})
    }
    try{fs.unlinkSync(tmp)}catch(_){}
    // A crash leaves the lock in place. No unattended retry or stale-lock deletion.
    return () => {fs.closeSync(fd);fs.unlinkSync(p)}
  }
  function lockState(targetId){
    if(![require('./procurementContract').TARGET,require('./procurementContract').CONTROL].includes(targetId))throw Error('invalid_request')
    let bytes;try{bytes=fs.readFileSync(path.join(dir,targetId+'.lock'))}catch(e){if(e.code==='ENOENT')return{exists:false};throw Error('audit_unavailable')}
    let row;try{row=JSON.parse(bytes)}catch{throw Error('audit_unavailable')}
    if(!Number.isSafeInteger(row.pid)||row.pid<=0)throw Error('audit_unavailable')
    let alive=true;try{process.kill(row.pid,0)}catch(e){if(e.code==='ESRCH')alive=false;else throw Error('audit_unavailable')}
    return{exists:true,pid:row.pid,alive,hash:require('node:crypto').createHash('sha256').update(bytes).digest('hex')}
  }
  function recoverLock(targetId,expectedHash){const before=lockState(targetId);if(!before.exists||before.alive||before.hash!==expectedHash||lockState(targetId).hash!==expectedHash)throw Error('recovery_unavailable');fs.unlinkSync(path.join(dir,targetId+'.lock'))}
  return {get,save,list,exists,lock,lockRun,lockState,recoverLock}
}
module.exports = { createStore }
