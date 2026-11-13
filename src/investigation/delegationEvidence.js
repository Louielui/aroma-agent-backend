'use strict'
// Read projections of existing composed services, not a second registry or grant.
const SHA=/^[a-f0-9]{40}$/,ID=/^[a-z][a-z0-9_-]{0,79}$/,MODEL=/^[a-z][a-z0-9.\[\]-]{0,99}$/
const selections=new Set(['fixed','per_request','workflow_default','none'])
const text=(v,n=200)=>typeof v==='string'&&v.length>0&&v.length<=n?v:null
const fresh=(at,now)=>Number.isFinite(Date.parse(at))&&Number.isFinite(Date.parse(now))&&Date.parse(now)-Date.parse(at)>=-5000&&Date.parse(now)-Date.parse(at)<=60000
function entry(component,r){
 if(!ID.test(r.id||'')||!text(r.role)||!selections.has(r.selection)||r.model!==null&&!MODEL.test(r.model||'')||!text(r.permissions))throw Error('invalid_delegation_snapshot')
 const provides=(r.provides||[]).map(p=>({capability:p.capability,version:p.version}))
 if(provides.length>20||provides.some(p=>!text(p.capability,100)||!Number.isSafeInteger(p.version)||p.version<1))throw Error('invalid_delegation_snapshot')
 return {channelId:component+':'+r.id,workerId:r.id,role:r.role,provides,model:r.model,effort:text(r.effort,40),selection:r.selection,permissions:r.permissions,scope:text(r.scope,500),files:Number.isSafeInteger(r.files)&&r.files>=0?r.files:null,enabled:typeof r.enabled==='boolean'?r.enabled:null,authorization:'required_per_job',budget:'not_evaluated',canAccept:null}
}
function snapshot(component,bootCommit,records,at,extra={}){
 if(!SHA.test(bootCommit||'')||!Array.isArray(records)||records.length>64)throw Error('invalid_delegation_snapshot')
 return {kind:'delegation_snapshot_v1',component,bootCommit,observedAt:at,records,...extra}
}
function backendSnapshot({bootCommit,agents=[],legacy=[],readAccess=false,at=new Date().toISOString()}){
 const records=agents.map(a=>{const d=a.delegation;return entry('backend',{id:a.id,role:a.role,provides:a.provides,model:d?.model||null,effort:d?.effort||null,selection:d?.selection||'none',permissions:d?.permissions||'manifest_declaration_only',scope:d?.scope,files:d?.files,enabled:d?readAccess&&a.status==='active':null})})
 return snapshot('backend',bootCommit,records,at,{legacyRoles:legacy.slice(0,32).map(w=>({id:text(w.id,80),role:text(w.role),provider:text(w.provider,80),connectedDeclared:typeof w.connected==='boolean'?w.connected:null,basis:'legacy_org_chart_declaration_only'}))})
}
function bridgeSnapshot({bootCommit,providers=[],enabled=false,recipes=[],models=null,at=new Date().toISOString()}){
 const rows=Array.isArray(models?.models)?models.models:[]
 const reason=models?.providers?.claude?.code
 const providerStates={claude:{state:models?.providers?.claude?.state==='ready'?'catalogue_available':'unconfirmed',reason:['subscription_login_required','subscription_unavailable'].includes(reason)?reason:null},openai:{state:rows.some(r=>r.provider==='openai'&&r.available===true)?'catalogue_available':'unconfirmed',reason:null}}
 return snapshot('bridge',bootCommit,providers.map(p=>entry('bridge',{...p,enabled})),at,{recipes:recipes.slice(0,32).map(r=>({recipe:text(r.recipe,100),scope:text(r.scope),files:Array.isArray(r.allowedFiles)?r.allowedFiles.length:null})),providerStates,models:rows.slice(0,40).filter(r=>MODEL.test(r.model||'')).map(r=>({model:r.model,resolvedModel:MODEL.test(r.resolvedModel||'')?r.resolvedModel:null,available:typeof r.available==='boolean'?r.available:null}))})
}
function validSnapshot(v){
 return !!v&&v.kind==='delegation_snapshot_v1'&&['backend','bridge'].includes(v.component)&&SHA.test(v.bootCommit||'')&&Array.isArray(v.records)&&v.records.length<=64&&new Set(v.records.map(r=>r?.channelId)).size===v.records.length&&v.records.every(r=>r&&r.channelId===v.component+':'+r.workerId&&ID.test(r.workerId||'')&&text(r.role)&&text(r.permissions)&&selections.has(r.selection)&&(r.model===null||MODEL.test(r.model||''))&&(r.effort===null||text(r.effort,40))&&(r.enabled===null||typeof r.enabled==='boolean')&&r.authorization==='required_per_job'&&r.budget==='not_evaluated'&&r.canAccept===null)
}
function mergeDelegation({backend,bridge,expectedCommit,at=new Date().toISOString()}){
 const good=(v,name)=>validSnapshot(v)&&v.component===name&&v.bootCommit===expectedCommit&&fresh(v.observedAt,at)
 const b=good(backend,'backend'),h=good(bridge,'bridge'),models=h&&Array.isArray(bridge.models)?bridge.models:[]
 const records=[...(b?backend.records:[]),...(h?bridge.records:[])].map(r=>{
  const model=models.filter(m=>m.model===(r.model==='sonnet'?'claude-sonnet':r.model))
  const m=model.length===1?model[0]:null
  return {...r,resolvedModel:m?.available===true&&MODEL.test(m.resolvedModel||'')?m.resolvedModel:null,subscription:m?.available===true?'catalogue_available':m?.available===false?'catalogue_unavailable':'unknown',connection:h?'bridge_metadata_observed':'unknown'}
 })
 return {kind:'delegation_evidence_v1',state:b&&h?'ok':records.length?'partial':'unavailable',scope:'registered_in_process_channels',scopeComplete:b&&h,observedAt:at,bootCommit:SHA.test(expectedCommit||'')?expectedCommit:null,coverage:{backend:b?'read':'unavailable',bridge:h?'read':'unavailable'},records,legacyRoles:b&&Array.isArray(backend.legacyRoles)?backend.legacyRoles:[],recipes:h&&Array.isArray(bridge.recipes)?bridge.recipes:[],providerStates:h?bridge.providerStates:null,modelChoices:models,catalogueCount:models.length,dispatchVerified:false,permissionsVerified:false}
}
function validReceipt(v){
 return !!v&&v.kind==='delegation_evidence_v1'&&SHA.test(v.bootCommit||'')&&['ok','partial'].includes(v.state)&&v.scope==='registered_in_process_channels'&&v.dispatchVerified===false&&v.permissionsVerified===false&&fresh(v.observedAt,new Date().toISOString())&&Array.isArray(v.records)&&v.records.length<=128&&new Set(v.records.map(r=>r?.channelId)).size===v.records.length&&v.records.every(r=>['backend','bridge'].some(component=>validSnapshot({kind:'delegation_snapshot_v1',component,bootCommit:v.bootCommit,records:[r]}))&&['catalogue_available','catalogue_unavailable','unknown'].includes(r.subscription)&&['bridge_metadata_observed','unknown'].includes(r.connection)&&(r.resolvedModel===null||MODEL.test(r.resolvedModel||'')))
}
async function readDelegation({env=process.env,request=require('../adapters/CodexSubscriptionAdapter').localRequest,at=()=>new Date().toISOString()}={}){
 const bootCommit=require('../governance/bootCommit').BOOT_COMMIT
 let backend=null
 try{backend=backendSnapshot({bootCommit,agents:require('../capability/agents').listManifests(),legacy:require('../workers/registry').listWorkers(),readAccess:env.READ_ACCESS==='on',at:at()})}catch{/* A malformed backend declaration cannot erase the Bridge observation. */}
 let bridge=null;try{bridge=await request('/delegation-metadata',{},env,AbortSignal.timeout(15000))}catch{/* Preserve backend declarations with unknown connection. */}
 return mergeDelegation({backend,bridge,expectedCommit:bootCommit,at:at()})
}
module.exports={backendSnapshot,bridgeSnapshot,validSnapshot,mergeDelegation,validReceipt,readDelegation}
