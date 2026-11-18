'use strict'
// Closed metadata from the existing Owner executor. This module never runs a
// command, starts a guest, calls a model or authorizes execution.
const ENGINE='windows-sandbox-offline-v1',PROTOCOL='sandbox-prerequisites-v1'
const KEYS='bootCommit,boundaryVerified,checkedAt,engine,metadataOnly,protocol,ready,reason,source,state'
const UNAVAILABLE=new Set(['windows_required','windows_sandbox_not_enabled','windows_restart_required','windows_virtualization_unavailable','windows_sandbox_cli_unavailable'])
const UNKNOWN=new Set(['sandbox_probe_unavailable','sandbox_probe_policy_blocked','sandbox_metadata_unconfirmed'])
function parsePrerequisiteStatus(v,bootCommit,now){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==KEYS||!/^[a-f0-9]{40}$/.test(bootCommit||'')||v.bootCommit!==bootCommit||v.protocol!==PROTOCOL||v.source!=='owner_bridge'||v.engine!==ENGINE||v.metadataOnly!==true||v.boundaryVerified!==false||typeof v.checkedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.checkedAt))return null
 const age=now-Date.parse(v.checkedAt)
 if(!Number.isFinite(age)||age<0||age>30000)return null
 if(!(v.state==='ready'&&v.ready===true&&v.reason===null||v.state==='unavailable'&&v.ready===false&&UNAVAILABLE.has(v.reason)||v.state==='busy'&&v.ready===false&&v.reason==='sandbox_recovery_or_work_pending'||v.state==='unknown'&&v.ready===null&&UNKNOWN.has(v.reason)))return null
 return{protocol:PROTOCOL,source:'owner_bridge',bootCommit,engine:ENGINE,state:v.state,ready:v.ready,reason:v.reason,checkedAt:v.checkedAt,boundaryVerified:false,metadataOnly:true}
}
function createPrerequisiteStatus({probe,isBusy,bootCommit,now=Date.now}={}){
 if(typeof probe!=='function'||typeof isBusy!=='function')throw Error('sandbox_status_probe_required')
 let cached=null,inFlight=null
 const snapshot=(state,ready,reason)=>({protocol:PROTOCOL,source:'owner_bridge',bootCommit,engine:ENGINE,state,ready,reason,checkedAt:new Date(now()).toISOString(),boundaryVerified:false,metadataOnly:true})
 const busy=()=>{try{const v=isBusy();return v===true?'busy':v===false?'idle':'unknown'}catch{return'unknown'}}
 return async function read(){
  const before=busy();if(before!=='idle')return before==='busy'?snapshot('busy',false,'sandbox_recovery_or_work_pending'):snapshot('unknown',null,'sandbox_probe_unavailable')
  const age=cached?now()-Date.parse(cached.checkedAt):NaN
  if(!inFlight&&(!cached||!Number.isFinite(age)||age<0||age>=10000)){
   inFlight=Promise.resolve().then(probe).then(r=>{
    if(r?.engine===ENGINE&&r.ready===true)cached=snapshot('ready',true,null)
    else if(r?.engine===ENGINE&&r.ready===false&&UNAVAILABLE.has(r.reason))cached=snapshot('unavailable',false,r.reason)
    else if(r?.engine===ENGINE&&r.ready===false&&r.reason==='sandbox_recovery_or_work_pending')cached=snapshot('busy',false,r.reason)
    else cached=snapshot('unknown',null,'sandbox_probe_unavailable')
   },e=>{cached=snapshot('unknown',null,e?.code==='local_cloud_inference_forbidden'?'sandbox_probe_policy_blocked':'sandbox_probe_unavailable')}).finally(()=>{inFlight=null})
  }
  await inFlight
  const after=busy();if(after!=='idle')return after==='busy'?snapshot('busy',false,'sandbox_recovery_or_work_pending'):snapshot('unknown',null,'sandbox_probe_unavailable')
  return structuredClone(cached)
 }
}
module.exports={ENGINE,PROTOCOL,createPrerequisiteStatus,parsePrerequisiteStatus}
