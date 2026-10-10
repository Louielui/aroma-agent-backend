'use strict'
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto'), { ID, target } = require('./contract')
function createStore ({ dir = path.join(require('../store/dataDir').resolveDataDir(),'scheduler-action-runs') } = {}) {
  const file = id => { if (!ID.test(id || '')) throw Error('invalid_request'); return path.join(dir,id+'.json') }
  const get = id => { try { const r=JSON.parse(fs.readFileSync(file(id),'utf8')); if(r.id!==id || !Array.isArray(r.timeline))throw Error('invalid_run'); return r } catch(e){if(e.code==='ENOENT')return null;throw Error('audit_unavailable')} }
  const save = r => {
    fs.mkdirSync(dir,{recursive:true}); const dest=file(r.id),tmp=dest+'.'+randomUUID()+'.tmp'
    let fd
    try {fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(r));fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(tmp,dest)}
    catch(_){if(fd!=null)fs.closeSync(fd);try{fs.unlinkSync(tmp)}catch(_){}throw Error('audit_unavailable')}
  }
  const list = () => {try{return fs.readdirSync(dir).filter(n=>ID.test(n.slice(0,-5))&&n.endsWith('.json')).map(n=>get(n.slice(0,-5)))}catch(e){if(e.code==='ENOENT')return [];throw Error('audit_unavailable')}}
  function lock (targetId) {
    target(targetId);fs.mkdirSync(dir,{recursive:true}); const p=path.join(dir,targetId+'.lock');let fd
    try{fd=fs.openSync(p,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));fs.fsyncSync(fd)}catch(_){if(fd!=null)fs.closeSync(fd);throw Error('target_locked')}
    // A crash leaves the lock in place. No unattended retry or stale-lock deletion.
    return () => {fs.closeSync(fd);fs.unlinkSync(p)}
  }
  return {get,save,list,lock}
}
module.exports = { createStore }
