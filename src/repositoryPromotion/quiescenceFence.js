'use strict'
// Installed only by the independently pinned launcher, before application imports.
const fs=require('node:fs'),cp=require('node:child_process'),http=require('node:http'),https=require('node:https'),crypto=require('node:crypto')
const HEADER='x-aroma-quiescence-lease'
function installFence(runtime,{serviceToken=()=>null,controlDirectory,internalOrigins=['http://127.0.0.1:8090','http://127.0.0.1:8091']}){
 const restores=[],rawFs={...fs},fdPaths=new Map(),timerScopes=new Map()
 const custom=require('node:util').promisify.custom
 // Node's close/exit events do not prove that descendants have exited or lost
 // access to protected storage. Keep the existing durable lease when native
 // work has actually started. There is no automatic clearance or PID guessing.
 const nativeClosed=(child,release,kind)=>{if(!Number.isInteger(child.pid))release();else runtime.recordUnverifiedNative(kind,child.pid)}
 const patch=(object,key,value)=>{
  const old=object[key]
  // Preserve Node's API descriptors, including multi-result promisification.
  // Merely copying the original custom function would bypass admission: execute
  // that native implementation inside a lease and retain its actual child too.
  for(const property of Reflect.ownKeys(old)){
   const descriptor=Object.getOwnPropertyDescriptor(old,property)
   if(property===custom&&typeof old[property]==='function'){
    const nativeCustom=old[property]
    const promisified=function(...args){return runtime.call(()=>{
     const result=Reflect.apply(nativeCustom,this,args)
     if(result?.child){const release=runtime.hold();result.child.once('close',()=>nativeClosed(result.child,release,'promisified-child'))}
     return result
    },{kind:'promisified'})}
    Object.defineProperty(value,property,{value:promisified,configurable:descriptor.configurable,enumerable:descriptor.enumerable,writable:false})
   }else Object.defineProperty(value,property,descriptor)
  }
  restores.push(()=>{object[key]=old});object[key]=value
 }
 function protectedControl(args,ancestors=false){
  const path=require('node:path'),root=path.resolve(controlDirectory).toLowerCase()
  for(let a of args){
   if(typeof a==='number')a=fdPaths.get(a)
   if(Buffer.isBuffer(a))a=a.toString()
   if(a instanceof URL)a=require('node:url').fileURLToPath(a)
   if(typeof a!=='string')continue
   let resolved=path.resolve(a),probe=resolved,tail=[]
   while(!rawFs.existsSync(probe)&&path.dirname(probe)!==probe){tail.unshift(path.basename(probe));probe=path.dirname(probe)}
   if(rawFs.existsSync(probe))resolved=path.join(rawFs.realpathSync(probe),...tail)
   resolved=resolved.toLowerCase()
   if(resolved===root||resolved.startsWith(root+path.sep)||(ancestors&&root.startsWith(resolved+path.sep)))throw Error('deployment_control_path_forbidden')
  }
 }
 const pathsFor=(name,args)=>args.slice(0,['rename','renameSync','copyFile','copyFileSync','cp','cpSync','link','linkSync','symlink','symlinkSync'].includes(name)?2:1)
 const destructive=name=>/^(?:rename|rm|rmdir|cp|copyFile|link|symlink|chmod|fchmod|lchmod|chown|fchown|lchown)/.test(name)
 function mutation(fn,args){protectedControl(pathsFor(fn.name,args),destructive(fn.name));return runtime.write(()=>fn(...args))}
 const sync=['writeFileSync','appendFileSync','writeSync','writevSync','renameSync','unlinkSync','mkdirSync','rmdirSync','rmSync','copyFileSync','cpSync','truncateSync','ftruncateSync','chmodSync','fchmodSync','chownSync','fchownSync','lchownSync','lchmodSync','utimesSync','futimesSync','lutimesSync','linkSync','symlinkSync','mkdtempSync','fsyncSync','fdatasyncSync']
 for(const name of sync)if(typeof fs[name]==='function')patch(fs,name,(...args)=>{
  if(['writeSync','writevSync'].includes(name)&&[1,2].includes(args[0]))return rawFs[name](...args)
  if(typeof args[0]==='number'&&args[0]>2&&!fdPaths.has(args[0]))throw Error('unidentified_writer_descriptor')
  return mutation(rawFs[name],args)
 })
 const writable=flags=>typeof flags==='number'?Boolean(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_APPEND|fs.constants.O_TRUNC|fs.constants.O_CREAT)):/[wa+]/.test(flags||'r')
 const originalReadFileSync=fs.readFileSync
 patch(fs,'readFileSync',(...args)=>writable(args[1]?.flag)?mutation(originalReadFileSync,args):originalReadFileSync(...args))
 patch(fs,'openSync',(...args)=>{const fd=writable(args[1])?mutation(rawFs.openSync,args):rawFs.openSync(...args);fdPaths.set(fd,args[0]);return fd})
 patch(fs,'closeSync',fd=>{try{return rawFs.closeSync(fd)}finally{fdPaths.delete(fd)}})
 for(const name of sync.map(n=>n.slice(0,-4)).filter(n=>typeof fs[n]==='function')){
  const original=fs[name]
  patch(fs,name,(...args)=>{
   const callback=args.pop()
   if(typeof callback!=='function')throw Error('callback_required')
   protectedControl(pathsFor(name,args),destructive(name))
   let invoked=false
   runtime.run(()=>new Promise(resolve=>original(...args,(error,...values)=>{
    invoked=true;callback(error,...values);resolve()
   }))).catch(error=>{if(!invoked)callback(error)})
  })
 }
 const promises=fs.promises
 for(const name of sync.map(n=>n.slice(0,-4)).filter(n=>typeof promises[n]==='function')){
  const original=promises[name].bind(promises)
  patch(promises,name,(...args)=>{protectedControl(pathsFor(name,args),destructive(name));return runtime.run(()=>original(...args))})
 }
 // FileHandle methods bypass fs exports. Refuse opening a writable FileHandle;
 // read-only FileHandles also expose mutators, so they are refused as well. No
 // current production writer uses this API; a survey test keeps that true.
 patch(promises,'open',()=>Promise.reject(Error('filehandle_writer_unsupported')))
 const originalPromiseRead=promises.readFile.bind(promises)
 patch(promises,'readFile',(...args)=>writable(args[1]?.flag)?runtime.run(()=>{protectedControl(args);return originalPromiseRead(...args)}):originalPromiseRead(...args))
 const originalRead=fs.readFile
 patch(fs,'readFile',(...args)=>{
  if(!writable(args[1]?.flag))return originalRead(...args)
  const callback=args.pop();protectedControl(args)
  runtime.run(()=>new Promise(resolve=>originalRead(...args,(...result)=>{callback(...result);resolve()}))).catch(error=>callback(error))
 })
 for(const name of ['mkdtempDisposable','mkdtempDisposableSync']){if(typeof fs[name]==='function')patch(fs,name,()=>{throw Error('disposable_directory_writer_unsupported')});if(typeof promises[name]==='function')patch(promises,name,()=>Promise.reject(Error('disposable_directory_writer_unsupported')))}
 const originalOpen=fs.open
 patch(fs,'open',(...args)=>{
  const callback=args.pop(),flags=args[1]
  let invoked=false
  const invoke=()=>new Promise(resolve=>originalOpen(...args,(error,fd)=>{invoked=true;if(!error)fdPaths.set(fd,args[0]);callback(error,fd);resolve()}))
  if(writable(flags)){protectedControl(args);runtime.run(invoke).catch(e=>{if(!invoked)callback(e)})}else originalOpen(...args,(error,fd)=>{if(!error)fdPaths.set(fd,args[0]);callback(error,fd)})
 })
 const originalClose=fs.close
 patch(fs,'close',(fd,callback)=>originalClose(fd,error=>{if(!error)fdPaths.delete(fd);callback(error)}))
 const originalStream=fs.createWriteStream
 patch(fs,'createWriteStream',(...args)=>runtime.call(()=>{protectedControl(args);const release=runtime.hold();let stream;try{stream=originalStream(...args)}catch(e){release();throw e}stream.once('close',()=>queueMicrotask(release));return stream}))
 // Direct close is necessary but cannot prove descendant containment. Successful
 // native launches keep a durable unresolved hold; timeout/kill/exit are not proof.
 for(const name of ['spawn','execFile','exec','fork']){
  const original=cp[name]
  patch(cp,name,(...args)=>runtime.call(()=>{
   const release=runtime.hold();let child
   try{child=original(...args)}catch(e){release();throw e}
   child.once('close',()=>nativeClosed(child,release,name));return child
  },{kind:'subprocess'}))
 }
 for(const name of ['spawnSync','execFileSync','execSync']){const original=cp[name];patch(cp,name,(...args)=>runtime.call(()=>{runtime.hold();try{return original(...args)}finally{runtime.recordUnverifiedNative(name,null)}},{kind:'subprocess'}))}
 const threads=require('node:worker_threads'),Worker=threads.Worker
 patch(threads,'Worker',new Proxy(Worker,{construct(target,args){return runtime.call(()=>{const release=runtime.hold();let worker;try{worker=Reflect.construct(target,args)}catch(e){release();throw e}const threadId=worker.threadId;worker.once('exit',()=>runtime.recordUnverifiedNative('worker-thread',threadId));return worker},{kind:'worker-thread'})}}))
 // Intervals are independent scheduled admissions. Request-owned intervals are
 // retained with the original operation until clearInterval, never cancelled by
 // draining. Startup-created polling intervals do not hold startup forever.
 const setIntervalRaw=globalThis.setInterval,clearIntervalRaw=globalThis.clearInterval
 const scheduledError=error=>{if(!/^(deployment_(?:draining|frozen)|gate_(?:busy|integrity_unconfirmed)|runtime_closed)$/.test(error.message))queueMicrotask(()=>{throw error})}
 patch(globalThis,'setInterval',(callback,delay,...args)=>{
  if(typeof callback!=='function')return setIntervalRaw(callback,delay,...args)
  const owner=runtime.current(),foreground=owner&&owner.kind!=='startup'
  const release=foreground?runtime.hold(owner):null
  const timer=setIntervalRaw(function(){
   if(foreground){runtime.enter(owner,()=>Reflect.apply(callback,this,args));return}
   runtime.run(()=>Reflect.apply(callback,this,args),{kind:'scheduled',forceRoot:true}).catch(scheduledError)
  },delay)
  if(release)timerScopes.set(timer,release)
  return timer
 })
 patch(globalThis,'clearInterval',timer=>{const release=timerScopes.get(timer);if(release){timerScopes.delete(timer);release()}return clearIntervalRaw(timer)})
 const setTimeoutRaw=globalThis.setTimeout,clearTimeoutRaw=globalThis.clearTimeout
 patch(globalThis,'setTimeout',(callback,delay,...args)=>{
  if(typeof callback!=='function')return setTimeoutRaw(callback,delay,...args)
  const owner=runtime.current(),retain=Boolean(owner)
  const release=retain?runtime.hold(owner):null
  const timer=setTimeoutRaw(function(){
   timerScopes.delete(timer)
   try{
    // A finished periodic callback scheduling its next iteration is new work.
    // Promises still pending under the old scope keep ordinary timeout/retry
    // callbacks attached to that already admitted operation.
    if(retain&&(!['startup','scheduled'].includes(owner.kind)||!owner.done||owner.promises>0))runtime.enter(owner,()=>Reflect.apply(callback,this,args))
    else runtime.run(()=>Reflect.apply(callback,this,args),{kind:'scheduled',forceRoot:true}).catch(scheduledError)
   }finally{release?.()}
  },delay)
  if(release)timerScopes.set(timer,release)
  return timer
 })
 patch(globalThis,'clearTimeout',timer=>{const release=timerScopes.get(timer);if(release){timerScopes.delete(timer);release()}return clearTimeoutRaw(timer)})
 const matches=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||!b)return false;const x=Buffer.from(a),y=Buffer.from('Bearer '+b);return x.length===y.length&&crypto.timingSafeEqual(x,y)}
 const originalEmit=http.Server.prototype.emit
 patch(http.Server.prototype,'emit',function(name,...args){
  if(name!=='request')return originalEmit.call(this,name,...args)
  const [req,res]=args,token=serviceToken(),parent=req.headers[HEADER]
  const parentId=parent&&matches(req.headers.authorization,token)&&!req.headers.origin?parent:null
  let entered=false
  try{return runtime.call(()=>{
   entered=true
   const release=runtime.hold();let complete=false
   const done=()=>{if(!complete){complete=true;queueMicrotask(release)}}
   res.once('finish',done);res.once('close',done)
   return originalEmit.call(this,name,...args)
  },{parentId,kind:'http',forceRoot:true})}catch(error){if(entered)throw error;res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'deployment_unavailable'}));req.resume();return true}
 })
 if(runtime.participant==='native'){
  const stdin=process.stdin,emit=stdin.emit
  patch(stdin,'emit',function(name,...args){
   if(name!=='data')return emit.call(this,name,...args)
   try{return runtime.call(()=>emit.call(this,name,...args),{kind:'native-message',forceRoot:true})}catch(_){
    let id=null
    try{const b=args[0],length=b.readUInt32LE(0);if(length<=200000&&b.length>=length+4){const v=JSON.parse(b.subarray(4,length+4));if(typeof v.id==='string'&&v.id.length<=80)id=v.id}}catch(_){}
    const body=Buffer.from(JSON.stringify({id,error:'deployment_unavailable'})),length=Buffer.alloc(4);length.writeUInt32LE(body.length);process.stdout.write(Buffer.concat([length,body]));return true
   }
  })
 }
 function headers(url,initial){const h=new Headers(initial||{});h.delete(HEADER);const s=runtime.current();if(s&&url.hostname==='127.0.0.1'&&internalOrigins.includes(url.origin))h.set(HEADER,s.lease.id);return h}
 if(globalThis.fetch){const original=globalThis.fetch;patch(globalThis,'fetch',(input,options={})=>runtime.run(()=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url),h=headers(u,options.headers||(typeof input==='object'?input.headers:null));return original(input,{...options,headers:h,...(h.has(HEADER)?{redirect:options.redirect==='manual'?'manual':'error'}:{})})}))}
 for(const module of [http,https])for(const name of ['request','get']){
  const original=module[name]
  patch(module,name,(...args)=>runtime.call(()=>{
   const first=args[0],isUrl=typeof first==='string'||first instanceof URL,opts=isUrl?args[1]:first
   let target
   try{target={...(isUrl?require('node:url').urlToHttpOptions(new URL(first)):{}),...(typeof opts==='object'?opts:{})}}catch(_){}
   const hostname=target?.hostname||target?.host,protocol=target?.protocol||(module===https?'https:':'http:'),port=target?.port||target?.defaultPort||target?.agent?.defaultPort||(module===https?443:80)
   const scope=runtime.current(),lease=scope&&!target?.socketPath&&hostname==='127.0.0.1'&&internalOrigins.includes(protocol+'//127.0.0.1:'+port)?scope.lease.id:null
   const initial=target?.headers
   // Node headers are objects (array-valued fields allowed) or flat raw arrays.
   // Do not route them through WHATWG Headers or normalize unrelated metadata.
   let updated=initial
   if(Array.isArray(initial)){
    if(initial.length%2===0){const next=[];let removed=false;for(let i=0;i<initial.length;i+=2){if(typeof initial[i]==='string'&&initial[i].toLowerCase()===HEADER)removed=true;else next.push(initial[i],initial[i+1])}if(lease)next.push(HEADER,lease);if(removed||lease)updated=next}
   }else if(initial==null||typeof initial==='object'){
    const keys=Object.keys(initial||{}).filter(k=>k.toLowerCase()===HEADER)
    if(keys.length||lease){updated={...initial};for(const key of keys)delete updated[key];if(lease)updated[HEADER]=lease}
   }
   if(updated!==initial){const next={...(typeof opts==='object'?opts:{}),headers:updated};if(isUrl){if(typeof args[1]==='function'||args.length===1)args.splice(1,0,next);else args[1]=next}else args[0]=next}
   const release=runtime.hold();let req
   try{req=original(...args)}catch(e){release();throw e}
   req.once('close',()=>queueMicrotask(release));return req
  },{kind:'network'}))
 }
 return ()=>{for(const restore of restores.reverse())restore()}
}
module.exports={installFence,HEADER}
