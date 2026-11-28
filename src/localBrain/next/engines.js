'use strict'
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), net=require('node:net')
const {spawn,execFile}=require('node:child_process')
const {promisify}=require('node:util')
const {once}=require('node:events')
const {randomBytes}=require('node:crypto')
const {setTimeout:wait}=require('node:timers/promises')
const {createLifecycle}=require('./engineLifecycle')
const exec=promisify(execFile)
const BUILD='bafa53ea33addb74219e734cf376ac1c1b10b600'
const ARM={A:'strata',B:'strata',C:'strata',D:'ollama',H:'strata',P:'ollama'}

async function freePort(){
  const socket=net.createServer().listen(0,'127.0.0.1');await once(socket,'listening')
  const {port}=socket.address();await new Promise(resolve=>socket.close(resolve))
  return port
}
function cleanEnv(home){
  fs.mkdirSync(home,{recursive:true})
  const names=['Path','SystemRoot','WINDIR','ComSpec','PATHEXT','SystemDrive','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','ProgramFiles','ProgramFiles(x86)','ProgramData']
  const allow=Object.fromEntries(names.filter(n=>process.env[n]).map(n=>[n,process.env[n]]))
  return {...allow,HOME:home,USERPROFILE:home,APPDATA:path.join(home,'appdata'),LOCALAPPDATA:path.join(home,'local'),TEMP:home,TMP:home,
    HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',
    OLLAMA_NO_CLOUD:'1',HF_HUB_OFFLINE:'1',STRATA_OFFLINE:'1',PYTHONIOENCODING:'utf-8'}
}
async function resources(){
  const {stdout}=await exec('nvidia-smi.exe',['--query-gpu=memory.free,memory.used,utilization.gpu,temperature.gpu','--format=csv,noheader,nounits'],{timeout:8000,windowsHide:true})
  const [freeVramMiB,usedVramMiB,gpuUtil,temperatureC]=stdout.trim().split(',').map(Number)
  if(![freeVramMiB,usedVramMiB,gpuUtil,temperatureC].every(Number.isFinite))throw Error('resource_probe_unavailable')
  return {freeVramMiB,usedVramMiB,gpuUtil,temperatureC,freeRamBytes:os.freemem()}
}
function createManager({proof,root,event=()=>{},job=null,idleMs=0,probe=resources,minRamGiB={strata:55,ollama:20},strataRamReserve=12}){
  let active=null,launchCount=0
  const life=createLifecycle({idleMs,unload:halt,isLoaded:()=>Boolean(active),
    onIdleError:error=>event({type:'engine_idle_release_failed',reason:error.code||error.message})})
  function state(){
    return {state:active?(active.ready?'resident':'starting'):'unloaded',model:active?.pin.model??null,
      engine:active?.pin.engine??null,busy:life.busy(),idleMs:life.idleMs,exclusiveJob:Boolean(job)}
  }
  function attestJob(){
    if(!job)return
    const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(job.path)).digest('hex')
    if(hash!==job.sha256)throw Error('engine_job_identity_mismatch')
  }
  function attest(){
    const required={
      revision:'ed59f92082b1e93c0e96d60a8b11aab089b52f09',
      weights:['4c1eb2ceb4915e1192f4f386021897bde56a97f40a0bb78bb86465e0f7d2aca3','316b46f3a2dbd68c900f43136ab9449f9dcc3725dfd8c794847c204bc161e113'],
      ollama:'aaee06c39dcf2437cde036998d960e1fc1494b8191be7cc9657d01e509097813'
    }
    if(proof.strataRevision!==required.revision||proof.ollamaDigest!==required.ollama||proof.ollamaQuant!=='Q4_K_M'||
      !required.weights.every(hash=>proof.files.some(f=>f.sha===hash))||!proof.strata.exe.includes('0.1.69-windows-x86_64-cuda-cuda13')||
      !proof.strata.args.includes('8192')||!proof.strata.args.includes('fp16')||proof.strata.args[proof.strata.args.indexOf('--ram-keep-gib')+1]!==String(strataRamReserve)||
      proof.strata.model_name!=='qwen3.8-flash-next-iq3_s')throw Error('pinned_asset_mismatch')
    for(const f of proof.files){
      const stat=fs.statSync(f.path)
      if(stat.size!==f.bytes||stat.mtimeMs!==f.mtimeMs)throw Error('verified_asset_changed')
    }
  }
  async function halt(reason='switch'){
    if(!active)return
    const instance=active
    const alive=()=>instance.child.pid&&!instance.closed
    if(alive()){
      if(job){
        instance.child.stdin.end()
        for(let i=0;i<60&&alive();i++)await wait(100)
        if(alive())instance.child.kill()
      }else{
        try{await exec('taskkill.exe',['/PID',String(instance.child.pid),'/T','/F'],{windowsHide:true,timeout:12000})}
        catch{if(alive())throw Error('local_engine_shutdown_failed')}
      }
      for(let i=0;i<60&&alive();i++)await wait(100)
      if(alive())throw Error('local_engine_shutdown_failed')
    }
    active=null
    event({type:'engine_stopped',engine:instance.pin.engine,pid:instance.child.pid,reason})
  }
  async function request(url,key,timeout=3000){
    const result=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(timeout),headers:key?{authorization:'Bearer '+key}:{}})
    if(!result.ok)throw Error('local_engine_not_ready')
    return result.json()
  }
  async function verify(pin){
    if(pin.engine==='ollama'){
      const version=await request(pin.url+'/api/version')
      const inventory=await request(pin.url+'/api/tags')
      if(version.version!=='0.40.16'||!inventory.models.some(m=>m.name===pin.model&&m.digest===proof.ollamaDigest&&m.details?.quantization_level===proof.ollamaQuant))throw Error('pinned_ollama_mismatch')
    }else{
      const health=await request(pin.url+'/health',pin.key)
      const inventory=await request(pin.url+'/v1/models',pin.key)
      if(health.status!=='ok'||health.loaded!==true||health.model!==pin.model||health.max_context!==8192||!inventory.data.some(x=>x.id===pin.model))throw Error('pinned_strata_mismatch')
    }
  }
  async function ensure(kind,signal){
    signal?.throwIfAborted()
    attest()
    attestJob()
    if(active?.pin.engine===kind&&!active.closed&&active.child.exitCode===null){
      try{await verify(active.pin);return active.pin}catch{await halt()}
    }else await halt()
    let available=await probe()
    const minimum=minRamGiB[kind]
    for(let i=0;i<12&&(available.freeRamBytes<minimum*2**30||(available.freeVramMiB!==null&&available.freeVramMiB<4608));i++){signal?.throwIfAborted();await wait(1000);available=await probe()}
    if(available.freeRamBytes<minimum*2**30||(available.freeVramMiB!==null&&available.freeVramMiB<4608))throw Error('local_engine_headroom_unavailable')
    const port=await freePort(),url='http://127.0.0.1:'+port
    const directory=path.join(root,++launchCount+'-'+kind)
    const env=cleanEnv(directory)
    const log=path.join(directory,'engine.log')
    const key=kind==='strata'?randomBytes(24).toString('hex'):null
    const pin=Object.freeze({engine:kind,url,key,model:kind==='strata'?proof.strata.model_name:'qwen3.8:27b',layers:21})
    let command,args,cwd
    if(kind==='strata'){
      command=path.join(proof.strata.cwd,'python/python.exe')
      cwd=proof.strata.cwd
      Object.assign(env,{STRATA_API_KEY:key,STRATA_DEBUG:'1',STRATA_INSTALL_DIR:path.join(directory,'install'),
        STRATA_COMPONENTS_DIR:path.dirname(path.dirname(proof.strata.exe)),STRATA_CONNECTION_DIR:path.join(directory,'connections')})
      const config=path.join(directory,'profile.json')
      fs.writeFileSync(config,JSON.stringify({...proof.strata,port,log:path.join(directory,'native.log')},null,2))
      args=[path.join(cwd,'strata.py'),'serve','--profile',config,'--offline','--host','127.0.0.1','--port',String(port),'--output','jsonl']
    }else{
      command=proof.ollamaExe;cwd=directory
      Object.assign(env,{OLLAMA_HOST:'127.0.0.1:'+port,OLLAMA_MODELS:proof.ollamaStore,
        OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_KEEP_ALIVE:'-1',OLLAMA_FLASH_ATTENTION:'1',
        OLLAMA_VULKAN:'0',CUDA_VISIBLE_DEVICES:'0',HIP_VISIBLE_DEVICES:'-1',ROCR_VISIBLE_DEVICES:'-1',OLLAMA_GPU_OVERHEAD:'402653184'})
      args=['serve']
    }
    const fd=fs.openSync(log,'wx')
    const started=performance.now()
    let child
    try{
      child=spawn(job?job.path:command,job?[command,...args]:args,
        {cwd,env,windowsHide:true,stdio:[job?'pipe':'ignore',fd,fd]})
    }finally{fs.closeSync(fd)}
    let spawnFailed=false
    const instance={pin,child,ready:false,closed:false}
    child.on('error',()=>{spawnFailed=true})
    child.stdin?.on('error',()=>{}) // The owned helper may exit before releasing the control pipe.
    child.on('close',()=>{instance.closed=true})
    active=instance
    event({type:'engine_start',engine:kind,model:pin.model,pid:child.pid,port,before:available})
    try{
      const deadline=performance.now()+165000
      while(performance.now()<deadline){
        signal?.throwIfAborted()
        if(job&&child.exitCode===75)throw Error('local_engine_lease_busy')
        if(spawnFailed||child.exitCode!==null||child.signalCode)throw Error('local_engine_start_failed')
        try{
          await verify(pin)
          instance.ready=true
          event({type:'engine_ready',engine:kind,model:pin.model,pid:child.pid,coldStartMs:performance.now()-started})
          return pin
        }catch(error){if(error.message.startsWith('pinned_')&&kind==='ollama')throw error}
        await wait(650)
      }
      throw Error('local_engine_start_timeout')
    }catch(error){await halt();throw error}
  }
  function withEngine(arm,fn,{signal}={}){
    if(!Object.hasOwn(ARM,arm))return Promise.reject(Error('unknown_dialogue_arm'))
    return life.run(async()=>fn(await ensure(ARM[arm],signal)))
  }
  return {withEngine,close:life.close,restart:life.restart,release:life.release,state}
}
module.exports={createManager,resources,freePort,cleanEnv,BUILD}
