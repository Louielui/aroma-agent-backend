'use strict'
// Test-resource isolation only. Never imported by the production WSL runner.
// Live assertions and native timeouts stay unchanged; intended concurrency
// inside each security test is unaffected. Separate files share one distro.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{performance}=require('node:perf_hooks'),{randomUUID}=require('node:crypto')
// All runs address the same fixed distro and fixture paths. A per-run artifact
// directory cannot own this shared resource; never borrow/delete a stale lock.
function acquire({dir=path.join(os.tmpdir(),'aroma-wsl-live-resource'),timeoutMs=360000}={}){
 fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'source-clone.lock'),identity=JSON.stringify({pid:process.pid,id:randomUUID()}),start=performance.now(),sleeper=new Int32Array(new SharedArrayBuffer(4));let fd
 for(;;){try{fd=fs.openSync(file,'wx',0o600);break}catch(e){if(e.code!=='EEXIST')throw e;if(performance.now()-start>=timeoutMs)throw Error('wsl_test_resource_busy');Atomics.wait(sleeper,0,0,20)}}
 fs.writeFileSync(fd,identity);fs.closeSync(fd);let released=false
 const release=()=>{if(released)return;released=true;try{if(fs.readFileSync(file,'utf8')===identity)fs.unlinkSync(file)}catch{/* Never delete an unknown owner or retry a live operation. */}}
 process.once('exit',release);return release
}
module.exports={acquire}
