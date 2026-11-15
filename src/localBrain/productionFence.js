'use strict'
// Process-local boundary installed before importing the formal app. Business
// access still requires its existing Gateway authorization; this adds no rights.
const {AsyncLocalStorage}=require('node:async_hooks'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto')
const permitted=new AsyncLocalStorage(),root=path.resolve(__dirname,'../..'),python='C:/Aroma/hindsight-runtime/Scripts/python.exe'
const businessOrigin=new URL(require('../context/adapters/aromaSystemRead').DEFAULT_BASE_URL).origin
function allowedUrl(value,method='GET'){
 try{
  const u=new URL(value);if(u.username||u.password||u.hash)return false
  if(u.origin==='http://127.0.0.1:11435')return method==='POST'?/^\/api\/(?:chat|show)$/.test(u.pathname):method==='GET'&&/^\/api\/(?:tags|ps)$/.test(u.pathname)
  if(u.origin==='http://127.0.0.1:11436')return method==='POST'&&u.pathname==='/count_tokens'
  // Existing authenticated storage RPC only. Bridge model/worker endpoints stay closed.
  if(u.origin==='http://127.0.0.1:8091')return method==='POST'&&!u.search&&(u.pathname==='/memory-store'||u.pathname==='/controlled-dispatch'&&require('../adapters/ControlledDispatchAdapter').enabled(process.env))
  if(u.protocol!=='https:'||u.port)return false
  if(u.origin===businessOrigin)return method==='GET'&&/^\/ai\/(?:inventory|suppliers|daily-counts|order-planning|purchase-orders|invoices)(?:\/|$)/.test(u.pathname)
  if(u.hostname==='www.googleapis.com')return method==='GET'&&/^\/(?:drive\/v3|gmail\/v1|calendar\/v3|oauth2\/v\d)(?:\/|$)/.test(u.pathname)
  if(u.hostname==='oauth2.googleapis.com')return method==='POST'&&u.pathname==='/token'
  if(['gmail.googleapis.com','sheets.googleapis.com'].includes(u.hostname))return method==='GET'&&/^\/(?:gmail\/v1|v4\/spreadsheets)(?:\/|$)/.test(u.pathname)
 }catch{}
 return false
}
function allowedChild(command,args,options={}){
 if(options.shell||path.resolve(command).toLowerCase()!==path.resolve(python).toLowerCase()||!Array.isArray(args))return false
 if(args.slice(0,3).join('|')!=='-B|-X|utf8')return false
 if(args.length===4)return path.resolve(args[3])===path.join(root,'scripts','memory','structured.py')
 return args.length===6&&path.resolve(args[3])===path.join(root,'scripts','memory','backupStructured.py')&&args[4]==='backup-and-verify'&&/^C:[\\/]Aroma[\\/]hindsight-runtime[\\/]backups[\\/]memory-[a-f0-9-]{36}\.json$/i.test(args[5])
}
function install({audit=()=>{}}={}){
 const net=require('node:net'),child=require('node:child_process'),http=require('node:http'),https=require('node:https'),restore=[]
 const deny=kind=>{audit({type:'local_egress_denied',kind});const e=Error('local_cloud_inference_forbidden');e.code='local_cloud_inference_forbidden';throw e}
 const originalConnect=net.Socket.prototype.connect
 net.Socket.prototype.connect=function(...args){
  const first=Array.isArray(args[0])?args[0][0]:args[0],o=typeof first==='object'?first:{port:first,host:typeof args[1]==='string'?args[1]:null},p=permitted.getStore()
  // Raw sockets cannot inherit a different destination from a permitted request.
  const host=o.host||o.hostname,port=Number(o.port)
  if(!p||o.path||host!==p.hostname||port!==Number(p.port||(p.protocol==='https:'?443:80)))return deny('socket')
  return originalConnect.apply(this,args)
 };restore.push(()=>{net.Socket.prototype.connect=originalConnect})
 function destination(first,options,protocol){
  try{if(typeof first==='string'||first instanceof URL)return new URL(first);const o=first||{};return new URL((o.protocol||protocol)+'//'+(o.hostname||o.host||'localhost')+(o.port?':'+o.port:'')+(o.path||'/'))}catch{return null}
 }
 for(const [module,protocol]of [[http,'http:'],[https,'https:']])for(const key of ['request','get']){
  const original=module[key];module[key]=function(...args){const u=destination(args[0],args[1],protocol);
   const override=typeof args[0]==='object'&&!(args[0] instanceof URL)?args[0]:typeof args[1]==='object'?args[1]:{}
   if(!u||!allowedUrl(u.href,String(override.method||'GET').toUpperCase()))return deny('http')
   if(override.socketPath||override.createConnection||override.lookup||override.agent&&override.agent!==module.globalAgent||override.hostname&&override.hostname!==u.hostname||override.host&&override.host!==u.hostname||override.port&&Number(override.port)!==Number(u.port||(u.protocol==='https:'?443:80))||override.path&&override.path!==u.pathname+u.search)return deny('http_override')
   audit({type:'local_egress_allowed',host:u.hostname,port:u.port||(protocol==='https:'?'443':'80')});return permitted.run(u,()=>original.apply(this,args))
  };restore.push(()=>{module[key]=original})
 }
 const originalFetch=global.fetch;global.fetch=async function(input,options={}){
  const u=destination(typeof input==='object'&&input.url?input.url:input,null,'https:');if(!u||!allowedUrl(u.href,String(options.method||input?.method||'GET').toUpperCase())||options.dispatcher)return deny('fetch')
  audit({type:'local_egress_allowed',host:u.hostname,port:u.port||(u.protocol==='https:'?'443':'80')})
  return permitted.run(u,()=>originalFetch(input,{...options,redirect:'error'}))
 };restore.push(()=>{global.fetch=originalFetch})
 const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
 const hashes=new Map(['structured.py','backupStructured.py','backupRecovery.py'].map(name=>{const file=path.join(root,'scripts','memory',name);return[file,digest(file)]}))
 for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']){
  const original=child[key];child[key]=function(command,args,options){
   if(key!=='spawn'||!allowedChild(command,args,options)||[...hashes].some(([file,hash])=>digest(file)!==hash))return deny('child_process')
   audit({type:'local_canonical_child',operation:path.basename(args[3])});return original.call(this,command,args,{...options,shell:false,windowsHide:true})
  };restore.push(()=>{child[key]=original})
 }
 return ()=>restore.reverse().forEach(fn=>fn())
}
module.exports={install,allowedUrl,allowedChild}
