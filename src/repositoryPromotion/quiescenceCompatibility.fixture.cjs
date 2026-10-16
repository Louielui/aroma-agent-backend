'use strict'
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),util=require('node:util'),http=require('node:http'),https=require('node:https'),{randomUUID}=require('node:crypto')
const mode=process.argv[2],scenario=process.argv[3],directory=fs.mkdtempSync(path.join(os.tmpdir(),'qcompat-')),raw={...fs},rawTimeout=setTimeout,rawInterval=setInterval,rawClearInterval=clearInterval,originalOpen=fs.openSync
let injected=0
// Fault injection is installed before the protocol captures raw control I/O.
fs.openSync=function(...args){if(injected&&String(args[0]).endsWith('gate.lock')){if(injected>0)injected--;const e=Error('simulated delete-pending lock');e.code='EPERM';throw e}return originalOpen(...args)}
const gate=require('./quiescence').createGate({directory:path.join(directory,'control'),participants:['backend'],ownerPassword:()=> 'fixture-owner-password'})
gate.initialize({password:'fixture-owner-password'})
const origins=[],runtime=require('./quiescenceRuntime').createRuntime({gate,participant:'backend'}),restore=mode==='fenced'?require('./quiescenceFence').installFence(runtime,{controlDirectory:path.join(directory,'control'),internalOrigins:origins}):()=>{}
const sleep=ms=>new Promise(r=>rawTimeout(r,ms)),error=e=>({code:e.code,name:e.name,stdout:e.stdout,stderr:e.stderr})
async function main(){
 if(scenario==='promisify'){
  const execFile=util.promisify(cp.execFile),exec=util.promisify(cp.exec),timer=util.promisify(setTimeout),r={}
  const p=execFile(process.execPath,['-e','process.stdout.write("out");process.stderr.write("err")']);r.child=!!p.child?.pid;r.success=await p
  try{await execFile(process.execPath,['-e','process.stdout.write("out");process.stderr.write("err");process.exit(7)'])}catch(e){r.failure=error(e)}
  r.shell=await exec('echo synthetic');r.timer=await timer(1,'value');const c=new AbortController();c.abort('fixture');try{await timer(1,'x',{signal:c.signal})}catch(e){r.abort={name:e.name,code:e.code,cause:e.cause}}
  r.callback=await new Promise(resolve=>cp.execFile(process.execPath,['-e','process.stdout.write("callback")'],(e,stdout,stderr)=>resolve({error:e?.code||null,stdout,stderr})))
  r.callbackTimer=await new Promise(resolve=>setTimeout(function(a,b){resolve({args:[a,b],timerReceiver:typeof this.refresh==='function'})},1,'a','b'))
  r.callbackInterval=await new Promise(resolve=>{const timer=setInterval(function(a){clearInterval(timer);resolve({arg:a,timerReceiver:typeof this.refresh==='function'})},1,'value')})
  try{setTimeout(null,1)}catch(e){r.invalidTimer={name:e.name,code:e.code}}
  try{cp.execFile(null)}catch(e){r.invalidExec={name:e.name,code:e.code}}
  r.symbols=Object.getOwnPropertySymbols(cp.execFile).map(String);r.timerSymbols=Object.getOwnPropertySymbols(setTimeout).map(String);return r
 }
 if(['http','https','ipv6'].includes(scenario)){
  const secure=scenario==='https',module=secure?https:http,host=scenario==='ipv6'?'::1':'127.0.0.1';let tls
  if(secure){const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';cp.execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,'key'),'-out',path.join(directory,'cert'),'-subj','/CN=localhost','-days','1'],{windowsHide:true,stdio:'ignore'});tls={key:fs.readFileSync(path.join(directory,'key')),cert:fs.readFileSync(path.join(directory,'cert'))}}
  const received=[],server=secure?https.createServer(tls,handler):http.createServer(handler)
  function handler(req,res){let body='';req.on('data',d=>body+=d);req.on('end',()=>{received.push({method:req.method,url:req.url,rawHeaders:req.rawHeaders.filter((_,i,a)=>!['host','connection'].includes(a[i-i%2].toLowerCase())),body});res.end('ok')})}
  await new Promise((r,j)=>{server.once('error',j);server.listen(0,host,r)});const port=server.address().port,url=(secure?'https:':'http:')+'//'+(host==='::1'?'[::1]':host)+':'+port
  const results=[]
  async function send(name,args,body){return new Promise((resolve,reject)=>{let callbackCount=0;const callback=res=>{callbackCount++;let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({callbackCount,status:res.statusCode,text}))};let req;try{req=module[name](...args,callback)}catch(e){reject(e);return}req.once('error',reject);if(name==='request')req.end(body)})}
  const extra=secure?{rejectUnauthorized:false}:{}
  try{
   for(const name of ['request','get']){
    results.push(await send(name,[url+'/string',extra]));results.push(await send(name,[new URL(url+'/url'),extra]));
    if(!secure){results.push(await send(name,[url+'/callback-only']));results.push(await send(name,[url+'/undefined',undefined]));results.push(await send(name,[url+'/null',null]))}
    results.push(await send(name,[{hostname:host,port,path:'/object?x=1',headers:{'X-Array':['one','two'],'X-Mixed':'Value'},...extra}]));
    results.push(await send(name,[url+'/raw',{headers:['X-Case','One','X-Case','Two'],...extra}]));
    results.push(await send(name,[url+'/override',{path:'/changed',method:name==='request'?'POST':'GET',headers:{'X-Preserve':' A  B '},...extra}],name==='request'?'body':undefined));
   }
   for(const name of ['request','get']){try{module[name]('invalid url')}catch(e){results.push({invalid:{name:e.name,code:e.code}})}}
   const escaped=await new Promise(resolve=>{const req=module.request({hostname:host,port:1,...extra});req.once('error',e=>resolve({error:e.code}));req.end()});results.push(escaped)
   await new Promise(resolve=>{const req=module.request({hostname:host,port,path:'/abort',...extra});req.on('error',e=>{results.push({abort:e.message});resolve()});req.destroy(Error('fixture_abort'))})
   return{results,received}
  }finally{await new Promise(r=>server.close(r))}
 }
 if(scenario==='lock'){
  if(process.platform!=='win32')return{completed:true,refused:true,unchanged:true}
  injected=1;fs.writeFileSync(path.join(directory,'business'),'complete');const completed=fs.readFileSync(path.join(directory,'business'),'utf8')==='complete';injected=-1;let refused=false;try{fs.writeFileSync(path.join(directory,'business'),'unsafe')}catch(_){refused=true}injected=0;return{completed,refused,unchanged:fs.readFileSync(path.join(directory,'business'),'utf8')==='complete'}
 }
 if(scenario==='drain'){
  const timer=util.promisify(setTimeout)(150,'timer');const request={password:'fixture-owner-password',run:randomUUID(),expectedGeneration:0};gate.prepare(request)
  const pending=gate.status().leases.length>0;let refused=false;try{await util.promisify(cp.execFile)(process.execPath,['-e','process.exit(0)'])}catch(e){refused=e.message==='deployment_draining'}await timer;for(let i=0;i<50&&gate.status().leases.length;i++)await sleep(10)
  const finished=gate.status().leases.length===0;gate.acknowledge('backend',()=>({idle:true}));gate.freeze({...request,expectedGeneration:1});let frozen=false;try{await util.promisify(setTimeout)(1)}catch(e){frozen=e.message==='deployment_frozen'}return{pending,refused,finished,frozen}
 }
 throw Error('unknown_scenario')
}
// The parent cleans this disposable directory only after the entire fixture
// process exits. Logical unresolved leases are intentionally not auto-cleared.
main().then(async result=>{restore();runtime.close();if(process.send)await new Promise(r=>process.send({result,directory},r))}).catch(e=>{restore();runtime.close();console.error(e.stack);process.exitCode=1}).finally(()=>process.disconnect?.())
