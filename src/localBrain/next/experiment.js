
'use strict'
const fs=require('node:fs')
const path=require('node:path')
const {createHmac,randomUUID,timingSafeEqual}=require('node:crypto')
const {setTimeout:wait}=require('node:timers/promises')

const EXPERIMENTS=Object.freeze({
  B:Object.freeze({profile:'B',model:'qwen3.8-flash-next-iq3_s',engine:'strata',architecture:'B'}),
  P:Object.freeze({profile:'P',model:'qwen3.8:27b',engine:'ollama',architecture:'B'})
})
const ID=/^[0-9a-f-]{36}$/
const EPOCH=/^[0-9a-f]{32}$/
const KEY=/^[0-9a-f]{64}$/
const MAX_FILE=160000
const LEASE_MS=15000
const MAX_REQUEST_MS=320000
function fault(code){return Error(code)}
function validPick(p){return typeof p==='string'&&Object.hasOwn(EXPERIMENTS,p)}
function validChat(body){
  if(!body||Object.keys(body).sort().join()!=='history,message,profile'||!validPick(body.profile)||
    typeof body.message!=='string'||!body.message.trim()||body.message.length>16000||
    !Array.isArray(body.history)||body.history.length>38||body.history.length%2)return false
  return body.history.every((m,i)=>m&&Object.keys(m).sort().join()==='content,role'&&m.role===(i%2?'assistant':'user')&&
      typeof m.content==='string'&&m.content.trim()&&m.content.length<=16000)&&Buffer.byteLength(JSON.stringify(body))<=120000
}
function digest(key,payload){return createHmac('sha256',Buffer.from(key,'hex')).update(payload).digest('hex')}
function signed(key,body){
  if(!KEY.test(key||''))throw fault('experiment_key_invalid')
  const payload=JSON.stringify(body)
  return {payload,mac:digest(key,payload)}
}
function readSigned(file,key){
  try{
    const stat=fs.lstatSync(file)
    if(!stat.isFile()||stat.size>MAX_FILE||!KEY.test(key||''))return null
    const {payload,mac}=JSON.parse(fs.readFileSync(file,'utf8'))
    if(typeof payload!=='string'||!KEY.test(mac||'')||!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(digest(key,payload),'hex')))return null
    return JSON.parse(payload)
  }catch{return null}
}
function publish(directory,filename,key,body){
  const out=JSON.stringify(signed(key,body))
  if(Buffer.byteLength(out)>MAX_FILE)throw fault('experiment_receipt_too_large')
  // Mapped Windows Sandbox directories may refuse a host rename. A partial
  // frame never verifies its MAC, so readers only admit fully published data.
  const heartbeat=filename==='ready.json'||filename==='ready-alt.json'
  fs.writeFileSync(path.join(directory,filename),out,{flag:heartbeat?'w':'wx'})
}
function remove(file){try{fs.unlinkSync(file)}catch(error){if(error.code!=='ENOENT')throw error}}
function makeSpool(root,key){
  if(!path.isAbsolute(root)||!KEY.test(key||''))throw fault('experiment_configuration_invalid')
  const input=path.join(root,'requests'),output=path.join(root,'responses')
  for(const dir of [root,input,output]){
    fs.mkdirSync(dir,{recursive:true})
    const entry=fs.lstatSync(dir)
    if(!entry.isDirectory()||entry.isSymbolicLink())throw fault('experiment_directory_invalid')
  }
  return {input,output,key}
}
function configured(){
  const root=process.env.XIANGXIANG_PHASE1_SPOOL
  if(!root||process.env.CHAT_BACKEND!=='local')return null
  const key=fs.readFileSync(path.join(root,'key.hex'),'utf8').trim()
  return {...transport(makeSpool(root,key)),preference:require('./experimentPreference').preference(root)}
}
function transport(spool,{timeoutMs=MAX_REQUEST_MS,pollMs=150}={}){
  let busy=false
  const read=file=>readSigned(path.join(spool.output,file),spool.key)
  function lease(){
    const now=Date.now()
    return ['ready.json','ready-alt.json'].map(read)
      .filter(r=>r&&EPOCH.test(r.boot)&&now>=r.at&&now-r.at<LEASE_MS&&r.network==='ENETUNREACH')
      .sort((a,b)=>b.at-a.at)[0]||null
  }
  async function call(action,body,{signal}={}){
    if(action==='chat'?!validChat(body):action!=='release'||!body||Object.keys(body).length)throw fault('experiment_input_invalid')
    const guest=lease()
    if(!guest)throw fault('experiment_offline')
    if(busy)throw fault('experiment_busy')
    const id=randomUUID(),file=id+'.json',deadline=Date.now()+timeoutMs
    busy=true
    try{
      publish(spool.input,file,spool.key,{boot:guest.boot,id,action,deadline,body})
      while(Date.now()<deadline){
        if(signal?.aborted)throw fault('experiment_cancelled')
        const current=lease()
        if(!current||current.boot!==guest.boot)throw fault('experiment_interrupted')
        const response=read(file)
        if(response){
          if(response.id!==id||response.boot!==guest.boot)throw fault('experiment_receipt_mismatch')
          if(response.error)throw fault(/^experiment_[a-z_]{1,55}$/.test(response.error)?response.error:'experiment_generation_failed')
          const result=response.result
          if(action==='release'){
            if(result?.state!=='unloaded')throw fault('experiment_release_failed')
          }else{
            const expected=EXPERIMENTS[body.profile]
            if(!result||!Object.keys(expected).every(k=>result[k]===expected[k])||
              result.calls!==1||typeof result.text!=='string'||!result.text.trim())throw fault('experiment_model_mismatch')
          }
          return result
        }
        await wait(pollMs)
      }
      throw fault('experiment_timeout')
    }finally{
      try{remove(path.join(spool.input,file));remove(path.join(spool.output,file))}
      finally{busy=false}
    }
  }
  return {ready:()=>Boolean(lease()),call}
}

module.exports={EXPERIMENTS,ID,EPOCH,MAX_REQUEST_MS,validChat,makeSpool,configured,signed,readSigned,publish,transport}
