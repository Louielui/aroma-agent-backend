'use strict'
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{createHash}=require('node:crypto')
function createExecutor(root=__dirname){return async (body,signal)=>{
 if(signal?.aborted)throw Error('operation_stopped')
 const config=JSON.parse(fs.readFileSync(path.join(root,'host-config.json'),'utf8')),exe=path.join(root,'ImagineBrowserInput.exe')
 if(!/^[a-f0-9]{64}$/.test(config.inputHash)||fs.realpathSync(exe)!==exe||createHash('sha256').update(fs.readFileSync(exe)).digest('hex')!==config.inputHash)throw Error('native_input_source_changed')
 return new Promise((resolve,reject)=>{
  const child=cp.spawn(exe,[],{cwd:root,windowsHide:true,shell:false,signal,stdio:['pipe','pipe','ignore']});let bytes=0,chunks=[],closed=false
  const timer=setTimeout(()=>{child.kill();finish(Error('native_input_timeout'))},7000)
  const finish=(error,result)=>{if(closed)return;closed=true;clearTimeout(timer);error?reject(error):resolve(result)}
  child.on('error',()=>finish(Error('native_input_unavailable')))
  child.stdout.on('data',b=>{bytes+=b.length;if(bytes>2100000){child.kill();finish(Error('native_input_unavailable'))}else chunks.push(b)})
  child.on('close',code=>{try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(code!==0||result.error)throw Error(typeof result.error==='string'&&/^[a-z_]+$/.test(result.error)?result.error:'native_input_unavailable');finish(null,result)}catch(e){finish(e)}})
  child.stdin.on('error',()=>finish(Error('native_input_unavailable')));child.stdin.end(JSON.stringify(body))
 })
}}
module.exports={createExecutor}
