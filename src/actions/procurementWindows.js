'use strict'
const path=require('node:path'),cp=require('node:child_process'),{DEFINITION}=require('./procurementContract')
function createScheduler({execute=null,root=path.resolve(__dirname,'../..')}={}){
 async function invoke(mode,definitionHash){
  if(!['read','create','enable','disable'].includes(mode)||definitionHash!==undefined&&!/^[a-f0-9]{64}$/.test(definitionHash))throw Error('invalid_request')
  const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',path.join(root,'scripts/scheduler/procurement-task.ps1'),'-Mode',mode,...(definitionHash?['-ExpectedDefinitionHash',definitionHash]:[])]
  let raw;if(execute)raw=await execute(args);else{if(process.platform!=='win32'||require('../testProcess').isTestProcess()||path.resolve(root).toLowerCase()!==path.resolve('C:/Aroma/aroma-agent-backend').toLowerCase())throw Error('scheduler_unavailable');raw=await new Promise((resolve,reject)=>cp.execFile(path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),args,{windowsHide:true,timeout:30000,encoding:'utf8',maxBuffer:100000},(e,out)=>e?reject(Error('scheduler_unavailable')):resolve(out)))}
  const r=JSON.parse(raw);if(typeof r.exists!=='boolean'||r.taskName!==DEFINITION.taskName||r.taskPath!==DEFINITION.taskPath||r.exists&&(!/^[a-f0-9]{64}$/.test(r.definitionHash)||typeof r.enabled!=='boolean'||typeof r.validDefinition!=='boolean'||!['Ready','Disabled','Running','Queued','Unknown'].includes(r.runtime)))throw Error('invalid_scheduler_receipt');return r
 }
 return{inspect:()=>invoke('read'),install:()=>invoke('create'),setEnabled:(value,hash)=>{if(typeof value!=='boolean')throw Error('invalid_request');return invoke(value?'enable':'disable',hash)}}
}
module.exports={createScheduler}
